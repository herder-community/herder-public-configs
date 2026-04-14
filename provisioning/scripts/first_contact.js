// Seed: First Contact — full parameter discovery + initial config.
// Triggered on: first_contact (TR-069 "0 BOOTSTRAP")
//
// Fetches the device info and management server subtrees to populate
// the parameter database. Sets up connection request credentials and
// enables periodic inform with a default interval.
//
// Supports both TR-181 (Device.) and TR-098 (InternetGatewayDevice.) devices.
// Detection: check if a TR-098 parameter exists from the Inform data.

var root = "Device.";
var igdTest = device.get("InternetGatewayDevice.DeviceInfo.Manufacturer");
if (igdTest) {
  root = "InternetGatewayDevice.";
}

// Fetch full device info subtree for parameter database population.
var info = device.fetch(root + "DeviceInfo.*");

// Fetch management server config.
var mgmt = device.fetch(root + "ManagementServer.*");

// Set up connection request credentials (deterministic per device).
var crUsername = device.oui + "-" + device.serial;
device.set(root + "ManagementServer.ConnectionRequestUsername", crUsername);
device.set(root + "ManagementServer.ConnectionRequestPassword", crUsername);

// Enable and configure periodic inform.
device.set(root + "ManagementServer.PeriodicInformEnable", true);
device.set(root + "ManagementServer.PeriodicInformInterval", 300);

// Tag the device as discovered.
device.addTag("discovered");
device.removeTag("undiscovered");

provision.log("first contact discovery complete for " + device.serial + " (root: " + root + ")");
