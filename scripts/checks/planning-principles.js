#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");

const NAME = "planning-principles";

function labelForm(term) {
  const t = `(?:${term})`;
  return new RegExp(
    String.raw`(?:^|\n)\s{0,3}#{1,6}\s+(?:[-*\d.)\s]*)?` + t + String.raw`\b` +
      "|" +
      String.raw`(?:\*\*|__)\s*` + t + String.raw`\b[^\n*_]*(?:\*\*|__)` +
      "|" +
      String.raw`(?:^|\n)\s{0,3}(?:[-*+]\s+(?:\[[ xX]\]\s+)?)?(?:\*\*|__)?` + t +
      String.raw`(?:\*\*|__)?\s*:`,
    "i",
  );
}

const REQUIRED_SECTIONS = [
  {
    key: "enforcer",
    label: "named enforcer",
    enforce: labelForm("enforcer"),
    test: (text) => labelForm("enforcer").test(text) || /\benforced\s+by\b/i.test(text),
  },
  {
    key: "proof",
    label: "proof / acceptance",
    test: (text) =>
      labelForm("proof|required[-\\s]?proof|acceptance(?:\\s+criteria)?").test(text) ||
      /\bverified[_\s-]?by\b/i.test(text),
  },
  {
    key: "blast-radius",
    label: "blast-radius assessment",
    test: (text) => labelForm("blast[-\\s]?radius").test(text),
  },
];

function parseArgs(argv) {
  const out = {
    json: false,
    includePlans: false,
    includeSprints: false,
    includeRoot: false,
    enforce: false,
    planningDir: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") out.json = true;
    else if (a === "--include-plans") out.includePlans = true;
    else if (a === "--include-sprints") out.includeSprints = true;
    else if (a === "--include-root") out.includeRoot = true;
    else if (a === "--enforce") out.enforce = true;
    else if (a === "--all") {
      out.includePlans = true;
      out.includeSprints = true;
      out.includeRoot = true;
    } else if (a === "--planning-dir") out.planningDir = String(argv[++i] || "");
  }
  return out;
}

function collectPlanDocs(dir, notices, enforce) {
  const docs = [];
  let entries;
  try {
    if (!fs.existsSync(dir)) return docs;
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    if (enforce) throw e;
    notices.push(`could not read dir ${dir} (fail-open): ${String(e.message || e)}`);
    return docs;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    let isDir = false;
    let isFile = false;
    try {
      isDir = ent.isDirectory();
      isFile = ent.isFile();
    } catch {
      continue;
    }
    if (isDir) {
      docs.push(...collectPlanDocs(full, notices, enforce));
    } else if (isFile) {
      if (ent.name === "README.md") continue;
      if (ent.name.startsWith(".")) continue;
      if (/\.md$/i.test(ent.name)) docs.push(full);
    }
  }
  return docs;
}

function collectRootPlanDocs(dir, notices, enforce) {
  const docs = [];
  let entries;
  try {
    if (!fs.existsSync(dir)) return docs;
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    if (enforce) throw e;
    notices.push(`could not read dir ${dir} (fail-open): ${String(e.message || e)}`);
    return docs;
  }
  for (const ent of entries) {
    let isFile = false;
    try {
      isFile = ent.isFile();
    } catch {
      continue;
    }
    if (!isFile) continue;
    if (ent.name === "README.md") continue;
    if (ent.name.startsWith(".")) continue;
    if (/\.md$/i.test(ent.name)) docs.push(path.join(dir, ent.name));
  }
  return docs;
}

function scanPlanningPrinciples(opts = {}) {
  const root = opts.root || process.cwd();
  const planningDir = opts.planningDir
    ? path.resolve(opts.planningDir)
    : path.join(root, "_planning");

  const result = {
    check: NAME,
    reportOnly: true,
    scannedDirs: [],
    counts: { docs: 0, gaps: 0 },
    findings: [],
    notices: [],
  };

  const dirs = [path.join(planningDir, "epics")];
  if (opts.includePlans) dirs.push(path.join(planningDir, "plans"));
  if (opts.includeSprints) dirs.push(path.join(planningDir, "sprints"));

  let docs = [];
  for (const d of dirs) {
    result.scannedDirs.push(d);
    docs = docs.concat(collectPlanDocs(d, result.notices, opts.enforce));
  }
  if (opts.includeRoot) {
    result.scannedDirs.push(planningDir);
    docs = docs.concat(collectRootPlanDocs(planningDir, result.notices, opts.enforce));
  }
  result.counts.docs = docs.length;

  for (const file of docs) {
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch (e) {
      if (opts.enforce) throw e;
      result.notices.push(`could not read ${file} (fail-open): ${String(e.message || e)}`);
      continue;
    }
    const missing = REQUIRED_SECTIONS.filter((s) => {
      try {
        return !s.test(text);
      } catch (e) {
        if (opts.enforce) throw e;
        return false;
      }
    }).map((s) => s.label);
    if (missing.length) {
      result.findings.push({ file, missing });
    }
  }

  result.counts.gaps = result.findings.length;
  result.ok = result.counts.gaps === 0;
  return result;
}

function render(r) {
  const reportOnly = r.reportOnly !== false;
  const modeNote = reportOnly ? "report-only" : "ENFORCE (gaps exit non-zero)";
  const lines = [
    `/scan:${NAME} — ${r.counts.gaps ? "FINDINGS" : "OK"} (${modeNote})`,
    "",
  ];
  lines.push(`  scanned: ${r.scannedDirs.length} dir(s), ${r.counts.docs} plan doc(s)`);
  if (r.counts.gaps === 0) {
    lines.push("  result:  every scanned plan names an enforcer, proof/acceptance, and a blast-radius");
  } else {
    lines.push(
      `  result:  ${r.counts.gaps} plan doc(s) OMIT a principle-required section (${reportOnly ? "REPORT-ONLY — not blocking" : "ENFORCE — blocking"}):`,
    );
    for (const f of r.findings) {
      lines.push(`    ! ${f.file}`);
      lines.push(`        missing: ${f.missing.join("; ")}`);
    }
  }
  if (r.notices.length) {
    lines.push("", "  notices:");
    for (const n of r.notices) lines.push(`    - ${n}`);
  }
  return lines.join("\n");
}

module.exports = { scanPlanningPrinciples, render, parseArgs, REQUIRED_SECTIONS };

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  let r;
  try {
    r = scanPlanningPrinciples({
      includePlans: args.includePlans,
      includeSprints: args.includeSprints,
      includeRoot: args.includeRoot,
      planningDir: args.planningDir,
      enforce: args.enforce,
    });
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (args.enforce) {
      if (args.json) {
        process.stdout.write(
          JSON.stringify({ ok: false, check: NAME, reportOnly: false, enforce: true, failClosed: true, error: msg }) +
            "\n",
        );
      } else {
        process.stderr.write(`FAIL [${NAME}] internal error under --enforce — FAIL-CLOSED (exit 2): ${msg}\n`);
      }
      process.exit(2);
    }
    if (args.json) {
      process.stdout.write(
        JSON.stringify({ ok: true, check: NAME, reportOnly: true, note: `fail-open: ${msg}` }) + "\n",
      );
    } else {
      process.stdout.write(`OK   [${NAME}] fail-open — nothing scanned (${msg})\n`);
    }
    process.exit(0);
  }
  r.reportOnly = !args.enforce;
  r.enforce = Boolean(args.enforce);
  if (args.json) {
    process.stdout.write(JSON.stringify(r, null, 2) + "\n");
  } else {
    process.stdout.write(render(r) + "\n");
  }
  process.exit(r.reportOnly || r.ok ? 0 : 1);
}
