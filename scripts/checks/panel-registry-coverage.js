#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_REGISTRY_FILE = path.join(ROOT, "framework", "panel-registry.json");
const DISPATCH_SKILL = path.join(ROOT, "scripts", "dispatch-skill.js");

const EXPECTED_SCHEMA = "mc/panel-registry/v1";

const RUN_CONTEXTS = new Set(["in_app", "cli"]);

const ROW_KEYS = ["name", "opener", "description", "run_context"];

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

const RECOGNIZED_FORMS = [
  {
    id: "node_script",
    test: (opener) => /^node\s+\S+$/.test(opener),
    resolve: (opener, ctx) => {
      const rel = opener.replace(/^node\s+/, "").trim();
      if (!/^scripts\/[A-Za-z0-9_\-./]+\.js$/.test(rel) || rel.includes("..")) {
        return {
          ok: false,
          finding_type: "unrecognized_opener",
          evidence: `node opener target '${rel}' is not a repo-relative 'scripts/.../<file>.js' path`,
        };
      }
      if (ctx.exists(rel)) return { ok: true };
      const lanePrefix = PARALLEL_LANE_PREFIXES.find((p) => rel.startsWith(p));
      if (lanePrefix && !ctx.laneDirExists(lanePrefix)) {
        return { skip: true, reason: `opener script '${rel}' absent and its lane directory '${lanePrefix}' does not exist yet (skipped with a note)` };
      }
      return {
        ok: false,
        finding_type: "orphan_opener",
        evidence: `opener references '${rel}' which does not exist on disk`,
      };
    },
  },
  {
    id: "skill",
    test: (opener) => /^\/?[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/.test(opener),
    resolve: (opener, ctx) => {
      const id = opener.replace(/^\//, "");
      const r = ctx.resolve(id);
      if (r.resolverError) {
        return {
          ok: false,
          finding_type: "resolver_error",
          evidence: `opener skill '${id}' resolver FAILED (NOT "unresolved"): ${r.resolverError.message}`,
        };
      }
      if (!r.found) {
        return {
          ok: false,
          finding_type: "orphan_opener",
          evidence: `opener skill '${id}' does not resolve (dispatch-skill --resolve returned found:false)`,
        };
      }
      return { ok: true };
    },
  },
];

const PARALLEL_LANE_PREFIXES = ["scripts/panel/", "scripts/admin/"];

const JSON_OUT = process.argv.includes("--json");

function resolveSkill(skillId) {
  if (!fs.existsSync(DISPATCH_SKILL)) {
    return { found: false, raw: null, resolverError: { message: "scripts/dispatch-skill.js missing" } };
  }
  const res = spawnSync(
    process.execPath,
    [DISPATCH_SKILL, "--resolve", "--skill", skillId, "--json"],
    { cwd: ROOT, encoding: "utf8" },
  );
  if (res.error || !String(res.stdout || "").trim()) {
    return {
      found: false,
      raw: null,
      resolverError: {
        message: (res.error && res.error.message) || `resolver produced no stdout (status ${res.status})`,
        status: res.status,
        stderr: String(res.stderr || "").slice(0, 400),
      },
    };
  }
  let parsed = null;
  try {
    parsed = JSON.parse(String(res.stdout).trim());
  } catch (e) {
    return { found: false, raw: null, resolverError: { message: `unparseable resolver JSON: ${e.message}` } };
  }
  return { found: !!(parsed && parsed.found), raw: parsed };
}

function evaluate({ registry, resolve, exists, laneDirExists: ctx_laneDirExists }) {
  const findings = [];
  const skipped = [];
  let checked = 0;

  const panels = registry && registry.panels;
  if (!isPlainObject(panels)) {
    findings.push({
      finding_type: "registry_no_panels",
      evidence: Array.isArray(panels)
        ? "panel-registry `panels` is an ARRAY — it must be a map object"
        : "panel-registry has no `panels` map",
    });
    return { findings, skipped, checked };
  }

  const laneDirExists = ctx_laneDirExists || ((prefix) => exists(prefix.replace(/\/$/, "")));
  const ctx = { resolve, exists, laneDirExists };

  for (const [key, row] of Object.entries(panels)) {
    checked++;

    if (!isPlainObject(row)) {
      findings.push({
        finding_type: "malformed_panel_row",
        panel: key,
        evidence: `panel '${key}' must be an object { name, opener, description, run_context }`,
      });
      continue;
    }
    const badKey = ROW_KEYS.find((k) => typeof row[k] !== "string" || row[k].trim() === "");
    if (badKey) {
      findings.push({
        finding_type: "malformed_panel_row",
        panel: key,
        evidence: `panel '${key}' must be { name, opener, description, run_context } (all non-empty strings) — '${badKey}' is missing/empty/non-string`,
      });
      continue;
    }
    const extraKeys = Object.keys(row).filter((k) => !ROW_KEYS.includes(k));
    if (extraKeys.length) {
      findings.push({
        finding_type: "extra_row_keys",
        panel: key,
        evidence: `panel '${key}' has unexpected key(s) [${extraKeys.join(", ")}] — the row shape is EXACTLY { name, opener, description, run_context } (no 'route'; run_context carries the in-app-vs-CLI distinction)`,
      });
      continue;
    }
    if (!RUN_CONTEXTS.has(row.run_context)) {
      findings.push({
        finding_type: "bad_run_context",
        panel: key,
        evidence: `panel '${key}' run_context '${row.run_context}' is not in { in_app, cli }`,
      });
      continue;
    }

    const opener = row.opener.trim();
    if (/[&|;<>`$(){}\[\]\\"'*?~\n]/.test(opener)) {
      findings.push({
        finding_type: "unsafe_opener",
        panel: key,
        evidence: `panel '${key}' opener '${opener}' contains a shell metacharacter — openers must be a bare 'node scripts/.../<file>.js' or '/ns:name'`,
      });
      continue;
    }
    const form = RECOGNIZED_FORMS.find((f) => f.test(opener));
    if (!form) {
      findings.push({
        finding_type: "unrecognized_opener",
        panel: key,
        evidence: `panel '${key}' opener '${opener}' matches no recognized form (node <script> | /ns:name)`,
      });
      continue;
    }
    const res = form.resolve(opener, ctx);
    if (res.skip) {
      skipped.push({ check: "opener_resolution", panel: key, reason: res.reason });
    } else if (!res.ok) {
      findings.push({ finding_type: res.finding_type, panel: key, evidence: `panel '${key}' ${res.evidence}` });
    }
  }

  return { findings, skipped, checked };
}

function loadRegistry(registryPath) {
  let raw;
  try {
    raw = fs.readFileSync(registryPath, "utf8");
  } catch (e) {
    return { ok: false, reason: `cannot read panel-registry (${e.code || e.message})` };
  }
  let reg;
  try {
    reg = JSON.parse(raw);
  } catch (e) {
    return { ok: false, reason: `panel-registry is not valid JSON: ${e.message}` };
  }
  if (!isPlainObject(reg)) {
    return { ok: false, reason: "panel-registry is not a JSON object (array/scalar/null)" };
  }
  if (reg.$schema !== EXPECTED_SCHEMA) {
    return { ok: false, reason: `unexpected $schema: ${JSON.stringify(reg.$schema)} (expected "${EXPECTED_SCHEMA}")` };
  }
  if (!isPlainObject(reg.panels)) {
    return {
      ok: false,
      reason: Array.isArray(reg.panels)
        ? "panel-registry `panels` is an ARRAY — it must be a map object"
        : "panel-registry has no `panels` object",
    };
  }
  return { ok: true, registry: reg };
}

function registryPathFromArgv(argv) {
  const i = argv.indexOf("--registry");
  if (i >= 0 && argv[i + 1]) return path.resolve(argv[i + 1]);
  return DEFAULT_REGISTRY_FILE;
}

function main(argv) {
  const registryPath = registryPathFromArgv(argv);

  const loaded = loadRegistry(registryPath);
  if (!loaded.ok) {
    if (JSON_OUT) {
      console.log(JSON.stringify({ ok: false, error: loaded.reason, violationCount: null, violations: [] }));
    } else {
      process.stderr.write(`ERROR [panel-registry-coverage] ${loaded.reason}\n`);
    }
    return 2;
  }

  const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
  const { findings, skipped, checked } = evaluate({ registry: loaded.registry, resolve: resolveSkill, exists });
  const ok = findings.length === 0;

  if (JSON_OUT) {
    console.log(JSON.stringify({ ok, violationCount: findings.length, violations: findings, checked, skipped: skipped.length, skippedDetail: skipped }));
  } else if (ok) {
    const note = skipped.length ? ` (${skipped.length} skipped pending integration)` : "";
    console.log(`OK   [panel-registry-coverage] ${checked} row(s) checked, 0 findings${note}`);
  } else {
    process.stderr.write(`FAIL [panel-registry-coverage] ${findings.length} finding(s):\n`);
    for (const f of findings) process.stderr.write(`  - [${f.finding_type}]${f.panel ? ` ${f.panel}:` : ""} ${f.evidence}\n`);
    if (skipped.length) process.stderr.write(`  (${skipped.length} row(s) skipped pending integration)\n`);
  }
  return ok ? 0 : 1;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = { evaluate, loadRegistry, resolveSkill, RECOGNIZED_FORMS, RUN_CONTEXTS, EXPECTED_SCHEMA, PARALLEL_LANE_PREFIXES, main };
