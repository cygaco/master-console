#!/usr/bin/env node
"use strict";

/**
 * scripts/trackers/init.js — INITIALIZER for the enforced tracker system.
 *
 * The companion to scripts/trackers/validate.js. validate.js refuses a tracker
 * that drifted from reality; init.js SCAFFOLDS a fresh, validator-GREEN tracker
 * structure into a consumer repo that has the validator (shipped by the capsule)
 * but no TRACKER.md / dirs / seed yet. Without this, a consumer can run the
 * validator but has nothing to validate.
 *
 * WHAT IT CREATES / ENSURES (idempotent, read-before-write):
 *   - trackers/ , trackers/epics/ , trackers/sprints/  (epics/sprints empty
 *     except a .gitkeep so the §33 required dirs exist with no active items —
 *     cross-file-reconciliation + epics-in-roadmap stay vacuous, i.e. green).
 *   - TRACKER.md — a SEED carrying ALL 34 §5 sections (validate.js
 *     REQUIRED_SECTIONS + the Header version/owner/authority contract), every
 *     section non-blank (real content or the `None currently recorded.`
 *     sentinel), NO active epics/sprints, NO broken intra-repo links, every
 *     §8 core term defined, the enforcement-hook gap acknowledged in Known Gaps,
 *     and NO parseable session-log entry (so work-log-session-id is vacuous).
 *   - UNTRACKED_WORK.md — from trackers/templates/UNTRACKED_WORK_TEMPLATE.md if
 *     present, else a valid seed.
 *   - ROADMAP.md — ensured epic-based: created with a `## Epics` section if
 *     absent; if present but missing `## Epics`, the section is ADDITIVELY
 *     appended (existing content untouched). A live (non-DEPRECATED) Milestones
 *     heading is left alone here (rewriting it is /roadmap's job) but flagged.
 *
 * TEMPLATES are FRAMEWORK content shipped by the capsule (trackers/templates/*).
 * This initializer does NOT generate them; it assumes they exist at the target.
 * (validate.js §33 requires the 9 named templates — the capsule ships them.)
 *
 * SAFETY:
 *   - Never clobbers an existing TRACKER.md / ROADMAP.md / UNTRACKED_WORK.md
 *     unless --force. Re-runs are safe (idempotent).
 *   - --root <dir> targets a repo other than cwd (default = cwd).
 *   - --dry-run prints what it WOULD do without writing.
 *
 *   node scripts/trackers/init.js                 # scaffold into cwd
 *   node scripts/trackers/init.js --root <dir>     # scaffold into <dir>
 *   node scripts/trackers/init.js --force          # overwrite existing seeds
 *   node scripts/trackers/init.js --dry-run        # preview, no writes
 *
 * Exit: 0 success · 2 usage / runner error.
 */

const fs = require("fs");
const path = require("path");

const NAME = "trackers/init";
const TODAY = new Date().toISOString().slice(0, 10);

// ── §5: the 34 required TRACKER.md sections, in spec order. Kept in lockstep
// with scripts/trackers/validate.js REQUIRED_SECTIONS — the seed must render a
// heading for every one of these (Header is the `# TRACKER.md` title block). ──
const SECTION_ORDER = [
  "Header",
  "How to Use This Document",
  "Authority and Conflict Resolution",
  "Definitions",
  "System Inventory",
  "Verification Matrix",
  "Active Epics",
  "Active Sprints",
  "Planned but Not Started Epics",
  "Planned but Not Started Sprints",
  "Completed Epics",
  "Completed Sprints",
  "Cancelled or Superseded Work",
  "Untracked Work",
  "State Model",
  "Percent Completion Rules",
  "Language Rules",
  "Update Triggers",
  "Enforcement Requirements",
  "Validation Requirements",
  "Roadmap Rules",
  "Epic Tracker Rules",
  "Sprint Tracker Rules",
  "Session Logging Rules",
  "Change Tracking Rules",
  "Evidence Rules",
  "Definition of Done",
  "Reconciliation Rules",
  "Required Files",
  "Required Wirings",
  "Required Templates",
  "Implementation Priority",
  "Non-Negotiable Requirements",
  "Known Gaps and Open Flaws",
];

// ── §8: the core operational terms the validator's undefined-terms check will
// demand a definition for IF they appear in a non-Definitions section body. The
// seed defines ALL of them, so the check is satisfied regardless of which terms
// the prose uses. Kept in lockstep with validate.js CORE_TERMS. ──
const CORE_TERMS = [
  ["Epic", "A large, multi-sprint unit of long-running work tracked end-to-end; the primary organizing unit of the roadmap (one roadmap item == one epic)."],
  ["Sprint", "A bounded unit of work that delivers part of an epic; every sprint names a parent epic."],
  ["Task", "The smallest unit of tracked work inside a sprint or epic."],
  ["Tracker", "A written record of the state of work — this `TRACKER.md` and the per-epic/per-sprint files under `/trackers/`."],
  ["Source of truth", "The authoritative written record; `TRACKER.md` is the highest such record and outranks memory, chat, and informal summaries."],
  ["State", "The lifecycle position of an item — one of Planned, Active, Blocked, Review, Completed, Cancelled, or Superseded."],
  ["Percent completion", "An integer 0–100 estimating how much of an item's defined scope is done; a completed item is always 100%."],
  ["Completion", "The condition of an item having met its Definition of Done, recorded at 100% with evidence."],
  ["Verification", "Confirming a claim (a path exists, a state holds) against disk, git, or a command — not memory."],
  ["Evidence", "A concrete artifact proving a claim — a commit hash, a command output, a file path, or a record."],
  ["Blocker", "A dependency or condition that prevents an item from progressing until resolved."],
  ["Dependency", "Another item or artifact an item requires in order to proceed or complete."],
  ["Scope", "The agreed boundary of what an item will and will not deliver."],
  ["Change log", "A dated record of changes made to an item, definition, or document."],
  ["Session log", "A dated record of a meaningful work session, naming a session ID, date, and work performed."],
  ["Untracked work", "Meaningful work performed outside a formal epic or sprint, captured in `UNTRACKED_WORK.md` for later reconciliation."],
  ["Reconciliation", "Periodically resolving recorded state against reality and against linked files, fixing any disagreement."],
  ["Superseded", "An item replaced by a newer item; retained for history, no longer active."],
  ["Cancelled", "An item abandoned before completion; retained for history, no longer active."],
  ["Next action", "The single concrete next step for an active item, recorded so work is resumable from the file alone."],
  ["Definition of done", "The explicit conditions an item must meet before it may be marked completed."],
  ["System Inventory", "The catalog of systems, files, and components this tracker is responsible for knowing the state of."],
  ["Verification Matrix", "The table mapping claims (paths, states, wirings) to their verification status and method."],
  ["Wiring", "A connection between a policy and its enforcer — a hook registration, a gate, a scan, a CI check."],
  ["Validator", "A deterministic, fail-closed check that refuses a tracker that has drifted from reality (`scripts/trackers/validate.js`)."],
  ["Path", "A repo-relative file or directory location referenced by the tracker; required paths must exist on disk."],
  ["Known gap", "An acknowledged missing enforcer or unbuilt piece, recorded so its absence is visible rather than hidden."],
  ["Agentic OS", "The autonomous agent operating system this tracker governs — the MC framework substrate."],
];

// ── arg parsing ───────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const opts = { root: process.cwd(), force: false, dryRun: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") {
      opts.root = argv[++i];
      if (!opts.root) throw new Error("--root requires a directory argument");
    } else if (a === "--force") opts.force = true;
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return opts;
}

// ── small fs helpers ──────────────────────────────────────────────────────────
function exists(p) {
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
}
function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

// ── seed builders (pure) ───────────────────────────────────────────────────────

const SENTINEL = "None currently recorded.";

/**
 * Render the seed TRACKER.md. Every section is an H1 heading (validate.js splits
 * the doc at H1 and treats each required §5 name as such), Header is the
 * `# TRACKER.md` title block with Version/Owner/Authority lines, Definitions
 * carries a `## Definition: <Term>` H2 for every core term, and every other
 * section is either real seed content or the `None currently recorded.` sentinel.
 *
 * Deliberate validator-green choices for an EMPTY scaffold:
 *   - No items in any Active/Planned/Completed Epics/Sprints section → checks
 *     d–i and cross-file-reconciliation are vacuous.
 *   - Only intra-repo links are to files this initializer guarantees exist
 *     (ROADMAP.md, UNTRACKED_WORK.md, the trackers/ dirs + templates).
 *   - Session Logging Rules carries RULES PROSE ONLY — no `Session ID:` field
 *     and no `… session log:` entry header — so parseSessionLogEntries() returns
 *     [] and work-log-session-id is vacuous.
 *   - Known Gaps acknowledges the unbuilt enforcement hooks (the words "hook" +
 *     "completion-gate"/"start-of-work") so hooks-enforce-or-tracked passes.
 *   - No "Verified Nonexistent" rows → expected-nonexistence is vacuous.
 *   - No ambiguous §21 phrases outside the Language Rules section.
 */
function renderTracker() {
  const defs = CORE_TERMS.map(
    ([term, def]) =>
      `## Definition: ${term}\n\n` +
      `- **Term:** ${term}\n` +
      `- **Definition:** ${def}\n` +
      `- **Why it matters:** keeps state and authority reasoning unambiguous across sessions.\n` +
      `- **Where it applies:** this tracker, the epic/sprint files, the modes, and \`scripts/trackers/validate.js\`.`
  ).join("\n\n");

  const bodies = {
    "How to Use This Document":
      "This section is operational instructions, not passive documentation. Before any " +
      "meaningful work that could affect the roadmap, an epic, a sprint, a definition, " +
      "wiring, validation, or Agentic OS state, the agent must:\n\n" +
      "1. Open or inspect this `TRACKER.md`.\n" +
      "2. Identify whether the work belongs to an existing epic/sprint, planned work, completed work being revisited, untracked work, or a new epic/sprint to create.\n" +
      "3. Check the Definitions section for relevant terminology.\n" +
      "4. Confirm the current state and the next action of the relevant item.\n" +
      "5. Confirm blockers, dependencies, and whether the roadmap needs updating.\n\n" +
      "This is a freshly initialized tracker: there is no active or planned work yet. " +
      "Add epics/sprints under their sections (one `### <LABEL>` item each) and re-run " +
      "`node scripts/trackers/validate.js` to confirm the tracker stays honest.",

    "Authority and Conflict Resolution":
      "`TRACKER.md` is the highest written source of truth for long-running work. It " +
      "outranks built-in memory, chat memory, implied context, informal summaries, agent " +
      "assumptions, old roadmap language, and unverified wiring assumptions. On conflict, " +
      "the written tracker wins; resolve the disagreement by reconciling the tracker " +
      "against verified reality (disk, git, command output), then updating the tracker.",

    "Definitions":
      "Operational definitions for the core terms used throughout this tracker. Each is " +
      "how the term is used INSIDE this system (§8), not its dictionary meaning. " +
      "Definitions here outrank memory, old roadmap files, sprint notes, plans, and chat.\n\n" +
      defs,

    "System Inventory":
      "The catalog of tracked systems and artifacts. On a fresh scaffold, only the tracker " +
      "system's own required artifacts exist:\n\n" +
      "- `TRACKER.md` — this document. Verified Exists.\n" +
      "- [`ROADMAP.md`](ROADMAP.md) — the epic-based roadmap. Verified Exists.\n" +
      "- [`UNTRACKED_WORK.md`](UNTRACKED_WORK.md) — untracked-work log. Verified Exists.\n" +
      "- [`trackers/`](trackers/) — per-epic/per-sprint tracker files, templates, and records. Verified Exists.\n" +
      "- [`trackers/epics/`](trackers/epics/) — epic tracker files (none yet). Verified Exists.\n" +
      "- [`trackers/sprints/`](trackers/sprints/) — sprint tracker files (none yet). Verified Exists.\n" +
      "- [`trackers/templates/`](trackers/templates/) — the tracker templates (shipped by the framework). Verified Exists.\n\n" +
      "No application systems are inventoried yet — add rows as the product grows.",

    "Verification Matrix":
      "Claims about paths, states, and wirings mapped to their verification status. On a " +
      "fresh scaffold the only verified claims are the tracker system's required paths " +
      "(all Verified Exists — see System Inventory). " +
      "There are no `Verified Nonexistent` rows yet. Add a row per claim as work begins.",

    "Active Epics": SENTINEL,
    "Active Sprints": SENTINEL,
    "Planned but Not Started Epics": SENTINEL,
    "Planned but Not Started Sprints": SENTINEL,
    "Completed Epics": SENTINEL,
    "Completed Sprints": SENTINEL,
    "Cancelled or Superseded Work": SENTINEL,
    "Untracked Work":
      "Meaningful work performed outside a formal epic or sprint is captured in " +
      "[`UNTRACKED_WORK.md`](UNTRACKED_WORK.md) and periodically reconciled into the proper " +
      "structure. " + SENTINEL,

    "State Model":
      "Every tracked item carries exactly one state:\n\n" +
      "- **Planned** — defined but not started.\n" +
      "- **Active** — in progress; must name a next action.\n" +
      "- **Blocked** — cannot progress until a dependency/blocker is resolved.\n" +
      "- **Review** — work done, awaiting verification.\n" +
      "- **Completed** — Definition of Done met, recorded at 100% with evidence.\n" +
      "- **Cancelled** — abandoned before completion; retained for history.\n" +
      "- **Superseded** — replaced by a newer item; retained for history.",

    "Percent Completion Rules":
      "Percent completion is an integer 0–100 estimating how much of an item's defined " +
      "scope is done. A completed item is always 100%; an item at 100% must be marked " +
      "completed. Percent is an estimate of scope, not of effort or time.",

    "Language Rules":
      "Tracker state must be written precisely. The following ambiguous-state phrases are " +
      "PROHIBITED because they hide whether work is actually done or verified: " +
      "\"likely done\", \"probably complete\", \"probably done\", \"mostly handled\", " +
      "\"mostly done\", \"should be fine\", \"seems done\", \"seems complete\", " +
      "\"basically finished\", \"basically done\", \"assume this is complete\", " +
      "\"no need to track\", \"memory has it\", \"this is obvious\". " +
      "State a concrete percent + next action + evidence instead.",

    "Update Triggers":
      "Update this tracker when: starting, resuming, planning, creating, updating, or " +
      "completing an epic or sprint; cancelling or superseding work; changing scope; " +
      "discovering or resolving a blocker; changing definitions; verifying paths/wiring; " +
      "working outside a sprint; preparing a handoff; or reconciling state.",

    "Enforcement Requirements":
      "Every rule in this tracker needs a named enforcer. The primary enforcer is " +
      "`scripts/trackers/validate.js` (the fail-closed validator, run via " +
      "`node scripts/trackers/validate.js`). Start-of-work and completion-gate enforcement " +
      "hooks are an acknowledged gap — see Known Gaps and Open Flaws.",

    "Validation Requirements":
      "The tracker must pass `node scripts/trackers/validate.js` (exit 0). The validator " +
      "asserts all 34 sections are present and non-blank, no broken intra-repo links, " +
      "active items name a next action, completed items carry evidence and are 100%, " +
      "100% items are completed, sprints name a parent epic, no ambiguous-state language, " +
      "no undefined operational terms, the required paths exist, and the cross-file " +
      "invariants (epic-based roadmap, epics in roadmap, modes consult the tracker, " +
      "session-log identity, expected nonexistence, cross-file state reconciliation, " +
      "enforcement-or-tracked hooks, no definition drift) hold. Run it after every edit.",

    "Roadmap Rules":
      "[`ROADMAP.md`](ROADMAP.md) is epic-based: its `## Epics` section is the authoritative " +
      "epic registry (one roadmap item == one epic, §29). Every `trackers/epics/E-*.md` " +
      "epic file's ID must be referenced in `ROADMAP.md`. Milestone-based structures are " +
      "deprecated; any retained `## …Milestones` heading must be marked DEPRECATED.",

    "Epic Tracker Rules":
      "Each epic gets a file under [`trackers/epics/`](trackers/epics/) named " +
      "`E-<NAME>-<NNN>-<slug>.md`, created from " +
      "[`trackers/templates/EPIC_TEMPLATE.md`](trackers/templates/EPIC_TEMPLATE.md). It " +
      "records goal, state, percent, next action, evidence, related sprints, and " +
      "dependencies. The epic's state in its file must agree with its state in this tracker.",

    "Sprint Tracker Rules":
      "Each sprint gets a file under [`trackers/sprints/`](trackers/sprints/) created from " +
      "[`trackers/templates/SPRINT_TEMPLATE.md`](trackers/templates/SPRINT_TEMPLATE.md). " +
      "Every sprint names a parent epic. The sprint's state in its file must agree with its " +
      "state in this tracker.",

    "Session Logging Rules":
      "Every meaningful work session on an epic or sprint must be logged. Each session-log " +
      "entry must include: a session ID; the date; and the work performed. Use " +
      "[`trackers/templates/SESSION_LOG_TEMPLATE.md`](trackers/templates/SESSION_LOG_TEMPLATE.md). " +
      "If a session ID is not yet known, an entry must carry the explicit backfill sentinel " +
      "rather than omitting identity. " + SENTINEL,

    "Change Tracking Rules":
      "Material changes to an item, a definition, or this document are recorded with a date, " +
      "the change, and the reason, using " +
      "[`trackers/templates/CHANGE_LOG_TEMPLATE.md`](trackers/templates/CHANGE_LOG_TEMPLATE.md).",

    "Evidence Rules":
      "Every completion claim records concrete evidence — a commit hash, a command output, " +
      "a file path, or a record — verifiable against disk or git, captured via " +
      "[`trackers/templates/EVIDENCE_LOG_TEMPLATE.md`](trackers/templates/EVIDENCE_LOG_TEMPLATE.md). " +
      "No evidence, not complete.",

    "Definition of Done":
      "An item may be marked completed only when: its defined scope is delivered; percent " +
      "completion is 100%; evidence is recorded and verifiable; its state in its linked " +
      "epic/sprint file agrees with this tracker; and `node scripts/trackers/validate.js` " +
      "passes.",

    "Reconciliation Rules":
      "Periodically reconcile recorded state against reality and against linked files, " +
      "using [`trackers/templates/RECONCILIATION_TEMPLATE.md`](trackers/templates/RECONCILIATION_TEMPLATE.md). " +
      "Any disagreement between this tracker and a linked file, disk, or git is a defect to " +
      "fix at the source, then re-validate.",

    "Required Files":
      "The tracker system requires these files to exist:\n\n" +
      "- [`TRACKER.md`](TRACKER.md)\n" +
      "- [`ROADMAP.md`](ROADMAP.md)\n" +
      "- [`UNTRACKED_WORK.md`](UNTRACKED_WORK.md)",

    "Required Wirings":
      "The validator (`scripts/trackers/validate.js`) is the standing wiring that enforces " +
      "these rules; it should be run after every tracker edit and is wired into the " +
      "project's scan suite where available. Hard start-of-work / completion-gate hooks are " +
      "an acknowledged gap — see Known Gaps and Open Flaws.",

    "Required Templates":
      "The framework ships these templates under " +
      "[`trackers/templates/`](trackers/templates/):\n\n" +
      "- [`EPIC_TEMPLATE.md`](trackers/templates/EPIC_TEMPLATE.md)\n" +
      "- [`SPRINT_TEMPLATE.md`](trackers/templates/SPRINT_TEMPLATE.md)\n" +
      "- [`SESSION_LOG_TEMPLATE.md`](trackers/templates/SESSION_LOG_TEMPLATE.md)\n" +
      "- [`UNTRACKED_WORK_TEMPLATE.md`](trackers/templates/UNTRACKED_WORK_TEMPLATE.md)\n" +
      "- [`DEFINITION_TEMPLATE.md`](trackers/templates/DEFINITION_TEMPLATE.md)\n" +
      "- [`CHANGE_LOG_TEMPLATE.md`](trackers/templates/CHANGE_LOG_TEMPLATE.md)\n" +
      "- [`EVIDENCE_LOG_TEMPLATE.md`](trackers/templates/EVIDENCE_LOG_TEMPLATE.md)\n" +
      "- [`VERIFICATION_TEMPLATE.md`](trackers/templates/VERIFICATION_TEMPLATE.md)\n" +
      "- [`RECONCILIATION_TEMPLATE.md`](trackers/templates/RECONCILIATION_TEMPLATE.md)",

    "Implementation Priority":
      "1. Keep this tracker validator-green (`node scripts/trackers/validate.js` exit 0).\n" +
      "2. Register real epics in `ROADMAP.md` § Epics, each with a `trackers/epics/` file.\n" +
      "3. Run sprints under their parent epics, logging sessions and evidence.\n" +
      "4. Reconcile regularly; close the enforcement-hook gap when ready.",

    "Non-Negotiable Requirements":
      "- The tracker must never lie about state — no ambiguous-state language, no " +
      "unverified claims.\n" +
      "- A completed item is 100% with evidence; a 100% item is completed.\n" +
      "- Every required path exists; every intra-repo link resolves.\n" +
      "- The validator must pass before claiming any epic/sprint complete.",

    "Known Gaps and Open Flaws":
      "### G-1 — Tracker enforcement hooks pending\n\n" +
      "- **Description:** the hard start-of-work and completion-gate enforcement hooks for " +
      "the tracker system are not built yet in this freshly initialized repo. The standing " +
      "enforcer is the validator (`scripts/trackers/validate.js`); the start-of-work / " +
      "completion-gate hook absence is acknowledged here so the gap is visible rather than " +
      "hidden.\n" +
      "- **State:** Recorded; no enforcement hook wired yet. Close by building the " +
      "start-of-work and completion-gate hooks and registering them in the hook settings.",
  };

  const headerBlock = [
    "# TRACKER.md",
    "",
    "Version: 1.0.0",
    "",
    "Owner: President Agent",
    "",
    `Last Updated: ${TODAY} (initialized by scripts/trackers/init.js — empty scaffold)`,
    "",
    `Last Validation: ${TODAY} — pending first \`node scripts/trackers/validate.js\` run`,
    "",
    "Validation Status: Initialized — run `node scripts/trackers/validate.js` to confirm (expected: all checks pass, exit 0).",
    "",
    "Authority: Highest written source of truth for active, planned, completed, cancelled, " +
      "superseded, untracked, definition-bound, and verification-bound long-running work. " +
      "`TRACKER.md` outranks built-in memory, chat memory, implied context, informal " +
      "summaries, agent assumptions, old roadmap language, and unverified wiring " +
      "assumptions. See \"Authority and Conflict Resolution\" for the full order.",
    "",
    "Purpose: The highest written source of truth for long-running work, so an agent can " +
      "resume any large goal from written files alone — knowing what exists, what is " +
      "active, planned, done, verified, or missing, and what the next action is — with no " +
      "dependence on memory.",
  ].join("\n");

  const parts = [];
  for (const section of SECTION_ORDER) {
    if (section === "Header") {
      parts.push(headerBlock);
      continue;
    }
    parts.push(`# ${section}\n\n${bodies[section]}`);
  }
  return parts.join("\n\n---\n\n") + "\n";
}

/** Seed UNTRACKED_WORK.md (used only when the template is absent). */
function renderUntrackedWorkSeed() {
  return [
    "# UNTRACKED_WORK.md",
    "",
    "Meaningful work performed OUTSIDE a formal epic or sprint is captured here, then",
    "periodically reconciled into the proper structure (spec §18 / §31). One entry per item;",
    "use `trackers/templates/UNTRACKED_WORK_TEMPLATE.md` as the entry shape.",
    "",
    "## Entries",
    "",
    "None currently recorded.",
    "",
  ].join("\n");
}

/** The `## Epics` section appended to (or seeded into) ROADMAP.md. */
function epicsSection() {
  return [
    "## Epics",
    "",
    "> This roadmap is **epic-based** (spec §29 — one roadmap item == one epic). Each epic",
    "> below has a goal, state, completion %, and a file under `trackers/epics/`. Authority",
    "> and state definitions: [TRACKER.md](TRACKER.md).",
    "",
    "### Active epics",
    "",
    "None currently recorded.",
    "",
    "### Planned epics",
    "",
    "None currently recorded.",
    "",
    "### Completed epics",
    "",
    "None currently recorded.",
    "",
  ].join("\n");
}

/** Seed ROADMAP.md (used only when ROADMAP.md is absent). */
function renderRoadmapSeed() {
  return [
    "# Roadmap",
    "",
    "The product roadmap, organized by **epic** (the primary unit). Add epics under the",
    "`## Epics` section below, each backed by a `trackers/epics/E-*.md` file referenced by",
    "its ID. State and authority: [TRACKER.md](TRACKER.md).",
    "",
    epicsSection(),
  ].join("\n");
}

// ── plan + apply ───────────────────────────────────────────────────────────────

/**
 * Compute the set of filesystem actions to bring `root` to a validator-green
 * tracker scaffold, WITHOUT performing them. Pure w.r.t. decisions; reads disk
 * only to decide create-vs-skip (read-before-write). Returns { actions, notes }.
 */
function plan(root, force) {
  const actions = []; // { kind: "mkdir"|"write", target (abs), rel, reason, content? }
  const notes = [];
  const rel = (p) => path.relative(root, p) || ".";

  // 1. dirs (+ .gitkeep for the two that must exist but stay empty).
  const dirs = ["trackers", "trackers/epics", "trackers/sprints"];
  for (const d of dirs) {
    const abs = path.join(root, d);
    if (!exists(abs)) actions.push({ kind: "mkdir", target: abs, rel: rel(abs), reason: "create required dir" });
  }
  for (const d of ["trackers/epics", "trackers/sprints"]) {
    const keep = path.join(root, d, ".gitkeep");
    if (!exists(keep)) actions.push({ kind: "write", target: keep, rel: rel(keep), reason: "keep empty dir tracked", content: "" });
  }

  // 2. TRACKER.md — never clobber unless --force.
  const trackerAbs = path.join(root, "TRACKER.md");
  if (!isFile(trackerAbs) || force) {
    actions.push({
      kind: "write",
      target: trackerAbs,
      rel: rel(trackerAbs),
      reason: isFile(trackerAbs) ? "overwrite seed (--force)" : "create seed",
      content: renderTracker(),
    });
  } else {
    notes.push("TRACKER.md already exists — left untouched (pass --force to reseed).");
  }

  // 3. UNTRACKED_WORK.md — prefer the shipped template, else a valid seed.
  const uwAbs = path.join(root, "UNTRACKED_WORK.md");
  if (!isFile(uwAbs) || force) {
    const tmpl = path.join(root, "trackers", "templates", "UNTRACKED_WORK_TEMPLATE.md");
    let content;
    let reason = isFile(uwAbs) ? "overwrite (--force)" : "create";
    if (isFile(tmpl)) {
      content = renderUntrackedWorkFromTemplate(fs.readFileSync(tmpl, "utf8"));
      reason += " from UNTRACKED_WORK_TEMPLATE.md";
    } else {
      content = renderUntrackedWorkSeed();
      reason += " (template absent — using built-in seed)";
    }
    actions.push({ kind: "write", target: uwAbs, rel: rel(uwAbs), reason, content });
  } else {
    notes.push("UNTRACKED_WORK.md already exists — left untouched (pass --force to reseed).");
  }

  // 4. ROADMAP.md — ensure epic-based, additively.
  const roadmapAbs = path.join(root, "ROADMAP.md");
  if (!isFile(roadmapAbs)) {
    actions.push({ kind: "write", target: roadmapAbs, rel: rel(roadmapAbs), reason: "create epic-based roadmap", content: renderRoadmapSeed() });
  } else {
    const cur = fs.readFileSync(roadmapAbs, "utf8");
    const hasEpics = /^##\s+Epics\b/im.test(cur);
    if (!hasEpics) {
      const next = cur.replace(/\s*$/, "") + "\n\n---\n\n" + epicsSection();
      actions.push({ kind: "write", target: roadmapAbs, rel: rel(roadmapAbs), reason: "ADD `## Epics` section (existing content preserved)", content: next });
    } else {
      notes.push("ROADMAP.md already has a `## Epics` section — left untouched.");
    }
    // Flag a live (non-DEPRECATED) Milestones heading; do NOT rewrite it here.
    for (const line of cur.split(/\r?\n/)) {
      if (/^##\s+/.test(line) && /milestones/i.test(line) && !/deprecated/i.test(line)) {
        notes.push(`ROADMAP.md has a LIVE (non-DEPRECATED) Milestones heading: "${line.trim()}" — mark it DEPRECATED via /roadmap to satisfy roadmap-epic-based.`);
        break;
      }
    }
  }

  return { actions, notes };
}

/**
 * Adapt the UNTRACKED_WORK template into a valid, non-placeholder seed file. The
 * raw template is an HTML-comment block + a placeholder `### UW-<NNN>` entry full
 * of `<angle-bracket>` tokens — pasting it verbatim would ship dangling
 * placeholders. We keep the template's guidance comment but replace the
 * placeholder entry with the explicit empty sentinel so the seed is honest.
 */
function renderUntrackedWorkFromTemplate(tmplRaw) {
  const m = /^(\s*<!--[\s\S]*?-->)/.exec(tmplRaw);
  const comment = m ? m[1].trim() : null;
  const head = comment
    ? comment + "\n\n"
    : "<!-- Meaningful work performed OUTSIDE a formal epic or sprint (spec §18 / §31). -->\n\n";
  return (
    "# UNTRACKED_WORK.md\n\n" +
    head +
    "Meaningful work performed outside a formal epic or sprint is captured here, then\n" +
    "periodically reconciled into the proper structure. One entry per item, using the\n" +
    "`trackers/templates/UNTRACKED_WORK_TEMPLATE.md` shape.\n\n" +
    "## Entries\n\n" +
    "None currently recorded.\n"
  );
}

function apply(actions, dryRun) {
  for (const a of actions) {
    if (dryRun) {
      process.stdout.write(`  would ${a.kind === "mkdir" ? "mkdir" : "write"}  ${a.rel}  (${a.reason})\n`);
      continue;
    }
    if (a.kind === "mkdir") {
      fs.mkdirSync(a.target, { recursive: true });
      process.stdout.write(`  mkdir  ${a.rel}  (${a.reason})\n`);
    } else {
      fs.mkdirSync(path.dirname(a.target), { recursive: true });
      fs.writeFileSync(a.target, a.content, "utf8");
      process.stdout.write(`  write  ${a.rel}  (${a.reason})\n`);
    }
  }
}

// ── main ──────────────────────────────────────────────────────────────────────
function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`${NAME}: ${e.message}\n`);
    process.exit(2);
  }
  if (opts.help) {
    process.stdout.write(
      `Usage: node scripts/trackers/init.js [--root <dir>] [--force] [--dry-run]\n` +
        `  Scaffold a validator-green enforced-tracker structure into a repo.\n` +
        `  --root <dir>  target repo (default: cwd)\n` +
        `  --force       overwrite an existing TRACKER.md / ROADMAP.md / UNTRACKED_WORK.md\n` +
        `  --dry-run     print the plan without writing\n` +
        `Exit: 0 success · 2 usage/runner error\n`
    );
    process.exit(0);
  }

  const root = path.resolve(opts.root);
  if (!exists(root)) {
    process.stderr.write(`${NAME}: --root does not exist: ${root}\n`);
    process.exit(2);
  }

  let result;
  try {
    result = plan(root, opts.force);
    process.stdout.write(`${NAME}: ${opts.dryRun ? "DRY-RUN — would scaffold" : "scaffolding"} tracker system into ${root}\n`);
    apply(result.actions, opts.dryRun);
  } catch (e) {
    process.stderr.write(`${NAME}: runner error (fail-closed): ${e.message}\n`);
    process.exit(2);
  }

  for (const n of result.notes) process.stdout.write(`  note   ${n}\n`);

  // Warn (do not fail) if the shipped templates are missing — validate.js §33
  // required-paths will FAIL until the capsule ships them. Surfacing it here
  // makes the dependency explicit at init time.
  const missingTemplates = [
    "EPIC_TEMPLATE.md",
    "SPRINT_TEMPLATE.md",
    "SESSION_LOG_TEMPLATE.md",
    "UNTRACKED_WORK_TEMPLATE.md",
    "DEFINITION_TEMPLATE.md",
    "CHANGE_LOG_TEMPLATE.md",
    "EVIDENCE_LOG_TEMPLATE.md",
    "VERIFICATION_TEMPLATE.md",
    "RECONCILIATION_TEMPLATE.md",
  ].filter((t) => !isFile(path.join(root, "trackers", "templates", t)));
  if (missingTemplates.length) {
    process.stdout.write(
      `  WARN   ${missingTemplates.length} required template(s) absent under trackers/templates/ ` +
        `(${missingTemplates.join(", ")}) — these are FRAMEWORK content shipped by the capsule; ` +
        `validate.js required-paths will FAIL until they are present.\n`
    );
  }

  process.stdout.write(
    `${NAME}: ${opts.dryRun ? "dry-run complete" : "done"}. ` +
      `Verify with: node scripts/trackers/validate.js${opts.root !== process.cwd() ? ` (CLAUDE_PROJECT_DIR=${root})` : ""}\n`
  );
  process.exit(0);
}

if (require.main === module) main();

module.exports = {
  renderTracker,
  renderRoadmapSeed,
  renderUntrackedWorkSeed,
  renderUntrackedWorkFromTemplate,
  epicsSection,
  plan,
  SECTION_ORDER,
  CORE_TERMS,
};
