---
description: Bidirectional coverage of the skill hook-point registry — REVERSE (registry coherent vs role-registry) + FORWARD (every registered skill has a command file) + HARDCODE/STALE (two asymmetric checks — no skill body names a renamed-away management persona ANYWHERE, and no skill dispatches a current persona via subagent_type or bold-backtick prose instead of resolving it at call time)
---

# /scan:skill-hook-coverage

The bidirectional coverage enforcer for the **skill hook-point registry** (`.claude/agents/_org/skill-hook-points.json`). The SKILLS sibling of `/scan:sprint-hook-coverage`: a **static** (no events) enforcer made self-detecting on the skill↔agent dispatch surface. Catches the rename-break class — a skill still naming a role the role-registry renamed away (e.g. `director-of-marketing` after a rename to `director-of-growth`) would fail to dispatch. <!-- stale-ok: documents the rename-break the check catches -->


Runs `scripts/checks/skill-hook-coverage.js`.

## The checks

**REVERSE (registry coherence).** Every registry entry's `role` exists in `role-registry.json`, every multi-row `hook_point` has exactly one `default`. Delegates to `scripts/skills/skill-hook-points.js` `validate()` (the same tripwire its own test asserts). A structurally-incoherent registry is **fail-closed (exit 2)**.

**FORWARD (coverage).** Every skill REGISTERED in the registry resolves to a real command file at `.claude/commands/<ns>/<name>.md` — a registered-but-phantom entry is `phantom_skill_entry`.

**HARDCODE / STALE — TWO ASYMMETRIC checks** over every `.claude/commands/**/*.md` body, scanned line-by-line:

**(1) STALE (persona-rename) — broad scope, persona-narrowed.** Any LINE that names a renamed-away **management persona** → `hardcoded_stale_role` (**HIGH** — a renamed-away persona name is always wrong, descriptive OR dispatch). The stale set (`personaStaleNames`) is the `was` values of roles whose id matches `/^director-/` OR `/-lead$/` — currently exactly **`director-of-marketing`, `growth-lead`, `web-conversion-designer`, `research-insight-lead`, `product-designer`, `director-of-qa`** (six). It **deliberately excludes worker scraps** (`redteam`, `qa`, `reviewer`, `compliance`, `fixer`, `req-reviewer`): those `was` values appear legitimately all over `.claude/commands` (skill names like `/redteam:full`, `/qa:audit`; dispatch docs), so flagging them would flood false positives. A line carrying the suppress marker **`stale-ok`** is skipped (e.g. this doc's own counter-example naming `director-of-marketing`).

**(2) CURRENT-persona DISPATCH — narrow scope (dispatch context only).** A current renameable persona (`personaRoles` = the skill-hook-points key-roles that are real role-registry ids) counts as a *dispatch* when EITHER (a) it follows a `subagent_type` key (`subagent_type` then the role id), OR (b) it appears **bold-backtick** (`` **`<role>`** ``) on a LINE that ALSO carries a dispatch keyword (`subagent`|`dispatch`|`resolve`|`consult`). A registered skill → `hardcoded_role` (should resolve via skill-hook-points at call time); an unregistered skill → `unregistered_persona_skill` (dispatches a persona but isn't registered). Stable faces + generics (`alpha`…`epsilon`, `general-purpose`, `builder`, `fixer`, `stub-scaffold`) are never flagged.

## Allowlist (migration-pending) + anti-rot

The allowlist (`MIGRATION_PENDING`) is currently **empty** — every agent-calling skill is expected to resolve its persona from the registry at call time, so any persona hardcode (a `subagent_type` literal OR a bold-backtick prose dispatch) FAILS the gate. When a migration is mid-flight a skill may be allowlisted: its hardcodes are tracked as **info**, not findings, so the gate ships green while the migration lands. The allowlist **must not rot**: an allowlisted skill that no longer hardcodes a persona role → `stale_allowlist_entry` (remove it from the allowlist), mirroring `/scan:scan-coverage`'s reasonless/stale self-flagging.

## Exit codes

- `0` — registry coherent, every registered skill has a file, 0 un-allowlisted persona-stale names and 0 un-allowlisted current-persona dispatches.
- `1` — ≥1 finding (`hardcoded_stale_role`, `hardcoded_role`, `unregistered_persona_skill`, `phantom_skill_entry`, or `stale_allowlist_entry` — outside the allowlist).
- `2` — fail-closed (unreadable/structurally-incoherent registry).

## Output

`--json` emits `{ ok, skills, command_files, persona_stale_names[], findings[], totalFindings, info }`. Default is a human summary; a FAIL lists the gaps.

## Bite-test

`node scripts/checks/skill-hook-coverage.test.js` — proves each finding-class fires on injected fixtures: a persona stale name in **descriptive prose** (no dispatch verb) → `hardcoded_stale_role`; the same on a `stale-ok` line → not flagged; a current persona **bold-backtick + "subagent"** in an unregistered skill → `unregistered_persona_skill`; a current persona bold-backtick with **no dispatch verb** → not flagged; a **worker-scrap** name (`redteam`, `qa`) anywhere → not flagged (the persona-narrowing proof); plus `subagent_type` hardcode (registered → `hardcoded_role`), the allowlist suppressing to info, allowlist-rot, phantom, generics/faces never flagged, a clean pass, and a real-tree integration run.
