# herder-public-configs

Default provisioning rules, scripts, and device mappings for Herder.

Add this repo as a Config Source in Herder to get working defaults out of the box. Operators can fork this repo and customize the rules for their network.

## Structure

```
provisioning/
├── rules/           # Declarative YAML provisioning rules
│   ├── boot.yaml          # Refreshes device state on reboot
│   ├── first_contact.yaml # Full discovery on first bootstrap
│   └── periodic.yaml      # Periodic maintenance (firmware, WAN IP)
└── scripts/         # JavaScript provisioning scripts (goja ES6)
    ├── boot.js
    ├── first_contact.js
    └── periodic.js

mapping/
├── profiles/        # Device profile selectors
│   └── dev-sim-tr098.yaml       # Dev TR-098 CPE simulator profile
├── mappings/        # Canonical-to-vendor path mappings
│   └── diagnostics-tr098.yaml   # TR-143 diagnostics mapping
└── identity/        # Identity enrichment profiles (content type: `identity`)
    └── tr069-standard-identity.yaml  # Baseline firmwareVersion / model / productClass / manufacturer for any TR-069 CPE
```

## Usage

In the Herder UI, go to **Config → Sources → Add Source** and point to this repo's URL. Set the type mappings to match the content you want to sync — `mapping/profiles` and `mapping/mappings` under the `mapping` source type, `mapping/identity` under the `identity` source type, `provisioning/*` under `provisioning`.

See the [Identity Enrichment guide](https://ispx-ltd.github.io/herder-docs/guides/identity-enrichment/) for what the baseline profile covers and when you need to ship your own vendor override.

## Selector vocabulary

Profiles, dashboards, and provisioning rules use a selector to decide which devices they apply to. Selectors match against labels Herder derives from each device row at evaluation time. Available label keys:

| Key | Source | Example |
|-----|--------|---------|
| `oui` | `devices.oui` (always present) | `oui: "001122"` |
| `manufacturer` | Identity-enrichment populated | `manufacturer: "Acme"` |
| `productClass` | CWMP DeviceID envelope or identity profile | `productClass: "BM632w"` |
| `model` | Identity-enrichment populated | `model: "X100"` |
| `firmwareVersion` | Identity-enrichment populated | `firmwareVersion: "2.1.0"` |
| `tag:<value>` (Exists) | `devices.tags` | `key: "tag:vip", operator: Exists` |
| `dataModel:<id>` (Exists) | Path-prefix detection at telemetry time | `dataModel:device` (TR-181 — both CWMP and USP), `dataModel:igd` (TR-098 legacy IGD) |
| `protocol:<value>` (Exists) | `devices.protocols` | `protocol:cwmp`, `protocol:usp` — disambiguates wire protocol when `dataModel:device` matches both stacks |

**Selector tips:**

- `matchLabels` is exact-match-AND across keys (e.g. `{ manufacturer: "Acme", productClass: "X100" }` requires both).
- `matchExpressions` supports operators (`Exists`, `In`, `NotIn`, `DoesNotExist`, `SemverRange`) and is also AND across entries.
- For OR semantics across two values of the same key (e.g. "TR-098 OR TR-181"), use `In` on the parent attribute or layer separate profiles.
- `dataModel:device` matches both CWMP-TR-181 and USP-TR-181 devices because TR-181 is wire-protocol-agnostic. Use `protocol:cwmp` / `protocol:usp` only when behaviour genuinely differs by wire protocol — e.g. a future profile that runs CWMP-session-bound RPCs and shouldn't accidentally fire on USP devices, or vice versa. Most baseline TR-181 profiles in this repo correctly target the data model alone.
