#!/usr/bin/env node

/**
 * scripts/admin/preview.js — the admin:* suite KEYSTONE (SP-20260614-002, Builder 1).
 *
 * Opens a PRODUCT's in-app founder admin panel in the browser, against a fixed,
 * reused throwaway Next instance. This is DEV-TOOLING (a skill harness), NOT
 * product code. It targets a PRODUCT app — NEVER MC itself.
 *
 * Flow (CONTRACT.md §B, in order):
 *   1. refuseIfTargetIsMC(targetDir) FIRST — non-zero, no side effects.   [AC-R1c]
 *   2. resolve-or-scaffold (reuse-default + upfront ETA banner on cold).      [AC-R1a/b]
 *   3. ensureDeps (npm install if node_modules absent), fail-CLEAR + nonzero. [AC-R1c]
 *   4. spawn `npm run dev` (NOT detached) + poll-ready + PARSE the real port,
 *      90s timeout → kill child + fail-CLEAR + nonzero, never orphan.         [AC-R1a/c]
 *   5. on ready: write the instance pointer (SOLE writer, atomic) then open.  [AC-R1b/R3c]
 *   6. emit `PREVIEW_URL=...` for the Playwright lane.                        [AC-R6a]
 *
 * Pointer single-writer invariant (CONTRACT.md §A): THIS file is the SOLE writer
 * of `.claude/runtime/admin-preview.json`. seed.js READS it only. The write uses
 * the mode-set.js chokepoint pattern: atomic tmp + rename.
 *
 * CLI:
 *   node scripts/admin/preview.js [--route <subroute>] [--force]
 *                                 [--instance-dir <dir>] [--json]
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { isCanonicalDir } = require("../mc/repo-role");

const IS_WIN = process.platform === "win32";

// Repo root = scripts/admin/preview.js → ../../
const REPO_ROOT = path.resolve(__dirname, "..", "..");
// MC canonical root, for the refusal guard. From within a worktree this still
// resolves to the worktree's checkout root — the manifest-based checks below are
// the authoritative defence; the path-equality check is the fast belt.
const WARPOS_ROOT = REPO_ROOT;

const DEFAULT_INSTANCE_DIR = path.join(REPO_ROOT, "runtime", "admin-preview", "instance");
const POINTER_PATH = path.join(REPO_ROOT, ".claude", "runtime", "admin-preview.json");
const DEFAULT_ROUTE = "/admin";
const READY_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 250;

// Port is parsed from the "- Local:" line (Next prints it EARLY). READINESS requires
// an EXPLICIT ready signal that Next prints AFTER "- Local:" + the first compile —
// using "- Local:" or "compiled" as the ready signal opens the browser prematurely
// (xprovider review BLOCKER #1). Signal variants across Next 13/14/15/16.
const READY_SIGNAL_RE = /Ready in|ready on|started server on/i;
const PORT_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):(\d+)/i;

// ── Browser auto-open ─────────────────────────────────────────
// LIFTED VERBATIM from scripts/dispatch/gui.js:43-59 (do not modify).
function openInBrowser(url) {
  try {
    if (process.platform === "win32") {
      // The empty "" is a title arg required by Windows `start`
      spawn("cmd", ["/c", "start", '""', url], {
        detached: true,
        stdio: "ignore",
      }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {
    // Browser open failed — caller already printed the URL, user can paste it
  }
}

// ── MC refusal guard (AC-R1c) ─────────────────────────────
// Refuse if the resolved target is the MC canonical tree. Detection:
//   (a) fast belt: path.resolve(targetDir) === WARPOS_ROOT, OR
//   (b) isCanonicalDir(targetDir) — the env-IMMUNE, signals-only detector in
//       scripts/mc/repo-role.js (the single source per ED-009). It covers
//       the _mc/MANIFEST.json marker, the manifest self-identity fields, and
//       the version.json heuristic in ONE place, and ignores WARPOS_REPO_ROLE so
//       the safety floor can't be env-spoofed (xprovider HIGH #5).
// Delegates detection to the resolver rather than re-deriving canonical signals
// inline (which would re-introduce the role-derivation drift ED-009 forbids).
function refuseIfTargetIsMC(targetDir) {
  const resolved = path.resolve(targetDir);
  if (resolved === WARPOS_ROOT) {
    return { refuse: true, reason: `resolved target is the MC canonical root (${resolved})` };
  }
  if (isCanonicalDir(resolved)) {
    return { refuse: true, reason: `target resolves to the MC canonical tree (repo-role canonical signal at ${resolved})` };
  }
  return { refuse: false };
}

// ── ready-line detection + port parse ─────────────────────────
// Exported as the unit under test for the boot-detection corpus. Returns
// { ready, port } over an accumulated stdout/stderr buffer.
function detectReady(buffer) {
  // Require an EXPLICIT ready signal — NOT a bare "- Local:"/"compiled" line, which
  // Next prints before the server is actually ready (xprovider review BLOCKER #1).
  if (!READY_SIGNAL_RE.test(buffer)) return { ready: false, port: null };
  const m = buffer.match(PORT_RE);
  // Ready signal seen but no port yet → keep polling.
  if (!m) return { ready: false, port: null };
  return { ready: true, port: Number(m[1]) };
}

// ── pointer write (SOLE writer, atomic tmp+rename) ────────────
function writePointer({ instanceDir, port, pid, route }) {
  const pointer = {
    $schema: "mc/admin-preview/v1",
    instanceDir: path.resolve(instanceDir),
    slug: "admin-preview-instance",
    port,
    pid,
    url: `http://localhost:${port}`,
    route,
    startedAt: new Date().toISOString(),
    startedBy: "admin:preview",
  };
  fs.mkdirSync(path.dirname(POINTER_PATH), { recursive: true });
  const tmp = `${POINTER_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(pointer, null, 2) + "\n");
  fs.renameSync(tmp, POINTER_PATH); // atomic on same filesystem
  return pointer;
}

// ── arg parse ─────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { route: DEFAULT_ROUTE, force: false, instanceDir: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--route") out.route = argv[++i] || DEFAULT_ROUTE;
    else if (a === "--force") out.force = true;
    else if (a === "--instance-dir") out.instanceDir = argv[++i] || null;
    else if (a === "--json") out.json = true;
  }
  if (!out.route.startsWith("/")) out.route = "/" + out.route;
  return out;
}

// ── resolve-or-scaffold (reuse-default) ───────────────────────
function resolveOrScaffold({ instanceDir, force, log }) {
  const pkg = path.join(instanceDir, "package.json");
  if (fs.existsSync(pkg) && !force) {
    log(`[admin:preview] reusing existing instance at ${instanceDir} (no re-scaffold)`);
    return { ok: true, reused: true };
  }
  // Cold path — upfront ETA banner BEFORE any long step (AC-R1a).
  log(
    "[admin:preview] scaffolding a throwaway instance, ~30-90s incl. npm install; " +
      "reused on later runs.",
  );
  fs.mkdirSync(instanceDir, { recursive: true });
  let scaffoldProductApp;
  try {
    ({ scaffoldProductApp } = require("../portfolio/new-lib"));
  } catch (e) {
    return { ok: false, error: `cannot load scaffoldProductApp: ${e.message}` };
  }
  const res = scaffoldProductApp({
    repoRoot: instanceDir,
    slug: "admin-preview-instance",
    install: false,
    log,
  });
  if (!res || !res.ok) {
    return { ok: false, error: `app scaffold absent / scaffold failed: ${(res && res.error) || "unknown"}` };
  }
  return { ok: true, reused: false };
}

// ── ensureDeps (npm install if node_modules absent) ───────────
function ensureDeps({ instanceDir, log }) {
  const nm = path.join(instanceDir, "node_modules");
  if (fs.existsSync(nm)) return Promise.resolve({ ok: true, installed: false });
  log(`[admin:preview] installing dependencies in ${instanceDir} (npm install)...`);
  return new Promise((resolve) => {
    const child = spawn("npm", ["install"], { cwd: instanceDir, stdio: "inherit", shell: IS_WIN });
    child.on("error", (err) =>
      resolve({ ok: false, error: `npm install failed in ${instanceDir}: ${err.message}. Remediation: cd "${instanceDir}" && npm install` }),
    );
    child.on("exit", (code) => {
      if (code === 0) resolve({ ok: true, installed: true });
      else
        resolve({
          ok: false,
          error: `npm install failed in ${instanceDir} (exit ${code}). Remediation: cd "${instanceDir}" && npm install`,
        });
    });
  });
}

// ── tree-kill: on win32 `npm run dev` runs under cmd.exe (shell:true), so a bare
// child.kill() kills only the shell and ORPHANS the node/next grandchild. Kill the
// whole process tree (precedent: scripts/dispatch/safe-spawn.js). [SP-20260614-002 gauntlet]
function treeKill(child) {
  if (!child || child.killed) return;
  try {
    if (IS_WIN && child.pid) {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      child.kill();
    }
  } catch {
    /* already gone */
  }
}

// ── start dev + poll-ready + parse port ───────────────────────
function startDevAndWaitReady({ instanceDir, log }) {
  return new Promise((resolve) => {
    const child = spawn("npm", ["run", "dev"], {
      cwd: instanceDir,
      stdio: ["ignore", "pipe", "pipe"],
      shell: IS_WIN,
    });

    let buffer = "";
    let settled = false;
    let timer = null;
    let poll = null;

    const cleanupTimers = () => {
      if (timer) clearTimeout(timer);
      if (poll) clearInterval(poll);
      timer = null;
      poll = null;
    };
    const killChild = () => treeKill(child); // tree-kill: never orphan the grandchild
    const onData = (chunk) => {
      const s = chunk.toString();
      buffer += s;
      process.stdout.write(s); // tee to our stdout
    };

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      cleanupTimers();
      killChild();
      resolve({ ok: false, error: `dev server failed to start in ${instanceDir}: ${err.message}` });
    });
    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      cleanupTimers();
      resolve({ ok: false, error: `dev server exited before ready (exit ${code}) — build error? Check the log above.` });
    });

    poll = setInterval(() => {
      if (settled) return;
      const { ready, port } = detectReady(buffer);
      if (ready) {
        settled = true;
        cleanupTimers();
        resolve({ ok: true, port, child });
      }
    }, POLL_INTERVAL_MS);

    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanupTimers();
      killChild(); // kill on timeout → never orphan
      resolve({
        ok: false,
        error:
          "dev server not ready within 90s — port busy or a build error. " +
          `Remediation: cd "${instanceDir}" && npm run dev to see the error.`,
      });
    }, READY_TIMEOUT_MS);
  });
}

// ── orchestrator ──────────────────────────────────────────────
// `deps` is a seam for tests: the scaffold + dev-server + browser-open are
// injectable so the corpus never spawns a real `npm run dev`. Production passes
// nothing → the real module functions are used.
async function run(argv, deps = {}) {
  const _resolveOrScaffold = deps.resolveOrScaffold || resolveOrScaffold;
  const _ensureDeps = deps.ensureDeps || ensureDeps;
  const _startDevAndWaitReady = deps.startDevAndWaitReady || startDevAndWaitReady;
  const _openInBrowser = deps.openInBrowser || openInBrowser;
  const args = parseArgs(argv);
  const log = (m) => console.log(m);
  const fail = (msg) => {
    console.error(`[admin:preview] FAILED: ${msg}`);
    return { ok: false, error: msg };
  };

  const instanceDir = args.instanceDir
    ? path.resolve(args.instanceDir)
    : DEFAULT_INSTANCE_DIR;

  // 1. MC refusal — FIRST, before any side effect.
  const guard = refuseIfTargetIsMC(instanceDir);
  if (guard.refuse) {
    return fail(
      `refusing to preview the MC canonical root — ${guard.reason}. ` +
        "admin:preview targets a PRODUCT app, never MC itself.",
    );
  }

  // 2. resolve-or-scaffold (reuse-default + ETA banner on cold).
  const scaff = _resolveOrScaffold({ instanceDir, force: args.force, log });
  if (!scaff.ok) return fail(scaff.error);

  // 3. ensureDeps.
  const depsResult = await _ensureDeps({ instanceDir, log });
  if (!depsResult.ok) return fail(depsResult.error);

  // 4. start dev + poll-ready + parse port.
  const boot = await _startDevAndWaitReady({ instanceDir, log });
  if (!boot.ok) return fail(boot.error);

  const { port, child } = boot;

  // 5. write pointer (SOLE writer, atomic) then open browser.
  let pointer;
  try {
    pointer = writePointer({ instanceDir, port, pid: child.pid, route: args.route });
  } catch (e) {
    treeKill(child);
    return fail(`could not write instance pointer ${POINTER_PATH}: ${e.message}`);
  }

  const url = `http://localhost:${port}${args.route}`;
  _openInBrowser(url);

  // 6. emit the stable machine-readable URL for the Playwright lane (AC-R6a).
  // Always /admin form per CONTRACT §B.6, regardless of sub-route opened.
  console.log(`PREVIEW_URL=http://localhost:${port}/admin`);
  log(`[admin:preview] ready — opened ${url}`);

  if (args.json) {
    console.log(JSON.stringify({ ok: true, port, url, pointer }, null, 2));
  }

  // Reuse-warm/foreground: dev server runs until Ctrl-C (acceptable for a
  // preview tool). The child is NOT detached and is killed on our exit.
  // Centralized, idempotent dev-server cleanup — never orphan the child across ANY
  // exit path (xprovider review BLOCKER #2). treeKill is a no-op once killed, so
  // repeated handlers are safe.
  const cleanup = () => treeKill(child);
  process.on("SIGINT", () => { cleanup(); process.exit(0); });
  process.on("SIGTERM", () => { cleanup(); process.exit(0); });
  process.on("SIGHUP", () => { cleanup(); process.exit(0); });
  process.on("uncaughtException", (err) => { cleanup(); console.error(err); process.exit(1); });
  process.on("exit", cleanup);

  return { ok: true, port, url, child };
}

// ── CLI entry ─────────────────────────────────────────────────
if (require.main === module) {
  run(process.argv.slice(2))
    .then((r) => {
      if (!r || !r.ok) process.exit(1);
      // success: keep the process alive (foreground dev server). Do NOT exit 0.
    })
    .catch((e) => {
      console.error(`[admin:preview] FAILED: ${e && e.message ? e.message : e}`);
      process.exit(1);
    });
}

module.exports = {
  openInBrowser,
  refuseIfTargetIsMC,
  detectReady,
  writePointer,
  resolveOrScaffold,
  ensureDeps,
  startDevAndWaitReady,
  parseArgs,
  run,
  READY_SIGNAL_RE,
  PORT_RE,
  POINTER_PATH,
  DEFAULT_INSTANCE_DIR,
  DEFAULT_ROUTE,
  WARPOS_ROOT,
};
