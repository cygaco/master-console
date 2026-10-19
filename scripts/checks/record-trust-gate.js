#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
function resolveDefaultManifest() {
  const sprintsDir = path.join(ROOT, ".claude", "project", "sprint", "sprints");
  try {
    const ptr = fs.readFileSync(path.join(ROOT, ".claude", "project", "sprint", "current-sprint.yaml"), "utf8");
    const m = ptr.match(/(?:^|\n)\s*(?:id|sprint)\s*:\s*["']?([A-Za-z0-9][A-Za-z0-9-]*)/);
    if (m) return path.join(sprintsDir, m[1], "record-trust-gate.manifest.json");
  } catch { }
  return path.join(sprintsDir, "__no-current-sprint__", "record-trust-gate.manifest.json");
}
const DEFAULT_MANIFEST = resolveDefaultManifest();

const VALID_SCOPES = Object.freeze(["same-session", "cross-session"]);

function filePart(ref) {
  return String(ref || "").split("#")[0].trim();
}

function loadManifest(manifestPath) {
  let text;
  try {
    text = fs.readFileSync(manifestPath, "utf8");
  } catch (e) {
    return { ok: false, error: `manifest unreadable: ${e.message}` };
  }
  let parsed;
  try {
    parsed = JSON.parse(text.replace(/^﻿/, ""));
  } catch (e) {
    return { ok: false, error: `manifest not valid JSON: ${e.message}` };
  }
  if (!parsed || !Array.isArray(parsed.surfaces)) {
    return { ok: false, error: "manifest missing 'surfaces' array (fail-closed)" };
  }
  return { ok: true, manifest: parsed };
}

function checkFalsifier(fixtureRel) {
  const abs = path.join(ROOT, fixtureRel);
  if (!fs.existsSync(abs)) return { ok: false, reason: "MISSING" };
  let body;
  try {
    body = fs.readFileSync(abs, "utf8");
  } catch (e) {
    return { ok: false, reason: `unreadable: ${e.message}` };
  }
  const hasMarker = /FALSIFIER:/.test(body);
  const hasMustBlock = /MUST-BLOCK/i.test(body);
  if (!hasMarker) return { ok: false, reason: "no `FALSIFIER:` marker (not a shaped falsifier)" };
  if (!hasMustBlock) return { ok: false, reason: "no `MUST-BLOCK` assertion token (fail-open shape)" };
  return { ok: true };
}

function extractVerifiedByRefs(prdText) {
  const found = new Set();
  const bare = new Set();
  const text = String(prdText || "");
  const blocks = text.split(/\n(?=-\s+\*\*AC)/);
  for (const block of blocks) {
    const vbMatch = block.match(/`verified_by:`([\s\S]*?)(?=\n\n|$)/);
    if (!vbMatch) continue;
    const vbText = vbMatch[1];

    const braceRe = /([\w./-]*)\{([^}]+)\}([\w./-]*\.(?:js|md))\b/g;
    let bm;
    while ((bm = braceRe.exec(vbText))) {
      const [, pre, alts, post] = bm;
      for (const alt of alts.split(",")) {
        const p = `${pre}${alt.trim()}${post}`;
        if (p.includes("/")) found.add(p);
        else bare.add(p);
      }
    }

    const scanText = vbText.replace(braceRe, (m) => " ".repeat(m.length));

    const plainRe = /\b([\w.-]+\/[\w./-]+\.(?:js|md))\b/g;
    let pm;
    while ((pm = plainRe.exec(scanText))) {
      found.add(pm[1]);
    }

    const bareRe = /(^|[\s`'"(,])([\w][\w.-]*\.(?:js|md))(?=$|[\s`'"),;])/g;
    let bmm;
    while ((bmm = bareRe.exec(scanText))) {
      bare.add(bmm[2]);
    }
  }
  const qualifiedBasenames = new Set(Array.from(found).map((p) => p.split("/").pop()));
  return { paths: Array.from(found), bare: Array.from(bare).filter((b) => !qualifiedBasenames.has(b)) };
}

const BARE_SCAN_ROOTS = ["scripts", ".claude", "framework", "docs"];
const BARE_SCAN_SKIP = new Set(["node_modules", ".git", "runtime", ".provider-tmp", ".worktrees"]);

function resolveBareRef(root, name) {
  const hits = [];
  for (const top of BARE_SCAN_ROOTS) {
    const start = path.join(root, top);
    if (!fs.existsSync(start)) continue;
    const stack = [start];
    while (stack.length) {
      const dir = stack.pop();
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const ent of entries) {
        if (BARE_SCAN_SKIP.has(ent.name)) continue;
        const abs = path.join(dir, ent.name);
        if (ent.isDirectory()) stack.push(abs);
        else if (ent.isFile() && ent.name === name) hits.push(path.relative(root, abs).split(path.sep).join("/"));
      }
    }
  }
  return hits;
}

function checkVerifiedByPaths(root, prdPath) {
  if (!fs.existsSync(prdPath)) return { ok: true, checked: 0, missing: [], bareChecked: 0, bareUnresolved: [], class_closer_enforced: true };
  let text;
  try {
    text = fs.readFileSync(prdPath, "utf8");
  } catch (e) {
    return { ok: false, checked: 0, missing: [], bareChecked: 0, bareUnresolved: [], class_closer_enforced: true, error: e.message };
  }
  const { paths, bare } = extractVerifiedByRefs(text);
  const missing = paths.filter((p) => !fs.existsSync(path.join(root, p)));
  const bareUnresolved = bare.filter((b) => resolveBareRef(root, b).length === 0);
  return {
    ok: missing.length === 0 && bareUnresolved.length === 0,
    checked: paths.length,
    missing,
    bareChecked: bare.length,
    bareUnresolved,
    class_closer_enforced: true,
  };
}

function evaluate(manifest, opts = {}) {
  const forbidden = (manifest.trust_anchor_forbidden_for_cross_session || []).map((s) =>
    String(s).toLowerCase(),
  );
  const violations = [];
  const surfacesChecked = [];

  for (const s of manifest.surfaces) {
    const id = s.id || "(unnamed surface)";
    surfacesChecked.push(id);

    if (!s.choke_point || !String(s.choke_point).trim())
      violations.push(`${id}: no choke_point named`);
    if (!s.structural_guard || !String(s.structural_guard).trim())
      violations.push(`${id}: no structural_guard named`);
    if (!VALID_SCOPES.includes(s.scope))
      violations.push(`${id}: scope ${JSON.stringify(s.scope)} not in [${VALID_SCOPES.join(", ")}]`);

    if (s.scope === "cross-session") {
      const anchor = String(s.trust_anchor || "").toLowerCase();
      const hit = forbidden.find((term) => anchor.includes(term));
      if (hit)
        violations.push(
          `${id}: CROSS-SESSION surface declares a per-session-HMAC trust_anchor ("${hit}") — that is the cross-session false-RED; use atomic-FS / content-addressed identity`,
        );
    }

    const fixtures = Array.isArray(s.falsifier_fixtures) ? s.falsifier_fixtures : [];
    for (const fx of fixtures) {
      const r = checkFalsifier(fx);
      if (!r.ok) violations.push(`${id}: falsifier ${fx} -> ${r.reason}`);
    }

    const companions = Array.isArray(s.positive_companions) ? s.positive_companions : [];
    for (const pc of companions) {
      if (!fs.existsSync(path.join(ROOT, pc)))
        violations.push(`${id}: positive_companion ${pc} -> MISSING (a reject-everything stub would false-green without it)`);
    }

    if (s.new_surface === true && fixtures.length === 0)
      violations.push(`${id}: NEW record-trust surface with ZERO falsifier fixtures (coverage gap)`);

    if (opts.built) {
      const cp = filePart(s.choke_point);
      if (cp && !fs.existsSync(path.join(ROOT, cp)))
        violations.push(`${id}: --built: choke_point module ${cp} does not exist (build did not wire it)`);
    }
  }

  if (opts.manifestPath) {
    const prdPath = path.join(path.dirname(opts.manifestPath), "prd.md");
    const vb = checkVerifiedByPaths(opts.root || ROOT, prdPath);
    if (!vb.ok) {
      for (const m of vb.missing) {
        violations.push(
          `verified_by dangling reference: ${m} (named in ${path.relative(opts.root || ROOT, prdPath)} but absent on disk)`,
        );
      }
      for (const b of vb.bareUnresolved) {
        violations.push(
          `verified_by dangling reference: ${b} (BARE filename named in ${path.relative(opts.root || ROOT, prdPath)} resolves to no file in the repo)`,
        );
      }
    }
  }

  return { ok: violations.length === 0, violations, surfacesChecked, class_closer_enforced: true };
}

function main(argv) {
  const json = argv.includes("--json");
  const built = argv.includes("--built");
  const mi = argv.indexOf("--manifest");
  const manifestPath = mi !== -1 && argv[mi + 1] ? path.resolve(argv[mi + 1]) : DEFAULT_MANIFEST;

  const loaded = loadManifest(manifestPath);
  if (!loaded.ok) {
    if (json) process.stdout.write(JSON.stringify({ ok: false, error: loaded.error }, null, 2) + "\n");
    else process.stderr.write(`record-trust-gate: ${loaded.error}\n`);
    return 2;
  }

  const res = evaluate(loaded.manifest, { built, manifestPath });
  if (json) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: res.ok,
          mode: built ? "built" : "design-exit",
          manifest: manifestPath,
          surfaces: res.surfacesChecked,
          violations: res.violations,
          class_closer_enforced: res.class_closer_enforced === true,
        },
        null,
        2,
      ) + "\n",
    );
  } else if (res.ok) {
    process.stdout.write(
      `record-trust-gate: PASS (${built ? "built" : "design-exit"}) — ${res.surfacesChecked.length} surfaces, all choke-points named, cross-session partition clean, falsifiers present+shaped.\n`,
    );
  } else {
    process.stdout.write(`record-trust-gate: BLOCK — ${res.violations.length} violation(s):\n`);
    for (const v of res.violations) process.stdout.write(`  - ${v}\n`);
  }
  return res.ok ? 0 : 1;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = {
  loadManifest,
  evaluate,
  checkFalsifier,
  filePart,
  extractVerifiedByRefs,
  resolveBareRef,
  checkVerifiedByPaths,
  DEFAULT_MANIFEST,
};
