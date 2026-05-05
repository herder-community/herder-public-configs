// arris-hnc.js — topology emit for Arris NVG578LX-class devices.
//
// Walks the X_0000C5_Wireless.HNC.HNE vendor-extension tree:
//   HNE.1 = gateway (Type=="Gateway")
//   HNE.2+ = paired extenders
// Identifies backhaul SSIDs by matching ctx.config.backhaulSsidMatch
// (default "^bh") against the SSID name. Cross-refs Hosts.Host by MAC
// for client metadata.
//
// Demonstrates how proprietary path semantics encode into the standard
// emit shape — every emit goes through topology.add* helpers so the
// labels stay schema-correct.

(function () {
  var backhaulPattern = ctx.configGet("backhaulSsidMatch", "^bh");
  var rssiEncoding = ctx.configGet("rssiEncoding", "dbm");
  var includeInactive = ctx.configGet("includeInactiveHosts", false);

  var backhaulRe = new RegExp(backhaulPattern);

  // Step 1: host metadata by MAC for client emit cross-ref.
  var hostByMAC = {};
  var hosts = batch.matches("InternetGatewayDevice.LANDevice.1.Hosts.Host.*");
  for (var i = 0; i < hosts.length; i++) {
    var h = hosts[i];
    var mac = (h.MACAddress || "").toLowerCase();
    if (!mac) continue;
    if (!includeInactive && h.Active === "false") continue;
    hostByMAC[mac] = {
      hostname: h.HostName || "",
      ipv4: h.IPAddress || "",
    };
  }

  // Step 2: walk HNE entries → mesh nodes.
  var hnes = batch.matches("InternetGatewayDevice.LANDevice.1.X_0000C5_Wireless.HNC.HNE.*");
  if (hnes.length === 0) {
    enrichment.warn("arris-hnc: no X_0000C5_Wireless.HNC.HNE entries found");
    return;
  }

  // gatewayMAC = the HNE entry with Type=="Gateway".
  var gatewayMAC = null;
  var nodeByHNEIndex = {};
  for (var i = 0; i < hnes.length; i++) {
    var n = hnes[i];
    var nodeMAC = (n.MACAddress || "").toLowerCase();
    if (!nodeMAC) continue;
    nodeByHNEIndex[n.$indexes.HNE] = nodeMAC;
    if (n.Type === "Gateway") {
      gatewayMAC = nodeMAC;
    }
  }

  if (!gatewayMAC) {
    enrichment.warn("arris-hnc: no HNE entry with Type=='Gateway'");
    return;
  }

  for (var i = 0; i < hnes.length; i++) {
    var n = hnes[i];
    var nodeMAC = (n.MACAddress || "").toLowerCase();
    if (!nodeMAC) continue;
    var nodeType = nodeMAC === gatewayMAC ? "gateway" : "extender";

    topology.addNode({
      id: nodeMAC,
      type: nodeType,
      managed_device_id: nodeType === "gateway" ? device.id : undefined,
      manufacturer: device.manufacturer,
      model: n.Model || undefined,
      firmware: n.SoftwareVersion || undefined,
      synced: nodeType === "extender" ? "true" : undefined,
    });

    // Backhaul edge to gateway: in the Arris tree, extenders link
    // back to the gateway via the SSID matching backhaulPattern. For
    // simplicity v1 always parents extenders to the gateway (no
    // multi-hop mesh modeling) — operators with chained meshes
    // override this script.
    if (nodeType === "extender") {
      topology.addEdge({
        parent: gatewayMAC,
        child: nodeMAC,
        edge_type: "wifi_backhaul",
      });
    }
  }

  // Step 3: clients per HNE.{i}.Radio.{j}.SSID.{k}.STA.{l}. Skip
  // backhaul-SSID stations — they're inter-node links, not clients.
  var stations = batch.matches(
    "InternetGatewayDevice.LANDevice.1.X_0000C5_Wireless.HNC.HNE.*.Radio.*.SSID.*.STA.*"
  );
  for (var i = 0; i < stations.length; i++) {
    var s = stations[i];
    var clientMAC = (s.MACAddress || "").toLowerCase();
    if (!clientMAC) continue;

    // Look up the SSID name for the parent SSID — skip backhaul.
    var ssidNamePath = "InternetGatewayDevice.LANDevice.1.X_0000C5_Wireless.HNC.HNE." +
      s.$indexes.HNE + ".Radio." + s.$indexes.Radio + ".SSID." + s.$indexes.SSID + ".SSID";
    var ssidName = batch.params[ssidNamePath] || "";
    if (backhaulRe.test(ssidName)) {
      continue;
    }

    var parentMAC = nodeByHNEIndex[s.$indexes.HNE];
    if (!parentMAC) continue;

    var hostMeta = hostByMAC[clientMAC] || {};
    topology.addNode({
      id: clientMAC,
      type: "client",
      hostname: hostMeta.hostname || undefined,
      ipv4: hostMeta.ipv4 || undefined,
    });

    // Determine edge_type from radio band.
    var bandPath = "InternetGatewayDevice.LANDevice.1.X_0000C5_Wireless.HNC.HNE." +
      s.$indexes.HNE + ".Radio." + s.$indexes.Radio + ".OperatingFrequencyBand";
    var band = batch.params[bandPath] || "";
    var edgeType = "wifi_5g";
    if (band === "2.4GHz") edgeType = "wifi_2g";
    else if (band === "6GHz") edgeType = "wifi_6g";

    topology.addEdge({
      parent: parentMAC,
      child: clientMAC,
      edge_type: edgeType,
    });

    // Per-edge RSSI metric.
    if (s.RSSI !== undefined && s.RSSI !== "") {
      var rssi = parseFloat(s.RSSI);
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
