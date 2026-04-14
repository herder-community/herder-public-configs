// Seed: Boot — refresh parameters, enforce config, track boot events.
// Triggered on: boot (TR-069 "1 BOOT")
//
// Runs on device reboot. Refreshes device info (firmware may have
// changed after reboot), enforces management config, and tags the
// device as recently booted for operator tracking.
//
// Supports both TR-181 (Device.) and TR-098 (InternetGatewayDevice.) devices.

var root = "Device.";
var igdTest = device.get("InternetGatewayDevice.DeviceInfo.Manufacturer");
if (igdTest) {
  root = "InternetGatewayDevice.";
}

// Refresh device info (firmware may have changed after reboot).
var firmware = device.fetch(root + "DeviceInfo.SoftwareVersion");
var hardware = device.fetch(root + "DeviceInfo.HardwareVersion");

// Enforce connection request credentials.
var crUsername = device.oui + "-" + device.serial;
device.set(root + "ManagementServer.ConnectionRequestUsername", crUsername);
device.set(root + "ManagementServer.ConnectionRequestPassword", crUsername);

// Enforce periodic inform config.
device.set(root + "ManagementServer.PeriodicInformEnable", true);
device.set(root + "ManagementServer.PeriodicInformInterval", 300);

// Tag device as recently booted (operators can track reboots).
device.addTag("boot-seen");

provision.log("boot check complete, firmware: " + firmware);
