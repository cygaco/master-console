"use strict";
// FALSIFIER: AC-F12 validation-to-merge race (CAS) — record-trust gate, surface
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..", "..");
const ACC = path.join(ROOT, "scripts", "dispatch", "acceptance-record.js");
const LEASE = path.join(ROOT, "scripts", "dispatch", "conductor-lease.js");

test("AC-F12 CAS: an integration whose expected head moved before the atomic ref update MUST-BLOCK — race gate REACHED", (t) => {
  const acc = require(ACC);
  const lease = require(LEASE);
  assert.strictEqual(typeof acc.commitIntegration, "function", "MUST-BLOCK: acceptance-record must expose commitIntegration (an absent CAS API is a fail-open)");
  const spId = "SP-FALSIFIER-F12";
  const leaseRoot = fs.mkdtempSync(path.join(os.tmpdir(), "acc-merge-race-"));
  const held = lease.acquire(spId, { root: leaseRoot, sessionId: "sess-merge-race" });
  t.after(() => { try { lease.release(spId, { root: leaseRoot, token: held.token }); } catch {} try { fs.rmSync(leaseRoot, { recursive: true, force: true }); } catch {} });
  const record = acc.produceForTest({ target_ref: "refs/heads/integration", lease_fencing_token: held.token });

  const commonOpts = {
    expectedHead: record.base_commit,
    spId,
    leaseRoot,
    treeResolver: () => record.result_tree_hash,
    ancestryResolver: () => true,
  };
  const MOVED_HEAD = "d".repeat(40);

  const raced = acc.commitIntegration(record, "refs/heads/integration", { ...commonOpts, liveHead: MOVED_HEAD });
  assert.strictEqual(raced.ok, false, "MUST-BLOCK: the CAS must fail when the integration head advanced after validation");
  assert.strictEqual(
    raced.reason,
    "validation-to-merge-race",
    "GATE-REACHED PROOF: the EXACT reason MUST be the CAS race — any other reason (invalid-commit-identity / not-authorized / superseded-lease) means an earlier gate short-circuited",
  );

  const unmoved = acc.commitIntegration(record, "refs/heads/integration", { ...commonOpts, liveHead: record.base_commit });
  assert.strictEqual(unmoved.ok, true, unmoved.reason);
});
