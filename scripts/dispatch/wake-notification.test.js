"use strict";
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { test } = require("node:test");
const assert = require("node:assert");

const wake = require("./wake-notification");

function tmpRoot(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `wake-${tag}-`));
}

test("a signaled completion is reliably polled (no-dropped-re-wake)", () => {
  const root = tmpRoot("rewake");
  const before = wake.pollCompletion("d-1", { root });
  assert.strictEqual(before.completed, false);
  assert.strictEqual(before.outcome, null);

  const sig = wake.signalCompletion("d-1", { ok: true, terminal_state: "success" }, { root });
  assert.strictEqual(sig.ok, true);

  const after = wake.pollCompletion("d-1", { root });
  assert.strictEqual(after.completed, true);
  assert.deepStrictEqual(after.outcome, { ok: true, terminal_state: "success" });
  assert.ok(after.signaledAt, "signaledAt must be populated");
});

test("polling repeatedly after signal is idempotent — the marker is not consumed", () => {
  const root = tmpRoot("idempotent");
  wake.signalCompletion("d-2", "success", { root });
  const p1 = wake.pollCompletion("d-2", { root });
  const p2 = wake.pollCompletion("d-2", { root });
  const p3 = wake.pollCompletion("d-2", { root });
  assert.strictEqual(p1.completed, true);
  assert.strictEqual(p2.completed, true);
  assert.strictEqual(p3.completed, true);
  assert.strictEqual(p1.outcome, "success");
  assert.strictEqual(p2.outcome, "success");
  assert.strictEqual(p3.outcome, "success");
});

test("a completion signaled while no one was polling is STILL detected later", () => {
  const root = tmpRoot("durable");
  wake.signalCompletion("d-3", { ok: true }, { root });

  const late = wake.pollCompletion("d-3", { root });
  assert.strictEqual(late.completed, true);
  assert.deepStrictEqual(late.outcome, { ok: true });

  const markerFile = wake.markerPath("d-3", root);
  assert.ok(fs.existsSync(markerFile), "marker must be a durable on-disk artifact");
});

test("re-signaling the same dispatchId cleanly replaces the marker (no torn read)", () => {
  const root = tmpRoot("resignal");
  wake.signalCompletion("d-4", "partial", { root });
  wake.signalCompletion("d-4", "success", { root });
  const p = wake.pollCompletion("d-4", { root });
  assert.strictEqual(p.completed, true);
  assert.strictEqual(p.outcome, "success");
  const dir = wake.wakeDir(root);
  const leftoverTmp = fs.readdirSync(dir).filter((n) => n.startsWith(".tmp-"));
  assert.deepStrictEqual(leftoverTmp, []);
});

test("distinct dispatchIds never collide on the same marker", () => {
  const root = tmpRoot("distinct");
  wake.signalCompletion("build-a", "success", { root });
  wake.signalCompletion("build-a-2", "failed", { root });
  const a = wake.pollCompletion("build-a", { root });
  const a2 = wake.pollCompletion("build-a-2", { root });
  assert.strictEqual(a.outcome, "success");
  assert.strictEqual(a2.outcome, "failed");
});

test("isReapNotCompletion: marker present -> never a reap, regardless of pid state", () => {
  const root = tmpRoot("reap-present");
  wake.signalCompletion("d-5", { ok: true }, { root });
  assert.strictEqual(
    wake.isReapNotCompletion("d-5", { root, pidAlive: false }),
    false,
    "a completion marker exists — this must NOT be classified as a reap",
  );
  assert.strictEqual(
    wake.isReapNotCompletion("d-5", { root, pidAlive: true }),
    false,
  );
});

test("isReapNotCompletion: marker absent + pid confirmed dead -> reap", () => {
  const root = tmpRoot("reap-absent-dead");
  assert.strictEqual(
    wake.isReapNotCompletion("never-signaled", { root, pidAlive: false }),
    true,
    "vanished process with no completion marker must be classified as a reap",
  );
});

test("isReapNotCompletion: marker absent + pid still alive -> NOT a reap (still running)", () => {
  const root = tmpRoot("reap-absent-alive");
  assert.strictEqual(
    wake.isReapNotCompletion("still-running", { root, pidAlive: true }),
    false,
    "a live process with no marker yet is in-flight, not a reap",
  );
});

test("isReapNotCompletion accepts an injected pidAlive() function, not just a boolean", () => {
  const root = tmpRoot("reap-fn");
  let calls = 0;
  const pidAliveFn = () => {
    calls++;
    return false;
  };
  const result = wake.isReapNotCompletion("fn-checked", { root, pidAlive: pidAliveFn });
  assert.strictEqual(result, true);
  assert.strictEqual(calls, 1, "the injected liveness probe must actually be consulted");
});

test("isReapNotCompletion never makes its own OS process-liveness call — absent pidAlive reads as not-alive, not a silent success", () => {
  const root = tmpRoot("reap-no-probe");
  const result = wake.isReapNotCompletion("no-probe-supplied", { root });
  assert.strictEqual(result, true);
});

test("signalCompletion and pollCompletion reject a missing/blank dispatchId", () => {
  const root = tmpRoot("bad-id");
  assert.throws(() => wake.signalCompletion("", "x", { root }));
  assert.throws(() => wake.signalCompletion(undefined, "x", { root }));
  assert.throws(() => wake.pollCompletion("", { root }));
});

test("pollCompletion on a never-signaled dispatchId is completed:false, not a throw", () => {
  const root = tmpRoot("never");
  const p = wake.pollCompletion("nothing-here", { root });
  assert.strictEqual(p.completed, false);
  assert.strictEqual(p.outcome, null);
});

test("outcome === undefined is normalized to null, not dropped as a key", () => {
  const root = tmpRoot("undefined-outcome");
  wake.signalCompletion("d-6", undefined, { root });
  const p = wake.pollCompletion("d-6", { root });
  assert.strictEqual(p.completed, true);
  assert.strictEqual(p.outcome, null);
});
