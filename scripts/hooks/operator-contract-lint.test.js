"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { inside } = require("../lib/hermetic-events-home");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const hermetic = require("../lib/hermetic-events-home").pin({ realRoot: ROOT, prefix: "mc-opx-lint-" });
const { lint, resolveInput, computeVerdict, exitCodeForVerdict, matchHeader } = require("./lib/operator-contract");
const FIXTURES_DIR = path.join(ROOT, "fixtures", "hooks", "operator-contract-lint");
const HOOK = path.join(__dirname, "operator-contract-lint.js");

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), "utf8"));
}

const FIXTURE_FILES = fs
  .readdirSync(FIXTURES_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort();

test("fixture directory has exactly the 30 numbered cases", () => {
  assert.strictEqual(FIXTURE_FILES.length, 30, FIXTURE_FILES.join(", "));
});

for (const file of FIXTURE_FILES) {
  test(`fixture ${file}: produces exactly its expected code multiset`, () => {
    const fixture = loadFixture(file);
    const resolved = resolveInput(fixture, { root: ROOT });
    let codes = [];
    if (!resolved.skip) {
      const result = lint(resolved.text, { strictness: "pedantic", detailRequested: resolved.detailRequested });
      codes = result.findings.map((f) => f.code);
    }
    assert.deepStrictEqual(codes.sort(), (fixture.expect || []).slice().sort(), JSON.stringify(fixture));
  });
}

test("fixture 15 is actually skipped (agent turn), not coincidentally clean", () => {
  const fixture = loadFixture("15-pass-skipped-agent-turn.json");
  const resolved = resolveInput(fixture, { root: ROOT });
  assert.strictEqual(resolved.skip, true);
  assert.strictEqual(resolved.reason, "agent-turn");
});

test("fixture 14's override comes from the transcript's last USER prompt, not luck", () => {
  const fixture = loadFixture("14-pass-detail-override.json");
  const resolved = resolveInput(fixture, { root: ROOT });
  assert.strictEqual(resolved.skip, false);
  assert.strictEqual(resolved.detailRequested, true);
  const withoutOverride = lint(resolved.text, { strictness: "pedantic", detailRequested: false });
  const codes = withoutOverride.findings.map((f) => f.code).sort();
  assert.deepStrictEqual(codes, ["RAW-IDENTIFIER", "REGISTER-OVERRUN"]);
});

test("matchHeader: canonical glyph+spacing+case is exact; any deviation is not", () => {
  assert.strictEqual(matchHeader("▶️ RUN THIS").exact, true);
  assert.strictEqual(matchHeader("▶ RUN THIS").exact, false);
  assert.strictEqual(matchHeader("▶️  RUN THIS").exact, false);
  assert.strictEqual(matchHeader("▶️ run this").exact, false);
  assert.strictEqual(matchHeader("⚠️ DECISION NEEDED").exact, true);
  assert.strictEqual(matchHeader("⚠ DECISION NEEDED").exact, false);
  assert.strictEqual(matchHeader("⛔ BLOCKED").exact, true);
  assert.strictEqual(matchHeader("📌 FYI").exact, true);
  assert.strictEqual(matchHeader("📌 FYI (detail requested)").exact, true);
  assert.strictEqual(matchHeader("just a normal line"), null);
});

test("computeVerdict: off never blocks or warns, regardless of findings", () => {
  assert.strictEqual(computeVerdict("off", true, true), "pass");
  assert.strictEqual(exitCodeForVerdict(computeVerdict("off", true, true)), 0);
});

test("computeVerdict: advisory warns on either class but never blocks", () => {
  assert.strictEqual(computeVerdict("advisory", true, false), "warn");
  assert.strictEqual(computeVerdict("advisory", false, true), "warn");
  assert.strictEqual(computeVerdict("advisory", false, false), "pass");
  assert.strictEqual(exitCodeForVerdict(computeVerdict("advisory", true, true)), 0);
});

test("computeVerdict: strict blocks structural, only warns on register-only (the shipped default)", () => {
  assert.strictEqual(computeVerdict("strict", true, false), "block");
  assert.strictEqual(computeVerdict("strict", true, true), "block");
  assert.strictEqual(computeVerdict("strict", false, true), "warn");
  assert.strictEqual(computeVerdict("strict", false, false), "pass");
  assert.strictEqual(exitCodeForVerdict(computeVerdict("strict", true, false)), 2);
  assert.strictEqual(exitCodeForVerdict(computeVerdict("strict", false, true)), 0);
});

test("computeVerdict: pedantic blocks on either class", () => {
  assert.strictEqual(computeVerdict("pedantic", true, false), "block");
  assert.strictEqual(computeVerdict("pedantic", false, true), "block");
  assert.strictEqual(exitCodeForVerdict(computeVerdict("pedantic", false, true)), 2);
});

function runHook({ stdin, env }) {
  return spawnSync(process.execPath, [HOOK], {
    cwd: ROOT,
    input: stdin === undefined ? "" : stdin,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: hermetic.home, ...env },
    timeout: 10000,
  });
}

test("GATE PROOF 1 — a hook-internal crash still exits 0 (fail-open)", () => {
  const brokenLibDir = path.join(ROOT, "runtime", "lean-build", "_opx-test-broken-lib");
  fs.mkdirSync(brokenLibDir, { recursive: true });
  const brokenHook = path.join(brokenLibDir, "operator-contract-lint-crash.js");
  const hookSrc = fs
    .readFileSync(HOOK, "utf8")
    .replace('require("./lib/project-config")', 'require("./lib/project-config-THIS-DOES-NOT-EXIST")');
  fs.writeFileSync(brokenHook, hookSrc);
  try {
    const r = spawnSync(process.execPath, [brokenHook], {
      cwd: ROOT,
      input: JSON.stringify({ hook_event_name: "Stop", last_assistant_message: "line one\nline two" }),
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: hermetic.home },
      timeout: 10000,
    });
    assert.strictEqual(r.status, 0, `expected fail-open exit 0, got ${r.status}: ${r.stderr}`);
  } finally {
    fs.rmSync(brokenLibDir, { recursive: true, force: true });
  }
});

test("GATE PROOF 1b — a throw inside main() outside every inner try still exits 0 and records a skip row with the error", () => {
  const marker = `opx-main-threw-${process.pid}-${Date.now()}`;
  const preloadDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-opx-preload-"));
  const preload = path.join(preloadDir, "throw-in-main.js");
  fs.writeFileSync(
    preload,
    `const pc = require(${JSON.stringify(path.join(__dirname, "lib", "project-config.js"))});\n` +
      `pc.getOperatorContract = () => ({ get enabled() { throw new Error(${JSON.stringify(marker)}); } });\n`,
  );
  try {
    const r = spawnSync(process.execPath, ["--require", preload, HOOK], {
      cwd: ROOT,
      input: JSON.stringify({ hook_event_name: "Stop", last_assistant_message: "line one\nline two" }),
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: hermetic.home },
      timeout: 10000,
    });
    assert.strictEqual(r.status, 0, `expected fail-open exit 0, got ${r.status}: ${r.stderr}`);
    const rows = fs.existsSync(hermetic.eventsFile)
      ? fs.readFileSync(hermetic.eventsFile, "utf8").split("\n").filter((l) => l.includes(marker))
      : [];
    assert.strictEqual(rows.length, 1, `exactly one telemetry row carries the thrown error; got ${rows.length}`);
    const row = JSON.parse(rows[0]);
    assert.strictEqual(row.data.type, "operator-contract-lint");
    assert.strictEqual(row.data.verdict, "skip");
    assert.strictEqual(row.data.reason, "main-threw");
    assert.ok(String(row.data.detail).includes(marker), JSON.stringify(row.data));
  } finally {
    fs.rmSync(preloadDir, { recursive: true, force: true });
  }
});

test("GATE PROOF 2 — malformed/empty stdin exits 0", () => {
  const r1 = runHook({ stdin: "{not json" });
  assert.strictEqual(r1.status, 0);
  const r2 = runHook({ stdin: "" });
  assert.strictEqual(r2.status, 0);
});

test("GATE PROOF 3 — kill-switch (MC_OPERATOR_CONTRACT=off) is a true no-op even on a blocking fixture", () => {
  const fixture = loadFixture("06-cmd-outside-run.json");
  const r = runHook({ stdin: JSON.stringify(fixture), env: { MC_OPERATOR_CONTRACT: "off" } });
  assert.strictEqual(r.status, 0);
  assert.strictEqual((r.stderr || "").includes("BLOCKED"), false);
});

test("GATE PROOF 4 — strictness table end-to-end on one real fixture: off=0, advisory=0, strict=2", () => {
  const fixture = loadFixture("06-cmd-outside-run.json");
  const payload = JSON.stringify(fixture);
  const off = runHook({ stdin: payload, env: { MC_OPERATOR_CONTRACT: "off" } });
  const advisory = runHook({ stdin: payload, env: { MC_OPERATOR_CONTRACT: "advisory" } });
  const strict = runHook({ stdin: payload, env: { MC_OPERATOR_CONTRACT: "strict" } });
  assert.strictEqual(off.status, 0, "off must never block");
  assert.strictEqual(advisory.status, 0, "advisory must never block");
  assert.strictEqual(strict.status, 2, "strict must block a structural finding");
  assert.ok(strict.stderr.includes("CMD-OUTSIDE-RUN"), strict.stderr);
});

test("HERMETIC — the hook's audit rows land in the temp project, never the real events log", () => {
  const realEvents = path.join(ROOT, ".claude", "project", "events", "events.jsonl");
  const r = runHook({
    stdin: JSON.stringify(loadFixture("06-cmd-outside-run.json")),
    env: { MC_OPERATOR_CONTRACT: "advisory" },
  });
  assert.strictEqual(r.status, 0);
  assert.ok(hermetic.home.startsWith(os.tmpdir()), hermetic.home);
  assert.ok(inside(hermetic.home, hermetic.eventsFile), hermetic.eventsFile);
  assert.ok(fs.existsSync(hermetic.eventsFile), "hook must have logged into the temp project's events file");
  const auditRows = fs.readFileSync(hermetic.eventsFile, "utf8").split("\n").filter((l) => l.includes("operator-contract-lint") && l.trim());
  assert.ok(auditRows.length > 0, "hook must have logged an operator-contract-lint row into the temp project");
  const realText = fs.existsSync(realEvents) ? fs.readFileSync(realEvents, "utf8") : "";
  for (const row of auditRows) assert.ok(!realText.includes(row), "the hook's own audit row must not appear in the real events log");
});

test("matchHeader: trailing text after an exact header stays exact; a wrong glyph does not", () => {
  assert.strictEqual(matchHeader("📌 FYI — what's left").exact, true);
  assert.strictEqual(matchHeader("⛔ BLOCKED: no network").exact, true);
  assert.strictEqual(matchHeader("⚠️ FYI — what's left").exact, false);
  assert.strictEqual(matchHeader("📌 FYIs for later"), null);
});

test("stop_hook_active short-circuits before any lint work, even on a blocking fixture", () => {
  const fixture = loadFixture("06-cmd-outside-run.json");
  const r = runHook({
    stdin: JSON.stringify({ ...fixture, stop_hook_active: true }),
    env: { MC_OPERATOR_CONTRACT: "strict" },
  });
  assert.strictEqual(r.status, 0);
});

test("budget: lint() over a 20 KB message completes in well under 100ms", () => {
  const big = Array.from({ length: 600 }, (_, i) => `Line ${i} of a long but ordinary status update.`).join("\n");
  const started = Date.now();
  lint(big, { strictness: "pedantic" });
  const ms = Date.now() - started;
  assert.ok(ms < 100, `took ${ms}ms`);
});
