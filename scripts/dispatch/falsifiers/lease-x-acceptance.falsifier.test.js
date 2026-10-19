"use strict";
// FALSIFIER: AC-F10 lease x acceptance composition — record-trust gate, cross-surface seam
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..", "..");
const ACC = path.join(ROOT, "scripts", "dispatch", "acceptance-record.js");
const LEASE = path.join(ROOT, "scripts", "dispatch", "conductor-lease.js");

test("AC-F10 valid AcceptanceRecord minted under a SUPERSEDED lease MUST-BLOCK integration — lease gate REACHED", (t) => {
  const acc = require(ACC);
  const lease = require(LEASE);
  const spId = "SP-FALSIFIER-F10";
  const leaseRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lease-x-acc-"));
  const a1 = lease.acquire(spId, { root: leaseRoot, sessionId: "sess-stale" });
  lease.release(spId, { root: leaseRoot, token: a1.token });
  const a2 = lease.acquire(spId, { root: leaseRoot, sessionId: "sess-current" });
  t.after(() => { try { lease.release(spId, { root: leaseRoot, token: a2.token }); } catch {} try { fs.rmSync(leaseRoot, { recursive: true, force: true }); } catch {} });

  const baseOpts = (record) => ({
    integrationHead: record.base_commit,
    spId,
    leaseRoot,
    treeResolver: () => record.result_tree_hash,
    ancestryResolver: () => true,
  });

  const stale = acc.produceForTest({ target_ref: "refs/heads/integration", lease_fencing_token: a1.token });
  assert.strictEqual(
    acc.authorizesIntegration(stale, "refs/heads/integration", baseOpts(stale)),
    false,
    "MUST-BLOCK: a record minted under a superseded lease token must not authorize integration (cross-surface seam)",
  );

  const current = acc.produceForTest({ target_ref: "refs/heads/integration", lease_fencing_token: a2.token });
  assert.strictEqual(
    acc.authorizesIntegration(current, "refs/heads/integration", baseOpts(current)),
    true,
    "CONTROL: identical context + current lease token MUST authorize (isolates the lease-currency gate)",
  );
});
