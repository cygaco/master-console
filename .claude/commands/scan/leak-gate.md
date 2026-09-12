---
description: Open-source leak gate — runs the five fail-closed leak enforcers (privacy, framework-purity full-tree, tracked-transients, hashed leak-denylist, README drift) sequentially with real exit codes. Closes ED-417.
user-invocable: true
namespace: scan
reads: []
writes: []
---

# /scan:leak-gate

The one command that answers "can this tree be pushed to the public repo?" (E-OPEN-SOURCE-001 / S-OS-04, ED-417). It runs each leak enforcer as its own child process and fails on the first non-zero **without stopping** — you see every red gate in one pass. `npm run leak-gate` and the CI workflow (`.github/workflows/leak-gate.yml`, on every push + pull request) run exactly the same list; `scripts/checks/leak-gate.test.js` asserts they cannot drift apart.

```bash
npm run leak-gate                                  # == node scripts/checks/leak-gate.js
node scripts/checks/leak-gate.js --only privacy,leak-denylist
node scripts/checks/leak-gate.js --skip readme-drift
node scripts/checks/leak-gate.js --json
```

| Gate | Script | What it refuses | Its own enforcer |
|---|---|---|---|
| privacy | `scripts/check/privacy.js` | credential markers (HIGH), non-placeholder emails + known names (MED), tracked files under `paths.runtime` / `paths.events` / `paths.memory` (HIGH). LOW homedir paths are report-only (`--strict` to fail; `--advisory` = old HIGH-only behaviour). Placeholder emails live in `scripts/check/privacy.allowlist.json`. | `scripts/check/privacy.test.js` |
| framework-purity | `scripts/checks/framework-purity.js --full` | private product slugs anywhere in tracked content (only planning/history records exempt), maintainer abs paths in executable/config files under `scripts/` + `.claude/`, promote-relic reintroduction | `framework-purity.test.js`, `framework-purity-gate.test.js` |
| tracked-transients | `scripts/checks/warpos-tracked-transients.js` | tracked/staged `.warpos/`, QA screenshots, owner=runtime logs, anything under the β mining output dir, `runtime/**/*.{jsonl,log,diff,err,out}`, transcript-like `runtime/**/*.txt` > 200 KB. Exceptions need a reason in `warpos-tracked-transients.allowlist.json` (currently empty). | `warpos-tracked-transients.test.js` |
| leak-denylist | `scripts/checks/leak-denylist.js` | any phrase the 2026-09-03 history rewrite removed — matched by sliding k-word window against `scripts/checks/leak-denylist.json`, which holds only `{ kind, words, chars, sha256, label }` (hash of the normalised phrase; never plaintext). A hit prints `file:line [label]`, never the text. Add an entry with `--add "<phrase>" --label <l>`. A 0-entry list is a fail (exit 2), not a pass. | `leak-denylist.test.js` |
| readme-drift | `scripts/checks/readme-drift.js` | README fact lines `**Version:** …` / `**Skills:** N slash commands` / `**Hooks:** N automated hooks` missing or unequal to `package.json`, the tracked `paths.commands` `.md` count, and the hook-entry count in `.claude/settings.json` | `readme-drift.test.js` |

Exit codes: `0` every gate green · `1` at least one gate red · `2` a gate errored (fail-closed) or bad usage.

## Text-matching trap

The denylist and this doc describe the banned **classes**, never the strings. Nothing tracked may carry a scrubbed phrase — including tests (fixtures are assembled at runtime), enforcement-debt notes, and handoffs. If a gate reports a hit, rewrite the line; do not allow-list it.

## When it is red

- `privacy` — remove the credential / address, or (placeholders only) extend `privacy.allowlist.json` with a reviewer-visible entry.
- `framework-purity` — neutralise the slug (`the origin product`, `product-a`), or `git rm --cached` a private tree and gitignore it (index-only removal; the private mirror keeps history).
- `tracked-transients` — `git rm --cached <file>` and make sure `.gitignore` covers the pattern.
- `leak-denylist` — rewrite the flagged line; never store the phrase anywhere tracked.
- `readme-drift` — update the three fact lines in README.md to the printed expected values.

Related: `/scan:privacy`, `/scan:framework-purity`, `/scan:warpos-tracked-transients`. Wired into `/scan:full` (Tier 3).
