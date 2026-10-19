#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const SCHEMA = "mc/golden-paths/v1";
const MIN_FEATURES = 6;
const DEFAULT_ROOT = path.resolve(__dirname, "..", "..");

function isRel(p) {
  return typeof p === "string" && p.length > 0 && !path.isAbsolute(p) && !/^[a-zA-Z]:/.test(p) &&
    !p.split(/[\\/]/).includes("..");
}

function oneSentence(s) {
  if (typeof s !== "string") return false;
  const t = s.trim();
  if (t.length < 10 || !/[.!?]$/.test(t)) return false;
  return !/[.!?]\s+\S/.test(t.replace(/\b(e\.g|i\.e|vs)\./gi, "$1"));
}

function validate(doc, opts = {}) {
  const exists = opts.exists || ((p) => fs.existsSync(path.join(opts.root || DEFAULT_ROOT, p)));
  const openEdIds = opts.openEdIds === undefined ? null : opts.openEdIds;
  const findings = [];
  const notes = [];
  const add = (code, detail, feature) => findings.push(feature ? { code, feature, detail } : { code, detail });

  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    add("schema_mismatch", "document is not an object");
    return { findings, notes, featureCount: 0 };
  }
  if (doc.schema !== SCHEMA) add("schema_mismatch", `schema is ${JSON.stringify(doc.schema)}, expected ${SCHEMA}`);

  const features = Array.isArray(doc.features) ? doc.features : [];
  if (!Array.isArray(doc.features)) add("feature_malformed", "features is not an array");
  if (features.length < MIN_FEATURES) add("too_few_features", `${features.length} features, need >= ${MIN_FEATURES}`);

  const seen = new Set();
  let ledgerNeeded = false;
  for (const [i, f] of features.entries()) {
    const id = f && typeof f.id === "string" && f.id ? f.id : `#${i}`;
    if (!f || typeof f !== "object" || typeof f.id !== "string" || !f.id || typeof f.name !== "string" || !f.name ||
        !Array.isArray(f.entry) || f.entry.length === 0 || !Array.isArray(f.smoke_tests) ||
        typeof f.security_surface !== "boolean") {
      add("feature_malformed", "needs id, name, non-empty entry[], smoke_tests[], boolean security_surface", id);
      continue;
    }
    if (seen.has(f.id)) add("duplicate_feature_id", "id appears twice", id);
    seen.add(f.id);
    if (!oneSentence(f.golden_path)) add("golden_path_not_sentence", `golden_path must be exactly one sentence: ${JSON.stringify(f.golden_path)}`, id);

    for (const [field, code] of [["entry", "entry_missing"], ["smoke_tests", "smoke_missing"]]) {
      for (const p of f[field]) {
        if (!isRel(p)) { add("path_unsafe", `${field}: ${JSON.stringify(p)}`, id); continue; }
        if (!exists(p)) add(code, p, id);
      }
    }

    if (f.smoke_tests.length === 0) {
      if (typeof f.enforcement_debt !== "string" || !/^ED-\d+$/.test(f.enforcement_debt)) {
        add("smoke_gap_undeclared", "empty smoke_tests needs an enforcement_debt ED id", id);
      } else {
        ledgerNeeded = true;
        if (openEdIds instanceof Set && !openEdIds.has(f.enforcement_debt)) {
          add("smoke_gap_ed_unknown", `${f.enforcement_debt} is not an open row in the enforcement-debt ledger`, id);
        }
      }
    }
  }
  if (ledgerNeeded && !(openEdIds instanceof Set)) {
    notes.push("ed_ledger_unavailable: empty-smoke ED rows NOT verified (check UNKNOWN, not pass)");
    if (opts.strictLedger) add("smoke_gap_ed_unknown", "enforcement-debt ledger unavailable under --strict-ledger");
  }

  const globs = doc.security_surface_globs;
  if (!Array.isArray(globs) || globs.length === 0 || globs.some((g) => typeof g !== "string" || !g || path.isAbsolute(g))) {
    add("globs_malformed", "security_surface_globs must be a non-empty array of relative glob strings");
  }
  return { findings, notes, featureCount: features.length };
}

function loadOpenEdIds(file) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch { return null; }
  const status = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    if (r && typeof r.id === "string" && typeof r.status === "string") status.set(r.id, r.status);
  }
  return new Set([...status].filter(([, s]) => s === "open").map(([id]) => id));
}

function main(argv) {
  const args = argv.slice(2);
  const val = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const root = path.resolve(val("--root") || DEFAULT_ROOT);
  let file = val("--file");
  const explicitFile = Boolean(file);
  if (!file) {
    try { file = require(path.join(root, "scripts", "hooks", "lib", "paths")).PATHS.goldenPaths; } catch { }
    file = file || path.join(root, "_planning", "golden-paths.json");
  }
  if (!explicitFile && !fs.existsSync(file)) {
    process.stdout.write("golden-paths-validate: SKIP no Golden Features glossary at paths.goldenPaths — nothing to validate\n");
    return 0;
  }
  let ledger = val("--ledger");
  if (!ledger) {
    try { ledger = require(path.join(root, "scripts", "hooks", "lib", "paths")).PATHS.enforcementDebt; } catch { }
  }
  let doc;
  try { doc = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (e) { process.stderr.write(`golden-paths-validate: cannot read/parse ${file}: ${e.message}\n`); return 2; }

  const res = validate(doc, {
    root, strictLedger: args.includes("--strict-ledger"),
    openEdIds: ledger ? loadOpenEdIds(ledger) : null,
  });
  if (args.includes("--json")) {
    process.stdout.write(JSON.stringify({ ok: res.findings.length === 0, ...res }, null, 2) + "\n");
  } else {
    for (const f of res.findings) process.stdout.write(`FAIL ${f.code}${f.feature ? ` [${f.feature}]` : ""}: ${f.detail}\n`);
    for (const n of res.notes) process.stdout.write(`NOTE ${n}\n`);
    process.stdout.write(`golden-paths-validate: ${res.findings.length === 0 ? "OK" : "FAIL"} (${res.featureCount} features, ${res.findings.length} findings)\n`);
  }
  return res.findings.length === 0 ? 0 : 1;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = { validate, loadOpenEdIds, oneSentence, SCHEMA, MIN_FEATURES };
