// Seed: Boot - refresh parameters, enforce config, track boot events.
// Triggered on: boot (TR-069 "1 BOOT")
//
// Runs on device reboot. Refreshes device info (firmware may have
// changed after reboot), enforces management config, and tags the
// device as recently booted for operator tracking.

// Refresh device info (firmware may have changed after reboot).
var firmware = device.fetch("Device.DeviceInfo.SoftwareVersion");
var hardware = device.fetch("Device.DeviceInfo.HardwareVersion");

// Enforce connection request credentials.
var crUsername = device.oui + "-" + device.serial;
device.set("Device.ManagementServer.ConnectionRequestUsername", crUsername);
device.set("Device.ManagementServer.ConnectionRequestPassword", crUsername);

// Enforce periodic inform config.
device.set("Device.ManagementServer.PeriodicInformEnable", true);
device.set("Device.ManagementServer.PeriodicInformInterval", 300);

// Tag device as recently booted (operators can track reboots).
device.addTag("boot-seen");

provision.log("boot check complete, firmware: " + firmware);
