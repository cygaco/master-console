#!/usr/bin/env node
/**
 * delta-canonical-dispatch-smoke.js — verify canonical cross-provider dispatch.
 *
 * For each provider in manifest.agentProviders, fire a tiny test prompt and
 * confirm the binary is reachable + returns a parseable response. On full pass,
 * write .claude/runtime/.canonical-dispatch-smoke-passed marker so the
 * orchestrator (Delta) knows it can dispatch reviewers via the canonical path
 * without first hitting an unverified-block assumption.
 *
 * Run BEFORE first reviewer dispatch in every oneshot run. Mirrors the
 * worktree-smoke pattern (scripts/hooks/worktree-preflight.js + the
 * .worktree-smoke-passed marker).
 *
 * Usage:
 *   node scripts/delta-canonical-dispatch-smoke.js
 *
 * Exit 0 = all providers responded; marker written.
 * Exit 1 = at least one provider failed; marker NOT written.
 *
 * The point is to LEARN whether the bash subprocess path actually works in
 * THIS environment, not to assume based on a prior retro's claim. Run-9 retro
 * Issue #5 said cross-provider was blocked; run-10 inherited that assumption
 * for ~6 hours of all-Claude reviews before testing — at which point both
 * codex and gemini worked fine via the wide Bash permission. Don't repeat.
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MANIFEST = path.join(ROOT, ".claude", "manifest.json");
const RUNTIME = path.join(ROOT, ".claude", "runtime");
const MARKER = path.join(RUNTIME, ".canonical-dispatch-smoke-passed");

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[90m";
const RESET = "\x1b[0m";

function log(c, msg) {
  process.stdout.write(`${c}${msg}${RESET}\n`);
}

const TEST_PROMPT = "Reply with exactly one word: OK";
const TIMEOUT_MS = 60_000;

// Cross-platform invocation. On Windows the CLIs are .cmd shims so shell:true
// is needed. We pass the prompt via stdin where possible (most reliable) and
// only via argv when the CLI doesn't support stdin (claude -p needs argv).
function runShell(cmdline, input = "") {
  const r = spawnSync(cmdline, {
    input,
    encoding: "utf8",
    timeout: TIMEOUT_MS,
    shell: true,
  });
  return {
    exit: r.status,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
  };
}

// Served-content predicate over a `claude -p --output-format json` envelope (ED-281). A refusal /
// error / silent model-fallback MUST fail — the old `exit0 && /OK/i.test(stdout)` check false-greened
// on a served REFUSAL: the model, handed a malformed `"$(cat tmp)"` argv that cmd.exe leaves literal on
// Windows, replied "I'm not going to run that. That prompt is a shell command substitution…" and the
// loose /OK/ substring matched an incidental "ok". Fix = pass the prompt via STDIN (no `$(cat)`) + assert
// the STRUCTURED envelope. PURE — exported for the co-located test's planted fixtures.
function claudeServeOk(exit, stdout, expectedModel, expectedReply) {
  if (exit !== 0) return { ok: false, detail: `exit ${exit}` };
  let env;
  try {
    env = JSON.parse(stdout);
  } catch {
    return { ok: false, detail: "non-JSON envelope" };
  }
  if (!env || env.is_error === true) return { ok: false, detail: "is_error" };
  if (env.subtype !== "success") return { ok: false, detail: `subtype ${env.subtype}` };
  // The SERVED model must be the one we asked for — a silent fallback to another model is a FAIL.
  const served =
    env.modelUsage &&
    typeof env.modelUsage === "object" &&
    Object.values(env.modelUsage).some((m) => m && m.canonicalModel === expectedModel);
  if (!served) return { ok: false, detail: `served model != ${expectedModel}` };
  // STRICT reply match (trimmed, optional trailing punctuation). A refusal/explanation is a full
  // sentence and can never match, so it goes RED — the ED-281 teeth the loose /OK/ substring lacked.
  const reply = typeof env.result === "string" ? env.result.trim() : "";
  if (!new RegExp(`^${expectedReply}[.!]?$`, "i").test(reply)) {
    return { ok: false, detail: `reply ${JSON.stringify(reply.slice(0, 40))} != ${expectedReply}` };
  }
  return { ok: true, detail: "served" };
}

// Run the claude CLI serve canary for ONE model — prompt on STDIN (never a `$(cat)` argv, which cmd.exe
// leaves literal on Windows, ED-281), `--output-format json` for a structured verdict claudeServeOk checks.
function claudeServeCanary(model) {
  const r = runShell(`claude -p --model ${model} --effort max --output-format json`, TEST_PROMPT);
  const v = claudeServeOk(r.exit, r.stdout, model, "OK");
  return { exit: v.ok ? 0 : 1, stdout: v.detail, stderr: r.stderr, ok: v.ok };
}

const providers = {
  claude: {
    cmd: "claude",
    test() {
      // CLI opus canary (ED-281-hardened): prompt via STDIN + --output-format json + a served-content
      // assertion (canonicalModel + STRICT reply), so a refusal / error / silent model-fallback goes RED
      // (the old loose /OK/+exit-0 over a `"$(cat tmp)"` argv false-greened a served refusal on Windows).
      // Canaries BOTH the CLI top pin (claude-opus-5, the 2026-07-24 cutover) AND the still-served fallback
      // (claude-opus-4-8) — dispatch falls back to 4.8 if the opus-5 CLI serve ever fails, so both must be
      // reachable. NB: build-chain builders run claude-sonnet-5@high, NOT opus@max — this canary just proves
      // the CLI serves the top opus at max before Delta relies on the canonical path.
      const top = claudeServeCanary("claude-opus-5");
      const fb = claudeServeCanary("claude-opus-4-8");
      const ok = top.ok && fb.ok;
      return { exit: ok ? 0 : 1, stdout: `opus-5:${top.stdout} · opus-4-8:${fb.stdout}`, stderr: "", ok };
    },
  },
  openai: {
    cmd: "codex",
    test() {
      // codex exec --skip-git-repo-check reads stdin.
      // Use the SAME -m model that dispatch-agent.js will use at runtime
      // (read from OPENAI_FLAGSHIP_MODEL env, default gpt-5.4 since Codex CLI
      // 0.117 rejects gpt-5.5). Smoke must match real dispatch path —
      // run-12 BUG-076 caught with no -m flag; smoke passed but real
      // dispatch with -m gpt-5.5 failed mid-run. HYGIENE Rule 67.
      const model = process.env.OPENAI_FLAGSHIP_MODEL || "gpt-5.5";
      const r = runShell(
        `codex exec -c model_reasoning_effort=xhigh -m ${model} --skip-git-repo-check`,
        TEST_PROMPT,
      );
      return { ...r, ok: r.exit === 0 && /OK/i.test(r.stdout) };
    },
  },
  antigravity: {
    cmd: "agy",
    test() {
      // agy (Antigravity) is the supported Gemini lab — the individual-tier `gemini` CLI is
      // SUNSET (removed in the 2026-07-20 deep-clean). agy SERVE liveness is operator-owned
      // (ED-060) and attested by cert-attest, NOT here (and `agy models` HANGS headless), so this
      // smoke only checks the agy CLI is present + invocable — it never false-greens a serve.
      const r = runShell(`agy --version`);
      return { ...r, ok: r.exit === 0 };
    },
  },
};

function loadManifest() {
  if (!fs.existsSync(MANIFEST)) {
    log(
      RED,
      `[smoke] .claude/manifest.json not found at ${MANIFEST}\n` +
        `        fix: run \`/mc:setup\` to create it (auto-generated at install)\n` +
        `        smoke needs manifest.agentProviders to know which providers to test`,
    );
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  } catch (e) {
    log(
      RED,
      `[smoke] cannot read .claude/manifest.json: ${e.message}\n` +
        `        fix: check permissions or restore from .claude/.mc-backup/`,
    );
    process.exit(1);
  }
}

function uniqueProviders(routing) {
  const set = new Set();
  for (const v of Object.values(routing)) set.add(v);
  return Array.from(set);
}

function main() {
  const manifest = loadManifest();
  const routing = manifest.agentProviders || {};
  const required = uniqueProviders(routing);
  if (required.length === 0) {
    log(YELLOW, "[smoke] manifest.agentProviders empty — nothing to test");
    process.exit(0);
  }

  log(
    DIM,
    `[smoke] testing ${required.length} provider(s) from manifest.agentProviders: ${required.join(", ")}`,
  );

  const results = {};
  let allOk = true;
  for (const p of required) {
    const def = providers[p];
    if (!def) {
      log(RED, `  ✗ ${p}  unknown provider — no smoke test defined`);
      results[p] = { ok: false, reason: "no smoke test defined" };
      allOk = false;
      continue;
    }
    process.stdout.write(`  · ${p.padEnd(8)} `);
    let r;
    try {
      r = def.test();
    } catch (e) {
      r = { exit: -1, stdout: "", stderr: e.message, ok: false };
    }
    if (r.ok) {
      log(
        GREEN,
        `✓  exit=${r.exit}  reply=${(r.stdout || "").trim().slice(0, 60)}`,
      );
      results[p] = { ok: true, exit: r.exit };
    } else {
      log(
        RED,
        `✗  exit=${r.exit}  stderr=${(r.stderr || "").slice(0, 200)}  stdout=${(r.stdout || "").slice(0, 100)}`,
      );
      results[p] = {
        ok: false,
        exit: r.exit,
        stderr: (r.stderr || "").slice(0, 500),
      };
      allOk = false;
    }
  }

  // Roles → provider map summary so the orchestrator knows what's available
  log(DIM, "");
  log(DIM, "[smoke] role → provider routing:");
  for (const [role, prov] of Object.entries(routing)) {
    const status = results[prov]?.ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    log(DIM, `  ${role.padEnd(12)} → ${prov.padEnd(8)} ${status}`);
  }

  if (allOk) {
    fs.mkdirSync(RUNTIME, { recursive: true });
    fs.writeFileSync(
      MARKER,
      JSON.stringify(
        {
          smokedAt: new Date().toISOString(),
          providers: results,
          routing,
        },
        null,
        2,
      ) + "\n",
    );
    log(GREEN, "");
    log(
      GREEN,
      `[smoke] PASS — marker written: ${MARKER.replace(ROOT + path.sep, "")}`,
    );
    log(
      DIM,
      "[smoke] orchestrator can now dispatch reviewers via canonical bash subprocess path.",
    );
    process.exit(0);
  } else {
    log(RED, "");
    log(RED, "[smoke] FAIL — at least one provider unreachable");
    log(
      DIM,
      "[smoke] options: (a) install missing CLI, (b) update manifest.agentProviders to point failing roles at claude as fallback, (c) accept reviewer-on-Claude deviation explicitly in retro",
    );
    process.exit(1);
  }
}

if (require.main === module) main();

// Exported for the co-located ED-281 test (planted-fixture assertions over the served-content predicate).
module.exports = { claudeServeOk, claudeServeCanary };
