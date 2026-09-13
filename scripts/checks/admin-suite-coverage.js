#!/usr/bin/env node
"use strict";

// scan:admin-suite-coverage — coverage + freshness enforcer for the admin:* dev-tooling
// suite (SP-20260614-002, AC-R5a). The admin sibling of scan:skill-hook-coverage: a STATIC
// (no events) self-detecting check over the admin skill <-> registry <-> keystone surface.
//
// THREE assertions (mirroring skill-hook-coverage's REVERSE/FORWARD shape):
//
//   (i)   SKILL RESOLUTION — each admin:* skill resolves via
//         `node scripts/dispatch-skill.js --resolve --skill admin:<name> --json` -> found:true.
//         (Tolerant: when a skill .md is absent in this worktree the row is SKIPPED-with-note,
//         so the gate is green post-build but pre-integration; the integrated tree must have
//         all four. A skill that resolves found:false when its file EXISTS is a hard finding.)
//
//   (ii)  REGISTRY — every `panels` row in framework/admin-panel-registry.json is well-formed
//         ({route, opener, description}) and its opener resolves to a REAL backing target:
//         a `node <script>` opener -> the script file must exist; a `/<ns>:<name>` opener ->
//         that skill must resolve. An orphan/phantom opener is a hard finding. (Tolerant: a
//         `node scripts/admin/*.js` opener whose script is absent in THIS worktree is
//         SKIPPED-with-note — preview.js is built by another builder in the parallel gauntlet.)
//
//   (iii) MC GUARD — scripts/admin/preview.js source contains the `refuseIfTargetIsMC`
//         assertion (the never-run-against-MC-itself precondition). (Tolerant: SKIPPED-with-
//         note when preview.js is absent in this worktree; a PRESENT preview.js missing the
//         guard is a hard finding.)
//
// fail-CLOSED: an unreadable/malformed registry -> exit 2 (a coverage check that errors must
// never read green). Any hard finding -> exit 1. Wired REPORT-ONLY into /scan:full.
//
// See .claude/commands/scan/admin-suite-coverage.md for the full spec.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const REGISTRY_FILE = path.join(ROOT, "framework", "admin-panel-registry.json");
const PREVIEW_JS = path.join(ROOT, "scripts", "admin", "preview.js");
const DISPATCH_SKILL = path.join(ROOT, "scripts", "dispatch-skill.js");
const COMMANDS_DIR = path.join(ROOT, ".claude", "commands");

// The four admin:* skills the suite must ship (AC-R5a).
const ADMIN_SKILLS = ["preview", "readiness", "guides", "seed"];

// The MC-refusal token preview.js must contain (AC-R5a iii).
const WARPOS_GUARD_TOKEN = "refuseIfTargetIsMC";

const JSON_OUT = process.argv.includes("--json");

// ── Skill resolution via dispatch-skill --resolve ──────────────────────────────

/**
 * Resolve a skill id ("admin:preview") via dispatch-skill.js --resolve.
 * Returns { found:boolean, fileExists:boolean, raw } — never throws.
 */
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
  // Infrastructure failure must NOT collapse into found:false — that false-greens a
  // broken resolver as "skill unresolved" (xprovider review MEDIUM #6). Surface it.
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

// stripJsComments — strip block + line comments so a call-ORDER check over a function
// body is not satisfied by a comment mention (xprovider review BLOCKER #4).
function stripJsComments(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

// ── Core compute (PURE given its inputs) ───────────────────────────────────────

/**
 * @param {object}  registry        parsed admin-panel-registry.json
 * @param {(id:string)=>object} resolve   skill resolver (inject for tests)
 * @param {(rel:string)=>boolean} exists  file-exists predicate over repo-relative paths
 * @param {(rel:string)=>string|null} read  file-read over repo-relative paths (null if absent)
 * @returns {{ findings:object[], skipped:object[], checked:number }}
 */
function evaluate({ registry, resolve, exists, read }) {
  const findings = [];
  const skipped = [];
  let checked = 0;

  // (i) SKILL RESOLUTION — each admin:* skill.
  for (const name of ADMIN_SKILLS) {
    const id = `admin:${name}`;
    const r = resolve(id);
    if (!r.fileExists) {
      skipped.push({ check: "skill_resolution", skill: id, reason: "skill .md absent in this worktree (built by another gauntlet lane)" });
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

  // (ii) REGISTRY rows — shape + opener resolution.
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
      // Resolve the opener to a real backing target. STRICT validation — the opener is
      // a command string; a loose prefix match false-greens injection like
      // `node preview.js && evil` (xprovider review BLOCKER #3). Reject any shell
      // metacharacter, then require the FULL string to match a known anchored form.
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
          // Tolerant for scripts/admin/* — built by the keystone lane in this gauntlet.
          if (rel.startsWith("scripts/admin/")) {
            skipped.push({ check: "opener_resolution", panel: key, reason: `opener script '${rel}' absent in this worktree (keystone lane)` });
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

  // (iii) MC GUARD — preview.js's run() must CALL refuseIfTargetIsMC BEFORE any
  // side-effecting seam. A bare token check false-greens a comment/dead-code mention
  // (xprovider review BLOCKER #4) — verify call ORDER on the comment-stripped run() body.
  const previewSrc = read("scripts/admin/preview.js");
  if (previewSrc == null) {
    skipped.push({ check: "mc_guard", reason: "scripts/admin/preview.js absent in this worktree (keystone lane)" });
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

// ── CLI ────────────────────────────────────────────────────────────────────────

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
    return 2; // fail-closed
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

module.exports = { evaluate, ADMIN_SKILLS, WARPOS_GUARD_TOKEN };
