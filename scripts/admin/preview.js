#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { isCanonicalDir } = require("../mc/repo-role");

const IS_WIN = process.platform === "win32";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const MC_ROOT = REPO_ROOT;

const DEFAULT_INSTANCE_DIR = path.join(REPO_ROOT, "runtime", "admin-preview", "instance");
const POINTER_PATH = path.join(REPO_ROOT, ".claude", "runtime", "admin-preview.json");
const DEFAULT_ROUTE = "/admin";
const READY_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 250;

const READY_SIGNAL_RE = /Ready in|ready on|started server on/i;
const PORT_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):(\d+)/i;

function openInBrowser(url) {
  try {
    if (process.platform === "win32") {
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
  }
}

function refuseIfTargetIsMC(targetDir) {
  const resolved = path.resolve(targetDir);
  if (resolved === MC_ROOT) {
    return { refuse: true, reason: `resolved target is the MC canonical root (${resolved})` };
  }
  if (isCanonicalDir(resolved)) {
    return { refuse: true, reason: `target resolves to the MC canonical tree (repo-role canonical signal at ${resolved})` };
  }
  return { refuse: false };
}

function detectReady(buffer) {
  if (!READY_SIGNAL_RE.test(buffer)) return { ready: false, port: null };
  const m = buffer.match(PORT_RE);
  if (!m) return { ready: false, port: null };
  return { ready: true, port: Number(m[1]) };
}

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
  fs.renameSync(tmp, POINTER_PATH);
  return pointer;
}

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

function resolveOrScaffold({ instanceDir, force, log }) {
  const pkg = path.join(instanceDir, "package.json");
  if (fs.existsSync(pkg) && !force) {
    log(`[admin:preview] reusing existing instance at ${instanceDir} (no re-scaffold)`);
    return { ok: true, reused: true };
  }
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

function treeKill(child) {
  if (!child || child.killed) return;
  try {
    if (IS_WIN && child.pid) {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      child.kill();
    }
  } catch {
  }
}

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
    const killChild = () => treeKill(child);
    const onData = (chunk) => {
      const s = chunk.toString();
      buffer += s;
      process.stdout.write(s);
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
      killChild();
      resolve({
        ok: false,
        error:
          "dev server not ready within 90s — port busy or a build error. " +
          `Remediation: cd "${instanceDir}" && npm run dev to see the error.`,
      });
    }, READY_TIMEOUT_MS);
  });
}

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

  const guard = refuseIfTargetIsMC(instanceDir);
  if (guard.refuse) {
    return fail(
      `refusing to preview the MC canonical root — ${guard.reason}. ` +
        "admin:preview targets a PRODUCT app, never MC itself.",
    );
  }

  const scaff = _resolveOrScaffold({ instanceDir, force: args.force, log });
  if (!scaff.ok) return fail(scaff.error);

  const depsResult = await _ensureDeps({ instanceDir, log });
  if (!depsResult.ok) return fail(depsResult.error);

  const boot = await _startDevAndWaitReady({ instanceDir, log });
  if (!boot.ok) return fail(boot.error);

  const { port, child } = boot;

  let pointer;
  try {
    pointer = writePointer({ instanceDir, port, pid: child.pid, route: args.route });
  } catch (e) {
    treeKill(child);
    return fail(`could not write instance pointer ${POINTER_PATH}: ${e.message}`);
  }

  const url = `http://localhost:${port}${args.route}`;
  _openInBrowser(url);

  console.log(`PREVIEW_URL=http://localhost:${port}/admin`);
  log(`[admin:preview] ready — opened ${url}`);

  if (args.json) {
    console.log(JSON.stringify({ ok: true, port, url, pointer }, null, 2));
  }

  const cleanup = () => treeKill(child);
  process.on("SIGINT", () => { cleanup(); process.exit(0); });
  process.on("SIGTERM", () => { cleanup(); process.exit(0); });
  process.on("SIGHUP", () => { cleanup(); process.exit(0); });
  process.on("uncaughtException", (err) => { cleanup(); console.error(err); process.exit(1); });
  process.on("exit", cleanup);

  return { ok: true, port, url, child };
}

if (require.main === module) {
  run(process.argv.slice(2))
    .then((r) => {
      if (!r || !r.ok) process.exit(1);
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
  MC_ROOT,
};
