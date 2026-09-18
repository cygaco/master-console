# WHAT'S LEFT — before the Master Console repository can be shared

Written by α 2026-09-18 at resume (operator directive 4: ONE clear list; ε reports against it).
Ground truth checked at write time, not inherited: `origin/main` = `669aadc1`; sprint branch
`open-source/S-OS-06` = `43af93e9` (+ substrate `251a2a78` pending merge); public repo already
renamed `cygaco/master-console`; public history already rewritten (S-OS-03); leak-gate CI GREEN on
`origin/main`.

## Already true today (nothing to do)
- Repo is public, renamed, redirect verified; README/docs/provenance say "Master Console (formerly WarpOS)".
- Public history: Gmail / profanity / paid-course corpus / private-product vocabulary purged from **blobs** (S-OS-03, verified on a fresh clone).
- Leak enforcers (privacy, framework-purity, tracked-transients, leak-denylist, readme-drift) run in CI on every push; GREEN on `origin/main`.

## What blocks SHARING (privacy), in order — 1 item
1. **One operator Gmail survives in a public COMMIT MESSAGE** — `d9fa542f` on `origin/main` (S-OS-03 rewrote blobs only; measured again 2026-09-18: `git log origin/main --grep=@gmail.com` → exactly 1 hit). Fix = one `git filter-repo --replace-message <rules>` pass on a fresh mirror clone + operator `git push --mirror`, AFTER the S-OS-06 land and BEFORE the `mc@2.0.0` tag. Measured 2026-09-18: `git filter-repo` is installed (a40bce54, Python 3.12); the four evidence anchors (`cd37d410 29908188 bb06646d 38d771bf`) are NOT descendants of `d9fa542f`, so their SHAs survive; the 774 commits after it get new SHAs (expected — same shape as S-OS-03; the commit-map is re-emitted). No `--replace-message` rules file exists yet — α writes it to the operator's scratch (never tracked: it must contain the literal address) and hands the exact `!` lines. **Operator-run.** ~15 min incl. the fresh-clone re-verify (`scripts/open-source/assert-evidence.js`, whose lane-D step 4 now scans messages + identities).

## What blocks the REBRAND being DONE (internals still say `warpos`) — S-OS-06 close
Agents, this session (ε conducting):
2. Apply the three rulings issued this session (R-120 capture, R-121 §8 amendment + ED, R-122 §5.1 close wording) — 3 bounded commits.
3. Regen triple manifests + occurrence register LAST (ROADMAP.md changed this session), then the certifying run on an exclusive tree (population printed; stamped win32/node24).
4. Security-reviewer gauntlet on the final head — gemini/agy pass + Claude binding lane (GPT banned this session). Must be PASS; a FAIL = one bounded fix + re-review of the fix only.
5. DONE-REPORT with the named residuals stated honestly (§5.1 "zero except one named occurrence"; §8 gap 2 "requires an instrument change"; linux floor + tier-check envelope "keyed to the next push"; two vacuous quarantine entries; three measure-only sibling plants).

Operator (`!` lines, α hands each one over exactly):
6. `git push origin open-source/S-OS-06` → CI runs on linux. Expected: case (n) prints the linux floor; provider-tier-check prints its envelope. If RED → one bounded commit (agents) + push again. Two pushes is the realistic count.
7. Edit `.github/workflows/leak-gate.yml` L36: `warpos-tracked-transients.js` → `mc-tracked-transients.js` (classifier-denied for agents — CI Bypass rule). Push.
8. Land: `git push origin open-source/S-OS-06:main` (only after 4 = PASS and CI GREEN on the final head). Local `main` is STALE (c3b8654f) — never use it.
9. Item 1 (Gmail commit-message purge + force-push), then tag: `git tag mc@2.0.0 && git push origin mc@2.0.0`.

## Then share (S-OS-07, 15 min)
10. Verify every hash on `docs/PROVENANCE.md` resolves on the rewritten `origin/main`; publish the announcement with the provenance link. Epic E-OPEN-SOURCE-001 → 100%.

## Deliberately NOT in this list (lean directive)
- No new lanes, rounds, instruments or falsifiers in r4. §8 gap 2 and the linux floor are residuals, not work.
- `E-LEAN-GAUNTLET-001` (touchpoint/risk-based testing) is on the roadmap as the FIRST epic after this one closes — it is not built on the final head.

## Honest estimate
Items 2–5: this session, a few hours of agent time (the certifying run + one security review are the long poles).
Items 6–9: ~30 min of operator keystrokes spread over two CI waits (~10 min each).
Item 10: 15 min.
If you only want to SHARE and accept internals that still say `warpos` in places: item 1 alone makes the repo shareable today.
