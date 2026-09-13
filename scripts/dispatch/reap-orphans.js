#!/usr/bin/env node
"use strict";

/**
 * reap-orphans.js — detect + (optionally) reap ORPHANED MC dispatch
 * subprocesses (E-TEAMS-MIGRATION-001, operator-flagged).
 *
 * THE PROBLEM (the reap / bg-drop class — ED-039 / RI-004):
 *   dispatch-claude.js / dispatch-agent.js spawn a provider CLI (claude / codex /
 *   gemini) via spawnSync. When the harness REAPS the wrapper (auto-background +
 *   maxTurns), the OS can leave the GRANDCHILD provider process running with no
 *   parent to collect it and NO completion record written — an orphan that holds
 *   a model session, a slot, and memory until the box reboots. The existing
 *   concurrency-lock pruneDeadLocks() removes the dead-PID *lock file*, but it
 *   does NOT kill the orphaned *process*. This closes that gap.
 *
 * SAFETY (β H-002 exposure-model discipline — a kill is a privilege surface):
 *   A process is reaped ONLY when ALL of these hold (any ambiguity ⇒ SKIP):
 *     1. SIGNATURE — it is a real `node <abs-wrapper>` invocation of one of THIS
 *        project's dispatch wrapper scripts (dispatch-claude.js / dispatch-agent.js):
 *        argv[0]=node AND argv[1] is the absolute, canonical wrapper path (see
 *        isDispatchProc). A bare "node", a foreign "claude"/"codex", a flag-before-
 *        the-script, or the wrapper name in an arg is NEVER a candidate. (A reaped
 *        grandchild provider CLI is taken down via the wrapper's tree, taskkill /T.)
 *     2. ORPHANED — its parent PID is DEAD, or it has been reparented to init
 *        (PPID == 1 on POSIX). A child of a LIVE session is NOT an orphan.
 *     3. AGE — older than ORPHAN_MIN_AGE_MS (default 20min, ≥ the longest legit
 *        dispatch wall-time). A young process may be a legit in-flight dispatch.
 *     4. NO LIVE LOCK — no FRESH concurrency-lock for that PID (a fresh lock ⇒
 *        the dispatch is alive and tracked; overrides the orphan signal).
 *     5. NOT OURS — never this reaper's own PID, its parent, or its ancestors.
 *   FAIL-OPEN: any enumeration / parse / tooling error ⇒ reap NOTHING (a missed
 *   orphan is cheap; killing a live builder loses uncommitted worktree work).
 *   SIGTERM-FIRST: terminate gracefully (taskkill without /F on Windows; SIGTERM
 *   on POSIX), never SIGKILL-first. Report-only by DEFAULT; --apply to terminate.
 *
 * USAGE:
 *   node scripts/dispatch/reap-orphans.js              # DRY-RUN: list orphans, kill nothing
 *   node scripts/dispatch/reap-orphans.js --apply      # terminate confirmed orphans (SIGTERM)
 *   node scripts/dispatch/reap-orphans.js --json        # machine output
 *   node scripts/dispatch/reap-orphans.js --min-age-ms <n>   # override the age gate
 *
 * EXIT: 0 always (fail-open — a reaper must never crash a caller / session start).
 *
 * The pure core `classify({ procs, selfTree, locks, now, minAgeMs })` returns the
 * reap/skip decision per process for the planted-fixture test (no real ps / kill).
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const NAME = "reap-orphans";

// Age floor: a candidate younger than this may be a legit in-flight dispatch.
// 20min mirrors concurrency-lock STALE_AFTER_MS (longer than runProvider's 15min).
const ORPHAN_MIN_AGE_MS = 20 * 60 * 1000;

// The CANONICAL absolute paths of THIS project's dispatch wrapper scripts. The
// signature match anchors on these REAL paths: the matcher requires `node <abs-path>`
// where <abs-path> (canonicalized) EQUALS one of these — never a loose substring, a
// non-operand token, or a ROOT-relative resolution a foreign cwd could forge. Lower-
// cased + forward-slashed for comparison (Windows is case-insensitive; cmd lines vary).
const DISPATCH_SCRIPT_PATHS = ["dispatch-claude.js", "dispatch-agent.js"].map((b) =>
  path.resolve(ROOT, "scripts", b).replace(/\\/g, "/").toLowerCase(),
);
// NOTE (r3 redesign): the telemetry-marker-in-argv branch + the broad known-exe set
// were REMOVED as unsound — a WARPOS_RUN_ID=… token can be a user-supplied --prompt
// value, and we cannot read another process's ENV (where the real marker lives). A
// provider CLI (claude/codex/gemini) is therefore matched ONLY via the wrapper's
// process TREE (its node parent), never on its own argv. See isDispatchProc.

// ── pidAlive: reuse the concurrency-lock primitive (EPERM ⇒ treat as alive). ──
let pidAlive;
try {
  ({ pidAlive } = require("../hooks/lib/concurrency-lock"));
} catch {
  // Fail-safe local fallback (treat EPERM as alive — never wrongly call dead).
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

// ── Live-lock PIDs (a fresh lock ⇒ the dispatch is alive + tracked). ──────────
/** The PIDs holding a FRESH (non-stale) concurrency lock — live, tracked dispatches
 *  that are NEVER orphan candidates. Returns `{ pids, ok }`. SECURITY (gauntlet
 *  HIGH-4): lock state is a SAFETY input, so it must fail SAFE, not "fail-open to
 *  empty". On ANY enumeration/parse error `ok:false` — and run() then reaps NOTHING
 *  (an empty-set-on-error would let --apply kill a process that actually holds a
 *  fresh lock). The lock-failure contract: can't read the locks ⇒ can't reap. */
function liveLockPids() {
  const pids = new Set();
  try {
    const cl = require("../hooks/lib/concurrency-lock");
    const now = Date.now();
    for (const provider of cl.listAllLockDirs()) {
      for (const lk of cl.listLocks(provider)) {
        // Fresh = within the stale window. (We do NOT additionally require the PID
        // alive here — a fresh lock for a PID is enough to spare it; if the lock is
        // genuinely stale the mtime window already excludes it.)
        const fresh = now - lk.mtimeMs <= cl.STALE_AFTER_MS;
        const pid = lk.meta && lk.meta.pid;
        if (fresh && Number.isFinite(pid)) pids.add(pid);
      }
    }
    return { pids, ok: true };
  } catch {
    // FAIL-SAFE: lock state unknown ⇒ not "no live locks", but "cannot determine".
    return { pids, ok: false };
  }
}

// ── Self process-tree (never reap our own ancestry OR descendants). ──────────
/** PIDs of this reaper + its ancestors (so we never SIGTERM ourselves or a parent
 *  that would take us down) AND its descendants (gauntlet MEDIUM-8: the parent-alive
 *  gate usually covers descendants, but the stated full-tree exclusion must too —
 *  e.g. a subprocess WE spawned that happens to match the signature). Walks PPID up
 *  for ancestors + a fixed-point sweep down for descendants. */
function selfTree(procs) {
  const tree = new Set([process.pid]);
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  // Ancestors: walk PPID up from us.
  let cur = process.pid;
  for (let i = 0; i < 64; i++) {
    const node = byPid.get(cur);
    if (!node || !Number.isFinite(node.ppid) || node.ppid <= 0) break;
    if (tree.has(node.ppid)) break;
    tree.add(node.ppid);
    cur = node.ppid;
  }
  // Descendants: fixed-point — add any proc whose ppid is already in the tree,
  // until no growth (bounded by proc count; a malformed cycle terminates on no-growth).
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

// ── Process enumeration (cross-platform; cmdline + PPID + start time identity). ─
/** Enumerate processes as [{ pid, ppid, ageMs, startMs, cmd }]. `startMs` is the
 *  process START TIME (epoch ms) — the IDENTITY TOKEN that closes the CRIT-3 PID-
 *  reuse TOCTOU: a PID re-used by a new process has a DIFFERENT start time, so a
 *  re-enumeration before terminate() can detect the swap. `ageMs` is non-finite
 *  (Infinity) when the start time is unknown — classify() then SKIPS it (CRIT-1:
 *  unknown age is ambiguity, never "old"). pid<=1 and malformed rows are dropped
 *  (HIGH-6: a parser-injected fake row carrying pid 0/1 must never reach terminate).
 *  Windows: PowerShell CIM. POSIX: `ps -eo pid,ppid,lstart,args` (lstart = absolute
 *  start time — NOT etimes, which is relative and not an identity token). Fail-open:
 *  any error ⇒ [] (⇒ no candidates ⇒ nothing reaped). */
function enumerateProcs() {
  const now = Date.now();
  try {
    if (process.platform === "win32") {
      // CIM gives CommandLine (full argv) + ParentProcessId + CreationDate (start).
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
        if (!Number.isInteger(pid) || pid <= 1) continue; // HIGH-6: drop pid<=1 + junk
        const created = r.CreationDate ? Date.parse(normalizeCimDate(r.CreationDate)) : NaN;
        const cmd = String(r.CommandLine || "");
        procs.push({
          pid,
          ppid: Number.isInteger(ppid) ? ppid : NaN,
          startMs: Number.isFinite(created) ? created : NaN,
          ageMs: Number.isFinite(created) ? now - created : Infinity,
          // Windows CIM exposes CommandLine as the OS's authoritative command STRING
          // (not a clean argv array, and not row-forgeable like ps). Tokenize it once
          // here so the matcher works per-token, never on a re-flattened blob.
          cmd,
          argv: tokenizeCmd(cmd),
        });
      }
      return procs;
    }
    // POSIX: enumerate from /proc — the UN-FORGEABLE source (HIGH-6 r2). Each PID is
    // read from its OWN /proc/<pid>/ dir, so a crafted argv with embedded newlines
    // CANNOT inject a fake row (the prior `ps args` row-parse could). /proc/<pid>/stat
    // gives ppid + starttime (clock ticks since boot — the identity token);
    // /proc/<pid>/cmdline is NUL-delimited argv (we join with spaces for matching).
    if (fs.existsSync("/proc")) return enumerateProcFromProc(now);
    // No /proc (e.g. macOS) — fall back to `ps`, but read pid/ppid/lstart in a
    // STRUCTURED, row-forgery-resistant way: take pid+ppid+lstart from a fields-only
    // query (no args, so argv can't inject rows), then read each cmd separately.
    return enumerateProcFromPs(now);
  } catch {
    return []; // fail-open: no enumeration ⇒ no candidates ⇒ reap nothing
  }
}

/** Linux /proc enumeration — per-PID reads, un-forgeable. */
function enumerateProcFromProc(now) {
  const procs = [];
  let pids;
  try {
    pids = fs.readdirSync("/proc").filter((n) => /^\d+$/.test(n));
  } catch {
    return [];
  }
  // Boot time (epoch ms) to convert starttime-ticks → absolute start. btime is in
  // /proc/stat (seconds since epoch). Hz is typically 100; CLK_TCK isn't exposed to
  // node without a syscall, so we use the conventional 100 and treat starttime as an
  // IDENTITY token (relative ordering is what matters for PID-reuse detection, and an
  // exact ms is not required for the >20min age gate).
  let btimeMs = 0;
  try {
    const stat = fs.readFileSync("/proc/stat", "utf8");
    const m = stat.match(/^btime\s+(\d+)/m);
    if (m) btimeMs = Number(m[1]) * 1000;
  } catch {
    /* btime unknown — ageMs will be Infinity (⇒ age-unknown ⇒ skip, the safe side) */
  }
  const HZ = 100;
  for (const pidStr of pids) {
    const pid = Number(pidStr);
    if (!Number.isInteger(pid) || pid <= 1) continue;
    let ppid = NaN;
    let startMs = NaN;
    try {
      const st = fs.readFileSync(`/proc/${pidStr}/stat`, "utf8");
      // Field 4 = ppid, field 22 = starttime. comm (field 2) is parenthesized and may
      // contain spaces/parens — split AFTER the last ')' to avoid comm corruption.
      const rparen = st.lastIndexOf(")");
      const rest = rparen >= 0 ? st.slice(rparen + 1).trim().split(/\s+/) : [];
      // rest[0]=state, rest[1]=ppid, …, starttime is field 22 ⇒ rest index 22-4=… :
      // after state(1) the fields are 1-indexed from rest[0]=state; ppid=rest[1];
      // starttime is the (22 - 3)=19th token of rest (rest[0] is field 3=state).
      const ppidTok = Number(rest[1]);
      if (Number.isInteger(ppidTok)) ppid = ppidTok;
      const startTicks = Number(rest[19]);
      if (Number.isFinite(startTicks) && btimeMs)
        startMs = btimeMs + (startTicks / HZ) * 1000;
    } catch {
      continue; // process vanished mid-scan — skip
    }
    // Keep the NUL-delimited cmdline as the REAL argv ARRAY — pass it straight to the
    // structural matcher. Do NOT flatten-then-retokenize (r2 HIGH: a single argv value
    // with embedded whitespace would forge a separate wrapper/marker token). The joined
    // string is built ONLY for display/logging.
    let argv = [];
    try {
      const raw = fs.readFileSync(`/proc/${pidStr}/cmdline`);
      argv = raw.toString("utf8").split("\0").filter((s) => s.length > 0);
    } catch {
      argv = []; // unreadable cmdline ⇒ no tokens ⇒ won't match the signature ⇒ ignored
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

/** macOS/BSD fallback: structured `ps` reads. pid+ppid+lstart come from a fields-
 *  only query (args EXCLUDED so an argv newline can't forge a row); the command line
 *  for each pid is fetched separately with `ps -p <pid> -o command=`. Row-forgery-
 *  resistant: the row-bearing query has no free-form args field. */
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
  // No args field ⇒ each line is exactly "pid ppid <lstart 5 tokens>" — fixed shape.
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
    // macOS `ps command=` returns a STRING (no clean argv); tokenize best-effort. This
    // is the OS command field for a single PID (fetched per-pid, not row-parsed).
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

/** CIM CreationDate may arrive as a /Date(ms)/ JSON string or a CIM_DATETIME
 *  ("yyyymmddHHMMSS.ffffff+zzz"). Normalize both to something Date.parse reads. */
function normalizeCimDate(v) {
  const s = String(v);
  const dm = s.match(/\/Date\((\d+)\)\//);
  if (dm) return new Date(Number(dm[1])).toISOString();
  const cm = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (cm) return `${cm[1]}-${cm[2]}-${cm[3]}T${cm[4]}:${cm[5]}:${cm[6]}`;
  return s;
}

// ── PURE CORE: classify each process reap | skip (with reason). ───────────────
/** @param {{procs, selfTree:Set, livePids:Set, locksOk?:boolean, now, minAgeMs}} input
 *  @returns {{orphans:[], skipped:[]}}
 *  `locksOk:false` (lock state unreadable) ⇒ EVERY candidate is skipped
 *  ("lock-state-unknown") — the HIGH-4 fail-safe. `minAgeMs` is sanitized by the
 *  caller (CRIT-2); here a non-finite floor defaults to ORPHAN_MIN_AGE_MS. */
function classify(input) {
  const procs = (input && input.procs) || [];
  const self = (input && input.selfTree) || new Set();
  const livePids = (input && input.livePids) || new Set();
  const locksOk = !(input && input.locksOk === false); // default true (back-compat)
  // CRIT-2: a non-finite / non-positive floor is NOT honored — fall back to the
  // hard default rather than letting NaN/0 disable the age gate.
  const rawMin = input && input.minAgeMs;
  const minAgeMs =
    Number.isFinite(rawMin) && rawMin >= ORPHAN_MIN_AGE_MS ? rawMin : ORPHAN_MIN_AGE_MS;
  const byPid = new Map(procs.map((p) => [p.pid, p]));

  const orphans = [];
  const skipped = [];
  for (const p of procs) {
    // GATE 0 — a valid PID > 1 (HIGH-6 defense in depth; enum already drops these).
    if (!Number.isInteger(p.pid) || p.pid <= 1) continue;
    // GATE 1 — signature: must be a MC dispatch subprocess. Prefer the real argv
    // ARRAY (un-flattened); fall back to the cmd string (back-compat for test
    // fixtures that only set `cmd` — isDispatchProc tokenizes a string best-effort).
    const sigInput = Array.isArray(p.argv) ? p.argv : p.cmd;
    if (!isDispatchProc(sigInput)) continue; // not ours at all — not even a "skip"

    const reasons = [];
    // GATE 5 — never our own tree (ancestors AND descendants).
    if (self.has(p.pid)) reasons.push("own-process-tree");
    // GATE 4 — a fresh live lock means alive + tracked. HIGH-4: if lock state is
    // UNKNOWN (enumeration failed), spare EVERYTHING — can't read locks ⇒ can't reap.
    if (!locksOk) reasons.push("lock-state-unknown");
    else if (livePids.has(p.pid)) reasons.push("has-live-lock");
    // GATE 3 — age floor. CRIT-1: a NON-FINITE age (unknown start time) is AMBIGUITY,
    // never "old" — require a finite age at or past the floor.
    if (!(Number.isFinite(p.ageMs) && p.ageMs >= minAgeMs))
      reasons.push(Number.isFinite(p.ageMs) ? `too-young(<${Math.round(minAgeMs / 1000)}s)` : "age-unknown");
    // GATE 2 — orphaned: parent dead OR reparented to init (ppid<=1).
    const orphaned = isOrphaned(p, byPid);
    if (orphaned === null) reasons.push("parent-liveness-unknown"); // ambiguity ⇒ skip
    else if (orphaned === false) reasons.push("parent-alive");

    if (reasons.length === 0) {
      // Carry the IDENTITY TOKEN (startMs) + ppid + cmd so terminate can re-validate
      // the exact same process before signaling (CRIT-3 TOCTOU close).
      orphans.push({ pid: p.pid, ppid: p.ppid, startMs: p.startMs, ageMs: p.ageMs, cmd: clip(p.cmd) });
    } else {
      skipped.push({ pid: p.pid, ppid: p.ppid, reasons, cmd: clip(p.cmd) });
    }
  }
  return { orphans, skipped };
}

// ── Signature match (HIGH-5 r3: STRUCTURAL on the argv ARRAY, per-token). ─────
/** Does this process identify as a MC dispatch subprocess? Decides on the argv
 *  ARRAY (never a flattened string — a flattened-then-retokenized cmdline lets a
 *  single argv value containing whitespace forge a separate wrapper/marker token,
 *  the r2 HIGH). ONE sound, conservative rule (r3 redesign — the marker-in-argv
 *  branch was dropped as UNSOUND: a WARPOS_RUN_ID=… token can be a user-supplied
 *  --prompt VALUE, and we cannot read another process's ENV where the real marker
 *  lives; and "any later token resolves to the path" false-matched `node -e "…"
 *  <wrapper-path>` where the wrapper is just a `-e` argument):
 *
 *    argv[0] basename is `node`/`node.exe`  AND  the SCRIPT OPERAND — the first
 *    NON-OPTION argument after node (skipping `-e/--eval/-p/--print` + THEIR values,
 *    and other `-…` flags) — is an ABSOLUTE path that, canonicalized, EQUALS one of
 *    THIS project's real wrapper script paths (DISPATCH_SCRIPT_PATHS).
 *
 *  So `node -e "..." <abs-wrapper>` fails (the operand after `-e <code>` is the code,
 *  not the wrapper), `python worker.py --file /…/dispatch-agent.js` fails (argv[0] ≠
 *  node), `node /tmp/evil/dispatch-claude.js` fails (not our canonical path), and a
 *  RELATIVE `node scripts/dispatch-agent.js` fails (we require an ABSOLUTE operand —
 *  no ROOT-relative resolution, which a foreign cwd could forge). This NARROWS what
 *  the reaper recognizes to a real `node <abs-our-wrapper>` invocation — the
 *  conservative, false-kill-resistant choice for a process-killer (a reaped grandchild
 *  provider CLI is taken down via taskkill /T on the wrapper's tree). Accepts an argv
 *  array OR (back-compat) a raw string it tokenizes best-effort. */
function isDispatchProc(input) {
  const argv = Array.isArray(input) ? input.map((t) => String(t)) : tokenizeCmd(String(input || ""));
  if (argv.length < 2) return false;
  // argv[0] must be node (the runtime our wrappers run under). A provider CLI
  // (claude/codex/gemini) is matched only via the wrapper's process TREE, never on
  // its own — its argv carries user content we must not trust as identity.
  const exe0 = path.basename(String(argv[0]).replace(/\\/g, "/")).toLowerCase();
  if (exe0 !== "node" && exe0 !== "node.exe") return false;
  const operand = nodeScriptOperand(argv.slice(1));
  if (!operand) return false;
  // The operand must be ABSOLUTE (no ROOT-relative forgery from a foreign cwd). Then
  // canonicalize: path.resolve() collapses `.`/`..` segments (so a real wrapper path
  // written with `..` still matches — closes the security-final false-NEGATIVE note),
  // then normalize slashes + case for the compare against the resolved wrapper paths.
  if (!path.isAbsolute(operand)) return false;
  const norm = path.resolve(operand).replace(/\\/g, "/").toLowerCase();
  return DISPATCH_SCRIPT_PATHS.includes(norm);
}

/** Given node's args (argv after argv[0]=node), return the SCRIPT OPERAND or null.
 *  SECURITY (the false-operand class — final): Node's flag grammar is large, evolving,
 *  and includes ENTRY-MODE switches (`--test`, `--run=<name>`, `-e`/`--eval`, …) AND
 *  value-consuming flags (`--import`, `--loader`, `--env-file`, …). ANY attempt to
 *  skip flags and find a "later operand" can promote a flag VALUE or a post-mode-switch
 *  token to "the executed script" and false-match (`node --import <w>`, `node --test=x
 *  <w>`, `node --eval=<code> <w>`). So we do NOT model node's grammar at all. We use
 *  the verified FACT that REAL MC dispatch is ALWAYS `node <wrapper> <args…>` —
 *  the wrapper is argv[1], with NO node flag before it (every dispatch site is
 *  `node scripts/dispatch-{claude,agent}.js <role> <prompt>`). So the operand is
 *  argv[1] iff argv[1] is not a flag; otherwise there is NO operand we will trust
 *  (return null ⇒ NO match). This is the tightest, conservative, false-kill-proof
 *  rule: a node invocation with ANY flag before the script is simply not recognized
 *  (a missed orphan is cheap; we never invoke our wrappers that way). */
function nodeScriptOperand(args) {
  if (args.length === 0) return null;
  const first = String(args[0]);
  if (first.startsWith("-")) return null; // a flag in the operand slot ⇒ not our shape
  return first; // argv[1] is the script operand
}

/** Minimal command-line tokenizer (back-compat for the STRING form of isDispatchProc
 *  + tests). Splits on whitespace, honoring "double"/'single' quotes. Best-effort:
 *  production enumeration passes the real argv array and never relies on this. */
function tokenizeCmd(c) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(c)) !== null) {
    out.push(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]);
  }
  return out;
}

/** Is `p` orphaned? TRUE = parent dead or reparented to init. FALSE = parent
 *  alive (in our snapshot, or pidAlive-confirmed). NULL = cannot determine
 *  (ambiguity ⇒ caller SKIPS — never reaps on an unknown parent). */
function isOrphaned(p, byPid) {
  const ppid = p.ppid;
  if (!Number.isFinite(ppid)) return null; // unknown parent ⇒ ambiguous
  // POSIX reparent-to-init: ppid 1 (or 0). A reaped child's surviving grandchild
  // is reparented to init — the canonical orphan signal.
  if (ppid <= 1) return true;
  // Parent present in our snapshot ⇒ alive.
  if (byPid.has(ppid)) return false;
  // Parent NOT in snapshot — confirm with a direct liveness probe. Dead ⇒ orphan.
  // (pidAlive treats EPERM as alive, so a parent we can't signal stays "alive" —
  // the safe side: we will NOT reap when the parent's liveness is unprovable-dead.)
  try {
    return pidAlive(ppid) ? false : true;
  } catch {
    return null; // probe failed ⇒ ambiguous ⇒ skip
  }
}

function clip(s) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > 160 ? t.slice(0, 157) + "…" : t;
}

// ── Termination (SIGTERM-first; --apply only; hard PID guard). ───────────────
/** Gracefully terminate one orphan. Windows: taskkill /T (tree) WITHOUT /F first.
 *  POSIX: kill -TERM. MEDIUM-7: a final hard guard — only a safe integer PID > 1
 *  that is NOT our own PID is ever signaled (a pid of 0 has process-GROUP semantics
 *  on POSIX and must never reach process.kill). Returns { pid, signalled, error? };
 *  best-effort, never throws. */
function terminate(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid) {
    return { pid, signalled: false, error: "refused: pid out of safe range (>1, not self)" };
  }
  try {
    if (process.platform === "win32") {
      // /T terminates the child tree too; NO /F — graceful first (SIGTERM-equiv).
      execFileSync("taskkill", ["/T", "/PID", String(pid)], { timeout: 8000, stdio: "pipe" });
    } else {
      process.kill(pid, "SIGTERM");
    }
    return { pid, signalled: true };
  } catch (e) {
    return { pid, signalled: false, error: e && e.message ? e.message : String(e) };
  }
}

// ── CRIT-3: re-validate orphans against a FRESH snapshot before killing. ─────
/** Given the orphan list from the first classify pass, re-enumerate NOW and return
 *  the set of PIDs that are STILL the same process (pid + start-time identity match)
 *  AND still classify as an orphan against the fresh snapshot. A PID that exited,
 *  was reused (different startMs), or no longer meets every gate is dropped — so a
 *  fresh legitimate process that inherited a reaped orphan's PID is never killed.
 *  Fail-SAFE: on any error, return an EMPTY set (kill nothing). */
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
      if (!want) continue; // not an orphan we intended to kill
      // IDENTITY MATCH: same start time (the PID-reuse discriminator). Both must be
      // finite + equal; a missing/changed startMs ⇒ not the same process ⇒ drop.
      if (
        Number.isFinite(want.startMs) &&
        Number.isFinite(o2.startMs) &&
        want.startMs === o2.startMs
      ) {
        confirmed.add(o2.pid);
      }
    }
  } catch {
    return new Set(); // fail-safe: cannot re-confirm ⇒ kill nothing
  }
  return confirmed;
}

// ── Run (enumerate → classify → RE-VALIDATE → optionally terminate → log). ────
function run(opts = {}) {
  const apply = !!opts.apply;
  // CRIT-2: sanitize the floor here too (defense-in-depth with classify()); a
  // non-finite or below-floor value is NOT honored.
  const reqMin = opts.minAgeMs;
  const minAgeMs = Number.isFinite(reqMin) && reqMin >= ORPHAN_MIN_AGE_MS ? reqMin : ORPHAN_MIN_AGE_MS;
  const procs = enumerateProcs();
  const locks = liveLockPids(); // { pids, ok } — HIGH-4 fail-safe carries ok
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
    // CRIT-3: re-enumerate IMMEDIATELY before killing and re-run the full gate set,
    // matching on the IDENTITY TOKEN (pid + startMs + cmd) — a PID re-used by a new
    // process since `classify` has a different start time and is NOT re-confirmed,
    // so we never SIGTERM a fresh legitimate process that inherited the PID.
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
  // Best-effort audit log (fail-open).
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
    /* logging is best-effort */
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
    // Absolute fail-open: a reaper must NEVER crash its caller (session start).
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
