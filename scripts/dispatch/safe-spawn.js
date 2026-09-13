#!/usr/bin/env node
"use strict";

/**
 * safe-spawn.js — the dispatch SAFETY KERNEL (PLAN §16.3 / §17.3 / §17.4).
 *
 * The o3 deep-research + GPT-5.5 final review found our existing `shell:false` /
 * `shell:true`-on-Windows spawns INSUFFICIENT. This module is the shared, audited
 * primitive every dispatcher (dispatch-claude / dispatch-agent / future
 * dispatch-skill / dispatch-api) routes through, closing:
 *
 *  - CVE-2024-27980 / PATH-hijack (HIGH/MED): the MODEL never chooses the
 *    executable path. `resolveTool(id)` maps a FIXED tool-ID allowlist →
 *    realpath'd absolute path, and REJECTS a resolution that lands inside the
 *    repo / temp / a model-supplied path (a planted `claude.cmd` earlier in PATH).
 *  - "safe-spawn != safe ARGUMENTS" (HIGH): `assertArgs(id, args)` ALLOWLISTS the
 *    permitted subcommands/flags per tool — an unknown flag, a shell metachar, a
 *    UNC path, or a model-supplied absolute-exe arg is REFUSED. Metachar-refusal
 *    alone (the old gate) is not enough; a whitelisted binary's own flags are
 *    weapons.
 *  - Encoding/newline skew (MED): `normalizeStdin()` forces UTF-8, strips a BOM,
 *    and normalizes CRLF->LF on the stdin/file handoff.
 *  - Orphaned paid subprocess trees (HIGH): `treeKill(pid)` does a real tree-kill
 *    (`taskkill /T /F` on Windows; process-group kill on POSIX), not just
 *    `child.kill()` of the top process (CLIs spawn their own children).
 *
 * Day-one floor per §17.3: tree-kill + timeout + drain + the arg-allowlist. Job
 * Objects / AppContainer are DEFERRED (§17.7) behind a real survivor-test.
 *
 * KNOWN RESIDUALS (the "trusted operator env" boundary — GPT-5.5 review R2):
 *   - WARPOS_APPROVED_TOOL_ROOTS is OPTIONAL. Without it, resolveTool still rejects
 *     repo-local + temp-dir hijacks (the realistic vectors) but accepts any other
 *     on-PATH location. PRODUCTION deployments handling untrusted input SHOULD set
 *     it to pin tool roots. (Mandating it would break ordinary dev where tools live
 *     in user/system install dirs.)
 *   - The threat model assumes the OPERATOR'S process env is trusted. An attacker
 *     who already controls env vars / PATH has broader capability than this module
 *     defends; cmd.exe + taskkill are pinned to System32 and registry identity is
 *     fixed (not env-overridable), but a fully-hostile env is out of scope here.
 *
 * Pure helpers (resolveTool/assertArgs/normalizeStdin) are exported and unit-
 * tested with planted violations (P5). `safeSpawnSync` is the integrator.
 *
 * Zero runtime deps.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

// ── Isolated CODEX_HOME (RI-009: codex model-cache multi-writer collision) ──────────
// The ChatGPT desktop app's embedded codex, the codex CLI, and stale session remnants
// all share ~/.codex/models_cache.json and write INCOMPATIBLE schemas — whoever writes
// last decides whether OUR CLI can LOAD it (intermittent "missing field
// supports_reasoning_summaries" load failure; a read-only pin instead yields "Access is
// denied"). Fix: give WarpOS codex spawns their OWN CODEX_HOME so the shared cache can't
// be clobbered under us. This is applied at the SINGLE kernel choke-point every codex
// spawn routes through (providers.js runProvider, cert-attest.js, dispatch-review →
// dispatch-agent, ...); the raw `codex exec`-from-Bash route is separately blocked by
// dispatch-route-guard, so the two together cover both routes (lib-only-fix pairing).
const DEFAULT_CODEX_HOME =
  process.env.WARPOS_CODEX_HOME || path.join(os.homedir(), ".codex-warpos");
const _codexHomeSeeded = new Set();

// Seed the isolated home ONCE per process: copy-if-MISSING auth.json + config.toml from
// ~/.codex (never overwrite an existing file; never log key material). Fail-open — a seed
// failure must never block a dispatch (codex will just re-auth / re-fetch its own cache).
function seedCodexHome(dir) {
  if (_codexHomeSeeded.has(dir)) return;
  _codexHomeSeeded.add(dir); // memoize up-front so a partial failure never retry-spams the hot path
  try {
    fs.mkdirSync(dir, { recursive: true });
    const src = path.join(os.homedir(), ".codex");
    for (const f of ["auth.json", "config.toml"]) {
      const dst = path.join(dir, f);
      if (fs.existsSync(dst)) continue; // copy-if-missing — never overwrite
      const s = path.join(src, f);
      if (fs.existsSync(s)) fs.copyFileSync(s, dst);
    }
  } catch {
    /* fail-open: seeding is best-effort, never a dispatch blocker */
  }
}

// Default CODEX_HOME for codex spawns WHEN NOT ALREADY SET (an explicit CODEX_HOME wins).
// Returns a possibly-NEW env object — NEVER mutates the caller's env / process.env. Every
// non-codex tool is returned untouched. This is the structural replacement for the manual
// `CODEX_HOME=... node scripts/dispatch-agent.js ...` prefix (RI-009).
function withCodexHome(toolId, env) {
  if (toolId !== "codex") return env;
  if (env && env.CODEX_HOME) return env; // explicit override wins — untouched
  seedCodexHome(DEFAULT_CODEX_HOME);
  return { ...(env || {}), CODEX_HOME: DEFAULT_CODEX_HOME };
}

// ── Tool-ID allowlist (the model never supplies an exe path) ──
// kind drives invocation. `.cmd` shims on Windows still carry CVE-2024-27980
// residual risk — mitigated by the arg-allowlist (no metachars reach the shell)
// + arg-array invocation. `node` runs OUR absolute JS entrypoints only.
const TOOL_IDS = new Set(["claude", "codex", "node", "git", "taskkill", "agy"]);

// ── Per-tool argument policy (allowlist, not just metachar refusal) ──
// flags: allowed flag tokens. valueFlags: flags that consume the next arg, with a
// validator for that value. positionals: validator for bare args. Unknown flag or
// a failing value => REJECT.
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/; // model/role/effort/level tokens
// agy --model display-name shape ("Gemini 3.1 Pro (High)"): starts alphanumeric, then
// letters/digits/space/dot/paren/hyphen only, ≤64 chars. NO shell metachars, NO leading dash.
// Scoped to agy's -m/--model slot ONLY (ADR-0023 positive-allow pattern; see ARG_POLICY.agy).
const AGY_MODEL_DISPLAY = /^[A-Za-z0-9][A-Za-z0-9 .()\-]{0,63}$/;
// Effort-token allowlist (structural — a valid effort LEVEL exists). `ultra` added
// DISPATCH.md 2026-07-12 (GPT-5.6 sol/terra fan-out level). Model-SPECIFIC gating (ultra
// only on sol/terra, not luna/claude) is the catalog.validateTuple layer's job — this is
// just "is it a valid token". codex reasoning-effort rides the `-c key=value` validator,
// which already accepts ultra structurally.
const EFFORT = /^(low|medium|high|xhigh|max|ultra)$/i;
const SANDBOX = /^(workspace-write|read-only|danger-full-access)$/;
const APPROVAL = /^(never|on-failure|on-request|untrusted)$/;
// SHELL_META — the BROAD set (incl. parens + ANY whitespace) used for flag TOKENS
// and positionals, which never legitimately contain these.
const SHELL_META = /[`$;&|<>()\s]/;
// INJECT_META — the command-injection set applied to EVERY arg AND every consumed
// flag VALUE. (GPT-5.5 review R1 CRITICAL: consumed values skipped the universal
// check, so `-o ...x&calc` reached `cmd.exe /c` for a .cmd shim — a CVE-2024-27980
// bypass.) Excludes space/parens so a legitimate value with spaces (the gemini -p
// instruction, a path) still passes, but refuses the cmd.exe/posix separators +
// substitution that weaponize a .cmd shim: & | < > ^ " backtick $ ; CR LF — PLUS
// `%` and `!` (GPT-5.5 review R2 HIGH: cmd.exe %VAR% expansion + delayed-expansion
// !VAR! reach the shell through cmd.exe /c).
// NUL (\x00) is refused in EVERY value (both regexes below): it is never legitimate in an argv value,
// and Node's child_process THROWS ERR_INVALID_ARG_VALUE on a NUL in argv — so accepting it would crash
// the dispatcher past the fail-closed result contract instead of returning a clean refusal (REG-001,
// backend-reviewer). assertArgs runs before spawn in BOTH safeSpawnSync/safeSpawnFile, so this rejects it.
const INJECT_META = /[`$;&|<>^"%!\r\n\x00]/;
// The agy (Antigravity) carve-out (#27): agy's native-exe `-p` value slot carries a MULTI-LINE
// prompt — the ONLY multi-line delivery agy supports (no stdin, no prompt-file flag). CreateProcess
// (shell:false) passes a native-exe argv value verbatim, so a newline in THIS one slot is safe; every
// OTHER injection metachar is STILL refused. Allowlist-of-shape: applies ONLY to tool `agy`, flag `-p`,
// and a NATIVE exe (a .cmd/.bat shim is refused in safeSpawnSync — cmd.exe /c would reparse the
// newline). The same multi-line content in ANY other arg hits full INJECT_META → refused.
const INJECT_META_ALLOW_NL = /[`$;&|<>^"%!\x00]/; // INJECT_META minus \r\n — but NUL is STILL refused (REG-001)
// (b) D6-ARGV-POLICY-003 / ADR-0020-amendment (β DECIDE B/0.90, 4 binding riders): the agy `-p` value slot
// carries a CODE-REVIEW payload — real source/diffs with `$` backtick `;` `|` `<` `>` `"` `%` `!` `&` `^`.
// agy 1.1.4 has NO stdin and NO --prompt-file (help-verified), so `-p` argv is the ONLY transport. Under
// safe-spawn's shell:false + native-exe enforcement + a SINGLE DISCRETE argv element (RIDER-3, verified in
// safeSpawnSync), CreateProcess passes the value VERBATIM to a Go exe — there is no shell to interpret any
// metachar, so the whole shell-injection premise is void for THIS one slot. So agy `-p` refuses ONLY NUL
// (\x00 — it truncates the Windows argument / crashes child_process; REG-001, never legitimate). This is a
// POSITIVE per-tool allow SCOPED to tool `agy` + flag `-p` ONLY — every other tool/slot still hits the full
// shared INJECT_META (or _ALLOW_NL) denylist, which this does NOT weaken. Argument-injection (a leading-dash
// payload parsed as a flag) is handled STRUCTURALLY by the discrete-argv next-token bind (RIDER-2); the
// assembled-command-line LENGTH bound (RIDER-1) is a NAMED oversize outcome in safeSpawnSync — never truncate.
const INJECT_META_AGY_PAYLOAD = /\x00/; // agy -p code-payload slot: ONLY NUL is refused (shell:false ⇒ metachars are inert)

// (b) RIDER-1 (β DECIDE B/0.90, ADR-0020-amend): the ASSEMBLED-command-line bound (pure + exported for teeth).
// Windows CreateProcess caps the command line at 32767 chars; we budget below it with margin so an oversize
// agy `-p` payload fails CLOSED as a NAMED outcome in the spawn path (never truncate-and-send). Sums the exe
// path + every argv token (+ ~3 chars/token for spacing/quoting overhead). Bidirectional teeth assert both
// sides of the bound (a real code payload passes; an oversize payload is BLOCKED).
const CMDLINE_MAX = 32000; // 32767 Windows CreateProcess ceiling minus ~767 chars of quoting/spacing margin
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
// True iff `p` resolves under (or equal to) `dir` — a REAL boundary check, not a
// string prefix (GPT-5.5 review HIGH: "TempX".startsWith("Temp") false-passed).
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
      // `-c key=value` reasoning override: key.token=value.token, no metachars.
      "-c": (v) => /^[a-z0-9_]+=[A-Za-z0-9._-]+$/i.test(v),
      "-o": (v) => isInRepo(v) || isUnderDir(v, os.tmpdir()),
    },
    positionals: (v) => v === "-",
  },
  agy: {
    // Antigravity CLI: `agy --model <id> --print-timeout <dur> -p '<multi-line prompt>'` (no stdin,
    // no prompt-file flag — the prompt is the `-p` argv VALUE). #27 carve-out.
    subcommands: new Set([]),
    boolFlags: new Set([]),
    valueFlags: {
      // agy's --model takes DISPLAY NAMES, not slug ids — its own error output enumerates
      // "Available models: Gemini 3.1 Pro (High) / Claude Sonnet 4.6 (Thinking) / …" and a slug is
      // "not recognized as a known model" (verified live 2026-07-19, exit 1, artifact
      // runtime/cert-attest/gemini-3.5-flash-medium-2026-07-19T07-09-14-780Z.json). So this slot
      // accepts the display-name shape: must START with a letter/digit (no leading dash — the
      // structural next-token bind stays intact), then letters/digits/space/dot/paren/hyphen ONLY,
      // bounded ≤64 — no shell metachar admitted. Positive per-tool-per-slot allow in the ADR-0023
      // pattern; every other tool's model slot keeps the strict TOKEN charset.
      "-m": (v) => TOKEN.test(v) || AGY_MODEL_DISPLAY.test(v),
      "--model": (v) => TOKEN.test(v) || AGY_MODEL_DISPLAY.test(v),
      // duration like 90s / 5m / 500ms — digits + optional unit, no metachars.
      "--print-timeout": (v) => /^[0-9]+(ms|s|m|h)?$/.test(v),
      // (a) SP-20260718-003: --log-file <path> for the served-model calibration probe. A path token —
      // no NUL, no shell metachar, no UNC (the injection/UNC checks in consumedValueViolations enforce
      // the metachar/UNC floor); here just cap length + require a plausible path shape.
      "--log-file": (v) => typeof v === "string" && v.length > 0 && v.length <= 4096,
      // -p is the CODE-REVIEW PAYLOAD (codePayloadValueFlags below): under shell:false + native-exe +
      // discrete-argv (RIDER-3) the shell-injection premise is void, so the validator refuses ONLY NUL.
      // Length is bounded as the ASSEMBLED command line in safeSpawnSync (RIDER-1, a NAMED oversize
      // outcome — never truncate); a defense-in-depth payload cap is applied there, not here.
      "-p": (v) => typeof v === "string" && v.length > 0 && !INJECT_META_AGY_PAYLOAD.test(v),
    },
    // -p may carry a newline (multiline) AND the full code-review char set (codePayload) — both consulted
    // by assertArgs to pick the injection check for that slot ONLY. Native-exe enforced in safeSpawnSync.
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
    // node runs OUR scripts: an absolute path UNDER the repo, plus free-form script
    // args that carry no shell metachars (shell:false, but defense in depth).
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
    // READ-ONLY git only. GPT-5.5 review R2 MEDIUM: `git config` / `git worktree`
    // are code-exec/persistence primitives (config can set aliases/hooks/pager),
    // so they are NOT in the allowlist. (Dispatch's git-config needs go through
    // process-scoped GIT_CONFIG_* env in providers.js, never `git config`.)
    subcommands: new Set(["diff", "status", "rev-parse", "log"]),
    boolFlags: new Set(["--porcelain", "--name-only", "--cached", "--is-inside-work-tree"]),
    valueFlags: { "-C": (v) => isInRepo(v) },
    positionals: (v) => !SHELL_META.test(v),
  },
};

// ADR-0031 rider 4: agy must NEVER carry a skip-permissions / auto-approve escape. agy is an
// AGENTIC CLI whose headless tool-permission wall is handled by a SCOPED READ-ONLY allow-list
// (operator-owned; agy stays BLOCKED-ADVISORY until that permissions.allow whitelist is verified) —
// NOT by bypassing the permission system. This constant + the assertArgs check below refuse the
// bypass STRUCTURALLY at the choke-point every agy dispatch routes through, so it can never be
// self-granted (a future edit that adds the flag fails closed here, and safe-spawn.test asserts it).
const AGY_FORBIDDEN_SKIP_PERM = /^--(dangerously-skip-permissions?|yolo|skip-permissions?|allow-all)$/i;

// A UNC path or a drive-absolute executable arg — the model must never choose an
// executable path; reject these wherever they appear in argv.
const looksLikeUNC = (v) =>
  /^\\\\/.test(v) || (/^[a-z]:[\\/]/i.test(v) && /\.(exe|cmd|bat|ps1|sh)$/i.test(v));

// GPT-5.5 review CRITICAL fix: a CONSUMED flag value must pass the universal
// injection + UNC checks too (the validator alone — e.g. codex -o's path check —
// does not reject `&`/`|`, which weaponize a .cmd shim via `cmd.exe /c`).
function consumedValueViolations(flag, v, opts = {}) {
  const out = [];
  if (typeof v !== "string") return out; // undefined handled by the caller
  // The injection set is per-slot, widest-carve-out first (each is strictly scoped by the caller):
  //  - codePayload (agy -p ONLY): a CODE-REVIEW payload under shell:false + native-exe + discrete argv —
  //    the shell-injection premise is void, so ONLY NUL is refused (b / β 4-rider carve-out, ADR-0020-amend).
  //  - allowNewline (#27, agy -p multiline): INJECT_META minus \r\n — a native-exe newline slot.
  //  - default: the full INJECT_META (every metachar incl. \r\n) — every other tool/flag.
  // A codePayload slot is ALSO a native-exe-only slot (safeSpawnSync refuses a .cmd/.bat agy) — the same
  // guarantee the allowNewline carve-out relies on. NOTE: the UNC/abs-exe check is SKIPPED for a codePayload
  // (a code review legitimately quotes Windows paths / UNC strings; the payload is a -p VALUE, never the
  // executable — the tool is resolveTool-pinned, so a value can't hijack the exe).
  const injectRe = opts.codePayload ? INJECT_META_AGY_PAYLOAD : opts.allowNewline ? INJECT_META_ALLOW_NL : INJECT_META;
  if (injectRe.test(v)) out.push(`value of ${flag} (${JSON.stringify(v)}) contains a command-injection metacharacter`);
  if (!opts.codePayload && looksLikeUNC(v)) out.push(`value of ${flag} (${JSON.stringify(v)}) is a UNC/absolute-executable path`);
  return out;
}

/**
 * Validate an argv array against a tool's policy. Returns { ok, violations[] }.
 * REJECTS: a shell metachar anywhere, a UNC / absolute-executable arg, an unknown
 * flag, or a flag value that fails its validator. The FIRST positional after a
 * recognized subcommand is checked against `subcommands`.
 */
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
    // R2 REG-001: reject NUL on EVERY argv element (flag token, subcommand, POSITIONAL) — SHELL_META
    // does not include it, so a positional/flag NUL would otherwise reach spawnSync and throw
    // ERR_INVALID_ARG_VALUE past the fail-closed result contract. (Consumed flag VALUES are covered by
    // consumedValueViolations' INJECT_META; this closes the positional/token path universally.)
    if (a.indexOf("\x00") !== -1) violations.push(`arg ${i} contains a NUL byte — refused universally (never legitimate; crashes child_process)`);
    // ADR-0031 rider 4: refuse an agy permission-bypass flag at the choke-point (never self-granted).
    if (toolId === "agy" && AGY_FORBIDDEN_SKIP_PERM.test(a)) violations.push(`agy must NEVER carry a skip-permissions/auto-approve flag (${JSON.stringify(a)}) — ADR-0031 rider 4: the scoped read-only tool-permission is operator-owned; a permission-bypass is refused structurally.`);
    if (SHELL_META.test(a)) violations.push(`arg ${i} (${JSON.stringify(a)}) contains a shell metacharacter/space`);
    if (looksLikeUNC(a)) violations.push(`arg ${i} (${JSON.stringify(a)}) looks like a UNC/absolute-executable path (model must never choose the executable)`);

    if (a.startsWith("-") && a !== "-" && !/^\//.test(a)) {
      // a flag (dash-led; Windows slash-flags like /T handled as bool below)
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
    // Windows slash-flags (/T /F /PID) for taskkill
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
    // a positional / subcommand / '-'
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
      // GPT-5.5 review R2 MEDIUM fix: a tool that HAS subcommands MUST take a known
      // one as its first positional — an UNKNOWN first positional is a disallowed
      // subcommand (e.g. `git config`), NOT a permissive positional. Reject here
      // instead of falling through to policy.positionals (which would accept it).
      violations.push(`unknown/disallowed subcommand for ${toolId}: ${JSON.stringify(a)}`);
      i++;
      continue;
    }
    if (!policy.positionals(a)) violations.push(`disallowed positional for ${toolId}: ${JSON.stringify(a)}`);
    i++;
  }
  return { ok: violations.length === 0, violations };
}

// ── Tool resolution (NEVER from a model-supplied path) ──────
function which(cmd) {
  // No shell; query PATH ourselves so a planted shim in cwd cannot win via shell
  // resolution order. Returns the first existing match across PATH + a FIXED
  // extension set. GPT-5.5 review MEDIUM fix: process.env.PATHEXT is attacker-
  // controlled (a hostile parent env can add/empty entries), so we IGNORE it and
  // use a hardcoded allowlist for safety-critical resolution.
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
        /* next */
      }
    }
  }
  return null;
}

/**
 * Resolve a FIXED tool-ID to a realpath'd absolute executable path, then REJECT
 * an unsafe resolution. The model never supplies the path; only an ID from
 * TOOL_IDS is accepted.
 *
 * Rejections (§16.2/§17.3):
 *   - id not in the allowlist,
 *   - resolved path is inside the repo (a planted repo-local shim) or under the
 *     OS temp dir (a writable hijack location),
 *   - WARPOS_APPROVED_TOOL_ROOTS is set and the path is under none of them.
 *
 * Test seam: WARPOS_TOOL_<ID>_PATH forces a path (used by unit tests + the
 * existing DISPATCH_*_BIN seams); it is still subjected to the same safety checks.
 */
function resolveTool(toolId, opts = {}) {
  if (!TOOL_IDS.has(toolId)) return { ok: false, reason: `tool-id '${toolId}' is not in the allowlist` };
  const p = opts.path || process.env[`WARPOS_TOOL_${toolId.toUpperCase()}_PATH`] || which(toolId);
  if (!p) return { ok: false, reason: `tool '${toolId}' not found on PATH` };
  let real;
  try {
    real = fs.realpathSync(p);
  } catch {
    real = path.resolve(p);
  }
  if (!opts.allowRepoLocal && isInRepo(real)) {
    return { ok: false, reason: `resolved '${toolId}' to a repo-local path (${real}) — refusing (PATH-hijack guard)` };
  }
  const tmp = os.tmpdir();
  if (real === tmp || real.startsWith(tmp + path.sep)) {
    return { ok: false, reason: `resolved '${toolId}' under the OS temp dir (${real}) — refusing (writable-hijack guard)` };
  }
  const approved = (process.env.WARPOS_APPROVED_TOOL_ROOTS || "").split(path.delimiter).filter(Boolean);
  if (approved.length && !approved.some((root) => real === root || real.startsWith(root + path.sep))) {
    return { ok: false, reason: `resolved '${toolId}' (${real}) is under no WARPOS_APPROVED_TOOL_ROOTS entry` };
  }
  const ext = path.extname(real).toLowerCase();
  const kind = ext === ".cmd" || ext === ".bat" ? "cmd-shim" : ext === ".exe" || ext === "" ? "native" : "script";
  return { ok: true, path: real, kind };
}

// ── stdin normalization ─────────────────────────────────────
/** Force UTF-8, strip a leading BOM, normalize CRLF->LF. Returns a Buffer. */
function normalizeStdin(input) {
  let s = Buffer.isBuffer(input) ? input.toString("utf8") : String(input == null ? "" : input);
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  s = s.replace(/\r\n/g, "\n");
  return Buffer.from(s, "utf8");
}

// ── Windows system-binary resolution (NOT from ComSpec/PATH) ──
// GPT-5.5 review R2 HIGH: the command processor + taskkill must NOT be taken from
// the env (ComSpec) or a bare PATH lookup (a planted shim wins). Resolve them to a
// fixed System32 location. SystemRoot is far less attacker-targeted than ComSpec.
function systemRoot() {
  return process.env.SystemRoot || process.env.windir || "C:\\Windows";
}
function system32(exe) {
  const p = path.join(systemRoot(), "System32", exe);
  return fs.existsSync(p) ? p : null;
}

// ── tree-kill ───────────────────────────────────────────────
/**
 * POSIX: every live descendant of `rootPid` (children, grandchildren, …) from ONE
 * snapshot of the process table, deepest-last. A process-group kill alone is NOT a
 * tree kill: a CLI (or anything spawned detached / under setsid) lives in its OWN
 * process group, so `kill(-pid)` on the top PID leaks its grandchildren — the
 * orphaned-paid-subprocess class the Linux CI run proved with a 3-level detached
 * tree. `ps -e -o pid=,ppid=` is POSIX-portable (procps on Linux, BSD ps on macOS).
 */
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

/** Best-effort kill of the WHOLE process tree (CLIs spawn children). */
function treeKill(pid) {
  if (!pid) return false;
  try {
    if (process.platform === "win32") {
      // Resolve taskkill to System32 (or via the guarded resolver), never a bare
      // unqualified spawn that a planted taskkill.cmd could hijack.
      const tk = resolveTool("taskkill");
      const bin = (tk.ok && tk.path) || system32("taskkill.exe") || "taskkill";
      spawnSync(bin, ["/T", "/F", "/PID", String(pid)], { timeout: 5000, windowsHide: true });
      return true;
    }
    // POSIX: snapshot the descendants FIRST (killing the top reparents them to init
    // and they vanish from a later walk), reap them deepest-first — each one's own
    // process group too, in case it spawned further children after the snapshot —
    // then the top PID's group, then the top PID itself.
    const kids = posixDescendants(pid);
    for (let i = kids.length - 1; i >= 0; i--) {
      try { process.kill(-kids[i], "SIGKILL"); } catch { /* not a group leader / gone */ }
      try { process.kill(kids[i], "SIGKILL"); } catch { /* already gone */ }
    }
    try {
      process.kill(-pid, "SIGKILL"); // process group
    } catch {
      process.kill(pid, "SIGKILL");
    }
    return true;
  } catch {
    return false;
  }
}

// ── integrator ──────────────────────────────────────────────
/**
 * The safe synchronous spawn: resolve the tool (never a model path), assert the
 * argv allowlist, normalize stdin, spawn with shell:false (or `cmd.exe /c` for a
 * .cmd shim — explicit shell boundary + the arg-allowlist already refused
 * metachars), bound by timeout, tree-kill on timeout, and classify a reap
 * (timeout / spawn-failure / non-zero / zero-byte-on-exit-0).
 *
 * Returns { ok, reaped, reason?, exitCode, stdout, stderr, tool, durationMs }.
 * On a resolution/arg violation it returns ok:false WITHOUT spawning (fail-closed).
 */
function safeSpawnSync(toolId, args, opts = {}) {
  const argCheck = assertArgs(toolId, args || []);
  if (!argCheck.ok) return { ok: false, reaped: false, reason: "arg_policy_violation", violations: argCheck.violations, stdout: "", stderr: "", exitCode: null };
  const tool = resolveTool(toolId, opts.resolve || {});
  if (!tool.ok) return { ok: false, reaped: false, reason: "tool_resolution_refused", detail: tool.reason, stdout: "", stderr: "", exitCode: null };

  // #27: the agy multi-line `-p` carve-out is NATIVE-exe ONLY. A .cmd/.bat shim runs via `cmd.exe /c`
  // (below), where a newline in an arg would be reparsed by cmd.exe — so refuse a shim agy outright.
  // assertArgs permitted the newline for agy `-p`; this is the native-exe half of the allowlist-of-shape.
  if (toolId === "agy" && tool.kind !== "native") {
    return { ok: false, reaped: false, reason: "agy_requires_native_exe", detail: `agy resolved to a ${tool.kind} (${tool.path}) — the multi-line -p carve-out is native-exe only; a .cmd/.bat shim is refused`, stdout: "", stderr: "", exitCode: null };
  }

  // (b) RIDER-1 (β DECIDE B/0.90, ADR-0020-amend): bound the ASSEMBLED command line. A payload that would
  // overflow the OS command-line ceiling fails CLOSED as a NAMED oversize outcome — NEVER truncate-and-send
  // (a truncated payload is a partial review masquerading as a full PASS). The caller accounts an oversize
  // agy dispatch IDENTICALLY to agy-unavailable (the agy lane is BLOCKED → panel-3lab cannot certify that
  // run → honest 3-vs-2 accounting per ADR-0020). Bound = exe path + every argv token (+ space/quote
  // overhead) vs the Windows CreateProcess ceiling (32767) with margin. General (defense in depth); in
  // practice only agy's -p code payload approaches it.
  const assembledLen = assembledCmdlineLen(tool.path, args);
  if (assembledLen > CMDLINE_MAX) {
    return { ok: false, reaped: false, reason: "cmdline_oversize", detail: `assembled command line ${assembledLen} chars exceeds the ${CMDLINE_MAX} bound (Windows CreateProcess ceiling minus margin) — the payload is BLOCKED, never truncated-and-sent (RIDER-1). Account this run as the lane BLOCKED (agy-unavailable-equivalent), NEVER a partial-review pass.`, stdout: "", stderr: "", exitCode: null };
  }

  const timeoutMs = opts.timeoutMs || 20 * 60 * 1000;
  const input = opts.input != null ? normalizeStdin(opts.input) : undefined;
  const childEnv = withCodexHome(toolId, opts.env || process.env);

  // .cmd shim => explicit `cmd.exe /c <abs.cmd> args` (the arg-allowlist already
  // refused shell metachars, so cmd.exe parsing has nothing to weaponize). Native
  // / script / posix => arg-array, shell:false.
  let bin = tool.path;
  let spawnArgs = args || [];
  const useShell = false;
  if (tool.kind === "cmd-shim" && process.platform === "win32") {
    // GPT-5.5 review R2 HIGH: do NOT take the command processor from ComSpec
    // (env-controlled) — resolve cmd.exe to the fixed System32 location.
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
    // The spawned child's pid. For agy (native-exe only — a .cmd-shim is refused above), `bin` IS the
    // agy exe, so this is agy's OWN process pid — which agy stamps on every cli.log line (glog field 3).
    // SP-20260723-002: the auth-fallback detector scopes the shared rotating cli.log to THIS serve by pid.
    pid: typeof sp.pid === "number" ? sp.pid : null,
    stdout: reaped ? "" : stdout,
    stderr: stderr.slice(0, 4000),
    tool: { id: toolId, path: tool.path, kind: tool.kind },
    durationMs,
  };
}

// ── file-backed, savepoint-recoverable spawn (RI-004 reap fix) ──
/**
 * safeSpawnFile(toolId, args, opts) — the reap-resistant variant of safeSpawnSync
 * (ticket T-20260608-269). IDENTICAL resolution + arg-allowlist + tree-kill safety,
 * but the child's stdout is redirected to a DURABLE FILE descriptor (opts.outFile)
 * instead of an in-memory buffer that is only returned at child exit.
 *
 * Why this is the deterministic fix for the §13.6 ping reap:
 *   safeSpawnSync buffers ALL stdout in RAM and surfaces it ONLY when the child
 *   exits — so if the DISPATCHER process is auto-backgrounded + reaped mid-flight
 *   (RI-004 / the Claude Code CLI-buffer reap, which correlates with LONGER runs),
 *   the real result is lost even though `claude` may have finished. Here the OS
 *   writes the child's bytes to `outFile` AS THEY ARRIVE, so the result is durable
 *   on disk independent of how the parent dies. On clean exit we drop a SENTINEL
 *   (`outFile + ".done"`, JSON {exitCode, bytes, durationMs}) — a SAVEPOINT.
 *
 * Recovery (opts.recover, default true): BEFORE spawning, if a valid sentinel + a
 * non-empty out-file already exist for this invocation, RECOVER that result without
 * re-spawning + re-spending. So a bounded retry after a parent-side reap returns the
 * real bytes the prior attempt actually produced (savepoint-and-recover, the RI-004
 * chunk+savepoint pattern applied to a single skill ping).
 *
 * Returns the SAME shape as safeSpawnSync, PLUS { outFile, recovered, savepoint }.
 * On a resolution/arg violation it returns ok:false WITHOUT spawning (fail-closed).
 *
 * Required: opts.outFile (absolute path the child stdout is written to).
 */
function safeSpawnFile(toolId, args, opts = {}) {
  if (!opts.outFile) {
    return { ok: false, reaped: false, reason: "missing_out_file", detail: "safeSpawnFile requires opts.outFile", stdout: "", stderr: "", exitCode: null };
  }
  // The arg-allowlist gates EVERY path (never recover on a malformed invocation).
  const argCheck = assertArgs(toolId, args || []);
  if (!argCheck.ok) return { ok: false, reaped: false, reason: "arg_policy_violation", violations: argCheck.violations, stdout: "", stderr: "", exitCode: null };

  const outFile = path.resolve(opts.outFile);
  const sentinel = outFile + ".done";
  const recover = opts.recover !== false;

  // ── Savepoint recovery: a prior attempt already finished cleanly? ──
  // A valid sentinel ({ok:true,...}) + a non-empty out-file = a recoverable result.
  // Checked BEFORE resolveTool: recovery needs no live tool (the work is already done),
  // and a retry after a reap should not re-fail on a transient resolution hiccup.
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
      /* corrupt/partial savepoint → fall through and re-spawn */
    }
  }

  const tool = resolveTool(toolId, opts.resolve || {});
  if (!tool.ok) return { ok: false, reaped: false, reason: "tool_resolution_refused", detail: tool.reason, stdout: "", stderr: "", exitCode: null };

  // #27: the agy multi-line `-p` carve-out is NATIVE-exe ONLY. A .cmd/.bat shim runs via `cmd.exe /c`
  // (below), where a newline in an arg would be reparsed by cmd.exe — so refuse a shim agy outright.
  // assertArgs permitted the newline for agy `-p`; this is the native-exe half of the allowlist-of-shape.
  if (toolId === "agy" && tool.kind !== "native") {
    return { ok: false, reaped: false, reason: "agy_requires_native_exe", detail: `agy resolved to a ${tool.kind} (${tool.path}) — the multi-line -p carve-out is native-exe only; a .cmd/.bat shim is refused`, stdout: "", stderr: "", exitCode: null };
  }

  // (b) RIDER-1 (β DECIDE B/0.90, ADR-0020-amend): bound the ASSEMBLED command line. A payload that would
  // overflow the OS command-line ceiling fails CLOSED as a NAMED oversize outcome — NEVER truncate-and-send
  // (a truncated payload is a partial review masquerading as a full PASS). The caller accounts an oversize
  // agy dispatch IDENTICALLY to agy-unavailable (the agy lane is BLOCKED → panel-3lab cannot certify that
  // run → honest 3-vs-2 accounting per ADR-0020). Bound = exe path + every argv token (+ space/quote
  // overhead) vs the Windows CreateProcess ceiling (32767) with margin. General (defense in depth); in
  // practice only agy's -p code payload approaches it.
  const assembledLen = assembledCmdlineLen(tool.path, args);
  if (assembledLen > CMDLINE_MAX) {
    return { ok: false, reaped: false, reason: "cmdline_oversize", detail: `assembled command line ${assembledLen} chars exceeds the ${CMDLINE_MAX} bound (Windows CreateProcess ceiling minus margin) — the payload is BLOCKED, never truncated-and-sent (RIDER-1). Account this run as the lane BLOCKED (agy-unavailable-equivalent), NEVER a partial-review pass.`, stdout: "", stderr: "", exitCode: null };
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

  // Open the out-file for writing and hand its fd to the child as stdout. The OS
  // flushes the child's bytes to disk as they are produced — durable across a parent
  // reap. A fresh (truncated) file each spawn; the sentinel is removed first so a
  // stale one can never mask a fresh in-flight run.
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  try { fs.rmSync(sentinel, { force: true }); } catch { /* best effort */ }
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
    try { fs.closeSync(outFd); } catch { /* already closed */ }
  }
  const durationMs = Date.now() - started;

  // stdout came from the FILE, not the buffer (stdio[1] was an fd, so sp.stdout is null).
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

  // On a clean run, drop the SAVEPOINT sentinel so a later retry can recover without
  // re-spending. A reaped run leaves NO sentinel (nothing trustworthy to recover).
  if (!reaped) {
    try {
      fs.writeFileSync(sentinel, JSON.stringify({ ok: true, exitCode: typeof status === "number" ? status : 0, bytes: Buffer.byteLength(stdout, "utf8"), durationMs }) + "\n", "utf8");
    } catch { /* best effort — the out-file itself is still the durable proof */ }
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
    tool: { id: toolId, path: tool.path, kind: tool.kind },
    durationMs,
  };
}

module.exports = { resolveTool, assertArgs, normalizeStdin, treeKill, safeSpawnSync, safeSpawnFile, TOOL_IDS, ARG_POLICY, PROJECT_ROOT, CMDLINE_MAX, assembledCmdlineLen, AGY_FORBIDDEN_SKIP_PERM, withCodexHome, DEFAULT_CODEX_HOME };
