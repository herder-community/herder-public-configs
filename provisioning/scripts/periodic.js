// Seed: Periodic — refresh key parameters and enforce management config.
// Triggered on: periodic (TR-069 "2 PERIODIC")
//
// Uses canonical paths — the mapping profile translates to the correct
// device-native paths (TR-098/TR-181/vendor) automatically.

// Refresh device info for firmware/hardware tracking.
var firmware = device.fetch("canonical.device.software_version");
var hardware = device.fetch("canonical.device.hardware_version");

// Fetch LAN Ethernet interface stats for telemetry recording.
// Interim: until the telemetry session phase lands, scripts fetch
// telemetry-tracked params explicitly. See Telemetry Pipeline epic.
device.fetch("InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1.Stats.BytesSent");
device.fetch("InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1.Stats.BytesReceived");
device.fetch("InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1.Stats.PacketsSent");
device.fetch("InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1.Stats.PacketsReceived");
device.fetch("InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1.Stats.ErrorsSent");
device.fetch("InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1.Stats.ErrorsReceived");

// Enforce connection request credentials.
var crUsername = device.oui + "-" + device.serial;
device.set("canonical.mgmt.connection_request_username", crUsername);
device.set("canonical.mgmt.connection_request_password", crUsername);

// Enforce periodic inform config.
device.set("canonical.mgmt.periodic_inform_enable", true);
device.set("canonical.mgmt.periodic_inform_interval", 300);

provision.log("periodic refresh complete, firmware: " + firmware);
