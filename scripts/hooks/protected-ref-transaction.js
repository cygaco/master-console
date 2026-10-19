#!/usr/bin/env node
"use strict";
/**
 * protected-ref-transaction.js — the git `reference-transaction` hook:
 * Seam E. The sole-route MECHANISM: for any transaction touching a PROTECTED ref (refs/heads/main), it
 * requires the current trusted-controller fencing token — set ONLY around trusted-controller.js's own
 * `commitIntegration` call (see its `withControllerFence` helper) — via a scoped environment variable.
 * Absent/invalid → this hook exits non-zero in the `prepared` phase → git ABORTS the transaction (the ref
 * is never created/updated).
 *
 * BEHAVIOUR: the `reference-transaction` hook FIRES on every write surface — `commit`, `git update-ref`, fast-forward merge, non-ff
 * merge — to a protected ref, across all its phases (preparing/prepared/committed/aborted). A non-zero exit
 * in the `prepared` phase genuinely ABORTS the write (git: "in 'prepared' phase, update aborted by the
 * reference-transaction hook" — the ref is verified absent afterward). `--no-verify` does NOT bypass
 * `reference-transaction` hooks (it only bypasses pre-commit/commit-msg/pre-push) — so this mechanism
 * resists the `--no-verify` mistake class entirely (see precommit-bypass-harmless.falsifier.test.js).
 *
 * HONEST CEILING (named, evidence-grounded, accepted out-of-scope — adversarial containment, explicitly OUT of
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

const FENCE_TOKEN_ENV = "MC_CONTROLLER_FENCE_TOKEN";
const FENCE_SPID_ENV = "MC_CONTROLLER_FENCE_SPID";
const FENCE_LEASEROOT_ENV = "MC_CONTROLLER_FENCE_LEASE_ROOT";

const PROTECTED_REFS = Object.freeze(["refs/heads/main"]);

function isProtectedRef(refName) {
  return typeof refName === "string" && PROTECTED_REFS.includes(refName.trim());
}

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

function evaluate({ state, stdinText, env }) {
  const lines = parseTransactionLines(stdinText);
  if (!touchesProtectedRef(lines)) {
    return { allow: true, reason: "no-protected-ref-touched" };
  }
  if (state !== "prepared") {
    return { allow: true, reason: "non-prepared-phase-informational" };
  }
  if (!verifyFence(env || {})) {
    return { allow: false, reason: "no-current-controller-fence" };
  }
  return { allow: true, reason: "fence-verified" };
}

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
    if (state === "prepared") {
      process.stderr.write(`protected-ref-transaction: stdin unreadable (fail-closed, prepared phase ABORTS): ${e && e.message}\n`);
      return 1;
    }
    return 0;
  }
  const result = evaluate({ state, stdinText, env: env || process.env });
  if (!result.allow) {
    process.stderr.write(
      `protected-ref-transaction: REFUSED (${result.reason}) — a write to a protected ref (${PROTECTED_REFS.join(", ")}) requires the current trusted-controller fence (Seam E).\n`,
    );
    return 1;
  }
  return 0;
}

const PINNED_HOOK_MODULE = __filename;

function renderReferenceTransactionHook(pinnedHookSrcAbs) {
  const p = String(pinnedHookSrcAbs || PINNED_HOOK_MODULE).replace(/\\/g, "/");
  return `#!/usr/bin/env bash\nexec node "${p}" "$@"\n`;
}

function installReferenceTransactionHook(hooksDir, pinnedHookSrcAbs) {
  fs.mkdirSync(hooksDir, { recursive: true });
  const target = path.join(hooksDir, "reference-transaction");
  fs.writeFileSync(target, renderReferenceTransactionHook(pinnedHookSrcAbs || PINNED_HOOK_MODULE));
  try {
    fs.chmodSync(target, 0o755);
  } catch {
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
