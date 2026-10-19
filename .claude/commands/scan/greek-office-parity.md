---
description: The naming bijection enforcer (ADR-0016) — a role carries a Greek call-sign IFF it is a President's-office member (home===president). Fires both ways. Report-only in /scan:full.
---

# /scan:greek-office-parity — Greek call-signs ⟺ President's office (naming bijection)

Greek call-signs live ONLY in the President's office, and the ENTIRE office gets
one. This enforces the bijection **both ways**:

- a NON-office role carrying a Greek `call_sign` (the department leads) FAILS → strip it;
- a President-office role MISSING a Greek `call_sign` FAILS → assign one.

## What it does

Runs `node scripts/checks/greek-office-parity.js` (`--json`). Reads
`.claude/agents/_org/role-registry.json` and checks each role's `call_sign` (Greek-glyph test) against
its `home`. **Fail-closed** (exit 2) on an unreadable registry. **Wired REPORT-ONLY** in `/scan:full`.

Bite-test: `node scripts/checks/greek-office-parity.test.js` (both-direction planted violations + a
clean bijection + a live-registry pass).

## When to run

After any edit to a role's `call_sign` or `home` (registry), and as part of `/scan:full`. Pairs with
the surgical Greek-strip sweep that keeps spec frontmatter/body/org-docs in sync with the registry.
