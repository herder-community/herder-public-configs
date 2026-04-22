// Arris TR-098 per-client WiFi label enrichment.
//
// Input (via the enrichment SDK globals):
//   batch.params                — flat path→value map of this Inform
//   batch.matches(pattern)      — wildcard iterator, entries expose leaf
//                                 fields as flat dotted-key properties
//                                 plus $indexes with wildcard captures
//   device.{oui,serialNumber,manufacturer,model,tags,...}
//   emit(metric, value, labels) — queue a labeled row
//   enrichment.warn / .error    — diagnostics
//
// Output: one emit() per observed WiFi client, tagged with client_mac +
// hostname + band + via-extender so per-client time-series queries work
// across STA index drift.
//
// Arris-specific index semantics — operator-maintained lookup tables.
// Per-firmware knowledge lives HERE, never in Go.
var WLAN_BAND = { "2": "2.4GHz", "5": "5GHz", "8": "6GHz-backhaul" };
var HNE_VIA = { "1": "gateway", "2": "extender_2", "3": "extender_3" };
var HNE_RADIO_BAND = { "1": "5GHz", "2": "2.4GHz", "3": "6GHz-backhaul" };

function normaliseMac(s) {
    if (typeof s !== "string") return null;
    return s.toLowerCase().replace(/-/g, ":");
}

function toInt(s) {
    var n = parseInt(s, 10);
    return isNaN(n) ? null : n;
}

// --- 1. Build MAC → {hostname,ip} lookup from Hosts.Host table.
var hostByMac = {};
var hosts = batch.matches("InternetGatewayDevice.LANDevice.1.Hosts.Host.*");
for (var i = 0; i < hosts.length; i++) {
    var h = hosts[i];
    var mac = normaliseMac(h.MACAddress);
    if (mac) {
        hostByMac[mac] = {
            hostname: h.HostName || null,
            ip: h.IPAddress || null
        };
    }
}

// --- 2. Gateway-attached WiFi clients (WLANConfiguration.AssociatedDevice).
//    Arris extends the standard AssociatedDevice with X_0000C5_RSSI and
//    X_0000C5_SignalStrength fields.
var gwClients = batch.matches(
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.*.AssociatedDevice.*"
);
for (var j = 0; j < gwClients.length; j++) {
    var ad = gwClients[j];
    var mac = normaliseMac(ad.AssociatedDeviceMACAddress);
    if (!mac) continue;
    var wlanIdx = ad.$indexes.WLANConfiguration;
    var host = hostByMac[mac] || {};
    var labels = {
        client_mac: mac,
        hostname: host.hostname,
        via: "gateway",
        band: WLAN_BAND[wlanIdx] || "unknown",
        wlan_idx: wlanIdx
    };
    if (ad.X_0000C5_RSSI !== undefined && ad.X_0000C5_RSSI !== "") {
        emit("wifi.client.rssi", toInt(ad.X_0000C5_RSSI), labels);
    }
    if (ad.X_0000C5_SignalStrength !== undefined && ad.X_0000C5_SignalStrength !== "") {
        emit("wifi.client.signal", toInt(ad.X_0000C5_SignalStrength), labels);
    }
}

// --- 3. Extender-attached WiFi clients (X_0000C5_Wireless.HNC.HNE tree).
//    STA instances live under HNE (extender node) / Radio / SSID and expose
//    RSSI + TxPHYRate per associated client.
var extClients = batch.matches(
    "InternetGatewayDevice.LANDevice.1.X_0000C5_Wireless.HNC.HNE.*.Radio.*.SSID.*.STA.*"
);
for (var k = 0; k < extClients.length; k++) {
    var sta = extClients[k];
    var stamac = normaliseMac(sta.MACAddress);
    if (!stamac) continue;
    var idx = sta.$indexes;
    var sthost = hostByMac[stamac] || {};
    var stlabels = {
        client_mac: stamac,
        hostname: sthost.hostname,
        via: HNE_VIA[idx.HNE] || ("hne_" + idx.HNE),
        band: HNE_RADIO_BAND[idx.Radio] || "unknown",
        ssid_idx: idx.SSID
    };
    if (sta.RSSI !== undefined && sta.RSSI !== "") {
        emit("wifi.client.rssi", toInt(sta.RSSI), stlabels);
    }
    if (sta.TxPHYRate !== undefined && sta.TxPHYRate !== "") {
        emit("wifi.client.tx_rate", toInt(sta.TxPHYRate), stlabels);
    }
}
