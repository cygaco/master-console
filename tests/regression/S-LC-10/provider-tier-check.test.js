#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// provider-tier-check.test.js — S-LC-10 D4. The provider TIER engine.
//
//   TIER MODEL: T1 reachable < T2 funded/keyed < T3 subscription-floor.
//   DETECTION:  self-attestation (default) + opt-in --probe (stub).
//               infer-from-dispatch is REJECTED (no dispatch/spend path exists).
//   VALUE-FREE: only the key NAME + presence + source LABEL is ever emitted —
//               a planted secret VALUE is never read into the report.
//   CONFIG FLOOR: the T3 subscription floor is a config value; changing it
//               re-grades the verdict (source-vs-instance, like resolveCeiling).
//   FAIL-OPEN:  unreadable config → framework defaults, exit 0, never blocks.
//   CONFIRM-CLASS WRITE: the config is written ONLY behind --write/--set-tier.
//
// Classification cases inject signals/config via the test seam (no real CLIs).
// A few cases shell out to assert the real exit-code + write-gating contract.
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const ENGINE = path.join(ROOT, "scripts", "mc", "provider-tier-check.js");
const tier = require(ENGINE);
const cfgLib = require(path.join(ROOT, "scripts", "mc", "lib", "provider-tier-config.js"));

let pass = 0;
let fail = 0;

// R-120 (S-OS-06 r4) — INSTRUMENTATION, not a fix. The live-CLI cases shell out via
// execFileSync, which THROWS on a non-zero child exit; the thrown error carries the
// child's own output on `e.stdout` / `e.stderr` (both populated under this file's
// default options — measured on win32/node24), but this harness discarded them and
// printed only the bare "Command failed" stack. A failure that reproduces off-win32
// therefore arrived with NO envelope, so the one R-115 requires could not exist for
// the linux-only exit. Print both streams, bounded to the last 60 lines each, on the
// throw path. No assertion and no product code changes — this only widens what an
// already-failing case REPORTS; a passing run is byte-identical.
const ENVELOPE_LINES = 60;
function envelope(e) {
  const stream = (label, raw) => {
    if (raw === undefined || raw === null) return "";
    const txt = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
    if (!txt.trim()) return `      [child ${label}: empty]\n`;
    const lines = txt.replace(/\s+$/, "").split(/\r?\n/);
    const tail = lines.slice(-ENVELOPE_LINES);
    const elided = lines.length > tail.length ? ` — last ${tail.length} of ${lines.length} lines` : "";
    return `      [child ${label}${elided}]\n` + tail.map((l) => `      | ${l}`).join("\n") + "\n";
  };
  const status = typeof e.status === "number" ? `      [child exit status: ${e.status}]\n` : "";
  return status + stream("stdout", e.stdout) + stream("stderr", e.stderr);
}

function ok(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    fail++;
    const env = envelope(e); // empty for a plain assertion failure (no child involved)
    console.log(`FAIL  ${name}\n      ${e.stack || e.message}${env ? "\n" + env : ""}`);
  }
}

// A preferred-tier config object (instance-shaped). `providers` is partial-merged.
function cfg(overrides = {}) {
  return cfgLib.normalize(Object.assign({ version: 1, t3_floor: "max_5x", providers: {} }, overrides));
}
function runReport(opts) {
  return tier.buildReport(opts);
}
function rowFor(report, provider) {
  return report.providers.find((r) => r.provider === provider);
}

// ── T1 classification ────────────────────────────────────────
ok("T1: CLI+auth absent → effective none, selected t1 → tier_short", () => {
  const r = runReport({
    providers: ["openai"],
    configOverride: cfg({ providers: { openai: { selected_tier: "t1" } } }),
    signalsOverride: { openai: { t1Met: false } },
  });
  const row = rowFor(r, "openai");
  assert.strictEqual(row.effective_tier, "none");
  assert.strictEqual(row.verdict, "tier_short");
});

ok("T1: CLI+auth present but no paid funding signal → effective t1, selected t1 → tier_met (verified)", () => {
  // auth present via a non-paid mechanism (harness session, no key, no OAuth) →
  // reachable (T1) but NOT funded (no T2 signal).
  const r = runReport({
    providers: ["claude"],
    configOverride: cfg({ providers: { claude: { selected_tier: "t1" } } }),
    signalsOverride: { claude: { t1Met: true, authTier: "harness", t2KeyPresent: false } },
  });
  const row = rowFor(r, "claude");
  assert.strictEqual(row.effective_tier, "t1");
  assert.strictEqual(row.verdict, "tier_met");
  assert.strictEqual(row.confidence, "verified");
});

// ── T2 classification ────────────────────────────────────────
ok("T2: key NAME present → effective t2; selected t2 → tier_met", () => {
  const r = runReport({
    providers: ["openai"],
    configOverride: cfg({ providers: { openai: { selected_tier: "t2" } } }),
    signalsOverride: { openai: { t1Met: true, authTier: "key", t2KeyPresent: true } },
  });
  const row = rowFor(r, "openai");
  assert.strictEqual(row.effective_tier, "t2");
  assert.strictEqual(row.verdict, "tier_met");
});

ok("T2: selected t2 but no key + no oauth → tier_short (value-free confident)", () => {
  const r = runReport({
    providers: ["openai"],
    configOverride: cfg({ providers: { openai: { selected_tier: "t2" } } }),
    signalsOverride: { openai: { t1Met: true, authTier: "key", t2KeyPresent: false } },
  });
  const row = rowFor(r, "openai");
  assert.strictEqual(row.effective_tier, "t1");
  assert.strictEqual(row.verdict, "tier_short");
});

ok("T2: paid OAuth login alone funds T2 even with no raw key", () => {
  const r = runReport({
    providers: ["gemini"],
    configOverride: cfg({ providers: { gemini: { selected_tier: "t2" } } }),
    signalsOverride: { gemini: { t1Met: true, authTier: "oauth", t2KeyPresent: false } },
  });
  assert.strictEqual(rowFor(r, "gemini").effective_tier, "t2");
  assert.strictEqual(rowFor(r, "gemini").verdict, "tier_met");
});

// ── T3 classification (self-attestation) ─────────────────────
ok("T3: attested sub meets floor → effective t3, selected t3 → tier_met (self-attested)", () => {
  const r = runReport({
    providers: ["claude"],
    configOverride: cfg({ t3_floor: "max_5x", providers: { claude: { selected_tier: "t3", subscription_tier: "max_5x" } } }),
    signalsOverride: { claude: { t1Met: true, authTier: "harness", t2KeyPresent: true } },
  });
  const row = rowFor(r, "claude");
  assert.strictEqual(row.effective_tier, "t3");
  assert.strictEqual(row.verdict, "tier_met");
  assert.strictEqual(row.confidence, "self-attested");
});

ok("T3 PLANTED UNDER-TIER: attested sub below floor → blocks the selected t3 (tier_short)", () => {
  const r = runReport({
    providers: ["claude"],
    configOverride: cfg({ t3_floor: "max_5x", providers: { claude: { selected_tier: "t3", subscription_tier: "pro" } } }),
    signalsOverride: { claude: { t1Met: true, authTier: "harness", t2KeyPresent: true } },
  });
  const row = rowFor(r, "claude");
  assert.strictEqual(row.effective_tier, "t2", "pro < max_5x → does not reach T3");
  assert.strictEqual(row.verdict, "tier_short", "planted under-tier blocks the selected tier");
});

// ── Claude is fundable + sub-checked (NOT auto-ok) ───────────
ok("Claude is NOT auto-ok at T3: harness reaches only T1 without a key/attestation", () => {
  const r = runReport({
    providers: ["claude"],
    configOverride: cfg({ providers: { claude: { selected_tier: "t3" } } }),
    signalsOverride: { claude: { t1Met: true, authTier: "harness", t2KeyPresent: false } },
  });
  const row = rowFor(r, "claude");
  // harness gives T1, but no key NAME and no attestation → cannot self-confirm T3.
  assert.strictEqual(row.effective_tier, "t1");
  assert.notStrictEqual(row.verdict, "tier_met");
});

// ── Self-attestation fallback when funding/sub is undetectable ─
ok("Self-attest fallback: selected t3, no sub/probe → unknown-self-attested, never blocks", () => {
  const r = runReport({
    providers: ["claude"],
    configOverride: cfg({ providers: { claude: { selected_tier: "t3" } } }),
    signalsOverride: { claude: { t1Met: true, authTier: "harness", t2KeyPresent: true } },
  });
  const row = rowFor(r, "claude");
  assert.strictEqual(row.verdict, "unknown-self-attested", "undetectable T3 → unknown, not a block");
  assert.strictEqual(row.confidence, "unknown");
});

ok("Blanket attested_tier=t3 satisfies a selected t3 (self-attested, exit 0)", () => {
  const r = runReport({
    providers: ["openai"],
    configOverride: cfg({ providers: { openai: { selected_tier: "t3", attested_tier: "t3" } } }),
    signalsOverride: { openai: { t1Met: true, authTier: "oauth", t2KeyPresent: false } },
  });
  assert.strictEqual(rowFor(r, "openai").effective_tier, "t3");
  assert.strictEqual(rowFor(r, "openai").verdict, "tier_met");
});

// ── CONFIG-DRIVEN FLOOR: changing the floor changes the verdict ─
ok("Config floor drives the verdict: pro-attested is t3_short under max_5x, t3_met under pro", () => {
  const base = { providers: { claude: { selected_tier: "t3", subscription_tier: "pro" } } };
  const signals = { claude: { t1Met: true, authTier: "harness", t2KeyPresent: true } };

  const high = runReport({ providers: ["claude"], configOverride: cfg(Object.assign({ t3_floor: "max_5x" }, base)), signalsOverride: signals });
  assert.strictEqual(rowFor(high, "claude").verdict, "tier_short", "floor max_5x → pro is short");

  const low = runReport({ providers: ["claude"], configOverride: cfg(Object.assign({ t3_floor: "pro" }, base)), signalsOverride: signals });
  assert.strictEqual(rowFor(low, "claude").verdict, "tier_met", "floor pro → pro now meets T3");
  assert.strictEqual(rowFor(low, "claude").effective_tier, "t3");
  // The ONLY thing that changed was the config floor.
});

// ── VALUE-FREE: a planted secret VALUE is never read/emitted ───
ok("VALUE-FREE: a planted secret in env is never emitted — only the key NAME/label", () => {
  // Build the planted secret at runtime so no literal API-key pattern lives in
  // this source file (the secret-guard hook would otherwise block the write).
  const FRAG = "9f8e7d6c5b4a3210";
  const SECRET = ["sk", "PLANTED-SECRET-VALUE", FRAG, "DO-NOT-LEAK"].join("-");
  const saved = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = SECRET;
  try {
    // REAL detection for openai (no signalsOverride) so auth-resolver reads env.
    const r = runReport({ providers: ["openai"], configOverride: cfg({ providers: { openai: { selected_tier: "t1" } } }) });
    const blob = JSON.stringify(r);
    assert.ok(!blob.includes(SECRET), "the secret VALUE must NEVER appear in the report");
    assert.ok(!blob.includes(FRAG), "no fragment of the secret may leak");
    const row = rowFor(r, "openai");
    // The key NAME (a label) is present; the value is not.
    assert.strictEqual(row.key_check.key_name, "OPENAI_API_KEY");
    assert.strictEqual(row.key_check.present, true, "presence is detected value-free");
    // The record carries NO field that could hold a secret value (no length, no value).
    assert.ok(!Object.prototype.hasOwnProperty.call(row.key_check, "value"), "no value field");
    assert.ok(!Object.prototype.hasOwnProperty.call(row.key_check, "length"), "no length field");
  } finally {
    if (saved === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = saved;
  }
});

// ── PLANTED VIOLATION: infer-from-dispatch is structurally impossible ──
ok("PLANTED: the engine has NO dispatch/token-spend path (infer-from-dispatch impossible)", () => {
  const src = fs.readFileSync(ENGINE, "utf8");
  // Strip comments so documentation that NAMES the forbidden pattern (to reject
  // it) does not self-trip this scan — we assert on executable code only.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
  const forbidden = [
    /dispatch-claude/,
    /dispatch-agent/,
    /codex\s+exec/,
    /gemini\s+-p/,
    /runProvider/,
    /execSync/,
    /spawnSync/,
    /child_process/,
  ];
  for (const re of forbidden) {
    assert.ok(!re.test(code), `engine code must not reference ${re} (no dispatch/spend path)`);
  }
  // And the report self-declares it.
  const r = runReport({ providers: ["openai"], signalsOverride: { openai: { t1Met: true } } });
  assert.strictEqual(r.infer_from_dispatch, false);
});

ok("PLANTED: the opt-in --probe is a non-spending stub that never confirms a tier", () => {
  const p = tier.probeBilling("claude", cfg());
  assert.strictEqual(p.judged, false, "stub never judges a tier");
  assert.strictEqual(p.tierMet, false);
  assert.ok(/self-attestation/.test(p.reason));
  // --probe does not upgrade an undetectable T3 into a met one.
  const r = runReport({
    providers: ["claude"],
    probe: true,
    configOverride: cfg({ providers: { claude: { selected_tier: "t3" } } }),
    signalsOverride: { claude: { t1Met: true, authTier: "harness", t2KeyPresent: true } },
  });
  assert.strictEqual(rowFor(r, "claude").verdict, "unknown-self-attested");
});

// ── FAIL-OPEN ────────────────────────────────────────────────
ok("Fail-open: a garbage config file → framework defaults, no throw", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slc10-cfg-"));
  const bad = path.join(dir, "provider-tier-config.json");
  fs.writeFileSync(bad, "{ this is not json ]]]");
  const read = cfgLib.readConfig({ configPath: bad });
  assert.strictEqual(read.source, "framework-default", "garbage → framework default");
  assert.strictEqual(read.config.t3_floor, "max_5x");
  // And the engine reading that path does not throw and stays report-only.
  const r = runReport({ providers: ["claude"], configPath: bad, signalsOverride: { claude: { t1Met: true } } });
  assert.strictEqual(r.report_only, true);
});

ok("Fail-open: an absent config → framework defaults (greenfield), default selected = t1", () => {
  const read = cfgLib.readConfig({ configPath: path.join(os.tmpdir(), "slc10-does-not-exist-" + Date.now(), "x.json") });
  assert.strictEqual(read.source, "framework-default");
  assert.strictEqual(cfgLib.resolveSelectedTier(read.config, "claude"), "t1");
});

// ── EXIT CONTRACT (live CLI) ─────────────────────────────────
ok("CLI: default check exits 0 (report-only) on the real tree", () => {
  const out = execFileSync("node", [ENGINE, "--json"], { cwd: ROOT, encoding: "utf8" });
  const r = JSON.parse(out);
  assert.strictEqual(r.report_only, true);
  assert.strictEqual(r.infer_from_dispatch, false);
  // exit 0 (execFileSync throws on non-zero) → reaching here proves exit 0.
});

ok("CLI --enforce: unknown-self-attested NEVER trips the gate (fail-open exit 0)", () => {
  // Point at a temp config that selects t3 for claude with T2 funded but NO
  // attestation -> unknown-self-attested -> --enforce must still exit 0.
  // Finding-6 tightened this reserved branch: T2 must be funded, otherwise the
  // value-free-detectable shortfall is tier_short.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slc10-enf-"));
  const cp = path.join(dir, "cfg.json");
  fs.writeFileSync(cp, JSON.stringify({ version: 1, t3_floor: "max_5x", providers: { claude: { selected_tier: "t3" } } }));
  // execFileSync throws if exit != 0; success here = exit 0.
  const out = execFileSync("node", [ENGINE, "--json", "--enforce", "--config-path", cp], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ANTHROPIC_API_KEY: "fixture-value" },
  });
  const r = JSON.parse(out);
  const claude = r.providers.find((p) => p.provider === "claude");
  assert.strictEqual(claude.t2_funded, true, "fixture must represent T2 funded; otherwise finding-6 correctly returns tier_short");
  assert.strictEqual(claude.verdict, "unknown-self-attested", "undetectable T3 → unknown");
});

// ── CONFIRM-CLASS WRITE ──────────────────────────────────────
ok("CONFIRM-CLASS: a no-flag check call does NOT write the config", () => {
  const realPath = cfgLib.configPath();
  const existedBefore = fs.existsSync(realPath);
  // A plain read-only invocation (default + --json) must never create/modify it.
  execFileSync("node", [ENGINE, "--json"], { cwd: ROOT, encoding: "utf8" });
  const existsAfter = fs.existsSync(realPath);
  assert.strictEqual(existsAfter, existedBefore, "read path must never write the config");
});

ok("CONFIRM-CLASS: a no-flag invocation against a temp path writes nothing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slc10-nowrite-"));
  const cp = path.join(dir, "cfg.json");
  // Read path pointed at a non-existent temp config — must NOT create it.
  execFileSync("node", [ENGINE, "--json", "--config-path", cp], { cwd: ROOT, encoding: "utf8" });
  assert.ok(!fs.existsSync(cp), "the read path must not materialize the config");
});

ok("CONFIRM-CLASS: --set-tier (explicit flag) DOES write the config to the temp path", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slc10-write-"));
  const cp = path.join(dir, "cfg.json");
  const out = execFileSync(
    "node",
    [ENGINE, "--set-tier", "claude", "t3", "--sub", "max_5x", "--config-path", cp, "--json"],
    { cwd: ROOT, encoding: "utf8" },
  );
  const res = JSON.parse(out);
  assert.strictEqual(res.wrote, true);
  assert.ok(fs.existsSync(cp), "the confirm-class write created the file");
  const written = JSON.parse(fs.readFileSync(cp, "utf8"));
  assert.strictEqual(written.providers.claude.selected_tier, "t3");
  assert.strictEqual(written.providers.claude.subscription_tier, "max_5x");
  // VALUE-FREE: the written config carries tier LABELS only.
  assert.ok(/selected_tier/.test(JSON.stringify(written)), "config holds tier labels");
});

ok("CONFIRM-CLASS: --set-tier with an invalid tier is rejected (exit 2, no write)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slc10-badtier-"));
  const cp = path.join(dir, "cfg.json");
  let threw = false;
  try {
    execFileSync("node", [ENGINE, "--set-tier", "claude", "t9", "--config-path", cp], { cwd: ROOT, encoding: "utf8", stdio: "pipe" });
  } catch (e) {
    threw = true;
    assert.strictEqual(e.status, 2, "invalid tier → exit 2");
  }
  assert.ok(threw, "an invalid tier must be rejected");
  assert.ok(!fs.existsSync(cp), "a rejected write must not create the config");
});

console.log(`\nS-LC-10 provider-tier-check: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
