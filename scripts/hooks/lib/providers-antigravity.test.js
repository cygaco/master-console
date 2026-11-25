#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const mcEnv = require("./mc-env");
const {
  buildProviderArgv, getProviderConfig, suggestFallbackProvider, PROVIDER_FAMILY, runProvider,
  classifyQuotaFailure, classifyAgyError, handleProviderFailure,
} = require("./providers");
const { assertArgs } = require("../../dispatch/safe-spawn");
const breaker = require("../../dispatch/provider-breaker");

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); }
}

test("getProviderConfig(antigravity) → cli agy, gemini-4-argon-high, cross-family openai fallback", () => {
  const cfg = getProviderConfig("antigravity");
  assert.ok(cfg, "antigravity config missing");
  assert.equal(cfg.cli, "agy");
  assert.equal(cfg.default_model, "gemini-4-argon-high");
  assert.equal(cfg.fallback, "openai");
  assert.ok(/agy/.test(cfg.syntax) && /-p/.test(cfg.syntax), "syntax must name agy + -p");
});

test("antigravity is google-family + fallback is cross-family openai", () => {
  assert.equal(PROVIDER_FAMILY.antigravity, "google");
  assert.equal(suggestFallbackProvider("antigravity", getProviderConfig("antigravity")), "openai");
});

test("buildProviderArgv(antigravity) → agy --model translates slug→display, -p prompt-in-argv, usesStdin false", () => {
  const built = buildProviderArgv("antigravity", "gemini-4-argon-high", [], { prompt: "review this diff\nfor OWASP issues" });
  assert.ok(!built.fail, "antigravity branch must exist (not fail-closed)");
  assert.equal(built.toolId, "agy");
  assert.equal(built.usesStdin, false);
  const mIdx = built.argv.indexOf("--model");
  assert.ok(mIdx >= 0, "--model flag present");
  assert.equal(built.argv[mIdx + 1], "Gemini 4 Argon (High)", "agy --model must carry the DISPLAY name, not the slug");
  assert.ok(!built.argv.includes("gemini-4-argon-high"), "the raw slug must NEVER reach agy --model");
  const pIdx = built.argv.indexOf("-p");
  assert.ok(pIdx >= 0 && built.argv[pIdx + 1].includes("OWASP"), "prompt must be the -p argv value");
  const check = assertArgs("agy", built.argv);
  assert.ok(check.ok, `agy argv rejected by safe-spawn policy: ${(check.violations || []).join("; ")}`);
});

{
  const KEYS = ["MC_AGY_PRINT_TIMEOUT", "AGY_PRINT_TIMEOUT", "MC_DISPATCH_BACKGROUND", "DISPATCH_BACKGROUND"];
  const withEnv = (env, fn) => {
    const saved = {};
    for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    Object.assign(process.env, env);
    try { return fn(); } finally { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
  };
  const timeoutOf = (built) => built.argv[built.argv.indexOf("--print-timeout") + 1];
  const agy = (opts) => buildProviderArgv("antigravity", "gemini-4-argon-high", [], { prompt: "p", ...opts });

  test("agy print timeout: any other role keeps the 90s default", () => {
    withEnv({}, () => {
      assert.equal(timeoutOf(agy({ role: "backend-reviewer" })), "90s");
      assert.equal(timeoutOf(agy({})), "90s");
    });
  });
  test("agy print timeout: the security reviewer's Google pass defaults to 600s when the wrapper may run that long (background)", () => {
    withEnv({}, () => {
      const b = agy({ role: "security-reviewer", background: true, timeoutMs: 900000 });
      assert.equal(timeoutOf(b), "600s");
      assert.equal(b.printTimeoutNote, undefined);
      assert.ok(assertArgs("agy", b.argv).ok);
    });
  });
  test("agy print timeout CLAMP: a foreground wrapper (540s) pulls the security default to 510s and says so", () => {
    withEnv({}, () => {
      for (const opts of [{ role: "security-reviewer" }, { role: "security-reviewer", timeoutMs: 540000 }]) {
        const b = agy(opts);
        assert.equal(timeoutOf(b), "510s", JSON.stringify(opts));
        assert.match(b.printTimeoutNote, /clamped to 510s/);
        assert.ok(assertArgs("agy", b.argv).ok);
      }
    });
  });
  test("agy print timeout CLAMP: always below the wrapper bound, with a floor of 30s", () => {
    withEnv({}, () => {
      assert.equal(timeoutOf(agy({ role: "security-reviewer", timeoutMs: 300000 })), "270s");
      assert.equal(timeoutOf(agy({ role: "security-reviewer", timeoutMs: 20000 })), "30s");
    });
  });
  test("agy print timeout: an explicit env value wins (for the security role too, not clamped)", () => {
    for (const key of ["MC_AGY_PRINT_TIMEOUT"]) {
      withEnv({ [key]: "45s" }, () => assert.equal(timeoutOf(agy({ role: "security-reviewer" })), "45s", key));
      withEnv({ [key]: "900s" }, () => assert.equal(timeoutOf(agy({ role: "security-reviewer" })), "900s", key));
      withEnv({ [key]: "120s" }, () => assert.equal(timeoutOf(agy({ role: "backend-reviewer" })), "120s", key));
    }
  });
  test("agy print timeout: a malformed env value falls back to the role's default (never reaches argv)", () => {
    withEnv({ MC_AGY_PRINT_TIMEOUT: "ten minutes; rm -rf" }, () => {
      assert.equal(timeoutOf(agy({ role: "backend-reviewer" })), "90s");
      assert.equal(timeoutOf(agy({ role: "security-reviewer" })), "510s");
    });
  });
}

test("catalog.agyModelName: slug→display for antigravity, UNCHANGED otherwise", () => {
  const catalog = require("../../dispatch/catalog");
  const m = catalog.getModel("antigravity", "gemini-3.1-pro-high");
  assert.ok(m, "antigravity model entry present");
  assert.equal(m.agyModelName, "Gemini 3.1 Pro (High)", "agyModelName field present + exact display name");
  assert.equal(catalog.agyModelName("gemini-3.1-pro-high"), "Gemini 3.1 Pro (High)");
  assert.equal(catalog.agyModelName("gemini-4-argon-high"), "Gemini 4 Argon (High)", "the live default resolves to its display name");
  assert.equal(catalog.agyModelName("gpt-5.6-sol"), "gpt-5.6-sol", "non-antigravity id unchanged (zero blast radius)");
  assert.equal(catalog.agyModelName("some-unmapped-id"), "some-unmapped-id", "unmapped id unchanged");
});

test("buildProviderArgv(openai) unchanged — codex stdin", () => {
  const b = buildProviderArgv("openai", "gpt-5.6-sol", ["-c", "model_reasoning_effort=high"]);
  assert.equal(b.toolId, "codex");
  assert.equal(b.usesStdin, true);
  assert.ok(b.argv.includes("exec") && b.argv.includes("-m") && b.argv.includes("gpt-5.6-sol") && b.argv.includes("-"));
});
test("buildProviderArgv(gemini) → FAIL-CLOSED (the individual gemini CLI is retired, ADR-0031)", () => {
  const b = buildProviderArgv("gemini", "gemini-3.1-pro-preview");
  assert.equal(b.fail, true);
  assert.match(b.error, /gemini|ARG_POLICY|safety kernel/i);
});
test("buildProviderArgv(unknown) → fail-closed (no unvetted spawn)", () => {
  const b = buildProviderArgv("mystery-provider", "x");
  assert.ok(b.fail === true && /not covered/.test(b.error));
});

test("runProvider(provider:antigravity) with agy absent → fail-closed fallback (branch wired)", () => {
  const r = runProvider("security-reviewer", "probe", { provider: "antigravity", strict: false, timeoutMs: 5000, cliAvailable: () => false });
  assert.equal(r.ok, false);
  assert.equal(r.fallback, true, "an absent agy must fall back (BLOCKED-ON-OPERATOR), not hard-fail");
  assert.ok(!/custom cfg\.syntax not covered/.test(r.error || ""), "antigravity must NOT hit the unknown-provider branch — its branch is wired");
  assert.ok(/not found/.test(r.error || ""), "the forced-unavailable seam drives the CLI-absent fail-closed reason (seam is load-bearing)");
});

const AGY_PRINT_TIMEOUT_STDERR =
  "[agy] print timeout after 1s with turn in progress; returning partial output\n" +
  "error: print timeout after 1s with the turn still in progress; the response is partial\n" +
  'AGY_ERROR: {"short_error":"print timeout after 1s with the turn still in progress; the response is partial","status":"DEADLINE_EXCEEDED","retryable":false,"reason":"print_timeout"}\n';

function spawnFailure({ stderr = "", exitCode = null, reason }) {
  const e = new Error(String(stderr).trim() || reason || `exit ${exitCode}`);
  e.stderr = stderr;
  e.status = exitCode;
  e.stderrBytes = Buffer.byteLength(stderr, "utf8");
  e.reaped = true;
  e.reason = reason;
  return e;
}
const failureCtx = (providerName, model) => ({ providerName, model, cfg: getProviderConfig(providerName) });

const breakerDir = fs.mkdtempSync(path.join(os.tmpdir(), "providers-agy-breaker-"));
const breakerFile = path.join(breakerDir, "provider-down.json");
const breakerEnvSnapshot = mcEnv.snapshotEnv("PROVIDER_DOWN_FILE");
mcEnv.setEnv("PROVIDER_DOWN_FILE", breakerFile);
fs.writeFileSync(breakerFile, JSON.stringify({ __seam_probe__: { kind: "probe", until: Date.now() + 600000 } }), "utf8");
const seamLive = breaker.isDown("__seam_probe__") === true;
const resetBreaker = () => fs.writeFileSync(breakerFile, "{}", "utf8");
const readBreaker = () => JSON.parse(fs.readFileSync(breakerFile, "utf8"));
const SEAM_MSG = "PROVIDER_DOWN_FILE seam not live — refusing to run a breaker-touching case against real state";

try {
  test("classifyAgyError: parses the real AGY_ERROR line; null when absent / malformed; LAST line wins", () => {
    assert.equal(Buffer.byteLength(AGY_PRINT_TIMEOUT_STDERR, "utf8"), 345, "fixture must stay byte-identical to the captured stderr");
    assert.deepEqual(classifyAgyError(AGY_PRINT_TIMEOUT_STDERR), {
      status: "DEADLINE_EXCEEDED",
      reason: "print_timeout",
      retryable: false,
      short_error: "print timeout after 1s with the turn still in progress; the response is partial",
    });
    assert.equal(classifyAgyError(""), null);
    assert.equal(classifyAgyError(null), null);
    assert.equal(classifyAgyError("error: something else entirely\n"), null);
    assert.equal(classifyAgyError('AGY_ERROR: {"short_error":"print timeout after 1s","status":"DEADLINE_EXC'), null);
    assert.equal(classifyAgyError("AGY_ERROR: not json at all\n"), null);
    assert.equal(classifyAgyError('AGY_ERROR: ["print_timeout"]\n'), null, "a non-object payload is not a verdict");
    assert.equal(classifyAgyError('the log said AGY_ERROR: {"reason":"print_timeout"}\n'), null);
    const two = 'AGY_ERROR: {"status":"RESOURCE_EXHAUSTED","reason":"other"}\n' + AGY_PRINT_TIMEOUT_STDERR;
    assert.equal(classifyAgyError(two).reason, "print_timeout");
    assert.deepEqual(classifyAgyError('AGY_ERROR: {"status":7,"reason":{"x":1},"retryable":"no"}'), {
      status: null, reason: null, retryable: null, short_error: null,
    });
  });

  test("agy print timeout (real stderr, exit 3) → failure.kind timeout + real exit code, no quota, breaker untouched", () => {
    assert.ok(seamLive, SEAM_MSG);
    resetBreaker();
    const r = handleProviderFailure(
      spawnFailure({ stderr: AGY_PRINT_TIMEOUT_STDERR, exitCode: 3, reason: "nonzero_exit" }),
      failureCtx("antigravity", "gemini-4-argon-high"),
    );
    assert.equal(r.ok, false);
    assert.equal(r.fallback, true, "a timeout still falls back — dispatch is never weakened");
    assert.equal(r.provider, "antigravity");
    assert.equal(r.model, "gemini-4-argon-high");
    assert.deepEqual(r.failure, { kind: "timeout", exit_code: 3, source: "agy_error" });
    assert.equal(r.quota, undefined, "a timeout carries no quota fragment");
    assert.equal(r.stderrBytes, 345);
    assert.ok(/AGY_ERROR/.test(r.error), "the CLI's own error text is still surfaced");
    assert.deepEqual(readBreaker(), {}, "a timeout must not write the breaker");
    const r2 = handleProviderFailure(
      spawnFailure({ stderr: 'AGY_ERROR: {"short_error":"deadline","status":"DEADLINE_EXCEEDED","retryable":false}\n', exitCode: 3, reason: "nonzero_exit" }),
      failureCtx("antigravity", "gemini-4-argon-high"),
    );
    assert.deepEqual(r2.failure, { kind: "timeout", exit_code: 3, source: "agy_error" });
    assert.deepEqual(readBreaker(), {});
  });

  test("same timeout stderr + quota / 429 / rate-limit words → STILL timeout; breaker file stays empty", () => {
    assert.ok(seamLive, SEAM_MSG);
    resetBreaker();
    const noisy =
      "partial: the 429 handler enforces a per-user quota (rate limit; too many requests; RESOURCE_EXHAUSTED)\n" +
      AGY_PRINT_TIMEOUT_STDERR;
    assert.deepEqual(classifyQuotaFailure(noisy), { kind: "quota_exhausted", recoverable: true });
    const r = handleProviderFailure(
      spawnFailure({ stderr: noisy, exitCode: 3, reason: "nonzero_exit" }),
      failureCtx("antigravity", "gemini-4-argon-high"),
    );
    assert.deepEqual(r.failure, { kind: "timeout", exit_code: 3, source: "agy_error" });
    assert.equal(r.quota, undefined, "the quota classifier must not run over a timeout's stderr");
    assert.deepEqual(readBreaker(), {}, "breaker file must stay empty");
    assert.equal(breaker.isDown("antigravity"), false);
  });

  test("wrapper reap (timeout_reap) on any lane → timeout, exit_code null, quota words in the echo ignored", () => {
    assert.ok(seamLive, SEAM_MSG);
    resetBreaker();
    const echo = "user\nReview the rate limit middleware: it must answer 429 once the quota is spent.\n";
    assert.ok(classifyQuotaFailure(echo), "teeth: the echo trips the raw quota classifier");
    const r = handleProviderFailure(
      spawnFailure({ stderr: echo, exitCode: null, reason: "timeout_reap" }),
      failureCtx("openai", "gpt-5.6-sol"),
    );
    assert.deepEqual(r.failure, { kind: "timeout", exit_code: null, source: "wrapper_reap" });
    assert.equal(r.quota, undefined);
    assert.equal(r.fallback, true);
    assert.deepEqual(readBreaker(), {});
  });

  test("AGY_ERROR status RESOURCE_EXHAUSTED → still quota_exhausted and the breaker IS marked", () => {
    assert.ok(seamLive, SEAM_MSG);
    resetBreaker();
    const exhausted =
      "error: model capacity exhausted\n" +
      'AGY_ERROR: {"short_error":"model capacity exhausted","status":"RESOURCE_EXHAUSTED","retryable":true,"reason":"capacity"}\n';
    const realWrite = process.stderr.write;
    let notice = "";
    let r;
    process.stderr.write = (chunk) => { notice += String(chunk); return true; };
    try {
      r = handleProviderFailure(
        spawnFailure({ stderr: exhausted, exitCode: 1, reason: "nonzero_exit" }),
        failureCtx("antigravity", "gemini-4-argon-high"),
      );
    } finally {
      process.stderr.write = realWrite;
    }
    assert.deepEqual(r.failure, { kind: "quota", exit_code: 1 });
    assert.equal(r.quota && r.quota.kind, "quota_exhausted");
    assert.equal(r.quota.recoverable, true);
    assert.equal(r.quota.suggestFallbackProvider, "openai", "cross-family fallback hint unchanged");
    assert.equal(typeof r.quota.auth_mode, "string");
    assert.ok(/QUOTA: antigravity/.test(notice), "the loud quota notice is still emitted");
    const state = readBreaker();
    assert.ok(state.antigravity, "breaker must be marked for antigravity");
    assert.equal(state.antigravity.kind, "quota_exhausted");
    assert.ok(state.antigravity.until > Date.now(), "marked with a future TTL");
    assert.equal(breaker.isDown("antigravity"), true);
  });

  test("an AGY_ERROR line quoted on a NON-agy lane is not agy's verdict → quota still classified + marked", () => {
    assert.ok(seamLive, SEAM_MSG);
    resetBreaker();
    const echoed = AGY_PRINT_TIMEOUT_STDERR + "stream error: 429 Too Many Requests\n";
    const realWrite = process.stderr.write;
    let r;
    process.stderr.write = () => true;
    try {
      r = handleProviderFailure(
        spawnFailure({ stderr: echoed, exitCode: 1, reason: "nonzero_exit" }),
        failureCtx("openai", "gpt-5.6-sol"),
      );
    } finally {
      process.stderr.write = realWrite;
    }
    assert.deepEqual(r.failure, { kind: "quota", exit_code: 1 });
    assert.equal(r.quota && r.quota.kind, "quota_exhausted");
    assert.ok(readBreaker().openai, "the openai lane's quota failure still marks the breaker");
  });

  test("plain non-zero exit with no timeout / quota signal → failure.kind unknown + real exit code, breaker untouched", () => {
    assert.ok(seamLive, SEAM_MSG);
    resetBreaker();
    const r = handleProviderFailure(
      spawnFailure({ stderr: 'error: model "X" is not recognized\n', exitCode: 2, reason: "nonzero_exit" }),
      failureCtx("antigravity", "gemini-4-argon-high"),
    );
    assert.deepEqual(r.failure, { kind: "unknown", exit_code: 2 });
    assert.equal(r.quota, undefined);
    assert.deepEqual(readBreaker(), {});
    const r2 = handleProviderFailure(new Error("kernel unavailable"), failureCtx("antigravity", "gemini-4-argon-high"));
    assert.deepEqual(r2.failure, { kind: "unknown", exit_code: null });
    assert.equal(r2.stderrBytes, 0);
    assert.equal(r2.error, "kernel unavailable");
  });

  test("failureRecordFields: real non-zero exit code + failure_kind; a failed record never carries exit_code 0", () => {
    const { failureRecordFields } = require("../../dispatch-agent");
    const timeout = handleProviderFailure(
      spawnFailure({ stderr: AGY_PRINT_TIMEOUT_STDERR, exitCode: 3, reason: "nonzero_exit" }),
      failureCtx("antigravity", "gemini-4-argon-high"),
    );
    assert.deepEqual(failureRecordFields(timeout), { exit_code: 3, failure_kind: "timeout" });
    assert.deepEqual(failureRecordFields({ ok: true, output: "PONG" }), { exit_code: 0 }, "success record unchanged");
    assert.deepEqual(failureRecordFields({ ok: true, failure: { kind: "timeout", exit_code: 3 } }), { exit_code: 0 }, "ok wins — no failure fields on a success");
    assert.deepEqual(failureRecordFields({ ok: false, failure: { kind: "timeout", exit_code: null, source: "wrapper_reap" } }), { exit_code: 1, failure_kind: "timeout" });
    assert.deepEqual(failureRecordFields({ ok: false, failure: { kind: "unknown", exit_code: 0 } }), { exit_code: 1, failure_kind: "unknown" }, "exit 0 + failed (zero-byte) must not read as success");
    assert.deepEqual(failureRecordFields({ ok: false, failure: { kind: "quota", exit_code: "3" } }), { exit_code: 1, failure_kind: "quota" }, "a non-integer is not an exit status");
    assert.deepEqual(failureRecordFields({ ok: false, fallback: true, error: 'CLI "agy" not found' }), { exit_code: 1 });
    assert.deepEqual(failureRecordFields(null), { exit_code: 1 });
  });

  test("wiring: runProvider's catch only delegates; dispatch-agent's record uses failureRecordFields", () => {
    const src = runProvider.toString();
    assert.ok(
      /catch \(err\) \{[\s\S]*?return handleProviderFailure\(err, \{ providerName, model, cfg \}\);\s*\} finally/.test(src),
      "runProvider's catch must return handleProviderFailure(...)",
    );
    assert.ok(!/classifyQuotaFailure\(/.test(src), "runProvider must not run the quota classifier itself");
    assert.ok(!/providerBreaker\.markDown\(/.test(src), "runProvider must not mark the breaker itself");
    const dispatchAgentSrc = fs.readFileSync(path.join(__dirname, "..", "..", "dispatch-agent.js"), "utf8");
    assert.ok(dispatchAgentSrc.includes("...failureRecordFields(result),"), "the completion record must spread failureRecordFields(result)");
    assert.ok(!/exit_code:\s*result\.ok\s*\?\s*0\s*:\s*1/.test(dispatchAgentSrc), "the flat `exit_code: result.ok ? 0 : 1` must not come back");
  });
} finally {
  mcEnv.restoreEnv(breakerEnvSnapshot);
  try { fs.rmSync(breakerDir, { recursive: true, force: true }); } catch { }
}

if (failures.length) {
  process.stderr.write(`FAIL [providers-antigravity.test] ${failures.length} failure(s):\n${failures.map((f) => `  - ${f}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`OK   [providers-antigravity.test] ${passed} passed (agy seam; liveness operator-owned)\n`);
