#!/usr/bin/env node
"use strict";

/**
 * scripts/trackers/validate.js — fail-closed validator for the enforced
 * tracker system (_planning/tracker-system-improvements.md, esp. §28.7
 * Validation Enforcement). It refuses the "tracker drifted from reality" /
 * "tracker lies about state" failure classes the spec exists to prevent:
 * a missing required section, a blank section that hides ambiguity, a broken
 * intra-repo link, an active item with no next action, a completed item with
 * no evidence or below 100%, a 100% item not marked done, a sprint with no
 * parent epic, ambiguous "probably done" language (§21), and undefined
 * operational terms used without a §8 definition.
 *
 * ARCHITECTURE (matches scripts/checks/*.js house style):
 *   - A PURE evaluate({ tracker, trackerFiles, links, paths }) core with every
 *     seam INJECTED (no fs, no cwd) so the in-file bite-test can fire every
 *     named check both PASS and FAIL on synthetic input. The bug-prone parsing
 *     + reconciliation lives here.
 *   - A thin run()/main() that reads the real tree (rooted at the canonical
 *     repo, NOT cwd — cwd may be a stale worktree) and feeds evaluate().
 *
 * NAMED CHECKS (each → {check, status: PASS|FAIL, details[]}):
 *   (a) sections-present     — TRACKER.md has all 34 §5 sections.
 *   (b) no-blank-section     — every required section has content or the
 *                              explicit "None currently recorded." sentinel.
 *   (c) broken-links         — every intra-repo link target in TRACKER.md exists.
 *   (d) active-tracker-files  — active epics/sprints link to an existing
 *                              /trackers/ file.
 *   (e) active-next-action   — every active item names a next action.
 *   (f) completed-evidence   — every completed item records evidence.
 *   (g) completed-100        — every completed item is 100%.
 *   (h) hundred-completed    — every 100% item is marked completed.
 *   (i) sprint-parent-epic   — every sprint names a parent epic.
 *   (j) ambiguous-language   — no §21 prohibited ambiguous-state phrase appears.
 *   (k) undefined-terms      — no core operational term is used but absent from
 *                              the §8 Definitions section.
 *   (l) required-paths       — the §33 required files/dirs/templates exist.
 *
 * CROSS-FILE CHECKS (§28.7 — m–t; each fail-closed: a missing/unverified seam
 * FAILs, never silently passes):
 *   (m) roadmap-epic-based      — ROADMAP.md has a `## Epics` heading and any
 *                                 `## …Milestones` heading is marked DEPRECATED.
 *   (n) epics-in-roadmap        — every `trackers/epics/E-*.md` epic ID is
 *                                 referenced in ROADMAP.md.
 *   (o) modes-consult-tracker   — each of solo/adhoc/oneshot/sprint has a
 *                                 start-of-work "consult TRACKER.md" step.
 *   (p) work-log-session-id     — every Session-Logging session entry names a
 *                                 session ID or carries the backfill sentinel.
 *   (q) expected-nonexistence   — every Verification-Matrix "Verified
 *                                 Nonexistent" path is actually absent on disk.
 *   (r) cross-file-reconciliation — a TRACKER item's state agrees with the
 *                                 state recorded in its linked epic/sprint file.
 *   (s) hooks-enforce-or-tracked — an expected enforcement hook either exists OR
 *                                 its absence is acknowledged in Known Gaps.
 *   (t) definition-drift        — no term carries two materially-different
 *                                 `## Definition:` blocks.
 *
 * ADVISORY TIER (S-10 / ED-034 — REPORT-ONLY, OUTSIDE the binding 20):
 *   session-relative-language (anti-deixis) — flags bare session-relative deixis
 *   ("this session", "next session", "currently", bare "now", a session ordinal)
 *   in a clause that carries no absolute anchor (ISO date OR 7–40-hex commit hash).
 *   It NEVER touches res.ok / the 20-check tally / the suite exit code; it is
 *   surfaced as a separate ADVISORY block. Ramp: report-only → blocking (the flip
 *   is owned by E-SYSTEM-ORG-001 once the existing high-read lines are converted).
 *
 * FAIL-CLOSED CONTRACT:
 *   - evaluate() returns a structured result; it NEVER throws on malformed
 *     tracker content — malformed input surfaces as a FAIL, never a silent pass.
 *   - A genuine runner/parse error (unreadable required input, internal throw)
 *     exits 2 (NOT a pass), and the JSON carries fatal:true.
 *   - Exit 0 = all checks pass · 1 = at least one check FAILed · 2 = usage /
 *     runner error. A validator that errors must never read green.
 *
 *   node scripts/trackers/validate.js            # human-readable report
 *   node scripts/trackers/validate.js --json      # machine-readable
 *   node scripts/trackers/validate.js --selftest   # run the in-file bite-test
 */

const fs = require("fs");
const path = require("path");

const NAME = "trackers/validate";
const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");

// ── §5: the 34 required TRACKER.md sections (in spec order) ───────────────────
const REQUIRED_SECTIONS = [
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

// The explicit empty-section sentinel the spec mandates (§5). A precise
// equivalent is also accepted so the check isn't brittle to phrasing.
const EMPTY_SENTINEL_RE = /none\s+currently\s+recorded\.?|no\s+(known\s+)?(entries|items|gaps)\s+currently\s+recorded\.?/i;

// §21 prohibited ambiguous-state phrases. Each is a state-safety hazard: it
// hides whether work is actually done/verified. Matched case-insensitively.
const AMBIGUOUS_PHRASES = [
  "likely done",
  "probably complete",
  "probably done",
  "mostly handled",
  "mostly done",
  "should be fine",
  "seems done",
  "seems complete",
  "basically finished",
  "basically done",
  "we can assume this is complete",
  "assume this is complete",
  "no need to track",
  "memory has it",
  "done unless something comes up",
  "this is obvious",
  "does not need a definition",
  "the agent will know what this means",
  "path should exist",
  "probably wired",
  "looks wired enough",
  "validation should pass",
];

// §8: the core operational terms that MUST carry a definition in the Definitions
// section once they are used operationally. A representative, high-signal subset
// of the §8 list — the terms whose absence most directly breaks state/authority
// reasoning. (We only flag a term that is actually USED in the tracker body but
// MISSING from Definitions, so this never demands unused vocabulary.)
const CORE_TERMS = [
  "Epic",
  "Sprint",
  "Task",
  "Tracker",
  "Source of truth",
  "State",
  "Percent completion",
  "Completion",
  "Verification",
  "Evidence",
  "Blocker",
  "Dependency",
  "Scope",
  "Change log",
  "Session log",
  "Untracked work",
  "Reconciliation",
  "Superseded",
  "Cancelled",
  "Next action",
  "Definition of done",
  "System Inventory",
  "Verification Matrix",
  "Wiring",
  "Validator",
  "Template",
  "Path",
  "Known gap",
  "Agentic OS",
];

// §33: required files, directories, and templates. dirs end with "/".
const REQUIRED_PATHS = [
  "TRACKER.md",
  "ROADMAP.md",
  "UNTRACKED_WORK.md",
  "trackers/",
  "trackers/epics/",
  "trackers/sprints/",
  "trackers/templates/",
  "trackers/templates/EPIC_TEMPLATE.md",
  "trackers/templates/SPRINT_TEMPLATE.md",
  "trackers/templates/SESSION_LOG_TEMPLATE.md",
  "trackers/templates/UNTRACKED_WORK_TEMPLATE.md",
  "trackers/templates/DEFINITION_TEMPLATE.md",
  "trackers/templates/CHANGE_LOG_TEMPLATE.md",
  "trackers/templates/EVIDENCE_LOG_TEMPLATE.md",
  "trackers/templates/VERIFICATION_TEMPLATE.md",
  "trackers/templates/RECONCILIATION_TEMPLATE.md",
];

// ── Parsing helpers (pure) ────────────────────────────────────────────────────

/** Heading text (sans leading #'s, list numbers, backticks, trailing punctuation). */
function normHeading(line) {
  return line
    .replace(/^#+\s*/, "")
    .replace(/^\d+[.)]\s*/, "")
    .replace(/[`*_]/g, "")
    .trim()
    .toLowerCase();
}

/** Does a heading text match a required section name (tolerant of extra words/numbers)? */
function headingMatchesSection(headingText, section) {
  const h = headingText;
  const s = section.toLowerCase();
  return h === s || h.startsWith(s) || h.includes(s);
}

/**
 * The spec's "Header" section is NOT a literal `# Header` heading — it is the
 * document-title H1 (`# TRACKER.md`) followed by the Version / Owner / Authority
 * block. Identify it as the FIRST H1 section that carries that title block:
 * a Version line AND an Owner line AND an Authority line in its body. This keeps
 * the check rigorous (a doc missing the version/owner/authority block still
 * FAILs "Header") rather than blindly mapping the first heading.
 */
function isHeaderSection(s) {
  if (!s || s.level !== 1) return false;
  const ht = s.headingText || "";
  const titleLike = ht === "tracker.md" || /tracker/.test(ht);
  const body = (s.body || "");
  const hasVersion = /(^|\n)\s*version\s*[:：]/i.test(body);
  const hasOwner = /(^|\n)\s*owner\s*[:：]/i.test(body);
  const hasAuthority = /(^|\n)\s*authority\s*[:：]/i.test(body);
  return titleLike && hasVersion && hasOwner && hasAuthority;
}

/** Find the section matching a required §5 name, mapping "Header" to the title block. */
function findRequiredSection(sections, section) {
  if (section === "Header") return sections.find(isHeaderSection);
  return sections.find((s) => headingMatchesSection(s.headingText, section));
}

/** Heading level (number of leading #'s) of an ATX heading line, or 0 if not a heading. */
function headingLevel(line) {
  const m = /^(#{1,6})\s+/.exec(line);
  return m ? m[1].length : 0;
}

/**
 * Split a markdown doc into sections by ATX headings.
 *
 * The 34 required §5 sections of TRACKER.md are H1 headings (`# Active Epics`,
 * `# Definitions`, ...), and their CONTENT lives in H2/H3 subsections
 * (`## Definition: <Term>`, `### <LABEL>`). So to treat each required section's
 * body as INCLUDING its subsections, split at a single boundary level (default
 * H1): a heading at `boundaryLevel` opens a new section and EVERYTHING below it
 * (including deeper headings) is part of that section's body until the next
 * heading at `boundaryLevel`.
 *
 * Returns [{ heading, headingText, level, body }]. body excludes the opening
 * heading line but KEEPS nested sub-headings verbatim. Pure + total: any string
 * parses (never throws). Content before the first boundary heading is dropped
 * (there is none in a well-formed tracker — the doc opens with `# TRACKER.md`).
 *
 * @param {string} md
 * @param {number} [boundaryLevel=1]  heading level that delimits sections.
 */
function splitSections(md, boundaryLevel = 1) {
  const lines = String(md == null ? "" : md).split(/\r?\n/);
  const sections = [];
  let cur = null;
  for (const line of lines) {
    const lvl = headingLevel(line);
    if (lvl > 0 && lvl <= boundaryLevel) {
      if (cur) sections.push(cur);
      cur = { heading: line, headingText: normHeading(line), level: lvl, bodyLines: [] };
    } else if (cur) {
      cur.bodyLines.push(line);
    }
  }
  if (cur) sections.push(cur);
  return sections.map((s) => ({
    heading: s.heading,
    headingText: s.headingText,
    level: s.level,
    body: s.bodyLines.join("\n").trim(),
  }));
}

/** Body has real content if it is non-empty OR carries the explicit empty sentinel. */
function sectionHasContent(body) {
  const stripped = body.replace(/^[->\s*]+$/gm, "").trim();
  if (stripped.length > 0) return true;
  return EMPTY_SENTINEL_RE.test(body);
}

/** All intra-repo markdown link targets `[text](target)` — drops external + anchors. */
function extractLinks(md) {
  const out = [];
  const text = String(md == null ? "" : md);
  for (const m of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    let target = m[1].trim();
    if (!target) continue;
    if (/^(https?:|mailto:|#|tel:)/i.test(target)) continue; // external / anchor-only
    target = target.split("#")[0].split("?")[0].trim(); // drop anchor/query
    if (!target) continue;
    out.push(target);
  }
  return out;
}

// The §5 state sections that hold epic/sprint ITEMS, and what each implies for
// an item parsed from inside it. `kind` and the default `state` come from the
// CONTAINING section (item labels like `T1`/`E1`/`E-ADR0007` do NOT encode
// kind/state); an explicit `Current state:`/`Final state:` field overrides it.
const ITEM_SECTIONS = [
  { name: "Active Epics", kind: "epic", defaultState: "Active" },
  { name: "Active Sprints", kind: "sprint", defaultState: "Active" },
  { name: "Planned but Not Started Epics", kind: "epic", defaultState: "Planned" },
  { name: "Planned but Not Started Sprints", kind: "sprint", defaultState: "Planned" },
  { name: "Completed Epics", kind: "epic", defaultState: "Completed" },
  { name: "Completed Sprints", kind: "sprint", defaultState: "Completed" },
];

/**
 * Parse tracker items.
 *
 * Items live ONLY inside the Active/Planned/Completed Epics/Sprints H1 sections,
 * ONE item per `### <LABEL>` H3 subsection (e.g. `### E-TRACKER-001 — ...`,
 * `### T1 — ...`). Prose, definitions (`## Definition:`), tables, and inventory
 * rows are NEVER items — the parser only ever descends into the six item
 * sections and only treats H3 headings there as item boundaries.
 *
 * For each item: `kind` and the default `state` come from the containing section
 * (per ITEM_SECTIONS); the bulleted fields below the H3 fill the rest:
 *   - Current state / Final state / State            → state (overrides default)
 *   - Percent completion / Percent / Completion      → percent
 *   - Next required action / Next action / Proposed first action → nextAction
 *   - Evidence of progress / Evidence of completion / Evidence  → evidence
 *   - Parent epic                                    → parentEpic
 *   - Link to epic/sprint tracker / Link            → trackerLink
 * A `Parent epic: <X>` written INLINE inside another bullet (e.g. on the Evidence
 * line of completed E1–E8) is also picked up.
 *
 * evaluate() still accepts items DIRECTLY via the injected `tracker.items` seam
 * for bite-testing; the FS main builds the array from disk with parseItems().
 *
 * Item shape: { kind:"epic"|"sprint", label, state, percent(number|null),
 *               nextAction(string|""), evidence(string|""), parentEpic(string|""),
 *               trackerLink(string|"") }
 */
function parseItems(md) {
  const items = [];
  // Split at H1 so each state section's body includes its `### <LABEL>` items.
  const sections = splitSections(md, 1);
  for (const sec of sections) {
    const spec = ITEM_SECTIONS.find((s) =>
      headingMatchesSection(sec.headingText, s.name)
    );
    if (!spec) continue;
    for (const it of parseItemsFromSection(sec.body, spec)) items.push(it);
  }
  return items;
}

/** Extract one item per `### <LABEL>` H3 from a state-section body. */
function parseItemsFromSection(body, spec) {
  const out = [];
  // Split the section body at H3 boundaries (the item delimiter). Anything
  // before the first H3 is section preamble (prose), never an item.
  const subs = splitSections(body, 3).filter((s) => s.level === 3);
  for (const sub of subs) {
    const label = itemLabel(sub.headingText, sub.heading);
    const item = {
      kind: spec.kind,
      label,
      state: spec.defaultState,
      percent: null,
      nextAction: "",
      evidence: "",
      parentEpic: "",
      trackerLink: "",
    };
    applyItemFields(item, sub.body);
    out.push(item);
  }
  return out;
}

/** Pull a short, stable label from an item H3 heading (the part before " — "/"·"). */
function itemLabel(headingText, headingRaw) {
  // headingText is normalized+lowercased; prefer the raw heading for casing.
  const raw = String(headingRaw || "")
    .replace(/^#+\s*/, "")
    .trim();
  const head = raw.split(/\s+[—–·-]\s+/)[0].trim() || raw;
  return head || headingText;
}

/** Read the bulleted fields of one item body into the item object. */
function applyItemFields(item, body) {
  const lines = String(body == null ? "" : body).split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    // A field bullet is `- <Label>: <value>`. Take the label as everything from
    // the bullet to the FIRST colon, then classify it by its leading keyword.
    // This is robust to parenthetical qualifiers ("Evidence of completion
    // (per the interim tracker, verified ...): ...") whose inner punctuation
    // would break a strict label charclass.
    const kv = line.match(/^[-*]\s*(\*\*)?\s*([^:：]+?)\s*(\*\*)?\s*[:：]\s*(.*)$/);
    if (kv) {
      const key = normFieldKey(kv[2]);
      const val = kv[4].trim();
      const field = classifyField(key);
      if (field === "state") item.state = val;
      else if (field === "percent") item.percent = parsePercent(val);
      else if (field === "nextAction") item.nextAction = val;
      else if (field === "evidence") item.evidence = val;
      else if (field === "parentEpic") item.parentEpic = val;
      else if (field === "link") {
        item.trackerLink = extractFieldLink(line, val);
      }
    }
    // A `Parent epic: <X>` written inline inside another bullet (e.g. the
    // Evidence line of completed E1–E8) still names the parent epic.
    if (!item.parentEpic) {
      const inlineParent = line.match(/parent epic\s*[:：]\s*([^.;]+)/i);
      if (inlineParent) item.parentEpic = inlineParent[1].trim();
    }
    // First intra-repo link anywhere in the item body, if no explicit one yet.
    if (!item.trackerLink) {
      const inlineLink = extractLinks(raw)[0];
      if (inlineLink) item.trackerLink = inlineLink;
    }
  }
}

/**
 * Resolve the tracker-file target of a `Link to ... tracker:` bullet to a clean
 * path. Prefers a markdown `[text](target)` link; else a backtick-quoted path
 * (the tracker's form: `` `/trackers/epics/...md` — Missing But Required ``);
 * else the first whitespace-delimited token of the value. This strips trailing
 * prose so the path can be probed for existence honestly.
 */
function extractFieldLink(line, val) {
  const md = extractLinks(line)[0];
  if (md) return md;
  const tick = String(val).match(/`([^`]+)`/);
  if (tick) return tick[1].trim();
  const firstTok = String(val).trim().split(/\s+/)[0] || "";
  return firstTok.replace(/[`<>]/g, "");
}

/** Lower-case a field label and drop any "(...)" qualifier and bold markers. */
function normFieldKey(s) {
  return String(s)
    .replace(/[`*_]/g, "")
    .replace(/\([^)]*\)/g, " ") // strip parenthetical qualifiers
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Classify a normalized field label into a canonical item field, or "" if it is
 * not one of the recognized item fields. Prefix/keyword based so the tracker's
 * real label variants all map correctly while prose bullets are ignored.
 */
function classifyField(key) {
  if (/^(current |final )?state$/.test(key)) return "state";
  if (/^(percent completion|percent|completion)$/.test(key)) return "percent";
  if (
    /^(next required action|current next action|next action|next|proposed first action)$/.test(
      key
    )
  )
    return "nextAction";
  if (/^evidence(\s+of\s+\w+)?$/.test(key)) return "evidence"; // evidence / evidence of progress / evidence of completion
  if (/^parent epic$/.test(key)) return "parentEpic";
  if (/^link(\s+to\b.*)?$/.test(key) || /^tracker$/.test(key)) return "link"; // link / link to epic tracker
  return "";
}

/** "80%" / "80 %" / "80" → 80 ; non-numeric → null (never throws). */
function parsePercent(val) {
  const m = String(val).match(/(\d{1,3})\s*%?/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (Number.isNaN(n) || n < 0 || n > 100) return null;
  return n;
}

const isActive = (s) => /\bactive\b/i.test(s || "");
const isCompleted = (s) => /\b(completed|complete|done)\b/i.test(s || "");

// ── Cross-file (§28.7) helpers (pure) ─────────────────────────────────────────

// The four live, enterable modes that MUST consult the tracker at start-of-work.
const TRACKER_CONSULT_MODES = ["solo", "adhoc", "oneshot", "sprint"];

// The expected start-of-work / end-of-work / completion-gate enforcement hooks
// for the enforced-tracker system. These are HARD enforcement points distinct
// from the generic session/skill/sprint trackers; today they are unbuilt and the
// gap is acknowledged in Known Gaps (G-2) — check (s) stays green while tracked.
const EXPECTED_ENFORCEMENT_HOOKS = [
  "scripts/hooks/tracker-start-of-work.js",
  "scripts/hooks/tracker-completion-gate.js",
];

/**
 * Normalize a free-text state ("Active.", "Completed", "Review Needed.", "Done")
 * to a canonical token so a TRACKER item state and its linked file's state can be
 * compared without tripping on punctuation/synonyms. Unknown → the cleaned text.
 */
function normState(s) {
  const t = String(s == null ? "" : s)
    .replace(/[`*_.]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (/\b(completed|complete|done|shipped|finished)\b/.test(t)) return "completed";
  if (/\breview\b/.test(t)) return "review";
  if (/\b(cancelled|canceled|superseded|abandoned)\b/.test(t)) return "cancelled";
  if (/\b(active|in progress|in-progress|ongoing)\b/.test(t)) return "active";
  if (/\b(planned|not started|backlog|proposed)\b/.test(t)) return "planned";
  if (/\bblocked\b/.test(t)) return "blocked";
  return t;
}

/**
 * Derive a stable epic ID (e.g. "E-TRACKER-001") from an epic tracker filename
 * like "E-TRACKER-001-enforced-tracker-system.md". The ID is `E-` + one-or-more
 * WORD- segments + a numeric segment; the trailing `-slug` is dropped. Returns ""
 * if the name does not match the epic-ID shape.
 */
function epicIdFromFilename(name) {
  const base = String(name || "").replace(/\.md$/i, "");
  const m = /^E-(?:[A-Za-z0-9]+-)*[0-9]{2,}/.exec(base);
  return m ? m[0] : "";
}

/** Does a ROADMAP have an epic-based registry and no LIVE (non-deprecated) Milestones heading? */
function roadmapIsEpicBased(roadmap) {
  const md = String(roadmap == null ? "" : roadmap);
  const hasEpics = /^##\s+Epics\b/im.test(md);
  let liveMilestones = false;
  for (const line of md.split(/\r?\n/)) {
    if (/^##\s+/.test(line) && /milestones/i.test(line)) {
      if (!/deprecated/i.test(line)) liveMilestones = true;
    }
  }
  return { hasEpics, liveMilestones };
}

/**
 * Parse the session-log entries from the "Session Logging Rules" section body.
 * Each non-empty paragraph whose text looks like a session-log entry (it names a
 * "session log" or carries a "Session ID:" field) is one entry. Returns the array
 * of raw entry strings.
 */
function parseSessionLogEntries(tracker) {
  const sections = splitSections(String(tracker == null ? "" : tracker), 1);
  const sec = sections.find((s) =>
    headingMatchesSection(s.headingText, "Session Logging Rules")
  );
  if (!sec) return [];
  // An ENTRY is a paragraph that records an actual logged session: it carries a
  // `Session ID:` field OR is introduced by a "… session log:" label. The
  // section's rules prose ("must include: session ID; date; …") is NOT an entry —
  // it lists required fields but has no `Session ID:` field of its own.
  return sec.body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => {
      if (!p) return false;
      if (/session id\s*[:：]/i.test(p)) return true; // carries a Session ID: field
      // …or opens with a "<label> session log:" entry header (not the rules prose,
      // which begins "Every meaningful work session … must be logged.").
      const head = p.split(/\r?\n/)[0].slice(0, 48);
      return /\bsession log\b[^.\n]*[:：]/i.test(head);
    });
}

/** A session-log entry is well-identified if it names a session ID or carries the backfill sentinel. */
function sessionEntryIdentified(entry) {
  const e = String(entry || "");
  if (/to be backfilled/i.test(e)) return true; // explicit sentinel
  // A real session ID after "Session ID:" — something that is not just the
  // sentinel and not empty. Accept any non-trivial token (e.g. SP-2026..., a uuid).
  const m = /session id\s*[:：]\s*([^·\n]+)/i.exec(e);
  if (m) {
    const v = m[1].trim().replace(/[.;]+$/, "");
    if (v && !/^to be backfilled/i.test(v)) return true;
  }
  return false;
}

/** Extract { term → [firstSentence, ...] } from all `## Definition: <Term>` blocks in the tracker. */
function parseDefinitionBlocks(tracker) {
  const out = {};
  const sections = splitSections(String(tracker == null ? "" : tracker), 2);
  for (const s of sections) {
    const m = /^definition:\s*(.+)$/i.exec(s.headingText.trim());
    if (!m) continue;
    const term = m[1].replace(/[`*_]/g, "").trim().toLowerCase();
    if (!term) continue;
    // First sentence of the definition body (drop a leading "Definition:" label).
    const body = String(s.body || "")
      .replace(/^\s*definition\s*[:：]\s*/i, "")
      .trim();
    const firstSentence = (body.split(/(?<=[.!?])\s/)[0] || body).trim();
    (out[term] = out[term] || []).push(firstSentence);
  }
  return out;
}

/** Light "materially different" comparison of two definition first-sentences. */
function defsMateriallyDiffer(a, b) {
  const norm = (s) =>
    String(s || "")
      .toLowerCase()
      .replace(/[`*_]/g, "")
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const na = norm(a);
  const nb = norm(b);
  if (na === nb) return false;
  // Jaccard word overlap — high overlap = same definition reworded, not drift.
  const wa = new Set(na.split(" ").filter(Boolean));
  const wb = new Set(nb.split(" ").filter(Boolean));
  if (wa.size === 0 || wb.size === 0) return na !== nb;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  const union = wa.size + wb.size - inter;
  const jaccard = union === 0 ? 1 : inter / union;
  return jaccard < 0.5;
}

// ── PURE CORE ─────────────────────────────────────────────────────────────────
/**
 * Evaluate the tracker system. All seams injected — NO fs, NO cwd.
 *
 * @param {object} input
 * @param {string} input.tracker        raw TRACKER.md contents ("" if missing).
 * @param {boolean} [input.trackerPresent]  whether TRACKER.md exists at all.
 *                                      (defaults to tracker.length > 0)
 * @param {Array}  [input.items]        pre-parsed items; if absent, parsed from tracker.
 * @param {object} [input.linkTargets]  map { "<repo-relative link>": boolean-exists }.
 *                                      A link present-as-key with false = broken.
 * @param {object} [input.pathExists]   map { "<§33 path>": boolean-exists }.
 *
 * Cross-file (§28.7) seams — all OPTIONAL, all fail-closed when absent:
 * @param {string}  [input.roadmap]        raw ROADMAP.md ("" if missing).
 * @param {boolean} [input.roadmapPresent] whether ROADMAP.md exists.
 * @param {string[]} [input.epicIds]       epic IDs from trackers/epics/E-*.md filenames.
 * @param {object}  [input.modeConsults]   map { solo,adhoc,oneshot,sprint → bool }.
 * @param {object}  [input.nonexistence]   map { "<path>" → actually-absent bool } for
 *                                         every Verified-Nonexistent matrix path.
 * @param {object}  [input.itemFileStates] map { "<item label>" → state in its linked file }.
 * @param {object}  [input.enforcementHooks] map { "<hook path>" → exists bool }.
 * @returns {{ ok:boolean, checks:Array<{check,status,details}>, fatal:boolean }}
 *
 * NEVER throws on malformed tracker content — a parse failure becomes a FAIL.
 */
function evaluate(input) {
  const checks = [];
  const add = (check, details) =>
    checks.push({
      check,
      status: details.length === 0 ? "PASS" : "FAIL",
      details,
    });

  const trackerRaw = input && input.tracker != null ? String(input.tracker) : "";
  const trackerPresent =
    input && typeof input.trackerPresent === "boolean"
      ? input.trackerPresent
      : trackerRaw.length > 0;
  const linkTargets = (input && input.linkTargets) || {};
  const pathExists = (input && input.pathExists) || {};

  // Cross-file seams (optional; absence is handled fail-closed per check).
  const roadmapRaw = input && input.roadmap != null ? String(input.roadmap) : "";
  const roadmapPresent =
    input && typeof input.roadmapPresent === "boolean"
      ? input.roadmapPresent
      : roadmapRaw.length > 0;
  const epicIds = input && Array.isArray(input.epicIds) ? input.epicIds : null;
  const modeConsults = input && input.modeConsults ? input.modeConsults : null;
  const nonexistence = input && input.nonexistence ? input.nonexistence : null;
  const itemFileStates = input && input.itemFileStates ? input.itemFileStates : null;
  const enforcementHooks =
    input && input.enforcementHooks ? input.enforcementHooks : null;

  let sections;
  let items;
  try {
    sections = splitSections(trackerRaw);
    items =
      input && Array.isArray(input.items) ? input.items : parseItems(trackerRaw);
  } catch (e) {
    // Defensive: parsing is total, but if anything throws we FAIL closed.
    add("parse", [`tracker parse error (fail-closed): ${e.message}`]);
    return { ok: false, checks, fatal: false };
  }

  // (a) sections-present — all 34 §5 sections appear as headings.
  {
    const details = [];
    if (!trackerPresent) {
      details.push("TRACKER.md is missing — none of the 34 required sections present.");
    } else {
      for (const sec of REQUIRED_SECTIONS) {
        const found = !!findRequiredSection(sections, sec);
        if (!found) details.push(`required §5 section missing: "${sec}"`);
      }
    }
    add("sections-present", details);
  }

  // (b) no-blank-section — each present required section has content or sentinel.
  {
    const details = [];
    for (const sec of REQUIRED_SECTIONS) {
      const match = findRequiredSection(sections, sec);
      if (!match) continue; // absence is (a)'s job, not (b)'s — avoid double-report
      if (!sectionHasContent(match.body)) {
        details.push(
          `section "${sec}" is blank — add content or the explicit "None currently recorded." sentinel`
        );
      }
    }
    add("no-blank-section", details);
  }

  // (c) broken-links — every intra-repo TRACKER.md link target exists.
  {
    const details = [];
    const links = extractLinks(trackerRaw);
    for (const link of links) {
      // Only judge links we were given existence info for; an unknown link is
      // treated as broken (fail-closed) so a missing existence-probe can't pass.
      if (Object.prototype.hasOwnProperty.call(linkTargets, link)) {
        if (!linkTargets[link]) details.push(`broken intra-repo link: ${link} (target does not exist)`);
      } else {
        details.push(`unresolved intra-repo link: ${link} (existence not verified — fail-closed)`);
      }
    }
    add("broken-links", details);
  }

  // (d) active-tracker-files — active epics/sprints link to an existing /trackers/ file.
  {
    const details = [];
    for (const it of items) {
      if (!isActive(it.state)) continue;
      const link = it.trackerLink;
      if (!link) {
        details.push(`active ${it.kind} ${it.label} links to no tracker file`);
        continue;
      }
      const inTrackers = /(^|\/)trackers\//.test(link.replace(/\\/g, "/"));
      if (!inTrackers) {
        details.push(`active ${it.kind} ${it.label} tracker link "${link}" is not under /trackers/`);
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(linkTargets, link)) {
        if (!linkTargets[link])
          details.push(`active ${it.kind} ${it.label} tracker file missing: ${link}`);
      } else {
        details.push(`active ${it.kind} ${it.label} tracker file unverified: ${link} (fail-closed)`);
      }
    }
    add("active-tracker-files", details);
  }

  // (e) active-next-action — every active item names a next action.
  {
    const details = [];
    for (const it of items) {
      if (isActive(it.state) && !String(it.nextAction).trim()) {
        details.push(`active ${it.kind} ${it.label} has no next action`);
      }
    }
    add("active-next-action", details);
  }

  // (f) completed-evidence — every completed item records evidence.
  {
    const details = [];
    for (const it of items) {
      if (isCompleted(it.state) && !String(it.evidence).trim()) {
        details.push(`completed ${it.kind} ${it.label} has no evidence`);
      }
    }
    add("completed-evidence", details);
  }

  // (g) completed-100 — every completed item is 100%.
  {
    const details = [];
    for (const it of items) {
      if (isCompleted(it.state) && it.percent !== null && it.percent !== 100) {
        details.push(`completed ${it.kind} ${it.label} is ${it.percent}% (must be 100%)`);
      }
    }
    add("completed-100", details);
  }

  // (h) hundred-completed — every 100% item is marked completed.
  {
    const details = [];
    for (const it of items) {
      if (it.percent === 100 && !isCompleted(it.state)) {
        details.push(`${it.kind} ${it.label} is 100% but state is "${it.state || "(none)"}" (not completed)`);
      }
    }
    add("hundred-completed", details);
  }

  // (i) sprint-parent-epic — every sprint names a parent epic.
  {
    const details = [];
    for (const it of items) {
      if (it.kind === "sprint" && !String(it.parentEpic).trim()) {
        details.push(`sprint ${it.label} names no parent epic`);
      }
    }
    add("sprint-parent-epic", details);
  }

  // (j) ambiguous-language — no §21 prohibited ambiguous-state phrase appears,
  // EXCEPT inside the "Language Rules" section, which legitimately QUOTES the
  // prohibited phrases as the canonical examples of what not to write. Scanning
  // the whole doc there would flag the rule that forbids them (self-reference).
  {
    const details = [];
    const scanText = sections
      .filter((s) => !/language/i.test(s.headingText))
      .map((s) => s.body)
      .join("\n")
      .toLowerCase();
    for (const phrase of AMBIGUOUS_PHRASES) {
      if (scanText.includes(phrase)) {
        details.push(`ambiguous §21 phrase present: "${phrase}"`);
      }
    }
    add("ambiguous-language", details);
  }

  // (k) undefined-terms — core terms USED in the body but absent from the
  // Definitions. Per spec §8.1 each term gets a "## Definition: <Term>" block,
  // which the section parser splits into its OWN section — so the definitions
  // corpus is: every "Definition: *" section + the "Definitions" intro section
  // + the "State Model" section (where the state terms are formally defined).
  {
    const details = [];
    const isDefSection = (s) =>
      headingMatchesSection(s.headingText, "Definitions") ||
      /^definition:\s*/i.test(s.headingText.trim()) ||
      headingMatchesSection(s.headingText, "State Model");
    const defsBody = sections
      .filter(isDefSection)
      .map((s) => `${s.headingText}\n${s.body}`)
      .join("\n")
      .toLowerCase();
    const bodyOutsideDefs = sections
      .filter((s) => !isDefSection(s))
      .map((s) => s.body)
      .join("\n")
      .toLowerCase();
    for (const term of CORE_TERMS) {
      const t = term.toLowerCase();
      if (!new RegExp(`\\b${escapeRe(t)}\\b`).test(bodyOutsideDefs)) continue; // unused → exempt
      if (!new RegExp(`\\b${escapeRe(t)}\\b`).test(defsBody)) {
        details.push(`operational term "${term}" is used but not defined in §8 Definitions`);
      }
    }
    add("undefined-terms", details);
  }

  // (l) required-paths — the §33 required files/dirs/templates exist.
  {
    const details = [];
    for (const p of REQUIRED_PATHS) {
      if (Object.prototype.hasOwnProperty.call(pathExists, p)) {
        if (!pathExists[p]) details.push(`required §33 path missing: ${p}`);
      } else {
        details.push(`required §33 path unverified: ${p} (existence not probed — fail-closed)`);
      }
    }
    add("required-paths", details);
  }

  // ── CROSS-FILE CHECKS (§28.7 — m–t) ────────────────────────────────────────

  // (m) roadmap-epic-based — ROADMAP has a `## Epics` registry and no LIVE
  // (non-deprecated) Milestones heading. Absent roadmap → FAIL (fail-closed).
  {
    const details = [];
    if (!roadmapPresent) {
      details.push("ROADMAP.md is missing — cannot confirm an epic-based roadmap (fail-closed)");
    } else {
      const { hasEpics, liveMilestones } = roadmapIsEpicBased(roadmapRaw);
      if (!hasEpics) details.push('ROADMAP.md has no `## Epics` heading — roadmap is not epic-based');
      if (liveMilestones)
        details.push('ROADMAP.md has a `## …Milestones` heading not marked DEPRECATED');
    }
    add("roadmap-epic-based", details);
  }

  // (n) epics-in-roadmap — every epic file's ID is referenced in ROADMAP.md.
  // No epicIds seam, or absent roadmap → FAIL (fail-closed).
  {
    const details = [];
    if (epicIds === null) {
      details.push("epic-ID seam not provided — cannot verify epics are in the roadmap (fail-closed)");
    } else if (!roadmapPresent) {
      details.push("ROADMAP.md is missing — cannot verify epics are referenced (fail-closed)");
    } else {
      for (const id of epicIds) {
        if (!id) {
          details.push("an epic file has an unparseable epic ID (fail-closed)");
          continue;
        }
        if (!roadmapRaw.includes(id)) {
          details.push(`epic ${id} is not referenced in ROADMAP.md`);
        }
      }
    }
    add("epics-in-roadmap", details);
  }

  // (o) modes-consult-tracker — each of the 4 live modes has a start-of-work
  // tracker-consult step. Missing seam, or any mode missing/false → FAIL.
  {
    const details = [];
    if (modeConsults === null) {
      details.push("mode-consult seam not provided — cannot verify mode wiring (fail-closed)");
    } else {
      for (const mode of TRACKER_CONSULT_MODES) {
        if (modeConsults[mode] !== true) {
          details.push(`mode "${mode}" has no start-of-work TRACKER.md consult step`);
        }
      }
    }
    add("modes-consult-tracker", details);
  }

  // (p) work-log-session-id — every Session-Logging entry names a session ID or
  // carries the explicit backfill sentinel.
  {
    const details = [];
    if (!trackerPresent) {
      details.push("TRACKER.md missing — cannot verify session-log entries (fail-closed)");
    } else {
      const entries = parseSessionLogEntries(trackerRaw);
      for (const e of entries) {
        if (!sessionEntryIdentified(e)) {
          const head = e.split(/\n/)[0].slice(0, 60);
          details.push(`session-log entry names no session ID and lacks the backfill sentinel: "${head}…"`);
        }
      }
    }
    add("work-log-session-id", details);
  }

  // (q) expected-nonexistence — every Verified-Nonexistent path is actually
  // absent on disk. Missing seam, or any such path EXISTS/unverified → FAIL.
  {
    const details = [];
    if (nonexistence === null) {
      details.push("expected-nonexistence seam not provided — cannot verify (fail-closed)");
    } else {
      for (const [p, absent] of Object.entries(nonexistence)) {
        if (absent !== true) {
          details.push(`path marked "Verified Nonexistent" actually EXISTS (or is unverified): ${p}`);
        }
      }
    }
    add("expected-nonexistence", details);
  }

  // (r) cross-file-reconciliation — a TRACKER item's state agrees with the state
  // recorded in its linked epic/sprint FILE. Only items WITH a linked file are
  // reconciled; a linked-file state that could not be read → FAIL (fail-closed).
  {
    const details = [];
    if (itemFileStates === null) {
      details.push("item-file-state seam not provided — cannot reconcile cross-file states (fail-closed)");
    } else {
      for (const it of items) {
        if (!Object.prototype.hasOwnProperty.call(itemFileStates, it.label)) continue; // no linked file
        const fileState = itemFileStates[it.label];
        if (fileState == null || fileState === false) {
          details.push(`${it.kind} ${it.label}: linked file state unverified (fail-closed)`);
          continue;
        }
        const a = normState(it.state);
        const b = normState(fileState);
        if (a !== b) {
          details.push(`${it.kind} ${it.label}: TRACKER state "${it.state}" (${a}) disagrees with file state "${fileState}" (${b})`);
        }
      }
    }
    add("cross-file-reconciliation", details);
  }

  // (s) hooks-enforce-or-tracked — an expected enforcement hook either EXISTS or
  // its absence is acknowledged in `# Known Gaps and Open Flaws`. FAILs only when
  // a hook is missing AND the gap is not acknowledged (enforcement-debt pattern).
  {
    const details = [];
    if (enforcementHooks === null) {
      details.push("enforcement-hook seam not provided — cannot verify enforcement hooks (fail-closed)");
    } else {
      const gapsSec = sections.find((s) =>
        headingMatchesSection(s.headingText, "Known Gaps and Open Flaws")
      );
      const gapsText = (gapsSec ? gapsSec.body : "").toLowerCase();
      // The gap is acknowledged when the Known-Gaps text mentions an enforcement
      // hook for the start-of-work / end-of-work / completion-gate points.
      const gapAcknowledged =
        /hook/.test(gapsText) &&
        /(start-of-work|end-of-work|completion-gate|completion gate|enforcement hook)/.test(gapsText);
      for (const [hook, exists] of Object.entries(enforcementHooks)) {
        if (exists === true) continue; // present → fine
        if (!gapAcknowledged) {
          details.push(`expected enforcement hook missing and NOT acknowledged in Known Gaps: ${hook}`);
        }
      }
    }
    add("hooks-enforce-or-tracked", details);
  }

  // (t) definition-drift — no term carries two materially-different
  // `## Definition:` blocks. Light + fail-closed (parse failure → no false pass).
  {
    const details = [];
    if (!trackerPresent) {
      details.push("TRACKER.md missing — cannot check definition drift (fail-closed)");
    } else {
      const defs = parseDefinitionBlocks(trackerRaw);
      for (const [term, sentences] of Object.entries(defs)) {
        if (sentences.length < 2) continue;
        for (let i = 1; i < sentences.length; i++) {
          if (defsMateriallyDiffer(sentences[0], sentences[i])) {
            details.push(`term "${term}" has two materially-different definitions: "${sentences[0]}" vs "${sentences[i]}"`);
            break;
          }
        }
      }
    }
    add("definition-drift", details);
  }

  const ok = checks.every((c) => c.status === "PASS");
  return { ok, checks, fatal: false };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── ADVISORY TIER (S-10 / ED-034): session-relative-language (anti-deixis) ─────
//
// This is a REPORT-ONLY check, INTENTIONALLY OUTSIDE the 20 binding checks of
// evaluate(). It NEVER touches res.ok, the 20/20 tally, or the suite exit code —
// it returns warnings that run()/report() surface as a clearly-separated advisory
// block. The ramp is report-only → blocking (the eventual flip is Alpha's; the
// epic E-SYSTEM-ORG-001 § "Tracker language convention (anti-deixis)" owns it).
//
// RULE (the epic's authoritative spec): TRACKER prose must be ABSOLUTE +
// state-chained, never bare session-relative deixis. A session-relative phrase
// ("this session", "next session", "currently", bare "now", a session ordinal
// like "session 3", "no X this session", "DONE this session") is ambiguous when
// read LATER — "no execution this session" reads to a future session as a present
// instruction. The fix: carry an absolute anchor — an ISO date (YYYY-MM-DD) and/or
// a 7–40-hex commit hash — within the SAME clause.
//
// A phrase is FLAGGED iff it appears in a non-allowlisted clause that lacks an
// in-clause anchor. Allowlist (NOT flagged): fenced ``` code blocks; blockquote
// lines that quote an old handoff; the rule-definition sections that LIST the
// banned phrases as examples (Language Rules + an anti-deixis convention section);
// and the fixed empty-section sentinel "None currently recorded.".

// Banned deictic phrases as `{ re, label }`. `\s` (never a literal space before a
// char-class `]`) is used throughout so Write can't smuggle a NUL byte in.
const DEIXIS_PATTERNS = [
  { re: /\bthis\s+session\b/i, label: "this session" },
  { re: /\bnext\s+session\b/i, label: "next session" },
  { re: /\b(?:last|previous|prior)\s+session\b/i, label: "<last/previous/prior> session" },
  { re: /\bthis\s+release\b/i, label: "this release" },
  { re: /\bnext\s+release\b/i, label: "next release" },
  // A session ordinal used as a temporal subject ("session 3", "session 4").
  { re: /\bsession\s+\d+\b/i, label: "session <N> (ordinal)" },
  { re: /\bcurrently\b/i, label: "currently" },
  // Bare "now" — deictic uses only, NOT the adjectival "now <X>" change-result
  // construction ("now epic-based", "now Completed"). Anchored to clause-initial
  // "Now," / "right now" / "as of now" / "for now" / "by now" / "until now".
  { re: /(?:^|[—·;.]\s*)now\b[,\s]/i, label: "now (clause-initial deictic)" },
  { re: /\b(?:right|as\s+of|for|by|until)\s+now\b/i, label: "<right/as-of/for/by/until> now" },
];

// An absolute anchor in the same clause: an ISO date OR a 7–40-hex commit hash.
// The hash branch requires the run to be all-hex AND contain a digit, so an
// all-letter word like "decade" or "feedback" is never mistaken for a hash.
const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/;
const HASH_RE = /\b(?=[0-9a-f]{7,40}\b)[0-9a-f]*[0-9][0-9a-f]*\b/i;

/** True if a clause carries an absolute anchor (ISO date or commit hash). */
function clauseHasAnchor(clause) {
  return ISO_DATE_RE.test(clause) || HASH_RE.test(clause);
}

/** Split a line into clause segments on sentence / em-dash / middot / semicolon. */
function splitClauses(line) {
  return String(line == null ? "" : line)
    .split(/(?:\s—\s|\s·\s|—|·|;|(?<=[.!?])\s)/)
    .map((c) => c.trim())
    .filter(Boolean);
}

// Lines/clauses that LIST the banned phrases as examples (rule-definition
// context) — they must not self-trip. We allowlist the whole Language Rules
// section + any anti-deixis convention section by heading, but also carry this
// fixed empty-section sentinel + a couple of literal markers as belt-and-braces.
const DEIXIS_ALLOW_PHRASES = [
  /none\s+currently\s+recorded/i, // the §5 empty-section sentinel — a fixed sentinel, not a status claim
];

/** Heading text that marks a rule-definition section whose body LISTS the bans. */
function isDeixisRuleSectionHeading(headingText) {
  const h = String(headingText || "").toLowerCase();
  return (
    headingMatchesSection(h, "Language Rules") ||
    /anti-deixis/.test(h) ||
    /session-relative/.test(h) ||
    /tracker language convention/.test(h) ||
    /\bdeixis\b/.test(h)
  );
}

/**
 * PURE advisory evaluator — NO fs, NO cwd, never throws on malformed input.
 *
 * @param {object} input
 * @param {string} input.tracker  raw TRACKER.md contents ("" if missing).
 * @returns {{ warnings: Array<{line:number, phrase:string, clause:string, raw:string}>,
 *             scannedLines:number }}
 *
 * A line is exempt when: it is inside a fenced ``` block; it is a blockquote
 * (`> …`, an old-handoff quote); it is inside a rule-definition section (Language
 * Rules / anti-deixis convention); or it matches an allowlisted sentinel phrase.
 * Otherwise each banned deictic phrase whose CLAUSE lacks an anchor is a warning.
 */
function evaluateDeixis(input) {
  const md = input && input.tracker != null ? String(input.tracker) : "";
  const warnings = [];
  const lines = md.split(/\r?\n/);

  let inFence = false; // inside a ``` fenced block
  let inRuleSection = false; // inside a rule-definition section (lists the bans)
  let scannedLines = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];

    // Fenced-code toggle — a line whose first non-space chars are ``` or ~~~.
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue; // allowlist: fenced code (quoted handoffs/snippets)

    // Track entry/exit of a rule-definition section by its H1/H2 heading. Any
    // ATX heading closes the previous rule section; a deixis-rule heading opens one.
    if (/^#{1,6}\s+/.test(raw)) {
      inRuleSection = isDeixisRuleSectionHeading(normHeading(raw));
      continue;
    }
    if (inRuleSection) continue; // allowlist: the convention section LISTS the bans

    if (/^\s*>/.test(raw)) continue; // allowlist: blockquote (quotes an old handoff)

    // Allowlisted sentinel phrases (e.g. the "None currently recorded." sentinel).
    if (DEIXIS_ALLOW_PHRASES.some((re) => re.test(raw))) {
      // The sentinel may share a line with real prose; only skip the sentinel's
      // own clause, still scan the rest. Drop the sentinel clause from scanning.
      const clauses = splitClauses(raw).filter(
        (c) => !DEIXIS_ALLOW_PHRASES.some((re) => re.test(c))
      );
      scannedLines++;
      flagClauses(clauses, i + 1, raw, warnings);
      continue;
    }

    scannedLines++;
    flagClauses(splitClauses(raw), i + 1, raw, warnings);
  }

  return { warnings, scannedLines };
}

/** Push a warning for each banned deictic phrase in an un-anchored clause. */
function flagClauses(clauses, lineNo, raw, warnings) {
  for (const clause of clauses) {
    if (clauseHasAnchor(clause)) continue; // anchored → state-chained, OK
    for (const { re, label } of DEIXIS_PATTERNS) {
      if (re.test(clause)) {
        warnings.push({
          line: lineNo,
          phrase: label,
          clause: clause.slice(0, 120),
          raw: String(raw).trim().slice(0, 160),
        });
      }
    }
  }
}

// ── FS layer (thin) ───────────────────────────────────────────────────────────
const abs = (rel) => path.join(ROOT, rel.replace(/\/+$/g, "").split("/").join(path.sep) + (rel.endsWith("/") ? path.sep : ""));

function existsRepo(rel) {
  const clean = rel.replace(/\\/g, "/");
  const wantDir = clean.endsWith("/");
  const full = path.join(ROOT, clean);
  try {
    const st = fs.statSync(full);
    return wantDir ? st.isDirectory() : st.isFile();
  } catch {
    return false;
  }
}

/** Resolve a TRACKER.md-relative link to a repo-relative path and test existence. */
function resolveLinkExists(link) {
  // Links in TRACKER.md are relative to repo root (TRACKER.md lives at root).
  const clean = link.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\//, "");
  const full = path.join(ROOT, clean);
  try {
    fs.statSync(full);
    return true;
  } catch {
    return false;
  }
}

/** Read a repo-relative file, or null if it cannot be read (absence/error). */
function readRepoFile(rel) {
  try {
    return fs.readFileSync(path.join(ROOT, rel.replace(/\\/g, "/")), "utf8");
  } catch {
    return null;
  }
}

/** List basenames in a repo-relative dir, or [] if it does not exist. */
function listRepoDir(rel) {
  try {
    return fs.readdirSync(path.join(ROOT, rel.replace(/\\/g, "/")));
  } catch {
    return [];
  }
}

/** Does a mode command file contain a start-of-work "consult TRACKER.md" step? */
function modeConsultsTracker(modeMd) {
  const md = String(modeMd || "");
  // A start-of-work tracker-consult: a heading or line that pairs
  // "Start-of-work" with "consult TRACKER.md", as wired by sprint T6.
  if (/start-of-work\b[^\n]*\bconsult\b[^\n]*\bTRACKER\.md\b/i.test(md)) return true;
  // Tolerant fallback: a "consult"/"read" step that names TRACKER.md AND mentions
  // start-of-work / before-work within the same line.
  for (const line of md.split(/\r?\n/)) {
    if (/TRACKER\.md/.test(line) && /(consult|read)/i.test(line) && /(start-of-work|before .*work|begin)/i.test(line)) {
      return true;
    }
  }
  return false;
}

/**
 * Parse the Verification-Matrix rows marked "Verified Nonexistent" and return the
 * set of concrete repo-relative paths each row asserts are absent. The matrix
 * names paths in backticks; the old mode-tree row lists a brace-expansion
 * (`.claude/agents/{00-alex,01-adhoc,...}`) which we expand into per-dir paths.
 */
function parseVerifiedNonexistentPaths(tracker) {
  const sections = splitSections(String(tracker == null ? "" : tracker), 1);
  const matrix = sections.find((s) =>
    headingMatchesSection(s.headingText, "Verification Matrix")
  );
  const inv = sections.find((s) =>
    headingMatchesSection(s.headingText, "System Inventory")
  );
  const paths = new Set();
  for (const sec of [matrix, inv]) {
    if (!sec) continue;
    for (const line of sec.body.split(/\r?\n/)) {
      if (!/verified nonexistent/i.test(line)) continue;
      for (const m of line.matchAll(/`([^`]+)`/g)) {
        for (const p of expandBracePaths(m[1])) {
          const clean = p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/g, "");
          if (clean && /\//.test(clean)) paths.add(clean);
        }
      }
    }
  }
  return [...paths];
}

/** Expand a shell-style brace path `a/{x,y}` into ["a/x","a/y"]; passthrough otherwise. */
function expandBracePaths(p) {
  const s = String(p || "").trim();
  const m = /^(.*)\{([^}]+)\}(.*)$/.exec(s);
  if (!m) return [s];
  const [, pre, inner, post] = m;
  return inner.split(",").map((part) => `${pre}${part.trim()}${post}`);
}

/** Read the `- **Current state:**` / `Final state:` value from a tracker item file. */
function fileStateOf(rel) {
  const md = readRepoFile(rel);
  if (md == null) return null;
  for (const line of md.split(/\r?\n/)) {
    const m = /^[-*]\s*\**\s*(?:current|final)\s+state\s*\**\s*[:：]\s*(.+)$/i.exec(line.trim());
    if (m) return m[1].replace(/[`*]/g, "").trim();
  }
  return null;
}

function run() {
  const trackerPath = path.join(ROOT, "TRACKER.md");
  let tracker = "";
  let trackerPresent = false;
  try {
    tracker = fs.readFileSync(trackerPath, "utf8");
    trackerPresent = true;
  } catch (e) {
    if (e.code !== "ENOENT") {
      // Unreadable for a reason OTHER than absence → runner error, fail-closed.
      return { ok: false, checks: [], fatal: true, error: `TRACKER.md unreadable: ${e.message}` };
    }
    tracker = "";
    trackerPresent = false;
  }

  // Build the link-existence map from the real markdown links in TRACKER.md...
  const links = extractLinks(tracker);
  const linkTargets = {};
  for (const l of links) linkTargets[l] = resolveLinkExists(l);

  // ...plus each item's parsed tracker-file link (often a backtick-quoted path,
  // not a markdown link), so check (d) can report a missing tracker file
  // honestly ("missing") rather than as an unverified/fail-closed link.
  const items = parseItems(tracker);
  for (const it of items) {
    const l = it.trackerLink;
    if (l && !Object.prototype.hasOwnProperty.call(linkTargets, l)) {
      linkTargets[l] = resolveLinkExists(l);
    }
  }

  // Build the §33 path-existence map.
  const pathExists = {};
  for (const p of REQUIRED_PATHS) pathExists[p] = existsRepo(p);

  // ── Cross-file (§28.7) seams, built from disk ──────────────────────────────

  // (m) ROADMAP.md.
  const roadmap = readRepoFile("ROADMAP.md");
  const roadmapPresent = roadmap != null;

  // (n) epic IDs from trackers/epics/E-*.md filenames.
  const epicIds = listRepoDir("trackers/epics")
    .filter((f) => /^E-.*\.md$/i.test(f))
    .map(epicIdFromFilename);

  // (o) start-of-work tracker-consult per live mode.
  const modeConsults = {};
  for (const mode of TRACKER_CONSULT_MODES) {
    const md = readRepoFile(`.claude/commands/mode/${mode}.md`);
    modeConsults[mode] = md != null && modeConsultsTracker(md);
  }

  // (q) every Verified-Nonexistent path → actually-absent bool.
  const nonexistence = {};
  for (const p of parseVerifiedNonexistentPaths(tracker)) {
    nonexistence[p] = !existsRepo(p) && !existsRepo(p + "/");
  }

  // (r) each item's linked-file state (only items whose link points to a real file).
  const itemFileStates = {};
  for (const it of items) {
    const link = it.trackerLink;
    if (!link) continue;
    const rel = link.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\//, "");
    if (!/(^|\/)trackers\//.test(rel) || !/\.md$/i.test(rel)) continue; // file, under trackers/
    if (!existsRepo(rel)) continue; // (d) reports a missing tracker file; don't double-fail here
    itemFileStates[it.label] = fileStateOf(rel); // null if state field unreadable → (r) fail-closed
  }

  // (s) expected enforcement hooks → exists bool.
  const enforcementHooks = {};
  for (const h of EXPECTED_ENFORCEMENT_HOOKS) enforcementHooks[h] = existsRepo(h);

  const res = evaluate({
    tracker,
    trackerPresent,
    items,
    linkTargets,
    pathExists,
    roadmap: roadmap || "",
    roadmapPresent,
    epicIds,
    modeConsults,
    nonexistence,
    itemFileStates,
    enforcementHooks,
  });
  res.fatal = false;
  res.summary = {
    sections: REQUIRED_SECTIONS.length,
    links: links.length,
    requiredPaths: REQUIRED_PATHS.length,
    epics: epicIds.length,
    root: ROOT,
  };
  // ADVISORY tier (S-10 / ED-034) — report-only; NEVER changes res.ok / exit code
  // / the 20 binding checks. Attached separately so the "20" tally stays honest.
  res.advisory = { deixis: evaluateDeixis({ tracker }) };
  return res;
}

// ── Reporting ─────────────────────────────────────────────────────────────────
function report(res) {
  const lines = [];
  if (res.fatal) {
    lines.push(`FATAL [${NAME}] runner error (fail-closed): ${res.error || "unknown"}`);
    return lines.join("\n");
  }
  const failed = res.checks.filter((c) => c.status === "FAIL");
  if (res.ok) {
    lines.push(`PASS [${NAME}] all ${res.checks.length} checks pass`);
  } else {
    lines.push(`FAIL [${NAME}] ${failed.length}/${res.checks.length} check(s) failed`);
  }
  for (const c of res.checks) {
    lines.push(`  ${c.status === "PASS" ? "·" : "✗"} ${c.check}: ${c.status}`);
    for (const d of c.details) lines.push(`      - ${d}`);
  }
  if (res.summary) {
    lines.push(
      `  (${res.summary.links} link(s) · ${res.summary.requiredPaths} §33 path(s) · ${res.summary.epics != null ? res.summary.epics + " epic(s) · " : ""}root ${res.summary.root})`
    );
  }
  // ── ADVISORY (S-10 / ED-034): report-only, OUTSIDE the binding 20 ────────────
  if (res.advisory && res.advisory.deixis) {
    const w = res.advisory.deixis.warnings || [];
    lines.push("");
    lines.push(
      `ADVISORY [${NAME}] session-relative-language (anti-deixis, REPORT-ONLY · not part of the 20 binding checks): ${w.length} warning(s)`
    );
    for (const wn of w.slice(0, 50)) {
      lines.push(`      ⚠ L${wn.line} «${wn.phrase}» — ${wn.clause}`);
    }
    if (w.length > 50) lines.push(`      … and ${w.length - 50} more`);
    if (w.length === 0) lines.push("      · no un-anchored session-relative deixis found");
  }
  return lines.join("\n");
}

// ── In-file bite-test ─────────────────────────────────────────────────────────
/**
 * Proves each named check FIRES on a failing synthetic input AND stays clean on
 * a passing one. A validator with no negative test is a false-green waiting to
 * happen. Runs with: node scripts/trackers/validate.js --selftest
 */
function selftest() {
  const results = [];
  const t = (name, fn) => {
    try {
      fn();
      results.push({ name, ok: true });
    } catch (e) {
      results.push({ name, ok: false, err: e.message });
    }
  };
  const assert = (cond, msg) => {
    if (!cond) throw new Error(msg || "assertion failed");
  };
  const checkOf = (res, name) => res.checks.find((c) => c.check === name);
  const passes = (res, name) => checkOf(res, name).status === "PASS";
  const fails = (res, name) => checkOf(res, name).status === "FAIL";

  // ── Representative fixtures ──────────────────────────────────────────────
  // The synthetic tracker mirrors the REAL TRACKER.md structure so the parser
  // itself is bite-tested: the 34 §5 sections are H1 headings; "Header" is the
  // `# TRACKER.md` title block (Version/Owner/Authority), NOT a literal
  // `# Header`; definitions are `## Definition: <Term>` H2 subsections under
  // `# Definitions`; epic/sprint items are `### <LABEL>` H3 subsections under
  // the Active/Planned/Completed Epics/Sprints H1 sections, with bulleted
  // fields. Items are parsed from this markdown (NOT injected), so a–i exercise
  // the H1-section / H3-item / H2-definition parsing both ways.

  // The Header (spec §6) is the document-title H1 + version/owner/authority.
  const HEADER_BLOCK = [
    "# TRACKER.md",
    "",
    "Version: 1.0.0",
    "Owner: President Agent",
    "Authority: highest written source of truth for tracked work.",
    "",
  ].join("\n");

  // Default coherent items, by section. Each renders to a `### <LABEL>` H3 with
  // the real field labels. kind/state derive from the containing section.
  const defaultItems = () => ({
    "Active Epics": [
      {
        label: "E-DEMO-001 — demo epic",
        fields: {
          "Current state": "Active.",
          "Percent completion": "40%",
          "Next required action": "Build the engine.",
          "Evidence of progress": "scaffolding committed.",
          "Link to epic tracker": "`trackers/epics/E-DEMO-001-x.md`",
        },
      },
    ],
    "Active Sprints": [
      {
        label: "T1 — demo sprint",
        fields: {
          "Current state": "Active.",
          "Percent completion": "50%",
          "Next required action": "Write the validator.",
          "Evidence of progress": "draft authored.",
          "Parent epic": "E-DEMO-001.",
          "Link to sprint tracker": "`trackers/sprints/T1-y.md`",
        },
      },
    ],
    "Completed Epics": [
      {
        label: "E-DONE-000 — finished epic",
        fields: {
          "Final state": "Completed.",
          "Percent completion": "100%",
          "Evidence of completion (verified against disk + git)": "commit abc123; scan green.",
          "Link to epic tracker": "`trackers/epics/E-DONE-000-z.md`",
        },
      },
    ],
  });

  // The tracker links each item declares (so (c)/(d) can resolve them).
  const itemLinkTargets = {
    "trackers/epics/E-DEMO-001-x.md": true,
    "trackers/sprints/T1-y.md": true,
    "trackers/epics/E-DONE-000-z.md": true,
  };

  // A coherent Session-Logging entry: a real session log with a Session ID field.
  const SESSION_LOG_BODY = [
    "Every meaningful work session on an epic or sprint must be logged. Each entry must include: session ID; date; work performed.",
    "",
    "Seed session log (keystone-authoring session): Session ID: to be backfilled · Date: 2026-06-05 · Work performed: authored the tracker.",
  ].join("\n");

  // A coherent Known-Gaps body that ACKNOWLEDGES the missing enforcement hooks so
  // check (s) stays green under the enforcement-debt pattern.
  const KNOWN_GAPS_BODY = [
    "### G-1 — Tracker enforcement hooks pending",
    "- Description: the start-of-work / completion-gate enforcement hook is not yet built; tracked here so the absence is visible.",
    "- Current state: Recorded; no enforcement hook in `.claude/hooks` yet.",
  ].join("\n");

  // Per-section coherent bodies for sections that carry parsed cross-file content.
  const SECTION_BODIES = {
    "Session Logging Rules": SESSION_LOG_BODY,
    "Known Gaps and Open Flaws": KNOWN_GAPS_BODY,
  };

  // Render an item map back into a faithful markdown tracker.
  const renderTracker = (itemsBySection) =>
    REQUIRED_SECTIONS.map((s) => {
      if (s === "Header") return HEADER_BLOCK;
      if (s === "Definitions") {
        // Define every core term as a `## Definition: <Term>` H2 so (k) is clean.
        const defs = CORE_TERMS.map(
          (term) =>
            `## Definition: ${term}\nDefinition: operational definition of ${term}.\nWhy it matters: it matters.\nWhere it applies: everywhere.`
        ).join("\n\n");
        return `# ${s}\n\n${defs}\n`;
      }
      if (Object.prototype.hasOwnProperty.call(SECTION_BODIES, s)) {
        return `# ${s}\n\n${SECTION_BODIES[s]}\n`;
      }
      const its = itemsBySection[s];
      if (its && its.length) {
        const body = its
          .map(
            (it) =>
              `### ${it.label}\n` +
              Object.entries(it.fields)
                .map(([k, v]) => `- ${k}: ${v}`)
                .join("\n")
          )
          .join("\n\n");
        return `# ${s}\n\n${body}\n`;
      }
      return `# ${s}\n\nNone currently recorded.\n`;
    }).join("\n");

  const coherentSections = renderTracker(defaultItems());
  const coherentPaths = {};
  for (const p of REQUIRED_PATHS) coherentPaths[p] = true;

  // ── Cross-file (§28.7) coherent seam fixtures ────────────────────────────────
  // A coherent ROADMAP: an `## Epics` registry, a DEPRECATED Milestones heading,
  // and a reference to each demo epic ID.
  const coherentRoadmap = [
    "# ROADMAP",
    "",
    "## Epics",
    "- E-DEMO-001 — demo epic (active)",
    "- E-DONE-000 — finished epic (completed)",
    "",
    "## 🏛 Milestones — ⚠️ DEPRECATED (migrated to `## Epics`)",
    "- (historical only)",
  ].join("\n");
  const coherentEpicIds = ["E-DEMO-001", "E-DONE-000"];
  const coherentModeConsults = { solo: true, adhoc: true, oneshot: true, sprint: true };
  const coherentNonexistence = { ".claude/agents/00-alex": true, ".claude/agents/01-adhoc": true };
  // Item file-states agree with the rendered TRACKER item states (parsed labels:
  // E-DEMO-001 Active, T1 Active, E-DONE-000 Completed).
  const coherentItemFileStates = {
    "E-DEMO-001": "Active",
    "T1": "Active",
    "E-DONE-000": "Completed",
  };
  // Enforcement hooks are MISSING but acknowledged in Known Gaps → (s) PASS.
  const coherentHooks = {
    "scripts/hooks/tracker-start-of-work.js": false,
    "scripts/hooks/tracker-completion-gate.js": false,
  };

  const crossFileSeams = () => ({
    roadmap: coherentRoadmap,
    roadmapPresent: true,
    epicIds: [...coherentEpicIds],
    modeConsults: { ...coherentModeConsults },
    nonexistence: { ...coherentNonexistence },
    itemFileStates: { ...coherentItemFileStates },
    enforcementHooks: { ...coherentHooks },
  });

  // A coherent input — items are PARSED from the markdown (not injected), so the
  // parser is exercised. linkTargets cover the item links + are fail-closed safe.
  const coherent = () => ({
    tracker: coherentSections,
    trackerPresent: true,
    linkTargets: { ...itemLinkTargets },
    pathExists: { ...coherentPaths },
    ...crossFileSeams(),
  });

  // Build an input from a mutated item map (re-rendered, re-parsed).
  const withItems = (mutate) => {
    const map = defaultItems();
    mutate(map);
    return {
      tracker: renderTracker(map),
      trackerPresent: true,
      linkTargets: { ...itemLinkTargets },
      pathExists: { ...coherentPaths },
      ...crossFileSeams(),
    };
  };

  // 0. POSITIVE — coherent input → ok:true, every check PASS.
  t("coherent → all checks PASS", () => {
    const res = evaluate(coherent());
    assert(res.ok, "expected ok:true, failures: " +
      res.checks.filter((c) => c.status === "FAIL").map((c) => c.check + " " + c.details.join("; ")).join(" | "));
    assert(!res.fatal, "must not be fatal");
  });

  // (a) sections-present — drop a section → fires.
  t("(a) missing section → sections-present FAIL", () => {
    const s = coherent();
    s.tracker = s.tracker.replace("# Known Gaps and Open Flaws", "# Bogus Heading");
    const res = evaluate(s);
    assert(fails(res, "sections-present"), "expected sections-present FAIL");
    assert(checkOf(res, "sections-present").details.some((d) => d.includes("Known Gaps")), "should name the missing section");
  });

  // (a) PASS — coherent keeps it green (incl. the `# TRACKER.md` Header block).
  t("(a) coherent → sections-present PASS", () => assert(passes(evaluate(coherent()), "sections-present")));

  // (a) Header — a title block missing version/owner/authority FAILs "Header".
  t("(a) header w/o version/owner block → sections-present FAIL", () => {
    const s = coherent();
    s.tracker = s.tracker.replace(HEADER_BLOCK, "# TRACKER.md\n\nA title with no version/owner/authority block.\n");
    const res = evaluate(s);
    assert(fails(res, "sections-present"), "expected sections-present FAIL");
    assert(checkOf(res, "sections-present").details.some((d) => d.includes("Header")), "should name Header");
  });

  // (b) no-blank-section — blank a section (no content, no sentinel) → fires.
  t("(b) blank section → no-blank-section FAIL", () => {
    const s = coherent();
    s.tracker = s.tracker.replace("# Untracked Work\n\nNone currently recorded.\n", "# Untracked Work\n\n");
    const res = evaluate(s);
    assert(fails(res, "no-blank-section"), "expected no-blank-section FAIL");
  });
  t("(b) sentinel section → no-blank-section PASS", () => assert(passes(evaluate(coherent()), "no-blank-section")));

  // (c) broken-links — a link target that does not exist → fires.
  t("(c) broken link → broken-links FAIL", () => {
    const s = coherent();
    s.tracker = coherentSections + "\n\nSee [the sprint](trackers/sprints/MISSING.md).\n";
    s.linkTargets = { ...itemLinkTargets, "trackers/sprints/MISSING.md": false };
    const res = evaluate(s);
    assert(fails(res, "broken-links"), "expected broken-links FAIL");
  });
  t("(c) clean links → broken-links PASS", () => {
    const s = coherent();
    s.tracker = coherentSections + "\n\nSee [the sprint](trackers/sprints/T1-y.md).\n";
    assert(passes(evaluate(s), "broken-links"));
  });
  // (c) fail-closed — an UNVERIFIED link (no existence info) is treated as broken.
  t("(c) unverified link → broken-links FAIL (fail-closed)", () => {
    const s = coherent();
    s.tracker = coherentSections + "\n\nSee [x](trackers/epics/UNKNOWN.md).\n";
    // deliberately do NOT add UNKNOWN.md to linkTargets
    const res = evaluate(s);
    assert(fails(res, "broken-links"), "unverified link must fail closed");
  });

  // (d) active-tracker-files — active item with no tracker link → fires.
  t("(d) active w/o tracker file → active-tracker-files FAIL", () => {
    const s = withItems((m) => {
      delete m["Active Epics"][0].fields["Link to epic tracker"];
    });
    const res = evaluate(s);
    assert(fails(res, "active-tracker-files"), "expected active-tracker-files FAIL");
  });
  // (d) active item whose tracker file is MISSING (link present but unresolvable) → fires.
  t("(d) active tracker file missing → active-tracker-files FAIL", () => {
    const s = withItems((m) => {
      m["Active Sprints"][0].fields["Link to sprint tracker"] = "`trackers/sprints/GONE.md`";
    });
    s.linkTargets = { ...itemLinkTargets, "trackers/sprints/GONE.md": false };
    const res = evaluate(s);
    assert(fails(res, "active-tracker-files"), "expected active-tracker-files FAIL");
    assert(checkOf(res, "active-tracker-files").details.some((d) => /GONE\.md/.test(d)), "names the missing file");
  });
  t("(d) active w/ tracker file → active-tracker-files PASS", () => assert(passes(evaluate(coherent()), "active-tracker-files")));

  // (e) active-next-action — active item with no next action → fires.
  t("(e) active w/o next action → active-next-action FAIL", () => {
    const s = withItems((m) => {
      delete m["Active Epics"][0].fields["Next required action"];
    });
    const res = evaluate(s);
    assert(fails(res, "active-next-action"), "expected active-next-action FAIL");
  });
  t("(e) active w/ next action → active-next-action PASS", () => assert(passes(evaluate(coherent()), "active-next-action")));

  // (f) completed-evidence — completed item with no evidence → fires.
  t("(f) completed w/o evidence → completed-evidence FAIL", () => {
    const s = withItems((m) => {
      delete m["Completed Epics"][0].fields["Evidence of completion (verified against disk + git)"];
    });
    const res = evaluate(s);
    assert(fails(res, "completed-evidence"), "expected completed-evidence FAIL");
  });
  // (f) PASS — the parenthetical-qualified evidence label is parsed as evidence.
  t("(f) completed w/ qualified evidence → completed-evidence PASS", () => assert(passes(evaluate(coherent()), "completed-evidence")));

  // (g) completed-100 — completed item below 100% → fires.
  t("(g) completed <100% → completed-100 FAIL", () => {
    const s = withItems((m) => {
      m["Completed Epics"][0].fields["Percent completion"] = "80%";
    });
    const res = evaluate(s);
    assert(fails(res, "completed-100"), "expected completed-100 FAIL");
  });
  t("(g) completed at 100% → completed-100 PASS", () => assert(passes(evaluate(coherent()), "completed-100")));

  // (h) hundred-completed — 100% item not marked completed → fires.
  t("(h) 100% not completed → hundred-completed FAIL", () => {
    const s = withItems((m) => {
      m["Active Epics"][0].fields["Percent completion"] = "100%"; // active+100% → contradiction
    });
    const res = evaluate(s);
    assert(fails(res, "hundred-completed"), "expected hundred-completed FAIL");
  });
  t("(h) 100%↔completed consistent → hundred-completed PASS", () => assert(passes(evaluate(coherent()), "hundred-completed")));

  // (i) sprint-parent-epic — sprint with no parent epic → fires.
  t("(i) sprint w/o parent epic → sprint-parent-epic FAIL", () => {
    const s = withItems((m) => {
      delete m["Active Sprints"][0].fields["Parent epic"];
    });
    const res = evaluate(s);
    assert(fails(res, "sprint-parent-epic"), "expected sprint-parent-epic FAIL");
  });
  t("(i) sprint w/ parent epic → sprint-parent-epic PASS", () => assert(passes(evaluate(coherent()), "sprint-parent-epic")));

  // (j) ambiguous-language — a §21 prohibited phrase → fires.
  t("(j) ambiguous phrase → ambiguous-language FAIL", () => {
    const s = coherent();
    s.tracker = coherentSections + "\n\nThis epic is probably complete and should be fine.\n";
    const res = evaluate(s);
    assert(fails(res, "ambiguous-language"), "expected ambiguous-language FAIL");
    assert(checkOf(res, "ambiguous-language").details.length >= 2, "should catch both phrases");
  });
  t("(j) clean language → ambiguous-language PASS", () => assert(passes(evaluate(coherent()), "ambiguous-language")));

  // (k) undefined-terms — a used core term missing from Definitions → fires.
  t("(k) undefined term → undefined-terms FAIL", () => {
    const s = coherent();
    // Remove the Reconciliation `## Definition:` block but keep using the term.
    s.tracker = s.tracker.replace(
      "## Definition: Reconciliation\nDefinition: operational definition of Reconciliation.\nWhy it matters: it matters.\nWhere it applies: everywhere.",
      ""
    ) + "\n\nThe Reconciliation step resolves conflicts.\n";
    const res = evaluate(s);
    assert(fails(res, "undefined-terms"), "expected undefined-terms FAIL");
    assert(checkOf(res, "undefined-terms").details.some((d) => /Reconciliation/.test(d)), "should name Reconciliation");
  });
  t("(k) all used terms defined → undefined-terms PASS", () => assert(passes(evaluate(coherent()), "undefined-terms")));

  // (l) required-paths — a missing §33 path → fires.
  t("(l) missing §33 path → required-paths FAIL", () => {
    const s = coherent();
    s.pathExists = { ...coherentPaths, "UNTRACKED_WORK.md": false };
    const res = evaluate(s);
    assert(fails(res, "required-paths"), "expected required-paths FAIL");
  });
  t("(l) all §33 paths present → required-paths PASS", () => assert(passes(evaluate(coherent()), "required-paths")));
  // (l) fail-closed — an unprobed path is treated as missing.
  t("(l) unprobed §33 path → required-paths FAIL (fail-closed)", () => {
    const s = coherent();
    s.pathExists = { ...coherentPaths };
    delete s.pathExists["ROADMAP.md"];
    const res = evaluate(s);
    assert(fails(res, "required-paths"), "unprobed path must fail closed");
  });

  // ── CROSS-FILE CHECKS (m–t): one PASS + one FAIL each, all fail-closed ───────

  // (m) roadmap-epic-based — a LIVE (non-deprecated) Milestones heading → fires.
  t("(m) coherent → roadmap-epic-based PASS", () => assert(passes(evaluate(coherent()), "roadmap-epic-based")));
  t("(m) live milestones heading → roadmap-epic-based FAIL", () => {
    const s = coherent();
    s.roadmap = "# ROADMAP\n\n## Epics\n- E-DEMO-001\n\n## 🏛 Milestones\n- still here, not deprecated\n";
    const res = evaluate(s);
    assert(fails(res, "roadmap-epic-based"), "live Milestones heading must fail");
  });
  // (m) fail-closed — absent roadmap → FAIL.
  t("(m) absent roadmap → roadmap-epic-based FAIL (fail-closed)", () => {
    const s = coherent();
    s.roadmap = "";
    s.roadmapPresent = false;
    assert(fails(evaluate(s), "roadmap-epic-based"), "absent roadmap must fail closed");
  });

  // (n) epics-in-roadmap — an epic ID not referenced in ROADMAP → fires.
  t("(n) coherent → epics-in-roadmap PASS", () => assert(passes(evaluate(coherent()), "epics-in-roadmap")));
  t("(n) epic absent from roadmap → epics-in-roadmap FAIL", () => {
    const s = coherent();
    s.epicIds = [...s.epicIds, "E-MISSING-999"];
    const res = evaluate(s);
    assert(fails(res, "epics-in-roadmap"), "unreferenced epic must fail");
    assert(checkOf(res, "epics-in-roadmap").details.some((d) => /E-MISSING-999/.test(d)), "names the missing epic");
  });
  // (n) fail-closed — epics on disk but no seam → FAIL.
  t("(n) no epicIds seam → epics-in-roadmap FAIL (fail-closed)", () => {
    const s = coherent();
    delete s.epicIds;
    assert(fails(evaluate(s), "epics-in-roadmap"), "missing epicIds seam must fail closed");
  });

  // (o) modes-consult-tracker — a mode missing its consult step → fires.
  t("(o) coherent → modes-consult-tracker PASS", () => assert(passes(evaluate(coherent()), "modes-consult-tracker")));
  t("(o) a mode missing consult → modes-consult-tracker FAIL", () => {
    const s = coherent();
    s.modeConsults = { ...s.modeConsults, oneshot: false };
    const res = evaluate(s);
    assert(fails(res, "modes-consult-tracker"), "missing mode consult must fail");
    assert(checkOf(res, "modes-consult-tracker").details.some((d) => /oneshot/.test(d)), "names oneshot");
  });
  // (o) fail-closed — no seam → FAIL.
  t("(o) no modeConsults seam → modes-consult-tracker FAIL (fail-closed)", () => {
    const s = coherent();
    delete s.modeConsults;
    assert(fails(evaluate(s), "modes-consult-tracker"), "missing modeConsults seam must fail closed");
  });

  // (p) work-log-session-id — a session-log entry with no ID and no sentinel → fires.
  t("(p) coherent → work-log-session-id PASS", () => assert(passes(evaluate(coherent()), "work-log-session-id")));
  t("(p) entry w/o session ID or sentinel → work-log-session-id FAIL", () => {
    const s = coherent();
    s.tracker = s.tracker.replace(
      "Seed session log (keystone-authoring session): Session ID: to be backfilled · Date: 2026-06-05 · Work performed: authored the tracker.",
      "Orphan session log: Date: 2026-06-05 · Work performed: did some work with no recorded session identifier."
    );
    const res = evaluate(s);
    assert(fails(res, "work-log-session-id"), "unidentified session-log entry must fail");
  });

  // (q) expected-nonexistence — a "Verified Nonexistent" path that EXISTS → fires.
  t("(q) coherent → expected-nonexistence PASS", () => assert(passes(evaluate(coherent()), "expected-nonexistence")));
  t("(q) nonexistent-marked path exists → expected-nonexistence FAIL", () => {
    const s = coherent();
    s.nonexistence = { ...s.nonexistence, ".claude/agents/00-alex": false }; // actually present
    const res = evaluate(s);
    assert(fails(res, "expected-nonexistence"), "an existing should-be-absent path must fail");
    assert(checkOf(res, "expected-nonexistence").details.some((d) => /00-alex/.test(d)), "names the path");
  });
  // (q) fail-closed — no seam → FAIL.
  t("(q) no nonexistence seam → expected-nonexistence FAIL (fail-closed)", () => {
    const s = coherent();
    delete s.nonexistence;
    assert(fails(evaluate(s), "expected-nonexistence"), "missing nonexistence seam must fail closed");
  });

  // (r) cross-file-reconciliation — TRACKER state disagrees with the file's state → fires.
  t("(r) coherent → cross-file-reconciliation PASS", () => assert(passes(evaluate(coherent()), "cross-file-reconciliation")));
  t("(r) state disagrees with file → cross-file-reconciliation FAIL", () => {
    const s = coherent();
    s.itemFileStates = { ...s.itemFileStates, "E-DEMO-001": "Completed" }; // TRACKER says Active
    const res = evaluate(s);
    assert(fails(res, "cross-file-reconciliation"), "state disagreement must fail");
    assert(checkOf(res, "cross-file-reconciliation").details.some((d) => /E-DEMO-001/.test(d)), "names the item");
  });
  // (r) fail-closed — a linked file whose state could not be read → FAIL.
  t("(r) unreadable linked-file state → cross-file-reconciliation FAIL (fail-closed)", () => {
    const s = coherent();
    s.itemFileStates = { ...s.itemFileStates, "T1": null }; // file present but state unreadable
    assert(fails(evaluate(s), "cross-file-reconciliation"), "unverified file state must fail closed");
  });

  // (s) hooks-enforce-or-tracked — hook missing AND gap NOT acknowledged → fires.
  t("(s) coherent (missing-but-tracked) → hooks-enforce-or-tracked PASS", () => assert(passes(evaluate(coherent()), "hooks-enforce-or-tracked")));
  t("(s) hook missing + gap unacknowledged → hooks-enforce-or-tracked FAIL", () => {
    const s = coherent();
    // Strip the Known-Gaps acknowledgement of the enforcement hook.
    s.tracker = s.tracker.replace(KNOWN_GAPS_BODY, "None currently recorded.");
    const res = evaluate(s);
    assert(fails(res, "hooks-enforce-or-tracked"), "missing+unacknowledged hook must fail");
  });
  // (s) fail-closed — no seam → FAIL.
  t("(s) no enforcementHooks seam → hooks-enforce-or-tracked FAIL (fail-closed)", () => {
    const s = coherent();
    delete s.enforcementHooks;
    assert(fails(evaluate(s), "hooks-enforce-or-tracked"), "missing enforcementHooks seam must fail closed");
  });

  // (t) definition-drift — a term with two materially-different definitions → fires.
  t("(t) coherent → definition-drift PASS", () => assert(passes(evaluate(coherent()), "definition-drift")));
  t("(t) two divergent definitions of a term → definition-drift FAIL", () => {
    const s = coherent();
    // Append a second, materially-different `## Definition: Epic` block.
    s.tracker = s.tracker + "\n\n## Definition: Epic\nDefinition: a tiny throwaway one-off chore unrelated to any long-running goal whatsoever.\n";
    const res = evaluate(s);
    assert(fails(res, "definition-drift"), "divergent duplicate definition must fail");
    assert(checkOf(res, "definition-drift").details.some((d) => /epic/i.test(d)), "names the drifted term");
  });

  // FAIL-CLOSED — missing tracker → not a pass, sections-present FAILs, never throws.
  t("missing tracker → not-ok, fail-closed (no throw)", () => {
    const res = evaluate({ tracker: "", trackerPresent: false, items: [], linkTargets: {}, pathExists: coherentPaths });
    assert(!res.ok, "missing tracker must not be ok");
    assert(fails(res, "sections-present"), "missing tracker → sections-present FAIL");
    assert(!res.fatal, "evaluate must not mark fatal for missing content");
  });

  // FAIL-CLOSED — malformed/garbage input does not throw and is not ok.
  t("garbage input → handled, not-ok, no throw", () => {
    const res = evaluate({ tracker: "\u0000￿###no headings here\n[bad](", trackerPresent: true, linkTargets: {}, pathExists: {} });
    assert(res && Array.isArray(res.checks), "must return a structured result");
    assert(!res.ok, "garbage must not pass");
  });

  // parseItems extracts items ONLY from the H1 state sections, one per `### <LABEL>`
  // H3, reading the real field-label variants — and NEVER scrapes prose/defs.
  t("parseItems extracts items from H1 sections + H3 labels (real structure)", () => {
    const md = [
      "# Definitions",
      "## Definition: Sprint",
      "Definition: prose mentioning a sprint-conductor and epic-based roadmap (must NOT become items).",
      "",
      "# Active Sprints",
      "### T7 — ε runtime",
      "- Link to sprint tracker: `trackers/sprints/T7-eps.md`",
      "- Current state: Active.",
      "- Percent completion: 50%",
      "- Next required action: spawn agents.",
      "- Parent epic: E-DEMO-007.",
      "",
      "# Completed Epics",
      "### E-DONE-000 — foundation",
      "- Final state: Completed.",
      "- Percent completion: 100%",
      "- Evidence of completion (verified vs git): commit db0a778. Parent epic: none.",
    ].join("\n");
    const items = parseItems(md);
    // Prose/definitions must NOT be scraped as items.
    assert(items.length === 2, "exactly 2 items (no prose/def scraping), got " + items.length + ": " + items.map((i) => i.label).join(","));
    const sp = items.find((i) => i.label === "T7");
    const ep = items.find((i) => i.label === "E-DONE-000");
    assert(sp && sp.kind === "sprint" && sp.percent === 50 && sp.parentEpic === "E-DEMO-007.", "sprint parse");
    assert(sp.state === "Active." && sp.nextAction === "spawn agents." && sp.trackerLink === "trackers/sprints/T7-eps.md", "sprint fields");
    assert(ep && ep.kind === "epic" && ep.percent === 100 && /db0a778/.test(ep.evidence), "epic parse (qualified evidence label)");
  });

  // parseItems must NOT treat prose like "epic-based" / "sprint-conductor" as items.
  t("parseItems ignores prose EPIC-/SPRINT-like tokens outside item sections", () => {
    const md = [
      HEADER_BLOCK,
      "# Definitions",
      "## Definition: Epic",
      "Definition: the ROADMAP is not yet epic-based; the ε sprint-conductor runtime shipped.",
      "# System Inventory",
      "| ROADMAP.md | File | not yet epic-based | Yes |",
    ].join("\n");
    const items = parseItems(md);
    assert(items.length === 0, "prose must yield zero items, got: " + items.map((i) => i.label).join(","));
  });

  // ── ADVISORY (S-10 / ED-034): session-relative-language (anti-deixis) ────────
  // Planted-violation P5 cases — prove the check FLAGS a bare deictic phrase,
  // does NOT flag an anchored one, and honors every allowlist context.
  const deixisWarns = (md) => evaluateDeixis({ tracker: md }).warnings;
  const hasPhrase = (md, sub) =>
    deixisWarns(md).some((w) => w.phrase.includes(sub) || w.clause.toLowerCase().includes(sub.toLowerCase()));

  // (a) FLAGGED — a banned deictic phrase with NO in-clause anchor.
  t("(deixis) bare 'no execution this session' → FLAGGED", () => {
    const w = deixisWarns("# Active Epics\n\n- Status: no execution this session.\n");
    assert(w.length >= 1, "expected ≥1 deixis warning, got " + w.length);
    assert(w.some((x) => x.phrase === "this session"), "should name 'this session'");
  });
  t("(deixis) 'NEXT ACTION (session 4): do Y' → FLAGGED (ordinal)", () =>
    assert(hasPhrase("# Active Sprints\n\n- NEXT ACTION (session 4): do Y\n", "ordinal"), "session ordinal must flag"));
  t("(deixis) bare 'currently procedural' → FLAGGED", () =>
    assert(deixisWarns("# Validation Requirements\n\nEnforcement is currently procedural.\n").length >= 1, "currently must flag"));

  // (b) NOT flagged — the SAME phrase WITH an absolute anchor in-clause.
  t("(deixis) 'DONE this session 2026-06-08' (ISO anchor) → NOT flagged", () =>
    assert(deixisWarns("# Completed Epics\n\n- DONE this session 2026-06-08; evidence recorded.\n").length === 0,
      "ISO date in-clause should anchor"));
  t("(deixis) 'this session @aa60e7e' (hash anchor) → NOT flagged", () =>
    assert(deixisWarns("# Completed Epics\n\n- Shipped this session @aa60e7e.\n").length === 0,
      "commit hash in-clause should anchor"));
  t("(deixis) anchor only counts WITHIN the same clause", () => {
    // ISO date in a DIFFERENT clause (after the period) must NOT rescue the
    // un-anchored deictic clause before it.
    const w = deixisWarns("# Active Epics\n\n- No work this session. Reconciled 2026-06-08.\n");
    assert(w.length >= 1, "cross-clause anchor must NOT rescue the deictic clause");
  });

  // (c) ALLOWLIST — fenced block, blockquote, convention section, sentinel.
  t("(deixis) inside fenced ``` block → NOT flagged (allowlist)", () => {
    const md = "# Active Epics\n\n```\nno execution this session\n```\n";
    assert(deixisWarns(md).length === 0, "fenced code must be exempt");
  });
  t("(deixis) blockquoted old-handoff line → NOT flagged (allowlist)", () =>
    assert(deixisWarns("# Active Epics\n\n> handoff said: no execution this session\n").length === 0,
      "blockquote must be exempt"));
  t("(deixis) Language Rules section listing the bans → NOT flagged (allowlist)", () => {
    const md = "# Language Rules\n\nProhibited: \"this session\"; \"next session\"; \"currently\"; session 3.\n";
    assert(deixisWarns(md).length === 0, "rule-definition section must be exempt");
  });
  t("(deixis) anti-deixis convention section → NOT flagged (allowlist)", () => {
    const md = "## Tracker language convention (anti-deixis)\n\nBanned: \"this session\", \"currently\", \"session 4\".\n";
    assert(deixisWarns(md).length === 0, "convention section must be exempt");
  });
  t("(deixis) 'None currently recorded.' sentinel → NOT flagged (allowlist)", () =>
    assert(deixisWarns("# Untracked Work\n\nNone currently recorded.\n").length === 0,
      "empty-section sentinel must be exempt"));

  // (d) "now" tuning — adjectival change-result NOT flagged; deictic IS flagged.
  t("(deixis) 'now epic-based' (change-result) → NOT flagged", () =>
    assert(deixisWarns("# System Inventory\n\nROADMAP.md is now epic-based.\n").length === 0,
      "adjectival 'now <X>' must not flag"));
  t("(deixis) 'right now' (deictic) → FLAGGED", () =>
    assert(deixisWarns("# Active Epics\n\n- Do this right now.\n").length >= 1, "deictic 'right now' must flag"));

  // (e) advisory is REPORT-ONLY — run() attaches it without changing the 20/ok.
  t("(deixis) advisory is separate from the 20 binding checks (report-only)", () => {
    const res = evaluate(coherent());
    assert(res.checks.length === 20, "binding suite must be exactly 20 checks, got " + res.checks.length);
    assert(!res.checks.some((c) => c.check === "session-relative-language"),
      "deixis check must NOT be in the binding checks array");
  });

  // (f) REMOVE-THE-CHECK guard — if evaluateDeixis stopped flagging, this FAILS.
  t("(deixis) check is live — a known violation produces ≥1 warning", () =>
    assert(deixisWarns("loose prose: handled this session, nothing more.\n").length >= 1,
      "a bare deictic phrase MUST produce a warning (check must be live)"));

  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    process.stdout.write(`  ${r.ok ? "ok" : "FAIL"}  ${r.name}${r.ok ? "" : " — " + r.err}\n`);
  }
  if (failed.length) {
    process.stderr.write(`\n${NAME} selftest: ${results.length - failed.length}/${results.length} passed, ${failed.length} FAILED\n`);
    process.exit(1);
  }
  process.stdout.write(`\n${NAME} selftest: ${results.length}/${results.length} bite cases passed (positive + a–t fire both ways + fail-closed + advisory deixis)\n`);
  process.exit(0);
}

// ── main ──────────────────────────────────────────────────────────────────────
function main() {
  const argv = process.argv.slice(2);
  const unknown = argv.filter((a) => !["--json", "--selftest", "--help", "-h"].includes(a));
  if (argv.includes("-h") || argv.includes("--help")) {
    process.stdout.write(
      `Usage: node scripts/trackers/validate.js [--json] [--selftest]\n` +
        `  (default) validate the live tracker system, print a text report\n` +
        `  --json      machine-readable result\n` +
        `  --selftest  run the in-file bite-test\n` +
        `Exit: 0 all-pass · 1 failures found · 2 usage/runner error (fail-closed)\n`
    );
    process.exit(0);
  }
  if (unknown.length) {
    process.stderr.write(`${NAME}: unknown argument(s): ${unknown.join(", ")}\n`);
    process.exit(2);
  }
  if (argv.includes("--selftest")) {
    selftest();
    return;
  }

  let res;
  try {
    res = run();
  } catch (e) {
    // Any uncaught runner error → exit 2, fail-closed. NEVER false-green.
    process.stderr.write(`${NAME}: runner error (fail-closed): ${e.message}\n`);
    process.exit(2);
  }

  if (argv.includes("--json")) {
    process.stdout.write(JSON.stringify(res, null, 2) + "\n");
  } else {
    process.stdout.write(report(res) + "\n");
  }
  if (res.fatal) process.exit(2);
  process.exit(res.ok ? 0 : 1);
}

if (require.main === module) main();

module.exports = {
  evaluate,
  evaluateDeixis, // ADVISORY (S-10 / ED-034) — report-only, outside the 20 binding checks
  splitClauses,
  clauseHasAnchor,
  splitSections,
  parseItems,
  extractLinks,
  parsePercent,
  sectionHasContent,
  REQUIRED_SECTIONS,
  REQUIRED_PATHS,
  AMBIGUOUS_PHRASES,
  CORE_TERMS,
  DEIXIS_PATTERNS,
  run,
};
