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
