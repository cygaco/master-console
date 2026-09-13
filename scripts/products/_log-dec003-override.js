#!/usr/bin/env node
// Log the user-authorized override of Beta DEC-003 (surface-only gh repo create).
// User selected option B: auto-create at 2026-05-21T21:XX (this session).

"use strict";
const fs = require("fs");
const path = require("path");

const betaEvents = ".claude/agents/00-alex/.system/beta/events.jsonl";
const ledger = ".claude/project/decisions/decision-ledger.jsonl";
const sprintId = "SP-20260521-001";
const pcId = "PC-20260521-0021";
const session = "sp-20260521-001";
const ts = new Date().toISOString();

// Beta event: mark DEC-003 as overridden
fs.appendFileSync(
  betaEvents,
  JSON.stringify({
    id: "EVT-s-sp-20260521-001-beta-008-override",
    ts,
    cat: "beta",
    actor: "alpha-overrides-beta",
    session,
    data: {
      question:
        "USER OVERRIDE of Beta DEC-003. User responded 'option b' (auto-create) to Alpha's surface-walkthrough + recommendation of option C (hybrid confirm).",
      category: "autonomy-override",
      answer:
        "OVERRIDDEN by user (cygaco, plain prose 'option b'). Beta's DEC-003 (Class B with red-line override) said /portfolio:new SURFACES the gh repo create command and halts. User authorization flips to: /portfolio:new + /portfolio:adopt EXECUTE `gh repo create <slug> --private --source=. --remote=origin --push` directly after the scaffold + /mc:setup steps. No interactive confirm prompt (would have been option C; user picked B). Per CLAUDE.md decision-policy, user override of Beta is a recognized authority — Alpha may proceed.",
      escalated: false,
      confidence: 1.0,
      overridden: "EVT-s-sp-20260521-001-beta-003 (DEC-003 surface-only)",
      user_answer: "option b",
      topic_tags: [
        "user-override",
        "dec-003",
        "auto-create",
        "gh-repo-create",
        "autonomy",
        "private-repos",
      ],
      sprint_id: sprintId,
      artifact: pcId,
    },
  }) + "\n",
  "utf8",
);

// Decision ledger: the override
fs.appendFileSync(
  ledger,
  JSON.stringify({
    ts,
    id: "DEC-sp-20260521-001-008",
    sprint_id: sprintId,
    artifact: pcId,
    actor: "user-via-alpha",
    class: "C",
    decision:
      "USER OVERRIDE of Beta DEC-003. /portfolio:new + /portfolio:adopt now EXECUTE `gh repo create <slug> --private --source=. --remote=origin --push` automatically after local scaffold + /mc:setup. No interactive confirm. Slug regex (IN-1) is the only injection defense; gh's own idempotency handles name collisions.",
    rationale:
      "User picked option B from Alpha's A/B/C menu. Original Beta directive (DEC-003 surface-only) was protective against typo-leaks; user accepts that residual risk in exchange for one-command product creation. Slug regex `^[a-z0-9][a-z0-9-]{0,63}$` precludes shell metacharacters. The user's verbatim ask in /sprint:plan ('side-by-side repos with private GitHub, accessible to team') is more cleanly satisfied by auto-create than by surface-only.",
    overrides: "DEC-sp-20260521-001-003 (Beta DEC-003 surface-only)",
    user_authorization: "cygaco verbatim 'option b' at 2026-05-21T~21:18Z in adhoc+turbo session",
    open_adr: true,
    new_safety_surface: [
      "Typo'd slug → creates a misnamed private repo the user has to delete via `gh repo delete`",
      "gh authentication failure → /portfolio:new must surface the failure clearly + not leave the user in a half-scaffolded state (must rollback local repo OR leave it locally with clear note)",
      "gh rate limit → /portfolio:sync running across 5+ products in batch may hit gh rate limits"
    ],
    new_invariants: [
      "Always --private. Never --public. Hardcoded in the gh invocation.",
      "Always idempotent: if repo with this name already exists on user's account, treat as success (already-private?) or fail loudly (already-public?). Implementation must check.",
      "Slug regex IN-1 enforced BEFORE gh invocation. Defense-in-depth."
    ],
  }) + "\n",
  "utf8",
);

console.log(
  `Logged user override of DEC-003 for ${sprintId} (artifact ${pcId}). New DEC-008 in ledger.`,
);
