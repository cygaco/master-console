#!/usr/bin/env node
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { readYamlMaybe, writeText } = require("./fs");

function withCapturedStderr(fn) {
  const real = process.stderr.write;
  let captured = "";
  process.stderr.write = (chunk, ...rest) => {
    captured += chunk;
    return true;
  };
  try {
    fn();
  } finally {
    process.stderr.write = real;
  }
  return captured;
}

test("environment precondition: js-yaml is NOT resolvable in this repo", () => {
  let resolved = false;
  try {
    require.resolve("js-yaml");
    resolved = true;
  } catch {
    resolved = false;
  }
  assert.equal(
    resolved,
    false,
    "js-yaml became resolvable — the require()-throw content-fact branch in " +
      "readYamlMaybe is no longer dead code; add a direct test for it.",
  );
});

test("readYamlMaybe surfaces a genuinely unparseable line instead of silently dropping it", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "readyaml-corrupt-"));
  const file = path.join(tmp, "current.yaml");
  try {
    const corrupt = [
      "sprint_id: SP-TEST",
      "!!!not a key or an array item!!!",
      "title: hello",
      "",
    ].join("\n");
    writeText(file, corrupt, { force: true });

    const stderrOut = withCapturedStderr(() => {
      const parsed = readYamlMaybe(file);
      const dropped = Object.getOwnPropertyDescriptor(
        parsed,
        "__parseDroppedLines",
      );
      assert.ok(
        dropped,
        "FAULT NOT DETECTED: __parseDroppedLines missing — the corrupt line " +
          "was silently dropped.",
      );
      assert.equal(dropped.enumerable, false, "diagnostic marker must not leak into serialization");
      assert.equal(dropped.value.length, 1);
      assert.equal(dropped.value[0].line, 2);
      assert.match(dropped.value[0].text, /not a key or an array item/);
      assert.equal(parsed.sprint_id, "SP-TEST");
      assert.equal(parsed.title, "hello");
    });
    assert.match(
      stderrOut,
      /CORRUPT/,
      "FAULT NOT DETECTED: no stderr warning was printed for the corrupt line.",
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("no-op guard: the SAME fixture with the fault removed produces no warning and no marker", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "readyaml-clean-"));
  const file = path.join(tmp, "current.yaml");
  try {
    const clean = ["sprint_id: SP-TEST", "title: hello", ""].join("\n");
    writeText(file, clean, { force: true });

    const stderrOut = withCapturedStderr(() => {
      const parsed = readYamlMaybe(file);
      const dropped = Object.getOwnPropertyDescriptor(
        parsed,
        "__parseDroppedLines",
      );
      assert.equal(
        dropped,
        undefined,
        "NO-OP GUARD FAILED: a clean, well-formed file was flagged as having " +
          "dropped lines — the detector is a rubber stamp, not a real check.",
      );
      assert.equal(parsed.sprint_id, "SP-TEST");
      assert.equal(parsed.title, "hello");
    });
    assert.equal(
      stderrOut,
      "",
      "NO-OP GUARD FAILED: a clean file produced a corruption warning on stderr.",
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("readYamlMaybe on a missing file still returns null (unchanged contract)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "readyaml-missing-"));
  try {
    const missing = path.join(tmp, "does-not-exist.yaml");
    assert.equal(readYamlMaybe(missing), null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
