#!/usr/bin/env node
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

const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
function isSafeModelId(m) {
  return typeof m === "string" && MODEL_ID_RE.test(m);
}

const CODEX_PROMPT = "Reply with exactly: OK <the exact model id you are running as>";

function codexServeOk(exit, stdout, requestedModel, stderr) {
  if (exit !== 0) return { ok: false, detail: `exit ${exit}` };
  const reply = String(stdout || "").trim();
  if (!/^OK\b/i.test(reply)) return { ok: false, detail: "no OK reply" };
  const header = /^model:\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*$/im.exec(String(stderr || ""));
  if (!header) return { ok: false, detail: "codex printed no `model:` line" };
  if (header[1].toLowerCase() !== String(requestedModel).toLowerCase()) {
    return { ok: false, detail: `codex model ${header[1]} != requested ${requestedModel}` };
  }
  const self = /^OK[\s:]+([A-Za-z0-9][A-Za-z0-9._-]*)/i.exec(reply);
  return { ok: true, detail: `codex model ${header[1]}${self ? ` (self-reported ${self[1]}, information only)` : ""}` };
}

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
  const served =
    env.modelUsage &&
    typeof env.modelUsage === "object" &&
    Object.values(env.modelUsage).some((m) => m && m.canonicalModel === expectedModel);
  if (!served) return { ok: false, detail: `served model != ${expectedModel}` };
  const reply = typeof env.result === "string" ? env.result.trim() : "";
  if (!new RegExp(`^${expectedReply}[.!]?$`, "i").test(reply)) {
    return { ok: false, detail: `reply ${JSON.stringify(reply.slice(0, 40))} != ${expectedReply}` };
  }
  return { ok: true, detail: "served" };
}

function claudeServeCanary(model) {
  const r = runShell(`claude -p --model ${model} --effort max --output-format json`, TEST_PROMPT);
  const v = claudeServeOk(r.exit, r.stdout, model, "OK");
  return { exit: v.ok ? 0 : 1, stdout: v.detail, stderr: r.stderr, ok: v.ok };
}

const providers = {
  claude: {
    cmd: "claude",
    test() {
      const top = claudeServeCanary("claude-opus-5");
      const fb = claudeServeCanary("claude-opus-4-8");
      const ok = top.ok && fb.ok;
      return { exit: ok ? 0 : 1, stdout: `opus-5:${top.stdout} · opus-4-8:${fb.stdout}`, stderr: "", ok };
    },
  },
  openai: {
    cmd: "codex",
    test() {
      const model = process.env.OPENAI_FLAGSHIP_MODEL || "gpt-5.6-sol";
      if (!isSafeModelId(model)) {
        return { exit: -1, stdout: "", stderr: `refused: OPENAI_FLAGSHIP_MODEL is not a valid model id (${JSON.stringify(String(model).slice(0, 40))})`, ok: false };
      }
      const { safeSpawnSync } = require("./dispatch/safe-spawn");
      const r = safeSpawnSync(
        "codex",
        ["exec", "--sandbox", "workspace-write", "-c", "model_reasoning_effort=xhigh", "-m", model, "-"],
        { input: CODEX_PROMPT, timeoutMs: TIMEOUT_MS },
      );
      const exit = typeof r.exitCode === "number" ? r.exitCode : r.ok ? 0 : 1;
      const v = codexServeOk(exit, r.stdout || "", model, r.stderr || "");
      return { exit: v.ok ? 0 : exit || 1, stdout: v.ok ? v.detail : `${v.detail} | ${(r.stdout || "").slice(0, 80)}`, stderr: r.stderr || r.reason || "", ok: v.ok };
    },
  },
  antigravity: {
    cmd: "agy",
    test() {
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
        `        fix: check permissions or restore it from an install backup under .mc-backup/`,
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
      "[smoke] every configured provider passed its smoke test.",
    );
    process.exit(0);
  } else {
    log(RED, "");
    log(RED, "[smoke] FAIL — at least one provider failed its smoke test");
    log(
      DIM,
      "[smoke] options: (a) install missing CLI, (b) update manifest.agentProviders to point failing roles at claude as fallback, (c) accept reviewer-on-Claude deviation explicitly in retro",
    );
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { claudeServeOk, claudeServeCanary, codexServeOk, isSafeModelId };
