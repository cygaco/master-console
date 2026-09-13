#!/usr/bin/env node
// Append the 4 Beta decisions from the SP-20260521-001 portfolio consult
// to paths.betaEvents + paths.decisionLedger so /sprint:design picks them up.

"use strict";
const fs = require("fs");
const path = require("path");

const betaEvents = ".claude/agents/00-alex/.system/beta/events.jsonl";
const ledger = ".claude/project/decisions/decision-ledger.jsonl";

const sprintId = "SP-20260521-001";
const pcId = "PC-20260521-0020";
const session = "sp-20260521-001";
const ts = "2026-05-21T20:30:37.240Z";

const entries = [
  {
    id: "EVT-s-sp-20260521-001-beta-001",
    ts,
    cat: "beta",
    actor: "beta",
    session,
    data: {
      question:
        "Privacy hotspot — should we git-filter-repo scrub _docs/briefs/<product-a> and _docs/clones/<product-b> from canonical public history?",
      category: "privacy",
      answer:
        "DECIDE (Class A, conf 0.92, REVISED). Add _docs/briefs/ and _docs/clones/ to .gitignore in canonical MC. No history rewrite needed — verified no commits exist for these paths. Backup-to-private-sibling is naturally covered by /products:from-brief once scope B lands.",
      escalated: false,
      confidence: 0.92,
      overridden: null,
      user_answer: null,
      topic_tags: [
        "privacy",
        "gitignore",
        "history-scrub-unneeded",
        "class-a",
      ],
      sprint_id: sprintId,
      artifact: pcId,
    },
  },
  {
    id: "EVT-s-sp-20260521-001-beta-002",
    ts,
    cat: "beta",
    actor: "beta",
    session,
    data: {
      question:
        "Registry location — ~/.mc/products.json (HOME) vs private GitHub registry repo vs canonical workspace repo?",
      category: "architecture",
      answer:
        "DECIDE (Class B, conf 0.85). HOME-dir ~/.mc/products.json. Matches mature CLI precedent (gh, nvm, cargo). Private-registry-repo adds auth + sync complexity for no concrete benefit at this stage. Workspace meta-repo is a meta-meta-layer. Future team-share is a one-line migration if needed.",
      escalated: false,
      confidence: 0.85,
      overridden: null,
      user_answer: null,
      topic_tags: [
        "registry",
        "products-portfolio",
        "home-dir",
        "class-b",
      ],
      sprint_id: sprintId,
      artifact: pcId,
    },
  },
  {
    id: "EVT-s-sp-20260521-001-beta-003",
    ts,
    cat: "beta",
    actor: "beta",
    session,
    data: {
      question:
        "Repo-creation automation — should /products:new run `gh repo create --private` (behind --create-remote flag) or always require explicit user execution?",
      category: "autonomy",
      answer:
        "DECIDE (Class B with red-line override, conf 0.88). /products:new scaffolds local sibling + runs /mc:setup, then HALTS and prints one line: 'Run `gh repo create <slug> --private --source=. --remote=origin --push` to create the GitHub repo.' User runs the gh command; α never does. Not a limitation — correct scope boundary. Turbo does NOT override the 'Ask first' red line per P-030 + §Two-gate authority. NOTE: this is STRICTER than the Plan Contract's --create-remote flag pattern. /sprint:design must drop the flag and adopt surface-only semantics.",
      escalated: false,
      confidence: 0.88,
      overridden: null,
      user_answer: null,
      topic_tags: [
        "autonomy",
        "gh-repo-create",
        "red-line",
        "scope-boundary",
        "class-b",
        "directive-supersedes-plan",
      ],
      sprint_id: sprintId,
      artifact: pcId,
    },
  },
  {
    id: "EVT-s-sp-20260521-001-beta-004",
    ts,
    cat: "beta",
    actor: "beta",
    session,
    data: {
      question:
        "Scope variant pick for SP-20260521-001 — A (registry-only) vs B (workspace orchestrator) vs C (portfolio OS)?",
      category: "scope",
      answer:
        "DECIDE (Class B, conf 0.84). Recommend B in the Plan Contract. B delivers the verbatim ask (/products:new, /products:from-brief, /products:status, /products:dispatch). A is too thin — no dispatch, no from-brief. C adds speculative infrastructure (cross-product memory, encrypted backup) the user hasn't asked for. If user later says 'do C too,' treat as authorized scope expansion. OPEN_ADR: true — products registry + new skill family + cross-repo dispatch from MC CWD is an architectural decision.",
      escalated: false,
      confidence: 0.84,
      overridden: null,
      user_answer: null,
      topic_tags: [
        "scope-variant",
        "recommended-B",
        "open-adr",
        "products-skills",
        "class-b",
      ],
      sprint_id: sprintId,
      artifact: pcId,
      OPEN_ADR: true,
    },
  },
];

fs.mkdirSync(path.dirname(betaEvents), { recursive: true });
for (const e of entries) {
  fs.appendFileSync(betaEvents, JSON.stringify(e) + "\n", "utf8");
}

const ledgerEntries = [
  {
    ts,
    id: "DEC-sp-20260521-001-001",
    sprint_id: sprintId,
    artifact: pcId,
    actor: "beta",
    class: "A",
    decision: "Gitignore _docs/briefs/ and _docs/clones/ in canonical MC",
    rationale:
      "No commits exist; trivially reversible; precedent matches Beta's revised Class A reclassification.",
    open_adr: false,
  },
  {
    ts,
    id: "DEC-sp-20260521-001-002",
    sprint_id: sprintId,
    artifact: pcId,
    actor: "beta",
    class: "B",
    decision: "Products registry lives at ~/.mc/products.json (HOME-dir)",
    rationale:
      "Matches gh/nvm/cargo precedent. Simpler than private-registry-repo or workspace meta-repo. Future team-share migration is one line.",
    open_adr: false,
  },
  {
    ts,
    id: "DEC-sp-20260521-001-003",
    sprint_id: sprintId,
    artifact: pcId,
    actor: "beta",
    class: "B-red-line",
    decision:
      "/products:new SURFACES the `gh repo create` command, never executes it. Drop the --create-remote flag from the Plan Contract.",
    rationale:
      "External-facing remote-creation is in the autonomy table at 'Ask first'. Turbo does not override the red line per P-030. Surface-only is the correct scope boundary.",
    open_adr: false,
    supersedes:
      "Plan Contract PC-20260521-0020 affected_surfaces + approval_boundaries draft language about --create-remote flag.",
  },
  {
    ts,
    id: "DEC-sp-20260521-001-004",
    sprint_id: sprintId,
    artifact: pcId,
    actor: "beta",
    class: "B",
    decision: "Sprint SP-20260521-001 ships scope variant B (recommended).",
    rationale:
      "Matches user's verbatim ask. A is too thin, C is speculative. OPEN_ADR true — new skill family + cross-repo dispatch is architectural.",
    open_adr: true,
  },
];

fs.mkdirSync(path.dirname(ledger), { recursive: true });
for (const e of ledgerEntries) {
  fs.appendFileSync(ledger, JSON.stringify(e) + "\n", "utf8");
}

console.log(
  `Logged ${entries.length} beta events + ${ledgerEntries.length} ledger entries for ${sprintId}.`,
);
