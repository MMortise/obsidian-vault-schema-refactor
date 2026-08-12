# Known limitations

- Exact expression rewriting currently covers `note.<identifier>` where the property is representable by the validated Bases token fixture. Bare identifiers and bracket access are reported but not automatically changed.
- Properties containing spaces, dots or syntax-significant characters can be renamed in Markdown, but their Base expression references remain read-only unless a public parser or versioned fixture proves the access syntax.
- Unknown `.base` fields are preserved. An unknown shape inside a known reference field can block a plan when it may contain the old property.
- YAML anchors, aliases, duplicate keys, custom tags and malformed documents are not repaired. Unsafe or ambiguous inputs block the affected plan.
- Undo skips files that were deleted, renamed or edited after the transaction. MVP does not perform three-way merge or infer renamed paths.
- Mobile is read-only for source files in `0.1.0`; Apply, automatic rollback and Undo are desktop-only.
- Doctor checks structural integrity. Public Obsidian APIs do not provide a general temporary Base query runner, so it does not promise result-row equivalence.
- Snapshot cleanup retains at least one clean terminal transaction and never removes `ROLLBACK_INCOMPLETE` records automatically.
