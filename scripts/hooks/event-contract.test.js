"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const HOOK = path.join(__dirname, "event-contract.js");
const NO_KEY = Symbol("no-key");

function makeProject(prefixKey, srcFiles) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "event-contract-"));
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  const manifest = { project: { name: "event-contract-fixture" }, mc: {} };
  if (prefixKey !== NO_KEY) manifest.mc.eventContractPrefix = prefixKey;
  fs.writeFileSync(
    path.join(dir, ".claude", "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  for (const [name, body] of Object.entries(srcFiles)) {
    fs.writeFileSync(path.join(dir, "src", name), body);
  }
  return dir;
}

function runHook(dir, editedName) {
  const filePath = path.join(dir, "src", editedName);
  const payload = {
    tool_name: "Edit",
    cwd: dir,
    tool_input: {
      file_path: filePath,
      new_string: fs.readFileSync(filePath, "utf8"),
    },
    tool_response: { ok: true },
  };
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    timeout: 30000,
  });
  fs.rmSync(dir, { recursive: true, force: true });
  return r;
}

test("no key: the default prefix app is paired and its orphan is reported", () => {
  const dir = makeProject(NO_KEY, {
    "listener.ts": 'window.addEventListener("app:ready", onReady);\n',
    "edited.ts":
      'window.dispatchEvent(new CustomEvent("app:ready"));\n' +
      'window.dispatchEvent(new CustomEvent("app:saved"));\n',
  });
  const r = runHook(dir, "edited.ts");
  assert.strictEqual(r.status, 0);
  assert.match(r.stderr, /orphan app:\* event names detected/);
  assert.match(r.stderr, /dispatched but never listened: app:saved/);
  assert.doesNotMatch(r.stderr, /app:ready/);
});

test("no key: acme: names are outside the default prefix and are neither paired nor reported", () => {
  const dir = makeProject(NO_KEY, {
    "listener.ts": 'window.addEventListener("acme:open", onOpen);\n',
    "edited.ts": 'window.dispatchEvent(new CustomEvent("acme:close"));\n',
  });
  const r = runHook(dir, "edited.ts");
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stderr, "");
});

test("key set to acme: acme: listeners and dispatchers are paired as before", () => {
  const dir = makeProject("acme", {
    "listener.ts": 'window.addEventListener("acme:open", onOpen);\n',
    "edited.ts":
      'window.dispatchEvent(new CustomEvent("acme:open"));\n' +
      'window.dispatchEvent(new Event("acme:close"));\n' +
      'window.dispatchEvent(new CustomEvent("app:saved"));\n',
  });
  const r = runHook(dir, "edited.ts");
  assert.strictEqual(r.status, 0);
  assert.match(r.stderr, /orphan acme:\* event names detected/);
  assert.match(r.stderr, /dispatched but never listened: acme:close/);
  assert.doesNotMatch(r.stderr, /acme:open/);
  assert.doesNotMatch(r.stderr, /app:saved/);
});

test("configured prefix: an orphan listener with that prefix is still reported", () => {
  const dir = makeProject("acme", {
    "edited.ts": 'document.addEventListener("acme:refresh", onRefresh);\n',
  });
  const r = runHook(dir, "edited.ts");
  assert.strictEqual(r.status, 0);
  assert.match(r.stderr, /orphan acme:\* event names detected/);
  assert.match(r.stderr, /listened but never dispatched: acme:refresh/);
});

test("the configured prefix is matched literally, not as a regular expression", () => {
  const dir = makeProject("my.app", {
    "edited.ts":
      'window.dispatchEvent(new CustomEvent("my.app:go"));\n' +
      'window.dispatchEvent(new CustomEvent("myXapp:go"));\n',
  });
  const r = runHook(dir, "edited.ts");
  assert.strictEqual(r.status, 0);
  assert.match(r.stderr, /dispatched but never listened: my\.app:go/);
  assert.doesNotMatch(r.stderr, /myXapp:go/);
});

test("a key that is not a non-empty string falls back to the default prefix app", () => {
  const dir = makeProject(42, {
    "edited.ts": 'window.dispatchEvent(new CustomEvent("app:saved"));\n',
  });
  const r = runHook(dir, "edited.ts");
  assert.strictEqual(r.status, 0);
  assert.match(r.stderr, /dispatched but never listened: app:saved/);
});
