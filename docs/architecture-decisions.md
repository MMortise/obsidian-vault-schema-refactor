# Architecture decisions

## ADR-001: YAML writeback

Status: accepted for `0.1.0`.

Schema Refactor uses the `yaml` package Document/CST API for Markdown frontmatter and `.base` files. The reviewed `afterText` is generated once during planning and the transaction executor writes those exact bytes. This preserves comments, key order, unknown fields and common scalar styles better than an object parse/stringify round trip.

Contract fixtures cover comments, nested values, inline lists, unknown Base fields and string literals. Unsupported tags, duplicate keys, malformed YAML and known reference fields with unknown shapes stop the plan instead of falling back to text replacement.

## ADR-002: Hashing

Status: accepted.

All content fingerprints use SHA-256 through Web Crypto. `mtime` and size are inventory hints only; plan freshness, write verification, rollback and Undo compare content hashes. Web Crypto keeps the core path available on desktop and mobile without Node APIs.

## ADR-003: Obsidian compatibility

Status: provisional until the manual compatibility matrix is complete.

The minimum declared version is Obsidian `1.9.0`, the first stable release line with Bases. The implementation uses only public Plugin, Vault, Workspace, DataAdapter and Platform APIs. It does not inject into the official Bases UI or call an internal formula parser.

Desktop exposes the complete transaction workflow. Mobile exposes inventory, Doctor, planning and Diff; Apply, rollback and Undo controls are absent. Mobile write support requires its own transaction and crash-recovery qualification.

## ADR-004: Exact expression references

Status: accepted for MVP.

Only boundary-checked `note.<identifier>` tokens outside string and regular-expression literals are Exact. Serialized `note.<property>` IDs in known view fields are also Exact. Bare identifiers are Probable and never enter an automatic plan. `file.*`, `formula.*`, arbitrary unknown fields, Markdown body text and plugin configuration are not rewritten.
