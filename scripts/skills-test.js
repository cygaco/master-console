#!/usr/bin/env node
"use strict";
const mcEnv = require("./hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)

/**
 * skills-test.js — the §13.6 "earn-it" HARNESS for subprocess skill dispatch.
 *
 * The SKILL analog of `agents:test` (scripts/agents/cli.js test). A skill may NOT be
 * trusted as `execution: subprocess` until a real bounded smoke dispatch PROVES it
 * runs correctly headless (§13.6 — "no assumed subprocess-able"; the cautionary tale
 * is the systems manifest's 119/119 entries stuck at status:'untested'). This harness
 * runs that bounded smoke per subprocess-classified skill and STAMPS the registry on
 * pass — fail-closed on fail. "Propose, don't trust" → "earn it, don't assign it."
 *
 * TWO MODES (the agents:test --no-ping shape):
 *   --mode resolve (DEFAULT)  Token-free ROUTABILITY check via
 *                             `dispatch-skill.js --resolve`: locate the skill .md,
 *                             read its execution class, confirm it resolves to the
 *                             NAMED skill. NO spawn, NO spend, NO stamp. Records
 *                             verified_level:"resolve" — this is NOT full §13.6
 *                             verification (routability only).
 *   --mode ping               REAL bounded smoke dispatch via dispatch-skill.js (a
 *                             tiny ping payload, --force-subprocess), asserting the
 *                             §13.6 (a)-(d) gate:
 *                               (a) returns within the timeout — NO reap (RI-004),
 *                               (b) it resolved/invoked the NAMED skill (not a
 *                                   wrong/no-op skill),
 *                               (c) a parseable lean envelope,
 *                               (d) exit 0 + a backing completion run_id.
 *                             On PASS → stamp subprocess_verified:{date,run_id} into
 *                             the registry (atomic write). On FAIL → fail-closed, NOT
 *                             stamped, surface the failure. An `inline-required` skill
 *                             correctly FAILS a subprocess smoke — that failure is the
 *                             SIGNAL (keep it inline), not a bug.
 *
 * HONEST SCOPE (operator-directed, recorded in the epic): the 6 real heavy subprocess
 * skills (scan:full / research:deep / qa:audit / redteam:full / sleep:deep /
 * learn:deep) are heavy-by-design — a real ping spawn of each is expensive and they
 * are NOT stamped by a routine harness run this session. This file is THE HARNESS +
 * the token-free resolve mode + the fixture-proven ping path. The fixture test
 * (skills-test.test.js) stamps/fails-closed on FIXTURE skills, NOT the 6 real heavy
 * skills. Running `--mode ping` against a real heavy skill is a deliberate, expensive,
 * future action — see the deferral note at the bottom of benchmark-pack/README.md.
 *
 * Usage:
 *   node scripts/skills-test.js                         # resolve every subprocess skill (token-free)
 *   node scripts/skills-test.js --skill scan:full       # one skill
 *   node scripts/skills-test.js --mode ping --skill X   # REAL bounded smoke (spends) + stamp on pass
 *   node scripts/skills-test.js --registry <path>       # use an alternate registry (fixtures/tests)
 *   node scripts/skills-test.js --json                  # machine-readable summary
 *
 * Test seam (no real `claude`, no spend — the fixture test sets these):
 *   SKILLS_TEST_DISPATCH        — path to a dispatch-skill.js to invoke (default: sibling)
 *   DISPATCH_SKILL_BIN          — passed through to dispatch-skill.js (a fake node bin)
 *   DISPATCH_SKILL_BIN_ARGS     — "
 *   DISPATCH_LEDGER_DIR          — "  (isolate the completion/death ledger)
 *   DISPATCH_SKILL_RUNS_DIR      — "  (isolate the artifact dir)
 *   DISPATCH_SKILL_TIMEOUT_MS    — "  (bound override)
 *   SKILLS_TEST_RESOLVE_OVERRIDE — JSON map { skill: { found, execution, ... } } so a
 *                                  fixture can force resolve outcomes without a real
 *                                  .claude/commands/ tree (P5 isolation).
 *
 * Exit codes:
 *   0 — every tested skill passed its mode's gate (resolve OR ping).
 *   1 — at least one skill FAILED (fail-closed; the failure is surfaced + not stamped).
 *   2 — usage / registry-load failure.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const PROJECT =
  process.env.CLAUDE_PROJECT_DIR ||
  mcEnv.readEnv("PROJECT_DIR") ||
  path.resolve(__dirname, "..");

const DEFAULT_REGISTRY = path.join(PROJECT, ".claude", "runtime", "skill-weight.json");
const SKILL_WEIGHT_GEN = path.join(__dirname, "dispatch", "skill-weight.js");
const DISPATCH_SKILL =
  process.env.SKILLS_TEST_DISPATCH || path.join(__dirname, "dispatch-skill.js");

// Bounded smoke timeout for ping mode (overridable). Raised to 180s (was 120s):
// prior ε evidence showed OK pings up to 128s and REAP runs at 150s that were
// IN-KERNEL TIMEOUT reaps — a real ping that legitimately ran ~150s was being killed
// by a too-tight bound, masquerading as the RI-004 reap (ticket T-20260608-269). The
// durable-file spawn + retry in dispatch-skill.js handles the OUTER-harness reap; a
// roomier bound stops the in-kernel timeout from reaping a slow-but-honest ping.
const PING_TIMEOUT_MS = parseInt(process.env.DISPATCH_SKILL_TIMEOUT_MS || "180000", 10);

// ── Registry load (regenerate via skill-weight.js if absent) ──
function loadRegistry(registryPath) {
  if (!fs.existsSync(registryPath)) {
    // Regenerate via the generator — but ONLY for the default (live) registry. A
    // missing EXPLICIT --registry is a hard error (the caller pointed at it).
    if (registryPath === DEFAULT_REGISTRY) {
      const r = spawnSync(process.execPath, [SKILL_WEIGHT_GEN], {
        cwd: PROJECT,
        encoding: "utf8",
        timeout: 60000,
      });
      if (r.status !== 0 || !fs.existsSync(registryPath)) {
        throw new Error(
          `registry missing and skill-weight.js regen failed (status ${r.status}): ${r.stderr || ""}`,
        );
      }
    } else {
      throw new Error(`--registry path does not exist: ${registryPath}`);
    }
  }
  const reg = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  if (!reg || typeof reg !== "object" || !reg.candidates) {
    throw new Error(`registry has no candidates block: ${registryPath}`);
  }
  return reg;
}

/** The subprocess-classified skills in the registry (those the harness tests). */
function subprocessSkills(reg) {
  return Object.entries(reg.candidates)
    .filter(([, c]) => c && c.execution === "subprocess")
    .map(([slug]) => slug);
}

// ── Resolve seam (token-free; --mode resolve) ───────────────
// Calls dispatch-skill.js --resolve OR a fixture override. Returns the resolve
// envelope object. SKILLS_TEST_RESOLVE_OVERRIDE lets a fixture force outcomes with
// no real .claude/commands/ tree (P5 isolation).
function resolveOne(slug) {
  let override = null;
  try {
    override = JSON.parse(process.env.SKILLS_TEST_RESOLVE_OVERRIDE || "null");
  } catch {
    override = null;
  }
  if (override && Object.prototype.hasOwnProperty.call(override, slug)) {
    const o = override[slug];
    return {
      skill: slug,
      found: !!o.found,
      path: o.path || null,
      execution: o.execution || null,
      subprocess_eligible: o.execution === "subprocess" && !!o.found,
      verified_level: "resolve",
      run_id: o.run_id || `resolve-${slug}-${Date.now()}`,
      ...(o.reason ? { reason: o.reason } : {}),
    };
  }
  const r = spawnSync(
    process.execPath,
    [DISPATCH_SKILL, "--resolve", "--skill", slug],
    { cwd: PROJECT, encoding: "utf8", timeout: 30000 },
  );
  try {
    return JSON.parse((r.stdout || "").trim().split(/\r?\n/).pop());
  } catch {
    return { skill: slug, found: false, execution: null, subprocess_eligible: false, verified_level: "resolve", reason: `unparseable resolve output: ${(r.stdout || r.stderr || "").slice(0, 160)}` };
  }
}

/**
 * testResolve(slug, declaredExecution?) -> { skill, mode:"resolve", pass,
 *   verified_level:"resolve", ... }
 *
 * ROUTABILITY only — NEVER stamps subprocess_verified (verified_level:resolve).
 * PASS = the resolver LOCATED the NAMED skill (found:true) AND the skill is a
 * subprocess candidate.
 *
 * Eligibility basis: routability is "the named skill exists + the REGISTRY UNDER TEST
 * classifies it `subprocess`". We deliberately use `declaredExecution` (the registry's
 * own class) rather than the resolve envelope's `subprocess_eligible`, because the
 * resolve envelope is computed from the LIVE dispatch-contract — which fail-closed
 * DOWNGRADES every unverified subprocess candidate to `inline`. That downgrade is a
 * dispatch decision, not a routability fact; using it here would make every
 * not-yet-verified subprocess skill (correctly) fail routability, which is the wrong
 * signal for this gate. `inline-required` in the registry is NEVER routable. When no
 * declared class is supplied (single ad-hoc skill not in a registry), we fall back to
 * the resolve envelope's eligibility.
 */
function testResolve(slug, declaredExecution) {
  const res = resolveOne(slug);
  // (b) it resolved the NAMED skill (not a wrong/no-op one).
  const namedMatch = res && (res.skill === slug || res.skill === slug.replace(/^\//, ""));
  const eligible =
    declaredExecution != null
      ? declaredExecution === "subprocess"
      : !!(res && res.subprocess_eligible);
  const pass = !!(res && res.found && namedMatch && eligible);
  const classLabel = declaredExecution != null ? declaredExecution : res && res.execution;
  return {
    skill: slug,
    mode: "resolve",
    pass,
    verified_level: "resolve",
    found: !!(res && res.found),
    execution: classLabel || null,
    run_id: (res && res.run_id) || null,
    reason: pass
      ? undefined
      : !res || !res.found
        ? `did not resolve to a skill .md${res && res.reason ? " (" + res.reason + ")" : ""}`
        : !namedMatch
          ? `resolved a DIFFERENT skill (${res.skill} ≠ ${slug})`
          : `not a subprocess candidate (execution=${classLabel})`,
  };
}

// ── Ping seam (REAL bounded smoke; --mode ping) ─────────────
function pingDispatch(slug) {
  const env = { ...process.env };
  // A tiny ping payload keeps the smoke cheap. --force-subprocess takes the §13.6
  // smoke path for an unverified candidate. The harness, the fake bin, and the
  // ledger isolation are all driven by the inherited env (fixture test sets them).
  if (PING_TIMEOUT_MS) env.DISPATCH_SKILL_TIMEOUT_MS = String(PING_TIMEOUT_MS);
  const r = spawnSync(
    process.execPath,
    [DISPATCH_SKILL, "/" + slug.replace(/^\//, ""), "ping", "--force-subprocess"],
    { cwd: PROJECT, env, encoding: "utf8", timeout: PING_TIMEOUT_MS + 30000 },
  );
  return r;
}

function readLedger(name) {
  const dir = process.env.DISPATCH_LEDGER_DIR;
  if (!dir) return [];
  const f = path.join(dir, name);
  if (!fs.existsSync(f)) return [];
  return fs
    .readFileSync(f, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/**
 * testPing(slug, declaredExecution?) -> { skill, mode:"ping", pass, run_id?, reason? }
 * REAL bounded smoke. Asserts §13.6 (a)-(d). On PASS the CALLER stamps the registry
 * with {date, run_id}; this fn only DECIDES pass/fail + surfaces the backing run_id.
 * `inline-required` (and any context-bound skill) FAILS here — that failure IS the
 * signal to keep it inline.
 *
 * `declaredExecution` (from the REGISTRY UNDER TEST) is the fail-closed first gate: a
 * registry classifying the skill `inline-required` FAILS the smoke WITHOUT spawning —
 * the harness must not depend on the LIVE dispatch-contract to surface that signal (a
 * fixture skill isn't in the live contract, so a contract-only check would false-green
 * it). The dispatch-skill contract refusal remains the second backstop for real skills.
 */
function testPing(slug, declaredExecution) {
  // (pre-a) Fail-closed on the registry's OWN classification: an inline-required
  // (context-bound) skill cannot be a subprocess — that is the §13.6 signal, decided
  // from the registry under test, not the live contract.
  if (declaredExecution === "inline-required") {
    return {
      skill: slug,
      mode: "ping",
      pass: false,
      run_id: null,
      reason: "registry classifies this skill inline-required (context-bound) — it CANNOT be a subprocess; the smoke FAIL is the signal to keep it inline (§13.6)",
    };
  }
  const r = pingDispatch(slug);
  // (a) NO reap → exit 0 (dispatch-skill exits 1 on any reap: timeout/spawn/0-byte/non-zero).
  const exit0 = r.status === 0;
  // (c) a parseable lean envelope on stdout naming the skill + an artifact.
  const out = (r.stdout || "").trim();
  const envelopeOk = /SKILL\s+\/?/.test(out) && /artifact:/.test(out);
  // (b) it invoked the NAMED skill — the envelope's SKILL line carries the slug.
  const namedMatch = out.includes("/" + slug.replace(/^\//, "")) || out.includes(slug);
  // (d) a backing completion run_id (ok:true) on the ledger for THIS skill.
  const comps = readLedger("dispatch-completions.jsonl");
  // SP-20260718-004 R4 same-session choke-point: the backing record must be a VERIFIED liveness record —
  // a forged/unsigned ok:true row cannot prove a skill ran. Default-on (WARPOS_LIVENESS_REQUIRE_SIG=0 opt-out).
  const { isVerifiedLivenessRecord } = require("./dispatch/verified-liveness-read");
  const _reqSig = mcEnv.readEnv("LIVENESS_REQUIRE_SIG") !== "0";
  const backing = comps.find(
    (c) =>
      c &&
      isVerifiedLivenessRecord(c, { requireSignature: _reqSig }) &&
      (c.skill === "/" + slug.replace(/^\//, "") || c.skill === slug),
  );
  const pass = exit0 && envelopeOk && namedMatch && !!backing;
  return {
    skill: slug,
    mode: "ping",
    pass,
    run_id: backing ? backing.dispatch_id || backing.run_id || null : null,
    reason: pass
      ? undefined
      : !exit0
        ? `reap / non-zero exit (status ${r.status}) — §13.6(a) NO-reap failed`
        : !envelopeOk
          ? `no parseable lean envelope on stdout — §13.6(c)`
          : !namedMatch
            ? `envelope did not name the requested skill — §13.6(b)`
            : `no backing ok:true completion record — §13.6(d)`,
  };
}

// ── Stamp (atomic; ping-mode PASS only) ─────────────────────
/**
 * stampVerified(registryPath, reg, slug, run_id) — write
 * subprocess_verified:{date, run_id} for `slug` and atomically replace the registry
 * file. ONLY called on a ping-mode PASS. Resolve mode NEVER stamps (routability ≠
 * verification). A real Date is fine — this is a normal node script (not a hook).
 */
function stampVerified(registryPath, reg, slug, run_id) {
  const cand = reg.candidates[slug];
  if (!cand) return false;
  cand.subprocess_verified = {
    date: new Date().toISOString(),
    run_id: run_id || null,
    verified_level: "ping",
  };
  const tmp = registryPath + ".tmp." + process.pid + "." + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(reg, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, registryPath);
  return true;
}

// ── Orchestration ───────────────────────────────────────────
/**
 * run({ registryPath, skill, mode, stamp }) -> { mode, results[], passed, failed,
 *   stamped[] }. `stamp` defaults true in ping mode (the whole point) — the fixture
 *   test can pass stamp:false to assert pass/fail without mutating its fixture, or
 *   true to assert the stamp landed in the FIXTURE registry.
 */
function run(opts) {
  const registryPath = opts.registryPath || DEFAULT_REGISTRY;
  const mode = opts.mode === "ping" ? "ping" : "resolve";
  const reg = loadRegistry(registryPath);
  let skills;
  if (opts.skill) {
    // A single named skill is ALWAYS tested — even if the registry classified it
    // inline-required or doesn't list it — so a mis-classification (e.g. an
    // inline-required forced through ping) surfaces as a FAIL (the signal), and a
    // hallucinated name surfaces as not-found. No silent skip.
    skills = [opts.skill.replace(/^\//, "")];
  } else {
    skills = subprocessSkills(reg);
  }
  const stamp = opts.stamp != null ? opts.stamp : mode === "ping";
  const results = [];
  const stamped = [];
  for (const slug of skills) {
    const cand = reg.candidates[slug];
    const declaredExecution = cand ? cand.execution : null;
    let res;
    if (mode === "ping" && opts.skill && !cand) {
      // A single named skill that ISN'T in the registry under test = a
      // hallucinated/unknown name. FAIL the ping fail-closed WITHOUT spawning — there
      // is nothing real to verify or stamp. (Resolve mode lets it hit the resolver so
      // the not-found path is exercised; ping mode short-circuits the spend.)
      res = {
        skill: slug,
        mode: "ping",
        pass: false,
        run_id: null,
        reason: `skill '${slug}' is not a candidate in the registry under test — cannot ping-verify a hallucinated/unknown skill (fail-closed)`,
      };
    } else {
      res = mode === "ping" ? testPing(slug, declaredExecution) : testResolve(slug, declaredExecution);
    }
    results.push(res);
    // Stamp ONLY a real registry candidate that PASSED a ping smoke — never a
    // hallucinated/missing name (no candidate to stamp).
    if (mode === "ping" && res.pass && stamp && cand) {
      if (stampVerified(registryPath, reg, slug, res.run_id)) stamped.push(slug);
    }
  }
  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  return { mode, registryPath, results, passed, failed, stamped };
}

// ── arg parsing ─────────────────────────────────────────────
function parseArgs(argv) {
  const out = { registryPath: DEFAULT_REGISTRY, skill: null, mode: "resolve", json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--registry") out.registryPath = path.resolve(argv[++i] || "");
    else if (a === "--skill") out.skill = argv[++i] || null;
    else if (a === "--mode") out.mode = argv[++i] || "resolve";
    else if (a === "--json") out.json = true;
    else if (!out.skill && a[0] !== "-") out.skill = a;
  }
  return out;
}

module.exports = {
  run,
  loadRegistry,
  subprocessSkills,
  testResolve,
  testPing,
  resolveOne,
  stampVerified,
  parseArgs,
  DEFAULT_REGISTRY,
};

// ── CLI ─────────────────────────────────────────────────────
if (require.main === module) {
  const opts = parseArgs(process.argv);
  if (opts.mode !== "resolve" && opts.mode !== "ping") {
    process.stderr.write(`unknown --mode '${opts.mode}' (expected resolve|ping)\n`);
    process.exit(2);
  }
  let summary;
  try {
    summary = run(opts);
  } catch (e) {
    process.stderr.write(`[skills-test] ${e && e.message ? e.message : e}\n`);
    process.exit(2);
  }
  if (opts.json) {
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
  } else {
    process.stdout.write(
      `# skills-test (--mode ${summary.mode}) — ${summary.results.length} subprocess skill(s)\n`,
    );
    for (const r of summary.results) {
      const tag = r.pass ? "ok" : "FAIL";
      const extra =
        summary.mode === "resolve"
          ? `verified_level=resolve${r.execution ? " execution=" + r.execution : ""}`
          : r.run_id
            ? `run_id=${r.run_id}`
            : "";
      process.stdout.write(
        `  ${r.skill}: ${tag} ${extra}${r.reason ? "  — " + r.reason : ""}\n`,
      );
    }
    if (summary.mode === "resolve") {
      process.stdout.write(
        `\nNOTE: --mode resolve verifies ROUTABILITY only (verified_level:resolve) — it does NOT stamp subprocess_verified. Full §13.6 verification needs --mode ping (a real bounded spawn that spends). The 6 heavy skills are intentionally NOT stamped by a routine run — see scripts/dispatch/benchmark-pack/README.md.\n`,
      );
    } else if (summary.stamped.length) {
      process.stdout.write(`\nSTAMPED subprocess_verified: ${summary.stamped.join(", ")}\n`);
    }
    process.stdout.write(
      `\n${summary.passed}/${summary.results.length} passed (${summary.failed} failed).\n`,
    );
  }
  process.exit(summary.failed > 0 ? 1 : 0);
}
