// Seed: Periodic - refresh key parameters and enforce management config.
// Triggered on: periodic (TR-069 "2 PERIODIC")
//
// Refreshes firmware/hardware versions and WAN IP for tracking.
// Enforces connection request credentials and periodic inform settings.

// Refresh device info for firmware/hardware tracking.
var firmware = device.fetch("Device.DeviceInfo.SoftwareVersion");
var hardware = device.fetch("Device.DeviceInfo.HardwareVersion");

// Refresh WAN IP for connectivity tracking (multi-level wildcard).
var wanIP = device.fetch("Device.WANDevice.*.WANConnectionDevice.*.WANIPConnection.*.ExternalIPAddress");

// Enforce connection request credentials.
var crUsername = device.oui + "-" + device.serial;
device.set("Device.ManagementServer.ConnectionRequestUsername", crUsername);
device.set("Device.ManagementServer.ConnectionRequestPassword", crUsername);

// Enforce periodic inform config.
device.set("Device.ManagementServer.PeriodicInformEnable", true);
device.set("Device.ManagementServer.PeriodicInformInterval", 300);

provision.log("periodic refresh complete, firmware: " + firmware);
