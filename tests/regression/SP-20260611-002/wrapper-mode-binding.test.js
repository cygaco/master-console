#!/usr/bin/env node
// wrapper-mode-binding.test.js - SP-20260611-002 follow-on T-20260611-321.
//
// The old gap: dispatch-agent.js / dispatch-claude.js consulted the dispatch
// contract without the live mode, so mode_profiles narrowing was dead at the
// wrapper call sites. This test runs the REAL wrappers offline with a sealed
// temp mode.json + a narrowed contract fixture. No live provider or Claude CLI is
// called; the same wrapper code path still reaches the contract consult.
"use strict";
const mcEnv = require("../../../scripts/hooks/lib/mc-env"); // S-OS-06 read-both env (clears MC_X and the legacy name together)

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const DISPATCH_AGENT = path.join(ROOT, "scripts", "dispatch-agent.js");
const DISPATCH_CLAUDE = path.join(ROOT, "scripts", "dispatch-claude.js");
const CONTRACT = path.join(ROOT, ".claude", "agents", "_org", "dispatch-contract.json");

let pass = 0;
let fail = 0;
function ok(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    fail++;
    console.log(`FAIL  ${name}\n      ${e.stack || e.message}`);
  }
}

function tmpDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `SP-20260611-002-T321-${label}-`));
}

function writeSprintModeProject() {
  const dir = tmpDir("mode");
  fs.mkdirSync(path.join(dir, ".claude", "runtime"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".claude", "runtime", "mode.json"),
    JSON.stringify({ mode: "sprint" }),
  );
  return dir;
}

function writeNarrowedContract() {
  const dir = tmpDir("contract");
  const c = JSON.parse(fs.readFileSync(CONTRACT, "utf8"));
  c.mode_profiles.sprint.class_shapes.cross_provider_reviewer = [];
  c.mode_profiles.sprint.class_shapes.build_chain_worker = [];
  const file = path.join(dir, "dispatch-contract.json");
  fs.writeFileSync(file, JSON.stringify(c, null, 2));
  return file;
}

function writePrompt() {
  const file = path.join(tmpDir("prompt"), "prompt.md");
  fs.writeFileSync(file, "fixture prompt\n");
  return file;
}

function writeFakeClaude() {
  const file = path.join(tmpDir("fake-claude"), "fake-claude.js");
  fs.writeFileSync(file, 'process.stdout.write("fixture builder output\\n");\n');
  return file;
}

function writeProviderShim() {
  const file = path.join(tmpDir("shim"), "provider-shim.js");
  fs.writeFileSync(
    file,
    `
"use strict";
const path = require("path");
const Module = require("module");
const ROOT = ${JSON.stringify(ROOT)};
const lockPath = require.resolve(path.join(ROOT, "scripts/hooks/lib/concurrency-lock"));
const provPath = require.resolve(path.join(ROOT, "scripts/hooks/lib/providers"));
const origLoad = Module._load;
Module._load = function(request, parent, isMain) {
  const resolved = (() => {
    try {
      return require.resolve(request, { paths: parent ? [path.dirname(parent.filename)] : undefined });
    } catch {
      return null;
    }
  })();
  if (resolved === lockPath) {
    return {
      acquireSlotSync: () => ({ fake: true }),
      releaseSlot: () => {},
    };
  }
  if (resolved === provPath) {
    const real = origLoad.apply(this, arguments);
    return Object.assign({}, real, {
      providerAvailable: () => true,
      getProviderForRole: () => "openai",
      runProvider: (role) => ({
        ok: true,
        provider: "openai",
        model: "fixture-model",
        output: JSON.stringify({ agent: role, verdict: "PASS", findings: [], requiresHuman: false }),
      }),
    });
  }
  return origLoad.apply(this, arguments);
};
`,
  );
  return file;
}

function baseEnv(modeProject, contractFile, enforce) {
  const ledgerDir = tmpDir("ledger");
  const env = {
    ...process.env,
    CLAUDE_PROJECT_DIR: modeProject,
    MC_DISPATCH_CONTRACT_PATH: contractFile,
    DISPATCH_LEDGER_DIR: ledgerDir,
  };
  if (enforce) env.MC_DISPATCH_CONTRACT_ENFORCE = "block";
  else mcEnv.unsetEnv("DISPATCH_CONTRACT_ENFORCE", env);
  mcEnv.unsetEnv("MODE", env);
  return env;
}

function runAgent({ enforce }) {
  const modeProject = writeSprintModeProject();
  const contractFile = writeNarrowedContract();
  const prompt = writePrompt();
  const shim = writeProviderShim();
  const env = baseEnv(modeProject, contractFile, enforce);
  env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ? process.env.NODE_OPTIONS + " " : ""}--require ${shim}`;
  return spawnSync(process.execPath, [DISPATCH_AGENT, "security-reviewer", prompt, "--provider", "openai"], {
    cwd: ROOT,
    env,
    encoding: "utf8",
    timeout: 60000,
  });
}

function runClaude({ enforce }) {
  const modeProject = writeSprintModeProject();
  const contractFile = writeNarrowedContract();
  const prompt = writePrompt();
  const fakeClaude = writeFakeClaude();
  const worktree = tmpDir("worktree");
  fs.writeFileSync(path.join(worktree, ".git"), "gitdir: /tmp/mc-fixture-worktree.git\n");
  const env = baseEnv(modeProject, contractFile, enforce);
  env.DISPATCH_CLAUDE_BIN = process.execPath;
  env.DISPATCH_CLAUDE_BIN_ARGS = JSON.stringify([fakeClaude]);
  return spawnSync(process.execPath, [DISPATCH_CLAUDE, "builder", prompt, "--worktree", worktree], {
    cwd: ROOT,
    env,
    encoding: "utf8",
    timeout: 60000,
  });
}

function parseLastJson(stdout) {
  const lines = String(stdout || "").trim().split(/\r?\n/).filter(Boolean);
  return lines.length ? JSON.parse(lines[lines.length - 1]) : null;
}

ok("wrappers-thread-mode-at-both-relocated-call-sites", () => {
  const agent = runAgent({ enforce: true });
  const claude = runClaude({ enforce: true });
  assert.match(agent.stderr, /NARROWED OUT by mode 'sprint'/, "dispatch-agent did not pass sprint mode into validateDispatch");
  assert.match(claude.stderr, /NARROWED OUT by mode 'sprint'/, "dispatch-claude did not pass sprint mode into validateDispatchForClass");
});

ok("mode-narrowing-gates-live-dispatch", () => {
  const agent = runAgent({ enforce: true });
  const claude = runClaude({ enforce: true });
  assert.strictEqual(agent.status, 1, `dispatch-agent should refuse under enforce; stderr=${agent.stderr}`);
  assert.strictEqual(claude.status, 1, `dispatch-claude should refuse under enforce; stderr=${claude.stderr}`);
  assert.strictEqual(parseLastJson(agent.stdout).error, "dispatch_contract_violation");
  assert.strictEqual(parseLastJson(claude.stdout).reason, "dispatch_contract_violation");
});

ok("report-only-ramp-preserved-not-blocking", () => {
  const agent = runAgent({ enforce: false });
  const claude = runClaude({ enforce: false });
  assert.strictEqual(agent.status, 0, `dispatch-agent report-only should proceed; stderr=${agent.stderr}`);
  assert.strictEqual(claude.status, 0, `dispatch-claude report-only should proceed; stderr=${claude.stderr}`);
  assert.match(agent.stderr, /dispatch-contract advisory: .*NARROWED OUT by mode 'sprint'/);
  assert.match(claude.stderr, /dispatch-contract advisory: .*NARROWED OUT by mode 'sprint'/);
  assert.strictEqual(parseLastJson(agent.stdout).ok, true);
  assert.strictEqual(parseLastJson(claude.stdout).ok, true);
});

console.log(`\nwrapper-mode-binding: ${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
