#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const UPDATE_JS = path.join(REPO_ROOT, "scripts", "mc", "update.js");

function runTooth() {
  let pass = 0;
  let fail = 0;
  const results = [];
  function ok(name, cond, detail) {
    results.push({ name, status: cond ? "pass" : "fail", detail: cond ? undefined : detail || "" });
    if (cond) {
      process.stdout.write(`  ok  ${name}\n`);
      pass++;
    } else {
      process.stderr.write(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}\n`);
      fail++;
    }
  }

  const versionDoc = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "version.json"), "utf8"));
  const toVersion = versionDoc.version;

  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "mc-update-json-loud-fail-"));
  try {
    const r = spawnSync(
      process.execPath,
      [
        UPDATE_JS,
        "--to",
        toVersion,
        "--source",
        REPO_ROOT,
        "--target",
        sandbox,
        "--apply",
        "--json",
      ],
      { cwd: REPO_ROOT, encoding: "utf8", timeout: 60_000 },
    );

    ok(
      "update.js --json --apply against a target with no installed baseline exits NON-ZERO",
      r.status !== 0 && r.status !== null,
      `status=${r.status} signal=${r.signal} stdout(tail)=${(r.stdout || "").slice(-300)} stderr(tail)=${(r.stderr || "").slice(-300)}`,
    );

    let payload = null;
    try {
      payload = JSON.parse(r.stdout || "{}");
    } catch {
    }
    ok(
      "the --json payload is parseable and reports ok:false (a real structured failure, not a crash/usage error)",
      !!payload && payload.ok === false,
      `payload=${JSON.stringify(payload)}`,
    );
    ok(
      "the failure is a STRUCTURED failure of the loud-fail contract (not an unrelated crash) — robust to WHICH gate/phrase fires",
      !!payload &&
        payload.ok === false &&
        payload.committed !== true &&
        typeof payload.error === "string" &&
        payload.error.length > 0,
      `payload.ok=${payload && payload.ok} payload.committed=${payload && payload.committed} error=${payload && payload.error}`,
    );
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }

  return { pass, fail, results };
}

if (require.main === module) {
  const { pass, fail } = runTooth();
  process.stdout.write(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
}

module.exports = { runTooth };
