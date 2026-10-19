
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..");
const LOCK_ROOT = path.join(
  PROJECT_ROOT,
  ".claude",
  "runtime",
  "dispatch-locks",
);

const DEFAULT_CAPS = {
  gemini: parseInt(process.env.GEMINI_MAX_CONCURRENCY || "3", 10),
  openai: parseInt(process.env.OPENAI_MAX_CONCURRENCY || "10", 10),
  claude: parseInt(process.env.CLAUDE_MAX_CONCURRENCY || "32", 10),
};

const STALE_AFTER_MS = 20 * 60 * 1000;
const POLL_INTERVAL_MS = 500;
const DEFAULT_ACQUIRE_TIMEOUT_MS = 10 * 60 * 1000;

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function lockDir(provider) {
  return path.join(LOCK_ROOT, provider);
}

function readLockMtimes(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of entries) {
    if (!name.endsWith(".lock")) continue;
    const full = path.join(dir, name);
    try {
      const st = fs.statSync(full);
      out.push({ name, full, mtimeMs: st.mtimeMs });
    } catch {
    }
  }
  return out;
}

function pruneStale(dir, now) {
  for (const e of readLockMtimes(dir)) {
    if (now - e.mtimeMs > STALE_AFTER_MS) {
      try {
        fs.unlinkSync(e.full);
      } catch {
      }
    }
  }
}

function activeCount(dir, now) {
  return readLockMtimes(dir).filter((e) => now - e.mtimeMs <= STALE_AFTER_MS)
    .length;
}

function getCap(provider, opts) {
  if (opts && typeof opts.max === "number") return opts.max;
  if (provider in DEFAULT_CAPS) return DEFAULT_CAPS[provider];
  return 8;
}

function makeLockPath(dir) {
  const ts = Date.now();
  const rnd = crypto.randomBytes(4).toString("hex");
  return path.join(dir, `${process.pid}-${ts}-${rnd}.lock`);
}

function tryAcquireOnce(dir, max, meta) {
  const now = Date.now();
  pruneStale(dir, now);
  if (activeCount(dir, now) >= max) return null;
  const filePath = makeLockPath(dir);
  try {
    const fd = fs.openSync(filePath, "wx");
    let payload;
    try {
      const enriched = Object.assign(
        {
          pid: process.pid,
          start_time: new Date(now).toISOString(),
          start_ms: now,
          cwd: process.cwd(),
        },
        meta || {},
      );
      payload = JSON.stringify(enriched) + "\n";
    } catch {
      payload = `${process.pid} ${now}\n`;
    }
    fs.writeSync(fd, payload);
    fs.closeSync(fd);
  } catch {
    return null;
  }
  const after = activeCount(dir, Date.now());
  if (after > max) {
    try {
      fs.unlinkSync(filePath);
    } catch {
    }
    return null;
  }
  return filePath;
}

async function acquireSlot(provider, opts = {}) {
  const dir = lockDir(provider);
  ensureDir(dir);
  const max = getCap(provider, opts);
  const timeoutMs = opts.timeoutMs || DEFAULT_ACQUIRE_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;

  let attempt = 0;
  while (true) {
    const lock = tryAcquireOnce(dir, max, opts.meta);
    if (lock) return lock;
    if (Date.now() >= deadline) return null;
    attempt++;
    const jitter = Math.floor(Math.random() * 200);
    await sleep(POLL_INTERVAL_MS + jitter);
    if (attempt > 1000) {
      return null;
    }
  }
}

function acquireSlotSync(provider, opts = {}) {
  const dir = lockDir(provider);
  ensureDir(dir);
  const max = getCap(provider, opts);
  const timeoutMs = opts.timeoutMs || DEFAULT_ACQUIRE_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  while (true) {
    const lock = tryAcquireOnce(dir, max, opts.meta);
    if (lock) return lock;
    if (Date.now() >= deadline) return null;
    attempt++;
    const jitter = Math.floor(Math.random() * 200);
    sleepSync(POLL_INTERVAL_MS + jitter);
    if (attempt > 1000) return null;
  }
}

function releaseSlot(lockPath) {
  if (!lockPath) return;
  try {
    fs.unlinkSync(lockPath);
  } catch {
  }
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function sleepSync(ms) {
  const end = Date.now() + ms;
  try {
    const sab = new SharedArrayBuffer(4);
    const arr = new Int32Array(sab);
    Atomics.wait(arr, 0, 0, ms);
  } catch {
    while (Date.now() < end) {
    }
  }
}

function readLockMeta(lockPath) {
  try {
    const raw = fs.readFileSync(lockPath, "utf8").trim();
    if (!raw) return null;
    if (raw.startsWith("{")) {
      try {
        return JSON.parse(raw);
      } catch {
      }
    }
    const [pidStr, msStr] = raw.split(/\s+/);
    const pid = parseInt(pidStr, 10);
    const start_ms = parseInt(msStr, 10);
    if (!Number.isFinite(pid)) return null;
    return {
      pid,
      start_ms: Number.isFinite(start_ms) ? start_ms : null,
      legacy: true,
    };
  } catch {
    return null;
  }
}

function pidAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    if (e && e.code === "EPERM") return true;
    return false;
  }
}

function listLocks(provider) {
  const dir = lockDir(provider);
  return readLockMtimes(dir).map((e) => ({
    ...e,
    meta: readLockMeta(e.full),
  }));
}

function listAllLockDirs() {
  try {
    return fs
      .readdirSync(LOCK_ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

function pruneDeadLocks(opts = {}) {
  const now = Date.now();
  const minAgeMs = typeof opts.minAgeMs === "number" ? opts.minAgeMs : 5_000;
  const summary = { scanned: 0, dead: 0, stale: 0, byProvider: {} };
  for (const provider of listAllLockDirs()) {
    const dir = lockDir(provider);
    pruneStale(dir, now);
    const before = readLockMtimes(dir).length;
    for (const entry of readLockMtimes(dir)) {
      summary.scanned++;
      if (now - entry.mtimeMs < minAgeMs) continue;
      const meta = readLockMeta(entry.full);
      if (!meta) continue;
      if (!pidAlive(meta.pid)) {
        try {
          fs.unlinkSync(entry.full);
          summary.dead++;
        } catch {
        }
      }
    }
    const after = readLockMtimes(dir).length;
    const removed = Math.max(0, before - after);
    summary.byProvider[provider] = {
      before,
      after,
      removed,
    };
  }
  return summary;
}

module.exports = {
  acquireSlot,
  acquireSlotSync,
  releaseSlot,
  readLockMeta,
  listLocks,
  listAllLockDirs,
  pruneDeadLocks,
  pidAlive,
  DEFAULT_CAPS,
  STALE_AFTER_MS,
  LOCK_ROOT,
};
