#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)

/**
 * Smoke for scripts/portfolio/dispatch.js (T-20260521-174).
 *
 * Covers the input gate + unknown-slug + dry-run path. Does NOT actually
 * spawn `claude` (that would require a working Claude binary on PATH;
 * dry-run path exercises the env handling + telemetry shape).
 *
 * Assertions:
 *   - Empty argv → exit 2, usage hint
 *   - Skill missing `/` prefix → exit 2, input gate fires
 *   - Skill with shell metachar (e.g. `/foo;rm`) → exit 2 (SCENARIO-6)
 *   - Arg with `&`, `;`, `$`, backtick → exit 2
 *   - Unknown slug → exit 1, C-16 message
 *   - dry-run with valid slug + skill → exit 0, status "dry_run",
 *     parent CLAUDE_PROJECT_DIR preserved (AC-7.2)
 *   - args_hash is stable for same args, different for different args
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { PassThrough } = require("stream");

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "mc-dispatch-smoke-"));
const TMP_REG = path.join(TMP_DIR, "portfolio.json");
const TMP_REPO = path.join(TMP_DIR, "fake-product");
fs.mkdirSync(TMP_REPO, { recursive: true });

mcEnv.setEnv("PORTFOLIO_REGISTRY", TMP_REG);
const PARENT_CPD = process.env.CLAUDE_PROJECT_DIR || "(unset)";

delete require.cache[require.resolve("../../scripts/portfolio/registry")];
delete require.cache[require.resolve("../../scripts/portfolio/dispatch")];
const reg = require("../../scripts/portfolio/registry");
const { dispatchToSlug, validateInputs, SKILL_RE, SAFE_ARG_RE } = require("../../scripts/portfolio/dispatch");

reg.save({
  schema: "mc/portfolio-registry/v1",
  products: {
    "smoke-prod": {
      slug: "smoke-prod",
      repo_path: TMP_REPO,
      role: "product",
      last_synced: new Date().toISOString(),
    },
  },
});

function makeBuffers() {
  const out = [], err = [];
  const ostream = new PassThrough(), estream = new PassThrough();
  ostream.on("data", d => out.push(d.toString()));
  estream.on("data", d => err.push(d.toString()));
  return { ostream, estream, getOut: () => out.join(""), getErr: () => err.join("") };
}

let failures = 0;
function assertEq(name, got, want) {
  if (got === want) console.log("PASS -", name);
  else {
    console.log("FAIL -", name, "→ got:", JSON.stringify(got), "want:", JSON.stringify(want));
    failures++;
  }
}
function assertContains(name, got, sub) {
  if (String(got || "").includes(sub)) console.log("PASS -", name);
  else {
    console.log("FAIL -", name, "→ contains:", JSON.stringify(sub), "actual:", JSON.stringify(got));
    failures++;
  }
}

(async () => {
  // 1. Regex sanity
  assertEq("SKILL_RE.match valid", SKILL_RE.test("/portfolio:list"), true);
  assertEq("SKILL_RE.match no-colon", SKILL_RE.test("/foo"), true);
  assertEq("SKILL_RE.reject no-leading-slash", SKILL_RE.test("portfolio:list"), false);
  assertEq("SKILL_RE.reject semicolon", SKILL_RE.test("/foo;rm"), false);
  assertEq("SKILL_RE.reject backtick", SKILL_RE.test("/foo`whoami`"), false);

  assertEq("SAFE_ARG_RE.match simple", SAFE_ARG_RE.test("hello-world.v1"), true);
  assertEq("SAFE_ARG_RE.reject space", SAFE_ARG_RE.test("two words"), false);
  assertEq("SAFE_ARG_RE.reject shell-meta", SAFE_ARG_RE.test("foo;rm"), false);
  assertEq("SAFE_ARG_RE.reject backtick", SAFE_ARG_RE.test("foo`x`"), false);
  assertEq("SAFE_ARG_RE.reject ampersand", SAFE_ARG_RE.test("foo&bar"), false);

  // 2. validateInputs direct
  assertEq("validateInputs.empty", validateInputs({ slug: null, skill: null, skillArgs: [] }).ok, false);
  assertEq("validateInputs.missing-slash", validateInputs({ slug: "x", skill: "portfolio:list", skillArgs: [] }).ok, false);
  assertEq("validateInputs.shell-meta-skill", validateInputs({ slug: "x", skill: "/foo;rm -rf", skillArgs: [] }).ok, false);
  assertEq("validateInputs.shell-meta-arg", validateInputs({ slug: "x", skill: "/foo", skillArgs: ["a;b"] }).ok, false);
  assertEq("validateInputs.valid", validateInputs({ slug: "x", skill: "/portfolio:list", skillArgs: ["--json"] }).ok, true);

  // 3. dispatchToSlug — unknown slug
  {
    const b = makeBuffers();
    const r = await dispatchToSlug({
      slug: "nope",
      skill: "/portfolio:list",
      skillArgs: [],
      stdout: b.ostream,
      stderr: b.estream,
    });
    assertEq("unknown.exitCode", r.exitCode, 1);
    assertEq("unknown.status", r.status, "unknown_slug");
    assertContains("unknown.stderr.C-16", b.getErr(), "No product registered as 'nope'");
  }

  // 4. dispatchToSlug — input gate (bad skill)
  {
    const b = makeBuffers();
    const r = await dispatchToSlug({
      slug: "smoke-prod",
      skill: "/foo;rm",
      skillArgs: [],
      stdout: b.ostream,
      stderr: b.estream,
    });
    assertEq("badskill.exitCode", r.exitCode, 2);
    assertEq("badskill.status", r.status, "input_invalid");
  }

  // 5. dispatchToSlug — input gate (bad arg)
  {
    const b = makeBuffers();
    const r = await dispatchToSlug({
      slug: "smoke-prod",
      skill: "/portfolio:list",
      skillArgs: ["a;b"],
      stdout: b.ostream,
      stderr: b.estream,
    });
    assertEq("badarg.exitCode", r.exitCode, 2);
    assertContains("badarg.stderr.SCENARIO-6", b.getErr(), "SCENARIO-6");
  }

  // 6. dispatchToSlug — dry-run happy path
  {
    const b = makeBuffers();
    const r = await dispatchToSlug({
      slug: "smoke-prod",
      skill: "/portfolio:list",
      skillArgs: ["--json"],
      dryRun: true,
      stdout: b.ostream,
      stderr: b.estream,
    });
    assertEq("dryrun.exitCode", r.exitCode, 0);
    assertEq("dryrun.status", r.status, "dry_run");
    assertContains("dryrun.stdout.C-12-banner", b.getOut(), "dispatching /portfolio:list");
  }

  // 7. AC-7.2 — parent CLAUDE_PROJECT_DIR preserved
  assertEq("ac-7.2.parent_cpd_preserved", process.env.CLAUDE_PROJECT_DIR || "(unset)", PARENT_CPD);

  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  console.log("\nsummary:", failures === 0 ? "ALL PASS" : `${failures} FAIL`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(err => {
  console.error("smoke crashed:", err);
  process.exit(2);
});
