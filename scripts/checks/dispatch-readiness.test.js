#!/usr/bin/env node

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");

function withTmpHome(fixtureFiles, fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dr-test-"));
  const realHomedir = os.homedir;
  try {
    for (const [rel, content] of Object.entries(fixtureFiles)) {
      const dest = path.join(tmpDir, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, content, "utf8");
    }

    os.homedir = () => tmpDir;

    const modPath = require.resolve("./dispatch-readiness");
    delete require.cache[modPath];
    const { detectAuthTier } = require("./dispatch-readiness");

    fn(detectAuthTier);
  } finally {
    os.homedir = realHomedir;
    const modPath = require.resolve("./dispatch-readiness");
    delete require.cache[modPath];
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

const METERED_AUTH_JSON = JSON.stringify({
  auth_mode: "ApiKey",
  OPENAI_API_KEY: "sk-REDACTED",
});

const OAUTH_TOKENS_AUTH_JSON = JSON.stringify({
  tokens: {
    access_token: "ya29.FAKE_ACCESS",
    refresh_token: "1//FAKE_REFRESH",
  },
});

const OAUTH_FLAT_AUTH_JSON = JSON.stringify({
  access_token: "ya29.FAKE_ACCESS",
  refresh_token: "1//FAKE_REFRESH",
});

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ok    ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${e.message}`);
    failed++;
  }
}

console.log("dispatch-readiness: detectAuthTier (openai) — planted-violation + value-free tests");
console.log("─".repeat(70));

test("metered auth.json (~/.codex) → tier='key', NOT 'oauth' [PLANTED VIOLATION]", () => {
  withTmpHome({ ".codex/auth.json": METERED_AUTH_JSON }, (detectAuthTier) => {
    const result = detectAuthTier("openai");
    assert.strictEqual(
      result.tier,
      "key",
      `PLANTED VIOLATION: got tier="${result.tier}", expected "key".`,
    );
    assert.ok(
      result.detail.includes("metered"),
      `detail should mention "metered" but got: "${result.detail}"`,
    );
  });
});

test("metered auth.json (~/.config/codex) → tier='key'", () => {
  withTmpHome({ ".config/codex/auth.json": METERED_AUTH_JSON }, (detectAuthTier) => {
    const result = detectAuthTier("openai");
    assert.strictEqual(
      result.tier,
      "key",
      `secondary path must also return tier="key", got "${result.tier}"`,
    );
    assert.ok(result.detail.includes("metered"), `detail should mention "metered", got: "${result.detail}"`);
  });
});

test("oauth auth.json ({tokens:{access_token,refresh_token}}) → tier='oauth'", () => {
  withTmpHome({ ".codex/auth.json": OAUTH_TOKENS_AUTH_JSON }, (detectAuthTier) => {
    const result = detectAuthTier("openai");
    assert.strictEqual(result.tier, "oauth", `got tier="${result.tier}", expected "oauth"`);
    assert.ok(
      result.detail.toLowerCase().includes("oauth"),
      `detail should mention oauth, got: "${result.detail}"`,
    );
  });
});

test("oauth auth.json (flat access_token/refresh_token) → tier='oauth'", () => {
  withTmpHome({ ".codex/auth.json": OAUTH_FLAT_AUTH_JSON }, (detectAuthTier) => {
    const result = detectAuthTier("openai");
    assert.strictEqual(result.tier, "oauth", `got tier="${result.tier}", expected "oauth"`);
  });
});

test("VALUE-FREE: metered detail does NOT contain key value 'sk-REDACTED'", () => {
  withTmpHome({ ".codex/auth.json": METERED_AUTH_JSON }, (detectAuthTier) => {
    const result = detectAuthTier("openai");
    assert.ok(
      !result.detail.includes("sk-REDACTED"),
      `VALUE-FREE VIOLATION: detail contains the key value! detail="${result.detail}"`,
    );
    assert.ok(
      !result.detail.includes("sk-"),
      `VALUE-FREE VIOLATION: detail contains sk- prefix! detail="${result.detail}"`,
    );
  });
});

test("VALUE-FREE: oauth detail does NOT contain token value 'ya29.FAKE_ACCESS'", () => {
  withTmpHome({ ".codex/auth.json": OAUTH_TOKENS_AUTH_JSON }, (detectAuthTier) => {
    const result = detectAuthTier("openai");
    assert.ok(
      !result.detail.includes("ya29.FAKE_ACCESS"),
      `VALUE-FREE VIOLATION: detail contains token value! detail="${result.detail}"`,
    );
  });
});

test("no auth file, no env key → tier='none'", () => {
  const savedKey = process.env.OPENAI_API_KEY;
  const savedCodex = process.env.CODEX_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.CODEX_API_KEY;
  try {
    withTmpHome({}, (detectAuthTier) => {
      const result = detectAuthTier("openai");
      assert.strictEqual(result.tier, "none", `got tier="${result.tier}", expected "none"`);
    });
  } finally {
    if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
    if (savedCodex !== undefined) process.env.CODEX_API_KEY = savedCodex;
  }
});

test("ambiguous auth.json (neither metered nor oauth fields) → tier!='oauth'", () => {
  const ambiguous = JSON.stringify({ some_unknown_field: "value" });
  withTmpHome({ ".codex/auth.json": ambiguous }, (detectAuthTier) => {
    const result = detectAuthTier("openai");
    assert.notStrictEqual(
      result.tier,
      "oauth",
      `Ambiguous auth.json must NOT default to "oauth" — got tier="${result.tier}"`,
    );
  });
});

test("malformed auth.json (not valid JSON) → tier!='oauth'", () => {
  withTmpHome({ ".codex/auth.json": "NOT_JSON{{{" }, (detectAuthTier) => {
    const result = detectAuthTier("openai");
    assert.notStrictEqual(
      result.tier,
      "oauth",
      `Malformed auth.json must NOT default to "oauth" — got tier="${result.tier}"`,
    );
  });
});

console.log("");
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
