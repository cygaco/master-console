#!/usr/bin/env node
// scripts/teams/signal-board.test.js — enforcer for the pull-based signal
// channel (Wave-2 #28). This IS the named enforcer: a self-testing lib.
// Consumption is self-detecting because a regression here exits non-zero and
// prints the failing assertion. Run: node scripts/teams/signal-board.test.js
//
// Covers: post→read round-trip, --since filter, wait-timeout exit code (via a
// subprocess so we assert the REAL exit 3), malformed-file skip (fail-open),
// and BOM tolerance.

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const board = require("./signal-board");

let passed = 0;
const failures = [];
function check(name, cond) {
  if (cond) {
    passed++;
  } else {
    failures.push(name);
    process.stderr.write(`  FAIL: ${name}\n`);
  }
}

// Isolated board root per run so we never touch the real .claude/runtime/signals.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "signal-board-test-"));
const opts = { root };

function run() {
  // 1. post → read round-trip
  const { path: p1 } = board.post(
    "sprint-x/design-boundary",
    { verdict: "APPROVE", note: "ship it" },
    { from: "beta", ts: "2026-07-16T10:00:00.000Z" },
    opts,
  );
  check("post returns a written file path", fs.existsSync(p1));
  const r1 = board.read("sprint-x/design-boundary", opts);
  check("read returns exactly one signal", r1.length === 1);
  check(
    "round-trip preserves payload",
    r1[0] && r1[0].payload && r1[0].payload.verdict === "APPROVE",
  );
  check("round-trip preserves from", r1[0] && r1[0].from === "beta");
  check(
    "round-trip preserves topic",
    r1[0] && r1[0].topic === "sprint-x/design-boundary",
  );

  // 2. --since filter: post a second, older-then-newer pair; since keeps only newer
  board.post(
    "sprint-y/gate",
    { seq: 1 },
    { from: "eps", ts: "2026-07-16T09:00:00.000Z" },
    opts,
  );
  board.post(
    "sprint-y/gate",
    { seq: 2 },
    { from: "eps", ts: "2026-07-16T11:00:00.000Z" },
    opts,
  );
  const sinceHits = board.read("sprint-y/gate", {
    ...opts,
    since: "2026-07-16T10:00:00.000Z",
  });
  check("since-filter keeps only strictly-newer signals", sinceHits.length === 1);
  check(
    "since-filter kept the right one",
    sinceHits[0] && sinceHits[0].payload.seq === 2,
  );

  // 3. --last N
  const lastHits = board.read("sprint-y/gate", { ...opts, last: 1 });
  check("last-1 returns one signal", lastHits.length === 1);
  check(
    "last-1 returns the newest",
    lastHits[0] && lastHits[0].payload.seq === 2,
  );

  // 3b. same-millisecond ordering (CI regression, run 34737673901): a tight
  // burst of posts lands several files in ONE epoch-ms on a fast runner. The
  // filename stamp must stay monotonic so lexical order == post order — the
  // random suffix must never decide which record `--last 1` / wait() returns.
  const BURST = 40;
  for (let i = 0; i < BURST; i++) {
    board.post("sprint-y/burst", { seq: i }, { from: "eps" }, opts);
  }
  const burst = board.read("sprint-y/burst", opts);
  const burstSeqs = burst.map((r) => r.payload.seq);
  check("burst: every post is read back", burstSeqs.length === BURST);
  check(
    "burst: read order == post order even within one millisecond",
    burstSeqs.every((s, i) => s === i),
  );
  const burstLast = board.read("sprint-y/burst", { ...opts, last: 1 });
  check(
    "burst: last-1 is the most recently posted signal",
    burstLast.length === 1 && burstLast[0].payload.seq === BURST - 1,
  );

  // 4. empty board reads clean (no throw, empty array)
  const empty = board.read("no/such/topic", opts);
  check("empty topic reads as []", Array.isArray(empty) && empty.length === 0);

  // 5. malformed-file skip (fail-open): drop a garbage .json into a topic dir
  const dir = board.topicDir("sprint-z/malformed", opts);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "0-garbage.json"), "{ not json ", "utf8");
  board.post("sprint-z/malformed", { ok: true }, { from: "t", ts: "2026-07-16T12:00:00.000Z" }, opts);
  let malOut;
  let threw = false;
  try {
    malOut = board.read("sprint-z/malformed", opts);
  } catch {
    threw = true;
  }
  check("malformed file does not crash read", !threw);
  check("malformed skipped, good signal returned", malOut && malOut.length === 1);

  // 6. BOM tolerance: write a signal file with a UTF-8 BOM prefix
  const bomDir = board.topicDir("sprint-b/bom", opts);
  fs.mkdirSync(bomDir, { recursive: true });
  const rec = { topic: "sprint-b/bom", from: "ps", ts: "2026-07-16T13:00:00.000Z", payload: { bom: true } };
  fs.writeFileSync(
    path.join(bomDir, "1-bom.json"),
    "﻿" + JSON.stringify(rec),
    "utf8",
  );
  const bomOut = board.read("sprint-b/bom", opts);
  check("BOM-prefixed signal parses", bomOut.length === 1 && bomOut[0].payload.bom === true);

  // 7. topic traversal guard: ".." segment is rejected
  let guarded = false;
  try {
    board.topicDir("../escape", opts);
  } catch {
    guarded = true;
  }
  check("topic '..' segment is rejected", guarded);

  // 8. wait-timeout exit code via subprocess — assert the REAL exit 3
  let waitExit = null;
  try {
    execFileSync(
      process.execPath,
      [
        path.join(__dirname, "signal-board.js"),
        "wait",
        "sprint-w/never",
        "--timeout",
        "1",
        "--poll",
        "100",
      ],
      { env: { ...process.env, MC_SIGNALS_DIR_OVERRIDE: root }, stdio: "pipe" },
    );
    waitExit = 0;
  } catch (e) {
    waitExit = e.status;
  }
  check("wait exits 3 on timeout", waitExit === 3);

  // 9. wait resolves when a signal lands (in-process, fast path)
  return (async () => {
    board.post("sprint-w/hit", { ready: true }, { from: "x", ts: new Date().toISOString() }, opts);
    const res = await board.wait("sprint-w/hit", {
      ...opts,
      timeoutS: 2,
      pollMs: 50,
      since: "2026-07-16T00:00:00.000Z",
    });
    check("wait resolves on an existing newer signal", !res.timedOut && res.signal && res.signal.payload.ready === true);
  })();
}

Promise.resolve()
  .then(run)
  .then(() => {
    // cleanup
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
    if (failures.length) {
      process.stderr.write(
        `\nFAIL [signal-board.test] ${failures.length} failed, ${passed} passed\n`,
      );
      process.exit(1);
    }
    process.stdout.write(`OK [signal-board.test] ${passed} passed\n`);
    process.exit(0);
  })
  .catch((e) => {
    process.stderr.write(`signal-board.test crashed: ${e.stack || e.message}\n`);
    process.exit(1);
  });
