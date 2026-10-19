#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env");

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

function resolveCodexHome(home = os.homedir()) {
  const current = path.join(home, ".codex-mc");
  const legacy = path.join(home, ".codex-warpos");
  try {
    return require("../hooks/lib/mc-dirs").resolvePair(current, legacy, { warn: false });
  } catch {
    return { path: fs.existsSync(current) || !fs.existsSync(legacy) ? current : legacy, deprecated: false };
  }
}
const _codexHomeResolution = resolveCodexHome();
const DEFAULT_CODEX_HOME = mcEnv.readEnv("CODEX_HOME") || _codexHomeResolution.path;
const _codexHomeSeeded = new Set();

function seedCodexHome(dir) {
  if (_codexHomeSeeded.has(dir)) return;
  _codexHomeSeeded.add(dir);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const src = path.join(os.homedir(), ".codex");
    for (const f of ["auth.json", "config.toml"]) {
      const dst = path.join(dir, f);
      if (fs.existsSync(dst)) continue;
      const s = path.join(src, f);
      if (fs.existsSync(s)) fs.copyFileSync(s, dst);
    }
  } catch {
  }
}

function withCodexHome(toolId, env) {
  if (toolId !== "codex") return env;
  if (env && env.CODEX_HOME) return env;
  if (_codexHomeResolution.deprecated && DEFAULT_CODEX_HOME === _codexHomeResolution.path) {
    try {
      require("../hooks/lib/mc-dirs").warnLegacy(_codexHomeResolution, path.join(os.homedir(), ".codex-mc"), DEFAULT_CODEX_HOME);
    } catch {
    }
  }
  seedCodexHome(DEFAULT_CODEX_HOME);
  return { ...(env || {}), CODEX_HOME: DEFAULT_CODEX_HOME };
}

const TOOL_IDS = new Set(["claude", "codex", "node", "git", "taskkill", "agy"]);

const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const AGY_MODEL_DISPLAY = /^[A-Za-z0-9][A-Za-z0-9 .()\-]{0,63}$/;
const EFFORT = /^(low|medium|high|xhigh|max|ultra)$/i;
const SANDBOX = /^(workspace-write|read-only|danger-full-access)$/;
const APPROVAL = /^(never|on-failure|on-request|untrusted)$/;
const SHELL_META = /[`$;&|<>()\s]/;
const INJECT_META = /[`$;&|<>^"%!\r\n\x00]/;
const INJECT_META_ALLOW_NL = /[`$;&|<>^"%!\x00]/;
const INJECT_META_AGY_PAYLOAD = /\x00/;

const CMDLINE_MAX = 32000;
function assembledCmdlineLen(toolPath, args) {
  return String(toolPath || "").length + (args || []).reduce((n, a) => n + String(a).length + 3, 0);
}
const isInRepo = (p) => {
  try {
    const r = path.resolve(p);
    return r === PROJECT_ROOT || r.startsWith(PROJECT_ROOT + path.sep);
  } catch {
    return false;
  }
};
const isUnderDir = (p, dir) => {
  try {
    const r = path.resolve(p);
    const d = path.resolve(dir);
    return r === d || r.startsWith(d + path.sep);
  } catch {
    return false;
  }
};

const ARG_POLICY = {
  codex: {
    subcommands: new Set(["exec"]),
    boolFlags: new Set(["-"]),
    valueFlags: {
      "--sandbox": (v) => SANDBOX.test(v),
      "--ask-for-approval": (v) => APPROVAL.test(v),
      "-m": (v) => TOKEN.test(v),
      "--model": (v) => TOKEN.test(v),
      "-c": (v) => /^[a-z0-9_]+=[A-Za-z0-9._-]+$/i.test(v),
      "-o": (v) => isInRepo(v) || isUnderDir(v, os.tmpdir()),
    },
    positionals: (v) => v === "-",
  },
  agy: {
    subcommands: new Set([]),
    boolFlags: new Set([]),
    valueFlags: {
      "-m": (v) => TOKEN.test(v) || AGY_MODEL_DISPLAY.test(v),
      "--model": (v) => TOKEN.test(v) || AGY_MODEL_DISPLAY.test(v),
      "--print-timeout": (v) => /^[0-9]+(ms|s|m|h)?$/.test(v),
      "--log-file": (v) => typeof v === "string" && v.length > 0 && v.length <= 4096,
      "-p": (v) => typeof v === "string" && v.length > 0 && !INJECT_META_AGY_PAYLOAD.test(v),
    },
    multilineValueFlags: new Set(["-p"]),
    codePayloadValueFlags: new Set(["-p"]),
    positionals: () => false,
  },
  claude: {
    subcommands: new Set([]),
    boolFlags: new Set(["-p", "-w"]),
    valueFlags: {
      "--agent": (v) => TOKEN.test(v),
      "--model": (v) => TOKEN.test(v),
      "--effort": (v) => EFFORT.test(v),
      "--worktree": (v) => isInRepo(v) && !SHELL_META.test(v),
    },
    positionals: () => false,
  },
  node: {
    subcommands: new Set([]),
    boolFlags: new Set([]),
    valueFlags: {},
    positionals: (v) =>
      (path.isAbsolute(v) ? isInRepo(v) : true) && !SHELL_META.test(v),
  },
  taskkill: {
    subcommands: new Set([]),
    boolFlags: new Set(["/T", "/F"]),
    valueFlags: { "/PID": (v) => /^[0-9]+$/.test(v) },
    positionals: () => false,
  },
  git: {
    subcommands: new Set(["diff", "status", "rev-parse", "log"]),
    boolFlags: new Set(["--porcelain", "--name-only", "--cached", "--is-inside-work-tree"]),
    valueFlags: { "-C": (v) => isInRepo(v) },
    positionals: (v) => !SHELL_META.test(v),
  },
};

const AGY_FORBIDDEN_SKIP_PERM = /^--(dangerously-skip-permissions?|yolo|skip-permissions?|allow-all)$/i;

const looksLikeUNC = (v) =>
  /^\\\\/.test(v) || (/^[a-z]:[\\/]/i.test(v) && /\.(exe|cmd|bat|ps1|sh)$/i.test(v));

function consumedValueViolations(flag, v, opts = {}) {
  const out = [];
  if (typeof v !== "string") return out;
  const injectRe = opts.codePayload ? INJECT_META_AGY_PAYLOAD : opts.allowNewline ? INJECT_META_ALLOW_NL : INJECT_META;
  if (injectRe.test(v)) out.push(`value of ${flag} (${JSON.stringify(v)}) contains a command-injection metacharacter`);
  if (!opts.codePayload && looksLikeUNC(v)) out.push(`value of ${flag} (${JSON.stringify(v)}) is a UNC/absolute-executable path`);
  return out;
}

function assertArgs(toolId, args) {
  const violations = [];
  const policy = ARG_POLICY[toolId];
  if (!policy) return { ok: false, violations: [`no arg-policy for tool '${toolId}'`] };
  if (!Array.isArray(args)) return { ok: false, violations: ["args must be an array"] };

  let i = 0;
  let sawSubcommand = false;
  while (i < args.length) {
    const a = args[i];
    if (typeof a !== "string") {
      violations.push(`arg ${i} is not a string`);
      i++;
      continue;
    }
    if (a.indexOf("\x00") !== -1) violations.push(`arg ${i} contains a NUL byte — refused universally (never legitimate; crashes child_process)`);
    if (toolId === "agy" && AGY_FORBIDDEN_SKIP_PERM.test(a)) violations.push(`agy must NEVER carry a skip-permissions/auto-approve flag (${JSON.stringify(a)}) — ADR-0031: the scoped read-only tool-permission is operator-owned; a permission-bypass is refused structurally.`);
    if (SHELL_META.test(a)) violations.push(`arg ${i} (${JSON.stringify(a)}) contains a shell metacharacter/space`);
    if (looksLikeUNC(a)) violations.push(`arg ${i} (${JSON.stringify(a)}) looks like a UNC/absolute-executable path (model must never choose the executable)`);

    if (a.startsWith("-") && a !== "-" && !/^\//.test(a)) {
      if (Object.prototype.hasOwnProperty.call(policy.valueFlags, a)) {
        const v = args[i + 1];
        if (v === undefined) violations.push(`flag ${a} expects a value`);
        else {
          for (const vio of consumedValueViolations(a, v, { allowNewline: !!(policy.multilineValueFlags && policy.multilineValueFlags.has(a)), codePayload: !!(policy.codePayloadValueFlags && policy.codePayloadValueFlags.has(a)) })) violations.push(vio);
          if (!policy.valueFlags[a](v)) violations.push(`flag ${a} got an invalid value ${JSON.stringify(v)}`);
        }
        i += 2;
        continue;
      }
      if (policy.boolFlags.has(a)) {
        i++;
        continue;
      }
      violations.push(`unknown/disallowed flag for ${toolId}: ${JSON.stringify(a)}`);
      i++;
      continue;
    }
    if (/^\//.test(a)) {
      if (Object.prototype.hasOwnProperty.call(policy.valueFlags, a)) {
        const v = args[i + 1];
        if (v === undefined) violations.push(`flag ${a} expects a value`);
        else {
          for (const vio of consumedValueViolations(a, v, { allowNewline: !!(policy.multilineValueFlags && policy.multilineValueFlags.has(a)), codePayload: !!(policy.codePayloadValueFlags && policy.codePayloadValueFlags.has(a)) })) violations.push(vio);
          if (!policy.valueFlags[a](v)) violations.push(`flag ${a} got an invalid value ${JSON.stringify(v)}`);
        }
        i += 2;
        continue;
      }
      if (policy.boolFlags.has(a)) {
        i++;
        continue;
      }
      violations.push(`unknown/disallowed flag for ${toolId}: ${JSON.stringify(a)}`);
      i++;
      continue;
    }
    if (a === "-") {
      if (!policy.boolFlags.has("-")) violations.push(`${toolId} does not accept stdin '-'`);
      i++;
      continue;
    }
    if (!sawSubcommand && policy.subcommands.size) {
      if (policy.subcommands.has(a)) {
        sawSubcommand = true;
        i++;
        continue;
      }
      violations.push(`unknown/disallowed subcommand for ${toolId}: ${JSON.stringify(a)}`);
      i++;
      continue;
    }
    if (!policy.positionals(a)) violations.push(`disallowed positional for ${toolId}: ${JSON.stringify(a)}`);
    i++;
  }
  return { ok: violations.length === 0, violations };
}

function which(cmd) {
  const exts = process.platform === "win32"
    ? [".COM", ".EXE", ".BAT", ".CMD"]
    : [""];
  const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const ext of exts) {
      const cand = path.join(dir, cmd + ext);
      try {
        if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
      } catch {
      }
    }
  }
  return null;
}

function whichAll(cmd) {
  const exts = process.platform === "win32" ? [".COM", ".EXE", ".BAT", ".CMD"] : [""];
  const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const out = [];
  const seen = new Set();
  for (const dir of dirs) {
    for (const ext of exts) {
      const cand = path.join(dir, cmd + ext);
      try {
        if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
          const key = cand.toLowerCase();
          if (!seen.has(key)) { seen.add(key); out.push(cand); }
        }
      } catch { }
    }
  }
  return out;
}

const _versionCache = new Map();
function parseVer(v) {
  const m = String(v || "").match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
function compareVer(a, b) {
  const A = parseVer(a), B = parseVer(b);
  if (!A || !B) return 0;
  for (let i = 0; i < 3; i++) if (A[i] !== B[i]) return A[i] > B[i] ? 1 : -1;
  return 0;
}
const _eqPath = (x, y) => (process.platform === "win32" ? String(x).toLowerCase() === String(y).toLowerCase() : x === y);
const _under = (child, root) => _eqPath(child, root) || (process.platform === "win32" ? child.toLowerCase().startsWith(root.toLowerCase() + path.sep) : child.startsWith(root + path.sep));
const _real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };

function unsafeReason(toolId, real, opts = {}) {
  if (!opts.allowRepoLocal && isInRepo(real)) {
    return `resolved '${toolId}' to a repo-local path (${real}) — refusing (PATH-hijack guard)`;
  }
  const tmp = os.tmpdir();
  if (real === tmp || real.startsWith(tmp + path.sep)) {
    return `resolved '${toolId}' under the OS temp dir (${real}) — refusing (writable-hijack guard)`;
  }
  const approved = (mcEnv.readEnv("APPROVED_TOOL_ROOTS") || "").split(path.delimiter).filter(Boolean);
  if (approved.length && !approved.some((root) => real === root || real.startsWith(root + path.sep))) {
    return `resolved '${toolId}' (${real}) is under no MC_APPROVED_TOOL_ROOTS entry`;
  }
  return null;
}

function probeEnv() {
  const keep = ["PATH", "SystemRoot", "windir", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "TMPDIR", "LANG", "npm_config_prefix", "NPM_CONFIG_PREFIX"];
  const env = {};
  for (const k of keep) if (process.env[k] !== undefined) env[k] = process.env[k];
  return env;
}

let _npmPrefix;
function npmGlobalPrefix() {
  if (_npmPrefix !== undefined) return _npmPrefix;
  _npmPrefix = null;
  try {
    const nd = path.dirname(process.execPath);
    const cli = [path.join(nd, "node_modules", "npm", "bin", "npm-cli.js"), path.join(nd, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js")].find((c) => fs.existsSync(c));
    if (cli) {
      const r = spawnSync(process.execPath, [cli, "prefix", "-g"], { encoding: "utf8", timeout: 15000, windowsHide: true, env: probeEnv() });
      const out = String(r.stdout || "").trim();
      if (!r.error && r.status === 0 && out && path.isAbsolute(out) && !/[\r\n]/.test(out)) _npmPrefix = _real(out);
    }
  } catch { }
  return _npmPrefix;
}

const _pkgDirs = (prefix) => [path.join(prefix, "node_modules", "@openai", "codex"), path.join(prefix, "lib", "node_modules", "@openai", "codex")];

function npmMetaVersion(real, prefix) {
  if (!prefix) return null;
  const rp = _real(prefix);
  for (const d of _pkgDirs(rp)) {
    try {
      const dr = fs.realpathSync(d);
      if (!_under(dr, rp)) continue;
      const j = JSON.parse(fs.readFileSync(path.join(dr, "package.json"), "utf8"));
      const m = j && j.name === "@openai/codex" ? String(j.version || "").match(/^(\d+\.\d+\.\d+)(?:[-+][0-9A-Za-z.+-]*)?$/) : null;
      if (m) return m[1];
    } catch { }
  }
  return null;
}

function toolVersion(p, opts = {}) {
  const real = _real(p);
  const prefix = opts.npmPrefix !== undefined ? opts.npmPrefix : npmGlobalPrefix();
  const key = real + "|" + (prefix || "");
  if (_versionCache.has(key)) return _versionCache.get(key);
  let v = null;
  try {
    if (!unsafeReason("tool", real, opts)) {
      if (isNpmGlobalPath(p, real, prefix)) v = npmMetaVersion(real, prefix);
      else if (![".cmd", ".bat"].includes(path.extname(real).toLowerCase())) {
        const r = spawnSync(real, ["--version"], { encoding: "utf8", timeout: 15000, windowsHide: true, shell: false, env: probeEnv() });
        const m = !r.error && r.status === 0 ? String(r.stdout || "").trim().match(/^(?:codex(?:-cli)?\s+)?v?(\d+\.\d+\.\d+)$/i) : null;
        if (m) v = m[1];
      }
    }
  } catch { }
  _versionCache.set(key, v);
  return v;
}
function isNpmGlobalPath(rawPath, realPath, prefix) {
  const pre = prefix === undefined ? npmGlobalPrefix() : prefix;
  if (!pre) return false;
  const rp = _real(pre);
  const real = _real(realPath || rawPath);
  if (_pkgDirs(rp).some((d) => _under(real, d) || _under(real, _real(d)))) return true;
  const dirReal = _real(path.dirname(path.resolve(String(rawPath))));
  return /^codex/i.test(path.basename(String(rawPath))) && (_eqPath(dirReal, rp) || _eqPath(dirReal, path.join(rp, "bin")));
}
function pickCodexCandidate(candidates) {
  const list = Array.isArray(candidates) ? candidates.filter(Boolean) : [];
  if (list.length === 0) return { chosen: null, reason: "no-candidate" };
  const first = list[0];
  if (list.length === 1) return { chosen: first, reason: "single-candidate" };
  const npm = list.find((c) => c.npm);
  if (!npm) return { chosen: first, reason: "no-npm-global-candidate" };
  if (npm === first) return { chosen: first, reason: "npm-global-first-on-path" };
  if (compareVer(npm.version, first.version) > 0) return { chosen: npm, reason: "npm-global-newer-than-path-first" };
  return { chosen: first, reason: "path-first-not-older-than-npm-global" };
}

function resolveTool(toolId, opts = {}) {
  if (!TOOL_IDS.has(toolId)) return { ok: false, reason: `tool-id '${toolId}' is not in the allowlist` };
  const envPath = mcEnv.readEnv(`TOOL_${toolId.toUpperCase()}_PATH`);
  let p = opts.path || envPath || null;
  let resolution = null;
  if (toolId === "codex") {
    if (p) {
      const pinned = path.resolve(p).toLowerCase();
      const pre = opts.npmPrefix !== undefined ? opts.npmPrefix : npmGlobalPrefix();
      const others = whichAll("codex")
        .filter((c) => path.resolve(c).toLowerCase() !== pinned)
        .map((c) => {
          const r = _real(c);
          const npm = isNpmGlobalPath(c, r, pre);
          return { path: c, version: npm && !unsafeReason("codex", r, opts) ? npmMetaVersion(r, pre) : null, npm };
        });
      resolution = { reason: opts.path ? "explicit-path" : "env-override", chosen: p, chosen_version: null, alternatives: others };
    } else {
      const pre = opts.npmPrefix !== undefined ? opts.npmPrefix : npmGlobalPrefix();
      const cands = whichAll("codex").map((c) => {
        const r = _real(c);
        return { path: c, real: r, npm: isNpmGlobalPath(c, r, pre), version: null };
      });
      if (cands.length > 1 && cands.some((c) => c.npm) && !cands[0].npm) {
        cands[0].version = toolVersion(cands[0].path, { ...opts, npmPrefix: pre });
        const n = cands.find((c) => c.npm);
        n.version = toolVersion(n.path, { ...opts, npmPrefix: pre });
      }
      const pick = pickCodexCandidate(cands);
      if (pick.chosen) {
        p = pick.chosen.path;
        resolution = {
          reason: pick.reason,
          chosen: pick.chosen.path,
          chosen_version: pick.chosen.version,
          alternatives: cands.filter((c) => c !== pick.chosen).map((c) => ({ path: c.path, version: c.version, npm: c.npm })),
        };
      }
    }
  }
  if (!p) p = which(toolId);
  if (!p) return { ok: false, reason: `tool '${toolId}' not found on PATH` };
  let real;
  try {
    real = fs.realpathSync(p);
  } catch {
    real = path.resolve(p);
  }
  const unsafe = unsafeReason(toolId, real, opts);
  if (unsafe) return { ok: false, reason: unsafe };
  const ext = path.extname(real).toLowerCase();
  const kind = ext === ".cmd" || ext === ".bat" ? "cmd-shim" : ext === ".exe" || ext === "" ? "native" : "script";
  if (resolution) {
    if (!resolution.chosen_version) resolution.chosen_version = toolVersion(p, opts);
    return { ok: true, path: real, kind, resolution };
  }
  return { ok: true, path: real, kind };
}

function normalizeStdin(input) {
  let s = Buffer.isBuffer(input) ? input.toString("utf8") : String(input == null ? "" : input);
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  s = s.replace(/\r\n/g, "\n");
  return Buffer.from(s, "utf8");
}

function systemRoot() {
  return process.env.SystemRoot || process.env.windir || "C:\\Windows";
}
function system32(exe) {
  const p = path.join(systemRoot(), "System32", exe);
  return fs.existsSync(p) ? p : null;
}

function posixDescendants(rootPid) {
  const out = [];
  let table = "";
  try {
    const r = spawnSync("ps", ["-e", "-o", "pid=,ppid="], { encoding: "utf8", timeout: 5000 });
    table = (r && r.stdout) || "";
  } catch {
    return out;
  }
  const byParent = new Map();
  for (const line of table.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\d+)$/);
    if (!m) continue;
    const pid = Number(m[1]);
    const ppid = Number(m[2]);
    if (!byParent.has(ppid)) byParent.set(ppid, []);
    byParent.get(ppid).push(pid);
  }
  const queue = [Number(rootPid)];
  const seen = new Set(queue);
  while (queue.length) {
    const p = queue.shift();
    for (const c of byParent.get(p) || []) {
      if (seen.has(c)) continue;
      seen.add(c);
      out.push(c);
      queue.push(c);
    }
  }
  return out;
}

function treeKill(pid) {
  if (!pid) return false;
  try {
    if (process.platform === "win32") {
      const tk = resolveTool("taskkill");
      const bin = (tk.ok && tk.path) || system32("taskkill.exe") || "taskkill";
      spawnSync(bin, ["/T", "/F", "/PID", String(pid)], { timeout: 5000, windowsHide: true });
      return true;
    }
    const kids = posixDescendants(pid);
    for (let i = kids.length - 1; i >= 0; i--) {
      try { process.kill(-kids[i], "SIGKILL"); } catch { }
      try { process.kill(kids[i], "SIGKILL"); } catch { }
    }
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      process.kill(pid, "SIGKILL");
    }
    return true;
  } catch {
    return false;
  }
}

function safeSpawnSync(toolId, args, opts = {}) {
  const argCheck = assertArgs(toolId, args || []);
  if (!argCheck.ok) return { ok: false, reaped: false, reason: "arg_policy_violation", violations: argCheck.violations, stdout: "", stderr: "", exitCode: null };
  const tool = resolveTool(toolId, opts.resolve || {});
  if (!tool.ok) return { ok: false, reaped: false, reason: "tool_resolution_refused", detail: tool.reason, stdout: "", stderr: "", exitCode: null };

  if (toolId === "agy" && tool.kind !== "native") {
    return { ok: false, reaped: false, reason: "agy_requires_native_exe", detail: `agy resolved to a ${tool.kind} (${tool.path}) — the multi-line -p carve-out is native-exe only; a .cmd/.bat shim is refused`, stdout: "", stderr: "", exitCode: null };
  }

  const assembledLen = assembledCmdlineLen(tool.path, args);
  if (assembledLen > CMDLINE_MAX) {
    return { ok: false, reaped: false, reason: "cmdline_oversize", detail: `assembled command line ${assembledLen} chars exceeds the ${CMDLINE_MAX} bound (Windows CreateProcess ceiling minus margin) — the payload is BLOCKED, never truncated-and-sent. Account this run as the lane BLOCKED (agy-unavailable-equivalent), NEVER a partial-review pass.`, stdout: "", stderr: "", exitCode: null };
  }

  const timeoutMs = opts.timeoutMs || 20 * 60 * 1000;
  const input = opts.input != null ? normalizeStdin(opts.input) : undefined;
  const childEnv = withCodexHome(toolId, opts.env || process.env);

  let bin = tool.path;
  let spawnArgs = args || [];
  const useShell = false;
  if (tool.kind === "cmd-shim" && process.platform === "win32") {
    const cmdExe = system32("cmd.exe");
    if (!cmdExe) {
      return { ok: false, reaped: false, reason: "cmd_exe_unresolved", detail: `cmd.exe not found under ${systemRoot()}\\System32`, stdout: "", stderr: "", exitCode: null };
    }
    bin = cmdExe;
    spawnArgs = ["/c", tool.path, ...(args || [])];
  }

  const started = Date.now();
  const sp = spawnSync(bin, spawnArgs, {
    input,
    timeout: timeoutMs,
    maxBuffer: opts.maxBuffer || 32 * 1024 * 1024,
    cwd: opts.cwd || PROJECT_ROOT,
    env: childEnv,
    encoding: "buffer",
    shell: useShell,
    windowsHide: true,
  });
  const durationMs = Date.now() - started;

  const stdout = (sp.stdout || Buffer.alloc(0)).toString("utf8");
  const stderr = (sp.stderr || Buffer.alloc(0)).toString("utf8");
  const status = sp.status;
  const signal = sp.signal;
  const errCode = sp.error && sp.error.code ? sp.error.code : null;
  const timedOut = errCode === "ETIMEDOUT" || signal === "SIGTERM" || signal === "SIGKILL";

  if (timedOut && sp.pid) treeKill(sp.pid);

  let reaped = false;
  let reason = null;
  if (timedOut) { reaped = true; reason = "timeout_reap"; }
  else if (errCode === "ENOENT" || errCode === "EACCES" || errCode === "EPERM") { reaped = true; reason = "spawn_failed"; }
  else if (typeof status === "number" && status !== 0) { reaped = true; reason = "nonzero_exit"; }
  else if (stdout.trim().length === 0) { reaped = true; reason = "zero_byte_reap"; }

  return {
    ok: !reaped,
    reaped,
    reason: reason || undefined,
    exitCode: typeof status === "number" ? status : null,
    pid: typeof sp.pid === "number" ? sp.pid : null,
    stdout: reaped ? "" : stdout,
    stderr: stderr.slice(0, 4000),
    tool: { id: toolId, path: tool.path, kind: tool.kind, ...(tool.resolution ? { resolution: tool.resolution } : {}) },
    durationMs,
  };
}

function safeSpawnFile(toolId, args, opts = {}) {
  if (!opts.outFile) {
    return { ok: false, reaped: false, reason: "missing_out_file", detail: "safeSpawnFile requires opts.outFile", stdout: "", stderr: "", exitCode: null };
  }
  const argCheck = assertArgs(toolId, args || []);
  if (!argCheck.ok) return { ok: false, reaped: false, reason: "arg_policy_violation", violations: argCheck.violations, stdout: "", stderr: "", exitCode: null };

  const outFile = path.resolve(opts.outFile);
  const sentinel = outFile + ".done";
  const recover = opts.recover !== false;

  if (recover) {
    try {
      if (fs.existsSync(sentinel) && fs.existsSync(outFile)) {
        const sv = JSON.parse(fs.readFileSync(sentinel, "utf8"));
        const body = fs.readFileSync(outFile, "utf8");
        if (sv && sv.ok && body.trim().length > 0) {
          return {
            ok: true, reaped: false, recovered: true, savepoint: sentinel,
            exitCode: typeof sv.exitCode === "number" ? sv.exitCode : 0,
            stdout: body, stderr: "", outFile,
            tool: { id: toolId, path: null, kind: null },
            durationMs: sv.durationMs || 0,
          };
        }
      }
    } catch {
    }
  }

  const tool = resolveTool(toolId, opts.resolve || {});
  if (!tool.ok) return { ok: false, reaped: false, reason: "tool_resolution_refused", detail: tool.reason, stdout: "", stderr: "", exitCode: null };

  if (toolId === "agy" && tool.kind !== "native") {
    return { ok: false, reaped: false, reason: "agy_requires_native_exe", detail: `agy resolved to a ${tool.kind} (${tool.path}) — the multi-line -p carve-out is native-exe only; a .cmd/.bat shim is refused`, stdout: "", stderr: "", exitCode: null };
  }

  const assembledLen = assembledCmdlineLen(tool.path, args);
  if (assembledLen > CMDLINE_MAX) {
    return { ok: false, reaped: false, reason: "cmdline_oversize", detail: `assembled command line ${assembledLen} chars exceeds the ${CMDLINE_MAX} bound (Windows CreateProcess ceiling minus margin) — the payload is BLOCKED, never truncated-and-sent. Account this run as the lane BLOCKED (agy-unavailable-equivalent), NEVER a partial-review pass.`, stdout: "", stderr: "", exitCode: null };
  }

  const timeoutMs = opts.timeoutMs || 20 * 60 * 1000;
  const input = opts.input != null ? normalizeStdin(opts.input) : undefined;
  const childEnv = withCodexHome(toolId, opts.env || process.env);

  let bin = tool.path;
  let spawnArgs = args || [];
  if (tool.kind === "cmd-shim" && process.platform === "win32") {
    const cmdExe = system32("cmd.exe");
    if (!cmdExe) {
      return { ok: false, reaped: false, reason: "cmd_exe_unresolved", detail: `cmd.exe not found under ${systemRoot()}\\System32`, stdout: "", stderr: "", exitCode: null };
    }
    bin = cmdExe;
    spawnArgs = ["/c", tool.path, ...(args || [])];
  }

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  try { fs.rmSync(sentinel, { force: true }); } catch { }
  const outFd = fs.openSync(outFile, "w");

  const started = Date.now();
  let sp;
  try {
    sp = spawnSync(bin, spawnArgs, {
      input,
      timeout: timeoutMs,
      cwd: opts.cwd || PROJECT_ROOT,
      env: childEnv,
      stdio: [input != null ? "pipe" : "ignore", outFd, "pipe"],
      shell: false,
      windowsHide: true,
    });
  } finally {
    try { fs.closeSync(outFd); } catch { }
  }
  const durationMs = Date.now() - started;

  let stdout = "";
  try { stdout = fs.readFileSync(outFile, "utf8"); } catch { stdout = ""; }
  const stderr = (sp.stderr || Buffer.alloc(0)).toString("utf8");
  const status = sp.status;
  const signal = sp.signal;
  const errCode = sp.error && sp.error.code ? sp.error.code : null;
  const timedOut = errCode === "ETIMEDOUT" || signal === "SIGTERM" || signal === "SIGKILL";

  if (timedOut && sp.pid) treeKill(sp.pid);

  let reaped = false;
  let reason = null;
  if (timedOut) { reaped = true; reason = "timeout_reap"; }
  else if (errCode === "ENOENT" || errCode === "EACCES" || errCode === "EPERM") { reaped = true; reason = "spawn_failed"; }
  else if (typeof status === "number" && status !== 0) { reaped = true; reason = "nonzero_exit"; }
  else if (stdout.trim().length === 0) { reaped = true; reason = "zero_byte_reap"; }

  if (!reaped) {
    try {
      fs.writeFileSync(sentinel, JSON.stringify({ ok: true, exitCode: typeof status === "number" ? status : 0, bytes: Buffer.byteLength(stdout, "utf8"), durationMs }) + "\n", "utf8");
    } catch { }
  }

  return {
    ok: !reaped,
    reaped,
    reason: reason || undefined,
    recovered: false,
    savepoint: reaped ? null : sentinel,
    exitCode: typeof status === "number" ? status : null,
    stdout: reaped ? "" : stdout,
    stderr: stderr.slice(0, 4000),
    outFile,
    tool: { id: toolId, path: tool.path, kind: tool.kind, ...(tool.resolution ? { resolution: tool.resolution } : {}) },
    durationMs,
  };
}

module.exports = { resolveTool, whichAll, toolVersion, compareVer, isNpmGlobalPath, pickCodexCandidate, assertArgs, normalizeStdin, treeKill, safeSpawnSync, safeSpawnFile, TOOL_IDS, ARG_POLICY, PROJECT_ROOT, CMDLINE_MAX, assembledCmdlineLen, AGY_FORBIDDEN_SKIP_PERM, withCodexHome, DEFAULT_CODEX_HOME, resolveCodexHome };
