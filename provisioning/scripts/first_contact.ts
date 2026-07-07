// Seed: First Contact — parameter discovery + initial config.
// Triggered on: first_contact (TR-069 "0 BOOTSTRAP")
//
// Uses canonical paths — the mapping profile translates to the correct
// device-native paths (TR-098/TR-181/vendor) automatically.

// Fetch device info for parameter database population.
device.fetch("canonical.device.*");

// Fetch management server config.
device.fetch("canonical.mgmt.*");

// Set up connection request credentials (deterministic per device).
const crUsername = device.oui + "-" + (device.serialNumber || "");
device.set("canonical.mgmt.connection_request_username", crUsername);
device.set("canonical.mgmt.connection_request_password", crUsername);

// Enable and configure periodic inform. PeriodicInformTime carries a
// deterministic per-device phase offset (hash of the serial spread over
// the interval) so a fleet's informs land uniformly instead of pulsing
// together: after an ISP-wide outage every CPE reboots at the same
// moment, and without a phase offset the whole fleet would re-inform in
// synchronized waves forever (#649). Deterministic-from-serial matters:
// re-running first_contact must not re-randomize the phase.
var informInterval = 300;
var phase = 0;
var serial = device.serialNumber || "";
for (var i = 0; i < serial.length; i++) {
  phase = (phase * 31 + serial.charCodeAt(i)) % informInterval;
}
// Per TR-069, only PeriodicInformTime's phase (time modulo interval)
// matters; the date part is arbitrary and may be in the past.
var mm = Math.floor(phase / 60);
var ss = phase % 60;
function pad2(n) { return (n < 10 ? "0" : "") + n; }
device.set("canonical.mgmt.periodic_inform_enable", true);
device.set("canonical.mgmt.periodic_inform_interval", informInterval);
device.set(
  "canonical.mgmt.periodic_inform_time",
  "2001-01-01T00:" + pad2(mm) + ":" + pad2(ss) + "Z"
);

// Tag the device as discovered.
device.addTag("discovered");
device.removeTag("undiscovered");

provision.log("first contact complete for " + (device.serialNumber || "(unknown)"));
