#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

function resolveRoot() {
  const anchor = path.resolve(__dirname, "..", "..");
  if (fs.existsSync(path.join(anchor, ".claude"))) return anchor;
  const envRoot = process.env.CLAUDE_PROJECT_DIR;
  if (envRoot && fs.existsSync(path.join(envRoot, ".claude"))) return envRoot;
  return anchor;
}

const ROOT = resolveRoot();
const NAME = "contract-lint";

const DEFAULT_DOC = path.join(ROOT, ".claude", "kernel", "top-level-runtime-contract.md");
const DEFAULT_LEDGER = path.join(ROOT, ".claude", "project", "memory", "enforcement-debt.jsonl");
const DEFAULT_MANIFEST = path.join(ROOT, ".claude", "kernel", "fixtures", "manifest.json");

const H1_SENTENCE =
  "1.0 is done when a clean installed product moves idea→canon→roadmap→sprint→build→gauntlet→launch-readiness→release→retro→learning-promotion without relying on chat memory, stale trackers, manual Alpha heroics, or unverified agent claims.";

const HEADING_RE = /^####\s+P(\d+)\.(\d+)\s+—\s+(\S.*)$/;
const HEADING_ATTEMPT_RE = /^####\s+P(\d+)\.(\d+)\b/;
const SECTION_RE = /^#{2,3}\s+/;
const THEMATIC_BREAK_RE = /^(-{3,}|\*{3,}|_{3,})\s*$/;
const ENFORCER_RE = /^Enforcer:\s*(.+)$/;
const DEFERRED_RE = /^Deferred(?::\s*(ED-\d+))?\s*@\s*(Phase-\d+-exit)$|^Deferred: no enforcing check yet$/;
const CORE_RE = /^Core:\s*non-waivable$/;
const CORE_ID_RE = /\*\*core_id:\*\*\s*(CORE-\d+)/;
const WAIVABLE_FALSE_RE = /\*\*waivable:\*\*\s*false/;
const ED_TOKEN_RE = /ED-\d+/g;
const REQUIRED_CORE_IDS = ["CORE-1", "CORE-2", "CORE-3", "CORE-4"];

function parseLedgerIds(text) {
  const ids = new Set();
  const lines = text.split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      const err = new Error(`ledger line is not valid JSON: ${line.slice(0, 80)}`);
      err.code = "LEDGER_PARSE_ERROR";
      throw err;
    }
    if (obj && typeof obj.id === "string") ids.add(obj.id);
  }
  return ids;
}

function findBlocks(lines) {
  const blocks = [];
  const malformedHeadings = [];
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = HEADING_RE.exec(line);
    if (h) {
      if (current) blocks.push(current);
      current = { id: `P${h[1]}.${h[2]}`, headingLine: i, lines: [line] };
      continue;
    }
    const attempt = HEADING_ATTEMPT_RE.exec(line);
    if (attempt) {
      malformedHeadings.push({ line: i + 1, text: line, attemptedId: `P${attempt[1]}.${attempt[2]}` });
      if (current) blocks.push(current);
      current = null;
      continue;
    }
    if (current) {
      if (SECTION_RE.test(line) || THEMATIC_BREAK_RE.test(line.trim())) {
        blocks.push(current);
        current = null;
        continue;
      }
      current.lines.push(line);
    }
  }
  if (current) blocks.push(current);
  blocks.malformedHeadings = malformedHeadings;
  return blocks;
}

const REGISTER_HEADING_RE = /^###\s+Policy-block register\s*$/;
const REGISTER_ROW_RE = /^\|\s*(P(\d+)\.(\d+))\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|$/;

function parsePolicyRegister(lines) {
  const headingIdx = lines.findIndex((l) => REGISTER_HEADING_RE.test(l.trim()));
  if (headingIdx === -1) return { found: false, rows: [] };
  const rows = [];
  let sawTableRow = false;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed.startsWith("|")) {
      if (sawTableRow) break;
      if (trimmed === "") continue;
      break;
    }
    sawTableRow = true;
    const m = REGISTER_ROW_RE.exec(trimmed);
    if (m) {
      rows.push({ id: m[1], section: Number(m[2]), index: Number(m[3]), line: i + 1 });
    }
  }
  return { found: true, rows };
}

function resolveEnforcer(ref, rootDir) {
  const trimmed = String(ref || "").trim();
  if (!trimmed) return { resolved: false, error: "empty enforcer ref" };
  const abs = path.isAbsolute(trimmed) ? trimmed : path.join(rootDir, trimmed);

  const checksRoot = path.resolve(rootDir, "scripts", "checks");
  const checksRootWithSep = checksRoot.endsWith(path.sep) ? checksRoot : checksRoot + path.sep;
  const resolvedAbs = path.resolve(abs);
  if (resolvedAbs !== checksRoot && !resolvedAbs.startsWith(checksRootWithSep)) {
    return {
      resolved: false,
      error: `enforcer ref escapes scripts/checks/ (refused before require(), never loaded): ${trimmed}`,
    };
  }

  if (!fs.existsSync(resolvedAbs)) return { resolved: false, error: `does not exist: ${trimmed}` };

  if (!resolvedAbs.toLowerCase().endsWith(".js")) {
    return {
      resolved: false,
      error: `enforcer ref does not resolve to a .js file (refused before require(), never loaded): ${trimmed}`,
    };
  }
  let stat;
  try {
    stat = fs.statSync(resolvedAbs);
  } catch (e) {
    return { resolved: false, error: `failed to stat: ${(e && e.message) || e}` };
  }
  if (!stat.isFile()) {
    return {
      resolved: false,
      error: `enforcer ref does not resolve to a regular file (refused before require(), never loaded): ${trimmed}`,
    };
  }

  try {
    const real = fs.realpathSync(resolvedAbs);
    if (real !== checksRoot && !real.startsWith(checksRootWithSep)) {
      return {
        resolved: false,
        error: `enforcer ref is a symlink escaping scripts/checks/ (refused before require(), never loaded): ${trimmed}`,
      };
    }
  } catch {
  }

  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    require(resolvedAbs);
    return { resolved: true };
  } catch (e) {
    return { resolved: false, error: `failed to load: ${(e && e.message) || e}` };
  }
}

function evaluate(opts) {
  const { docText, ledgerIds, ledgerError, fixtureCount, manifestError, rootDir, resolveEnforcerFn } = opts || {};
  const doResolve = resolveEnforcerFn || ((ref) => resolveEnforcer(ref, rootDir));

  const structural = [];
  const policy = [];

  if (ledgerError) {
    structural.push({ reason: "ledger-unreadable", detail: ledgerError });
  }

  if (manifestError) {
    structural.push({ reason: "manifest-unreadable", detail: manifestError });
  }

  if (typeof docText !== "string" || !docText.trim()) {
    structural.push({ reason: "empty-document" });
    return finalize(structural, policy);
  }

  const lines = docText.split("\n");
  const blocks = findBlocks(lines);
  const malformedHeadings = blocks.malformedHeadings || [];

  for (const mh of malformedHeadings) {
    structural.push({
      reason: "malformed-heading",
      line: mh.line,
      attemptedId: mh.attemptedId,
      detail: mh.text.trim(),
    });
  }

  if (blocks.length === 0) {
    if (malformedHeadings.length === 0) {
      structural.push({ reason: "no-policy-blocks" });
    }
    return finalize(structural, policy);
  }

  const blockIdCounts = new Map();
  for (const block of blocks) {
    blockIdCounts.set(block.id, (blockIdCounts.get(block.id) || 0) + 1);
  }
  for (const [id, count] of blockIdCounts.entries()) {
    if (count > 1) {
      structural.push({ reason: "duplicate-block-id", block: id, count });
    }
  }

  const coreBlocks = new Map();

  for (const block of blocks) {
    const blockText = block.lines.join("\n");
    const coreMatch = CORE_ID_RE.exec(blockText);
    const isCoreTagged = !!coreMatch;

    const trailerMatches = [];
    for (let li = 0; li < block.lines.length; li++) {
      const trimmed = block.lines[li].trim();
      if (ENFORCER_RE.test(trimmed)) trailerMatches.push({ kind: "Enforcer", line: trimmed, idx: li });
      else if (DEFERRED_RE.test(trimmed)) trailerMatches.push({ kind: "Deferred", line: trimmed, idx: li });
      else if (CORE_RE.test(trimmed)) trailerMatches.push({ kind: "Core", line: trimmed, idx: li });
    }
    const coreTrailers = trailerMatches.filter((t) => t.kind === "Core");
    const enforcerTrailers = trailerMatches.filter((t) => t.kind === "Enforcer");
    const deferredTrailers = trailerMatches.filter((t) => t.kind === "Deferred");

    let shapeOk = false;
    let terminalIdx = -1;
    let recognized = [];

    if (isCoreTagged && coreTrailers.length === 1 && deferredTrailers.length === 0) {
      shapeOk = true;
      recognized = [...coreTrailers, ...enforcerTrailers].sort((a, b) => a.idx - b.idx);
      terminalIdx = recognized[recognized.length - 1].idx;
    } else if (
      isCoreTagged &&
      deferredTrailers.length === 1 &&
      coreTrailers.length === 0 &&
      enforcerTrailers.length === 0
    ) {
      shapeOk = true;
      recognized = deferredTrailers;
      terminalIdx = deferredTrailers[0].idx;
    } else if (!isCoreTagged && trailerMatches.length === 1) {
      shapeOk = true;
      recognized = trailerMatches;
      terminalIdx = trailerMatches[0].idx;
    }

    if (!shapeOk) {
      structural.push({ reason: "malformed-block-trailer", block: block.id, found: trailerMatches.length });
      continue;
    }

    const hasTrailingContent = block.lines.slice(terminalIdx + 1).some((l) => l.trim().length > 0);
    if (hasTrailingContent) {
      structural.push({ reason: "trailer-not-terminal", block: block.id });
      continue;
    }

    for (const t of recognized) {
      if (t.kind === "Enforcer") {
        const m = ENFORCER_RE.exec(t.line);
        const res = doResolve(m[1]);
        if (!res.resolved) {
          structural.push({ reason: "unresolvable-enforcer", block: block.id, detail: res.error });
        }
      } else if (t.kind === "Deferred") {
        const m = DEFERRED_RE.exec(t.line);
        const edId = m[1];
        if (edId && (!ledgerIds || !ledgerIds.has(edId))) {
          structural.push({ reason: "missing-ed", block: block.id, ed: edId });
        }
      }
    }

    if (isCoreTagged) {
      const coreId = coreMatch[1];
      const entries = coreBlocks.get(coreId) || [];
      entries.push({
        block: block.id,
        trailerKind: coreTrailers.length === 1 ? "Core" : deferredTrailers.length === 1 ? "Deferred" : "Enforcer",
        hasEnforcer: enforcerTrailers.length >= 1,
        waivableFalse: WAIVABLE_FALSE_RE.test(blockText),
      });
      coreBlocks.set(coreId, entries);
    }
  }

  const registerResult = parsePolicyRegister(lines);
  if (registerResult.found) {
    const registerIds = new Set(registerResult.rows.map((r) => r.id));
    const actualIds = new Set(blocks.map((b) => b.id));

    for (const row of registerResult.rows) {
      if (!actualIds.has(row.id)) {
        structural.push({
          reason: "register-block-missing",
          block: row.id,
          detail: `${row.id} is enumerated in the §7 policy-block register but no matching '#### ${row.id} — ...' heading exists in the document`,
        });
      }
    }
    for (const block of blocks) {
      if (!registerIds.has(block.id)) {
        structural.push({
          reason: "register-drift",
          block: block.id,
          detail: `${block.id} exists in the document but is not enumerated in the §7 policy-block register`,
        });
      }
    }

    const registerRowCounts = new Map();
    for (const row of registerResult.rows) {
      registerRowCounts.set(row.id, (registerRowCounts.get(row.id) || 0) + 1);
    }
    for (const [id, count] of registerRowCounts.entries()) {
      if (count > 1) {
        structural.push({
          reason: "duplicate-register-row",
          block: id,
          count,
          detail: `${id} is listed ${count} times in the §7 policy-block register — an ambiguous/contradictory register entry`,
        });
      }
    }

    const bySection = new Map();
    for (const row of registerResult.rows) {
      const arr = bySection.get(row.section) || [];
      arr.push(row.index);
      bySection.set(row.section, arr);
    }
    for (const [section, indices] of bySection.entries()) {
      const sorted = [...new Set(indices)].sort((a, b) => a - b);
      for (let i = 0; i < sorted.length; i++) {
        const expected = i + 1;
        if (sorted[i] !== expected) {
          structural.push({
            reason: "register-gap",
            section: `§${section}`,
            expected: `P${section}.${expected}`,
            detail: `the §7 register has a numbering gap at P${section}.${expected} (next present entry is P${section}.${sorted[i]}) — a removed policy block leaves a hole in the sequence even when both its heading and its register row are deleted together`,
          });
          break;
        }
      }
    }
  }

  if (ledgerIds) {
    const cited = new Set(docText.match(ED_TOKEN_RE) || []);
    for (const edId of cited) {
      if (!ledgerIds.has(edId)) structural.push({ reason: "missing-ed", block: null, ed: edId });
    }
  }

  for (const coreId of REQUIRED_CORE_IDS) {
    const entries = coreBlocks.get(coreId);
    if (!entries || entries.length === 0) {
      policy.push({ reason: "core-incomplete", core: coreId });
      continue;
    }
    for (const entry of entries) {
      if (!entry.waivableFalse || entry.trailerKind !== "Core") {
        policy.push({ reason: "core-waived", core: coreId, block: entry.block, trailerKind: entry.trailerKind });
      } else if (!entry.hasEnforcer) {
        policy.push({ reason: "core-unenforced", core: coreId, block: entry.block });
      }
    }
  }

  if (!manifestError && !(fixtureCount > 0)) {
    policy.push({ reason: "fixture-count-zero", fixtureCount: fixtureCount || 0 });
  }

  if (!docText.includes(H1_SENTENCE)) {
    policy.push({ reason: "dod-sentence-missing" });
  }

  return finalize(structural, policy);
}

function finalize(structural, policy) {
  let exitCode = 0;
  if (structural.length > 0) exitCode = 2;
  else if (policy.length > 0) exitCode = 1;
  return { ok: exitCode === 0, exitCode, structural, policy };
}

function run(opts) {
  opts = opts || {};
  const docPath = opts.docPath || DEFAULT_DOC;
  const ledgerPath = opts.ledgerPath || DEFAULT_LEDGER;
  const manifestPath = opts.manifestPath || DEFAULT_MANIFEST;
  const rootDir = opts.rootDir || ROOT;

  let docText = "";
  try {
    docText = fs.readFileSync(docPath, "utf8");
  } catch {
    docText = "";
  }

  let ledgerIds = null;
  let ledgerError = null;
  try {
    ledgerIds = parseLedgerIds(fs.readFileSync(ledgerPath, "utf8"));
  } catch (e) {
    ledgerError = (e && e.message) || String(e);
  }

  let fixtureCount;
  let manifestError = null;
  try {
    let raw;
    try {
      raw = fs.readFileSync(manifestPath, "utf8");
    } catch (e) {
      const err = new Error(`manifest unreadable: ${(e && e.message) || e}`);
      err.code = "MANIFEST_READ_ERROR";
      throw err;
    }
    let manifest;
    try {
      manifest = JSON.parse(raw);
    } catch (e) {
      const err = new Error(`manifest is not valid JSON: ${(e && e.message) || e}`);
      err.code = "MANIFEST_PARSE_ERROR";
      throw err;
    }
    if (!manifest || typeof manifest !== "object" || typeof manifest.count !== "number") {
      const err = new Error(`manifest missing/invalid 'count' field`);
      err.code = "MANIFEST_SHAPE_ERROR";
      throw err;
    }
    fixtureCount = manifest.count;
  } catch (e) {
    fixtureCount = undefined;
    manifestError = (e && e.message) || String(e);
  }

  return evaluate({ docText, ledgerIds, ledgerError, fixtureCount, manifestError, rootDir });
}

module.exports = { evaluate, run, findBlocks, resolveEnforcer, parseLedgerIds, parsePolicyRegister, H1_SENTENCE };

if (require.main === module) {
  const JSON_OUT = process.argv.includes("--json");
  const argPath = process.argv.slice(2).find((a) => !a.startsWith("--"));
  let res;
  try {
    res = run(argPath ? { docPath: path.resolve(argPath) } : {});
  } catch (e) {
    const msg = (e && e.message) || e;
    if (JSON_OUT) console.log(JSON.stringify({ ok: false, error: String(msg) }));
    else console.error(`[${NAME}] runner error (fail-closed): ${msg}`);
    process.exit(2);
  }
  if (JSON_OUT) {
    console.log(JSON.stringify({ check: NAME, ...res }));
  } else if (res.ok) {
    console.log(`OK   [${NAME}] contract lints clean (0 structural, 0 policy issues)`);
  } else {
    const verb = res.exitCode === 2 ? "FAIL-CLOSED" : "FAIL";
    console.error(
      `${verb} [${NAME}] ${res.structural.length} structural, ${res.policy.length} policy issue(s):`,
    );
    for (const s of res.structural) console.error(`  - [structural] ${JSON.stringify(s)}`);
    for (const p of res.policy) console.error(`  - [policy] ${JSON.stringify(p)}`);
  }
  process.exit(res.exitCode);
}
