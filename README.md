# Obsidian Vault Schema Refactor

English | [简体中文](./README_zh-cn.md)

Safely refactor property schemas in a local Obsidian Vault while updating the Bases configurations that reference those properties.

## Development Status

The `0.1.0` MVP includes the project foundation, Inventory, Reference Index, Doctor, Change Plan, Diff, desktop transactional writes, rollback and recovery, history, and safe Undo. A public release still requires end-to-end testing in Obsidian and validation against 20 authorized Vaults from milestone M6 of the implementation plan. See the [validation report](./docs/validation-report.md) for details.

Development commands:

```bash
npm install
npm run check
npm run build
npm run install:dev -- /absolute/path/to/test-vault
```

The build produces `main.js`. Install it together with `manifest.json` and `styles.css` in the Vault's `.obsidian/plugins/schema-refactor/` directory. The minimum supported Obsidian version is 1.9.0.

## Usage

1. Open `Schema Refactor` from the left ribbon or the command palette.
2. Run the read-only checks under `Doctor` to inspect broken property and formula references, case drift, type drift, and unparseable Bases.
3. Under `Refactor`, enter the old and new property names and scan the entire Vault.
4. Review structural paths and diffs file by file, then resolve conflicts or exclude files.
5. Confirm and apply on desktop. The plugin creates a complete snapshot before writing, then writes, reads back, and verifies each file individually.
6. Create an Undo Plan from History. Undo also requires Review and Confirm. Files edited after the transaction are marked as diverged and are never overwritten.

The initial mobile release supports Doctor, Scan, and Review only. It does not expose Apply, Rollback, or Undo writes.

## Recovery and Privacy

Snapshots and journals are stored in `.obsidian/plugins/schema-refactor/snapshots/`. By default, the latest 20 eligible transactions are retained. Snapshots in the `ROLLBACK_INCOMPLETE` state are never deleted automatically. If this state occurs, stop external synchronization, preserve the snapshots, and manually inspect the files listed in History.

The plugin core makes no network requests, includes no telemetry SDK, and never records or exports frontmatter values or note bodies. Doctor reports contain only Vault-relative paths, rules, structural locations, and the property identifiers required to explain findings.

## Current Decision

**Go, with a narrow MVP first.**

The first release solves one complete problem:

> Rename a frontmatter property from an old name to a new name while updating every deterministically recognized reference in Markdown frontmatter and `.base` files. Show the complete plan and diff before writing, roll back failed writes, and support later undo.

`Bases Doctor` is a read-only audit mode in the same plugin, not a separate plugin. Natural-language Base generation is outside the MVP.

Initial support boundaries: desktop provides complete scanning, preview, writes, rollback, and undo. Mobile provides Doctor, scanning, and preview, with property writes disabled by default until all mobile transaction and crash-recovery tests pass.

## Product Constraints

- Runs entirely locally, with no server, database, account, API key, or paid service.
- Core features do not depend on AI, Ollama, or Hugging Face models.
- Never modifies a Vault silently. Every refactor must pass through scanning, planning, preview, and confirmation.
- Automatically changes only high-confidence structured references. Uncertain references are reported without guessed replacements.
- Every write has a snapshot, verification, rollback, and an auditable record.
- The plugin provides its complete core workflow. Users need no Git, Ollama, Docker, or other external service beyond Obsidian.

## Documentation

- [Product specification](./docs/product-spec.md): rationale, target users, scope, complete interactions, and product rules.
- [Technical design](./docs/technical-design.md): scanning, reference recognition, plan generation, transactional writes, and undo.
- [Competitive audit](./docs/competitive-audit.md): direct competitors, adjacent capabilities, and product differentiation.
- [Implementation plan](./docs/implementation-plan.md): development phases, deliverables, dependencies, and definitions of done.
- [Test plan](./docs/test-plan.md): test matrix, fault injection, performance baselines, and release gates.
- [Research appendix](./docs/bases-opportunity-research.md): forum research, Hugging Face research, and early direction evaluation.

## MVP Success Criteria

The MVP is complete only when all of the following are true:

1. It accurately scans property definitions and `.base` references throughout a Vault.
2. It safely handles missing properties, existing target properties, concurrent file changes, and partial write failures.
3. It modifies no source files before user confirmation.
4. Users can inspect changes and exclude files individually.
5. A post-write rescan finds none of the old references that the transaction was expected to fix.
6. A complete undo restores the original bytes. If a file was edited afterward, the plugin stops instead of overwriting it and reports the conflict.
7. The core workflow uses no private Obsidian APIs.
