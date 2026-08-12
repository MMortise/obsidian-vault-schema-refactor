# Obsidian Vault Schema Refactor

English | [简体中文](./README_zh-cn.md)

Safely rename properties across an Obsidian Vault and keep Bases references in sync.

## Why This Project Exists

Obsidian properties are stored as frontmatter keys in Markdown files. Bases can reference those properties in filters, formulas, summaries, sorting, grouping, and column configuration.

Renaming a property normally means updating many files by hand. Missing even one reference can leave a Base incomplete or silently produce the wrong results. Bulk text replacement is also unsafe because the same word may appear in note content, another namespace, a string literal, or an unsupported configuration shape.

Schema Refactor provides one reviewed workflow for making that change across the entire Vault without guessing.

## What It Solves

- Renames a top-level frontmatter property across Markdown files.
- Updates exact property references in supported Obsidian Bases structures.
- Shows every affected file, structural location, and diff before writing.
- Reports uncertain references for manual review without changing them automatically.
- Handles source/target conflicts with explicit per-file decisions or exclusions.
- Creates local snapshots, verifies every write, and rolls back on failure.
- Builds safe Undo plans without overwriting files edited after the original transaction.
- Includes a read-only Doctor for missing properties or formulas, unused formulas, case drift, type drift, and unsupported Base shapes.

Everything runs locally. The plugin requires no account, server, telemetry, API key, or AI service.

## Install

The plugin currently needs to be built from source:

```bash
npm install
npm run build
npm run install:dev -- /absolute/path/to/test-vault
```

Alternatively, place `main.js`, `manifest.json`, and `styles.css` in:

```text
<vault>/.obsidian/plugins/schema-refactor/
```

Then enable **Schema Refactor** under Obsidian's Community plugins settings. Obsidian 1.9.0 or later is required.

## Use

1. Back up or sync your Vault before the first use.
2. Open **Schema Refactor** from the ribbon or command palette.
3. Run **Doctor** to inspect the Vault without changing files.
4. Under **Refactor**, enter the current property name and its replacement, then scan the Vault.
5. Review every file and diff. Resolve conflicts or exclude files that should remain unchanged.
6. Confirm the conflict policy, exclusions, and retained references, then apply the reviewed plan.
7. Keep Obsidian open while the plugin snapshots, writes, verifies, or rolls back files.
8. Use **History** to create and review an Undo plan when needed.

Desktop supports the complete write, rollback, and Undo workflow. Mobile currently supports Doctor, scanning, and review only.

Snapshots and transaction journals are stored in `.obsidian/plugins/schema-refactor/snapshots/`. If a transaction reports `ROLLBACK_INCOMPLETE`, stop external synchronization and inspect the listed files before continuing.
