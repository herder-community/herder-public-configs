// Seed: First Contact - full parameter discovery + initial config.
// Triggered on: first_contact (TR-069 "0 BOOTSTRAP")
//
// Fetches the device info and management server subtrees to populate
// the parameter database. Sets up connection request credentials and
// enables periodic inform with a default interval.

// Fetch full device info subtree for parameter database population.
var info = device.fetch("Device.DeviceInfo.*");

// Fetch management server config.
var mgmt = device.fetch("Device.ManagementServer.*");

// Set up connection request credentials (deterministic per device).
var crUsername = device.oui + "-" + device.serial;
device.set("Device.ManagementServer.ConnectionRequestUsername", crUsername);
device.set("Device.ManagementServer.ConnectionRequestPassword", crUsername);

// Enable and configure periodic inform.
device.set("Device.ManagementServer.PeriodicInformEnable", true);
device.set("Device.ManagementServer.PeriodicInformInterval", 300);

// Tag the device as discovered.
device.addTag("discovered");
device.removeTag("undiscovered");

provision.log("first contact discovery complete for " + device.serial);
