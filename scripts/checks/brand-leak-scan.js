#!/usr/bin/env node
"use strict";

/**
 * /scan:brand-leak (S-PF-09a R-6 / AC-brand) — fail-closed enforcer for the
 * Master-Console branding boundary on the FIRST net-new product-facing surface
 * this epic ships: the founders in-app readiness panel + the in-app guide content.
 *
 * Rule (2026-09-02 ruling, E-OPEN-SOURCE-001 — supersedes project_masterconsole_branding_boundary):
 *   The engine and its UI share ONE public brand, Master Console; "formerly WarpOS" is
 *   allowed wherever history is referenced, and the engine's own docs (README, CHANGELOG,
 *   docs/PROVENANCE.md) are NOT in this scanner's scope. What this scanner still protects
 *   is the SCAFFOLDED PRODUCT's surface: a product built with the engine shows its OWN
 *   brand to its founder/users, so the engine's identifier ("warpos" — the pre-2.0.0
 *   slug; "mc" after S-OS-06) must not leak into that product's visible copy. The
 *   readiness `warpos/readiness/v1` schema id is allowed in the MACHINE layer (server-only
 *   constants, JSON payloads consumed by code) but must NEVER reach the visible DOM that
 *   a founder reads.
 *
 * What we scan (VISIBLE product-facing surface only):
 *   - the readiness panel templates:  src/app/admin/readiness/*.tsx.tmpl
 *   - the in-app guide content bodies: src/app/admin/guides/_content/*.md.tmpl
 *   - the guide viewer route:          src/app/admin/guides/[ref]/page.tsx.tmpl
 *
 * What FAILS:
 *   - the engine identifier "warpos" (any casing) anywhere in the scaffolded product's
 *     visible surface — it is the engine's slug, never the product's brand
 *   - the `warpos/readiness/v1` schema id appearing in VISIBLE DOM (JSX text /
 *     attribute values / markdown body) rather than staying server-only
 *
 * What is ALLOWED (machine layer, NOT a leak):
 *   - the schema id inside a server-only string constant / import path / comment
 *     in a non-visible module (we do not scan src/lib/** here — that is the machine
 *     layer by construction).
 *
 *   node scripts/checks/brand-leak-scan.js [--json] [--scaffold-dir <dir>]
 */

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const SCHEMA_ID = "warpos/readiness/v1";
// Product-facing engine-brand token. Case-insensitive; the boundary forbids any casing.
const BRAND_TOKEN_RE = /warpos/i;

function scaffoldDir() {
  const fallback = path.join(REPO_ROOT, "_warpos", "templates", "app-scaffold");
  try {
    const reg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, ".claude", "paths.json"), "utf8"));
    return reg.appScaffoldTemplates ? path.join(REPO_ROOT, reg.appScaffoldTemplates) : fallback;
  } catch {
    return fallback;
  }
}

// Visible product-facing surfaces, relative to the scaffold dir.
const PANEL_GLOB_DIR = "src/app/admin/readiness"; // *.tsx.tmpl
const GUIDE_CONTENT_DIR = "src/app/admin/guides/_content"; // *.md.tmpl
const GUIDE_VIEWER_ROUTE = "src/app/admin/guides/[ref]/page.tsx.tmpl";

function readIf(p) {
  try {
    return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
  } catch {
    return null;
  }
}

function listFiles(dir, suffix) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(suffix))
      .map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

/**
 * Strip the NON-visible layer of a .tsx file so we only test what reaches the DOM.
 * We remove JS/TS comments and import/export-from statements (machine wiring), AND
 * "use server" directives. What remains — JSX text, attribute values, string copy
 * that renders — is the visible surface. This is a conservative approximation: it
 * errs toward INCLUDING text in the visible set (fail-closed), never excluding it.
 */
function visibleFromTsx(text) {
  let out = text;
  // Drop block + line comments.
  out = out.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
  // Drop import / export-from statements (module wiring is machine layer).
  out = out.replace(/^\s*import\s[^\n;]*;?$/gm, " ");
  out = out.replace(/^\s*export\s+(?:\*|\{[^}]*\})\s+from\s+["'][^"']+["'];?$/gm, " ");
  return out;
}

/** Markdown guide bodies are 100% visible product-facing copy — scan as-is. */
function visibleFromMd(text) {
  return text;
}

function evaluateBrandLeak(dir = scaffoldDir()) {
  const errors = [];
  const surfaces = [];

  // FAIL-CLOSED (AC-brand / project_enforcer_falsegreen_gauntlet): the scan dir MUST exist and
  // be readable. Pointed at a missing/unreadable scaffold dir, a vacuous ok:true scanned:0 is the
  // exact false-green class WarpOS hardens against — a brand leak would pass undetected because
  // nothing was scanned. So a missing/unreadable scan dir is a hard FAIL, never a pass.
  try {
    fs.readdirSync(dir); // throws if the dir is missing or unreadable
  } catch (e) {
    return {
      ok: false,
      errors: [
        `scan dir missing or unreadable (fail-closed): ${dir} — refusing to pass vacuously (${e.code || e.message})`,
      ],
      dir,
      scanned: 0,
    };
  }

  for (const f of listFiles(path.join(dir, PANEL_GLOB_DIR), ".tsx.tmpl")) {
    surfaces.push({ file: f, kind: "tsx" });
  }
  for (const f of listFiles(path.join(dir, GUIDE_CONTENT_DIR), ".md.tmpl")) {
    surfaces.push({ file: f, kind: "md" });
  }
  if (fs.existsSync(path.join(dir, GUIDE_VIEWER_ROUTE))) {
    surfaces.push({ file: path.join(dir, GUIDE_VIEWER_ROUTE), kind: "tsx" });
  }

  // FAIL-CLOSED: the readiness panel + guide surfaces are EXPECTED present on any real scaffold.
  // scanned:0 means the dir exists but NONE of the product-facing surfaces were found (wrong dir,
  // a partial/half-shipped install, or a silently-relocated surface) — passing that vacuously is
  // the false-green we forbid. With zero surfaces there is nothing a leak could be caught in.
  if (surfaces.length === 0) {
    return {
      ok: false,
      errors: [
        `no product-facing surfaces found to scan under ${dir} (fail-closed): expected ` +
          `${PANEL_GLOB_DIR}/*.tsx.tmpl, ${GUIDE_CONTENT_DIR}/*.md.tmpl, or ${GUIDE_VIEWER_ROUTE} — ` +
          `refusing to pass with scanned:0`,
      ],
      dir,
      scanned: 0,
    };
  }

  for (const { file, kind } of surfaces) {
    const raw = readIf(file);
    if (raw === null) continue;
    const rel = path.relative(dir, file).replace(/\\/g, "/");
    const visible = kind === "md" ? visibleFromMd(raw) : visibleFromTsx(raw);

    // (1) Product-facing engine-brand "WarpOS" anywhere in the visible surface FAILS —
    //     UNLESS the only hit is the machine-layer schema id (handled separately below).
    //     Strip the schema id first so it is not double-reported as a generic brand hit.
    const visibleNoSchema = visible.split(SCHEMA_ID).join("");
    if (BRAND_TOKEN_RE.test(visibleNoSchema)) {
      const line = firstMatchLine(visibleNoSchema, BRAND_TOKEN_RE);
      errors.push(`product-facing engine brand "WarpOS" in visible surface: ${rel}${line}`);
    }

    // (2) The schema id must stay machine-layer — it must NOT appear in the visible DOM.
    if (visible.includes(SCHEMA_ID)) {
      const line = firstMatchLine(visible, new RegExp(SCHEMA_ID.replace(/[/]/g, "\\/")));
      errors.push(`machine-layer schema id "${SCHEMA_ID}" leaked into visible DOM: ${rel}${line}`);
    }
  }

  return { ok: errors.length === 0, errors, dir, scanned: surfaces.length };
}

function firstMatchLine(text, re) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) return ` (line ${i + 1}: ${lines[i].trim().slice(0, 80)})`;
  }
  return "";
}

function emit(json, result) {
  if (json) {
    process.stdout.write(JSON.stringify({ ok: result.ok, errors: result.errors, scanned: result.scanned }, null, 2) + "\n");
    return result.ok ? 0 : 1;
  }
  if (result.ok) {
    process.stdout.write(`OK brand-leak: ${result.scanned} visible surface(s) clean — no product-facing "WarpOS", schema id machine-layer only\n`);
    return 0;
  }
  process.stderr.write(`FAIL brand-leak (${result.errors.length}):\n${result.errors.map((e) => `  - ${e}`).join("\n")}\n`);
  return 1;
}

function main(argv) {
  const json = argv.includes("--json");
  const dirIdx = argv.indexOf("--scaffold-dir");
  const dir = dirIdx !== -1 && argv[dirIdx + 1] ? argv[dirIdx + 1] : scaffoldDir();
  try {
    return emit(json, evaluateBrandLeak(dir));
  } catch (e) {
    process.stderr.write(`brand-leak-scan error: ${e.message}\n`);
    return 2;
  }
}

if (require.main === module) {
  process.exit(main(process.argv));
}

module.exports = {
  SCHEMA_ID,
  BRAND_TOKEN_RE,
  PANEL_GLOB_DIR,
  GUIDE_CONTENT_DIR,
  GUIDE_VIEWER_ROUTE,
  visibleFromTsx,
  visibleFromMd,
  evaluateBrandLeak,
};
