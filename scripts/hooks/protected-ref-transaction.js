#!/usr/bin/env node
"use strict";
/**
 * protected-ref-transaction.js — the git `reference-transaction` hook (SP-20260720-002 Phase 4, Seam E,
 * β rider 2). The sole-route MECHANISM: for any transaction touching a PROTECTED ref (refs/heads/main), it
 * requires the current trusted-controller fencing token — set ONLY around trusted-controller.js's own
 * `commitIntegration` call (see its `withControllerFence` helper) — via a scoped environment variable.
 * Absent/invalid → this hook exits non-zero in the `prepared` phase → git ABORTS the transaction (the ref
 * is never created/updated).
 *
 * EVIDENCE (runtime/sp002-phase4/reftxn-probe-evidence.md, git 2.54.0.windows.1): the `reference-
 * transaction` hook FIRES on every write surface — `commit`, `git update-ref`, fast-forward merge, non-ff
 * merge — to a protected ref, across all its phases (preparing/prepared/committed/aborted). A non-zero exit
 * in the `prepared` phase genuinely ABORTS the write (git: "in 'prepared' phase, update aborted by the
 * reference-transaction hook" — the ref is verified absent afterward). `--no-verify` does NOT bypass
 * `reference-transaction` hooks (it only bypasses pre-commit/commit-msg/pre-push) — so this mechanism
 * resists the `--no-verify` mistake class entirely (see precommit-bypass-harmless.falsifier.test.js).
 *
 * HONEST CEILING (named, evidence-grounded, operator-DROPPED — adversarial containment, explicitly OUT of
 * scope): `core.hooksPath` redirect, hook file deletion, a direct `.git/refs/**` filesystem write, and a
 * hostile process forging the fence env vars itself. All four require local shell access + intent; this
 * mechanism defends against MISTAKES (an un-brokered merge/update-ref/push/fast-forward), not a hostile
 * operator with a shell.
 *
 * git's reference-transaction hook contract: ONE argv token — the transaction `state` ("prepared" |
 * "committed" | "aborted") — and, on stdin, one line per ref being touched: `<old-value> SP <new-value> SP
 * <ref-name> LF`. Only a non-zero exit during the `prepared` phase can abort; `committed`/`aborted` are
 * purely informational (git does not act on their exit codes to reverse anything).
 *
 * Installed via `scripts/install-git-hooks.sh` (a thin bash wrapper execs this file with node — the same
 * pattern the existing pre-commit hook uses).
 */

const fs = require("fs");
const path = require("path");

// SHARED CONSTANTS — trusted-controller.js requires THIS module (not the other way around) to read these
// three names, so there is exactly one place they are defined. Keep the literal values stable: any change
// here MUST be mirrored by trusted-controller.js's withControllerFence call site (which imports them).
const FENCE_TOKEN_ENV = "MC_CONTROLLER_FENCE_TOKEN";
const FENCE_SPID_ENV = "MC_CONTROLLER_FENCE_SPID";
const FENCE_LEASEROOT_ENV = "MC_CONTROLLER_FENCE_LEASE_ROOT";

// The write-surface enumeration (build_spec Seam E) is delegation-COMPLETE for exactly ONE protected ref
// pattern today: refs/heads/main. Extending protection to another ref is a one-line addition here.
const PROTECTED_REFS = Object.freeze(["refs/heads/main"]);

function isProtectedRef(refName) {
  return typeof refName === "string" && PROTECTED_REFS.includes(refName.trim());
}

/** Parse reference-transaction stdin lines into {oldValue, newValue, refName}[]. Malformed lines are
 *  skipped (never silently treated as "not protected" — see touchesProtectedRef's fail-closed default). */
function parseTransactionLines(raw) {
  const out = [];
  for (const line of String(raw || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(" ");
    if (parts.length < 3) continue;
    out.push({ oldValue: parts[0], newValue: parts[1], refName: parts.slice(2).join(" ") });
  }
  return out;
}

function touchesProtectedRef(lines) {
  return lines.some((l) => isProtectedRef(l.refName));
}

/** verifyFence(env) -> boolean. TRUE only when a current, valid fencing token is present in the scoped env
 *  vars. Lazily requires conductor-lease so a missing/broken lease module fails CLOSED (never silently
 *  skips the check) — mirrors acceptance-record.js#verifyFencingToken's own posture. */
function verifyFence(env) {
  const token = env[FENCE_TOKEN_ENV];
  const spId = env[FENCE_SPID_ENV];
  const leaseRoot = env[FENCE_LEASEROOT_ENV];
  if (!token || !spId) return false;
  let lease;
  try {
    // eslint-disable-next-line global-require
    lease = require("../dispatch/conductor-lease");
  } catch {
    return false;
  }
  if (!lease || typeof lease.verifyToken !== "function") return false;
  const numericToken = /^-?\d+$/.test(token) ? Number(token) : token;
  try {
    return lease.verifyToken(spId, numericToken, { root: leaseRoot || undefined }) === true;
  } catch {
    return false;
  }
}

/**
 * evaluate({state, stdinText, env}) -> {allow, reason}. PURE — no process.exit, no fs beyond what the
 * caller already read. The hermetic seam every falsifier drives directly; `main()` below is the thin CLI
 * wrapper that reads real argv/stdin/env and maps this to an exit code.
 */
function evaluate({ state, stdinText, env }) {
  const lines = parseTransactionLines(stdinText);
  if (!touchesProtectedRef(lines)) {
    return { allow: true, reason: "no-protected-ref-touched" };
  }
  // Only the 'prepared' phase can actually abort a git transaction — 'committed'/'aborted' are
  // informational per git's own hook contract; refusing there would do nothing but spam stderr.
  if (state !== "prepared") {
    return { allow: true, reason: "non-prepared-phase-informational" };
  }
  if (!verifyFence(env || {})) {
    return { allow: false, reason: "no-current-controller-fence" };
  }
  return { allow: true, reason: "fence-verified" };
}

/**
 * readStdin() -> string. THROWS (never swallows) on any fs.readFileSync failure — FIX-2 / QA-002: a hook
 * whose stdin read fails must not silently become "no lines read" -> "no protected ref touched" ->
 * allow:true. The caller (main()) is the ONE place that decides what a read failure MEANS per phase; this
 * function's job is only to surface the failure, never to mask it behind a fallback "" value.
 */
function readStdin() {
  return fs.readFileSync(0, "utf8");
}

function main(argv, env, deps = {}) {
  const state = argv[2];
  const doReadStdin = typeof deps.readStdin === "function" ? deps.readStdin : readStdin;
  let stdinText = "";
  try {
    stdinText = doReadStdin();
  } catch (e) {
    // FIX-2 (QA-002, sole-route fail-open): a stdin read (or parse) failure on the 'prepared' phase for a
    // protected ref must fail CLOSED — we cannot know yet whether this transaction even touches a
    // protected ref without the lines, so an unreadable stdin is treated as touching-protected and the
    // transaction is REFUSED (non-zero) for EVERY prepared-phase read failure. Only the purely
    // informational, non-aborting phases ('committed'/'aborted') tolerate an unreadable stdin.
    if (state === "prepared") {
      process.stderr.write(`protected-ref-transaction: stdin unreadable (fail-closed, prepared phase ABORTS): ${e && e.message}\n`);
      return 1;
    }
    return 0;
  }
  const result = evaluate({ state, stdinText, env: env || process.env });
  if (!result.allow) {
    process.stderr.write(
      `protected-ref-transaction: REFUSED (${result.reason}) — a write to a protected ref (${PROTECTED_REFS.join(", ")}) requires the current trusted-controller fence (Seam E, β rider 2).\n`,
    );
    return 1;
  }
  return 0;
}

// ── S4 (QA-SP002-001 / QA-SP002-R2-001) — the CANONICAL `reference-transaction` wrapper. ──────────────────
//
// A git hook is a FILE git executes; this module is the LOGIC that file must invoke. R1's liveness verifier
// accepted any hook whose CONTENT merely matched `/protected-ref-transaction(\.js)?/` — so a mis-generated /
// truncated / corrupted installer output that kept the name as a COMMENT (`# protected-ref-transaction.js`
// + `exit 0`) verified as "pinned" while enforcing NOTHING. Shipping the wrapper's exact text from ONE
// in-repo source means the installer and the verifier can never drift: `installReferenceTransactionHook`
// writes exactly `renderReferenceTransactionHook(...)`, and `verifyActiveHookInstalled`
// (trusted-controller.js) proves the ACTIVE file genuinely INVOKES this module — content-hash-equal to the
// canonical render, or (for a hand-installed variant) carrying a real, resolvable invocation of this exact
// file. A name in a comment is not an invocation.
//
// HONEST CEILING (unchanged, operator-DROPPED): a hostile shell can still delete the hook, redirect
// `core.hooksPath`, or plant matching content elsewhere. This closes the MISTAKE class, not containment.

/** The absolute, canonical on-disk path of THIS module — what an active hook must actually invoke. */
const PINNED_HOOK_MODULE = __filename;

/**
 * renderReferenceTransactionHook(pinnedHookSrcAbs) -> the EXACT canonical wrapper text. Deterministic given
 * the pinned module path (POSIX-normalized so a Windows path produces byte-identical text to its git-bash
 * form). This is the ONE definition of "a correctly installed reference-transaction hook".
 */
function renderReferenceTransactionHook(pinnedHookSrcAbs) {
  const p = String(pinnedHookSrcAbs || PINNED_HOOK_MODULE).replace(/\\/g, "/");
  return `#!/usr/bin/env bash\nexec node "${p}" "$@"\n`;
}

/** Write the canonical wrapper into `hooksDir` as `reference-transaction` (0755 best-effort). Returns the
 *  absolute path written. The ONE sanctioned installer — every caller (including test fixtures) uses it, so
 *  "what gets installed" and "what gets verified" cannot drift. */
function installReferenceTransactionHook(hooksDir, pinnedHookSrcAbs) {
  fs.mkdirSync(hooksDir, { recursive: true });
  const target = path.join(hooksDir, "reference-transaction");
  fs.writeFileSync(target, renderReferenceTransactionHook(pinnedHookSrcAbs || PINNED_HOOK_MODULE));
  try {
    fs.chmodSync(target, 0o755);
  } catch {
    /* best-effort on platforms without a meaningful chmod */
  }
  return target;
}

if (require.main === module) {
  process.exit(main(process.argv, process.env));
}

module.exports = {
  main,
  evaluate,
  parseTransactionLines,
  renderReferenceTransactionHook,
  installReferenceTransactionHook,
  PINNED_HOOK_MODULE,
  touchesProtectedRef,
  isProtectedRef,
  verifyFence,
  readStdin,
  PROTECTED_REFS,
  FENCE_TOKEN_ENV,
  FENCE_SPID_ENV,
  FENCE_LEASEROOT_ENV,
};
