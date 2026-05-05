// easymesh-default.js — TR-181 / EasyMesh DataElements topology emit.
//
// Walks Device.WiFi.DataElements.Network.Device.{i}.* for nodes,
// dereferences MultiAPDevice.Backhaul.BackhaulDeviceID for parent
// links, walks Radio.{j}.BSS.{k}.STA.{l} for clients, cross-refs
// Device.Hosts.Host.* for hostname / IPv4 / IPv6.
//
// All emit calls go through the topology helpers (topology.addNode / topology.addEdge
// / topology.addEdgeMetric) so the runtime stamps snapshot_id automatically
// and the labels stay schema-correct.

(function () {
  var rssiEncoding = ctx.configGet("rssiEncoding", "rcpi");
  var includeInactive = ctx.configGet("includeInactiveHosts", false);

  // Step 1: collect host metadata by MAC.
  // Comma-joined IPv4/IPv6 lists per #490 §1 — clients commonly
  // carry link-local + SLAAC + privacy v6 addresses.
  var hostByMAC = {};
  var hosts = batch.matches("Device.Hosts.Host.*");
  for (var i = 0; i < hosts.length; i++) {
    var h = hosts[i];
    var mac = (h.PhysAddress || "").toLowerCase();
    if (!mac) continue;
    if (!includeInactive && h.Active === "false") continue;

    var v4 = h.IPAddress || "";
    var v6List = batch.matches(
      "Device.Hosts.Host." + h.$indexes.Host + ".IPv6Address.*.IPAddress"
    );
    var v6 = v6List.map(function (e) { return e.IPAddress; }).join(",");

    hostByMAC[mac] = {
      hostname: h.HostName || "",
      ipv4: v4,
      ipv6: v6,
    };
  }

  // Step 2: collect mesh nodes. Each Device entry is a gateway or
  // extender; the very first one (i==1 typically, but identified by
  // having no Backhaul parent) is the gateway.
  var meshNodes = batch.matches("Device.WiFi.DataElements.Network.Device.*");
  if (meshNodes.length === 0) {
    enrichment.warn("easymesh-default: no DataElements.Network.Device entries found");
    return;
  }

  // First pass: identify gateway = node with no BackhaulDeviceID.
  var nodeIDs = {};
  var gatewayMAC = null;
  for (var i = 0; i < meshNodes.length; i++) {
    var n = meshNodes[i];
    var nodeMAC = (n.ID || "").toLowerCase();
    if (!nodeMAC) continue;
    nodeIDs[n.$indexes.Device] = nodeMAC;
    var hasParent = n["MultiAPDevice.Backhaul.BackhaulDeviceID"];
    if (!hasParent || hasParent === "") {
      gatewayMAC = nodeMAC;
    }
  }

  // Second pass: emit nodes.
  for (var i = 0; i < meshNodes.length; i++) {
    var n = meshNodes[i];
    var nodeMAC = (n.ID || "").toLowerCase();
    if (!nodeMAC) continue;
    var nodeType = nodeMAC === gatewayMAC ? "gateway" : "extender";
    topology.addNode({
      id: nodeMAC,
      type: nodeType,
      managed_device_id: nodeType === "gateway" ? device.id : undefined,
      manufacturer: n.ManufacturerOUI || device.manufacturer,
      synced: nodeType === "extender" ? "true" : undefined,
    });

    // Backhaul edge to parent.
    if (nodeType === "extender") {
      var parentMAC = (n["MultiAPDevice.Backhaul.BackhaulDeviceID"] || "").toLowerCase();
      if (parentMAC) {
        topology.addEdge({
          parent: parentMAC,
          child: nodeMAC,
          edge_type: "wifi_backhaul",
        });
      }
    }
  }

  // Step 3: clients per Radio.{j}.BSS.{k}.STA.{l} on each mesh node.
  var stations = batch.matches(
    "Device.WiFi.DataElements.Network.Device.*.Radio.*.BSS.*.STA.*"
  );
  for (var i = 0; i < stations.length; i++) {
    var s = stations[i];
    var clientMAC = (s.MACAddress || "").toLowerCase();
    if (!clientMAC) continue;
    var parentDevIdx = s.$indexes.Device;
    var parentMAC = nodeIDs[parentDevIdx];
    if (!parentMAC) continue;

    var hostMeta = hostByMAC[clientMAC] || {};
    topology.addNode({
      id: clientMAC,
      type: "client",
      hostname: hostMeta.hostname || undefined,
      ipv4: hostMeta.ipv4 || undefined,
      ipv6: hostMeta.ipv6 || undefined,
    });

    // Edge type from radio's OperatingFrequencyBand if present;
    // default to "wifi_5g" since this script's clients are mesh-side.
    var edgeType = "wifi_5g";
    var bandPath = "Device.WiFi.DataElements.Network.Device." + parentDevIdx +
      ".Radio." + s.$indexes.Radio + ".OperatingFrequencyBand";
    var band = batch.params[bandPath];
    if (band === "2.4GHz") edgeType = "wifi_2g";
    else if (band === "6GHz") edgeType = "wifi_6g";

    var bssidPath = "Device.WiFi.DataElements.Network.Device." + parentDevIdx +
      ".Radio." + s.$indexes.Radio + ".BSS." + s.$indexes.BSS + ".BSSID";
    var bssid = (batch.params[bssidPath] || "").toLowerCase();

    topology.addEdge({
      parent: parentMAC,
      child: clientMAC,
      edge_type: edgeType,
      bssid: bssid || undefined,
    });

    // Per-edge link metric: SignalStrength (RCPI or dBm based on config).
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
