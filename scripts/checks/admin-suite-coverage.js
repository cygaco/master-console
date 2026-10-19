#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const REGISTRY_FILE = path.join(ROOT, "framework", "admin-panel-registry.json");
const PREVIEW_JS = path.join(ROOT, "scripts", "admin", "preview.js");
const DISPATCH_SKILL = path.join(ROOT, "scripts", "dispatch-skill.js");
const COMMANDS_DIR = path.join(ROOT, ".claude", "commands");

const ADMIN_SKILLS = ["preview", "readiness", "guides", "seed"];

const MC_GUARD_TOKEN = "refuseIfTargetIsMC";

const JSON_OUT = process.argv.includes("--json");

function resolveSkill(skillId) {
  const skillFile = path.join(COMMANDS_DIR, ...skillId.split(":").map(String)) + ".md";
  const fileExists = fs.existsSync(skillFile);
  if (!fs.existsSync(DISPATCH_SKILL)) {
    return { found: false, fileExists, raw: null, resolverMissing: true };
  }
  const res = spawnSync(
    process.execPath,
    [DISPATCH_SKILL, "--resolve", "--skill", skillId, "--json"],
    { cwd: ROOT, encoding: "utf8" },
  );
  if (res.error || res.status !== 0 || !String(res.stdout || "").trim()) {
    return {
      found: false, fileExists, raw: null,
      resolverError: {
        message: (res.error && res.error.message) || `resolver exited ${res.status}`,
        status: res.status,
        stderr: String(res.stderr || "").slice(0, 400),
      },
    };
  }
  let parsed = null;
  try {
    parsed = JSON.parse(String(res.stdout).trim());
  } catch (e) {
    return { found: false, fileExists, raw: null, resolverError: { message: `unparseable resolver JSON: ${e.message}` } };
  }
  return { found: !!(parsed && parsed.found), fileExists, raw: parsed };
}

function stripJsComments(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

function evaluate({ registry, resolve, exists, read }) {
  const findings = [];
  const skipped = [];
  let checked = 0;

  for (const name of ADMIN_SKILLS) {
    const id = `admin:${name}`;
    const r = resolve(id);
    if (!r.fileExists) {
      skipped.push({ check: "skill_resolution", skill: id, reason: "skill .md absent in this worktree" });
      continue;
    }
    checked++;
    if (r.resolverError) {
      findings.push({
        finding_type: "resolver_error",
        skill: id,
        evidence: `dispatch-skill resolver FAILED for '${id}' (NOT "unresolved"): ${r.resolverError.message}${r.resolverError.stderr ? ` | stderr: ${r.resolverError.stderr}` : ""}`,
      });
    } else if (!r.found) {
      findings.push({
        finding_type: "skill_unresolved",
        skill: id,
        evidence: `admin skill '${id}' has a command file but dispatch-skill --resolve returned found:false`,
      });
    }
  }

  const panels = registry && registry.panels;
  if (!panels || typeof panels !== "object") {
    findings.push({ finding_type: "registry_no_panels", evidence: "admin-panel-registry has no `panels` map" });
  } else {
    for (const [key, row] of Object.entries(panels)) {
      checked++;
      if (!row || typeof row !== "object" || typeof row.route !== "string" || typeof row.opener !== "string" || typeof row.description !== "string") {
        findings.push({
          finding_type: "malformed_panel_row",
          panel: key,
          evidence: `panel '${key}' must be { route, opener, description } (all strings)`,
        });
        continue;
      }
      const opener = row.opener.trim();
      if (/[&|;<>`$(){}\[\]\\"'*?~\n]/.test(opener)) {
        findings.push({
          finding_type: "unsafe_opener",
          panel: key,
          evidence: `panel '${key}' opener '${opener}' contains a shell metacharacter — openers must be a bare 'node scripts/admin/<file>.js [--route /admin/<sub>]' or '/ns:name'`,
        });
        continue;
      }
      const nodeMatch = opener.match(/^node\s+(scripts\/admin\/[a-z][a-z0-9-]*\.js)(?:\s+--route\s+\/admin(?:\/[a-z][a-z0-9-]*)?)?$/);
      const skillMatch = opener.match(/^\/?([a-z][a-z0-9-]*):([a-z][a-z0-9-]*)$/);
      if (nodeMatch) {
        const rel = nodeMatch[1];
        if (!exists(rel)) {
          if (rel.startsWith("scripts/admin/")) {
            skipped.push({ check: "opener_resolution", panel: key, reason: `opener script '${rel}' absent in this worktree` });
          } else {
            findings.push({
              finding_type: "orphan_opener",
              panel: key,
              evidence: `panel '${key}' opener references '${rel}' which does not exist`,
            });
          }
        }
      } else if (skillMatch) {
        const id = `${skillMatch[1]}:${skillMatch[2]}`;
        const r = resolve(id);
        if (!r.fileExists) {
          skipped.push({ check: "opener_resolution", panel: key, reason: `opener skill '${id}' absent in this worktree` });
        } else if (r.resolverError) {
          findings.push({ finding_type: "resolver_error", panel: key, evidence: `opener skill '${id}' resolver FAILED: ${r.resolverError.message}` });
        } else if (!r.found) {
          findings.push({
            finding_type: "orphan_opener",
            panel: key,
            evidence: `panel '${key}' opener skill '${id}' does not resolve (found:false)`,
          });
        }
      } else {
        findings.push({
          finding_type: "unrecognized_opener",
          panel: key,
          evidence: `panel '${key}' opener '${opener}' is not an anchored 'node scripts/admin/<file>.js [--route /admin/<sub>]' or '/ns:name' form`,
        });
      }
    }
  }

  const previewSrc = read("scripts/admin/preview.js");
  if (previewSrc == null) {
    skipped.push({ check: "mc_guard", reason: "scripts/admin/preview.js absent in this worktree" });
  } else {
    checked++;
    const body = (() => {
      const stripped = stripJsComments(previewSrc);
      const i = stripped.search(/(?:async\s+)?function\s+run\s*\(/);
      return i >= 0 ? stripped.slice(i) : "";
    })();
    const guardCall = body.search(/refuseIfTargetIsMC\s*\(/);
    const firstSeam = body.search(/\b(?:_?resolveOrScaffold|_?ensureDeps|_?startDevAndWaitReady|writePointer|_?openInBrowser)\s*\(/);
    if (guardCall < 0) {
      findings.push({
        finding_type: "missing_mc_guard",
        evidence: `scripts/admin/preview.js run() does not CALL refuseIfTargetIsMC(...) — token presence is insufficient`,
      });
    } else if (firstSeam >= 0 && guardCall > firstSeam) {
      findings.push({
        finding_type: "mc_guard_call_order",
        evidence: `scripts/admin/preview.js run() invokes a side-effecting seam BEFORE refuseIfTargetIsMC — the MC refusal must run first`,
      });
    }
  }

  return { findings, skipped, checked };
}

function loadRegistry() {
  const raw = fs.readFileSync(REGISTRY_FILE, "utf8");
  const reg = JSON.parse(raw);
  if (reg.$schema !== "mc/admin-panel-registry/v1") {
    throw new Error(`unexpected $schema: ${reg.$schema}`);
  }
  return reg;
}

function main() {
  let registry;
  try {
    registry = loadRegistry();
  } catch (e) {
    process.stderr.write(`ERROR [admin-suite-coverage] cannot read admin-panel-registry: ${e.message}\n`);
    return 2;
  }

  const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
  const read = (rel) => {
    const f = path.join(ROOT, rel);
    try {
      return fs.readFileSync(f, "utf8");
    } catch {
      return null;
    }
  };

  const { findings, skipped, checked } = evaluate({ registry, resolve: resolveSkill, exists, read });
  const ok = findings.length === 0;

  if (JSON_OUT) {
    console.log(JSON.stringify({ ok, checked, skipped: skipped.length, findings, skippedDetail: skipped }));
  } else if (ok) {
    const note = skipped.length ? ` (${skipped.length} skipped pending integration)` : "";
    console.log(`OK   [admin-suite-coverage] ${checked} checks passed, 0 findings${note}`);
  } else {
    process.stderr.write(`FAIL [admin-suite-coverage] ${findings.length} finding(s):\n`);
    for (const f of findings) process.stderr.write(`  - [${f.finding_type}] ${f.evidence}\n`);
    if (skipped.length) process.stderr.write(`  (${skipped.length} checks skipped pending integration)\n`);
  }
  return ok ? 0 : 1;
}

if (require.main === module) process.exit(main());

module.exports = { evaluate, ADMIN_SKILLS, MC_GUARD_TOKEN };
