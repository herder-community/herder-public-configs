// easymesh-default.js — TR-181 wifi topology emit (flat AP + optional MultiAP).
//
// Walks Device.WiFi.AccessPoint.{i}.AssociatedDevice.{j} for clients
// associated to the gateway's own radios (the flat-AP case that
// covers the modal TR-181 fleet). When the device also reports
// Device.WiFi.MultiAP.APDevice.{i}.* extender entries, those are
// emitted as extender nodes with their own AssociatedDevice tables
// hanging off them; clients show up under whichever AP saw them.
//
// Hostname / IPv4 / IPv6 cross-ref Device.Hosts.Host.* by MAC.

(function () {
  var rssiEncoding = ctx.configGet("rssiEncoding", "dbm");
  var includeInactive = ctx.configGet("includeInactiveHosts", false);

  // ---- Step 1: host metadata by MAC ----
  var hostByMAC = {};
  var hosts = batch.matches("Device.Hosts.Host.*");
  for (var i = 0; i < hosts.length; i++) {
    var h = hosts[i];
    var mac = (h.PhysAddress || "").toLowerCase();
    if (!mac) continue;
    if (!includeInactive && h.Active === "false") continue;

    var v6List = batch.matches(
      "Device.Hosts.Host." + h.$indexes.Host + ".IPv6Address.*.IPAddress"
    );
    var v6 = v6List.map(function (e) { return e.IPAddress; }).join(",");

    hostByMAC[mac] = {
      hostname: h.HostName || "",
      ipv4: h.IPAddress || "",
      ipv6: v6,
    };
  }

  // ---- Step 2: gateway = the managed CPE itself ----
  var gatewayMAC = (
    batch.params["Device.Ethernet.Interface.1.MACAddress"] || ""
  ).toLowerCase();
  if (!gatewayMAC) {
    var serialTail = (device.serialNumber || "000000").slice(-6);
    gatewayMAC = (device.oui + serialTail).toLowerCase()
      .replace(/(.{2})(?=.)/g, "$1:").slice(0, 17);
  }

  topology.addNode({
    id: gatewayMAC,
    type: "gateway",
    managed_device_id: device.id,
    manufacturer: device.manufacturer,
    model: device.model,
    firmware: device.firmware,
    serial: device.serialNumber,
  });

  // Helper: look up the band for a Device.WiFi.AccessPoint.{i}. The
  // SSIDReference points at Device.WiFi.SSID.{j}, which has
  // LowerLayers pointing at Device.WiFi.Radio.{k}, which has
  // OperatingFrequencyBand. Falls back to "wifi_5g" when the chain
  // can't be resolved.
  function edgeTypeForAP(apIdx) {
    var ssidRef = batch.params["Device.WiFi.AccessPoint." + apIdx + ".SSIDReference"] || "";
    if (ssidRef === "") return "wifi_5g";
    // Parse SSID instance index out of "Device.WiFi.SSID.{j}".
    var m = ssidRef.match(/Device\.WiFi\.SSID\.(\d+)/);
    if (!m) return "wifi_5g";
    var ssidIdx = m[1];
    var lowerLayers = batch.params["Device.WiFi.SSID." + ssidIdx + ".LowerLayers"] || "";
    var radioMatch = lowerLayers.match(/Device\.WiFi\.Radio\.(\d+)/);
    if (!radioMatch) return "wifi_5g";
    var radioIdx = radioMatch[1];
    var band = batch.params["Device.WiFi.Radio." + radioIdx + ".OperatingFrequencyBand"] || "";
    if (band === "2.4GHz") return "wifi_2g";
    if (band === "6GHz")  return "wifi_6g";
    return "wifi_5g";
  }

  function bssidForAP(apIdx) {
    var ssidRef = batch.params["Device.WiFi.AccessPoint." + apIdx + ".SSIDReference"] || "";
    var m = ssidRef.match(/Device\.WiFi\.SSID\.(\d+)/);
    if (!m) return "";
    return (batch.params["Device.WiFi.SSID." + m[1] + ".BSSID"] || "").toLowerCase();
  }

  // ---- Step 3: flat-AP clients (Device.WiFi.AccessPoint.*.AssociatedDevice.*) ----
  // Clients here associate directly with the gateway's own radios.
  var flatStations = batch.matches(
    "Device.WiFi.AccessPoint.*.AssociatedDevice.*"
  );
  for (var i = 0; i < flatStations.length; i++) {
    var s = flatStations[i];
    var clientMAC = (s.MACAddress || "").toLowerCase();
    if (!clientMAC) continue;

    var apIdx = s.$indexes.AccessPoint;
    var hostMeta = hostByMAC[clientMAC] || {};
    topology.addNode({
      id: clientMAC,
      type: "client",
      hostname: hostMeta.hostname || undefined,
      ipv4: hostMeta.ipv4 || undefined,
      ipv6: hostMeta.ipv6 || undefined,
    });

    var bssid = bssidForAP(apIdx);
    topology.addEdge({
      parent: gatewayMAC,
      child: clientMAC,
      edge_type: edgeTypeForAP(apIdx),
      bssid: bssid || undefined,
    });

    if (s.SignalStrength !== undefined && s.SignalStrength !== "") {
      var rssi = parseFloat(s.SignalStrength);
      if (!isNaN(rssi)) {
        if (rssiEncoding === "rcpi") {
          rssi = (rssi / 2) - 110;
        }
        topology.addEdgeMetric("rssi_dbm", rssi, {
          parent: gatewayMAC,
          child: clientMAC,
        });
      }
    }
  }

  // ---- Step 4: optional MultiAP extenders + their clients ----
  // Skipped silently when the device doesn't expose MultiAP.
  var extenderByIndex = {};
  var apDevices = batch.matches("Device.WiFi.MultiAP.APDevice.*");
  for (var i = 0; i < apDevices.length; i++) {
    var ap = apDevices[i];
    var apMAC = (ap.MACAddress || "").toLowerCase();
    if (!apMAC) continue;
    extenderByIndex[ap.$indexes.APDevice] = apMAC;

    topology.addNode({
      id: apMAC,
      type: "extender",
      manufacturer: ap.Manufacturer || undefined,
      model: ap.ModelName || undefined,
      firmware: ap.SoftwareVersion || undefined,
      serial: ap.SerialNumber || undefined,
      synced: "true",
    });

    topology.addEdge({
      parent: gatewayMAC,
      child: apMAC,
      edge_type: "wifi_backhaul",
    });
  }

  var meshStations = batch.matches(
    "Device.WiFi.MultiAP.APDevice.*.Radio.*.AP.*.AssociatedDevice.*"
  );
  for (var i = 0; i < meshStations.length; i++) {
    var s = meshStations[i];
    var clientMAC = (s.MACAddress || "").toLowerCase();
    if (!clientMAC) continue;

    var apIdx = s.$indexes.APDevice;
    var radioIdx = s.$indexes.Radio;
    var apEntryIdx = s.$indexes.AP;
    var parentMAC = extenderByIndex[apIdx];
    if (!parentMAC) continue;

    var bandPath = "Device.WiFi.MultiAP.APDevice." + apIdx +
      ".Radio." + radioIdx + ".OperatingFrequencyBand";
    var band = batch.params[bandPath] || "";
    var meshEdgeType = "wifi_5g";
    if (band === "2.4GHz") meshEdgeType = "wifi_2g";
    else if (band === "6GHz") meshEdgeType = "wifi_6g";

    var bssidPath = "Device.WiFi.MultiAP.APDevice." + apIdx +
      ".Radio." + radioIdx + ".AP." + apEntryIdx + ".BSSID";
    var meshBSSID = (batch.params[bssidPath] || "").toLowerCase();

    var hostMeta = hostByMAC[clientMAC] || {};
    topology.addNode({
      id: clientMAC,
      type: "client",
      hostname: hostMeta.hostname || undefined,
      ipv4: hostMeta.ipv4 || undefined,
      ipv6: hostMeta.ipv6 || undefined,
    });

    topology.addEdge({
      parent: parentMAC,
      child: clientMAC,
      edge_type: meshEdgeType,
      bssid: meshBSSID || undefined,
    });

    if (s.SignalStrength !== undefined && s.SignalStrength !== "") {
      var rssi = parseFloat(s.SignalStrength);
      if (!isNaN(rssi)) {
        if (rssiEncoding === "rcpi") {
          rssi = (rssi / 2) - 110;
        }
        topology.addEdgeMetric("rssi_dbm", rssi, {
          parent: parentMAC,
          child: clientMAC,
        });
      }
    }
  }
})();
