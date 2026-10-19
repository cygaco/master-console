"use strict";
// FALSIFIER: AC-F3 stale-base — record-trust gate, surface acceptance-record-at-integration
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..", "..");
const ACC = path.join(ROOT, "scripts", "dispatch", "acceptance-record.js");
const LEASE = path.join(ROOT, "scripts", "dispatch", "conductor-lease.js");

test("AC-F3 stale-base MUST-BLOCK integration (head advanced after the freshness check) — freshness gate REACHED", (t) => {
  const acc = require(ACC);
  const lease = require(LEASE);
  const spId = "SP-FALSIFIER-F3";
  const leaseRoot = fs.mkdtempSync(path.join(os.tmpdir(), "acc-stale-"));
  const held = lease.acquire(spId, { root: leaseRoot, sessionId: "sess-stale" });
  t.after(() => { try { lease.release(spId, { root: leaseRoot, token: held.token }); } catch {} try { fs.rmSync(leaseRoot, { recursive: true, force: true }); } catch {} });
  const record = acc.produceForTest({ target_ref: "refs/heads/integration", lease_fencing_token: held.token });

  const baseOpts = {
    spId,
    leaseRoot,
    treeResolver: () => record.result_tree_hash,
    ancestryResolver: () => true,
  };
  const ADVANCED_HEAD = "e".repeat(40);

  assert.strictEqual(
    acc.authorizesIntegration(record, "refs/heads/integration", { ...baseOpts, integrationHead: ADVANCED_HEAD }),
    false,
    "MUST-BLOCK: a record whose base is stale against the advanced integration head must not authorize the merge (TOCTOU)",
  );

  assert.strictEqual(
    acc.authorizesIntegration(record, "refs/heads/integration", { ...baseOpts, integrationHead: record.base_commit }),
    true,
    "CONTROL: identical context + matching head MUST authorize (isolates the freshness gate)",
  );
});
