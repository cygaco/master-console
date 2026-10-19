"use strict";
// FALSIFIER: AC-F11 forged/provider-authored AcceptanceRecord — record-trust gate, surface
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..", "..");
const ACC = path.join(ROOT, "scripts", "dispatch", "acceptance-record.js");
const LEASE = path.join(ROOT, "scripts", "dispatch", "conductor-lease.js");

test("AC-F11 provider-authored AcceptanceRecord with a fabricated result-tree hash MUST-BLOCK (verifier recomputes, not trusts) — recompute gate REACHED", (t) => {
  const acc = require(ACC);
  const lease = require(LEASE);
  const leaseRoot = fs.mkdtempSync(path.join(os.tmpdir(), "acc-forged-"));
  const spId = "SP-FALSIFIER-F11";
  const held = lease.acquire(spId, { root: leaseRoot, sessionId: "sess-forged" });
  t.after(() => { try { lease.release(spId, { root: leaseRoot, token: held.token }); } catch {} try { fs.rmSync(leaseRoot, { recursive: true, force: true }); } catch {} });

  const forged = acc.produceForTest({
    target_ref: "refs/heads/integration",
    lease_fencing_token: held.token,
    result_tree_hash: "f".repeat(40),
  });
  let treeCalls = 0;
  const opts = {
    integrationHead: forged.base_commit,
    spId,
    leaseRoot,
    treeResolver: () => { treeCalls++; return "tree-OK"; },
    ancestryResolver: () => true,
  };
  const authorized = acc.authorizesIntegration(forged, "refs/heads/integration", opts);
  assert.strictEqual(authorized, false, "MUST-BLOCK: a fabricated result_tree_hash the verifier recomputes-and-mismatches must not authorize");
  assert.ok(treeCalls > 0, "GATE-REACHED PROOF: the recompute (treeResolver) MUST be invoked — a 0-call means the record short-circuited at an earlier gate");

  const honest = acc.produceForTest({ target_ref: "refs/heads/integration", lease_fencing_token: held.token });
  const okAuthorized = acc.authorizesIntegration(honest, "refs/heads/integration", { ...opts, treeResolver: () => honest.result_tree_hash });
  assert.strictEqual(okAuthorized, true, "CONTROL: identical context + honest tree MUST authorize (isolates the recompute gate as the sole differentiator)");
});
