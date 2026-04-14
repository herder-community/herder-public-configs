// Seed: First Contact — parameter discovery + initial config.
// Triggered on: first_contact (TR-069 "0 BOOTSTRAP")
//
// Uses canonical paths — the mapping profile translates to the correct
// device-native paths (TR-098/TR-181/vendor) automatically.

// Fetch device info for parameter database population.
var info = device.fetch("canonical.device.*");

// Fetch management server config.
var mgmt = device.fetch("canonical.mgmt.*");

// Set up connection request credentials (deterministic per device).
var crUsername = device.oui + "-" + device.serial;
device.set("canonical.mgmt.connection_request_username", crUsername);
device.set("canonical.mgmt.connection_request_password", crUsername);

// Enable and configure periodic inform.
device.set("canonical.mgmt.periodic_inform_enable", true);
device.set("canonical.mgmt.periodic_inform_interval", 300);

// Tag the device as discovered.
device.addTag("discovered");
device.removeTag("undiscovered");

provision.log("first contact complete for " + device.serial);
