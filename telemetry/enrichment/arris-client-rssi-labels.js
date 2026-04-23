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
// Output: per-client labeled rows tagged with client_mac (stable identity).
// Three independent sections — each runs only when its source tree is
// present in this Inform, so one script covers multiple Arris firmware
// variants (some expose the HNC.HNE mesh tree, some only HNC.Steer
// SummaryStats, some populate both).
//
// Arris-specific index semantics — operator-maintained lookup tables.
// Per-firmware knowledge lives HERE, never in Go.
var WLAN_BAND_FALLBACK = { "1": "2.4GHz", "5": "5GHz", "8": "6GHz-backhaul" };
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

// --- Lookup tables built once per invocation -------------------------------

// MAC → {hostname, ip, layer2} from Hosts.Host table (if Informed).
// Layer2Interface is a reference string like
// "InternetGatewayDevice.LANDevice.1.WLANConfiguration.5", used to resolve
// the exact WLAN idx this host is attached to.
var hostByMac = {};
var hosts = batch.matches("InternetGatewayDevice.LANDevice.1.Hosts.Host.*");
for (var hi = 0; hi < hosts.length; hi++) {
    var h = hosts[hi];
    var hmac = normaliseMac(h.MACAddress);
    if (!hmac) continue;
    var l2 = h.Layer2Interface || "";
    var l2Match = /WLANConfiguration\.(\d+)$/.exec(l2);
    hostByMac[hmac] = {
        hostname: h.HostName || null,
        ip: h.IPAddress || null,
        wlanIdx: l2Match ? l2Match[1] : null,
        active: h.Active === "1" || h.Active === 1 || h.Active === true
    };
}

// WLAN idx → band (from the Arris X_0000C5_OperatingFrequencyBand field,
// values like "2.4Ghz" / "5.0Ghz"). Falls back to WLAN_BAND_FALLBACK when
// the field isn't present on this firmware.
var bandByWlan = {};
var wlans = batch.matches(
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.*.X_0000C5_OperatingFrequencyBand"
);
for (var wi = 0; wi < wlans.length; wi++) {
    var w = wlans[wi];
    var wlanIdx = w.$indexes.WLANConfiguration;
    bandByWlan[wlanIdx] = w.X_0000C5_OperatingFrequencyBand;
}
function resolveBand(wlanIdx) {
    return bandByWlan[wlanIdx] || WLAN_BAND_FALLBACK[wlanIdx] || "unknown";
}

// --- 1. Per-client band-steering stats (HNC.Steer.SummaryStats) -----------
// Present on most Arris firmware — historical steering counters per STA.
// Emitted even when the device has zero active clients, so operators see
// that the enrichment pipeline is working.
var steerStats = batch.matches(
    "InternetGatewayDevice.LANDevice.1.X_0000C5_Wireless.HNC.Steer.SummaryStats.STA.*"
);
for (var si = 0; si < steerStats.length; si++) {
    var s = steerStats[si];
    var smac = normaliseMac(s.MACAddress);
    if (!smac) continue;
    var shost = hostByMac[smac] || {};
    var slabels = {
        client_mac: smac,
        hostname: shost.hostname,
        band_support: s.BandSupport,
        sta_status: s.STAStatus,
        dual_band_capable: s.DualBandCapable
    };
    if (s.BTMAttempts !== undefined)            emit("wifi.client.btm_attempts",            toInt(s.BTMAttempts),            slabels);
    if (s.BTMSuccesses !== undefined)           emit("wifi.client.btm_successes",           toInt(s.BTMSuccesses),           slabels);
    if (s.BlacklistAttempts !== undefined)      emit("wifi.client.blacklist_attempts",      toInt(s.BlacklistAttempts),      slabels);
    if (s.BlacklistSuccesses !== undefined)     emit("wifi.client.blacklist_successes",     toInt(s.BlacklistSuccesses),     slabels);
    if (s.SelfSteerCount !== undefined)         emit("wifi.client.self_steer_count",        toInt(s.SelfSteerCount),         slabels);
    if (s.SteeringUnfriendly !== undefined)     emit("wifi.client.steering_unfriendly",     toInt(s.SteeringUnfriendly),     slabels);
    if (s.WiFiLinkQualityEvents !== undefined)  emit("wifi.client.link_quality_events",     toInt(s.WiFiLinkQualityEvents),  slabels);
    if (s.WiFiChannelUtilizationEvents !== undefined) emit("wifi.client.channel_util_events", toInt(s.WiFiChannelUtilizationEvents), slabels);
    if (s.BHUtilizationEvents !== undefined)    emit("wifi.client.bh_util_events",          toInt(s.BHUtilizationEvents),    slabels);
}

// --- 2. Gateway-attached clients via X_0000C5_WLANStats -------------------
// The real per-client RSSI tree on NVG/SURFboard firmware. Correlate via
// matching (wlan_idx, ad_idx) tuple — AssociatedDevice under both trees
// is indexed in the same order.
var gwMacByTuple = {};
var gwAssoc = batch.matches(
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.*.AssociatedDevice.*"
);
for (var gi = 0; gi < gwAssoc.length; gi++) {
    var ad = gwAssoc[gi];
    var mac = normaliseMac(ad.AssociatedDeviceMACAddress);
    if (!mac) continue;
    var tuple = ad.$indexes.WLANConfiguration + "|" + ad.$indexes.AssociatedDevice;
    gwMacByTuple[tuple] = mac;
    var host = hostByMac[mac] || {};
    var gwLabels = {
        client_mac: mac,
        hostname: host.hostname,
        via: "gateway",
        band: resolveBand(ad.$indexes.WLANConfiguration),
        wlan_idx: ad.$indexes.WLANConfiguration
    };
    // Legacy field name variants (some firmware): X_0000C5_RSSI / SignalStrength
    // directly on AssociatedDevice.
    if (ad.X_0000C5_RSSI !== undefined && ad.X_0000C5_RSSI !== "") {
        emit("wifi.client.rssi", toInt(ad.X_0000C5_RSSI), gwLabels);
    }
    if (ad.X_0000C5_SignalStrength !== undefined && ad.X_0000C5_SignalStrength !== "") {
        emit("wifi.client.signal", toInt(ad.X_0000C5_SignalStrength), gwLabels);
    }
}

// Walk the WLANStats tree and match against gwMacByTuple.
var wlanStats = batch.matches(
    "InternetGatewayDevice.LANDevice.1.X_0000C5_WLANStats.*.AssociatedDevice.*.Stats.*"
);
for (var ti = 0; ti < wlanStats.length; ti++) {
    var st = wlanStats[ti];
    var key = st.$indexes.X_0000C5_WLANStats + "|" + st.$indexes.AssociatedDevice;
    var stMac = gwMacByTuple[key];
    if (!stMac) continue; // Stats row without a paired AssociatedDevice MAC
    var sthost = hostByMac[stMac] || {};
    var stLabels = {
        client_mac: stMac,
        hostname: sthost.hostname,
        via: "gateway",
        band: resolveBand(st.$indexes.X_0000C5_WLANStats),
        wlan_idx: st.$indexes.X_0000C5_WLANStats
    };
    if (st.ClientRSSI !== undefined && st.ClientRSSI !== "") {
        emit("wifi.client.rssi", toInt(st.ClientRSSI), stLabels);
    }
}

// --- 3. Extender-attached clients (X_0000C5_Wireless.HNC.HNE mesh tree) ---
// Only populated on firmware with a paired mesh extender. Silent-skip when
// the tree isn't Informed.
var extClients = batch.matches(
    "InternetGatewayDevice.LANDevice.1.X_0000C5_Wireless.HNC.HNE.*.Radio.*.SSID.*.STA.*"
);
for (var k = 0; k < extClients.length; k++) {
    var sta = extClients[k];
    var stamac = normaliseMac(sta.MACAddress);
    if (!stamac) continue;
    var idx = sta.$indexes;
    var extHost = hostByMac[stamac] || {};
    var extLabels = {
        client_mac: stamac,
        hostname: extHost.hostname,
        via: HNE_VIA[idx.HNE] || ("hne_" + idx.HNE),
        band: HNE_RADIO_BAND[idx.Radio] || "unknown",
        ssid_idx: idx.SSID
    };
    if (sta.RSSI !== undefined && sta.RSSI !== "") {
        emit("wifi.client.rssi", toInt(sta.RSSI), extLabels);
    }
    if (sta.TxPHYRate !== undefined && sta.TxPHYRate !== "") {
        emit("wifi.client.tx_rate", toInt(sta.TxPHYRate), extLabels);
    }
}
