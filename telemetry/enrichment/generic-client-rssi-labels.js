// Generic per-client WiFi label enrichment.
//
// Same shape as arris-client-rssi-labels.js but walks only standard
// TR-098 / TR-181 paths — no vendor X_OUI_* extensions — so it works
// against any conforming CPE (lab simulators, and any baseline
// firmware that hasn't had a vendor profile written yet).
//
// Sections:
//   1. TR-181 gateway-attached clients via Device.WiFi.AccessPoint.*.AssociatedDevice.*
//   2. TR-098 gateway-attached clients via InternetGatewayDevice.LANDevice.*.WLANConfiguration.*.AssociatedDevice.*
//
// Both sections correlate against Hosts.Host for hostname/IP enrichment
// and use AP/WLAN index → band lookup tables (no vendor field for
// per-radio band on a synthetic CPE).
//
// Emitted metrics:
//   wifi.client.rssi   — SignalStrength (dBm)
//   wifi.client.tx_rate — LastDataDownlinkRate (TR-181) or LastDataTransmitRate (TR-098)
//   wifi.client.rx_rate — LastDataUplinkRate (TR-181 only)
//
// Labels: client_mac, hostname, via, band, ap_idx (TR-181) or wlan_idx (TR-098)

// AP/WLAN index → band fallback. Tweak per CPE if the natural index→band
// mapping differs (this profile assumes 1=2.4GHz main, 2=2.4GHz guest,
// 3=5GHz main, 4=5GHz guest, matching the cpe-labs example profiles).
var AP_BAND_FALLBACK = { "1": "2.4GHz", "2": "2.4GHz", "3": "5GHz", "4": "5GHz" };

function normaliseMac(s) {
    if (typeof s !== "string") return null;
    return s.toLowerCase().replace(/-/g, ":");
}

function toInt(s) {
    var n = parseInt(s, 10);
    return isNaN(n) ? null : n;
}

function resolveBand(idx) {
    return AP_BAND_FALLBACK[idx] || "unknown";
}

// --- Lookup tables built once per invocation ----------------------------

// MAC → {hostname, ip} from TR-181 Hosts.Host or TR-098
// LANDevice.1.Hosts.Host (whichever the CPE populates).
var hostByMac = {};
var hostsTR181 = batch.matches("Device.Hosts.Host.*");
for (var hi = 0; hi < hostsTR181.length; hi++) {
    var h = hostsTR181[hi];
    var hmac = normaliseMac(h.PhysAddress);
    if (!hmac) continue;
    hostByMac[hmac] = {
        hostname: h.HostName || null,
        ip: h.IPAddress || null
    };
}
var hostsTR098 = batch.matches("InternetGatewayDevice.LANDevice.*.Hosts.Host.*");
for (var hi2 = 0; hi2 < hostsTR098.length; hi2++) {
    var h2 = hostsTR098[hi2];
    var hmac2 = normaliseMac(h2.MACAddress);
    if (!hmac2) continue;
    if (!hostByMac[hmac2]) {
        hostByMac[hmac2] = {
            hostname: h2.HostName || null,
            ip: h2.IPAddress || null
        };
    }
}

// --- 1. TR-181 gateway-attached clients ---------------------------------
var tr181Clients = batch.matches("Device.WiFi.AccessPoint.*.AssociatedDevice.*");
for (var ci = 0; ci < tr181Clients.length; ci++) {
    var c = tr181Clients[ci];
    var mac = normaliseMac(c.MACAddress);
    if (!mac) continue;
    var apIdx = c.$indexes.AccessPoint;
    var host = hostByMac[mac] || {};
    var labels = {
        client_mac: mac,
        hostname: host.hostname,
        via: "gateway",
        band: resolveBand(apIdx),
        ap_idx: apIdx
    };
    if (c.SignalStrength !== undefined && c.SignalStrength !== "") {
        emit("wifi.client.rssi", toInt(c.SignalStrength), labels);
    }
    if (c.LastDataDownlinkRate !== undefined && c.LastDataDownlinkRate !== "") {
        emit("wifi.client.tx_rate", toInt(c.LastDataDownlinkRate), labels);
    }
    if (c.LastDataUplinkRate !== undefined && c.LastDataUplinkRate !== "") {
        emit("wifi.client.rx_rate", toInt(c.LastDataUplinkRate), labels);
    }
}

// --- 2. TR-098 gateway-attached clients ---------------------------------
var tr098Clients = batch.matches(
    "InternetGatewayDevice.LANDevice.*.WLANConfiguration.*.AssociatedDevice.*"
);
for (var ti = 0; ti < tr098Clients.length; ti++) {
    var t = tr098Clients[ti];
    var tmac = normaliseMac(t.AssociatedDeviceMACAddress);
    if (!tmac) continue;
    var wlanIdx = t.$indexes.WLANConfiguration;
    var thost = hostByMac[tmac] || {};
    var tlabels = {
        client_mac: tmac,
        hostname: thost.hostname,
        via: "gateway",
        band: resolveBand(wlanIdx),
        wlan_idx: wlanIdx
    };
    if (t.SignalStrength !== undefined && t.SignalStrength !== "") {
        emit("wifi.client.rssi", toInt(t.SignalStrength), tlabels);
    }
    if (t.LastDataTransmitRate !== undefined && t.LastDataTransmitRate !== "") {
        emit("wifi.client.tx_rate", toInt(t.LastDataTransmitRate), tlabels);
    }
}
