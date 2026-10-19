"use strict";
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { test } = require("node:test");
const assert = require("node:assert");

const lease = require("./conductor-lease");

function tmpRoot(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `lease-${tag}-`));
}

test("cold acquire on an unheld SP-id succeeds and mints token 1", () => {
  const root = tmpRoot("cold");
  const r = lease.acquire("SP-A", { root, sessionId: "sess-1" });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.token, 1);
  assert.strictEqual(r.holder.sessionId, "sess-1");
});

test("acquire on an already-held SP-id cleanly fails (no crash, no double-hold)", () => {
  const root = tmpRoot("held");
  const a = lease.acquire("SP-B", { root, sessionId: "sess-1" });
  const b = lease.acquire("SP-B", { root, sessionId: "sess-2" });
  assert.strictEqual(a.ok, true);
  assert.strictEqual(b.ok, false);
  assert.strictEqual(b.reason, "held");
});

test("release requires the CURRENT fencing token; a stale token is refused", () => {
  const root = tmpRoot("release");
  const a = lease.acquire("SP-C", { root, sessionId: "sess-1" });
  const badRelease = lease.release("SP-C", { root, token: a.token + 999 });
  assert.strictEqual(badRelease.ok, false);
  assert.strictEqual(badRelease.reason, "fencing-mismatch");
  const goodRelease = lease.release("SP-C", { root, token: a.token });
  assert.strictEqual(goodRelease.ok, true);
  const b = lease.acquire("SP-C", { root, sessionId: "sess-2" });
  assert.strictEqual(b.ok, true);
  assert.ok(b.token > a.token, "token must be monotonic across release+reacquire");
});

test("renew extends a live hold WITHOUT minting a new token; wrong token is refused", () => {
  const root = tmpRoot("renew");
  const a = lease.acquire("SP-D", { root, sessionId: "sess-1" });
  const before = lease.status("SP-D", { root });
  const bad = lease.renew("SP-D", { root, token: a.token + 999 });
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.reason, "fencing-mismatch");
  const ok = lease.renew("SP-D", { root, token: a.token });
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.token, a.token, "renew must NOT change the token identity");
  const after = lease.status("SP-D", { root });
  assert.strictEqual(after.token, before.token);
  assert.ok(after.renewed_at >= before.renewed_at);
});

test("verifyToken is true ONLY for the exact current holder token", () => {
  const root = tmpRoot("verify");
  const a = lease.acquire("SP-E", { root, sessionId: "sess-1" });
  assert.strictEqual(lease.verifyToken("SP-E", a.token, { root }), true);
  assert.strictEqual(lease.verifyToken("SP-E", a.token + 1, { root }), false);
  assert.strictEqual(lease.verifyToken("SP-NEVER-ACQUIRED", 1, { root }), false);
});

test("fencing token is monotonic across release+reacquire cycles (cross-session)", () => {
  const root = tmpRoot("monotonic");
  const spId = "SP-F";
  const tokens = [];
  for (let i = 0; i < 4; i++) {
    const r = lease.acquire(spId, { root, sessionId: `sess-${i}` });
    assert.strictEqual(r.ok, true);
    tokens.push(r.token);
    lease.release(spId, { root, token: r.token });
  }
  for (let i = 1; i < tokens.length; i++) {
    assert.ok(tokens[i] > tokens[i - 1], `token[${i}]=${tokens[i]} must exceed token[${i - 1}]=${tokens[i - 1]}`);
  }
});

test("reclaim refuses to touch a live, healthy lease", () => {
  const root = tmpRoot("reclaim-live");
  const a = lease.acquire("SP-G", { root, sessionId: "sess-1" });
  const r = lease.reclaim("SP-G", { root, sessionId: "sess-2" });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, "lease-active");
  assert.strictEqual(lease.verifyToken("SP-G", a.token, { root }), true, "the live holder's token must remain valid");
});

test("reclaim supersedes a lease whose holder PID is dead (crash simulation)", () => {
  const root = tmpRoot("reclaim-dead");
  const spId = "SP-H";
  const a = lease.acquire(spId, { root, sessionId: "sess-crashed" });
  const leaseFile = path.join(root, "conductor-leases", `${spId}.lease`);
  const holder = JSON.parse(fs.readFileSync(leaseFile, "utf8"));
  holder.pid = 999999999;
  fs.writeFileSync(leaseFile, JSON.stringify(holder) + "\n");

  const r = lease.reclaim(spId, { root, sessionId: "sess-rescuer" });
  assert.strictEqual(r.ok, true);
  assert.ok(r.token > a.token, "reclaim must mint a NEW, strictly higher fencing token");
  assert.strictEqual(lease.verifyToken(spId, a.token, { root }), false, "the dead holder's token must no longer verify");
  assert.strictEqual(lease.verifyToken(spId, r.token, { root }), true);
});

test("reclaim supersedes a lease that is stale-past-TTL even with a live PID", () => {
  const root = tmpRoot("reclaim-stale");
  const spId = "SP-I";
  const a = lease.acquire(spId, { root, sessionId: "sess-stale" });
  const leaseFile = path.join(root, "conductor-leases", `${spId}.lease`);
  const holder = JSON.parse(fs.readFileSync(leaseFile, "utf8"));
  holder.acquired_at = Date.now() - (lease.STALE_AFTER_MS + 60_000);
  holder.renewed_at = Date.now() - (lease.STALE_AFTER_MS + 60_000);
  fs.writeFileSync(leaseFile, JSON.stringify(holder) + "\n");

  const r = lease.reclaim(spId, { root, sessionId: "sess-rescuer" });
  assert.strictEqual(r.ok, true);
  assert.ok(r.token > a.token);
});

test("reclaim on an unheld SP-id behaves like a cold acquire", () => {
  const root = tmpRoot("reclaim-cold");
  const r = lease.reclaim("SP-J", { root, sessionId: "sess-1" });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.token, 1);
});

test("simultaneous acquire race: exactly one winner", () => {
  const root = tmpRoot("race");
  const spId = "SP-K";
  const results = [];
  for (let i = 0; i < 5; i++) {
    results.push(lease.acquire(spId, { root, sessionId: `sess-${i}` }));
  }
  const winners = results.filter((r) => r.ok === true);
  assert.strictEqual(winners.length, 1);
});

test("TEETH: withMutationLock SERIALIZES — a nested acquire while held is excluded (mutation-contended)", () => {
  const root = tmpRoot("mutex");
  const spId = "SP-MUTX";
  let inner;
  const outer = lease._withMutationLock(spId, root, () => {
    inner = lease._withMutationLock(spId, root, () => ({ ok: true, ran: true }), { maxWaitMs: 40 });
    return { ok: true };
  });
  assert.strictEqual(outer.ok, true);
  assert.strictEqual(inner.ok, false);
  assert.strictEqual(inner.reason, "mutation-contended");
});

test("TEETH: a superseded holder's release CANNOT delete the current lease (re-read under the lock)", () => {
  const root = tmpRoot("mutex-release");
  const spId = "SP-MUTEX";
  const a1 = lease.acquire(spId, { root, sessionId: "A" });
  assert.strictEqual(a1.token, 1);
  const lp = path.join(root, "conductor-leases", `${spId}.lease`);
  const stale = Object.assign(JSON.parse(fs.readFileSync(lp, "utf8")), {
    renewed_at: Date.now() - (lease.STALE_AFTER_MS + 1000),
    acquired_at: Date.now() - (lease.STALE_AFTER_MS + 1000),
  });
  fs.writeFileSync(lp, JSON.stringify(stale) + "\n");
  const b = lease.reclaim(spId, { root, sessionId: "B" });
  assert.strictEqual(b.ok, true);
  assert.ok(b.token > a1.token);
  const rel = lease.release(spId, { root, token: a1.token });
  assert.strictEqual(rel.ok, false);
  assert.strictEqual(rel.reason, "fencing-mismatch");
  assert.strictEqual(lease.verifyToken(spId, b.token, { root }), true);
});

test("TEETH: a LIVE owner's mutation lock is NOT reclaimed — a contender fails-contended, never unlinks it", () => {
  const root = tmpRoot("mlock-live");
  const spId = "SP-MLOCK-LIVE";
  fs.mkdirSync(path.join(root, "conductor-leases"), { recursive: true });
  const mlp = path.join(root, "conductor-leases", `${spId}.mutation.lock`);
  fs.writeFileSync(mlp, JSON.stringify({ pid: process.pid, ts: Date.now() - (lease.STALE_AFTER_MS + 60000) }) + "\n");
  const old = Date.now() - (24 * 60 * 60 * 1000);
  fs.utimesSync(mlp, new Date(old), new Date(old));
  let ran = false;
  const res = lease._withMutationLock(spId, root, () => { ran = true; return { ok: true }; }, { maxWaitMs: 40 });
  assert.strictEqual(ran, false, "must NOT reclaim a live owner's lock even though its mtime is ancient");
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, "mutation-contended");
  assert.ok(fs.existsSync(mlp), "the live owner's lock must survive");
});

test("TEETH: a DEAD owner's mutation lock IS reclaimed (safe crashed-holder recovery)", () => {
  const root = tmpRoot("mlock-dead");
  const spId = "SP-MLOCK-DEAD";
  fs.mkdirSync(path.join(root, "conductor-leases"), { recursive: true });
  const mlp = path.join(root, "conductor-leases", `${spId}.mutation.lock`);
  fs.writeFileSync(mlp, JSON.stringify({ pid: 999999999, ts: Date.now(), nonce: "deadgen0001" }) + "\n");
  let ran = false;
  const res = lease._withMutationLock(spId, root, () => { ran = true; return { ok: true, v: 42 }; }, { maxWaitMs: 200 });
  assert.strictEqual(ran, true, "a proven-dead, nonce-identified owner's lock must be reclaimed so the mutator can proceed");
  assert.deepStrictEqual(res, { ok: true, v: 42 });
});

test("TEETH: an EMPTY (live pre-stamp) ancient mutation lock is NEVER mtime-reclaimed — contender fails-contended and cannot remove it", () => {
  const root = tmpRoot("mlock-empty");
  const spId = "SP-MLOCK-EMPTY";
  fs.mkdirSync(path.join(root, "conductor-leases"), { recursive: true });
  const mlp = path.join(root, "conductor-leases", `${spId}.mutation.lock`);
  fs.writeFileSync(mlp, "");
  const old = Date.now() - (24 * 60 * 60 * 1000);
  fs.utimesSync(mlp, new Date(old), new Date(old));
  let ran = false;
  const res = lease._withMutationLock(spId, root, () => { ran = true; return { ok: true }; }, { maxWaitMs: 40 });
  assert.strictEqual(ran, false, "must NOT reclaim an unidentifiable lock by mtime — a live pre-stamp holder looks identical to a crash");
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, "mutation-contended");
  assert.ok(fs.existsSync(mlp), "the unidentifiable lock must survive (manual-recovery-required, never auto-mtime-reclaimed)");
});

test("TEETH: a TORN-stamp (unparseable JSON) ancient mutation lock is NEVER reclaimed either", () => {
  const root = tmpRoot("mlock-torn");
  const spId = "SP-MLOCK-TORN";
  fs.mkdirSync(path.join(root, "conductor-leases"), { recursive: true });
  const mlp = path.join(root, "conductor-leases", `${spId}.mutation.lock`);
  fs.writeFileSync(mlp, '{"pid": 12');
  const old = Date.now() - (24 * 60 * 60 * 1000);
  fs.utimesSync(mlp, new Date(old), new Date(old));
  let ran = false;
  const res = lease._withMutationLock(spId, root, () => { ran = true; return { ok: true }; }, { maxWaitMs: 40 });
  assert.strictEqual(ran, false, "an unparseable owner stamp is unidentifiable — never mtime-reclaimed");
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, "mutation-contended");
  assert.ok(fs.existsSync(mlp), "the torn-stamp lock must survive");
});

test("TEETH: a stamp with NO finite pid (identity-less) ancient mutation lock is NEVER reclaimed", () => {
  const root = tmpRoot("mlock-nopid");
  const spId = "SP-MLOCK-NOPID";
  fs.mkdirSync(path.join(root, "conductor-leases"), { recursive: true });
  const mlp = path.join(root, "conductor-leases", `${spId}.mutation.lock`);
  fs.writeFileSync(mlp, JSON.stringify({ ts: Date.now() }) + "\n");
  const old = Date.now() - (24 * 60 * 60 * 1000);
  fs.utimesSync(mlp, new Date(old), new Date(old));
  let ran = false;
  const res = lease._withMutationLock(spId, root, () => { ran = true; return { ok: true }; }, { maxWaitMs: 40 });
  assert.strictEqual(ran, false, "a stamp with no finite pid cannot prove the owner is dead — never mtime-reclaimed");
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, "mutation-contended");
  assert.ok(fs.existsSync(mlp), "the identity-less lock must survive");
});

test("TEETH (ABA): a stale reclaimer holding the OLD dead decision cannot unlink the winner's LIVE replacement nor enter its callback", () => {
  const root = tmpRoot("mlock-aba");
  const spId = "SP-MLOCK-ABA";
  fs.mkdirSync(path.join(root, "conductor-leases"), { recursive: true });
  const mlp = lease._mutationLockPath(spId, root);
  const deadNonce = "deadgenABA01";
  fs.writeFileSync(mlp, JSON.stringify({ pid: 999999999, ts: Date.now(), nonce: deadNonce }) + "\n");
  let checked = false;
  const res = lease._withMutationLock(spId, root, () => {
    const aOwner = JSON.parse(fs.readFileSync(mlp, "utf8").trim());
    assert.strictEqual(aOwner.pid, process.pid, "A (this process) now holds the reclaimed lock");
    assert.ok(aOwner.nonce && aOwner.nonce !== deadNonce, "A's generation is a NEW nonce, not the dead one");
    lease._reclaimDeadGeneration(mlp, deadNonce, 999999999);
    assert.ok(fs.existsSync(mlp), "A's live lock must survive B's stale reclaim attempt");
    assert.strictEqual(JSON.parse(fs.readFileSync(mlp, "utf8").trim()).nonce, aOwner.nonce, "A's generation intact");
    let bRan = false;
    const bRes = lease._withMutationLock(spId, root, () => { bRan = true; return { ok: true }; }, { maxWaitMs: 30 });
    assert.strictEqual(bRan, false, "B must NOT enter its callback while A holds");
    assert.strictEqual(bRes.reason, "mutation-contended");
    checked = true;
    return { ok: true };
  }, { maxWaitMs: 300 });
  assert.strictEqual(res.ok, true);
  assert.ok(checked, "the in-hold ABA assertions ran");
  assert.ok(!fs.existsSync(mlp), "A's content-fenced cleanup removed its OWN generation on release");
});

test("TEETH (fence): unlinkIfNonce removes ONLY our generation — cleanup cannot unlink another holder's replacement", () => {
  const root = tmpRoot("mlock-fence");
  const spId = "SP-MLOCK-FENCE";
  fs.mkdirSync(path.join(root, "conductor-leases"), { recursive: true });
  const mlp = lease._mutationLockPath(spId, root);
  fs.writeFileSync(mlp, JSON.stringify({ pid: process.pid, ts: Date.now(), nonce: "genA" }) + "\n");
  lease._unlinkIfNonce(mlp, "genB-different");
  assert.ok(fs.existsSync(mlp), "content-fenced cleanup on a different nonce must NOT remove the lock");
  lease._unlinkIfNonce(mlp, "genA");
  assert.ok(!fs.existsSync(mlp), "content-fenced cleanup on our own nonce removes it");
});

test("TEETH (election): only ONE contender retires a dead generation — a pre-existing reap link makes a 2nd contender lose without removing the lock", () => {
  const root = tmpRoot("mlock-elect");
  const spId = "SP-MLOCK-ELECT";
  fs.mkdirSync(path.join(root, "conductor-leases"), { recursive: true });
  const mlp = lease._mutationLockPath(spId, root);
  const deadNonce = "deadElect01";
  fs.writeFileSync(mlp, JSON.stringify({ pid: 999999999, ts: Date.now(), nonce: deadNonce }) + "\n");
  fs.linkSync(mlp, `${mlp}.${deadNonce}.reap`);
  const won = lease._reclaimDeadGeneration(mlp, deadNonce, 999999999);
  assert.strictEqual(won, false, "the 2nd contender must LOSE the election (EEXIST on the reap link)");
  assert.ok(fs.existsSync(mlp), "the loser must not remove the dead lock — retirement belongs to the election winner");
});

test("TEETH: a PROVEN-DEAD owner WITHOUT a nonce is NOT reclaimed (the election needs a generation id → contended/manual-recovery)", () => {
  const root = tmpRoot("mlock-nononce");
  const spId = "SP-MLOCK-NONONCE";
  fs.mkdirSync(path.join(root, "conductor-leases"), { recursive: true });
  const mlp = lease._mutationLockPath(spId, root);
  fs.writeFileSync(mlp, JSON.stringify({ pid: 999999999, ts: Date.now() }) + "\n");
  const old = Date.now() - (24 * 60 * 60 * 1000);
  fs.utimesSync(mlp, new Date(old), new Date(old));
  let ran = false;
  const res = lease._withMutationLock(spId, root, () => { ran = true; return { ok: true }; }, { maxWaitMs: 40 });
  assert.strictEqual(ran, false, "a dead but nonce-less lock cannot be generation-elected → contended");
  assert.strictEqual(res.reason, "mutation-contended");
  assert.ok(fs.existsSync(mlp), "the nonce-less lock must survive (fail-closed)");
});

for (const badPid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1234", NaN]) {
  test(`TEETH (pid): an ancient lock stamped with an INVALID pid (${String(badPid)}) is NEVER reclaimed`, () => {
    const tag = "mlock-pid-" + String(badPid).replace(/[^a-z0-9]/gi, "");
    const root = tmpRoot(tag);
    const spId = "SP-MLOCK-PID";
    fs.mkdirSync(path.join(root, "conductor-leases"), { recursive: true });
    const mlp = lease._mutationLockPath(spId, root);
    fs.writeFileSync(mlp, JSON.stringify({ pid: badPid, ts: Date.now(), nonce: "genPID" }) + "\n");
    const old = Date.now() - (24 * 60 * 60 * 1000);
    fs.utimesSync(mlp, new Date(old), new Date(old));
    let ran = false;
    const res = lease._withMutationLock(spId, root, () => { ran = true; return { ok: true }; }, { maxWaitMs: 40 });
    assert.strictEqual(ran, false, `pid ${String(badPid)} is not PROVEN dead → unidentifiable → contended`);
    assert.strictEqual(res.reason, "mutation-contended");
    assert.ok(fs.existsSync(mlp), "the lock must survive an invalid-pid stamp");
  });
}

test("pidProvenDead: TRUE only for a positive safe-integer pid that is ESRCH-absent; every other case is NOT proven dead", () => {
  assert.strictEqual(lease.pidProvenDead(process.pid), false, "our own live pid is not proven dead");
  assert.strictEqual(lease.pidProvenDead(0), false);
  assert.strictEqual(lease.pidProvenDead(-1), false);
  assert.strictEqual(lease.pidProvenDead(1.5), false);
  assert.strictEqual(lease.pidProvenDead(Number.MAX_SAFE_INTEGER + 1), false);
  assert.strictEqual(lease.pidProvenDead("1234"), false);
  assert.strictEqual(lease.pidProvenDead(NaN), false);
  assert.strictEqual(lease.pidProvenDead(999999999), true, "a positive safe-int pid with no such process (ESRCH) is proven dead");
});

test("pidLiveness: 3-state — 'dead' only on positive-safe-int ESRCH; 'live' on signal success; 'indeterminate' for every invalid pid", () => {
  assert.strictEqual(lease.pidLiveness(process.pid), "live", "our own pid is live");
  assert.strictEqual(lease.pidLiveness(999999999), "dead", "no such process → ESRCH → dead");
  for (const bad of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1234", NaN, null, undefined]) {
    assert.strictEqual(lease.pidLiveness(bad), "indeterminate", "invalid pid → indeterminate: " + String(bad));
  }
});

test("pidLiveness: a NON-ESRCH signal error is 'indeterminate', NEVER 'dead' (injected process.kill EPERM / other)", () => {
  const orig = process.kill;
  try {
    process.kill = () => { const e = new Error("perm"); e.code = "EPERM"; throw e; };
    assert.strictEqual(lease.pidLiveness(12345), "indeterminate", "EPERM → indeterminate (alive-uncertain, never dead)");
    process.kill = () => { const e = new Error("io"); e.code = "EIO"; throw e; };
    assert.strictEqual(lease.pidLiveness(12345), "indeterminate", "any non-ESRCH error → indeterminate");
  } finally {
    process.kill = orig;
  }
});

for (const badPid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1234", NaN]) {
  for (const staleState of ["fresh", "stale"]) {
    test(`TEETH (lease): reclaim() does NOT reclaim a ${staleState} lease with an INVALID pid (${String(badPid)}) — lease-indeterminate, token survives, no supersession`, () => {
      const root = tmpRoot("liveness-lease-" + String(badPid).replace(/[^a-z0-9]/gi, "") + "-" + staleState);
      const spId = "SP-LIVENESS-LEASE";
      const a = lease.acquire(spId, { root, sessionId: "sess-1" });
      const lp = path.join(root, "conductor-leases", `${spId}.lease`);
      const holder = JSON.parse(fs.readFileSync(lp, "utf8"));
      holder.pid = badPid;
      if (staleState === "stale") {
        holder.acquired_at = Date.now() - (lease.STALE_AFTER_MS + 60000);
        holder.renewed_at = Date.now() - (lease.STALE_AFTER_MS + 60000);
      }
      fs.writeFileSync(lp, JSON.stringify(holder) + "\n");
      const r = lease.reclaim(spId, { root, sessionId: "sess-rescuer" });
      assert.strictEqual(r.ok, false, "an invalid-pid lease must NOT be reclaimed REGARDLESS of staleness (indeterminate gate before stale)");
      assert.strictEqual(r.reason, "lease-indeterminate");
      assert.strictEqual(lease.verifyToken(spId, a.token, { root }), true, "the original token must survive (no supersession)");
    });
  }
}

test("TEETH: reclaim() treats a NON-ESRCH liveness error as indeterminate — a STALE lease whose pid errors non-ESRCH is NOT reclaimed (the stale-path bypass is closed)", () => {
  const root = tmpRoot("liveness-nonesrch-lease");
  const spId = "SP-LIVENESS-NONESRCH";
  const a = lease.acquire(spId, { root, sessionId: "sess-1" });
  const lp = path.join(root, "conductor-leases", `${spId}.lease`);
  const holder = JSON.parse(fs.readFileSync(lp, "utf8"));
  holder.pid = 424242;
  holder.acquired_at = Date.now() - (lease.STALE_AFTER_MS + 60000);
  holder.renewed_at = Date.now() - (lease.STALE_AFTER_MS + 60000);
  fs.writeFileSync(lp, JSON.stringify(holder) + "\n");
  const orig = process.kill;
  try {
    process.kill = (pid, sig) => { if (pid === 424242) { const e = new Error("perm"); e.code = "EPERM"; throw e; } return orig.call(process, pid, sig); };
    const r = lease.reclaim(spId, { root, sessionId: "sess-rescuer" });
    assert.strictEqual(r.ok, false, "a non-ESRCH (indeterminate) pid must NOT be reclaimed even when stale");
    assert.strictEqual(r.reason, "lease-indeterminate");
    assert.strictEqual(lease.verifyToken(spId, a.token, { root }), true);
  } finally {
    process.kill = orig;
  }
});

test("TEETH: a LIVE stale-past-TTL lease IS reclaimed (hung-conductor recovery) and is FENCING-PROTECTED — the superseded token no longer verifies and its release is refused", () => {
  const root = tmpRoot("liveness-livestale");
  const spId = "SP-LIVENESS-LIVESTALE";
  const a = lease.acquire(spId, { root, sessionId: "sess-hung" });
  const lp = path.join(root, "conductor-leases", `${spId}.lease`);
  const holder = JSON.parse(fs.readFileSync(lp, "utf8"));
  holder.acquired_at = Date.now() - (lease.STALE_AFTER_MS + 60000);
  holder.renewed_at = Date.now() - (lease.STALE_AFTER_MS + 60000);
  fs.writeFileSync(lp, JSON.stringify(holder) + "\n");
  const r = lease.reclaim(spId, { root, sessionId: "sess-rescuer" });
  assert.strictEqual(r.ok, true, "a live-but-stale lease is reclaimable (hung-conductor recovery)");
  assert.ok(r.token > a.token, "reclaim mints a strictly-higher fencing token");
  assert.strictEqual(lease.verifyToken(spId, a.token, { root }), false, "the superseded token must no longer verify (fencing)");
  assert.strictEqual(lease.verifyToken(spId, r.token, { root }), true);
  const staleRelease = lease.release(spId, { root, token: a.token });
  assert.strictEqual(staleRelease.ok, false);
  assert.strictEqual(staleRelease.reason, "fencing-mismatch");
});

test("TEETH: a PERSISTENT unlink failure on the dead lock returns a BOUNDED mutation-contended, never a livelock", () => {
  const root = tmpRoot("reap-eperm");
  const spId = "SP-REAP-EPERM";
  fs.mkdirSync(path.join(root, "conductor-leases"), { recursive: true });
  const mlp = lease._mutationLockPath(spId, root);
  fs.writeFileSync(mlp, JSON.stringify({ pid: 999999999, ts: Date.now(), nonce: "deadgenEperm" }) + "\n");
  const origUnlink = fs.unlinkSync;
  let ran = false;
  try {
    fs.unlinkSync = (p) => { if (p === mlp) { const e = new Error("perm"); e.code = "EPERM"; throw e; } return origUnlink.call(fs, p); };
    const t0 = Date.now();
    const res = lease._withMutationLock(spId, root, () => { ran = true; return { ok: true }; }, { maxWaitMs: 60 });
    const elapsed = Date.now() - t0;
    assert.strictEqual(ran, false, "must NOT enter the callback — the dead lock could not be retired");
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, "mutation-contended", "a persistent unlink failure must return BOUNDED mutation-contended (reclaimDeadGeneration reports NOT-retired)");
    assert.ok(elapsed < 5000, "must be BOUNDED — returned in <5s, not an unbounded busy-loop (was " + elapsed + "ms)");
  } finally {
    fs.unlinkSync = origUnlink;
  }
});

test("TEETH: reclaimDeadGeneration returns FALSE when the dead lock cannot be removed, TRUE when it is (or is already absent)", () => {
  const root = tmpRoot("reap-ret");
  const spId = "SP-REAP-RET";
  fs.mkdirSync(path.join(root, "conductor-leases"), { recursive: true });
  const mlp = lease._mutationLockPath(spId, root);
  fs.writeFileSync(mlp, JSON.stringify({ pid: 999999999, ts: Date.now(), nonce: "genRet" }) + "\n");
  const origUnlink = fs.unlinkSync;
  try {
    fs.unlinkSync = (p) => { if (p === mlp) { const e = new Error("perm"); e.code = "EPERM"; throw e; } return origUnlink.call(fs, p); };
    assert.strictEqual(lease._reclaimDeadGeneration(mlp, "genRet", 999999999), false, "unlink failed + lp still present → NOT retired");
    assert.ok(fs.existsSync(mlp), "the dead lock survives an unlink failure");
  } finally {
    fs.unlinkSync = origUnlink;
  }
  assert.strictEqual(lease._reclaimDeadGeneration(mlp, "genRet", 999999999), true, "unlink succeeds → retired");
  assert.ok(!fs.existsSync(mlp), "the dead lock is gone");
});
