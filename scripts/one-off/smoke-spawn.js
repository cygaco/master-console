#!/usr/bin/env node
"use strict";

// Smoke test for scripts/portfolio/spawn.js. Uses WARPOS_PORTFOLIO_REGISTRY
// env override (already supported by registry.js) so we don't touch the real
// portfolio.json under ~/.mc. Tests:
//   (1) active-CWD warning fires when repo_path == cwd; spawn skipped
//   (2) --force overrides the warning (dry-run mode for repeatability)
//   (3) repo_path missing on disk → exit 1
//   (4) dry-run on a valid registered slug picks a terminal binary
//
// Exit 0 if all assertions hold. Non-zero on any failure.

const fs = require("fs");
const os = require("os");
const path = require("path");

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "mc-spawn-smoke-"));
const TMP_REG = path.join(TMP_DIR, "portfolio.json");
const TMP_REPO = path.join(TMP_DIR, "fake-product");
fs.mkdirSync(TMP_REPO, { recursive: true });

process.env.WARPOS_PORTFOLIO_REGISTRY = TMP_REG;

// Reload modules under the new env.
delete require.cache[require.resolve("../../scripts/portfolio/registry")];
delete require.cache[require.resolve("../../scripts/portfolio/spawn")];
const reg = require("../../scripts/portfolio/registry");
const spawnMod = require("../../scripts/portfolio/spawn");
const { spawnForSlug, envSatisfies, probeBinary, PLATFORM_BINARIES } = spawnMod;

// Seed registry with one product.
const nowIso = new Date().toISOString();
const doc = {
  schema: "mc/portfolio-registry/v1",
  products: {
    "smoke-cwd": {
      slug: "smoke-cwd",
      repo_path: process.cwd(),
      role: "product",
      last_synced: nowIso,
    },
    "smoke-elsewhere": {
      slug: "smoke-elsewhere",
      repo_path: TMP_REPO,
      role: "product",
      last_synced: nowIso,
    },
    "smoke-missing": {
      slug: "smoke-missing",
      repo_path: path.join(TMP_DIR, "does-not-exist"),
      role: "product",
      last_synced: nowIso,
    },
  },
};
reg.save(doc);

const { PassThrough } = require("stream");
function makeBuffers() {
  const out = [],
    err = [];
  const ostream = new PassThrough(),
    estream = new PassThrough();
  ostream.on("data", (d) => out.push(d.toString()));
  estream.on("data", (d) => err.push(d.toString()));
  return { ostream, estream, getOut: () => out.join(""), getErr: () => err.join("") };
}

let failures = 0;
function assertEq(name, got, want) {
  const ok = got === want;
  console.log(ok ? "PASS" : "FAIL", "-", name, "→ got:", JSON.stringify(got), "want:", JSON.stringify(want));
  if (!ok) failures++;
}
function assertContains(name, got, sub) {
  const ok = String(got || "").includes(sub);
  console.log(ok ? "PASS" : "FAIL", "-", name, "→ contains:", JSON.stringify(sub));
  if (!ok) {
    console.log("       got:", JSON.stringify(got));
    failures++;
  }
}

// Test 1: unknown slug.
{
  const b = makeBuffers();
  const r = spawnForSlug({ slug: "nope", stdout: b.ostream, stderr: b.estream });
  assertEq("unknown slug exitCode", r.exitCode, 1);
  assertEq("unknown slug status", r.status, "unknown_slug");
  assertContains("unknown slug stderr", b.getErr(), "unknown slug: nope");
}

// Test 2: missing repo_path.
{
  const b = makeBuffers();
  const r = spawnForSlug({ slug: "smoke-missing", stdout: b.ostream, stderr: b.estream });
  assertEq("missing repo exitCode", r.exitCode, 1);
  assertEq("missing repo status", r.status, "repo_path_missing");
  assertContains("missing repo stderr", b.getErr(), "repo_not_found_on_disk");
}

// Test 3: active-CWD warning (AC-4.2 + C-6).
{
  const b = makeBuffers();
  const r = spawnForSlug({ slug: "smoke-cwd", stdout: b.ostream, stderr: b.estream });
  assertEq("active-cwd exitCode", r.exitCode, 0);
  assertEq("active-cwd status", r.status, "active_cwd_skipped");
  assertEq("active-cwd warned", r.warned, true);
  assertEq("active-cwd terminal not used", r.terminal, null);
  assertContains("active-cwd warning copy", b.getOut(), "current working directory");
  assertContains("active-cwd --force hint", b.getOut(), "--force");
}

// Test 4: --force overrides active-CWD (dry-run to skip real spawn).
{
  const b = makeBuffers();
  const r = spawnForSlug({
    slug: "smoke-cwd",
    force: true,
    dryRun: true,
    stdout: b.ostream,
    stderr: b.estream,
  });
  assertEq("--force exitCode", r.exitCode, 0);
  assertEq("--force status", r.status, "ok");
  assertEq("--force warned (no warning printed)", r.warned, false);
  // Terminal picked must be a known platform binary name OR fallback_copyable.
  // 'code' (VS Code) was added at top priority in T-20260522-186; it's only
  // selected when TERM_PROGRAM=vscode AND `code` resolves on PATH.
  const known = new Set([
    "code",
    "wt",
    "powershell",
    "cmd",
    "iterm",
    "terminal.app",
    "gnome-terminal",
    "xterm",
    "fallback_copyable",
  ]);
  assertEq("--force terminal in known set", known.has(r.terminal), true);
}

// Test 5: dry-run on smoke-elsewhere (real repo_path, not cwd) — should pick a
// terminal binary on win32, OR print copyable fallback on a platform where
// none probe positive.
{
  const b = makeBuffers();
  const r = spawnForSlug({
    slug: "smoke-elsewhere",
    dryRun: true,
    stdout: b.ostream,
    stderr: b.estream,
  });
  assertEq("dry-run exitCode", r.exitCode, 0);
  const okStatuses = new Set(["ok", "fallback_copyable"]);
  assertEq("dry-run status in {ok, fallback_copyable}", okStatuses.has(r.status), true);
}

// ── T-20260522-186: VS Code 'code -n' preference (TERM_PROGRAM=vscode) ──
//
// AC-3.1: When TERM_PROGRAM=vscode AND `code` is on PATH, spawn picks the
//         'code' entry instead of wt/iterm/gnome-terminal.
// AC-3.2: When TERM_PROGRAM=vscode AND `code` is NOT on PATH, the 'code'
//         entry probes false and we fall through to wt/iterm/gnome-terminal.
// AC-3.3: When TERM_PROGRAM is unset (or any non-'vscode' value), the
//         'code' entry's requiresEnv predicate short-circuits to false —
//         existing top-priority binary is picked. No behavior change for
//         users outside VS Code.
//
// We test against probeBinary + envSatisfies directly (deterministic, no
// dependency on whether `code` happens to be on the test host's PATH)
// PLUS an integration check against spawnForSlug with opts.env injection.

// envSatisfies — pure-function unit checks (AC-3.3 supporting evidence).
{
  assertEq(
    "envSatisfies — no requiresEnv → true",
    envSatisfies(undefined, {}),
    true,
  );
  assertEq(
    "envSatisfies — TERM_PROGRAM=vscode matches",
    envSatisfies({ TERM_PROGRAM: "vscode" }, { TERM_PROGRAM: "vscode" }),
    true,
  );
  assertEq(
    "envSatisfies — TERM_PROGRAM=iTerm.app does NOT match vscode req",
    envSatisfies({ TERM_PROGRAM: "vscode" }, { TERM_PROGRAM: "iTerm.app" }),
    false,
  );
  assertEq(
    "envSatisfies — TERM_PROGRAM unset does NOT match vscode req",
    envSatisfies({ TERM_PROGRAM: "vscode" }, {}),
    false,
  );
}

// probeBinary respects requiresEnv (AC-3.3 — env predicate short-circuit
// makes the probe deterministic without ever spawning the probe command).
{
  // When the env predicate is unmet, probeBinary returns false immediately
  // without invoking the underlying probe. Verified by using a probe that
  // would otherwise always succeed (`node --version`).
  const v = probeBinary(
    "node",
    ["--version"],
    { TERM_PROGRAM: "vscode" },
    { TERM_PROGRAM: "not-vscode" },
  );
  assertEq("probeBinary — env unmet → false even if probe would succeed", v, false);

  // When env predicate IS met, probeBinary delegates to the real probe.
  const v2 = probeBinary(
    "node",
    ["--version"],
    { TERM_PROGRAM: "vscode" },
    { TERM_PROGRAM: "vscode" },
  );
  assertEq("probeBinary — env met + probe succeeds → true", v2, true);
}

// PLATFORM_BINARIES on current platform contains the 'code' entry at index 0
// for all three supported platforms.
{
  const platform = process.platform;
  const list = PLATFORM_BINARIES[platform];
  if (list) {
    assertEq(
      `PLATFORM_BINARIES.${platform}[0].name === 'code'`,
      list[0] && list[0].name,
      "code",
    );
    assertEq(
      `PLATFORM_BINARIES.${platform}[0].requiresEnv.TERM_PROGRAM === 'vscode'`,
      list[0] && list[0].requiresEnv && list[0].requiresEnv.TERM_PROGRAM,
      "vscode",
    );
  }
}

// AC-3.3 integration: TERM_PROGRAM unset → spawnForSlug skips the 'code'
// entry (requiresEnv unmet) and picks an existing top-priority binary.
{
  const b = makeBuffers();
  const r = spawnForSlug({
    slug: "smoke-elsewhere",
    dryRun: true,
    stdout: b.ostream,
    stderr: b.estream,
    env: { /* TERM_PROGRAM intentionally absent */ },
  });
  assertEq("AC-3.3 exitCode", r.exitCode, 0);
  // Must NOT have picked 'code' (env predicate not met).
  if (r.terminal !== null) {
    assertEq("AC-3.3 terminal !== 'code'", r.terminal !== "code", true);
  }
  const okStatuses = new Set(["ok", "fallback_copyable"]);
  assertEq("AC-3.3 status in {ok, fallback_copyable}", okStatuses.has(r.status), true);
}

// AC-3.2 integration: TERM_PROGRAM=vscode + 'code' NOT on PATH → fall
// through to the next-priority terminal binary. We simulate "not on PATH"
// by intercepting probeBinary in a way the implementation accepts: there
// is no public hook, so we instead assert the FALLTHROUGH PROPERTY of the
// PLATFORM_BINARIES list: removing the 'code' entry and re-running
// spawnForSlug under TERM_PROGRAM=vscode must yield the same result as
// any other terminal pick (i.e. fall through preserves correctness).
{
  const platform = process.platform;
  const list = PLATFORM_BINARIES[platform];
  if (list && list[0] && list[0].name === "code") {
    // Temporarily splice the code entry out, exercise spawnForSlug, then
    // restore. This mirrors the production behavior when `code` is absent
    // from PATH because `where code` (or `which code`) returns non-zero,
    // and the loop continues to the next entry.
    const removed = list.shift();
    try {
      const b = makeBuffers();
      const r = spawnForSlug({
        slug: "smoke-elsewhere",
        dryRun: true,
        stdout: b.ostream,
        stderr: b.estream,
        env: { TERM_PROGRAM: "vscode" },
      });
      assertEq("AC-3.2 exitCode (code-removed → fallthrough)", r.exitCode, 0);
      assertEq("AC-3.2 terminal !== 'code'", r.terminal !== "code", true);
      const okStatuses = new Set(["ok", "fallback_copyable"]);
      assertEq("AC-3.2 status in {ok, fallback_copyable}", okStatuses.has(r.status), true);
    } finally {
      list.unshift(removed);
    }
  }
}

// AC-3.1 integration: TERM_PROGRAM=vscode AND `code` on PATH → 'code' is
// picked. This depends on host PATH; if `code` is absent locally we treat
// the assertion as a SKIP (recorded as a pass with note) rather than a
// FAIL, since CI nodes may not have VS Code installed.
{
  const platform = process.platform;
  const codeEntry = PLATFORM_BINARIES[platform] && PLATFORM_BINARIES[platform][0];
  const codeOnPath =
    codeEntry &&
    probeBinary(
      codeEntry.probe,
      codeEntry.probeArgs,
      /* requiresEnv */ undefined,
      /* env */ undefined,
    );
  if (codeOnPath) {
    const b = makeBuffers();
    const r = spawnForSlug({
      slug: "smoke-elsewhere",
      dryRun: true,
      stdout: b.ostream,
      stderr: b.estream,
      env: { TERM_PROGRAM: "vscode" },
    });
    assertEq("AC-3.1 exitCode", r.exitCode, 0);
    assertEq("AC-3.1 terminal === 'code'", r.terminal, "code");
    assertEq("AC-3.1 status === 'ok'", r.status, "ok");
  } else {
    console.log(
      "SKIP - AC-3.1 (TERM_PROGRAM=vscode + code on PATH → terminal=='code') — `code` not on PATH on this host; covered by AC-3.2 fallthrough + envSatisfies unit checks.",
    );
  }
}

// Cleanup.
fs.rmSync(TMP_DIR, { recursive: true, force: true });

console.log("\nsummary:", failures === 0 ? "ALL PASS" : `${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
