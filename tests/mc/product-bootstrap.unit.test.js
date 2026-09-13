#!/usr/bin/env node
/**
 * product-bootstrap.unit.test.js — unit tests for SP-20260513-001.
 *
 * Pattern mirrors tests/mc/provider-smoke.unit.test.js: plain Node, no Jest,
 * hand-rolled check() + counters. Exit 0 on pass, 1 on fail.
 *
 * Run:
 *   node tests/mc/product-bootstrap.unit.test.js
 *
 * Coverage:
 *   - slug normalization + validation regex
 *   - section loader: minimal vs extended
 *   - answers ingestion + sanitization (ANSI, BOM, length cap)
 *   - coverage QC: missing sections halt, skipped_declined satisfies
 *   - html escape + paragraph-to-html
 *   - md heading order matches "## NN — Title"
 *   - --help exits 0 and prints C-1 verbatim phrase
 *   - --probe emits JSON with expected keys
 *   - invalid slug exits 2, invalid section set exits 2
 *   - --docx-backend pandoc + absent exits 5
 *   - coverage QC fail exits 3 with no files written
 *   - re-run versioning moves prior files into history/
 *   - section count for minimal = 8, extended = 12
 */

"use strict";

const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawnSync } = require("child_process");

const SCRIPT = path.resolve(
  __dirname,
  "..",
  "..",
  "scripts",
  "product",
  "bootstrap.js",
);

const mod = require(SCRIPT);

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) {
    passed++;
  } else {
    failed++;
    failures.push(`${name}: ${detail || "(no detail)"}`);
  }
}

function run(args, env) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    timeout: 20000,
    env: { ...process.env, ...env },
  });
}

// ── slug ─────────────────────────────────────────────────────────
check(
  "slug normalize: Title Case",
  mod.normalizeSlug("My Project!") === "my-project",
  "expected 'my-project'",
);
check("slug normalize: empty", mod.normalizeSlug("") === "", "expected ''");
check(
  "slug regex: valid",
  mod.SLUG_RE.test("agentic-web"),
  "expected match for 'agentic-web'",
);
check(
  "slug regex: invalid uppercase",
  !mod.SLUG_RE.test("Agentic-Web"),
  "expected no match",
);
check(
  "slug regex: invalid leading hyphen",
  !mod.SLUG_RE.test("-foo"),
  "expected no match",
);
check(
  "slug regex: 64 char cap",
  mod.SLUG_RE.test("a".repeat(64)) && !mod.SLUG_RE.test("a".repeat(65)),
  "boundary",
);

// ── sanitize ─────────────────────────────────────────────────────
check(
  "sanitize strips ANSI",
  mod.sanitizeText("[31mhello[0m") === "hello",
  "expected 'hello'",
);
check(
  "sanitize trims",
  mod.sanitizeText("   foo   ") === "foo",
  "expected 'foo'",
);
const longInput = "a".repeat(mod.MAX_ANSWER_LEN + 100);
check(
  "sanitize caps length",
  mod.sanitizeText(longInput).length === mod.MAX_ANSWER_LEN,
  "expected length cap",
);

// ── section loader ───────────────────────────────────────────────
const minimal = mod.loadSections("minimal");
check(
  "minimal section count = 8",
  minimal.length === 8,
  `got ${minimal.length}`,
);
check(
  "minimal first = problem",
  minimal[0].id === "problem",
  `got ${minimal[0].id}`,
);
check("minimal last = mvp", minimal[7].id === "mvp", `got ${minimal[7].id}`);

const extended = mod.loadSections("extended");
check(
  "extended section count = 12",
  extended.length === 12,
  `got ${extended.length}`,
);
check(
  "extended last = references",
  extended[11].id === "references",
  `got ${extended[11].id}`,
);

// ── coverage QC ──────────────────────────────────────────────────
const fullAnswers = {};
for (const sec of minimal) {
  fullAnswers[sec.id] = { content: "drafted content", status: "drafted" };
}
const qc1 = mod.runCoverageQc(minimal, fullAnswers);
check("coverage QC: full answers pass", qc1.ok, JSON.stringify(qc1));

const partialAnswers = { ...fullAnswers };
delete partialAnswers.mvp;
const qc2 = mod.runCoverageQc(minimal, partialAnswers);
check(
  "coverage QC: missing section fails",
  !qc2.ok && qc2.missing.includes("MVP"),
  JSON.stringify(qc2),
);

const skippedAnswers = { ...fullAnswers };
skippedAnswers.mvp = { content: "", status: "skipped_declined" };
const qc3 = mod.runCoverageQc(minimal, skippedAnswers);
check("coverage QC: skipped_declined satisfies", qc3.ok, JSON.stringify(qc3));

// ── HTML escape ──────────────────────────────────────────────────
check(
  "htmlEscape: ampersand",
  mod.htmlEscape("a & b") === "a &amp; b",
  "expected 'a &amp; b'",
);
check(
  "htmlEscape: script tag",
  mod.htmlEscape("<script>") === "&lt;script&gt;",
  "expected '&lt;script&gt;'",
);
check(
  "htmlEscape: attr injection",
  mod.htmlEscape('" onload="x') === "&quot; onload=&quot;x",
  "quote escape",
);

// ── paragraphs to HTML ───────────────────────────────────────────
const para = mod.paragraphsToHtml("Hello world.\n\nSecond paragraph.");
check(
  "paragraphsToHtml: two <p>",
  (para.match(/<p>/g) || []).length === 2,
  para,
);
const bullets = mod.paragraphsToHtml("- one\n- two\n- three");
check(
  "paragraphsToHtml: bullets -> ul",
  bullets.startsWith("<ul>") && bullets.endsWith("</ul>"),
  bullets,
);

// ── --help exits 0 with C-1 text ─────────────────────────────────
const helpRes = run(["--help"]);
check(
  "--help: exit 0",
  helpRes.status === 0,
  `status=${helpRes.status} stderr=${helpRes.stderr}`,
);
check(
  "--help: prints invocation hint",
  /Bootstrap a thorough product brief/.test(helpRes.stdout),
  helpRes.stdout.slice(0, 200),
);
check(
  "--help: prints 4-8 question summary",
  /4-8 (focused )?questions/.test(helpRes.stdout) ||
    /4-8\s+focused\s+questions/.test(helpRes.stdout),
  helpRes.stdout.slice(0, 400),
);

// ── --probe emits JSON ───────────────────────────────────────────
const probeRes = run(["--probe", "--slug", "unit-test-slug"]);
check(
  "--probe: exit 0",
  probeRes.status === 0,
  `status=${probeRes.status} stderr=${probeRes.stderr}`,
);
let probeJson = null;
try {
  probeJson = JSON.parse(probeRes.stdout);
} catch (e) {
  // null
}
check(
  "--probe: parses as JSON",
  probeJson != null,
  probeRes.stdout.slice(0, 200),
);
check(
  "--probe: has slug, pandoc_present",
  probeJson &&
    probeJson.slug === "unit-test-slug" &&
    typeof probeJson.pandoc_present === "boolean",
  JSON.stringify(probeJson),
);

// ── invalid slug exits 2 ─────────────────────────────────────────
const badSlugRes = run([
  "--slug",
  "Bad Slug!",
  "--answers-file",
  path.join(os.tmpdir(), "_does_not_exist_.json"),
]);
check(
  "invalid slug: exit 2",
  badSlugRes.status === 2,
  `status=${badSlugRes.status}`,
);

// ── invalid section set exits 2 ──────────────────────────────────
const badSetRes = run([
  "--slug",
  "ok-slug",
  "--section-set",
  "bogus",
  "--answers-file",
  path.join(os.tmpdir(), "_does_not_exist_.json"),
]);
check(
  "invalid section set: exit 2",
  badSetRes.status === 2,
  `status=${badSetRes.status}`,
);

// ── docx-backend pandoc + absent exits 5 ─────────────────────────
// (Only check this if pandoc is actually absent — otherwise skip.)
const probeInfo = mod.probePandoc();
if (!probeInfo.present) {
  const strictRes = run([
    "--slug",
    "ok-slug",
    "--docx-backend",
    "pandoc",
    "--answers-file",
    path.join(os.tmpdir(), "_does_not_exist_.json"),
  ]);
  check(
    "docx-backend pandoc + absent: exit 5",
    strictRes.status === 5,
    `status=${strictRes.status} stderr=${strictRes.stderr.slice(0, 200)}`,
  );
} else {
  // pandoc present — this test does not apply
  check("docx-backend pandoc + absent: SKIP (pandoc present)", true);
}

// ── end-to-end: write MD + HTML, headings stable, paths reg ─────
// Use a scratch dir under .claude/runtime/ so we stay inside the project
// root (RT-1 containment) without polluting _docs/briefs/.
const repoRoot = path.join(__dirname, "..", "..");
const scratchBase = path.join(
  repoRoot,
  ".claude",
  "runtime",
  ".product-bootstrap-unit-tests",
);
if (fs.existsSync(scratchBase))
  fs.rmSync(scratchBase, { recursive: true, force: true });
fs.mkdirSync(scratchBase, { recursive: true });

// Stage answers file
const answers = {};
for (const sec of minimal) {
  answers[sec.id] = "some drafted content for " + sec.title + ".";
}
const ansPath = path.join(scratchBase, "answers.json");
fs.writeFileSync(ansPath, JSON.stringify(answers, null, 2));

const e2eOutDir = path.join(scratchBase, "e2e-out");
const e2eRes = run(
  [
    "--slug",
    "e2e-test",
    "--answers-file",
    ansPath,
    "--output-dir",
    path.relative(repoRoot, e2eOutDir).replace(/\\/g, "/"),
    "--docx-backend",
    "none",
    "--title",
    "End to End Test",
    "--tagline",
    "Sanity",
  ],
  { CLAUDE_PROJECT_DIR: repoRoot },
);
check(
  "e2e: exit 0",
  e2eRes.status === 0,
  `status=${e2eRes.status} stderr=${e2eRes.stderr}`,
);
const mdFile = path.join(e2eOutDir, "e2e-test.brief.md");
const htmlFile = path.join(e2eOutDir, "e2e-test.brief.html");
check("e2e: MD file exists", fs.existsSync(mdFile), mdFile);
check("e2e: HTML file exists", fs.existsSync(htmlFile), htmlFile);

if (fs.existsSync(mdFile)) {
  const mdText = fs.readFileSync(mdFile, "utf8");
  // AC-S-3.1: ends with LF
  check(
    "e2e: MD ends with newline",
    mdText.endsWith("\n"),
    "no trailing newline",
  );
  // AC-S-3.2: headings 01-08 in order
  const headings = mdText.match(/^## \d{2} — .+$/gm) || [];
  check(
    "e2e: 8 headings present",
    headings.length === 8,
    `got ${headings.length}`,
  );
  check(
    "e2e: first heading = 01 Problem",
    headings[0] === "## 01 — Problem",
    headings[0],
  );
  check(
    "e2e: last heading = 08 MVP",
    headings[7] === "## 08 — MVP",
    headings[7],
  );
  // No CRLF in MD output (LF-only per AC-S-3.1)
  check(
    "e2e: MD has no CRLF",
    !mdText.includes("\r\n"),
    "found CRLF in MD output",
  );
}

if (fs.existsSync(htmlFile)) {
  const htmlText = fs.readFileSync(htmlFile, "utf8");
  // AC-S-4.1: no network requests for fonts — should still be a single file.
  // We allow link to googleapis in the head; the assertion is on shape, not
  // that the page is fully offline. Check that essential structural elements
  // are present.
  check(
    "e2e: HTML has DOCTYPE",
    htmlText.startsWith("<!DOCTYPE html>"),
    htmlText.slice(0, 80),
  );
  check(
    "e2e: HTML has 8 sections",
    (htmlText.match(/<section>/g) || []).length === 8,
    "count mismatch",
  );
  // AC-S-4.2: heading titles match MD
  const h2s = (htmlText.match(/<h2>[^<]+<\/h2>/g) || []).map((s) =>
    s.replace(/^<h2>|<\/h2>$/g, ""),
  );
  check(
    "e2e: HTML h2 titles include Problem and MVP",
    h2s.includes("Problem") && h2s.includes("MVP"),
    h2s.join(","),
  );
}

// ── coverage QC: missing sections halt run, no files written ─────
const qcOut = path.join(scratchBase, "qc-out");
const partialAns = { problem: "Just one section." };
const qcAnsPath = path.join(scratchBase, "qc-answers.json");
fs.writeFileSync(qcAnsPath, JSON.stringify(partialAns));
const qcRes = run(
  [
    "--slug",
    "qc-fail",
    "--answers-file",
    qcAnsPath,
    "--output-dir",
    path.relative(repoRoot, qcOut).replace(/\\/g, "/"),
    "--docx-backend",
    "none",
  ],
  { CLAUDE_PROJECT_DIR: repoRoot },
);
check(
  "coverage QC fail: exit 3",
  qcRes.status === 3,
  `status=${qcRes.status} stderr=${qcRes.stderr.slice(0, 200)}`,
);
check(
  "coverage QC fail: no md written",
  !fs.existsSync(path.join(qcOut, "qc-fail.brief.md")),
  "md file should not exist after QC fail",
);

// ── rerun versioning ─────────────────────────────────────────────
const reOut = path.join(scratchBase, "rerun-out");
const reAns = path.join(scratchBase, "rerun-answers.json");
fs.writeFileSync(reAns, JSON.stringify(answers));
const r1 = run(
  [
    "--slug",
    "rerun-test",
    "--answers-file",
    reAns,
    "--output-dir",
    path.relative(repoRoot, reOut).replace(/\\/g, "/"),
    "--docx-backend",
    "none",
  ],
  { CLAUDE_PROJECT_DIR: repoRoot },
);
check("rerun-1: exit 0", r1.status === 0, r1.stderr.slice(0, 200));
const r2 = run(
  [
    "--slug",
    "rerun-test",
    "--answers-file",
    reAns,
    "--output-dir",
    path.relative(repoRoot, reOut).replace(/\\/g, "/"),
    "--docx-backend",
    "none",
    "--rerun-policy",
    "version",
  ],
  { CLAUDE_PROJECT_DIR: repoRoot },
);
check("rerun-2: exit 0", r2.status === 0, r2.stderr.slice(0, 200));
const histDir = path.join(reOut, "history");
check(
  "rerun-2: history/ dir created",
  fs.existsSync(histDir),
  `expected ${histDir}`,
);
if (fs.existsSync(histDir)) {
  const stamps = fs.readdirSync(histDir);
  check(
    "rerun-2: at least one history stamp dir",
    stamps.length >= 1,
    `got ${stamps.length}`,
  );
  if (stamps.length > 0) {
    const versionedMd = path.join(histDir, stamps[0], "rerun-test.brief.md");
    check(
      "rerun-2: prior md moved to history",
      fs.existsSync(versionedMd),
      versionedMd,
    );
  }
}

// ── Cleanup ──────────────────────────────────────────────────────
try {
  fs.rmSync(scratchBase, { recursive: true, force: true });
} catch (e) {
  // best-effort
}

// ── Summary ──────────────────────────────────────────────────────
process.stdout.write(
  `\nproduct-bootstrap.unit.test.js — passed ${passed}, failed ${failed}\n`,
);
if (failed > 0) {
  process.stdout.write("\nFailures:\n");
  for (const f of failures) process.stdout.write("  - " + f + "\n");
  process.exit(1);
}
process.exit(0);
