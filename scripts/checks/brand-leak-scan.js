#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const SCHEMA_ID = "mc/readiness/v1";
const BRAND_TOKEN_RE = /mc/i;

function scaffoldDir() {
  const fallback = path.join(REPO_ROOT, "_mc", "templates", "app-scaffold");
  try {
    const reg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, ".claude", "paths.json"), "utf8"));
    return reg.appScaffoldTemplates ? path.join(REPO_ROOT, reg.appScaffoldTemplates) : fallback;
  } catch {
    return fallback;
  }
}

const PANEL_GLOB_DIR = "src/app/admin/readiness";
const GUIDE_CONTENT_DIR = "src/app/admin/guides/_content";
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

function visibleFromTsx(text) {
  let out = text;
  out = out.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
  out = out.replace(/^\s*import\s[^\n;]*;?$/gm, " ");
  out = out.replace(/^\s*export\s+(?:\*|\{[^}]*\})\s+from\s+["'][^"']+["'];?$/gm, " ");
  return out;
}

function visibleFromMd(text) {
  return text;
}

function evaluateBrandLeak(dir = scaffoldDir()) {
  const errors = [];
  const surfaces = [];

  try {
    fs.readdirSync(dir);
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

    const visibleNoSchema = visible.split(SCHEMA_ID).join("");
    if (BRAND_TOKEN_RE.test(visibleNoSchema)) {
      const line = firstMatchLine(visibleNoSchema, BRAND_TOKEN_RE);
      errors.push(`product-facing engine brand "MC" in visible surface: ${rel}${line}`);
    }

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
    process.stdout.write(`OK brand-leak: ${result.scanned} visible surface(s) clean — no product-facing "MC", schema id machine-layer only\n`);
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
