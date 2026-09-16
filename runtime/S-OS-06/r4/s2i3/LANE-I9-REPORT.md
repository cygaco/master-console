# LANE-I9-REPORT — S-OS-06 r4, lane I9 (re-base the I8 partition amendment onto the landed partition)

STATUS: COMPLETE. Branch `s-os-06/s2i-capture`. No premise of the brief was false.

## Commits (in order)

| commit | what | partition change |
|---|---|---|
| `1c51969d` | stub report (reap-survival) | none |
| `8f1d5c1b` | merge of landed sprint head `628d13f0` (`open-source/S-OS-06`) | **none relative to landed**: the denylist conflict (2 hunks, the only conflicted file) was resolved to the landed partition byte-for-byte — `git diff 628d13f0 8f1d5c1b -- scripts/open-source/rename-mc.denylist.json` is empty; entry keys merge vs landed: +0 / −0 |
| `bcbcbf09` | **the re-based amendment** — `partition-amendment:` marker, partition-only (1 file) | **+60 / −0** |

## The amendment is insertion-only

- `git show --numstat bcbcbf09` → `60  0  scripts/open-source/rename-mc.denylist.json`. One file. Zero deletions.
- The `+`/`-` line sequence of `bcbcbf09` is **byte-identical** to `d780206a`'s (`diff` of the two change-line streams is empty). Same six pins, same six amendment records, same text. Only the insertion points moved. They are still the ends of `$freeze.amendments` and `occurrencePins`. Lane B B4 retired the T3 `warpos@0.14*` pin that `d780206a` used as hunk context, and that is the whole reason the merge conflicted.
- Entry-key set, HEAD vs landed `628d13f0`: **+6 / −0**. The six added keys are exactly the six below.
- Lane J: 15 `compat|check-shims` rows are present at `d780206a` and retired on landed. **0 resurrected at HEAD.** The 15 lane-J removal records are still in `$freeze.amendments`.
- None of the six keys is in `$freeze.baselineKeys` (baseline untouched). Each has exactly one amendment record (`added`) in the HEAD partition.

## The six, re-derived at HEAD `bcbcbf09`

These values come from the new state, not from the I8 report. Pin binding comes from the HEAD partition against HEAD `tests/quarantine.json`. The property booleans come from re-running the read-only probe `runtime/S-OS-06/r4/s2i3/i8/occurrence-property-probe.js` at HEAD (stdout only, exit 0; the I8 JSON was not overwritten). The register base is `669aadc1`, read from `tests/quarantine.json` `base`. The probe uses `-M50%`, which equals the runner's `RENAME_SIMILARITY = "50%"`.

For O1–O5 the probe emits the same six booleans. Every row came out: legacy path exists at base = **true** · renamed path exists at base = **false** · pair-limited diff base..HEAD is a rename = **true** · rewrite equals `file`, so the schema refuses (`run-tests.js:555`, `basePath === file`) = **true** · rewrite exists at base = **false** · **PROPERTY A = true** · **PROPERTY B (records the pre-rename path: exists at base, absent at HEAD) = true**.

| # | occurrence (pin key: file, matchText, anchor) | quarantine.json line (matches exactly 1) | entry | PROPERTY A | PROPERTY B |
|---|---|---|---|---|---|
| O1 | `tests/quarantine.json`, `tests/warpos/dispatch-readiness.test.js`, `"basePath": ` | 38 | #0, file `tests/mc/dispatch-readiness.test.js` | true | true |
| O2 | `tests/quarantine.json`, `tests/warpos/lib/provider-autofix.unit.test.js`, `"basePath": ` | 146 | #1, file `tests/mc/lib/provider-autofix.unit.test.js` | true | true |
| O3 | `tests/quarantine.json`, `tests/warpos/lib/provider-rca.unit.test.js`, `"basePath": ` | 170 | #2, file `tests/mc/lib/provider-rca.unit.test.js` | true | true |
| O4 | `tests/quarantine.json`, `tests/warpos/product-bootstrap.unit.test.js`, `"basePath": ` | 194 | #3, file `tests/mc/product-bootstrap.unit.test.js` | true | true |
| O5 | `tests/quarantine.json`, `tests/warpos/provider-smoke.unit.test.js`, `"basePath": ` | 218 | #4, file `tests/mc/provider-smoke.unit.test.js` | true | true |
| O6 | `tests/quarantine.json`, `WARPOS_SHAPE_DOOR became MC_SHAPE_DOOR`, `the codemod rewrote text inside` | 3 (`$policy`) | n/a | **n/a** (not a path; no base-identity function reads it) | **true** (legacy hits in `$policy` = 1; after the rewrite the sentence is the tautology `X became X`) |

- **PROPERTY A (O1–O5):** at register base the test really is at the legacy path. Rewriting `basePath` makes it equal the entry's own `file`, which the runner's schema refuses, and that path does not exist at base. So a rewrite breaks the runner's base-identity check.
- **PROPERTY B (O1–O6):** the occurrence records provenance. For O1–O5 that is the pre-rename path. For O6 it is a past codemod event, and rewriting it falsifies the sentence.

`cutover-completeness` at HEAD reports each of the six as `1  pin tests/quarantine.json :: …` (output lines 152–157), with `live-unallowed=0`.

## Gates (each run as its own command; real exit codes)

| gate | exit | numbers |
|---|---|---|
| `node scripts/checks/cutover-completeness.js` | **0** | partition: 190 allow-view entries, 0 problems; totals suppressed=23929 pinned=340 derived=215 **live-unallowed=0**; compat-expired=0; F8: frozen at `a851490acc04`, 230 amendment keys on record, history swept 16 post-freeze partition commits (12 adding 227 keys, 5 removing 46 keys), each judged |
| `node scripts/checks/framework-purity.js` | **0** | `result: OK (exit 0)` |
| `node scripts/checks/leak-gate.js` | **0** | privacy / framework-purity / tracked-transients / leak-denylist / readme-drift all OK; `GREEN (exit 0)` |
| `node --test tests/regression/S-OS-06/falsify-quarantine-runner.test.js` | **0** | tests 15 · pass 15 · fail 0 · cancelled 0 · skipped 0 · todo 0 |

Cutover did **not** reject the re-based amendment. Its F8 git layer judged `bcbcbf09`, which is the last entry of `git log --reverse -- scripts/open-source/rename-mc.denylist.json`: marker present, partition-only, one amendment record per added key.

Captures are left **untracked**, as with the SUITE captures (section 7b): `runtime/S-OS-06/r4/s2i3/i9-{cutover,purity,leak,falsifier}.out`. The cutover capture quotes legacy-slug pin text verbatim.

## Refused / not done

- **Refused:** a scripted `node -e` full-file rewrite of the denylist was blocked by a write guard. I did not reshape it to get past the guard; I used the Edit tool with two exact insertions instead. The result was checked above against `d780206a`, line for line.
- **Not touched (out of scope):** runner, scrub, falsifiers, case (e), `observedOn`, the eleven-name floor, `.github/workflows/**`, manifest regeneration, the occurrence register, `.claude/settings.json`, lane J's retirements.
- **Note (a limit, not a defect):** the F8 sweep uses `git log -- <denylist>` with default history simplification. A merge whose partition is identical to one parent is not listed, and the side it did not follow is not walked; here that means `d780206a` is no longer in the sweep. This is sound for this case: the dropped side's entries are absent from the merge result, and every key they carried is re-judged at `bcbcbf09`.
