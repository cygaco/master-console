#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const touchpoint = require("./touchpoint");
const hookPoints = require("./hook-points");

const SCHEMA = "mc/gauntlet-package/v1";
const SELECTOR_VERSION = "1.0.0";
const DEFAULT_ROOT = path.resolve(__dirname, "..", "..");
const CHANGE_VALUES = ["bugfix", "update", "release"];
const BLAST_VALUES = ["minor", "major"];

function readTrailer(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return { error: "change_trailer_missing: no trailer object (neither ticket, plan contract, nor HEAD commit carried a valid {change,blast,risks} classification)" };
  }
  const changeTrailer = require("../checks/change-trailer");
  const v = changeTrailer.validateClassification(obj, "trailer");
  if (!v.ok) {
    return { error: `change_trailer_missing: ${v.errors.join("; ")}` };
  }
  return { change: v.value.change, blast: v.value.blast, risks: v.value.risks, source: obj.source || "unknown", overridden: null };
}

function readTrailerFile(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (e) {
    return { error: `change_trailer_missing: --trailer-json ${file} could not be read: ${e.message}` };
  }
  let obj;
  try {
    obj = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
  } catch (e) {
    return { error: `change_trailer_missing: --trailer-json ${file} is not valid JSON: ${e.message}` };
  }
  return readTrailer(obj);
}

const RANK = { bugfix: 0, update: 1, release: 2 };

function unitReviewerRole(composition) {
  const types = new Set(((composition && composition.unit_types) || []).map((t) => String(t).toLowerCase()));
  if (types.has("backend")) return "backend-reviewer";
  if (types.has("frontend")) return "frontend-reviewer";
  return null;
}

function uniq(arr) {
  return [...new Set(arr)];
}

const GRAPH_SENSITIVE_RE = /^scripts\/maps\//;
const GRAPH_NODE_DROP_THRESHOLD = 0.8;

function checkGraphIntegrity({ focusedFiles, loaded, built, head } = {}) {
  const reasons = [];
  if ((focusedFiles || []).some((f) => GRAPH_SENSITIVE_RE.test(String(f || "").replace(/\\/g, "/")))) {
    reasons.push("graph_builder_changed");
  }
  if (!built) {
    reasons.push("graph_build_failed");
  } else if (loaded && loaded.counts && typeof loaded.counts.nodes === "number" && loaded.counts.nodes > 0) {
    const builtNodes = (built.counts && typeof built.counts.nodes === "number") ? built.counts.nodes : 0;
    if (builtNodes < loaded.counts.nodes * GRAPH_NODE_DROP_THRESHOLD) {
      reasons.push(`node_count_drop:${loaded.counts.nodes}->${builtNodes}`);
    }
    if (loaded.head === head && builtNodes !== loaded.counts.nodes) {
      reasons.push(`head_claim_mismatch:${loaded.counts.nodes}->${builtNodes}`);
    }
  }
  return { poisoned: reasons.length > 0, reasons };
}

function goldenFeaturesTouched(files, goldenPaths) {
  const feats = (goldenPaths && Array.isArray(goldenPaths.features)) ? goldenPaths.features : [];
  const fileSet = new Set((files || []).map((f) => String(f).replace(/\\/g, "/")));
  const hit = [];
  for (const feat of feats) {
    const entries = Array.isArray(feat.entry) ? feat.entry : [];
    if (entries.some((e) => fileSet.has(String(e).replace(/\\/g, "/")))) hit.push(feat);
  }
  return hit;
}

function goldenSmokeFloor(goldenPaths) {
  const feats = (goldenPaths && Array.isArray(goldenPaths.features)) ? goldenPaths.features : [];
  const out = new Set();
  for (const feat of feats) for (const t of feat.smoke_tests || []) out.add(t);
  return [...out].sort();
}

function selectPackage(input = {}) {
  const trailer = input.trailer;
  if (!trailer || trailer.error || !CHANGE_VALUES.includes(trailer.change) || !BLAST_VALUES.includes(trailer.blast)) {
    return { halt_reason: "change_trailer_missing", error: (trailer && trailer.error) || "a valid {change,blast,risks} trailer classification is required before the gauntlet package can be selected" };
  }

  const reasons = [];
  let change = trailer.change;
  let blast = trailer.blast;
  let overridden = null;
  const focused = input.focused || { files: [], tests: [] };
  const tp = input.touchpoint || { files: [], tests: [], depth: 1, unmapped: false, unmapped_files: [], unresolved_hits: [] };
  const security = input.security || { hit: false, by: [] };
  const goldenTouched = input.goldenTouched || { touched: false, features: [] };
  const sprintOrdinal = Number.isInteger(input.sprintOrdinal) ? input.sprintOrdinal : null;

  reasons.push(`change=${change}`, `blast=${blast}`);

  if (blast === "minor" && ((focused.files || []).length > 12 || (tp.files || []).length > 25)) {
    blast = "major";
    overridden = "blast_upgraded:size";
    reasons.push(overridden);
  }

  if (goldenTouched.touched) {
    if (blast === "minor") {
      blast = "major";
      overridden = overridden || "blast_upgraded:golden_entry";
      reasons.push(overridden);
    }
    reasons.push(`golden_touched:${goldenTouched.features.join(",")}`);
  }

  if (security.hit) reasons.push(`security_hit:${security.by.join(",")}`);

  const mapStale = Boolean(tp.map_stale);
  if (mapStale) reasons.push("map_stale_fallback");

  if (tp.dynamic_require_widened) reasons.push("dynamic_require_widened");

  const unmappedEscalation = Boolean(tp.unmapped);
  if (unmappedEscalation) reasons.push(`unmapped_escalation:${(tp.unmapped_files || []).join(",")}`);

  const fourthSprintForced = sprintOrdinal !== null && sprintOrdinal % 4 === 0;
  if (fourthSprintForced) reasons.push(`fourth_sprint_full:ordinal=${sprintOrdinal}`);

  const forcedFull = change === "release" || unmappedEscalation || fourthSprintForced;

  let packageName;
  let crossProvider = false;
  if (forcedFull) {
    packageName = "full";
  } else if (change === "bugfix" && blast === "minor" && !mapStale) {
    packageName = "combined-focused";
  } else if ((change === "bugfix" && blast === "major") || (change === "update" && blast === "minor") || (change === "bugfix" && blast === "minor" && mapStale)) {
    packageName = "touchpoint";
  } else if (change === "update" && blast === "major") {
    packageName = "touchpoint";
    crossProvider = true;
  } else {
    packageName = "touchpoint";
  }
  reasons.push(`package=${packageName}${crossProvider ? " (cross-provider)" : ""}`);

  const unitRole = unitReviewerRole(input.composition);
  let roster = [];
  let budget = { wall_ms: 0, dispatches: 0 };
  let stageIds = [0, 1, 2, 3, 4];
  let securityDeepPresent = false;

  if (packageName === "full") {
    const fullRows = Array.isArray(input.fullRoster) ? input.fullRoster : [];
    roster = fullRows.map((r) => ({ role: r.role, passes: "all", scope: "full", mode: r.mode || "block", matched_via: r.matched_via || null }));
    budget = { wall_ms: 4 * 60 * 60 * 1000, dispatches: roster.length };
    stageIds = [0, 1, 2, 3, 4, 5];
    securityDeepPresent = true;
  } else if (packageName === "combined-focused") {
    roster = [{ role: unitRole || "qa-reviewer", passes: ["primary"], scope: "focused" }];
    budget = { wall_ms: 15 * 60 * 1000, dispatches: 1 };
    if (security.hit) {
      roster.push({ role: "security-reviewer", passes: ["primary", "second_pass", "third_pass"], scope: "focused+touchpoint" });
      budget = { wall_ms: 40 * 60 * 1000, dispatches: 4 };
      stageIds = [0, 1, 2, 3, 4, 5];
      securityDeepPresent = true;
    }
  } else if (packageName === "touchpoint" && !crossProvider) {
    roster = [];
    if (unitRole) roster.push({ role: unitRole, passes: ["primary"], scope: "focused+touchpoint" });
    roster.push({ role: "qa-reviewer", passes: ["primary"], scope: "touchpoint" });
    budget = { wall_ms: 40 * 60 * 1000, dispatches: 2 };
    if (security.hit) {
      roster.push({ role: "security-reviewer", passes: ["primary", "second_pass", "third_pass"], scope: "focused+touchpoint" });
      budget = { wall_ms: 75 * 60 * 1000, dispatches: 5 };
      stageIds = [0, 1, 2, 3, 4, 5];
      securityDeepPresent = true;
    }
  } else if (packageName === "touchpoint" && crossProvider) {
    roster = [];
    if (unitRole) roster.push({ role: unitRole, passes: ["primary"], scope: "focused+touchpoint" });
    roster.push({ role: "qa-reviewer", passes: ["primary"], scope: "touchpoint" });
    roster.push({ role: "security-reviewer", passes: security.hit ? ["primary", "second_pass", "third_pass"] : ["primary"], scope: "focused+touchpoint" });
    budget = security.hit ? { wall_ms: 120 * 60 * 1000, dispatches: 5 } : { wall_ms: 90 * 60 * 1000, dispatches: 3 };
    if (security.hit) {
      stageIds = [0, 1, 2, 3, 4, 5];
      securityDeepPresent = true;
    }
  }

  const sanityFiles = [...(focused.tests || [])];
  const smokeFiles = [...new Set([...(input.goldenSmokeFloor || [])])];
  const stageDefs = {
    0: { stage: 0, name: "trailer", kind: "mechanical", stop_on_fail: true },
    1: { stage: 1, name: "sanity", kind: "tests", files: packageName === "full" ? "FULL_SUITE" : sanityFiles, stop_on_fail: true },
    2: { stage: 2, name: "smoke", kind: "tests", files: smokeFiles, stop_on_fail: true },
    3: { stage: 3, name: "security-shallow", kind: "mechanical", cmds: ["scripts/checks/leak-gate.js", "scripts/checks/brand-leak-scan.js"], stop_on_fail: true },
    4: { stage: 4, name: "review", kind: "agents", roster: roster.map((r) => ({ ...r, files: uniq([...(focused.files || []), ...(tp.files || [])]) })), stop_on_fail: true },
    5: { stage: 5, name: "security-deep", kind: "agents", roster: securityDeepPresent ? [{ role: "security-reviewer", passes: ["primary", "second_pass", "third_pass"], scope: "focused+touchpoint" }] : [], present: securityDeepPresent },
  };
  const stages = stageIds.map((id) => stageDefs[id]);

  return {
    schema: SCHEMA,
    sprint: input.sprint || null,
    run_id: input.run_id || null,
    base: input.base || null,
    head: input.head || null,
    trailer: { ...trailer, change, blast, overridden: overridden || trailer.overridden || null },
    package: packageName,
    cross_provider: crossProvider,
    stages,
    focused: { files: (focused.files || []).length, tests: (focused.tests || []).length, list: [...(focused.tests || [])] },
    touchpoint: {
      files: (tp.files || []).length,
      tests: (tp.tests || []).length,
      depth: tp.depth === undefined ? null : tp.depth,
      map_generated_at: tp.map_generated_at || null,
      unresolved_hits: (tp.unresolved_hits || []).length,
    },
    graph_integrity: (tp && tp.graph_integrity) || { poisoned: false, reasons: [] },
    roster_attribution: roster.map((r) => ({ role: r.role, matched_via: r.matched_via || null })),
    security,
    golden_touched: Boolean(goldenTouched.touched),
    budget,
    reasons,
    selector_version: SELECTOR_VERSION,
  };
}

function stagesFor(decision) {
  return (decision && decision.stages) || [];
}

function validateDecision(d) {
  const problems = [];
  if (!d || typeof d !== "object") return ["decision is not an object"];
  if (d.schema !== SCHEMA) problems.push(`schema must be "${SCHEMA}"`);
  if (typeof d.sprint !== "string" || !d.sprint) problems.push('"sprint" must be a non-empty string');
  if (!d.trailer || !CHANGE_VALUES.includes(d.trailer.change) || !BLAST_VALUES.includes(d.trailer.blast)) problems.push('"trailer.change"/"trailer.blast" must be valid');
  if (!["sanity", "combined-focused", "touchpoint", "smoke", "full"].includes(d.package)) problems.push(`"package" is not a recognized package name: ${JSON.stringify(d.package)}`);
  if (!Array.isArray(d.stages) || d.stages.length === 0) problems.push('"stages" must be a non-empty array');
  if (!d.budget || typeof d.budget.wall_ms !== "number") problems.push('"budget.wall_ms" must be a number');
  if (!Array.isArray(d.reasons) || d.reasons.length === 0) problems.push('"reasons" must be a non-empty array');
  if (typeof d.selector_version !== "string" || !d.selector_version) problems.push('"selector_version" must be a non-empty string');
  const reviewStage = Array.isArray(d.stages) ? d.stages.find((s) => s && s.stage === 4) : null;
  if (!reviewStage || !Array.isArray(reviewStage.roster) || reviewStage.roster.length === 0) {
    problems.push('stage 4 ("review") must carry a non-empty roster — an empty review roster is a vacuous gauntlet');
  }
  if (!d.budget || typeof d.budget.dispatches !== "number" || d.budget.dispatches <= 0) {
    problems.push('"budget.dispatches" must be a number > 0 — zero dispatches is a vacuous gauntlet');
  }
  return problems;
}

function emitSelected(decision, ctx = {}) {
  const problems = validateDecision(decision);
  if (problems.length) {
    process.stderr.write(`gauntlet-package: REFUSED to emit a malformed gauntlet-package-selected event:\n  - ${problems.join("\n  - ")}\n`);
    return { ok: false, problems };
  }
  try {
    const { log } = require("../hooks/lib/logger");
    log("audit", { kind: "gauntlet-package-selected", ...decision }, { actor: ctx.actor || "gauntlet-package-selector", source: ctx.source || "scripts/sprint/gauntlet-package.js" });
    return { ok: true };
  } catch (e) {
    process.stderr.write(`gauntlet-package: event logger unavailable (${e.message}) — decision was still computed, only the event is missing\n`);
    return { ok: false, problems: [`logger unavailable: ${e.message}`] };
  }
}

function emitClosed(payload, ctx = {}) {
  try {
    const { log } = require("../hooks/lib/logger");
    log("audit", { kind: "gauntlet-package-closed", ...payload }, { actor: ctx.actor || "gauntlet-package-selector", source: ctx.source || "scripts/sprint/gauntlet-package.js" });
    return { ok: true };
  } catch (e) {
    process.stderr.write(`gauntlet-package: event logger unavailable (${e.message})\n`);
    return { ok: false };
  }
}

function lastSelectedEvent(sprint) {
  try {
    const { query } = require("../hooks/lib/logger");
    const rows = query({ cat: "audit", search: "gauntlet-package-selected", limit: 500 });
    const mine = rows.filter((r) => r && r.data && r.data.kind === "gauntlet-package-selected" && r.data.sprint === sprint);
    return mine.length ? mine[mine.length - 1] : null;
  } catch {
    return null;
  }
}

function stageRecordGaps(decision, records = {}, opts = {}) {
  const evidence = opts.evidence || ((s, rec) => fileEvidence(s, rec, opts.baseDir));
  const stageRecs = (records && records.stages) || {};
  const roleStatus = (records && records.roles) || {};
  let normalize = (r) => r;
  try {
    normalize = require("../hooks/lib/role-aliases").normalizeRole;
  } catch {
  }
  const statusOf = (r) => roleStatus[r] || roleStatus[normalize(r)] || null;
  const gaps = [];
  const satisfied = [];
  for (const s of stagesFor(decision)) {
    const label = { stage: s.stage, name: s.name, kind: s.kind };
    const key = String(s.stage);
    const rec = Object.prototype.hasOwnProperty.call(stageRecs, key) ? stageRecs[key] : undefined;
    if (rec && typeof rec === "object" && Object.prototype.hasOwnProperty.call(rec, "skip")) {
      if (typeof rec.skip === "string" && rec.skip.trim()) {
        const ack = typeof rec.operator_ack === "string" ? rec.operator_ack.trim() : "";
        if (s.kind === "agents" && !ack) {
          gaps.push({ ...label, why: "a skip of an agents stage requires a non-empty operator_ack (the operator or alpha ruling that waived it)" });
        } else {
          satisfied.push({ ...label, by: `skip: ${rec.skip.trim()}`, skipped: true, ...(ack ? { operator_ack: ack } : {}) });
        }
      } else gaps.push({ ...label, why: "an explicit skip must carry a non-empty reason" });
      continue;
    }
    if (s.kind === "agents") {
      const roles = uniq((s.roster || []).map((r) => r && r.role).filter(Boolean));
      if (!roles.length) {
        satisfied.push({ ...label, by: "decision: no agent scheduled (empty roster)" });
        continue;
      }
      const missing = roles.filter((r) => !(statusOf(r) && statusOf(r).satisfied === true));
      if (missing.length) {
        gaps.push({ ...label, why: `no completion record for ${missing.map((r) => `${r} (${(statusOf(r) && statusOf(r).status) || "no-record"})`).join(", ")}` });
      } else satisfied.push({ ...label, by: `completion records: ${roles.join(", ")}` });
      continue;
    }
    if (s.kind === "tests" || s.kind === "mechanical") {
      if (s.kind === "tests" && Array.isArray(s.files) && s.files.length === 0) {
        satisfied.push({ ...label, by: "decision: no test files scheduled" });
        continue;
      }
      const ev = evidence(s, rec) || { ok: false, why: "evidence reader returned nothing" };
      if (ev.ok === true) satisfied.push({ ...label, by: ev.by || "recorded" });
      else gaps.push({ ...label, why: ev.why || "not recorded" });
      continue;
    }
    gaps.push({ ...label, why: `unknown stage kind '${s.kind}'` });
  }
  return { gaps, satisfied };
}

function fileEvidence(stage, rec, baseDir) {
  if (!rec || typeof rec !== "object") return { ok: false, why: "no stage record (pass --stage-records with evidence, or an explicit skip with a reason)" };
  if (typeof rec.evidence !== "string" || !rec.evidence.trim()) return { ok: false, why: "the stage record names no evidence file" };
  if (rec.exit !== 0) return { ok: false, why: `the stage record's exit is ${JSON.stringify(rec.exit)}, not 0` };
  const p = path.isAbsolute(rec.evidence) ? rec.evidence : path.resolve(baseDir || process.cwd(), rec.evidence);
  let buf;
  try {
    buf = fs.readFileSync(p);
  } catch (e) {
    return { ok: false, why: `evidence file unreadable: ${p} (${e.code || e.message})` };
  }
  if (!buf.length) return { ok: false, why: `evidence file is empty: ${p}` };
  const sha = require("crypto").createHash("sha256").update(buf).digest("hex");
  return { ok: true, by: `evidence ${p} (exit 0, ${buf.length} bytes, sha256 ${sha})` };
}

function closeStageRecords(prior, opts = {}, deps = {}) {
  let fileRecs = {};
  let baseDir = process.cwd();
  if (opts.stageRecords) {
    const f = path.resolve(opts.stageRecords);
    baseDir = path.dirname(f);
    const raw = JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
    if (!raw || typeof raw !== "object" || !raw.stages || typeof raw.stages !== "object" || Array.isArray(raw.stages)) {
      throw new Error(`--stage-records ${f}: expected {"stages": {"<n>": {"evidence": "<path>", "exit": 0} | {"skip": "<reason>"}}}`);
    }
    fileRecs = raw.stages;
  }
  const decision = prior.data;
  const roles = uniq(stagesFor(decision).filter((s) => s.kind === "agents").flatMap((s) => (s.roster || []).map((r) => r && r.role).filter(Boolean)));
  const roleStatus = {};
  let verify = null;
  if (roles.length) {
    const verifyFn = deps.verifyGauntlet || require("../dispatch/gauntlet-verify").verifyGauntlet;
    verify = verifyFn({ runId: opts.sprint, sprintId: opts.sprint, roles, since: prior.ts, until: new Date().toISOString(), requireSignature: true });
    for (const r of (verify && Array.isArray(verify.roles) ? verify.roles : [])) if (r && r.role) roleStatus[r.role] = { satisfied: r.satisfied === true, status: r.status };
  }
  return { ...stageRecordGaps(decision, { stages: fileRecs, roles: roleStatus }, { baseDir }), verify };
}

const SECURITY_SURFACE_FLOOR = Object.freeze([
  ".claude/settings.json",
  "framework/hooks.registry.json",
  "package.json",
  "scripts/dispatch/**",
  "scripts/dispatch-*.js",
  "scripts/sprint/**",
  "scripts/maps/require-graph.js",
  "scripts/install-git-hooks.sh",
  "scripts/hooks/secret-guard.js",
  "scripts/hooks/authorization-gate.js",
  "scripts/hooks/change-trailer-guard.js",
  "scripts/hooks/protected-ref-transaction.js",
  "scripts/hooks/lib/mc-env.js",
  "scripts/checks/leak-*",
  "scripts/check/privacy.js",
  "scripts/check/privacy.test.js",
  "scripts/checks/framework-purity.js",
  "scripts/checks/readme-drift.js",
  "scripts/checks/mc-tracked-transients.js",
  "scripts/checks/run-tests.js",
  "scripts/checks/change-trailer.js",
  "scripts/checks/brand-leak-scan.js",
  "scripts/checks/main-write-broker-completeness.js",
  "scripts/checks/sprint-hook-coverage*.js",
  "scripts/checks/golden-paths-validate*.js",
  "scripts/checks/*.test.js",
  ".claude/agents/**",
  ".claude/agents/_org/**",
  "framework/paths.registry.json",
  "scripts/hooks/hook-manifest.json",
  ".gitignore",
  "tests/**",
  ".github/workflows/**",
  ".claude/paths.json",
  ".claude/manifest.json",
  ".claude/framework-manifest.json",
  ".claude/framework-installed.json",
]);

class GoldenPathsMalformedError extends Error {
  constructor(message) {
    super(message);
    this.name = "GoldenPathsMalformedError";
    this.code = "golden_paths_malformed";
  }
}

function loadGoldenPaths(root) {
  const file = path.join(root, "_planning", "golden-paths.json");
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (e) {
    if (e && e.code === "ENOENT") return { schema: "mc/golden-paths/v1", features: [], security_surface_globs: [...SECURITY_SURFACE_FLOOR] };
    throw new GoldenPathsMalformedError(`golden-paths.json present but unreadable: ${e && e.code ? e.code : "read error"}`);
  }
  let project;
  try {
    project = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
  } catch {
    throw new GoldenPathsMalformedError("golden-paths.json present but not valid JSON");
  }
  if (!project || typeof project !== "object" || Array.isArray(project)) throw new GoldenPathsMalformedError("golden-paths.json must be a JSON object");
  if (project.features !== undefined && !Array.isArray(project.features)) throw new GoldenPathsMalformedError("golden-paths.json `features` must be an array");
  const nes = (v) => typeof v === "string" && v.trim() !== "";
  const isRel = (p) => nes(p) && !(path.isAbsolute(p) || /^[a-zA-Z]:/.test(p) || p.split(/[\\/]/).includes(".."));
  (project.features || []).forEach((f, i) => {
    if (!f || typeof f !== "object" || Array.isArray(f) || !nes(f.id) || !nes(f.name) ||
        !Array.isArray(f.entry) || f.entry.length === 0 || !f.entry.every(nes) ||
        !Array.isArray(f.smoke_tests) || !f.smoke_tests.every(nes) || typeof f.security_surface !== "boolean") {
      throw new GoldenPathsMalformedError(`golden-paths.json features[${i}] malformed (needs non-empty id, name, non-empty entry[] of strings, smoke_tests[] of strings, boolean security_surface)`);
    }
    if (!f.entry.every(isRel) || !f.smoke_tests.every(isRel)) {
      throw new GoldenPathsMalformedError(`golden-paths.json features[${i}] entry/smoke_tests must be repo-relative (no absolute path, drive letter, or '..' segment)`);
    }
  });
  if (project.schema !== "mc/golden-paths/v1") throw new GoldenPathsMalformedError("golden-paths.json `schema` must be \"mc/golden-paths/v1\"");
  const pg = project.security_surface_globs;
  if (pg !== undefined && (!Array.isArray(pg) || pg.some((g) => !nes(g) || g.includes("\0")))) throw new GoldenPathsMalformedError("golden-paths.json `security_surface_globs` must be an array of non-empty strings");
  if (pg !== undefined && pg.some((g) => !isRel(g))) throw new GoldenPathsMalformedError("golden-paths.json `security_surface_globs` entries must be repo-relative (no absolute path, no `..` segment)");
  return {
    ...project,
    schema: project.schema,
    features: project.features || [],
    security_surface_globs: [...new Set([...SECURITY_SURFACE_FLOOR, ...(pg || [])])],
  };
}

function computeSprintOrdinal(root) {
  try {
    const dir = path.join(root, ".claude", "project", "sprint", "history");
    const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
    return entries.length + 1;
  } catch {
    return null;
  }
}

function assembleInput(opts) {
  const root = path.resolve(opts.root || DEFAULT_ROOT);
  const trailer = opts.trailer;
  const goldenPaths = loadGoldenPaths(root);
  const composition = opts.composition || { unit_types: [], max_risk: "", domains: [] };

  const focused = touchpoint.focusedSet({ base: opts.base, head: opts.head, cwd: root, linkedTests: opts.linkedTests });

  const closureDepth = opts.depth === undefined ? 1 : opts.depth;
  let mapStale = false;
  const requireGraph = require("../maps/require-graph");
  const loaded = requireGraph.loadRequireGraph(root);
  let built = null;
  try {
    built = requireGraph.buildRequireGraph(root);
  } catch {
    mapStale = true;
  }
  let graph = built
    ? touchpoint.touchpointClosure(focused.files, { graph: built, depth: closureDepth, root })
    : touchpoint.touchpointClosure(focused.files, { depth: 2, root });
  graph = touchpoint.widenForDynamicHints(graph, { root });
  graph.map_stale = mapStale;

  const graphIntegrity = checkGraphIntegrity({ focusedFiles: focused.files, loaded, built, head: opts.head });
  graph.graph_integrity = graphIntegrity;
  if (graphIntegrity.poisoned) {
    graph.unmapped = true;
    graph.unmapped_files = [...new Set([...(graph.unmapped_files || []), ...graphIntegrity.reasons.map((r) => `<graph_integrity:${r}>`)])];
  }

  const allTouched = uniq([...focused.files, ...graph.files]);
  const security = touchpoint.securitySurfaceHit({ files: allTouched, risks: trailer.risks, goldenPaths });
  const touchedFeatures = goldenFeaturesTouched(focused.files, goldenPaths);
  const goldenTouched = { touched: touchedFeatures.length > 0, features: touchedFeatures.map((f) => f.id) };

  const maximalComposition = {
    ...composition,
    change: "release",
    blast: "major",
    surfaces: [...new Set([...(composition.surfaces || []), "security"])],
  };
  let fullRoster = [];
  try {
    fullRoster = hookPoints.agentsForStep("gauntlet", maximalComposition);
  } catch {
    fullRoster = [];
  }

  return {
    trailer,
    composition,
    focused,
    touchpoint: graph,
    security,
    goldenTouched,
    goldenSmokeFloor: goldenSmokeFloorOf(goldenPaths),
    sprintOrdinal: opts.sprintOrdinal === undefined ? computeSprintOrdinal(root) : opts.sprintOrdinal,
    sprint: opts.sprint,
    run_id: opts.runId || `run-${Date.now()}`,
    base: opts.base,
    head: opts.head,
    fullRoster,
  };
}

function goldenSmokeFloorOf(goldenPaths) {
  return goldenSmokeFloor(goldenPaths);
}

function runDifferential(decision, opts = {}) {
  const root = path.resolve(opts.root || DEFAULT_ROOT);
  const runTests = require("../checks/run-tests");
  const run = opts.run || ((bin, args, o) => require("child_process").spawnSync(bin, args, { cwd: root, encoding: "utf8", ...o }));
  const listFiles = opts.listFiles || (() => runTests.discoverTestFiles(root));

  const attribution = Array.isArray(decision && decision.roster_attribution) ? decision.roster_attribution : [];
  const failOpenRosterCandidates = attribution.filter((a) => a && a.matched_via === "unknown-open").map((a) => a.role);
  const strict = opts.strict === true;

  const stages = Array.isArray(decision && decision.stages) ? decision.stages : [];
  const s1 = stages.find((s) => s && s.stage === 1) || {};
  const s2 = stages.find((s) => s && s.stage === 2) || {};
  const packageFiles = new Set([
    ...(s1.files === "FULL_SUITE" ? [] : Array.isArray(s1.files) ? s1.files : []),
    ...(Array.isArray(s2.files) ? s2.files : []),
  ]);

  if (decision && decision.package === "full") {
    return {
      ok: !strict || failOpenRosterCandidates.length === 0,
      package_files: [...packageFiles],
      full_files: [...packageFiles],
      full_failures: [],
      selector_miss: [],
      quarantined_excluded: [],
      fail_open_roster_candidates: failOpenRosterCandidates,
    };
  }

  const quarantineFile = opts.quarantine ? path.resolve(opts.quarantine) : path.join(root, "tests", "quarantine.json");
  let quarantinedSet;
  if (!fs.existsSync(quarantineFile)) {
    const err = new Error(`quarantine_register_unreadable: no register at ${quarantineFile}`);
    err.halt_reason = "quarantine_register_unreadable";
    throw err;
  }
  try {
    quarantinedSet = new Set(runTests.loadQuarantine(quarantineFile, root).entries.map((e) => e.file));
  } catch (e) {
    const err = new Error(`quarantine_register_unreadable: ${e.message}`);
    err.halt_reason = "quarantine_register_unreadable";
    throw err;
  }

  const discoveredFiles = listFiles();
  const quarantinedExcluded = discoveredFiles.filter((f) => quarantinedSet.has(f));
  const fullFiles = discoveredFiles.filter((f) => !quarantinedSet.has(f));
  const fullFailures = [];
  for (const file of fullFiles) {
    const args = runTests.nodeTestArgs([file]);
    const r = run(process.execPath, args, { env: runTests.childEnv() });
    const exit = r && typeof r.status === "number" ? r.status : 1;
    if (exit !== 0) fullFailures.push(file);
  }

  const selectorMiss = fullFailures.filter((f) => !packageFiles.has(f));

  return {
    ok: selectorMiss.length === 0 && (!strict || failOpenRosterCandidates.length === 0),
    package_files: [...packageFiles],
    full_files: fullFiles,
    full_failures: fullFailures,
    selector_miss: selectorMiss,
    quarantined_excluded: quarantinedExcluded,
    fail_open_roster_candidates: failOpenRosterCandidates,
  };
}

function usage(msg) {
  if (msg) process.stderr.write(`gauntlet-package: ${msg}\n`);
  process.stderr.write(
    "usage: node scripts/sprint/gauntlet-package.js select  --sprint <id> --diff <base>..<head> --trailer-json <file> [--root <dir>] [--sprint-ordinal N] [--json]\n" +
      "       node scripts/sprint/gauntlet-package.js explain --sprint <id> --diff <base>..<head> --trailer-json <file> [--root <dir>] [--sprint-ordinal N] [--json]\n" +
      "       node scripts/sprint/gauntlet-package.js close   --sprint <id> --actual-ms N --actual-dispatches N [--rounds N] [--root <dir>] [--stage-records <file>] [--differential] [--strict|--lenient --lenient-reason <text>]\n",
  );
  process.exit(2);
}

function parseDiff(spec) {
  const m = /^(.+?)\.\.(.+)$/.exec(String(spec || ""));
  if (!m) return null;
  return { base: m[1], head: m[2] };
}

function parseCliArgs(argv) {
  const opts = { root: DEFAULT_ROOT, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--sprint") opts.sprint = argv[++i];
    else if (a === "--diff") {
      const d = parseDiff(argv[++i]);
      if (!d) usage("--diff must be <base>..<head>");
      opts.base = d.base;
      opts.head = d.head;
    } else if (a === "--trailer-json") opts.trailerJson = argv[++i];
    else if (a === "--root") opts.root = path.resolve(argv[++i]);
    else if (a === "--sprint-ordinal") opts.sprintOrdinal = Number(argv[++i]);
    else if (a === "--actual-ms") opts.actualMs = Number(argv[++i]);
    else if (a === "--actual-dispatches") opts.actualDispatches = Number(argv[++i]);
    else if (a === "--rounds") opts.rounds = Number(argv[++i]);
    else if (a === "--stage-records") opts.stageRecords = argv[++i];
    else if (a === "--differential") opts.differential = true;
    else if (a === "--strict") opts.strict = true;
    else if (a === "--lenient-reason") opts.lenientReason = argv[++i];
    else if (a === "--lenient") opts.lenient = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--help" || a === "-h") usage();
    else usage(`unknown argument: ${a}`);
  }
  return opts;
}

function runSelectOrExplain(cmd, opts) {
  if (!opts.sprint) usage("--sprint is required");
  const trailer = opts.trailerJson ? readTrailerFile(opts.trailerJson) : { error: "change_trailer_missing: --trailer-json not given" };
  if (trailer.error) {
    process.stdout.write(`gauntlet-package: HALT — ${trailer.error}\n`);
    return 2;
  }
  if (!opts.base || !opts.head) usage("--diff <base>..<head> is required");
  let assembled;
  let decision;
  try {
    assembled = assembleInput({ ...opts, trailer });
    decision = selectPackage(assembled);
  } catch (e) {
    const reason = e instanceof GoldenPathsMalformedError ? `golden_paths_malformed: ${e.message}` : `assemble_failed: ${e && e.message ? e.message : String(e)}`;
    process.stdout.write(`gauntlet-package: HALT — ${reason}\n`);
    return 2;
  }
  if (decision.halt_reason) {
    process.stdout.write(`gauntlet-package: HALT — ${decision.error}\n`);
    return 2;
  }
  if (cmd === "explain") {
    if (opts.json) process.stdout.write(`${JSON.stringify({ reasons: decision.reasons }, null, 2)}\n`);
    else for (const r of decision.reasons) process.stdout.write(`${r}\n`);
    return 0;
  }
  const emitted = emitSelected(decision);
  if (!emitted.ok) return 1;
  if (opts.json) process.stdout.write(`${JSON.stringify(decision, null, 2)}\n`);
  else process.stdout.write(`gauntlet-package: selected "${decision.package}"${decision.cross_provider ? " (cross-provider)" : ""} — ${decision.reasons.join("; ")}\n`);
  return 0;
}

function runClose(opts) {
  if (!opts.sprint) usage("--sprint is required");
  for (const [flag, v] of [["--actual-ms", opts.actualMs], ["--actual-dispatches", opts.actualDispatches]]) {
    if (!Number.isInteger(v) || v < 0) usage(`${flag} is required and must be a non-negative integer (got ${JSON.stringify(v === undefined ? null : v)})`);
  }
  const lenientReason = typeof opts.lenientReason === "string" ? opts.lenientReason.trim() : "";
  if (opts.lenient && !lenientReason) usage("--lenient requires a non-empty --lenient-reason <text> (refused without it)");
  const prior = lastSelectedEvent(opts.sprint);
  if (!prior) {
    process.stderr.write(`gauntlet-package: no gauntlet-package-selected event found for sprint ${opts.sprint}\n`);
    return 1;
  }
  let stageCheck;
  try {
    stageCheck = closeStageRecords(prior, opts);
  } catch (e) {
    process.stderr.write(`gauntlet-package: close REFUSED for sprint ${opts.sprint} — stage records unreadable: ${e.message}\n`);
    return 1;
  }
  if (stageCheck.gaps.length) {
    for (const g of stageCheck.gaps) process.stderr.write(`gauntlet-package: stage ${g.stage} (${g.name}, ${g.kind}) has no record — ${g.why}\n`);
    try {
      const { log } = require("../hooks/lib/logger");
      log("audit", { kind: "gauntlet-package-close-refused", schema: SCHEMA, sprint: opts.sprint, run_id: prior.data.run_id, package: prior.data.package, halt_reason: "stage_without_record", gaps: stageCheck.gaps }, { actor: "gauntlet-package-selector", source: "scripts/sprint/gauntlet-package.js" });
    } catch {
    }
    process.stdout.write(`gauntlet-package: close REFUSED — halt_reason stage_without_record: ${stageCheck.gaps.length} of ${stagesFor(prior.data).length} scheduled stage(s) unrecorded (stage ${stageCheck.gaps.map((g) => g.stage).join(", ")})\n`);
    return 1;
  }
  const budget = prior.data.budget || { wall_ms: 0, dispatches: 0 };
  const actual = { wall_ms: opts.actualMs || 0, dispatches: opts.actualDispatches || 0, rounds: opts.rounds || 1 };
  const exceeded = (typeof budget.wall_ms === "number" && actual.wall_ms > budget.wall_ms) || (typeof budget.dispatches === "number" && actual.dispatches > budget.dispatches);

  const strict = opts.differential ? !opts.lenient : false;
  if (opts.differential && opts.lenient) {
    try {
      const { log } = require("../hooks/lib/logger");
      log("audit", { kind: "gauntlet-differential-lenient", sprint: opts.sprint, lenient_reason: lenientReason }, { actor: "gauntlet-package-selector", source: "scripts/sprint/gauntlet-package.js" });
    } catch { }
    process.stderr.write(`gauntlet-package: --lenient — fail_open_roster_candidates will only WARN, not gate, for sprint ${opts.sprint} (logged)\n`);
  }
  let selectorMiss = [];
  let failOpenRosterCandidates = [];
  let quarantinedExcluded = [];
  let differentialError = null;
  let haltReason = null;
  if (opts.differential) {
    try {
      const diff = runDifferential(prior.data, { root: opts.root, strict });
      selectorMiss = diff.selector_miss;
      quarantinedExcluded = diff.quarantined_excluded || [];
      failOpenRosterCandidates = diff.fail_open_roster_candidates || [];
    } catch (e) {
      differentialError = e.message;
      haltReason = e.halt_reason || null;
    }
  }

  const payload = {
    schema: SCHEMA,
    sprint: opts.sprint,
    run_id: prior.data.run_id,
    package: prior.data.package,
    budget,
    actual,
    exceeded,
    stage_records: stageCheck.satisfied,
    skipped_stages: stageCheck.satisfied.filter((s) => s.skipped).map((s) => ({ stage: s.stage, name: s.name, kind: s.kind, reason: s.by, ...(s.operator_ack ? { operator_ack: s.operator_ack } : {}) })),
    exceeded_by: exceeded
      ? { wall_ms: Math.max(0, actual.wall_ms - (budget.wall_ms || 0)), dispatches: Math.max(0, actual.dispatches - (budget.dispatches || 0)) }
      : { wall_ms: 0, dispatches: 0 },
    ...(opts.differential ? { selector_miss: selectorMiss, quarantined_excluded: quarantinedExcluded, fail_open_roster_candidates: failOpenRosterCandidates, strict, lenient: Boolean(opts.lenient), ...(opts.lenient ? { lenient_reason: lenientReason } : {}), ...(haltReason ? { halt_reason: haltReason } : {}) } : {}),
  };
  const differentialFailed = opts.differential && (selectorMiss.length > 0 || differentialError || (strict && failOpenRosterCandidates.length > 0));
  if (differentialFailed) {
    const why = haltReason || (differentialError ? "differential_error" : selectorMiss.length > 0 ? "selector_miss" : "fail_open_roster");
    try {
      const { log } = require("../hooks/lib/logger");
      log("audit", { kind: "gauntlet-package-close-refused", ...payload, halt_reason: why, ...(differentialError ? { differential_error: differentialError } : {}) }, { actor: "gauntlet-package-selector", source: "scripts/sprint/gauntlet-package.js" });
    } catch {
    }
    process.stderr.write(`gauntlet-package: close REFUSED for sprint ${opts.sprint} — halt_reason ${why}${differentialError ? ` (${differentialError})` : ""}: selector_miss ${JSON.stringify(selectorMiss)}, fail_open_roster_candidates ${JSON.stringify(failOpenRosterCandidates)}\n`);
    process.stdout.write(`gauntlet-package: close REFUSED — halt_reason ${why}\n`);
    return 1;
  }
  emitClosed(payload);
  const warnOnly = opts.differential && !strict && failOpenRosterCandidates.length > 0 && !differentialFailed;
  if (warnOnly) {
    process.stderr.write(`gauntlet-package: WARN — fail-open roster candidate(s) (matched_via:"unknown-open", not gating under --lenient): ${failOpenRosterCandidates.join(", ")}\n`);
  }
  const diffNote = !opts.differential
    ? ""
    : differentialError
      ? ` — DIFFERENTIAL ERROR: ${differentialError}`
      : differentialFailed
        ? ` — DIFFERENTIAL: selector_miss ${JSON.stringify(selectorMiss)}${strict && failOpenRosterCandidates.length ? `, fail_open_roster_candidates ${JSON.stringify(failOpenRosterCandidates)}` : ""}`
        : warnOnly
          ? ` — differential: no miss (fail_open_roster_candidates ${JSON.stringify(failOpenRosterCandidates)}, lenient warn-only)`
          : " — differential: no miss";
  const quarantineNote = opts.differential && quarantinedExcluded.length ? ` [quarantined_excluded ${quarantinedExcluded.length}: ${quarantinedExcluded.join(", ")}]` : "";
  process.stdout.write(`gauntlet-package: closed "${payload.package}" — ${exceeded ? "BUDGET EXCEEDED" : "within budget"}${diffNote}${quarantineNote}\n`);
  return differentialFailed ? 1 : 0;
}

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (!cmd || !["select", "explain", "close"].includes(cmd)) usage(cmd ? `unknown command: ${cmd}` : "a command is required");
  const opts = parseCliArgs(argv.slice(1));
  if (cmd === "close") return runClose(opts);
  return runSelectOrExplain(cmd, opts);
}

module.exports = {
  SCHEMA,
  SELECTOR_VERSION,
  readTrailer,
  readTrailerFile,
  unitReviewerRole,
  checkGraphIntegrity,
  goldenFeaturesTouched,
  goldenSmokeFloor,
  selectPackage,
  stagesFor,
  stageRecordGaps,
  fileEvidence,
  closeStageRecords,
  validateDecision,
  emitSelected,
  emitClosed,
  lastSelectedEvent,
  loadGoldenPaths,
  SECURITY_SURFACE_FLOOR,
  GoldenPathsMalformedError,
  computeSprintOrdinal,
  assembleInput,
  runDifferential,
};

if (require.main === module) {
  process.exitCode = main();
}
