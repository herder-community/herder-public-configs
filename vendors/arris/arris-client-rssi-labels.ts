// Arris TR-098 per-client WiFi label enrichment.
//
// Output: per-client labeled rows tagged with client_mac (stable identity).
// Three independent sections — each runs only when its source tree is
// present in this Inform, so one script covers multiple Arris firmware
// variants (some expose the HNC.HNE mesh tree, some only HNC.Steer
// SummaryStats, some populate both).
//
// Arris-specific index semantics — operator-maintained lookup tables.
// Per-firmware knowledge lives HERE, never in Go.
const WLAN_BAND_FALLBACK: Record<string, string> = {
  "1": "2.4GHz",
  "5": "5GHz",
  "8": "6GHz-backhaul",
};
const HNE_VIA: Record<string, string> = {
  "1": "gateway",
  "2": "extender_2",
  "3": "extender_3",
};
const HNE_RADIO_BAND: Record<string, string> = {
  "1": "5GHz",
  "2": "2.4GHz",
  "3": "6GHz-backhaul",
};

function normaliseMac(s: unknown): string | null {
  if (typeof s !== "string") return null;
  return s.toLowerCase().replace(/-/g, ":");
}

function toInt(s: unknown): number | null {
  if (typeof s !== "string" && typeof s !== "number") return null;
  const n = parseInt(String(s), 10);
  return isNaN(n) ? null : n;
}

// --- Lookup tables built once per invocation -------------------------------

interface HostMeta {
  hostname: string | null;
  ip: string | null;
  wlanIdx: string | null;
  active: boolean;
}

// MAC → {hostname, ip, layer2} from Hosts.Host table (if Informed).
const hostByMac: Record<string, HostMeta> = {};
const hosts = batch.matches("InternetGatewayDevice.LANDevice.1.Hosts.Host.*");
for (let hi = 0; hi < hosts.length; hi++) {
  const h = hosts[hi];
  const hmac = normaliseMac(h.MACAddress);
  if (!hmac) continue;
  const l2 = (h.Layer2Interface as string | undefined) || "";
  const l2Match = /WLANConfiguration\.(\d+)$/.exec(l2);
  const active = h.Active as string | undefined;
  hostByMac[hmac] = {
    hostname: (h.HostName as string | undefined) || null,
    ip: (h.IPAddress as string | undefined) || null,
    wlanIdx: l2Match ? l2Match[1] : null,
    active: active === "1" || active === "true",
  };
}

// WLAN idx → band (from the Arris X_0000C5_OperatingFrequencyBand field).
// Falls back to WLAN_BAND_FALLBACK when the field isn't present on this firmware.
const bandByWlan: Record<string, string> = {};
const wlans = batch.matches(
  "InternetGatewayDevice.LANDevice.1.WLANConfiguration.*.X_0000C5_OperatingFrequencyBand",
);
for (let wi = 0; wi < wlans.length; wi++) {
  const w = wlans[wi];
  const wlanIdx = w.$indexes.WLANConfiguration;
  bandByWlan[wlanIdx] = (w.X_0000C5_OperatingFrequencyBand as string | undefined) || "";
}
function resolveBand(wlanIdx: string): string {
  return bandByWlan[wlanIdx] || WLAN_BAND_FALLBACK[wlanIdx] || "unknown";
}

// --- 1. Per-client band-steering stats (HNC.Steer.SummaryStats) -----------
const steerStats = batch.matches(
  "InternetGatewayDevice.LANDevice.1.X_0000C5_Wireless.HNC.Steer.SummaryStats.STA.*",
);
for (let si = 0; si < steerStats.length; si++) {
  const s = steerStats[si];
  const smac = normaliseMac(s.MACAddress);
  if (!smac) continue;
  const shost = hostByMac[smac];
  const slabels = {
    client_mac: smac,
    hostname: shost ? shost.hostname : null,
    band_support: (s.BandSupport as string | undefined) || null,
    sta_status: (s.STAStatus as string | undefined) || null,
    dual_band_capable: (s.DualBandCapable as string | undefined) || null,
  };
  if (s.BTMAttempts !== undefined) emit("wifi.client.btm_attempts", toInt(s.BTMAttempts), slabels);
  if (s.BTMSuccesses !== undefined) emit("wifi.client.btm_successes", toInt(s.BTMSuccesses), slabels);
  if (s.BlacklistAttempts !== undefined) emit("wifi.client.blacklist_attempts", toInt(s.BlacklistAttempts), slabels);
  if (s.BlacklistSuccesses !== undefined) emit("wifi.client.blacklist_successes", toInt(s.BlacklistSuccesses), slabels);
  if (s.SelfSteerCount !== undefined) emit("wifi.client.self_steer_count", toInt(s.SelfSteerCount), slabels);
  if (s.SteeringUnfriendly !== undefined) emit("wifi.client.steering_unfriendly", toInt(s.SteeringUnfriendly), slabels);
  if (s.WiFiLinkQualityEvents !== undefined) emit("wifi.client.link_quality_events", toInt(s.WiFiLinkQualityEvents), slabels);
  if (s.WiFiChannelUtilizationEvents !== undefined) emit("wifi.client.channel_util_events", toInt(s.WiFiChannelUtilizationEvents), slabels);
  if (s.BHUtilizationEvents !== undefined) emit("wifi.client.bh_util_events", toInt(s.BHUtilizationEvents), slabels);
}

// --- 2. Gateway-attached clients via X_0000C5_WLANStats -------------------
const gwMacByTuple: Record<string, string> = {};
const gwAssoc = batch.matches(
  "InternetGatewayDevice.LANDevice.1.WLANConfiguration.*.AssociatedDevice.*",
);
for (let gi = 0; gi < gwAssoc.length; gi++) {
  const ad = gwAssoc[gi];
  const mac = normaliseMac(ad.AssociatedDeviceMACAddress);
  if (!mac) continue;
  const tuple = ad.$indexes.WLANConfiguration + "|" + ad.$indexes.AssociatedDevice;
  gwMacByTuple[tuple] = mac;
  const host = hostByMac[mac];
  const gwLabels = {
    client_mac: mac,
    hostname: host ? host.hostname : null,
    via: "gateway",
    band: resolveBand(ad.$indexes.WLANConfiguration),
    wlan_idx: ad.$indexes.WLANConfiguration,
  };
  const rssi = ad.X_0000C5_RSSI as string | undefined;
  if (rssi !== undefined && rssi !== "") {
    emit("wifi.client.rssi", toInt(rssi), gwLabels);
  }
  const sig = ad.X_0000C5_SignalStrength as string | undefined;
  if (sig !== undefined && sig !== "") {
    emit("wifi.client.signal", toInt(sig), gwLabels);
  }
}

// Walk the WLANStats tree and match against gwMacByTuple.
const wlanStats = batch.matches(
  "InternetGatewayDevice.LANDevice.1.X_0000C5_WLANStats.*.AssociatedDevice.*.Stats.*",
);
for (let ti = 0; ti < wlanStats.length; ti++) {
  const st = wlanStats[ti];
  const key = st.$indexes.X_0000C5_WLANStats + "|" + st.$indexes.AssociatedDevice;
  const stMac = gwMacByTuple[key];
  if (!stMac) continue;
  const sthost = hostByMac[stMac];
  const stLabels = {
    client_mac: stMac,
    hostname: sthost ? sthost.hostname : null,
    via: "gateway",
    band: resolveBand(st.$indexes.X_0000C5_WLANStats),
    wlan_idx: st.$indexes.X_0000C5_WLANStats,
  };
  const cr = st.ClientRSSI as string | undefined;
  if (cr !== undefined && cr !== "") {
    emit("wifi.client.rssi", toInt(cr), stLabels);
  }
}

// --- 3. Extender-attached clients (X_0000C5_Wireless.HNC.HNE mesh tree) ---
const extClients = batch.matches(
  "InternetGatewayDevice.LANDevice.1.X_0000C5_Wireless.HNC.HNE.*.Radio.*.SSID.*.STA.*",
);
for (let k = 0; k < extClients.length; k++) {
  const sta = extClients[k];
  const stamac = normaliseMac(sta.MACAddress);
  if (!stamac) continue;
  const idx = sta.$indexes;
  const extHost = hostByMac[stamac];
  const extLabels = {
    client_mac: stamac,
    hostname: extHost ? extHost.hostname : null,
    via: HNE_VIA[idx.HNE] || ("hne_" + idx.HNE),
    band: HNE_RADIO_BAND[idx.Radio] || "unknown",
    ssid_idx: idx.SSID,
  };
  const extRssi = sta.RSSI as string | undefined;
  if (extRssi !== undefined && extRssi !== "") {
    emit("wifi.client.rssi", toInt(extRssi), extLabels);
  }
  const extTx = sta.TxPHYRate as string | undefined;
  if (extTx !== undefined && extTx !== "") {
    emit("wifi.client.tx_rate", toInt(extTx), extLabels);
  }
}
