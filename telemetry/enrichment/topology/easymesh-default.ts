// easymesh-default.ts — TR-181 wifi topology emit (flat AP + optional MultiAP).
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
  const rssiEncoding: string = ctx.configGet<string>("rssiEncoding", "dbm");
  const includeInactive: boolean = ctx.configGet<boolean>("includeInactiveHosts", false);

  // ---- Step 1: host metadata by MAC ----
  interface HostMeta { hostname: string; ipv4: string; ipv6: string; }
  const hostByMAC: Record<string, HostMeta> = {};
  const hosts = batch.matches("Device.Hosts.Host.*");
  for (let i = 0; i < hosts.length; i++) {
    const h = hosts[i];
    const physAddr = (h.PhysAddress as string | undefined) || "";
    const mac = physAddr.toLowerCase();
    if (!mac) continue;
    if (!includeInactive && (h.Active as string | undefined) === "false") continue;

    const v6List = batch.matches(
      "Device.Hosts.Host." + h.$indexes.Host + ".IPv6Address.*.IPAddress",
    );
    const v6 = v6List.map(function (e) { return (e.IPAddress as string | undefined) || ""; }).join(",");

    hostByMAC[mac] = {
      hostname: (h.HostName as string | undefined) || "",
      ipv4: (h.IPAddress as string | undefined) || "",
      ipv6: v6,
    };
  }

  // ---- Step 2: gateway = the managed CPE itself ----
  let gatewayMAC = (
    batch.params["Device.Ethernet.Interface.1.MACAddress"] || ""
  ).toLowerCase();
  if (!gatewayMAC) {
    const serialTail = (device.serialNumber || "000000").slice(-6);
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
  type WifiEdgeType = "wifi_2g" | "wifi_5g" | "wifi_6g";
  function edgeTypeForAP(apIdx: string): WifiEdgeType {
    const ssidRef = batch.params["Device.WiFi.AccessPoint." + apIdx + ".SSIDReference"] || "";
    if (ssidRef === "") return "wifi_5g";
    const m = ssidRef.match(/Device\.WiFi\.SSID\.(\d+)/);
    if (!m) return "wifi_5g";
    const ssidIdx = m[1];
    const lowerLayers = batch.params["Device.WiFi.SSID." + ssidIdx + ".LowerLayers"] || "";
    const radioMatch = lowerLayers.match(/Device\.WiFi\.Radio\.(\d+)/);
    if (!radioMatch) return "wifi_5g";
    const radioIdx = radioMatch[1];
    const band = batch.params["Device.WiFi.Radio." + radioIdx + ".OperatingFrequencyBand"] || "";
    if (band === "2.4GHz") return "wifi_2g";
    if (band === "6GHz") return "wifi_6g";
    return "wifi_5g";
  }

  function bssidForAP(apIdx: string): string {
    const ssidRef = batch.params["Device.WiFi.AccessPoint." + apIdx + ".SSIDReference"] || "";
    const m = ssidRef.match(/Device\.WiFi\.SSID\.(\d+)/);
    if (!m) return "";
    return (batch.params["Device.WiFi.SSID." + m[1] + ".BSSID"] || "").toLowerCase();
  }

  // ---- Step 3: flat-AP clients (Device.WiFi.AccessPoint.*.AssociatedDevice.*) ----
  // Clients here associate directly with the gateway's own radios.
  const flatStations = batch.matches(
    "Device.WiFi.AccessPoint.*.AssociatedDevice.*",
  );
  for (let i = 0; i < flatStations.length; i++) {
    const s = flatStations[i];
    const clientMAC = ((s.MACAddress as string | undefined) || "").toLowerCase();
    if (!clientMAC) continue;

    const apIdx = s.$indexes.AccessPoint;
    const hostMeta = hostByMAC[clientMAC];
    topology.addNode({
      id: clientMAC,
      type: "client",
      hostname: hostMeta ? hostMeta.hostname : undefined,
      ipv4: hostMeta ? hostMeta.ipv4 : undefined,
      ipv6: hostMeta ? hostMeta.ipv6 : undefined,
    });

    const bssid = bssidForAP(apIdx);
    topology.addEdge({
      parent: gatewayMAC,
      child: clientMAC,
      edge_type: edgeTypeForAP(apIdx),
      bssid: bssid || undefined,
    });

    const sigStr = s.SignalStrength as string | undefined;
    if (sigStr !== undefined && sigStr !== "") {
      let rssi = parseFloat(sigStr);
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
  const extenderByIndex: Record<string, string> = {};
  const apDevices = batch.matches("Device.WiFi.MultiAP.APDevice.*");
  for (let i = 0; i < apDevices.length; i++) {
    const ap = apDevices[i];
    const apMAC = ((ap.MACAddress as string | undefined) || "").toLowerCase();
    if (!apMAC) continue;
    extenderByIndex[ap.$indexes.APDevice] = apMAC;

    topology.addNode({
      id: apMAC,
      type: "extender",
      manufacturer: (ap.Manufacturer as string | undefined) || undefined,
      model: (ap.ModelName as string | undefined) || undefined,
      firmware: (ap.SoftwareVersion as string | undefined) || undefined,
      serial: (ap.SerialNumber as string | undefined) || undefined,
      synced: true,
    });

    topology.addEdge({
      parent: gatewayMAC,
      child: apMAC,
      edge_type: "wifi_backhaul",
    });
  }

  const meshStations = batch.matches(
    "Device.WiFi.MultiAP.APDevice.*.Radio.*.AP.*.AssociatedDevice.*",
  );
  for (let i = 0; i < meshStations.length; i++) {
    const s = meshStations[i];
    const clientMAC = ((s.MACAddress as string | undefined) || "").toLowerCase();
    if (!clientMAC) continue;

    const apIdx = s.$indexes.APDevice;
    const radioIdx = s.$indexes.Radio;
    const apEntryIdx = s.$indexes.AP;
    const parentMAC = extenderByIndex[apIdx];
    if (!parentMAC) continue;

    const bandPath = "Device.WiFi.MultiAP.APDevice." + apIdx +
      ".Radio." + radioIdx + ".OperatingFrequencyBand";
    const band = batch.params[bandPath] || "";
    let meshEdgeType: WifiEdgeType = "wifi_5g";
    if (band === "2.4GHz") meshEdgeType = "wifi_2g";
    else if (band === "6GHz") meshEdgeType = "wifi_6g";

    const bssidPath = "Device.WiFi.MultiAP.APDevice." + apIdx +
      ".Radio." + radioIdx + ".AP." + apEntryIdx + ".BSSID";
    const meshBSSID = (batch.params[bssidPath] || "").toLowerCase();

    const hostMeta = hostByMAC[clientMAC];
    topology.addNode({
      id: clientMAC,
      type: "client",
      hostname: hostMeta ? hostMeta.hostname : undefined,
      ipv4: hostMeta ? hostMeta.ipv4 : undefined,
      ipv6: hostMeta ? hostMeta.ipv6 : undefined,
    });

    topology.addEdge({
      parent: parentMAC,
      child: clientMAC,
      edge_type: meshEdgeType,
      bssid: meshBSSID || undefined,
    });

    const sigStr = s.SignalStrength as string | undefined;
    if (sigStr !== undefined && sigStr !== "") {
      let rssi = parseFloat(sigStr);
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
