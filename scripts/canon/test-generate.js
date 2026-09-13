#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";
/**
 * scripts/canon/test-generate.js — fixture end-to-end + unit test for the canon
 * engine (SP-20260525-022 T7 / T-20260525-235). Verify-before-claim.
 *
 * E2E (CLI, --research off — no spend, CI-safe):
 *   1. generate.js against the fixture emits all 12 artifacts.
 *   2. validation passes (ok, no errors) with thin warnings expected.
 *   3. each of the 4 JSON artifacts JSON.parse()s.
 *
 * Units:
 *   - research.buildResearchQuerySet is bounded by max_queries + excludes docs
 *     outside the cap (EVOLUTION).
 *   - research.validateFindings rejects out-of-schema doc/field/root key and
 *     treats empty-sources findings as THIN (never merged).
 *   - research.mergeFindings appends a cited block only for sourced findings.
 *   - validate.validateArtifacts flags a missing section + product-name mismatch
 *     as ERRORS (the structural contract).
 *
 * Live integration (one real research:simple round) is gated behind
 * CANON_LIVE_RESEARCH=1 and SKIPPED by default — it incurs API spend and needs
 * the orchestrator (bootstrap:spinup canon phase), not this unit harness.
 *
 * Exit 0 = all pass, 1 = any failure.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "..", "..");
const GEN = path.join(REPO, "scripts", "canon", "generate.js");
const FIXTURE = path.join(REPO, "scripts", "canon", "fixtures", "acme-intent.md");
const research = require("./research");
const { validateArtifacts } = require("./validate");
const { NARRATIVE, STRUCTURED, render } = require("./generate");

let passed = 0;
let failed = 0;
function ok(name) {
  passed++;
  process.stdout.write(`  ok    ${name}\n`);
}
function fail(name, detail) {
  failed++;
  process.stdout.write(`  FAIL  ${name}\n`);
  if (detail) process.stdout.write(`        ${detail}\n`);
}

// ---------------------------------------------------------------- E2E (CLI)
function e2e() {
  process.stdout.write("\nE2E — generate.js against fixture (--research off)\n");
  if (!fs.existsSync(FIXTURE)) {
    fail("fixture present", `missing ${FIXTURE}`);
    return;
  }
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "canon-e2e-"));
  const r = spawnSync(
    process.execPath,
    [GEN, "--intent", FIXTURE, "--product", "Acme", "--research", "off", "--out", out, "--json"],
    { encoding: "utf8" },
  );
  if (r.status !== 0) {
    fail("exit 0", `status=${r.status} stderr=${r.stderr}`);
    fs.rmSync(out, { recursive: true, force: true });
    return;
  }
  ok("exit 0");

  let result;
  try {
    result = JSON.parse(r.stdout);
    ok("stdout is JSON");
  } catch (e) {
    fail("stdout is JSON", e.message);
    fs.rmSync(out, { recursive: true, force: true });
    return;
  }

  const expected = NARRATIVE.length + STRUCTURED.length; // 12 (8 MD + 4 JSON)
  const files = fs.readdirSync(out).filter((f) => !f.startsWith("."));
  if (files.length === expected) ok(`emitted ${expected} artifacts`);
  else fail(`emitted ${expected} artifacts`, `got ${files.length}: ${files.join(",")}`);

  // re-validate from disk
  const artifacts = {};
  for (const f of files) artifacts[f] = fs.readFileSync(path.join(out, f), "utf8");
  const v = validateArtifacts(artifacts);
  if (v.ok && v.errors.length === 0) ok("validation ok (no errors)");
  else fail("validation ok (no errors)", v.errors.join("; "));
  // WI-38: zero raw {{tokens}} in ANY emitted artifact (degrade guarantees it).
  const rawLeaks = Object.entries(artifacts)
    .filter(([, body]) => /\{\{\s*[a-zA-Z0-9_]+\s*\}\}/.test(body))
    .map(([f]) => f);
  if (rawLeaks.length === 0) ok("WI-38: zero raw {{tokens}} emitted");
  else fail("WI-38: zero raw {{tokens}}", `leaked in: ${rawLeaks.join(", ")}`);
  // The thin fixture's source-less fields are surfaced as `needs input:` markers
  // (the sanctioned signal), reported in v.thin — never a silent pass.
  if (v.thin.length > 0) ok("source-less fields surfaced as needs-input (reported in thin)");
  else fail("needs-input reported", "fixture is thin — expected needs-input markers in thin");
  // And the standing assertion script agrees on the emitted set.
  const assertScript = path.join(REPO, "scripts", "checks", "canon-no-unfilled-tokens.js");
  const ar = spawnSync(process.execPath, [assertScript, "--dir", out, "--json"], { encoding: "utf8" });
  if (ar.status === 0) ok("canon-no-unfilled-tokens assertion passes on emitted set");
  else fail("zero-token assertion passes", `status=${ar.status} ${ar.stderr || ar.stdout}`);

  // WI-39: canon-type-coverage passes on the emitted set (exit 0).
  const coverageScript = path.join(REPO, "scripts", "checks", "canon-type-coverage.js");
  const cr = spawnSync(process.execPath, [coverageScript, "--dir", out, "--json"], { encoding: "utf8" });
  if (cr.status === 0) ok("canon-type-coverage: all 12 types emitted (exit 0)");
  else fail("canon-type-coverage on emitted set", `status=${cr.status} ${cr.stderr || cr.stdout}`);

  // WI-39: canon-type-coverage passes with no --dir (template coverage only, exit 0).
  const crNoDir = spawnSync(process.execPath, [coverageScript, "--json"], { encoding: "utf8" });
  if (crNoDir.status === 0) ok("canon-type-coverage: all 12 templates present (no --dir, exit 0)");
  else fail("canon-type-coverage no-dir", `status=${crNoDir.status} ${crNoDir.stderr || crNoDir.stdout}`);

  // WI-39 negative: missing --dir that doesn't exist => exit 2.
  const crBadDir = spawnSync(
    process.execPath,
    [coverageScript, "--dir", path.join(os.tmpdir(), "canon-type-coverage-does-not-exist-" + Date.now()), "--json"],
    { encoding: "utf8" },
  );
  if (crBadDir.status === 2) ok("canon-type-coverage: missing --dir => exit 2");
  else fail("canon-type-coverage missing --dir => exit 2", `got exit ${crBadDir.status}`);

  // WI-39 negative: remove one required artifact => exit 1.
  const missingTestDir = fs.mkdtempSync(path.join(os.tmpdir(), "canon-missing-"));
  // Copy all artifacts except DATA_AND_ACCOUNTS.md
  for (const f of files) {
    if (f !== "DATA_AND_ACCOUNTS.md")
      fs.copyFileSync(path.join(out, f), path.join(missingTestDir, f));
  }
  const crMissing = spawnSync(
    process.execPath,
    [coverageScript, "--dir", missingTestDir, "--json"],
    { encoding: "utf8" },
  );
  if (crMissing.status === 1) ok("canon-type-coverage: missing required artifact => exit 1");
  else fail("canon-type-coverage missing artifact => exit 1", `got exit ${crMissing.status} ${crMissing.stderr || crMissing.stdout}`);
  fs.rmSync(missingTestDir, { recursive: true, force: true });

  // S-PF-02: DATA_AND_ACCOUNTS.md carries a parseable Tech Stack block. The
  // fixture declares all six values, so the stricter value check should pass too.
  const stackScript = path.join(REPO, "scripts", "checks", "canon-tech-stack.js");
  const sr = spawnSync(
    process.execPath,
    [stackScript, "--dir", out, "--strict-values", "--json"],
    { encoding: "utf8" },
  );
  if (sr.status === 0) ok("canon-tech-stack: DATA_AND_ACCOUNTS Tech Stack parses with declared values");
  else fail("canon-tech-stack strict", `status=${sr.status} ${sr.stderr || sr.stdout}`);

  // each JSON parses
  let jsonOk = true;
  for (const name of STRUCTURED) {
    try {
      JSON.parse(artifacts[`${name}.json`]);
    } catch (e) {
      jsonOk = false;
      fail(`${name}.json parses`, e.message);
    }
  }
  if (jsonOk) ok("all 4 JSON artifacts parse");

  fs.rmSync(out, { recursive: true, force: true });
}

// ---------------------------------------------------------------- units
function unitsResearch() {
  process.stdout.write("\nUNIT — research.js (the cap)\n");
  const capInfo = research.loadCapSchema();

  // query set bounded + excludes out-of-cap docs
  const qs = research.buildResearchQuerySet(
    ["USER_COHORTS", "GOLDEN_PATHS", "FAILURE_STATES", "EVOLUTION"],
    capInfo,
    "Acme",
  );
  if (qs.queries.length <= qs.max_queries) ok(`query set bounded (<= ${qs.max_queries})`);
  else fail("query set bounded", `got ${qs.queries.length}`);
  if (!qs.queries.some((q) => q.doc === "EVOLUTION"))
    ok("query set excludes out-of-cap doc (EVOLUTION)");
  else fail("query set excludes EVOLUTION", "EVOLUTION not in cap per_doc");

  // validateFindings — cap enforcement
  const findings = {
    per_doc: {
      USER_COHORTS: {
        findings: { cohort_evidence: "field teams dominate", BOGUS: "x" },
        sources: ["https://example.com"],
      },
      GOLDEN_PATHS: { findings: { common_user_flows: "capture->tag" }, sources: [] },
      NOT_A_DOC: { findings: {}, sources: [] },
    },
    junk_root: "y",
  };
  const vf = research.validateFindings(findings, capInfo);
  if (vf.valid.USER_COHORTS && !vf.valid.USER_COHORTS.findings.BOGUS)
    ok("out-of-schema field discarded, valid field kept");
  else fail("field rejection", JSON.stringify(vf.valid.USER_COHORTS));
  if (vf.thinDocs.includes("GOLDEN_PATHS") && !vf.valid.GOLDEN_PATHS)
    ok("empty-sources finding treated as THIN (not merged)");
  else fail("empty-sources THIN", JSON.stringify(vf.thinDocs));
  if (vf.rejected.some((x) => x.includes("NOT_A_DOC")) && vf.rejected.some((x) => x.includes("junk_root")))
    ok("out-of-schema doc + root key rejected");
  else fail("doc/root rejection", JSON.stringify(vf.rejected));

  // mergeFindings — cited block only for sourced
  const artifacts = {
    "USER_COHORTS.md": "# Acme — User Cohorts\n\n## Primary Audience\nx\n",
    "GOLDEN_PATHS.md": "# Acme — Golden Paths\n\n## Golden Path 1: y\n",
  };
  const m = research.mergeFindings(artifacts, vf.valid);
  if (m.merged.includes("USER_COHORTS") && /Research Signals/.test(artifacts["USER_COHORTS.md"]))
    ok("mergeFindings appends cited block for sourced finding");
  else fail("merge cited block", JSON.stringify(m));
  if (!/Research Signals/.test(artifacts["GOLDEN_PATHS.md"]))
    ok("mergeFindings skips unsourced (thin) doc");
  else fail("merge skips thin", "GOLDEN_PATHS got a block despite empty sources");
}

function unitsValidate() {
  process.stdout.write("\nUNIT — validate.js (structural contract)\n");
  // WI-38: a DEGRADED thin set (product_name filled, the rest -> `needs input:`
  // markers via render's degrade) is structurally valid AND raw-token-free.
  const good = {};
  for (const name of NARRATIVE) {
    const tmpl = fs.readFileSync(
      path.join(REPO, "_mc", "templates", "canonical", `${name}.md.tmpl`),
      "utf8",
    );
    good[`${name}.md`] = render(tmpl, { product_name: "Acme" }, { degrade: true });
  }
  for (const name of STRUCTURED) {
    const tmpl = fs.readFileSync(
      path.join(REPO, "_mc", "templates", "canonical", `${name}.json.tmpl`),
      "utf8",
    );
    good[`${name}.json`] = render(
      tmpl,
      { value_group_1_name: "values", phases: "[]", steps: "[]" },
      { degrade: true, jsonSafe: true },
    );
  }
  const vGood = validateArtifacts(good);
  if (vGood.ok) ok("degraded (needs-input) thin artifacts pass");
  else fail("degraded thin passes", vGood.errors.join("; "));
  if (vGood.thin.length > 0) ok("degraded fields reported in thin (needs-input)");
  else fail("degraded thin reported", "expected needs-input markers in thin");

  // WI-38: a RAW {{token}} surviving into output is now an ERROR (degrade bypassed).
  const rawLeak = {
    ...good,
    "CORE_BRIEF.md": good["CORE_BRIEF.md"].replace(
      "*needs input: vision*",
      "{{vision}}",
    ),
  };
  const vRaw = validateArtifacts(rawLeak);
  if (!vRaw.ok && vRaw.errors.some((e) => /raw unfilled token/.test(e)))
    ok("raw {{token}} -> ERROR (WI-38)");
  else fail("raw token error", JSON.stringify(vRaw.errors));

  // missing section -> ERROR
  const broken = { ...good, "CORE_BRIEF.md": "# Acme — Core Brief\n\n## One-Liner\nx\n" };
  const vBroken = validateArtifacts(broken);
  if (!vBroken.ok && vBroken.errors.some((e) => /missing required section/.test(e)))
    ok("missing section -> ERROR");
  else fail("missing section error", JSON.stringify(vBroken.errors));

  // product_name mismatch -> ERROR
  const mismatch = { ...good };
  mismatch["GLOSSARY.md"] = mismatch["GLOSSARY.md"].replace("# Acme —", "# Other —");
  const vMis = validateArtifacts(mismatch);
  if (!vMis.ok && vMis.errors.some((e) => /product_name mismatch/.test(e)))
    ok("product_name mismatch -> ERROR");
  else fail("product mismatch error", JSON.stringify(vMis.errors));
}

function liveResearch() {
  if (process.env.CANON_LIVE_RESEARCH !== "1") {
    process.stdout.write(
      "\nLIVE — research:simple round SKIPPED (set CANON_LIVE_RESEARCH=1 to run; incurs API spend)\n",
    );
    return;
  }
  process.stdout.write(
    "\nLIVE — research bridge is orchestrator-driven (bootstrap:spinup canon phase); not runnable from this unit harness.\n",
  );
}

e2e();
unitsResearch();
unitsValidate();
liveResearch();

process.stdout.write(`\ncanon test: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
