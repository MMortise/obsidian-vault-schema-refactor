# Core Schema Refactor Specification

## Purpose

Schema Refactor MUST safely rename one top-level Obsidian property across Markdown frontmatter and exact references in supported Bases structures. It MUST provide a read-only Doctor for related schema problems and MUST operate entirely on local Vault data.

## Requirements

### Requirement: Complete reviewed rename

The plugin MUST scan the entire Vault, build an immutable change plan, and show affected files, structural locations, conflicts, exclusions, and diffs before any source file is written.

#### Scenario: User reviews a rename

- **GIVEN** a property exists in Markdown frontmatter or supported Bases references
- **WHEN** the user requests a rename
- **THEN** the plugin shows every exact planned change before enabling confirmation

### Requirement: Exact references only

The plugin MUST automatically change only structurally verified property definitions and references. Probable matches, text matches, unknown Base shapes, and unsupported expression forms MUST remain unchanged and be reported for manual review.

#### Scenario: An uncertain reference is found

- **GIVEN** a token may refer to the old property but cannot be proven exact
- **WHEN** the plan is built
- **THEN** the token appears as a read-only finding and is not included in writable operations

### Requirement: Explicit conflict handling

The plugin MUST block unresolved source/target conflicts. The reviewed plan MUST record the selected default policy, per-file decisions, excluded files, and the number of old definitions or references retained by exclusions.

#### Scenario: Both property names exist

- **GIVEN** a file contains both the old and new property names
- **WHEN** no valid conflict decision or exclusion exists
- **THEN** Apply remains disabled for that plan

### Requirement: Transactional writes and recovery

Before changing source files, the plugin MUST confirm plan freshness and create verified local snapshots. It MUST recheck source content immediately before each write, verify written bytes, roll back failures without overwriting concurrent edits, persist recoverable transaction state, and support hash-guarded Undo plans.

#### Scenario: A file changes after review

- **GIVEN** a reviewed plan exists
- **WHEN** any scanned source changes before its planned write
- **THEN** the plugin stops or rolls back without overwriting the external edit

### Requirement: Read-only Doctor

Doctor MUST report missing properties, missing formulas, formulas not reachable from known views or filters, case drift, type drift, unparseable Bases, and unknown Base shapes without modifying Vault files.

#### Scenario: Doctor scans a Vault

- **WHEN** the user runs Doctor
- **THEN** findings are generated locally and no source file is changed

### Requirement: Local and public-API operation

Core behavior MUST require no server, account, telemetry, API key, AI service, or undocumented Obsidian API. Desktop MAY write after Review and Confirm. Mobile MUST remain read-only until its transaction and recovery paths are separately validated.

#### Scenario: Core workflow runs offline

- **GIVEN** Obsidian has no network connection
- **WHEN** the user scans, reviews, or runs Doctor
- **THEN** the core workflow remains available
