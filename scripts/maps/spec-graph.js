#!/usr/bin/env node
/**
 * spec-graph.js — Build paths.specGraph
 * (.claude/project/maps/SPEC_GRAPH.json), a dependency graph of
 * requirements, stories, acceptance criteria, COPY, INPUTS, TRACE entries
 * across canonical specs and sprint-time requirement folders.
 *
 * Why this exists:
 *   paths.specGraph is referenced from the systems manifest and the maps
 *   pipeline but had no generator. /scan:full flagged the missing file.
 *
 * Sources scanned:
 *   - paths.specsRoot/**\/*.md and *.json — canonical product features.
 *   - paths.sprintRequirements/<sprintId>/*.md — per-sprint
 *     prd/high-level-stories/granular-stories/acceptance-criteria/copy/
 *     inputs/trace.
 *   - paths.requirementsRoot/00-canonical/STEPS.json — canonical steps.
 *
 * ID grammar honored:
 *   H-N  high-level story    S-N  granular story
 *   R-N  requirement         AC-N acceptance criterion
 *   C-N  copy entry          IN-N input
 *   TR-N trace requirement   T-NNN ticket reference (cross-doc)
 *   RP-N release plan        STEP-<NAME> canonical step
 *
 *   Sprint-scoped ids are namespaced as `<sprintId>:H-1` etc, because
 *   `R-1` in sprint A is not the same node as `R-1` in sprint B. Canonical
 *   ids (under paths.specsRoot or 00-canonical) keep their bare form.
 *
 * Edge inference (text-based, deterministic):
 *   - Within a sprint folder, any reference from one doc to an id is an
 *     edge `from = source-id` `to = target-id`.
 *   - Story → Requirement edges from "Linked: R-X" or "Linked requirements"
 *     lines → kind: "satisfies".
 *   - AC → Story edges (AC lives inside an S- block) → kind: "implements".
 *   - TR → Requirement/Story from "Linked requirement"/"Linked story" lines
 *     → kind: "traces".
 *   - All other id-to-id co-occurrences within a file → kind: "references".
 *
 * Schema:
 *   {
 *     "schema": "mc/spec-graph/v1",
 *     "generatedAt": "<ISO>",
 *     "nodes": [{ "id", "source", "kind", "sprint"? }],
 *     "edges": [{ "from", "to", "kind", "source" }]
 *   }
 *
 * Run: node scripts/maps/spec-graph.js
 */

const fs = require("fs");
const path = require("path");

const PROJECT = path.resolve(__dirname, "..", "..");
const ISO = new Date().toISOString();

const SPECS_ROOT = path.join(PROJECT, "_requirements", "04-features");
const SPRINT_REQS = path.join(
  PROJECT,
  ".claude",
  "project",
  "sprint",
  "requirements",
);
const CANONICAL = path.join(PROJECT, "_requirements", "00-canonical");
const OUT = path.join(PROJECT, ".claude", "project", "maps", "SPEC_GRAPH.json");

// ─────────────────────── helpers ───────────────────────

function relPath(p) {
  return path.relative(PROJECT, p).replace(/\\/g, "/");
}

function walk(dir, exts = [".md", ".json"]) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else if (exts.some((e) => ent.name.endsWith(e))) out.push(full);
    }
  }
  return out;
}

// Map a filename to the kind of node defined in it.
function kindFromFile(filePath) {
  const base = path.basename(filePath).toLowerCase();
  if (base.startsWith("high-level-stories")) return "story";
  if (base.startsWith("granular-stories")) return "story";
  if (base.startsWith("acceptance-criteria")) return "ac";
  if (base.startsWith("copy")) return "copy";
  if (base.startsWith("inputs")) return "input";
  if (base.startsWith("trace")) return "trace";
  if (base.startsWith("prd")) return "requirement";
  if (base.startsWith("qa-plan")) return "qa";
  if (base.startsWith("redteam-plan")) return "redteam";
  if (base.startsWith("release-plan")) return "release";
  return "doc";
}

// Map an id prefix to its semantic node kind.
function kindFromId(id) {
  const bare = id.includes(":") ? id.split(":").pop() : id;
  if (/^H-\d+$/.test(bare)) return "story-hl";
  if (/^S-\d+$/.test(bare)) return "story";
  if (/^R-\d+$/.test(bare)) return "requirement";
  if (/^AC-\d+$/.test(bare)) return "ac";
  if (/^C-\d+$/.test(bare)) return "copy";
  if (/^IN-\d+$/.test(bare)) return "input";
  if (/^TR-\d+$/.test(bare)) return "trace";
  if (/^T-\d+$/.test(bare)) return "ticket";
  if (/^RP-\d+$/.test(bare)) return "release";
  if (/^ESD-/.test(bare)) return "external-service";
  if (/^STEP-/.test(bare)) return "step";
  return "other";
}

const ID_PATTERNS = [
  /\b(H-\d+)\b/g,
  /\b(S-\d+)\b/g,
  /\b(R-\d+)\b/g,
  /\b(AC-\d+)\b/g,
  /\b(C-\d+)\b/g,
  /\b(IN-\d+)\b/g,
  /\b(TR-\d+)\b/g,
  /\b(T-\d{3,})\b/g,
  /\b(RP-\d+)\b/g,
  /\b(ESD-[A-Za-z0-9._-]+)\b/g,
];

function extractIds(text) {
  const ids = new Set();
  for (const re of ID_PATTERNS) {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) ids.add(m[1]);
  }
  return [...ids];
}

// Within a sprint folder, namespace bare ids by sprint id.
function nsId(id, sprintId) {
  if (!sprintId) return id;
  // Ticket ids (T-...) are globally unique already.
  if (/^T-\d+$/.test(id)) return id;
  return `${sprintId}:${id}`;
}

// ─────────────────────── core scan ───────────────────────

const nodes = new Map(); // id → {id, source, kind, sprint?}
const edges = [];

function upsertNode(id, source, kind, sprint) {
  if (!nodes.has(id)) {
    const rec = { id, source, kind };
    if (sprint) rec.sprint = sprint;
    nodes.set(id, rec);
  } else {
    // Prefer more specific kind ("doc" loses to anything else).
    const cur = nodes.get(id);
    if (cur.kind === "other" || cur.kind === "doc") cur.kind = kind;
    if (!cur.source) cur.source = source;
  }
}

function addEdge(from, to, kind, source) {
  if (from === to) return;
  edges.push({ from, to, kind, source });
}

// ─── parse one sprint requirement file ───
//
// Granular-stories file is special — each S-N block contains AC- ids that
// belong to that story; we emit AC → S edges by tracking the current
// section heading.
function parseGranularStories(text, sprintId, sourceRel) {
  const lines = text.split(/\r?\n/);
  let currentStory = null;
  for (const line of lines) {
    const sMatch = line.match(/^##\s+(S-\d+)\b/);
    if (sMatch) {
      currentStory = nsId(sMatch[1], sprintId);
      upsertNode(currentStory, sourceRel, "story", sprintId);
      continue;
    }
    const acMatch = line.match(/^[-*]\s*(AC-\d+)\b/);
    if (acMatch && currentStory) {
      const acId = nsId(acMatch[1], sprintId);
      upsertNode(acId, sourceRel, "ac", sprintId);
      addEdge(acId, currentStory, "implements", sourceRel);
    }
    // Story → linked requirement / linked H-
    const linkedMatch = line.match(/^Linked(?:\s+requirements?)?:\s*(.+)$/i);
    if (linkedMatch && currentStory) {
      const targets = extractIds(linkedMatch[1]);
      for (const t of targets) {
        const tns = nsId(t, sprintId);
        upsertNode(tns, sourceRel, kindFromId(tns), sprintId);
        if (kindFromId(t) === "requirement") {
          addEdge(currentStory, tns, "satisfies", sourceRel);
        } else {
          addEdge(currentStory, tns, "references", sourceRel);
        }
      }
    }
  }
}

// High-level stories — H-N nodes plus "Linked granular stories" and
// "Linked requirements" lines.
function parseHighLevelStories(text, sprintId, sourceRel) {
  const lines = text.split(/\r?\n/);
  let currentH = null;
  for (const line of lines) {
    const hMatch = line.match(/^##\s+(H-\d+)\b/);
    if (hMatch) {
      currentH = nsId(hMatch[1], sprintId);
      upsertNode(currentH, sourceRel, "story-hl", sprintId);
      continue;
    }
    const linkedMatch = line.match(/^Linked\s+(\w[\w\s-]*?):\s*(.+)$/i);
    if (linkedMatch && currentH) {
      const targets = extractIds(linkedMatch[2]);
      for (const t of targets) {
        const tns = nsId(t, sprintId);
        upsertNode(tns, sourceRel, kindFromId(tns), sprintId);
        const linkKind = /requirement/i.test(linkedMatch[1])
          ? "satisfies"
          : "references";
        addEdge(currentH, tns, linkKind, sourceRel);
      }
    }
  }
}

// Trace.md — TR-N entries with "Linked requirement"/"Linked story".
function parseTrace(text, sprintId, sourceRel) {
  const lines = text.split(/\r?\n/);
  let currentTR = null;
  for (const line of lines) {
    const trMatch = line.match(/^##\s+(TR-\d+)\b/);
    if (trMatch) {
      currentTR = nsId(trMatch[1], sprintId);
      upsertNode(currentTR, sourceRel, "trace", sprintId);
      continue;
    }
    const linkedMatch = line.match(
      /\*\*Linked\s+(requirement|story)s?:\*\*\s*(.+)$/i,
    );
    if (linkedMatch && currentTR) {
      for (const t of extractIds(linkedMatch[2])) {
        const tns = nsId(t, sprintId);
        upsertNode(tns, sourceRel, kindFromId(tns), sprintId);
        addEdge(currentTR, tns, "traces", sourceRel);
      }
    }
  }
}

// PRD / acceptance-criteria / copy / inputs / others — section-heading-as-id
// pattern: `## R-1 — ...` defines node R-1 in this file; any other ids in
// the section body are "references".
function parseSectioned(text, sprintId, sourceRel, defaultKind) {
  const lines = text.split(/\r?\n/);
  let currentId = null;
  let buffer = [];
  const flush = () => {
    if (!currentId) return;
    const body = buffer.join("\n");
    for (const t of extractIds(body)) {
      const tns = nsId(t, sprintId);
      if (tns === currentId) continue;
      upsertNode(tns, sourceRel, kindFromId(tns), sprintId);
      addEdge(currentId, tns, "references", sourceRel);
    }
  };
  for (const line of lines) {
    const hMatch = line.match(/^##\s+([A-Z]+-\d+)\b/);
    if (hMatch) {
      flush();
      const newId = nsId(hMatch[1], sprintId);
      upsertNode(
        newId,
        sourceRel,
        kindFromId(hMatch[1]) || defaultKind,
        sprintId,
      );
      currentId = newId;
      buffer = [];
    } else {
      buffer.push(line);
    }
  }
  flush();
}

function scanSprintRequirements() {
  if (!fs.existsSync(SPRINT_REQS)) return;
  const sprints = fs
    .readdirSync(SPRINT_REQS, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  for (const sprintId of sprints) {
    const dir = path.join(SPRINT_REQS, sprintId);
    const files = walk(dir, [".md"]);
    for (const file of files) {
      const text = fs.readFileSync(file, "utf8");
      const sourceRel = relPath(file);
      const base = path.basename(file).toLowerCase();
      if (base.startsWith("granular-stories")) {
        parseGranularStories(text, sprintId, sourceRel);
      } else if (base.startsWith("high-level-stories")) {
        parseHighLevelStories(text, sprintId, sourceRel);
      } else if (base.startsWith("trace")) {
        parseTrace(text, sprintId, sourceRel);
      } else {
        parseSectioned(text, sprintId, sourceRel, kindFromFile(file));
      }
    }
  }
}

function scanCanonicalSpecs() {
  if (!fs.existsSync(SPECS_ROOT)) return;
  const files = walk(SPECS_ROOT, [".md"]);
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    const sourceRel = relPath(file);
    // Canonical specs are not sprint-scoped — pass undefined.
    const base = path.basename(file).toLowerCase();
    if (base.startsWith("granular-stories")) {
      parseGranularStories(text, undefined, sourceRel);
    } else if (base.startsWith("high-level-stories")) {
      parseHighLevelStories(text, undefined, sourceRel);
    } else if (base.startsWith("trace")) {
      parseTrace(text, undefined, sourceRel);
    } else {
      parseSectioned(text, undefined, sourceRel, kindFromFile(file));
    }
  }
}

function scanCanonicalSteps() {
  const steps = path.join(CANONICAL, "STEPS.json");
  if (!fs.existsSync(steps)) return;
  try {
    const data = JSON.parse(fs.readFileSync(steps, "utf8"));
    const sourceRel = relPath(steps);
    const phases = data.phases || {};
    for (const [phase, info] of Object.entries(phases)) {
      const phaseId = `PHASE-${phase.toUpperCase()}`;
      upsertNode(phaseId, sourceRel, "phase");
      const stepIds = info.steps || [];
      let prev = null;
      for (const s of stepIds) {
        const sid = `STEP-${s}`;
        upsertNode(sid, sourceRel, "step");
        addEdge(sid, phaseId, "belongs-to", sourceRel);
        if (prev && info.ordered) {
          addEdge(prev, sid, "precedes", sourceRel);
        }
        prev = sid;
      }
    }
    // Step → feature edges (informational reference).
    for (const [stepName, stepInfo] of Object.entries(data.steps || {})) {
      const sid = `STEP-${stepName}`;
      if (stepInfo.feature) {
        const fid = `FEATURE-${stepInfo.feature}`;
        upsertNode(fid, sourceRel, "feature");
        addEdge(sid, fid, "implements-feature", sourceRel);
      }
    }
  } catch {
    // Malformed STEPS.json — skip silently; this is a best-effort enrichment.
  }
}

// ─────────────────────── main ───────────────────────

function main() {
  scanSprintRequirements();
  scanCanonicalSpecs();
  scanCanonicalSteps();

  // Dedupe edges (from, to, kind) — multiple files can yield the same logical
  // edge; keep the first source seen for stability.
  const seen = new Set();
  const dedupedEdges = [];
  for (const e of edges) {
    const key = `${e.from}|${e.to}|${e.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedupedEdges.push(e);
  }

  // Sort nodes + edges for deterministic diffs.
  const nodeList = [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
  dedupedEdges.sort(
    (a, b) =>
      a.from.localeCompare(b.from) ||
      a.to.localeCompare(b.to) ||
      a.kind.localeCompare(b.kind),
  );

  const out = {
    schema: "mc/spec-graph/v1",
    generatedAt: ISO,
    sources: {
      sprintRequirements: relPath(SPRINT_REQS),
      canonicalSpecs: relPath(SPECS_ROOT),
      canonicalSteps: relPath(path.join(CANONICAL, "STEPS.json")),
    },
    counts: {
      nodes: nodeList.length,
      edges: dedupedEdges.length,
      byKind: nodeList.reduce((acc, n) => {
        acc[n.kind] = (acc[n.kind] || 0) + 1;
        return acc;
      }, {}),
      byEdgeKind: dedupedEdges.reduce((acc, e) => {
        acc[e.kind] = (acc[e.kind] || 0) + 1;
        return acc;
      }, {}),
    },
    nodes: nodeList,
    edges: dedupedEdges,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const tmp = OUT + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2));
  fs.renameSync(tmp, OUT);

  process.stdout.write(
    `spec-graph → wrote ${nodeList.length} nodes, ${dedupedEdges.length} edges ` +
      `to paths.specGraph (${relPath(OUT)})\n` +
      `  byKind: ${JSON.stringify(out.counts.byKind)}\n` +
      `  byEdgeKind: ${JSON.stringify(out.counts.byEdgeKind)}\n`,
  );
}

main();
