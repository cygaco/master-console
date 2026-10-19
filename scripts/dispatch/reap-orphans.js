#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const NAME = "reap-orphans";

const ORPHAN_MIN_AGE_MS = 20 * 60 * 1000;

const DISPATCH_SCRIPT_PATHS = ["dispatch-claude.js", "dispatch-agent.js"].map((b) =>
  path.resolve(ROOT, "scripts", b).replace(/\\/g, "/").toLowerCase(),
);

let pidAlive;
try {
  ({ pidAlive } = require("../hooks/lib/concurrency-lock"));
} catch {
  pidAlive = function (pid) {
    if (!Number.isFinite(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (e) {
      return !!(e && e.code === "EPERM");
    }
  };
}

function liveLockPids() {
  const pids = new Set();
  try {
    const cl = require("../hooks/lib/concurrency-lock");
    const now = Date.now();
    for (const provider of cl.listAllLockDirs()) {
      for (const lk of cl.listLocks(provider)) {
        const fresh = now - lk.mtimeMs <= cl.STALE_AFTER_MS;
        const pid = lk.meta && lk.meta.pid;
        if (fresh && Number.isFinite(pid)) pids.add(pid);
      }
    }
    return { pids, ok: true };
  } catch {
    return { pids, ok: false };
  }
}

function selfTree(procs) {
  const tree = new Set([process.pid]);
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  let cur = process.pid;
  for (let i = 0; i < 64; i++) {
    const node = byPid.get(cur);
    if (!node || !Number.isFinite(node.ppid) || node.ppid <= 0) break;
    if (tree.has(node.ppid)) break;
    tree.add(node.ppid);
    cur = node.ppid;
  }
  let grew = true;
  let guard = 0;
  while (grew && guard++ < procs.length + 8) {
    grew = false;
    for (const p of procs) {
      if (!tree.has(p.pid) && Number.isFinite(p.ppid) && tree.has(p.ppid)) {
        tree.add(p.pid);
        grew = true;
      }
    }
  }
  return tree;
}

function enumerateProcs() {
  const now = Date.now();
  try {
    if (process.platform === "win32") {
      const ps =
        "Get-CimInstance Win32_Process | " +
        "Select-Object ProcessId,ParentProcessId,CreationDate,CommandLine | " +
        "ConvertTo-Json -Compress -Depth 2";
      const out = execFileSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", ps],
        { encoding: "utf8", timeout: 20000, maxBuffer: 32 * 1024 * 1024 },
      );
      let rows = JSON.parse(out || "[]");
      if (!Array.isArray(rows)) rows = [rows];
      const procs = [];
      for (const r of rows) {
        const pid = Number(r.ProcessId);
        const ppid = Number(r.ParentProcessId);
        if (!Number.isInteger(pid) || pid <= 1) continue;
        const created = r.CreationDate ? Date.parse(normalizeCimDate(r.CreationDate)) : NaN;
        const cmd = String(r.CommandLine || "");
        procs.push({
          pid,
          ppid: Number.isInteger(ppid) ? ppid : NaN,
          startMs: Number.isFinite(created) ? created : NaN,
          ageMs: Number.isFinite(created) ? now - created : Infinity,
          cmd,
          argv: tokenizeCmd(cmd),
        });
      }
      return procs;
    }
    if (fs.existsSync("/proc")) return enumerateProcFromProc(now);
    return enumerateProcFromPs(now);
  } catch {
    return [];
  }
}

function enumerateProcFromProc(now) {
  const procs = [];
  let pids;
  try {
    pids = fs.readdirSync("/proc").filter((n) => /^\d+$/.test(n));
  } catch {
    return [];
  }
  let btimeMs = 0;
  try {
    const stat = fs.readFileSync("/proc/stat", "utf8");
    const m = stat.match(/^btime\s+(\d+)/m);
    if (m) btimeMs = Number(m[1]) * 1000;
  } catch {
  }
  const HZ = 100;
  for (const pidStr of pids) {
    const pid = Number(pidStr);
    if (!Number.isInteger(pid) || pid <= 1) continue;
    let ppid = NaN;
    let startMs = NaN;
    try {
      const st = fs.readFileSync(`/proc/${pidStr}/stat`, "utf8");
      const rparen = st.lastIndexOf(")");
      const rest = rparen >= 0 ? st.slice(rparen + 1).trim().split(/\s+/) : [];
      const ppidTok = Number(rest[1]);
      if (Number.isInteger(ppidTok)) ppid = ppidTok;
      const startTicks = Number(rest[19]);
      if (Number.isFinite(startTicks) && btimeMs)
        startMs = btimeMs + (startTicks / HZ) * 1000;
    } catch {
      continue;
    }
    let argv = [];
    try {
      const raw = fs.readFileSync(`/proc/${pidStr}/cmdline`);
      argv = raw.toString("utf8").split("\0").filter((s) => s.length > 0);
    } catch {
      argv = [];
    }
    procs.push({
      pid,
      ppid: Number.isInteger(ppid) ? ppid : NaN,
      startMs: Number.isFinite(startMs) ? startMs : NaN,
      ageMs: Number.isFinite(startMs) ? now - startMs : Infinity,
      cmd: argv.join(" "),
      argv,
    });
  }
  return procs;
}

function enumerateProcFromPs(now) {
  const procs = [];
  let out;
  try {
    out = execFileSync("ps", ["-eo", "pid=,ppid=,lstart="], {
      encoding: "utf8",
      timeout: 20000,
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch {
    return [];
  }
  const RE = /^(\d+)[ \t]+(\d+)[ \t]+([A-Za-z]{3}[ \t]+[A-Za-z]{3}[ \t]+\d{1,2}[ \t]+\d{2}:\d{2}:\d{2}[ \t]+\d{4})\s*$/;
  for (const line of out.split("\n")) {
    const t = line.replace(/\r$/, "");
    if (!t.trim()) continue;
    const m = t.match(RE);
    if (!m) continue;
    const pid = Number(m[1]);
    const ppid = Number(m[2]);
    if (!Number.isInteger(pid) || pid <= 1) continue;
    const startMs = Date.parse(m[3]);
    let cmd = "";
    try {
      cmd = execFileSync("ps", ["-p", String(pid), "-o", "command="], {
        encoding: "utf8",
        timeout: 5000,
        maxBuffer: 1 * 1024 * 1024,
      }).split("\n")[0].trim();
    } catch {
      cmd = "";
    }
    procs.push({
      pid,
      ppid: Number.isInteger(ppid) ? ppid : NaN,
      startMs: Number.isFinite(startMs) ? startMs : NaN,
      ageMs: Number.isFinite(startMs) ? now - startMs : Infinity,
      cmd,
      argv: tokenizeCmd(cmd),
    });
  }
  return procs;
}

function normalizeCimDate(v) {
  const s = String(v);
  const dm = s.match(/\/Date\((\d+)\)\//);
  if (dm) return new Date(Number(dm[1])).toISOString();
  const cm = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (cm) return `${cm[1]}-${cm[2]}-${cm[3]}T${cm[4]}:${cm[5]}:${cm[6]}`;
  return s;
}

function classify(input) {
  const procs = (input && input.procs) || [];
  const self = (input && input.selfTree) || new Set();
  const livePids = (input && input.livePids) || new Set();
  const locksOk = !(input && input.locksOk === false);
  const rawMin = input && input.minAgeMs;
  const minAgeMs =
    Number.isFinite(rawMin) && rawMin >= ORPHAN_MIN_AGE_MS ? rawMin : ORPHAN_MIN_AGE_MS;
  const byPid = new Map(procs.map((p) => [p.pid, p]));

  const orphans = [];
  const skipped = [];
  for (const p of procs) {
    if (!Number.isInteger(p.pid) || p.pid <= 1) continue;
    const sigInput = Array.isArray(p.argv) ? p.argv : p.cmd;
    if (!isDispatchProc(sigInput)) continue;

    const reasons = [];
    if (self.has(p.pid)) reasons.push("own-process-tree");
    if (!locksOk) reasons.push("lock-state-unknown");
    else if (livePids.has(p.pid)) reasons.push("has-live-lock");
    if (!(Number.isFinite(p.ageMs) && p.ageMs >= minAgeMs))
      reasons.push(Number.isFinite(p.ageMs) ? `too-young(<${Math.round(minAgeMs / 1000)}s)` : "age-unknown");
    const orphaned = isOrphaned(p, byPid);
    if (orphaned === null) reasons.push("parent-liveness-unknown");
    else if (orphaned === false) reasons.push("parent-alive");

    if (reasons.length === 0) {
      orphans.push({ pid: p.pid, ppid: p.ppid, startMs: p.startMs, ageMs: p.ageMs, cmd: clip(p.cmd) });
    } else {
      skipped.push({ pid: p.pid, ppid: p.ppid, reasons, cmd: clip(p.cmd) });
    }
  }
  return { orphans, skipped };
}

function isDispatchProc(input) {
  const argv = Array.isArray(input) ? input.map((t) => String(t)) : tokenizeCmd(String(input || ""));
  if (argv.length < 2) return false;
  const exe0 = path.basename(String(argv[0]).replace(/\\/g, "/")).toLowerCase();
  if (exe0 !== "node" && exe0 !== "node.exe") return false;
  const operand = nodeScriptOperand(argv.slice(1));
  if (!operand) return false;
  if (!path.isAbsolute(operand)) return false;
  const norm = path.resolve(operand).replace(/\\/g, "/").toLowerCase();
  return DISPATCH_SCRIPT_PATHS.includes(norm);
}

function nodeScriptOperand(args) {
  if (args.length === 0) return null;
  const first = String(args[0]);
  if (first.startsWith("-")) return null;
  return first;
}

function tokenizeCmd(c) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(c)) !== null) {
    out.push(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]);
  }
  return out;
}

function isOrphaned(p, byPid) {
  const ppid = p.ppid;
  if (!Number.isFinite(ppid)) return null;
  if (ppid <= 1) return true;
  if (byPid.has(ppid)) return false;
  try {
    return pidAlive(ppid) ? false : true;
  } catch {
    return null;
  }
}

function clip(s) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > 160 ? t.slice(0, 157) + "…" : t;
}

function terminate(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid) {
    return { pid, signalled: false, error: "refused: pid out of safe range (>1, not self)" };
  }
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/T", "/PID", String(pid)], { timeout: 8000, stdio: "pipe" });
    } else {
      process.kill(pid, "SIGTERM");
    }
    return { pid, signalled: true };
  } catch (e) {
    return { pid, signalled: false, error: e && e.message ? e.message : String(e) };
  }
}

function revalidateOrphans(firstOrphans, minAgeMs) {
  const confirmed = new Set();
  try {
    if (!Array.isArray(firstOrphans) || firstOrphans.length === 0) return confirmed;
    const wantByPid = new Map(firstOrphans.map((o) => [o.pid, o]));
    const procs2 = enumerateProcs();
    const locks2 = liveLockPids();
    const fresh = classify({
      procs: procs2,
      selfTree: selfTree(procs2),
      livePids: locks2.pids,
      locksOk: locks2.ok,
      now: Date.now(),
      minAgeMs,
    });
    for (const o2 of fresh.orphans) {
      const want = wantByPid.get(o2.pid);
      if (!want) continue;
      if (
        Number.isFinite(want.startMs) &&
        Number.isFinite(o2.startMs) &&
        want.startMs === o2.startMs
      ) {
        confirmed.add(o2.pid);
      }
    }
  } catch {
    return new Set();
  }
  return confirmed;
}

function run(opts = {}) {
  const apply = !!opts.apply;
  const reqMin = opts.minAgeMs;
  const minAgeMs = Number.isFinite(reqMin) && reqMin >= ORPHAN_MIN_AGE_MS ? reqMin : ORPHAN_MIN_AGE_MS;
  const procs = enumerateProcs();
  const locks = liveLockPids();
  const result = classify({
    procs,
    selfTree: selfTree(procs),
    livePids: locks.pids,
    locksOk: locks.ok,
    now: Date.now(),
    minAgeMs,
  });
  const terminated = [];
  if (apply) {
    const confirmed = revalidateOrphans(result.orphans, minAgeMs);
    for (const o of result.orphans) {
      const ok = confirmed.has(o.pid);
      if (ok) terminated.push(terminate(o.pid));
      else terminated.push({ pid: o.pid, signalled: false, error: "revalidation failed (PID reuse / state changed) — not killed" });
    }
  }
  const summary = {
    check: NAME,
    apply,
    scanned: procs.length,
    orphans: result.orphans,
    orphanCount: result.orphans.length,
    skipped: result.skipped,
    terminated,
    ts: new Date().toISOString(),
  };
  try {
    const { log } = require("../hooks/lib/logger");
    log(
      "dispatch-reap",
      {
        event: apply ? "reap-orphans:apply" : "reap-orphans:dry-run",
        scanned: summary.scanned,
        orphanCount: summary.orphanCount,
        orphanPids: result.orphans.map((o) => o.pid),
        terminatedPids: terminated.filter((t) => t.signalled).map((t) => t.pid),
      },
      { actor: "reap-orphans" },
    );
  } catch {
  }
  return summary;
}

module.exports = { classify, isDispatchProc, isOrphaned, selfTree, terminate, revalidateOrphans, run, ORPHAN_MIN_AGE_MS };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const opts = { apply: argv.includes("--apply"), json: argv.includes("--json") };
  const ai = argv.indexOf("--min-age-ms");
  if (ai !== -1 && argv[ai + 1]) opts.minAgeMs = parseInt(argv[ai + 1], 10);
  let res;
  try {
    res = run(opts);
  } catch (e) {
    if (opts.json) console.log(JSON.stringify({ check: NAME, ok: true, error: String(e && e.message ? e.message : e), orphanCount: 0 }));
    else console.error(`[${NAME}] non-fatal error (fail-open, reaped nothing): ${e && e.message ? e.message : e}`);
    process.exit(0);
  }
  if (opts.json) {
    console.log(JSON.stringify(res));
  } else {
    const mode = res.apply ? "APPLY" : "DRY-RUN";
    console.log(`[${NAME}] ${mode} — scanned ${res.scanned} proc(s), ${res.orphanCount} orphan(s)`);
    for (const o of res.orphans) {
      console.log(`  orphan pid=${o.pid} ppid=${o.ppid} age=${Math.round((o.ageMs || 0) / 1000)}s  ${o.cmd}`);
    }
    if (res.apply) {
      for (const t of res.terminated) {
        console.log(`  ${t.signalled ? "SIGTERM" : "FAILED "} pid=${t.pid}${t.error ? "  (" + t.error + ")" : ""}`);
      }
    } else if (res.orphanCount > 0) {
      console.log(`  (dry-run — re-run with --apply to terminate. ${res.orphanCount} would be SIGTERM'd.)`);
    }
  }
  process.exit(0);
}
