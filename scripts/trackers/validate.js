#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const NAME = "trackers/validate";
const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");

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

const EMPTY_SENTINEL_RE = /none\s+currently\s+recorded\.?|no\s+(known\s+)?(entries|items|gaps)\s+currently\s+recorded\.?/i;

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

function normHeading(line) {
  return line
    .replace(/^#+\s*/, "")
    .replace(/^\d+[.)]\s*/, "")
    .replace(/[`*_]/g, "")
    .trim()
    .toLowerCase();
}

function headingMatchesSection(headingText, section) {
  const h = headingText;
  const s = section.toLowerCase();
  return h === s || h.startsWith(s) || h.includes(s);
}

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

function findRequiredSection(sections, section) {
  if (section === "Header") return sections.find(isHeaderSection);
  return sections.find((s) => headingMatchesSection(s.headingText, section));
}

function headingLevel(line) {
  const m = /^(#{1,6})\s+/.exec(line);
  return m ? m[1].length : 0;
}

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

function sectionHasContent(body) {
  const stripped = body.replace(/^[->\s*]+$/gm, "").trim();
  if (stripped.length > 0) return true;
  return EMPTY_SENTINEL_RE.test(body);
}

function extractLinks(md) {
  const out = [];
  const text = String(md == null ? "" : md);
  for (const m of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    let target = m[1].trim();
    if (!target) continue;
    if (/^(https?:|mailto:|#|tel:)/i.test(target)) continue;
    target = target.split("#")[0].split("?")[0].trim();
    if (!target) continue;
    out.push(target);
  }
  return out;
}

const ITEM_SECTIONS = [
  { name: "Active Epics", kind: "epic", defaultState: "Active" },
  { name: "Active Sprints", kind: "sprint", defaultState: "Active" },
  { name: "Planned but Not Started Epics", kind: "epic", defaultState: "Planned" },
  { name: "Planned but Not Started Sprints", kind: "sprint", defaultState: "Planned" },
  { name: "Completed Epics", kind: "epic", defaultState: "Completed" },
  { name: "Completed Sprints", kind: "sprint", defaultState: "Completed" },
];

function parseItems(md) {
  const items = [];
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

function parseItemsFromSection(body, spec) {
  const out = [];
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

function itemLabel(headingText, headingRaw) {
  const raw = String(headingRaw || "")
    .replace(/^#+\s*/, "")
    .trim();
  const head = raw.split(/\s+[—–·-]\s+/)[0].trim() || raw;
  return head || headingText;
}

function applyItemFields(item, body) {
  const lines = String(body == null ? "" : body).split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
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
    if (!item.parentEpic) {
      const inlineParent = line.match(/parent epic\s*[:：]\s*([^.;]+)/i);
      if (inlineParent) item.parentEpic = inlineParent[1].trim();
    }
    if (!item.trackerLink) {
      const inlineLink = extractLinks(raw)[0];
      if (inlineLink) item.trackerLink = inlineLink;
    }
  }
}

function extractFieldLink(line, val) {
  const md = extractLinks(line)[0];
  if (md) return md;
  const tick = String(val).match(/`([^`]+)`/);
  if (tick) return tick[1].trim();
  const firstTok = String(val).trim().split(/\s+/)[0] || "";
  return firstTok.replace(/[`<>]/g, "");
}

function normFieldKey(s) {
  return String(s)
    .replace(/[`*_]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function classifyField(key) {
  if (/^(current |final )?state$/.test(key)) return "state";
  if (/^(percent completion|percent|completion)$/.test(key)) return "percent";
  if (
    /^(next required action|current next action|next action|next|proposed first action)$/.test(
      key
    )
  )
    return "nextAction";
  if (/^evidence(\s+of\s+\w+)?$/.test(key)) return "evidence";
  if (/^parent epic$/.test(key)) return "parentEpic";
  if (/^link(\s+to\b.*)?$/.test(key) || /^tracker$/.test(key)) return "link";
  return "";
}

function parsePercent(val) {
  const m = String(val).match(/(\d{1,3})\s*%?/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (Number.isNaN(n) || n < 0 || n > 100) return null;
  return n;
}

const isActive = (s) => /\bactive\b/i.test(s || "");
const isCompleted = (s) => /\b(completed|complete|done)\b/i.test(s || "");

const TRACKER_CONSULT_MODES = ["solo", "adhoc", "oneshot", "sprint"];

const EXPECTED_ENFORCEMENT_HOOKS = [
  "scripts/hooks/tracker-start-of-work.js",
  "scripts/hooks/tracker-completion-gate.js",
];

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

function epicIdFromFilename(name) {
  const base = String(name || "").replace(/\.md$/i, "");
  const m = /^E-(?:[A-Za-z0-9]+-)*[0-9]{2,}/.exec(base);
  return m ? m[0] : "";
}

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

function parseSessionLogEntries(tracker) {
  const sections = splitSections(String(tracker == null ? "" : tracker), 1);
  const sec = sections.find((s) =>
    headingMatchesSection(s.headingText, "Session Logging Rules")
  );
  if (!sec) return [];
  return sec.body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => {
      if (!p) return false;
      if (/session id\s*[:：]/i.test(p)) return true;
      const head = p.split(/\r?\n/)[0].slice(0, 48);
      return /\bsession log\b[^.\n]*[:：]/i.test(head);
    });
}

function sessionEntryIdentified(entry) {
  const e = String(entry || "");
  if (/to be backfilled/i.test(e)) return true;
  const m = /session id\s*[:：]\s*([^·\n]+)/i.exec(e);
  if (m) {
    const v = m[1].trim().replace(/[.;]+$/, "");
    if (v && !/^to be backfilled/i.test(v)) return true;
  }
  return false;
}

function parseDefinitionBlocks(tracker) {
  const out = {};
  const sections = splitSections(String(tracker == null ? "" : tracker), 2);
  for (const s of sections) {
    const m = /^definition:\s*(.+)$/i.exec(s.headingText.trim());
    if (!m) continue;
    const term = m[1].replace(/[`*_]/g, "").trim().toLowerCase();
    if (!term) continue;
    const body = String(s.body || "")
      .replace(/^\s*definition\s*[:：]\s*/i, "")
      .trim();
    const firstSentence = (body.split(/(?<=[.!?])\s/)[0] || body).trim();
    (out[term] = out[term] || []).push(firstSentence);
  }
  return out;
}

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
  const wa = new Set(na.split(" ").filter(Boolean));
  const wb = new Set(nb.split(" ").filter(Boolean));
  if (wa.size === 0 || wb.size === 0) return na !== nb;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  const union = wa.size + wb.size - inter;
  const jaccard = union === 0 ? 1 : inter / union;
  return jaccard < 0.5;
}

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
    add("parse", [`tracker parse error (fail-closed): ${e.message}`]);
    return { ok: false, checks, fatal: false };
  }

  {
    const details = [];
    if (!trackerPresent) {
      details.push("TRACKER.md is missing — none of the 34 required sections present.");
    } else {
      for (const sec of REQUIRED_SECTIONS) {
        const found = !!findRequiredSection(sections, sec);
        if (!found) details.push(`required section missing: "${sec}"`);
      }
    }
    add("sections-present", details);
  }

  {
    const details = [];
    for (const sec of REQUIRED_SECTIONS) {
      const match = findRequiredSection(sections, sec);
      if (!match) continue;
      if (!sectionHasContent(match.body)) {
        details.push(
          `section "${sec}" is blank — add content or the explicit "None currently recorded." sentinel`
        );
      }
    }
    add("no-blank-section", details);
  }

  {
    const details = [];
    const links = extractLinks(trackerRaw);
    for (const link of links) {
      if (Object.prototype.hasOwnProperty.call(linkTargets, link)) {
        if (!linkTargets[link]) details.push(`broken intra-repo link: ${link} (target does not exist)`);
      } else {
        details.push(`unresolved intra-repo link: ${link} (existence not verified — fail-closed)`);
      }
    }
    add("broken-links", details);
  }

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

  {
    const details = [];
    for (const it of items) {
      if (isActive(it.state) && !String(it.nextAction).trim()) {
        details.push(`active ${it.kind} ${it.label} has no next action`);
      }
    }
    add("active-next-action", details);
  }

  {
    const details = [];
    for (const it of items) {
      if (isCompleted(it.state) && !String(it.evidence).trim()) {
        details.push(`completed ${it.kind} ${it.label} has no evidence`);
      }
    }
    add("completed-evidence", details);
  }

  {
    const details = [];
    for (const it of items) {
      if (isCompleted(it.state) && it.percent !== null && it.percent !== 100) {
        details.push(`completed ${it.kind} ${it.label} is ${it.percent}% (must be 100%)`);
      }
    }
    add("completed-100", details);
  }

  {
    const details = [];
    for (const it of items) {
      if (it.percent === 100 && !isCompleted(it.state)) {
        details.push(`${it.kind} ${it.label} is 100% but state is "${it.state || "(none)"}" (not completed)`);
      }
    }
    add("hundred-completed", details);
  }

  {
    const details = [];
    for (const it of items) {
      if (it.kind === "sprint" && !String(it.parentEpic).trim()) {
        details.push(`sprint ${it.label} names no parent epic`);
      }
    }
    add("sprint-parent-epic", details);
  }

  {
    const details = [];
    const scanText = sections
      .filter((s) => !/language/i.test(s.headingText))
      .map((s) => s.body)
      .join("\n")
      .toLowerCase();
    for (const phrase of AMBIGUOUS_PHRASES) {
      if (scanText.includes(phrase)) {
        details.push(`ambiguous phrase present: "${phrase}"`);
      }
    }
    add("ambiguous-language", details);
  }

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
      if (!new RegExp(`\\b${escapeRe(t)}\\b`).test(bodyOutsideDefs)) continue;
      if (!new RegExp(`\\b${escapeRe(t)}\\b`).test(defsBody)) {
        details.push(`operational term "${term}" is used but not defined in Definitions`);
      }
    }
    add("undefined-terms", details);
  }

  {
    const details = [];
    for (const p of REQUIRED_PATHS) {
      if (Object.prototype.hasOwnProperty.call(pathExists, p)) {
        if (!pathExists[p]) details.push(`required path missing: ${p}`);
      } else {
        details.push(`required path unverified: ${p} (existence not probed — fail-closed)`);
      }
    }
    add("required-paths", details);
  }

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

  {
    const details = [];
    if (itemFileStates === null) {
      details.push("item-file-state seam not provided — cannot reconcile cross-file states (fail-closed)");
    } else {
      for (const it of items) {
        if (!Object.prototype.hasOwnProperty.call(itemFileStates, it.label)) continue;
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

  {
    const details = [];
    if (enforcementHooks === null) {
      details.push("enforcement-hook seam not provided — cannot verify enforcement hooks (fail-closed)");
    } else {
      const gapsSec = sections.find((s) =>
        headingMatchesSection(s.headingText, "Known Gaps and Open Flaws")
      );
      const gapsText = (gapsSec ? gapsSec.body : "").toLowerCase();
      const gapAcknowledged =
        /hook/.test(gapsText) &&
        /(start-of-work|end-of-work|completion-gate|completion gate|enforcement hook)/.test(gapsText);
      for (const [hook, exists] of Object.entries(enforcementHooks)) {
        if (exists === true) continue;
        if (!gapAcknowledged) {
          details.push(`expected enforcement hook missing and NOT acknowledged in Known Gaps: ${hook}`);
        }
      }
    }
    add("hooks-enforce-or-tracked", details);
  }

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

const DEIXIS_PATTERNS = [
  { re: /\bthis\s+session\b/i, label: "this session" },
  { re: /\bnext\s+session\b/i, label: "next session" },
  { re: /\b(?:last|previous|prior)\s+session\b/i, label: "<last/previous/prior> session" },
  { re: /\bthis\s+release\b/i, label: "this release" },
  { re: /\bnext\s+release\b/i, label: "next release" },
  { re: /\bsession\s+\d+\b/i, label: "session <N> (ordinal)" },
  { re: /\bcurrently\b/i, label: "currently" },
  { re: /(?:^|[—·;.]\s*)now\b[,\s]/i, label: "now (clause-initial deictic)" },
  { re: /\b(?:right|as\s+of|for|by|until)\s+now\b/i, label: "<right/as-of/for/by/until> now" },
];

const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/;
const HASH_RE = /\b(?=[0-9a-f]{7,40}\b)[0-9a-f]*[0-9][0-9a-f]*\b/i;

function clauseHasAnchor(clause) {
  return ISO_DATE_RE.test(clause) || HASH_RE.test(clause);
}

function splitClauses(line) {
  return String(line == null ? "" : line)
    .split(/(?:\s—\s|\s·\s|—|·|;|(?<=[.!?])\s)/)
    .map((c) => c.trim())
    .filter(Boolean);
}

const DEIXIS_ALLOW_PHRASES = [
  /none\s+currently\s+recorded/i,
];

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

function evaluateDeixis(input) {
  const md = input && input.tracker != null ? String(input.tracker) : "";
  const warnings = [];
  const lines = md.split(/\r?\n/);

  let inFence = false;
  let inRuleSection = false;
  let scannedLines = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];

    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    if (/^#{1,6}\s+/.test(raw)) {
      inRuleSection = isDeixisRuleSectionHeading(normHeading(raw));
      continue;
    }
    if (inRuleSection) continue;

    if (/^\s*>/.test(raw)) continue;

    if (DEIXIS_ALLOW_PHRASES.some((re) => re.test(raw))) {
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

function flagClauses(clauses, lineNo, raw, warnings) {
  for (const clause of clauses) {
    if (clauseHasAnchor(clause)) continue;
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

function resolveLinkExists(link) {
  const clean = link.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\//, "");
  const full = path.join(ROOT, clean);
  try {
    fs.statSync(full);
    return true;
  } catch {
    return false;
  }
}

function readRepoFile(rel) {
  try {
    return fs.readFileSync(path.join(ROOT, rel.replace(/\\/g, "/")), "utf8");
  } catch {
    return null;
  }
}

function listRepoDir(rel) {
  try {
    return fs.readdirSync(path.join(ROOT, rel.replace(/\\/g, "/")));
  } catch {
    return [];
  }
}

function modeConsultsTracker(modeMd) {
  const md = String(modeMd || "");
  if (/start-of-work\b[^\n]*\bconsult\b[^\n]*\bTRACKER\.md\b/i.test(md)) return true;
  for (const line of md.split(/\r?\n/)) {
    if (/TRACKER\.md/.test(line) && /(consult|read)/i.test(line) && /(start-of-work|before .*work|begin)/i.test(line)) {
      return true;
    }
  }
  return false;
}

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

function expandBracePaths(p) {
  const s = String(p || "").trim();
  const m = /^(.*)\{([^}]+)\}(.*)$/.exec(s);
  if (!m) return [s];
  const [, pre, inner, post] = m;
  return inner.split(",").map((part) => `${pre}${part.trim()}${post}`);
}

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
      return { ok: false, checks: [], fatal: true, error: `TRACKER.md unreadable: ${e.message}` };
    }
    tracker = "";
    trackerPresent = false;
  }

  const links = extractLinks(tracker);
  const linkTargets = {};
  for (const l of links) linkTargets[l] = resolveLinkExists(l);

  const items = parseItems(tracker);
  for (const it of items) {
    const l = it.trackerLink;
    if (l && !Object.prototype.hasOwnProperty.call(linkTargets, l)) {
      linkTargets[l] = resolveLinkExists(l);
    }
  }

  const pathExists = {};
  for (const p of REQUIRED_PATHS) pathExists[p] = existsRepo(p);

  const roadmap = readRepoFile("ROADMAP.md");
  const roadmapPresent = roadmap != null;

  const epicIds = listRepoDir("trackers/epics")
    .filter((f) => /^E-.*\.md$/i.test(f))
    .map(epicIdFromFilename);

  const modeConsults = {};
  for (const mode of TRACKER_CONSULT_MODES) {
    const md = readRepoFile(`.claude/commands/mode/${mode}.md`);
    modeConsults[mode] = md != null && modeConsultsTracker(md);
  }

  const nonexistence = {};
  for (const p of parseVerifiedNonexistentPaths(tracker)) {
    nonexistence[p] = !existsRepo(p) && !existsRepo(p + "/");
  }

  const itemFileStates = {};
  for (const it of items) {
    const link = it.trackerLink;
    if (!link) continue;
    const rel = link.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\//, "");
    if (!/(^|\/)trackers\//.test(rel) || !/\.md$/i.test(rel)) continue;
    if (!existsRepo(rel)) continue;
    itemFileStates[it.label] = fileStateOf(rel);
  }

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
  res.advisory = { deixis: evaluateDeixis({ tracker }) };
  return res;
}

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
      `  (${res.summary.links} link(s) · ${res.summary.requiredPaths} required path(s) · ${res.summary.epics != null ? res.summary.epics + " epic(s) · " : ""}root ${res.summary.root})`
    );
  }
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

  const HEADER_BLOCK = [
    "# TRACKER.md",
    "",
    "Version: 1.0.0",
    "Owner: President Agent",
    "Authority: highest written source of truth for tracked work.",
    "",
  ].join("\n");

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

  const itemLinkTargets = {
    "trackers/epics/E-DEMO-001-x.md": true,
    "trackers/sprints/T1-y.md": true,
    "trackers/epics/E-DONE-000-z.md": true,
  };

  const SESSION_LOG_BODY = [
    "Every meaningful work session on an epic or sprint must be logged. Each entry must include: session ID; date; work performed.",
    "",
    "Seed session log (keystone-authoring session): Session ID: to be backfilled · Date: 2030-01-01 · Work performed: authored the tracker.",
  ].join("\n");

  const KNOWN_GAPS_BODY = [
    "### G-1 — Tracker enforcement hooks pending",
    "- Description: the start-of-work / completion-gate enforcement hook is not yet built; tracked here so the absence is visible.",
    "- Current state: Recorded; no enforcement hook in `.claude/hooks` yet.",
  ].join("\n");

  const SECTION_BODIES = {
    "Session Logging Rules": SESSION_LOG_BODY,
    "Known Gaps and Open Flaws": KNOWN_GAPS_BODY,
  };

  const renderTracker = (itemsBySection) =>
    REQUIRED_SECTIONS.map((s) => {
      if (s === "Header") return HEADER_BLOCK;
      if (s === "Definitions") {
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
  const coherentNonexistence = { ".claude/agents/retired-a": true, ".claude/agents/retired-b": true };
  const coherentItemFileStates = {
    "E-DEMO-001": "Active",
    "T1": "Active",
    "E-DONE-000": "Completed",
  };
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

  const coherent = () => ({
    tracker: coherentSections,
    trackerPresent: true,
    linkTargets: { ...itemLinkTargets },
    pathExists: { ...coherentPaths },
    ...crossFileSeams(),
  });

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

  t("coherent → all checks PASS", () => {
    const res = evaluate(coherent());
    assert(res.ok, "expected ok:true, failures: " +
      res.checks.filter((c) => c.status === "FAIL").map((c) => c.check + " " + c.details.join("; ")).join(" | "));
    assert(!res.fatal, "must not be fatal");
  });

  t("(a) missing section → sections-present FAIL", () => {
    const s = coherent();
    s.tracker = s.tracker.replace("# Known Gaps and Open Flaws", "# Bogus Heading");
    const res = evaluate(s);
    assert(fails(res, "sections-present"), "expected sections-present FAIL");
    assert(checkOf(res, "sections-present").details.some((d) => d.includes("Known Gaps")), "should name the missing section");
  });

  t("(a) coherent → sections-present PASS", () => assert(passes(evaluate(coherent()), "sections-present")));

  t("(a) header w/o version/owner block → sections-present FAIL", () => {
    const s = coherent();
    s.tracker = s.tracker.replace(HEADER_BLOCK, "# TRACKER.md\n\nA title with no version/owner/authority block.\n");
    const res = evaluate(s);
    assert(fails(res, "sections-present"), "expected sections-present FAIL");
    assert(checkOf(res, "sections-present").details.some((d) => d.includes("Header")), "should name Header");
  });

  t("(b) blank section → no-blank-section FAIL", () => {
    const s = coherent();
    s.tracker = s.tracker.replace("# Untracked Work\n\nNone currently recorded.\n", "# Untracked Work\n\n");
    const res = evaluate(s);
    assert(fails(res, "no-blank-section"), "expected no-blank-section FAIL");
  });
  t("(b) sentinel section → no-blank-section PASS", () => assert(passes(evaluate(coherent()), "no-blank-section")));

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
  t("(c) unverified link → broken-links FAIL (fail-closed)", () => {
    const s = coherent();
    s.tracker = coherentSections + "\n\nSee [x](trackers/epics/UNKNOWN.md).\n";
    const res = evaluate(s);
    assert(fails(res, "broken-links"), "unverified link must fail closed");
  });

  t("(d) active w/o tracker file → active-tracker-files FAIL", () => {
    const s = withItems((m) => {
      delete m["Active Epics"][0].fields["Link to epic tracker"];
    });
    const res = evaluate(s);
    assert(fails(res, "active-tracker-files"), "expected active-tracker-files FAIL");
  });
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

  t("(e) active w/o next action → active-next-action FAIL", () => {
    const s = withItems((m) => {
      delete m["Active Epics"][0].fields["Next required action"];
    });
    const res = evaluate(s);
    assert(fails(res, "active-next-action"), "expected active-next-action FAIL");
  });
  t("(e) active w/ next action → active-next-action PASS", () => assert(passes(evaluate(coherent()), "active-next-action")));

  t("(f) completed w/o evidence → completed-evidence FAIL", () => {
    const s = withItems((m) => {
      delete m["Completed Epics"][0].fields["Evidence of completion (verified against disk + git)"];
    });
    const res = evaluate(s);
    assert(fails(res, "completed-evidence"), "expected completed-evidence FAIL");
  });
  t("(f) completed w/ qualified evidence → completed-evidence PASS", () => assert(passes(evaluate(coherent()), "completed-evidence")));

  t("(g) completed <100% → completed-100 FAIL", () => {
    const s = withItems((m) => {
      m["Completed Epics"][0].fields["Percent completion"] = "80%";
    });
    const res = evaluate(s);
    assert(fails(res, "completed-100"), "expected completed-100 FAIL");
  });
  t("(g) completed at 100% → completed-100 PASS", () => assert(passes(evaluate(coherent()), "completed-100")));

  t("(h) 100% not completed → hundred-completed FAIL", () => {
    const s = withItems((m) => {
      m["Active Epics"][0].fields["Percent completion"] = "100%";
    });
    const res = evaluate(s);
    assert(fails(res, "hundred-completed"), "expected hundred-completed FAIL");
  });
  t("(h) 100%↔completed consistent → hundred-completed PASS", () => assert(passes(evaluate(coherent()), "hundred-completed")));

  t("(i) sprint w/o parent epic → sprint-parent-epic FAIL", () => {
    const s = withItems((m) => {
      delete m["Active Sprints"][0].fields["Parent epic"];
    });
    const res = evaluate(s);
    assert(fails(res, "sprint-parent-epic"), "expected sprint-parent-epic FAIL");
  });
  t("(i) sprint w/ parent epic → sprint-parent-epic PASS", () => assert(passes(evaluate(coherent()), "sprint-parent-epic")));

  t("(j) ambiguous phrase → ambiguous-language FAIL", () => {
    const s = coherent();
    s.tracker = coherentSections + "\n\nThis epic is probably complete and should be fine.\n";
    const res = evaluate(s);
    assert(fails(res, "ambiguous-language"), "expected ambiguous-language FAIL");
    assert(checkOf(res, "ambiguous-language").details.length >= 2, "should catch both phrases");
  });
  t("(j) clean language → ambiguous-language PASS", () => assert(passes(evaluate(coherent()), "ambiguous-language")));

  t("(k) undefined term → undefined-terms FAIL", () => {
    const s = coherent();
    s.tracker = s.tracker.replace(
      "## Definition: Reconciliation\nDefinition: operational definition of Reconciliation.\nWhy it matters: it matters.\nWhere it applies: everywhere.",
      ""
    ) + "\n\nThe Reconciliation step resolves conflicts.\n";
    const res = evaluate(s);
    assert(fails(res, "undefined-terms"), "expected undefined-terms FAIL");
    assert(checkOf(res, "undefined-terms").details.some((d) => /Reconciliation/.test(d)), "should name Reconciliation");
  });
  t("(k) all used terms defined → undefined-terms PASS", () => assert(passes(evaluate(coherent()), "undefined-terms")));

  t("(l) missing path → required-paths FAIL", () => {
    const s = coherent();
    s.pathExists = { ...coherentPaths, "UNTRACKED_WORK.md": false };
    const res = evaluate(s);
    assert(fails(res, "required-paths"), "expected required-paths FAIL");
  });
  t("(l) all paths present → required-paths PASS", () => assert(passes(evaluate(coherent()), "required-paths")));
  t("(l) unprobed path → required-paths FAIL (fail-closed)", () => {
    const s = coherent();
    s.pathExists = { ...coherentPaths };
    delete s.pathExists["ROADMAP.md"];
    const res = evaluate(s);
    assert(fails(res, "required-paths"), "unprobed path must fail closed");
  });

  t("(m) coherent → roadmap-epic-based PASS", () => assert(passes(evaluate(coherent()), "roadmap-epic-based")));
  t("(m) live milestones heading → roadmap-epic-based FAIL", () => {
    const s = coherent();
    s.roadmap = "# ROADMAP\n\n## Epics\n- E-DEMO-001\n\n## 🏛 Milestones\n- still here, not deprecated\n";
    const res = evaluate(s);
    assert(fails(res, "roadmap-epic-based"), "live Milestones heading must fail");
  });
  t("(m) absent roadmap → roadmap-epic-based FAIL (fail-closed)", () => {
    const s = coherent();
    s.roadmap = "";
    s.roadmapPresent = false;
    assert(fails(evaluate(s), "roadmap-epic-based"), "absent roadmap must fail closed");
  });

  t("(n) coherent → epics-in-roadmap PASS", () => assert(passes(evaluate(coherent()), "epics-in-roadmap")));
  t("(n) epic absent from roadmap → epics-in-roadmap FAIL", () => {
    const s = coherent();
    s.epicIds = [...s.epicIds, "E-MISSING-9999"];
    const res = evaluate(s);
    assert(fails(res, "epics-in-roadmap"), "unreferenced epic must fail");
    assert(checkOf(res, "epics-in-roadmap").details.some((d) => /E-MISSING-9999/.test(d)), "names the missing epic");
  });
  t("(n) no epicIds seam → epics-in-roadmap FAIL (fail-closed)", () => {
    const s = coherent();
    delete s.epicIds;
    assert(fails(evaluate(s), "epics-in-roadmap"), "missing epicIds seam must fail closed");
  });

  t("(o) coherent → modes-consult-tracker PASS", () => assert(passes(evaluate(coherent()), "modes-consult-tracker")));
  t("(o) a mode missing consult → modes-consult-tracker FAIL", () => {
    const s = coherent();
    s.modeConsults = { ...s.modeConsults, oneshot: false };
    const res = evaluate(s);
    assert(fails(res, "modes-consult-tracker"), "missing mode consult must fail");
    assert(checkOf(res, "modes-consult-tracker").details.some((d) => /oneshot/.test(d)), "names oneshot");
  });
  t("(o) no modeConsults seam → modes-consult-tracker FAIL (fail-closed)", () => {
    const s = coherent();
    delete s.modeConsults;
    assert(fails(evaluate(s), "modes-consult-tracker"), "missing modeConsults seam must fail closed");
  });

  t("(p) coherent → work-log-session-id PASS", () => assert(passes(evaluate(coherent()), "work-log-session-id")));
  t("(p) entry w/o session ID or sentinel → work-log-session-id FAIL", () => {
    const s = coherent();
    s.tracker = s.tracker.replace(
      "Seed session log (keystone-authoring session): Session ID: to be backfilled · Date: 2030-01-01 · Work performed: authored the tracker.",
      "Orphan session log: Date: 2030-01-01 · Work performed: did some work with no recorded session identifier."
    );
    const res = evaluate(s);
    assert(fails(res, "work-log-session-id"), "unidentified session-log entry must fail");
  });

  t("(q) coherent → expected-nonexistence PASS", () => assert(passes(evaluate(coherent()), "expected-nonexistence")));
  t("(q) nonexistent-marked path exists → expected-nonexistence FAIL", () => {
    const s = coherent();
    s.nonexistence = { ...s.nonexistence, ".claude/agents/retired-a": false };
    const res = evaluate(s);
    assert(fails(res, "expected-nonexistence"), "an existing should-be-absent path must fail");
    assert(checkOf(res, "expected-nonexistence").details.some((d) => /retired-a/.test(d)), "names the path");
  });
  t("(q) no nonexistence seam → expected-nonexistence FAIL (fail-closed)", () => {
    const s = coherent();
    delete s.nonexistence;
    assert(fails(evaluate(s), "expected-nonexistence"), "missing nonexistence seam must fail closed");
  });

  t("(r) coherent → cross-file-reconciliation PASS", () => assert(passes(evaluate(coherent()), "cross-file-reconciliation")));
  t("(r) state disagrees with file → cross-file-reconciliation FAIL", () => {
    const s = coherent();
    s.itemFileStates = { ...s.itemFileStates, "E-DEMO-001": "Completed" };
    const res = evaluate(s);
    assert(fails(res, "cross-file-reconciliation"), "state disagreement must fail");
    assert(checkOf(res, "cross-file-reconciliation").details.some((d) => /E-DEMO-001/.test(d)), "names the item");
  });
  t("(r) unreadable linked-file state → cross-file-reconciliation FAIL (fail-closed)", () => {
    const s = coherent();
    s.itemFileStates = { ...s.itemFileStates, "T1": null };
    assert(fails(evaluate(s), "cross-file-reconciliation"), "unverified file state must fail closed");
  });

  t("(s) coherent (missing-but-tracked) → hooks-enforce-or-tracked PASS", () => assert(passes(evaluate(coherent()), "hooks-enforce-or-tracked")));
  t("(s) hook missing + gap unacknowledged → hooks-enforce-or-tracked FAIL", () => {
    const s = coherent();
    s.tracker = s.tracker.replace(KNOWN_GAPS_BODY, "None currently recorded.");
    const res = evaluate(s);
    assert(fails(res, "hooks-enforce-or-tracked"), "missing+unacknowledged hook must fail");
  });
  t("(s) no enforcementHooks seam → hooks-enforce-or-tracked FAIL (fail-closed)", () => {
    const s = coherent();
    delete s.enforcementHooks;
    assert(fails(evaluate(s), "hooks-enforce-or-tracked"), "missing enforcementHooks seam must fail closed");
  });

  t("(t) coherent → definition-drift PASS", () => assert(passes(evaluate(coherent()), "definition-drift")));
  t("(t) two divergent definitions of a term → definition-drift FAIL", () => {
    const s = coherent();
    s.tracker = s.tracker + "\n\n## Definition: Epic\nDefinition: a tiny throwaway one-off chore unrelated to any long-running goal whatsoever.\n";
    const res = evaluate(s);
    assert(fails(res, "definition-drift"), "divergent duplicate definition must fail");
    assert(checkOf(res, "definition-drift").details.some((d) => /epic/i.test(d)), "names the drifted term");
  });

  t("missing tracker → not-ok, fail-closed (no throw)", () => {
    const res = evaluate({ tracker: "", trackerPresent: false, items: [], linkTargets: {}, pathExists: coherentPaths });
    assert(!res.ok, "missing tracker must not be ok");
    assert(fails(res, "sections-present"), "missing tracker → sections-present FAIL");
    assert(!res.fatal, "evaluate must not mark fatal for missing content");
  });

  t("garbage input → handled, not-ok, no throw", () => {
    const res = evaluate({ tracker: "\u0000￿###no headings here\n[bad](", trackerPresent: true, linkTargets: {}, pathExists: {} });
    assert(res && Array.isArray(res.checks), "must return a structured result");
    assert(!res.ok, "garbage must not pass");
  });

  t("parseItems extracts items from H1 sections + H3 labels (real structure)", () => {
    const md = [
      "# Definitions",
      "## Definition: Sprint",
      "Definition: prose mentioning a sprint-conductor and epic-based roadmap (must NOT become items).",
      "",
      "# Active Sprints",
      "### S-DEMO-001 — demo sprint",
      "- Link to sprint tracker: `trackers/sprints/demo-sprint.md`",
      "- Current state: Active.",
      "- Percent completion: 50%",
      "- Next required action: spawn agents.",
      "- Parent epic: E-DEMO-007.",
      "",
      "# Completed Epics",
      "### E-DONE-000 — foundation",
      "- Final state: Completed.",
      "- Percent completion: 100%",
      "- Evidence of completion (verified vs git): commit abc1234. Parent epic: none.",
    ].join("\n");
    const items = parseItems(md);
    assert(items.length === 2, "exactly 2 items (no prose/def scraping), got " + items.length + ": " + items.map((i) => i.label).join(","));
    const sp = items.find((i) => i.label === "S-DEMO-001");
    const ep = items.find((i) => i.label === "E-DONE-000");
    assert(sp && sp.kind === "sprint" && sp.percent === 50 && sp.parentEpic === "E-DEMO-007.", "sprint parse");
    assert(sp.state === "Active." && sp.nextAction === "spawn agents." && sp.trackerLink === "trackers/sprints/demo-sprint.md", "sprint fields");
    assert(ep && ep.kind === "epic" && ep.percent === 100 && /abc1234/.test(ep.evidence), "epic parse (qualified evidence label)");
  });

  t("parseItems ignores prose EPIC-/SPRINT-like tokens outside item sections", () => {
    const md = [
      HEADER_BLOCK,
      "# Definitions",
      "## Definition: Epic",
      "Definition: the ROADMAP has no epic registry; a sprint-conductor note appears here.",
      "# System Inventory",
      "| ROADMAP.md | File | no epic registry | Yes |",
    ].join("\n");
    const items = parseItems(md);
    assert(items.length === 0, "prose must yield zero items, got: " + items.map((i) => i.label).join(","));
  });

  const deixisWarns = (md) => evaluateDeixis({ tracker: md }).warnings;
  const hasPhrase = (md, sub) =>
    deixisWarns(md).some((w) => w.phrase.includes(sub) || w.clause.toLowerCase().includes(sub.toLowerCase()));

  t("(deixis) bare 'no execution this session' → FLAGGED", () => {
    const w = deixisWarns("# Active Epics\n\n- Status: no execution this session.\n");
    assert(w.length >= 1, "expected ≥1 deixis warning, got " + w.length);
    assert(w.some((x) => x.phrase === "this session"), "should name 'this session'");
  });
  t("(deixis) 'NEXT ACTION (session 4): do Y' → FLAGGED (ordinal)", () =>
    assert(hasPhrase("# Active Sprints\n\n- NEXT ACTION (session 4): do Y\n", "ordinal"), "session ordinal must flag"));
  t("(deixis) bare 'currently procedural' → FLAGGED", () =>
    assert(deixisWarns("# Validation Requirements\n\nEnforcement is currently procedural.\n").length >= 1, "currently must flag"));

  t("(deixis) 'DONE this session 2030-01-02' (ISO anchor) → NOT flagged", () =>
    assert(deixisWarns("# Completed Epics\n\n- DONE this session 2030-01-02; evidence recorded.\n").length === 0,
      "ISO date in-clause should anchor"));
  t("(deixis) 'this session @abc1234' (hash anchor) → NOT flagged", () =>
    assert(deixisWarns("# Completed Epics\n\n- Shipped this session @abc1234.\n").length === 0,
      "commit hash in-clause should anchor"));
  t("(deixis) anchor only counts WITHIN the same clause", () => {
    const w = deixisWarns("# Active Epics\n\n- No work this session. Reconciled 2030-01-02.\n");
    assert(w.length >= 1, "cross-clause anchor must NOT rescue the deictic clause");
  });

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

  t("(deixis) 'now epic-based' (change-result) → NOT flagged", () =>
    assert(deixisWarns("# System Inventory\n\nROADMAP.md is now epic-based.\n").length === 0,
      "adjectival 'now <X>' must not flag"));
  t("(deixis) 'right now' (deictic) → FLAGGED", () =>
    assert(deixisWarns("# Active Epics\n\n- Do this right now.\n").length >= 1, "deictic 'right now' must flag"));

  t("(deixis) advisory is separate from the 20 binding checks (report-only)", () => {
    const res = evaluate(coherent());
    assert(res.checks.length === 20, "binding suite must be exactly 20 checks, got " + res.checks.length);
    assert(!res.checks.some((c) => c.check === "session-relative-language"),
      "deixis check must NOT be in the binding checks array");
  });

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
  evaluateDeixis,
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
