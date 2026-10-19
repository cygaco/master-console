"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..", "..");
const MOD = path.join(ROOT, "scripts", "dispatch", "acceptance-record.js");

test("positive companion — a fully valid AcceptanceRecord DOES authorize integration", (t) => {
  const acc = require(MOD);
  const lease = require(path.join(ROOT, "scripts", "dispatch", "conductor-lease.js"));
  const leaseRoot = fs.mkdtempSync(path.join(os.tmpdir(), "acc-pos-companion-"));
  const spId = "SP-ACC-POS-COMPANION";
  const held = lease.acquire(spId, { root: leaseRoot, sessionId: "sess-companion" });
  const record = acc.produceForTest({ target_ref: "refs/heads/integration", lease_fencing_token: held.token });
  const authorized = acc.authorizesIntegration(record, "refs/heads/integration", {
    integrationHead: record.base_commit,
    spId,
    leaseRoot,
    treeResolver: () => record.result_tree_hash,
    ancestryResolver: () => true,
  });
  assert.strictEqual(
    authorized,
    true,
    "the golden path must AUTHORIZE — a reject-everything stub fails here (defeats the constant-false false-green)",
  );
});
