# Compatibility matrix

This matrix records the release target. Cells marked pending require real Obsidian validation before a public release.

| Environment | Scan / Doctor | Review / Diff | Apply / Rollback / Undo | Status |
|---|---:|---:|---:|---|
| Obsidian 1.9.x, macOS | target | target | target | manual E2E pending |
| Current stable, macOS | target | target | target | manual E2E pending |
| Current stable, Windows | target | target | target | manual E2E pending |
| Current stable, Linux | target | target | target | manual E2E pending |
| Current stable, iOS | target | target | disabled | device test pending |
| Current stable, Android | target | target | disabled | device test pending |

Automated tests cover browser-compatible hashing, Vault-shaped in-memory adapters, Base/Frontmatter fixtures, deterministic plans, fault injection, rollback, recovery and divergent Undo protection. They do not replace loading the bundled plugin in the real Obsidian releases above.
