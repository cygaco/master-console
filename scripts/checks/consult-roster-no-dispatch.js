#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const NAME = "consult-roster-no-dispatch";

const CONSULT_STEPS = new Set(["plan", "design"]);
const DISPATCH_TOOLS = ["bash", "agent"];
const KNOWN_EXEMPTIONS = new Map([
  ["quality-lead", "dual-role pod-coordinator — design-consult is read-only; retains ONLY Agent for its sanctioned one-hop fan-out to leaf reviewers (bounded by the dispatch-route-guard in-process build-chain block)."],
]);

function readSpecTools(specRel) {
  const out = { tools: new Set(), determined: false, source: "none", specPath: specRel };
  if (!specRel) return out;
  const abs = path.isAbsolute(specRel) ? specRel : path.join(ROOT, specRel);
  let raw;
  try {
    raw = fs.readFileSync(abs, "utf8");
  } catch {
    return out;
  }
  const fm = raw.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  const txt = fm ? fm[1] : "";
  const addTokens = (s) => {
    for (const t of String(s).split(/[,\s]+/)) {
      const tok = t.trim().toLowerCase().replace(/[\[\]"'`]/g, "");
      if (tok && tok !== "-") out.tools.add(tok);
    }
  };
  let m = txt.match(/^tools:[ \t]*(\S.*)$/m);
  if (m && m[1].trim()) {
    out.source = "frontmatter-inline";
    out.determined = true;
    addTokens(m[1]);
    return out;
  }
  const block = txt.match(/^tools:[ \t]*\r?\n((?:[ \t]*-[ \t]*\S+[ \t]*\r?\n?)+)/m);
  if (block) {
    out.source = "frontmatter-block";
    out.determined = true;
    for (const line of block[1].split(/\r?\n/)) {
      const im = line.match(/^[ \t]*-[ \t]*(.+?)[ \t]*$/);
      if (im) addTokens(im[1]);
    }
    return out;
  }
  m = raw.match(/\(Tools:\s*([^)]+)\)/i);
  if (m) {
    out.source = "agents-list";
    out.determined = true;
    addTokens(m[1]);
    return out;
  }
  return out;
}

function evaluate(input) {
  const regDoc = (input && input.regDoc) || {};
  const hpDoc = (input && input.hpDoc) || {};
  const toolReader = (input && input.toolReader) || ((spec) => readSpecTools(spec));

  const roles = regDoc.roles || regDoc;
  const rows = hpDoc.attachments || hpDoc.rows || hpDoc.hook_points || (Array.isArray(hpDoc) ? hpDoc : []);

  const consultRoles = new Set();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r && r.role && CONSULT_STEPS.has(r.step)) consultRoles.add(r.role);
  }

  const violations = [];
  const exemptions = [];
  let scanned = 0;
  for (const roleId of consultRoles) {
    scanned++;
    const entry = roles[roleId];
    const spec = entry && entry.spec;
    const read = toolReader(spec, roleId);
    const tools = read instanceof Set ? read : (read && read.tools) || new Set();
    const determined = read instanceof Set ? true : !!(read && read.determined);

    if (!entry) {
      violations.push({ role: roleId, tools: ["<unknown-role>"], spec: "(absent from role-registry)", detail: `consult-summonable role '${roleId}' is at a plan/design hook-point but absent from role-registry.json — cannot confirm its tool-set; fail-closed.` });
      continue;
    }
    if (!determined) {
      violations.push({ role: roleId, tools: ["<unconfirmable>"], spec: spec || "(no spec in registry)", detail: `consult-summonable role '${roleId}' has no confirmable tools declaration (missing/unreadable spec, or an unparseable tools field at '${spec || "<none>"}') — cannot prove it carries no dispatch tool; fail-closed (a renamed/moved spec must not read green).` });
      continue;
    }

    const dispatchTools = DISPATCH_TOOLS.filter((t) => setHas(tools, t));
    if (dispatchTools.length === 0) continue;
    if (KNOWN_EXEMPTIONS.has(roleId)) {
      exemptions.push({ role: roleId, tools: dispatchTools, reason: KNOWN_EXEMPTIONS.get(roleId) });
    } else {
      violations.push({
        role: roleId,
        tools: dispatchTools,
        spec: spec || "(no spec in registry)",
        detail:
          `consult-summonable role '${roleId}' (at a plan/design hook-point) carries dispatch tool(s) ` +
          `[${dispatchTools.join(", ")}] — a summoned consult must NOT be able to dispatch the build ` +
          `chain or cascade (ADR-0014 spawn-hand-stays-with-conductor). Remove Bash/Agent from its spec, ` +
          `or (if it is a genuine dual-role pod-coordinator) add an explicit KNOWN_EXEMPTIONS entry + ED debt.`,
      });
    }
  }
  const knownOpenHoles = exemptions.length;
  return {
    ok: violations.length === 0 && knownOpenHoles === 0,
    cleanOfNewViolations: violations.length === 0,
    violations,
    exemptions,
    knownOpenHoles,
    scanned,
  };
}

function setHas(set, v) {
  const tokens = set instanceof Set ? [...set] : Array.isArray(set) ? set : [];
  for (const t of tokens) {
    const tok = String(t).toLowerCase();
    if (tok === v) return true;
    if (tok === "*") return true;
  }
  return false;
}

function run() {
  const reg = JSON.parse(fs.readFileSync(path.join(ROOT, ".claude/agents/_org/role-registry.json"), "utf8"));
  const hp = JSON.parse(fs.readFileSync(path.join(ROOT, ".claude/agents/_org/sprint-hook-points.json"), "utf8"));
  return evaluate({ regDoc: reg, hpDoc: hp });
}

module.exports = { evaluate, readSpecTools };

if (require.main === module) {
  const JSON_OUT = process.argv.includes("--json");
  const ENFORCE = process.argv.includes("--enforce");
  let res;
  try {
    res = run();
  } catch (e) {
    const msg = e && e.message ? e.message : e;
    if (JSON_OUT) console.log(JSON.stringify({ check: NAME, ok: false, error: String(msg) }));
    else console.error(`[${NAME}] runner error (fail-closed): ${msg}`);
    process.exit(2);
  }
  if (JSON_OUT) {
    console.log(JSON.stringify({ check: NAME, ...res, enforce: ENFORCE }));
  } else if (res.ok) {
    console.log(
      `OK   [${NAME}] no consult-summonable role carries a dispatch tool ` +
        `(${res.scanned} consult role(s) scanned; 0 known open holes)`,
    );
  } else {
    if (res.violations.length) {
      console.error(`FAIL [${NAME}] ${res.violations.length} NEW consult-summonable role(s) carry a dispatch tool (untracked cascade hole — must fix):`);
      for (const v of res.violations) console.error(`  - ${v.role} [${v.tools.join(", ")}] (${v.spec})\n      ${v.detail}`);
    }
    if (res.knownOpenHoles) {
      console.error(
        `RED  [${NAME}] ${res.knownOpenHoles} KNOWN OPEN HOLE(S) — the guarantee is INCOMPLETE (honest-RED, NOT green-with-exemption):`,
      );
      for (const ex of res.exemptions) console.error(`  ~ OPEN ${ex.role} [${ex.tools.join(", ")}] — ${ex.reason}`);
      console.error(
        `      Documented + tracked, NOT silently passed. ` +
          `The check does not assert that quality-lead's Agent use is limited to leaf reviewers. ` +
          `REPORT-ONLY here (informational RED, exit 0 — does not break /scan:full); '--enforce' flips it ` +
          `to exit 1 on this exemption too.`,
      );
    }
  }
  const hardFail = res.violations.length > 0 || (res.knownOpenHoles > 0 && ENFORCE);
  process.exit(hardFail ? 1 : 0);
}
