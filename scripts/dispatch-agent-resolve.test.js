#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { dispatchTarget } = require("./dispatch-agent");

const ROOT = __dirname;
const REPO = path.join(ROOT, "..");
let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); }
}
const known = (claude, openai, antigravity) => ({
  state: "known",
  providers: { claude: { signedIn: claude }, openai: { signedIn: openai }, antigravity: { signedIn: antigravity } },
});
const tmpManifest = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "da-res-"));
  const f = path.join(d, "manifest.json");
  fs.writeFileSync(f, "{}\n");
  return f;
};
const resolveOpts = () => ({ manifestPath: tmpManifest(), toolPresent: () => true });
const pick = (role, extra) => dispatchTarget({ role, providerOverride: null, modelOverride: null, prompt: "hi", needsWorkspace: false, ...extra });

test("codex signed out: beta lands on the next chain entry (agy) and the record fields name the skip", () => {
  const t = pick("beta", { seams: { signin: known(true, false, true), resolveOpts: resolveOpts() } });
  assert.strictEqual(t.ok, true);
  assert.deepStrictEqual(t.runOpts, { provider: "antigravity", model: "gemini-4-argon-high", effort: null });
  assert.strictEqual(t.recordFields.chain_index, 1);
  assert.strictEqual(t.recordFields.signin_state, "known");
  assert.deepStrictEqual(t.recordFields.skipped.map((s) => [s.index, s.provider, s.reason]), [[0, "openai", "not-signed-in"]]);
});
test("all signed in: beta runs its pin with the pin's effort passed explicitly", () => {
  const t = pick("beta", { seams: { signin: known(true, true, true), resolveOpts: resolveOpts() } });
  assert.deepStrictEqual(t.runOpts, { provider: "openai", model: "gpt-6.2-sol", effort: "high" });
  assert.strictEqual(t.recordFields.chain_index, 0);
});
test("a prompt over 32,000 characters moves research-lead off agy to codex", () => {
  const t = pick("research-lead", { prompt: "x".repeat(32001), seams: { signin: known(true, true, true), resolveOpts: resolveOpts() } });
  assert.deepStrictEqual([t.provider, t.recordFields.chain_index, t.recordFields.skipped[0].reason], ["openai", 2, "prompt-too-long"]);
});
test("--needs-workspace moves research-lead off agy even when the sign-in record is unknown", () => {
  const t = pick("research-lead", { needsWorkspace: true, seams: { signin: { state: "unknown", reason: "no record" }, resolveOpts: resolveOpts() } });
  assert.deepStrictEqual([t.provider, t.recordFields.signin_state, t.recordFields.skipped[0].reason], ["openai", "unknown", "needs-workspace"]);
});
test("unknown sign-in record: the pin runs (index 0)", () => {
  const t = pick("beta", { seams: { signin: { state: "unknown", reason: "stale" }, resolveOpts: resolveOpts() } });
  assert.deepStrictEqual([t.provider, t.recordFields.chain_index, t.recordFields.signin_state], ["openai", 0, "unknown"]);
});
test("the fail-closed security panel role is refused when the walk leaves its first lab (no override)", () => {
  const t = pick("security-reviewer", { seams: { signin: known(true, true, false), resolveOpts: resolveOpts() } });
  assert.strictEqual(t.ok, false);
  assert.match(t.error, /fails closed on lab-diversity loss.*dispatch-review/);
  const head = pick("security-reviewer", { seams: { signin: known(true, true, true), resolveOpts: resolveOpts() } });
  assert.deepStrictEqual([head.ok, head.provider, head.recordFields.chain_index], [true, "antigravity", 0], "its first lab signed in: runs");
  const over = dispatchTarget({ role: "security-reviewer", providerOverride: "openai", modelOverride: "gpt-5.6-sol", prompt: "hi", seams: { signin: known(true, true, false) } });
  assert.deepStrictEqual([over.ok, over.provider], [true, "openai"], "the panel runner's explicit per-pass override is unaffected");
  const other = pick("research-lead", { seams: { signin: known(true, true, false), resolveOpts: resolveOpts() } });
  assert.deepStrictEqual([other.ok, other.provider], [true, "openai"], "a role without the fail-closed rule still walks");
});
test("an explicit --provider/--model override wins over the resolver", () => {
  const t = dispatchTarget({ role: "beta", providerOverride: "antigravity", modelOverride: "gemini-3.8-flash", prompt: "hi", seams: { signin: known(true, true, true) } });
  assert.deepStrictEqual([t.provider, t.runOpts.provider, t.runOpts.model, t.recordFields.resolve_source], ["antigravity", "antigravity", "gemini-3.8-flash", "override"]);
});
test("a resolver failure falls back to the pin; an unreadable pin still fails closed", () => {
  const boom = { resolveRole() { throw new Error("preset unreadable"); }, readSigninState() { return { state: "unknown" }; } };
  const t = pick("beta", { seams: { modelResolve: boom, providerForRoleStrict: () => "openai" } });
  assert.deepStrictEqual([t.ok, t.provider, t.recordFields.resolve_source], [true, "openai", "pin-resolver-error"]);
  assert.match(t.resolverError, /preset unreadable/);
  const closed = pick("beta", { seams: { modelResolve: boom, providerForRoleStrict: () => { throw new Error("manifest unreadable"); } } });
  assert.strictEqual(closed.ok, false);
  assert.match(closed.error, /manifest unreadable/);
});
test("a role the resolver does not know keeps the old pin path", () => {
  const t = pick("reviewer", { seams: { signin: known(true, true, true), resolveOpts: resolveOpts(), providerForRoleStrict: () => "openai" } });
  assert.deepStrictEqual([t.provider, t.recordFields.resolve_source], ["openai", "pin-unknown-role"]);
});

test("CLI --resolve-only: a stamped record with Codex signed out routes beta to agy (entry 1) and names the skip", () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "da-res-proj-"));
  const cp = (rel) => {
    const to = path.join(proj, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(REPO, rel), to);
  };
  cp(".claude/paths.json");
  cp(".claude/agents/_org/role-registry.json");
  for (const f of fs.readdirSync(path.join(REPO, ".claude/agents/_org/presets"))) cp(`.claude/agents/_org/presets/${f}`);
  fs.writeFileSync(path.join(proj, ".claude", "manifest.json"), "{}\n");
  const env = { ...process.env, CLAUDE_PROJECT_DIR: proj, DISPATCH_LEDGER_DIR: path.join(proj, "ledger") };
  const where = spawnSync(process.execPath, ["-e", `process.stdout.write(require(${JSON.stringify(path.join(ROOT, "dispatch", "model-resolve.js"))}).signinCachePath({}))`], { env, encoding: "utf8" });
  const cache = where.stdout.trim();
  assert.ok(cache.startsWith(proj), `the sign-in record path is inside the seeded project: ${cache}`);
  fs.mkdirSync(path.dirname(cache), { recursive: true });
  fs.writeFileSync(cache, JSON.stringify({
    schema: "mc/model-signin/v1",
    writer: { tool: "scripts/dispatch/signin.js", version: 1 },
    ts: new Date().toISOString(),
    providers: {
      claude: { signedIn: true, method: "claude.ai", exit: 0 },
      openai: { signedIn: false, method: "codex login status", exit: 1 },
      antigravity: { signedIn: true, method: "agy models", exit: 0, served: ["gemini-4-argon-high"] },
    },
  }));
  const promptFile = path.join(proj, "p.md");
  fs.writeFileSync(promptFile, "hello");
  const r = spawnSync(process.execPath, [path.join(ROOT, "dispatch-agent.js"), "beta", promptFile, "--resolve-only"], { env, encoding: "utf8", timeout: 60000 });
  const line = r.stdout.split("\n").map((l) => l.trim()).find((l) => l.startsWith("{"));
  assert.ok(line, r.stdout + r.stderr);
  const out = JSON.parse(line);
  assert.deepStrictEqual([out.provider, out.model, out.chain_index, out.signin_state], ["antigravity", "gemini-4-argon-high", 1, "known"]);
  assert.deepStrictEqual(out.skipped.map((s) => [s.provider, s.reason]), [["openai", "not-signed-in"]]);
  assert.strictEqual(r.status, 0);
});

if (failures.length) {
  console.error(failures.join("\n"));
  console.error(`FAIL [dispatch-agent-resolve.test] ${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`OK   [dispatch-agent-resolve.test] ${passed} passed`);
