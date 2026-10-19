#!/usr/bin/env node

"use strict";

const {
  acquireSlotSync,
  releaseSlot,
} = require("./hooks/lib/concurrency-lock");
const { fork } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const PROVIDER = "gemini-test";
const CAP = 2;
const N_WORKERS = 5;
const HOLD_MS = 200;

const PROJECT_ROOT = process.cwd();
const LOCK_DIR = path.join(
  PROJECT_ROOT,
  ".claude",
  "runtime",
  "dispatch-locks",
  PROVIDER,
);

function log(label, t0) {
  const ms = Date.now() - t0;
  console.log(`[+${ms.toString().padStart(5, " ")}ms] ${label}`);
}

if (process.argv.includes("--child")) {
  const t0 = parseInt(process.argv[process.argv.indexOf("--t0") + 1], 10);
  const id = process.argv[process.argv.indexOf("--id") + 1];
  const slot = acquireSlotSync(PROVIDER, { max: CAP, timeoutMs: 30_000 });
  if (!slot) {
    log(`worker ${id}: TIMEOUT`, t0);
    process.exit(1);
  }
  log(`worker ${id}: ACQUIRED  ${path.basename(slot)}`, t0);
  const end = Date.now() + HOLD_MS;
  while (Date.now() < end) {
  }
  releaseSlot(slot);
  log(`worker ${id}: released`, t0);
  process.exit(0);
}

try {
  fs.rmSync(LOCK_DIR, { recursive: true, force: true });
} catch {
}

const t0 = Date.now();
console.log(`spawning ${N_WORKERS} workers, cap=${CAP}, hold=${HOLD_MS}ms`);

const children = [];
for (let i = 0; i < N_WORKERS; i++) {
  const c = fork(
    __filename,
    ["--child", "--t0", String(t0), "--id", String(i)],
    {
      stdio: "inherit",
    },
  );
  children.push(c);
}

let exited = 0;
let failures = 0;
for (const c of children) {
  c.on("exit", (code) => {
    exited++;
    if (code !== 0) failures++;
    if (exited === children.length) {
      const wall = Date.now() - t0;
      console.log("");
      console.log(`all ${N_WORKERS} workers completed in ${wall}ms`);
      console.log(`  failures: ${failures}`);
      const minExpected = (N_WORKERS / CAP) * HOLD_MS * 0.7;
      if (wall < minExpected) {
        console.log(
          `❌ FAIL: wall ${wall}ms < expected ${Math.round(minExpected)}ms — cap not enforced`,
        );
        process.exit(1);
      }
      try {
        fs.rmSync(LOCK_DIR, { recursive: true, force: true });
      } catch {
      }
      console.log(`✓ wall time consistent with cap=${CAP} serialization`);
      process.exit(failures === 0 ? 0 : 1);
    }
  });
}
