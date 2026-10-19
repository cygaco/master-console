#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");
const assert = require("assert");
const { createRunner, classifyError } = require("./deep-run");

let passed = 0;
let failed = 0;

function ok(label, cond, detail) {
  if (cond) {
    process.stdout.write("  PASS: " + label + "\n");
    passed++;
  } else {
    process.stderr.write("  FAIL: " + label + (detail ? " — " + detail : "") + "\n");
    failed++;
  }
}

function makeStubFetch(rules) {
  const callLog = [];
  async function stubFetch(url, opts) {
    callLog.push({ url, method: (opts && opts.method) || "GET" });
    for (const rule of rules) {
      const matches = typeof rule.match === "function"
        ? rule.match(url, opts)
        : url.includes(rule.match);
      if (!matches) continue;
      let entry;
      if (rule.seq && rule.seq.length > 0) {
        entry = rule.seq.shift();
      } else if (rule.default) {
        entry = rule.default;
      } else {
        entry = rule;
      }
      const { status, body } = entry;
      return {
        ok: status < 400,
        status,
        async json() { return JSON.parse(body); },
        async text() { return body; },
      };
    }
    throw new Error("No stub for URL: " + url + " — add a rule to the test");
  }
  stubFetch.callLog = callLog;
  return stubFetch;
}

const noSleep = async () => {};
const noSpawnSync = () => null;

function test1() {
  process.stdout.write("\nTest 1: --help exits 0\n");
  const result = cp.spawnSync(process.execPath, [
    path.join(__dirname, "deep-run.js"),
    "--help",
  ], { encoding: "utf8", timeout: 10000 });

  ok("exit code === 0", result.status === 0, "exit=" + result.status);
  ok("stdout contains USAGE", result.stdout.includes("USAGE"), result.stdout.slice(0, 100));
  ok("stdout contains --providers", result.stdout.includes("--providers"));
  ok("stdout contains PHASE 0 PROBE", result.stdout.includes("PHASE 0 PROBE"));
}

async function test2() {
  process.stdout.write("\nTest 2: Phase 0 insufficient_quota → provider skipped\n");

  const stub = makeStubFetch([
    {
      match: "chat/completions",
      status: 429,
      body: JSON.stringify({ error: { code: "insufficient_quota", message: "You exceeded your current quota, please check your plan and billing details." } }),
    },
  ]);

  const origKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "fake-test-openai-key-1234567890";
  let thrown = null;
  try {
    const runner = createRunner({ fetch: stub, sleep: noSleep, spawnSync: noSpawnSync });
    await runner.run("test question", {
      providers: ["openai"],
      skipPhase0: false,
    });
  } catch (e) {
    thrown = e;
  } finally {
    if (origKey !== undefined) process.env.OPENAI_API_KEY = origKey;
    else delete process.env.OPENAI_API_KEY;
  }

  ok("run() throws when all providers skipped", thrown !== null, thrown && thrown.message);
  ok("error mentions All providers skipped", thrown && thrown.message.includes("All providers skipped"), thrown && thrown.message);
  ok("error contains actionable billing message", thrown && thrown.message.includes("top up credits"), thrown && thrown.message);
  ok("probe endpoint was called", stub.callLog.some((c) => c.url.includes("chat/completions")));
}

function test2b() {
  process.stdout.write("\nTest 2b: classifyError unit tests\n");
  ok("200 → ok", classifyError(200, "{}") === "ok");
  ok("404 → model_unavailable", classifyError(404, "{}") === "model_unavailable");
  ok("401 → auth_failed", classifyError(401, "{}") === "auth_failed");
  ok("429 insufficient_quota → insufficient_quota",
    classifyError(429, JSON.stringify({ error: { code: "insufficient_quota" } })) === "insufficient_quota");
  ok("429 exceeded → insufficient_quota",
    classifyError(429, JSON.stringify({ error: { message: "you exceeded your quota" } })) === "insufficient_quota");
  ok("429 other rate limit → rate_limited",
    classifyError(429, JSON.stringify({ error: { code: "rate_limit_exceeded" } })) === "rate_limited");
  ok("403 resource_exhausted → insufficient_quota",
    classifyError(403, JSON.stringify({ error: { message: "resource_exhausted quota" } })) === "insufficient_quota");
  ok("500 → unknown_error", classifyError(500, "{}") === "unknown_error");
}

async function test3() {
  process.stdout.write("\nTest 3: Happy-path poll loop → manifest written\n");

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "deep-run-test-"));

  try {
    const phaseText = "# Test Phase Report\n\nSome findings here.";
    const completedBody = JSON.stringify({
      status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: phaseText }] }],
    });

    const stub = makeStubFetch([
      {
        match: "chat/completions",
        status: 200,
        body: JSON.stringify({ choices: [{ message: { content: "hi" } }] }),
      },
      {
        match: (url, opts) => url.includes("/v1/responses") && opts && opts.method === "POST",
        seq: [
          { status: 200, body: JSON.stringify({ id: "resp-p0", status: "queued" }) },
          { status: 200, body: JSON.stringify({ id: "resp-p1", status: "queued" }) },
          { status: 200, body: JSON.stringify({ id: "resp-p2", status: "queued" }) },
          { status: 200, body: JSON.stringify({ id: "resp-p3", status: "queued" }) },
        ],
        default: { status: 200, body: JSON.stringify({ id: "resp-fallback", status: "queued" }) },
      },
      {
        match: (url) => url.includes("/v1/responses/resp-"),
        status: 200,
        body: completedBody,
      },
    ]);

    const origKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "fake-test-openai-key-1234567890";
    let result;
    try {
      const runner = createRunner({ fetch: stub, sleep: noSleep, spawnSync: noSpawnSync });
      result = await runner.run("test research question about AI", {
        providers: ["openai"],
        out: tmpDir,
        skipPhase0: false,
      });
    } finally {
      if (origKey !== undefined) process.env.OPENAI_API_KEY = origKey;
      else delete process.env.OPENAI_API_KEY;
    }

    ok("run() resolves without throwing", true);
    ok("providers_used includes openai", result && result.providers_used.includes("openai"));

    const manifestPath = path.join(tmpDir, "manifest.json");
    ok("manifest.json written", fs.existsSync(manifestPath));
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      ok("manifest.json parses", true);
    } catch (e) {
      ok("manifest.json parses", false, e.message);
      return;
    }

    ok("manifest.schema is deep-research-manifest/1", manifest.schema === "deep-research-manifest/1");
    ok("manifest.openai.status === completed", manifest.openai && manifest.openai.status === "completed", JSON.stringify(manifest.openai));
    ok("manifest.openai.report is set", manifest.openai && manifest.openai.report && manifest.openai.report.length > 0);
    ok("manifest.providers_used includes openai", Array.isArray(manifest.providers_used) && manifest.providers_used.includes("openai"));

    ok("openai-report.md written", fs.existsSync(path.join(tmpDir, "openai-report.md")));
    ok("brief.json written", fs.existsSync(path.join(tmpDir, "brief.json")));
    ok("BRIEF.md written", fs.existsSync(path.join(tmpDir, "BRIEF.md")));

    const brief = JSON.parse(fs.readFileSync(path.join(tmpDir, "brief.json"), "utf8"));
    ok("brief.research_question set", !!brief.research_question);
    ok("brief has 4 phases", Array.isArray(brief.phases) && brief.phases.length === 4);

    const report = fs.readFileSync(path.join(tmpDir, "openai-report.md"), "utf8");
    ok("openai-report.md has content", report.length > 0, "len=" + report.length);

  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { }
  }
}

async function test4() {
  process.stdout.write("\nTest 4: Total failure → run() throws\n");

  const stub = makeStubFetch([
    { match: "chat/completions", status: 401, body: JSON.stringify({ error: { code: "invalid_api_key" } }) },
    { match: "gemini-1.5-flash", status: 401, body: JSON.stringify({ error: { code: "API_KEY_INVALID" } }) },
  ]);

  const origOpenAI = process.env.OPENAI_API_KEY;
  const origGemini = process.env.GEMINI_API_KEY;
  process.env.OPENAI_API_KEY = "fake-test-openai-key-1234567890";
  process.env.GEMINI_API_KEY = "fake-test-gemini-key-1234567890";

  let thrown = null;
  try {
    const runner = createRunner({ fetch: stub, sleep: noSleep, spawnSync: noSpawnSync });
    await runner.run("test question", { providers: ["openai", "gemini"], skipPhase0: false });
  } catch (e) {
    thrown = e;
  } finally {
    if (origOpenAI !== undefined) process.env.OPENAI_API_KEY = origOpenAI;
    else delete process.env.OPENAI_API_KEY;
    if (origGemini !== undefined) process.env.GEMINI_API_KEY = origGemini;
    else delete process.env.GEMINI_API_KEY;
  }

  ok("run() throws on total failure", thrown !== null, "expected throw, got resolved");
  ok("error message is actionable", thrown && (
    thrown.message.includes("All providers") || thrown.message.includes("skipped")
  ), thrown && thrown.message);
}

function test5() {
  process.stdout.write("\nTest 5: deep.md self-grep — no blocked patterns\n");

  const skillPath = path.join(__dirname, "..", "..", ".claude", "commands", "research", "deep.md");
  ok("deep.md exists", fs.existsSync(skillPath), skillPath);

  let content;
  try {
    content = fs.readFileSync(skillPath, "utf8");
  } catch (e) {
    ok("deep.md readable", false, e.message);
    return;
  }

  const sleepMatch = content.match(/\bsleep\s+\d+/);
  ok('no "sleep N" commands in deep.md', !sleepMatch, sleepMatch && "found: «" + sleepMatch[0] + "»");

  const nodeEWriteMatch = content.match(/node\s+-e\s+[^\n]*writeFileSync/);
  ok('no "node -e ... writeFileSync" in deep.md', !nodeEWriteMatch, nodeEWriteMatch && "found: «" + nodeEWriteMatch[0] + "»");

  const nodeEMatch = content.match(/node\s+-e\s+["'`]/);
  ok('no inline "node -e" scripts in deep.md', !nodeEMatch, nodeEMatch && "found: «" + nodeEMatch[0] + "»");
}

async function runAll() {
  process.stdout.write("=== deep-run.test.js ===\n");
  process.stdout.write("All tests run without live API calls — HTTP layer fully stubbed.\n");

  test1();
  await test2();
  test2b();
  await test3();
  await test4();
  test5();

  process.stdout.write("\n=== Results: " + passed + " passed, " + failed + " failed ===\n");
  if (failed > 0) process.exit(1);
}

runAll().catch((e) => {
  process.stderr.write("FATAL: " + e.message + "\n" + (e.stack || "") + "\n");
  process.exit(1);
});
