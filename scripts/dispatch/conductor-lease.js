"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_ROOT = path.join(PROJECT_ROOT, ".claude", "runtime");

const STALE_AFTER_MS = 20 * 60 * 1000;

const MUTATION_LOCK_WAIT_MS = 5 * 1000;

function mutationLockPath(spId, root) {
  return path.join(leaseRoot(root), `${spId}.mutation.lock`);
}

function withMutationLock(spId, root, fn, opts = {}) {
  ensureDir(leaseRoot(root));
  const lp = mutationLockPath(spId, root);
  const deadline = Date.now() + (Number.isFinite(opts.maxWaitMs) ? opts.maxWaitMs : MUTATION_LOCK_WAIT_MS);
  const ourNonce = crypto.randomBytes(12).toString("hex");
  const tmp = `${lp}.${ourNonce}.tmp`;
  let prepared = false;
  for (;;) {
    if (!prepared) {
      try {
        fs.writeFileSync(tmp, JSON.stringify({ pid: process.pid, ts: Date.now(), nonce: ourNonce }) + "\n");
        prepared = true;
      } catch {
        if (Date.now() > deadline) return { ok: false, reason: "mutation-contended" };
        const s = Date.now() + 2; while (Date.now() < s) { }
        continue;
      }
    }
    try {
      fs.linkSync(tmp, lp);
      try { fs.unlinkSync(tmp); } catch {}
      break;
    } catch (e) {
      if (!e || e.code !== "EEXIST") {
        try { fs.unlinkSync(tmp); } catch {}
        throw e;
      }
      let owner = null;
      try {
        const raw = fs.readFileSync(lp, "utf8").trim();
        owner = raw ? JSON.parse(raw) : null;
      } catch (readErr) {
        if (readErr && readErr.code === "ENOENT") continue;
        owner = null;
      }
      if (owner && typeof owner.nonce === "string" && owner.nonce && pidProvenDead(owner.pid)) {
        if (reclaimDeadGeneration(lp, owner.nonce, owner.pid)) continue;
      }
      if (Date.now() > deadline) { try { fs.unlinkSync(tmp); } catch {} return { ok: false, reason: "mutation-contended" }; }
      const s = Date.now() + 2; while (Date.now() < s) { }
      continue;
    }
  }
  try {
    return fn();
  } finally {
    unlinkIfNonce(lp, ourNonce);
  }
}

function reclaimDeadGeneration(lp, deadNonce, deadPid) {
  const reap = `${lp}.${deadNonce}.reap`;
  try {
    fs.linkSync(lp, reap);
  } catch {
    return false;
  }
  let retired = false;
  try {
    const raw = fs.readFileSync(reap, "utf8").trim();
    const o = raw ? JSON.parse(raw) : null;
    if (o && o.nonce === deadNonce && pidProvenDead(o.pid)) {
      try { fs.unlinkSync(lp); retired = true; } catch { retired = false; }
    }
  } catch {
  }
  try { fs.unlinkSync(reap); } catch {}
  if (!retired) {
    try { retired = !fs.existsSync(lp); } catch { retired = false; }
  }
  return retired;
}

function unlinkIfNonce(lp, nonce) {
  try {
    const raw = fs.readFileSync(lp, "utf8").trim();
    const owner = raw ? JSON.parse(raw) : null;
    if (owner && owner.nonce === nonce) fs.unlinkSync(lp);
  } catch {
  }
}

function leaseRoot(root) {
  return path.join(root || DEFAULT_ROOT, "conductor-leases");
}
function leasePath(spId, root) {
  return path.join(leaseRoot(root), `${spId}.lease`);
}
function claimlogPath(spId, root) {
  return path.join(leaseRoot(root), `${spId}.claimlog`);
}
function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function pidLiveness(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return "indeterminate";
  try {
    process.kill(pid, 0);
    return "live";
  } catch (e) {
    if (e && e.code === "ESRCH") return "dead";
    return "indeterminate";
  }
}

function pidProvenDead(pid) {
  return pidLiveness(pid) === "dead";
}

function mintToken(spId, root, meta) {
  const p = claimlogPath(spId, root);
  let maxSeq = 0;
  try {
    const raw = fs.readFileSync(p, "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (typeof entry.token === "number" && entry.token > maxSeq) maxSeq = entry.token;
      } catch {
      }
    }
  } catch {
  }
  const token = maxSeq + 1;
  const entry = Object.assign({ token, ts: Date.now() }, meta || {});
  fs.appendFileSync(p, JSON.stringify(entry) + "\n");
  return token;
}

function readHolder(spId, root) {
  try {
    const raw = fs.readFileSync(leasePath(spId, root), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeHolderFd(fd, holder) {
  fs.writeSync(fd, JSON.stringify(holder) + "\n");
}

function acquire(spId, opts = {}) {
  const { root, sessionId } = opts;
  ensureDir(leaseRoot(root));
  const lp = leasePath(spId, root);
  let fd;
  try {
    fd = fs.openSync(lp, "wx");
  } catch {
    const holder = readHolder(spId, root);
    return { ok: false, reason: "held", token: holder ? holder.token : null, holder };
  }
  try {
    const token = mintToken(spId, root, {
      sessionId: sessionId || null,
      pid: process.pid,
      action: "acquire",
    });
    const holder = {
      token,
      sessionId: sessionId || null,
      pid: process.pid,
      acquired_at: Date.now(),
      renewed_at: Date.now(),
    };
    writeHolderFd(fd, holder);
    return { ok: true, token, holder };
  } finally {
    fs.closeSync(fd);
  }
}

function release(spId, opts = {}) {
  const { root, token } = opts;
  return withMutationLock(spId, root, () => {
    const holder = readHolder(spId, root);
    if (!holder) return { ok: false, reason: "not-held" };
    if (holder.token !== token) return { ok: false, reason: "fencing-mismatch" };
    try {
      fs.unlinkSync(leasePath(spId, root));
    } catch {
    }
    return { ok: true };
  });
}

function renew(spId, opts = {}) {
  const { root, token } = opts;
  return withMutationLock(spId, root, () => {
    const holder = readHolder(spId, root);
    if (!holder) return { ok: false, reason: "not-held" };
    if (holder.token !== token) return { ok: false, reason: "fencing-mismatch" };
    const updated = Object.assign({}, holder, { renewed_at: Date.now() });
    fs.writeFileSync(leasePath(spId, root), JSON.stringify(updated) + "\n");
    return { ok: true, token: holder.token };
  });
}

function reclaim(spId, opts = {}) {
  const { root, sessionId } = opts;
  ensureDir(leaseRoot(root));
  return withMutationLock(spId, root, () => {
    const lp = leasePath(spId, root);
    const holder = readHolder(spId, root);
    if (holder) {
      const liveness = pidLiveness(holder.pid);
      if (liveness === "indeterminate") {
        return { ok: false, reason: "lease-indeterminate", token: holder.token, holder };
      }
      if (liveness === "live") {
        const stale = Date.now() - (holder.renewed_at || holder.acquired_at || 0) > STALE_AFTER_MS;
        if (!stale) {
          return { ok: false, reason: "lease-active", token: holder.token, holder };
        }
      }
      try {
        fs.unlinkSync(lp);
      } catch {
      }
    }
    let fd;
    try {
      fd = fs.openSync(lp, "wx");
    } catch {
      const current = readHolder(spId, root);
      return { ok: false, reason: "raced", token: current ? current.token : null, holder: current };
    }
    try {
      const token = mintToken(spId, root, {
        sessionId: sessionId || null,
        pid: process.pid,
        action: "reclaim",
      });
      const newHolder = {
        token,
        sessionId: sessionId || null,
        pid: process.pid,
        acquired_at: Date.now(),
        renewed_at: Date.now(),
      };
      writeHolderFd(fd, newHolder);
      return { ok: true, token, holder: newHolder, reclaimed_from: holder || null };
    } finally {
      fs.closeSync(fd);
    }
  });
}

function verifyToken(spId, token, opts = {}) {
  const { root } = opts;
  const holder = readHolder(spId, root);
  if (!holder) return false;
  return holder.token === token;
}

function status(spId, opts = {}) {
  return readHolder(spId, opts.root);
}

module.exports = {
  acquire,
  release,
  renew,
  reclaim,
  verifyToken,
  status,
  pidLiveness,
  pidProvenDead,
  STALE_AFTER_MS,
  DEFAULT_ROOT,
  _withMutationLock: withMutationLock,
  _reclaimDeadGeneration: reclaimDeadGeneration,
  _unlinkIfNonce: unlinkIfNonce,
  _mutationLockPath: mutationLockPath,
};
