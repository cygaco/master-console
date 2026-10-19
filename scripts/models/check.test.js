#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const CHECK = path.join(ROOT, "scripts", "models", "check.js");
const { PROVIDERS } = require(path.join(ROOT, "scripts", "dispatch", "catalog.js"));

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
  }
}

const DAY = 86_400_000;
function mkFixture({ ageDays, msAgo, deprecateId, lowGhostId, gaRetirementId }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-check-"));
  const ms = msAgo != null ? msAgo : ageDays != null ? ageDays * DAY : 3 * DAY;
  const fetched_at = new Date(Date.now() - ms).toISOString();
  const liveIds = (PROVIDERS.openai.models || []).map((m) => m.id);
  const snap = {
    fetched_at,
    deprecations: deprecateId ? [{ id: deprecateId, migrate_to: "gpt-6.1-sol" }] : [],
    ghost_watch: lowGhostId ? [{ id: lowGhostId, reason: "fixture", confidence: "low" }] : [],
    models: liveIds.map((id) => ({ id, status: id === gaRetirementId ? "GA (latest; retirement window opens soon)" : "current" })),
    newest_flagship: PROVIDERS.openai.defaultModel || "gpt-6.1-sol",
  };
  fs.writeFileSync(path.join(dir, "openai.json"), JSON.stringify(snap));
  return dir;
}

function run(dir) {
  try {
    const out = execFileSync("node", [CHECK, "--json", "--provider", "openai", "--research-dir", dir, "--no-tool-probe"], { encoding: "utf8" });
    return { code: 0, json: JSON.parse(out) };
  } catch (e) {
    return { code: e.status, json: JSON.parse(e.stdout) };
  }
}

test("honest age: --json snapshots[] always carries the vendor's age", () => {
  const dir = mkFixture({ ageDays: 3 });
  const { json } = run(dir);
  assert.ok(
    Array.isArray(json.snapshots) && json.snapshots.some((s) => s.provider === "openai" && s.ageDays === 3),
    `expected snapshots[] with openai ageDays=3, got: ${JSON.stringify(json.snapshots)}`,
  );
});

test("stale snapshot (20d > 14d) → staleness WARN", () => {
  const dir = mkFixture({ ageDays: 20 });
  const { json } = run(dir);
  assert.ok(
    json.findings.some((f) => f.level === "WARN" && /stale|old/i.test(f.message)),
    `expected a staleness WARN, got: ${JSON.stringify(json.findings)}`,
  );
});

test("fresh under the 14d threshold (10d) → no staleness WARN", () => {
  const dir = mkFixture({ ageDays: 10 });
  const { json } = run(dir);
  assert.ok(
    !json.findings.some((f) => /\bold\b|\bstale\b/i.test(f.message)),
    `expected no staleness WARN at 10d, got: ${JSON.stringify(json.findings)}`,
  );
});

test("deprecated catalog id → ERROR + exit 1", () => {
  const liveId = (PROVIDERS.openai.models || []).map((m) => m.id).find((id) => id !== PROVIDERS.openai.defaultModel) || PROVIDERS.openai.models[0].id;
  const dir = mkFixture({ ageDays: 3, deprecateId: liveId });
  const { code, json } = run(dir);
  assert.ok(
    json.findings.some((f) => f.level === "ERROR" && f.id === liveId),
    `expected an ERROR for ${liveId}, got: ${JSON.stringify(json.findings)}`,
  );
  assert.equal(code, 1, "a deprecated catalog id must exit 1");
});

test("a missing snapshot still appears in --json snapshots[] (status:missing)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-check-empty-"));
  const { json } = run(dir);
  assert.ok(
    Array.isArray(json.snapshots) &&
      json.snapshots.some((s) => s.provider === "openai" && s.status === "missing" && s.ageDays === null),
    `a missing snapshot must be in snapshots[]: ${JSON.stringify(json.snapshots)}`,
  );
});

test("staleness uses exact ms — 14d+1h old WARNs, 14d-1h old does not", () => {
  const over = run(mkFixture({ msAgo: 14 * DAY + 3_600_000 }));
  assert.ok(over.json.findings.some((f) => /stale|old/i.test(f.message)), "14d+1h old must WARN");
  const under = run(mkFixture({ msAgo: 14 * DAY - 3_600_000 }));
  assert.ok(!under.json.findings.some((f) => /stale|old/i.test(f.message)), "14d-1h old must NOT WARN");
});

test("a 'GA (… retirement window opens soon)' status is LIVE, not an ERROR", () => {
  const liveId = PROVIDERS.openai.models[0].id;
  const dir = mkFixture({ ageDays: 3, gaRetirementId: liveId });
  const { code, json } = run(dir);
  assert.ok(!json.findings.some((f) => f.level === "ERROR" && f.id === liveId), `GA-with-advisory must not ERROR: ${JSON.stringify(json.findings)}`);
  assert.equal(code, 0, "a GA model with a future-retirement advisory must not exit 1");
});

test("a ghost_watch id that models[] lists LIVE is a watch note, not an ERROR (gpt-6-sol class)", () => {
  const liveId = PROVIDERS.openai.models[0].id;
  const dir = mkFixture({ ageDays: 3 });
  const snap = JSON.parse(fs.readFileSync(path.join(dir, "openai.json"), "utf8"));
  snap.ghost_watch = [{ id: liveId, reason: "superseded; both ids appear in docs" }];
  fs.writeFileSync(path.join(dir, "openai.json"), JSON.stringify(snap));
  const { code, json } = run(dir);
  assert.ok(!json.findings.some((f) => f.level === "ERROR" && f.id === liveId), `live-in-models[] must beat a bare ghost note: ${JSON.stringify(json.findings)}`);
  assert.equal(code, 0);
});

test("a ghost_watch id ABSENT from models[] is still a hard ERROR (the real-ghost path is intact)", () => {
  const liveId = PROVIDERS.openai.models[0].id;
  const dir = mkFixture({ ageDays: 3 });
  const snap = JSON.parse(fs.readFileSync(path.join(dir, "openai.json"), "utf8"));
  snap.ghost_watch = [{ id: liveId, reason: "404" }];
  snap.models = snap.models.filter((m) => m.id !== liveId);
  fs.writeFileSync(path.join(dir, "openai.json"), JSON.stringify(snap));
  const { code, json } = run(dir);
  assert.ok(json.findings.some((f) => f.level === "ERROR" && f.id === liveId), "a real ghost must still ERROR");
  assert.equal(code, 1);
});

test("a LOW-confidence ghost_watch id → WARN (verify live), never a migrate-now ERROR", () => {
  const liveId = PROVIDERS.openai.models[0].id;
  const dir = mkFixture({ ageDays: 3, lowGhostId: liveId });
  const snap = JSON.parse(fs.readFileSync(path.join(dir, "openai.json"), "utf8"));
  snap.models = snap.models.filter((m) => m.id !== liveId);
  fs.writeFileSync(path.join(dir, "openai.json"), JSON.stringify(snap));
  const { code, json } = run(dir);
  assert.ok(json.findings.some((f) => f.level === "WARN" && f.id === liveId && /low confidence/i.test(f.message)), `expected a low-confidence WARN: ${JSON.stringify(json.findings)}`);
  assert.ok(!json.findings.some((f) => f.level === "ERROR" && f.id === liveId), "must not ERROR");
  assert.equal(code, 0);
});

test("apiId: a routing slug is audited by its vendor apiId (antigravity gemini-3.1-pro-high ↔ gemini-3.1-pro-preview)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-check-agy-"));
  const agy = PROVIDERS.antigravity.models;
  const slug = agy.find((m) => m.id === "gemini-3.1-pro-high");
  assert.ok(slug && slug.apiId === "gemini-3.1-pro-preview", "catalog must carry apiId on the agy slug");
  const snap = {
    fetched_at: new Date().toISOString(),
    deprecations: [],
    ghost_watch: [{ id: "gemini-3.1-pro-high", reason: "display-name slug", confidence: "low" }],
    models: agy.map((m) => ({ id: m.apiId || m.id, status: "GA" })),
    newest_flagship: slug.apiId,
  };
  fs.writeFileSync(path.join(dir, "gemini.json"), JSON.stringify(snap));
  let out, code = 0;
  try { out = execFileSync("node", [CHECK, "--json", "--provider", "antigravity", "--research-dir", dir, "--no-tool-probe"], { encoding: "utf8" }); }
  catch (e) { code = e.status; out = e.stdout; }
  const json = JSON.parse(out);
  assert.ok(!json.findings.some((f) => f.id === "gemini-3.1-pro-high" && f.level !== "INFO"), `slug resolved via apiId must be clean: ${JSON.stringify(json.findings)}`);
  assert.equal(code, 0);
});

test("codexBinaryLag: resolved 0.146.0 vs npm-global 0.160.0 (14 minors) → WARN; 0.158 (2 minors) → none; unknown → none", () => {
  const { codexBinaryLag, minorLag } = require(CHECK);
  const res = (chosenV, npmV) => ({ chosen: "C:/desk/codex.exe", chosen_version: chosenV, alternatives: [{ path: "C:/npm/codex.cmd", version: npmV, npm: true }] });
  assert.equal(minorLag("0.146.0", "0.160.0"), 14);
  assert.ok(/14 minor versions behind/.test(codexBinaryLag(res("0.146.0", "0.160.0")) || ""));
  assert.equal(codexBinaryLag(res("0.158.0", "0.160.0")), null);
  assert.equal(codexBinaryLag(res(null, "0.160.0")), null);
  assert.equal(codexBinaryLag({ chosen: "x", chosen_version: "0.146.0", alternatives: [] }), null);
});

test("codexFloorWarn: only-codex 0.146 with NO alternative → WARN; none → WARN; >=0.160 → null", () => {
  const { codexFloorWarn } = require(CHECK);
  const warn = codexFloorWarn({ chosen: "C:/desk/codex.exe", chosen_version: "0.146.0", alternatives: [] });
  assert.ok(/below the GPT-6 servability floor 0\.160\.0/.test(warn || ""), "alternatives:[] below floor must WARN");
  assert.ok(/no codex binary resolved/.test(codexFloorWarn(null) || ""));
  assert.equal(codexFloorWarn({ chosen: "x", chosen_version: "0.160.0", alternatives: [] }), null);
  assert.equal(codexFloorWarn({ chosen: "x", chosen_version: "0.161.2", alternatives: [] }), null);
  assert.ok(codexFloorWarn({ chosen: "x", chosen_version: "0.159.9", alternatives: [] }));
});

const runArgs = (args) => {
  try {
    return { code: 0, out: execFileSync("node", [CHECK, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (e) {
    return { code: e.status, out: String(e.stdout || "") + String(e.stderr || "") };
  }
};

test("a flag given another flag as its value is a usage error (exit 2)", () => {
  const r = runArgs(["--research-dir", "--json", "--no-tool-probe"]);
  assert.equal(r.code, 2, r.out);
  assert.ok(/missing value for --research-dir/.test(r.out), r.out);
});

test("--provider gemini (the research-file stem) scopes the run to the antigravity lane", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-check-agy-"));
  const r = runArgs(["--json", "--provider", "gemini", "--research-dir", dir, "--no-tool-probe"]);
  const json = JSON.parse(r.out);
  assert.deepEqual(json.snapshots.map((s) => s.provider), ["antigravity"], r.out);
});

test("the antigravity lane gets its newer-flagship INFO from gemini.json", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-check-agy-"));
  const ids = (PROVIDERS.antigravity.models || []).map((m) => m.apiId || m.id);
  fs.writeFileSync(path.join(dir, "gemini.json"), JSON.stringify({
    fetched_at: new Date(Date.now() - 3 * DAY).toISOString(),
    deprecations: [],
    ghost_watch: [],
    models: [...ids, "gemini-9-pro"].map((id) => ({ id, status: "current" })),
    newest_flagship: "gemini-9-pro",
  }));
  const r = runArgs(["--json", "--provider", "antigravity", "--research-dir", dir, "--no-tool-probe"]);
  const json = JSON.parse(r.out);
  assert.ok(json.findings.some((f) => f.provider === "antigravity" && f.level === "INFO" && /gemini-9-pro/.test(f.message)), r.out);
});

test("a ghost_watch entry's migration target reaches the ERROR", () => {
  const liveId = PROVIDERS.openai.models[0].id;
  const dir = mkFixture({ ageDays: 3 });
  const snap = JSON.parse(fs.readFileSync(path.join(dir, "openai.json"), "utf8"));
  snap.ghost_watch = [{ id: liveId, reason: "404", migrate_to: "gpt-target-x" }];
  snap.models = snap.models.filter((m) => m.id !== liveId);
  fs.writeFileSync(path.join(dir, "openai.json"), JSON.stringify(snap));
  const { json } = run(dir);
  assert.ok(json.findings.some((f) => f.level === "ERROR" && f.id === liveId && /migrate to gpt-target-x/.test(f.message)), JSON.stringify(json.findings));
});

if (failures.length) {
  process.stderr.write(`FAIL [models/check.test] ${failures.length} failure(s):\n${failures.map((f) => `  - ${f}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`OK   [models/check.test] ${passed} passed\n`);
