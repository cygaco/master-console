"use strict";
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { test } = require("node:test");
const assert = require("node:assert");

const reg = require("./cited-ed-registry");

function tmpDir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `cited-ed-${tag}-`));
}

function writeLedger(dir, name, ids) {
  const file = path.join(dir, name);
  const lines = ids.map((id) => JSON.stringify({ id, ts: "2026-07-19T00:00:00Z" }));
  fs.writeFileSync(file, lines.join("\n") + (lines.length ? "\n" : ""));
  return file;
}

function writeContract(dir, name, text) {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

test("resolveCitedEd: canonical-only — resolved true, source canonical", () => {
  const dir = tmpDir("canonical-only");
  const canonical = writeLedger(dir, "canonical.jsonl", ["ED-999100"]);
  const worktreeLocal = writeLedger(dir, "worktree.jsonl", []);
  const r = reg.resolveCitedEd("ED-999100", { roots: { canonical, worktreeLocal } });
  assert.deepStrictEqual(r, { resolved: true, source: "canonical" });
});

test("resolveCitedEd: worktree-local-only — resolved true, source worktree-local", () => {
  const dir = tmpDir("worktree-only");
  const canonical = writeLedger(dir, "canonical.jsonl", []);
  const worktreeLocal = writeLedger(dir, "worktree.jsonl", ["ED-999200"]);
  const r = reg.resolveCitedEd("ED-999200", { roots: { canonical, worktreeLocal } });
  assert.deepStrictEqual(r, { resolved: true, source: "worktree-local" });
});

test("resolveCitedEd: present in BOTH — resolved true, source canonical (durable source reported)", () => {
  const dir = tmpDir("both");
  const canonical = writeLedger(dir, "canonical.jsonl", ["ED-999300"]);
  const worktreeLocal = writeLedger(dir, "worktree.jsonl", ["ED-999300"]);
  const r = reg.resolveCitedEd("ED-999300", { roots: { canonical, worktreeLocal } });
  assert.deepStrictEqual(r, { resolved: true, source: "canonical" });
});

test("resolveCitedEd: absent from NEITHER root — resolved false, source null", () => {
  const dir = tmpDir("neither");
  const canonical = writeLedger(dir, "canonical.jsonl", ["ED-9991"]);
  const worktreeLocal = writeLedger(dir, "worktree.jsonl", ["ED-9992"]);
  const r = reg.resolveCitedEd("ED-999999", { roots: { canonical, worktreeLocal } });
  assert.deepStrictEqual(r, { resolved: false, source: null });
});

test("resolveCitedEd: missing root files (fresh-checkout shape) never throws — resolves false", () => {
  const dir = tmpDir("missing-files");
  const canonical = path.join(dir, "does-not-exist-canonical.jsonl");
  const worktreeLocal = path.join(dir, "does-not-exist-worktree.jsonl");
  assert.doesNotThrow(() => reg.resolveCitedEd("ED-9991", { roots: { canonical, worktreeLocal } }));
  const r = reg.resolveCitedEd("ED-9991", { roots: { canonical, worktreeLocal } });
  assert.deepStrictEqual(r, { resolved: false, source: null });
});

test("resolveCitedEd: malformed JSONL lines are skipped, not fatal", () => {
  const dir = tmpDir("malformed");
  const canonical = path.join(dir, "canonical.jsonl");
  fs.writeFileSync(
    canonical,
    ['{"id":"ED-9995"}', "not json at all", '{"id":"ED-9996"', ""].join("\n"),
  );
  const worktreeLocal = writeLedger(dir, "worktree.jsonl", []);
  const r5 = reg.resolveCitedEd("ED-9995", { roots: { canonical, worktreeLocal } });
  assert.strictEqual(r5.resolved, true);
  const r6 = reg.resolveCitedEd("ED-9996", { roots: { canonical, worktreeLocal } });
  assert.strictEqual(r6.resolved, false);
});

test("resolveCitedEd: an invalid edId shape resolves false without touching the roots", () => {
  const r = reg.resolveCitedEd("not-an-ed-id", { roots: { canonical: [], worktreeLocal: [] } });
  assert.deepStrictEqual(r, { resolved: false, source: null });
});

test("resolveCitedEd: accepts multiple files per root (array form) and unions across them", () => {
  const dir = tmpDir("multi-file");
  const c1 = writeLedger(dir, "c1.jsonl", ["ED-99910"]);
  const c2 = writeLedger(dir, "c2.jsonl", ["ED-99911"]);
  const w1 = writeLedger(dir, "w1.jsonl", []);
  const r10 = reg.resolveCitedEd("ED-99910", { roots: { canonical: [c1, c2], worktreeLocal: [w1] } });
  const r11 = reg.resolveCitedEd("ED-99911", { roots: { canonical: [c1, c2], worktreeLocal: [w1] } });
  assert.strictEqual(r10.resolved, true);
  assert.strictEqual(r11.resolved, true);
});

test("syncDriftLint: a cited-but-absent-from-BOTH ED is a drift", () => {
  const dir = tmpDir("drift-absent");
  const canonical = writeLedger(dir, "canonical.jsonl", []);
  const worktreeLocal = writeLedger(dir, "worktree.jsonl", []);
  const contract = writeContract(dir, "contracts/doc.md", "Deferred: ED-999777 @ Phase-X-exit\n");
  const result = reg.syncDriftLint({ roots: { canonical, worktreeLocal, contracts: [contract] } });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.drifts.length, 1);
  assert.strictEqual(result.drifts[0].edId, "ED-999777");
  assert.deepStrictEqual(result.drifts[0].citedIn, [contract]);
});

test("syncDriftLint: a cited ED resolvable in worktree-local-ONLY is NOT a drift (the tolerated split-durability case)", () => {
  const dir = tmpDir("drift-worktree-only-ok");
  const canonical = writeLedger(dir, "canonical.jsonl", []);
  const worktreeLocal = writeLedger(dir, "worktree.jsonl", ["ED-999555"]);
  const contract = writeContract(dir, "contracts/doc.md", "closes ED-999555\n");
  const result = reg.syncDriftLint({ roots: { canonical, worktreeLocal, contracts: [contract] } });
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.drifts, []);
});

test("syncDriftLint: a cited ED resolvable in canonical-ONLY is NOT a drift", () => {
  const dir = tmpDir("drift-canonical-only-ok");
  const canonical = writeLedger(dir, "canonical.jsonl", ["ED-999556"]);
  const worktreeLocal = writeLedger(dir, "worktree.jsonl", []);
  const contract = writeContract(dir, "contracts/doc.md", "closes ED-999556\n");
  const result = reg.syncDriftLint({ roots: { canonical, worktreeLocal, contracts: [contract] } });
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.drifts, []);
});

test("syncDriftLint: mixed contract set — resolved EDs pass through clean, only the unresolvable one drifts", () => {
  const dir = tmpDir("mixed");
  const canonical = writeLedger(dir, "canonical.jsonl", ["ED-9991"]);
  const worktreeLocal = writeLedger(dir, "worktree.jsonl", ["ED-9992"]);
  const docA = writeContract(dir, "contracts/a.md", "Enforcer names ED-9991 and ED-9992.\n");
  const docB = writeContract(dir, "contracts/b.md", "Deferred: ED-9993 @ later\n");
  const result = reg.syncDriftLint({ roots: { canonical, worktreeLocal, contracts: [docA, docB] } });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.drifts.length, 1);
  assert.strictEqual(result.drifts[0].edId, "ED-9993");
  assert.deepStrictEqual(result.drifts[0].citedIn, [docB]);
});

test("syncDriftLint: the same unresolvable ED cited across two contracts collapses into one drift with both files listed", () => {
  const dir = tmpDir("multi-cite");
  const canonical = writeLedger(dir, "canonical.jsonl", []);
  const worktreeLocal = writeLedger(dir, "worktree.jsonl", []);
  const docA = writeContract(dir, "contracts/a.md", "cites ED-99942\n");
  const docB = writeContract(dir, "contracts/b.md", "also cites ED-99942\n");
  const result = reg.syncDriftLint({ roots: { canonical, worktreeLocal, contracts: [docA, docB] } });
  assert.strictEqual(result.drifts.length, 1);
  assert.strictEqual(result.drifts[0].edId, "ED-99942");
  assert.deepStrictEqual(result.drifts[0].citedIn.sort(), [docA, docB].sort());
});

test("syncDriftLint: a repeated citation within the SAME file is deduped in citedIn", () => {
  const dir = tmpDir("dedup-same-file");
  const canonical = writeLedger(dir, "canonical.jsonl", []);
  const worktreeLocal = writeLedger(dir, "worktree.jsonl", []);
  const doc = writeContract(dir, "contracts/a.md", "ED-99988 ... later again ED-99988 ... and again ED-99988\n");
  const result = reg.syncDriftLint({ roots: { canonical, worktreeLocal, contracts: [doc] } });
  assert.strictEqual(result.drifts.length, 1);
  assert.deepStrictEqual(result.drifts[0].citedIn, [doc]);
});

test("syncDriftLint: scanning a DIRECTORY walks .md/.json files and skips non-contract extensions", () => {
  const dir = tmpDir("dir-walk");
  const canonical = writeLedger(dir, "canonical.jsonl", []);
  const worktreeLocal = writeLedger(dir, "worktree.jsonl", []);
  const contractsRoot = path.join(dir, "contracts");
  writeContract(contractsRoot, "nested/doc.md", "cites ED-999901\n");
  writeContract(contractsRoot, "data.json", '{"note":"ED-999902"}\n');
  writeContract(contractsRoot, "ignored.txt", "cites ED-999903\n");
  const result = reg.syncDriftLint({ roots: { canonical, worktreeLocal, contracts: [contractsRoot] } });
  const ids = result.drifts.map((d) => d.edId).sort();
  assert.deepStrictEqual(ids, ["ED-999901", "ED-999902"]);
});

test("syncDriftLint: no contracts injected -> ok true, drifts empty (no default repo-wide side effect)", () => {
  const dir = tmpDir("no-contracts");
  const canonical = writeLedger(dir, "canonical.jsonl", []);
  const worktreeLocal = writeLedger(dir, "worktree.jsonl", []);
  const result = reg.syncDriftLint({ roots: { canonical, worktreeLocal, contracts: [] } });
  assert.deepStrictEqual(result, { ok: true, drifts: [] });
});

test("syncDriftLint: a missing contracts target (not yet created) contributes nothing, no throw", () => {
  const dir = tmpDir("missing-contract-target");
  const canonical = writeLedger(dir, "canonical.jsonl", []);
  const worktreeLocal = writeLedger(dir, "worktree.jsonl", []);
  const missing = path.join(dir, "nope", "does-not-exist.md");
  assert.doesNotThrow(() =>
    reg.syncDriftLint({ roots: { canonical, worktreeLocal, contracts: [missing] } }),
  );
});

test("syncDriftLint: output is sorted by edId for deterministic CI diffs", () => {
  const dir = tmpDir("sorted");
  const canonical = writeLedger(dir, "canonical.jsonl", []);
  const worktreeLocal = writeLedger(dir, "worktree.jsonl", []);
  const doc = writeContract(dir, "contracts/doc.md", "ED-99950 ED-9999 ED-999700\n");
  const result = reg.syncDriftLint({ roots: { canonical, worktreeLocal, contracts: [doc] } });
  assert.deepStrictEqual(result.drifts.map((d) => d.edId), ["ED-99950", "ED-999700", "ED-9999"]);
});

test("defaults: DEFAULT_CANONICAL_REGISTRY sits under the tracked .claude/project/maps/ tree (not the gitignored memory/ ledger)", () => {
  assert.match(reg.DEFAULT_CANONICAL_REGISTRY, /[\\/]\.claude[\\/]project[\\/]maps[\\/]/);
});

test("defaults: DEFAULT_WORKTREE_LEDGER points at the existing gitignored enforcement-debt.jsonl ledger", () => {
  assert.match(reg.DEFAULT_WORKTREE_LEDGER, /[\\/]\.claude[\\/]project[\\/]memory[\\/]enforcement-debt\.jsonl$/);
});

test("resolveCitedEd: real default roots never throw even when the canonical registry doesn't exist yet", () => {
  assert.doesNotThrow(() => reg.resolveCitedEd("ED-9991"));
});
