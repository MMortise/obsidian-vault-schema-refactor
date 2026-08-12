# Validation report

## Automated baseline

The `0.1.0` implementation includes unit, contract and in-memory integration coverage for:

- expression token boundaries and non-reference negatives;
- Markdown top-level key transforms and conflict strategies;
- known Base structures, unknown-field preservation and exact rewrites;
- all seven Doctor rule implementations and private Markdown/JSON reports;
- deterministic Change Plans and output reparsing;
- successful transaction execution, Nth-write failure, corrupt writes, compensation rollback, external divergence and crash-journal recovery;
- Restore Plan generation with diverged-file exclusion.

Run `npm run check` for the current counts and result.

The synthetic `npm run bench` reference run on 2026-08-12 parsed 10,000 Markdown frontmatters, 200 Bases and approximately 50 MB of frontmatter in 433 ms with 58 MB reported heap use. This is a parser baseline, not an Obsidian UI latency claim.

## Release validation still required

M6 cannot be completed from repository fixtures alone. A public release remains blocked on:

- real Obsidian E2E across the compatibility matrix;
- 20 authorized real or anonymized Vaults spanning the five documented usage categories;
- measured Exact precision, missed-reference rate, first/repeat scan latency and peak memory;
- manual snapshot, crash recovery, Sync/cloud-folder competition and accessibility exercises.

The Obsidian installation available during implementation was `1.8.10`, below the declared Bases minimum `1.9.0`, so it was not used to claim a valid E2E pass.

No Go/No-Go claim is made until those measurements meet Product Spec sections 20 and 21.
