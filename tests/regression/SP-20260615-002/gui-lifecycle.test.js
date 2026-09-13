#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// gui-lifecycle.test.js — SP-20260615-002 S-2 / AC-R2c [β-1]
//
// ::prints-exact-url-on-stdout-AND-review-mode-disables-autoshutdown
//   (a) On bind, the server prints the EXACT reachable URL on a stable,
//       machine-readable stdout line (ROADMAP_GUI_URL http://127.0.0.1:<port>/<tok>/)
//       and that URL is actually reachable (the harness reads the port off this line,
//       never guesses it).
//   (b) In --review-mode the auto-exit lifecycle is DISABLED: closing stdin does NOT
//       kill the server (it stays up and keeps serving). We prove this by closing the
//       child's stdin, waiting past the soft-shutdown window, and confirming the
//       server still answers /api/health AND the process is still alive.
//   (c) parseArgs maps --review-mode / --no-auto-shutdown / WARPOS_GUI_KEEPALIVE all
//       to keepalive:true (and the keepalive lifecycle never schedules an exit).
// ─────────────────────────────────────────────────────────────────────────────
"use strict";
const mcEnv = require("../../../scripts/hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)

const assert = require("assert");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT = path.join(ROOT, "scripts", "panel", "roadmap-gui.js");

let pass = 0, fail = 0;
function ok(name, cond, msg) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}\n      ${msg || ""}`); }
}

function get(port, token, p) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: `/${token}${p}` }, (res) => {
      let body = ""; res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.setTimeout(6000, () => req.destroy(new Error("request timeout")));
  });
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // ── (c) parseArgs unit checks (no spawn) ─────────────────────────────────────
  const { parseArgs } = require(SCRIPT);
  ok("parseArgs(--review-mode) → keepalive", parseArgs(["--review-mode"]).keepalive === true, "review-mode not keepalive");
  ok("parseArgs(--no-auto-shutdown) → keepalive", parseArgs(["--no-auto-shutdown"]).keepalive === true, "no-auto-shutdown not keepalive");
  {
    mcEnv.setEnv("GUI_KEEPALIVE", "1");
    const k = parseArgs([]).keepalive;
    mcEnv.unsetEnv("GUI_KEEPALIVE");
    ok("WARPOS_GUI_KEEPALIVE env → keepalive", k === true, "env not honored");
  }
  ok("parseArgs([]) → NOT keepalive (normal mode default)", parseArgs([]).keepalive === false, "default unexpectedly keepalive");
  ok("review-mode default does NOT open a browser", parseArgs(["--review-mode"]).openBrowser === false, "review-mode opened browser");

  // ── (a)+(b) spawn in review-mode, read URL, prove keepalive ──────────────────
  const child = spawn("node", [SCRIPT, "--review-mode", "--no-open"], {
    cwd: ROOT, stdio: ["pipe", "pipe", "pipe"],
  });
  let buf = "";
  const urlInfo = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout waiting for URL")), 20000);
    child.stdout.on("data", (d) => {
      buf += d.toString();
      const m = /^ROADMAP_GUI_URL\s+(http:\/\/127\.0\.0\.1:(\d+)\/([0-9a-f]{64})\/)\s*$/m.exec(buf);
      if (m) { clearTimeout(t); resolve({ url: m[1], port: Number(m[2]), token: m[3] }); }
    });
    child.on("error", reject);
  });

  try {
    ok("prints a stable machine-readable ROADMAP_GUI_URL line", !!urlInfo.url, "no URL line");
    ok("printed port is non-zero (OS-chosen)", urlInfo.port > 0, `port ${urlInfo.port}`);

    // the EXACT printed URL is reachable
    const health1 = await get(urlInfo.port, urlInfo.token, "/api/health");
    ok("the EXACT printed URL is reachable (health 200)", health1.status === 200, `status ${health1.status}`);

    // (b) close stdin → in review-mode the server must NOT die.
    child.stdin.end();
    await delay(4000); // > the 3s soft-shutdown window normal mode would use
    ok("after stdin EOF, child is STILL alive (keepalive)", child.exitCode === null, `exitCode ${child.exitCode}`);
    const health2 = await get(urlInfo.port, urlInfo.token, "/api/health");
    ok("after stdin EOF, server STILL serves (health 200)", health2.status === 200, `status ${health2.status}`);
  } finally {
    child.kill("SIGTERM");
  }

  console.log(`\ngui-lifecycle: ${pass}/${pass + fail} pass`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
