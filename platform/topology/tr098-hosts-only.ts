// tr098-hosts-only.ts — flat topology for TR-098-only devices.
//
// No extender hierarchy (TR-098 doesn't carry one without vendor
// extensions). Emits a single gateway node + every Hosts.Host as a
// client connected directly to it. The edge_type defaults to "wifi_5g"
// because TR-098 doesn't reliably expose the radio band per host —
// operators wanting per-radio fidelity bind a vendor-specific script
// that walks WLANConfiguration.{i}.AssociatedDevice.* instead.

(function () {
  const includeInactive: boolean = ctx.configGet<boolean>("includeInactiveHosts", false);

  // Gateway = the device itself. Use the device's reported LAN MAC.
  const gatewayMAC = (
    batch.params["InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1.MACAddress"]
    || ""
  ).toLowerCase();

  if (!gatewayMAC) {
    enrichment.warn("tr098-hosts-only: no gateway MAC found in LANEthernetInterfaceConfig.1");
    return;
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

  const hosts = batch.matches("InternetGatewayDevice.LANDevice.1.Hosts.Host.*");
  for (let i = 0; i < hosts.length; i++) {
    const h = hosts[i];
    const mac = ((h.MACAddress as string | undefined) || "").toLowerCase();
    if (!mac) continue;
    if (!includeInactive && (h.Active as string | undefined) === "false") continue;

    topology.addNode({
      id: mac,
      type: "client",
      hostname: (h.HostName as string | undefined) || undefined,
      ipv4: (h.IPAddress as string | undefined) || undefined,
    });

    // Determine edge_type from Layer1Interface if present
    // (e.g. "InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1"
    //  → ethernet; WLANConfiguration → wifi_5g default).
    let edgeType: "wifi_5g" | "ethernet" = "wifi_5g";
    const layer1 = (h.Layer1Interface as string | undefined) || "";
    if (layer1.indexOf("LANEthernetInterfaceConfig") >= 0) {
      edgeType = "ethernet";
    }

    topology.addEdge({
      parent: gatewayMAC,
      child: mac,
      edge_type: edgeType,
    });
  }
})();
