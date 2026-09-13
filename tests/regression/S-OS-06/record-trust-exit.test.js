#!/usr/bin/env node
"use strict";
/**
 * record-trust-exit.test.js — S-OS-06 T2, record-trust Req4 (the design->build EXIT enforcer).
 *
 * GREEN: scripts/checks/record-trust-exit.js exits 0 on the real clean tree with all four
 * items PASS, and does not mutate the committed occurrence ledger its dry-run rewrites.
 *
 * RED: the planted defects live in a TEMP COPY, never the real tree. The copy holds the
 * enforcer, the loader, the partition artifact (at the loader's own relative path — this file
 * never names it) and one stub per real falsify fixture (same file name, same FALSIFIER_ID,
 * a trivially passing test), so the enforcer's REPO_ROOT follows the copy. Each RED is
 * attributed: the same copy's item passes (exit code 0) before the plant and fails (exit
 * code 1) after it. A CLI spawn of the copy also exits 1 with the planted item's FAIL line.
 *
 *   node --test tests/regression/S-OS-06/record-trust-exit.test.js
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const H = require("./falsifier-harness");

const ENFORCER_REL = "scripts/checks/record-trust-exit.js";
const ENFORCER = path.join(H.REAL_ROOT, ...ENFORCER_REL.split("/"));
const FIXTURES_REL = "tests/regression/S-OS-06";
const ITEM_LINE_RE = /^(PASS|FAIL) \[(\d) ([a-z-]+)\] (.*)$/;
const FALSIFIER_ID_RE = /^\s*const\s+FALSIFIER_ID\s*=\s*["']([^"']+)["']/m;

function childEnv() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

function itemLines(stdout) {
  return String(stdout)
    .split(/\r?\n/)
    .map((l) => l.match(ITEM_LINE_RE))
    .filter(Boolean)
    .map((m) => ({ verdict: m[1], n: Number(m[2]), id: m[3], detail: m[4] }));
}

function spawnEnforcer(file, cwd, timeoutMs) {
  const r = spawnSync(process.execPath, [file], { cwd, env: childEnv(), encoding: "utf8", timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(`spawn record-trust-exit failed: ${r.error.message}`);
  if (r.status === null) throw new Error(`record-trust-exit was killed by ${r.signal} — not an observed exit code`);
  return r;
}

/** The real falsify fixtures and the id each declares (read, never hardcoded). */
function realFixtures() {
  const dir = path.join(H.REAL_ROOT, ...FIXTURES_REL.split("/"));
  return fs
    .readdirSync(dir)
    .filter((f) => /^falsify-.+\.test\.js$/.test(f))
    .sort()
    .map((file) => {
      const m = fs.readFileSync(path.join(dir, file), "utf8").match(FALSIFIER_ID_RE);
      return { file, id: m ? m[1] : null };
    });
}

function stubSource(id, body = "") {
  return `"use strict";\nconst FALSIFIER_ID = ${JSON.stringify(id)};\nrequire("node:test")(\`\${FALSIFIER_ID} stub\`, () => {${body}});\n`;
}

function withTempCopy(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sos06-exit-"));
  const abs = (rel) => path.join(dir, ...rel.split("/"));
  const write = (rel, content) => {
    fs.mkdirSync(path.dirname(abs(rel)), { recursive: true });
    fs.writeFileSync(abs(rel), content, "utf8");
  };
  const copy = (rel) => write(rel, fs.readFileSync(path.join(H.REAL_ROOT, ...rel.split("/")), "utf8"));
  copy(ENFORCER_REL);
  copy(H.REL.loader);
  copy(H.REL.partition);
  const fixtures = realFixtures();
  for (const { file, id } of fixtures) write(`${FIXTURES_REL}/${file}`, stubSource(id));
  const enforcerFile = abs(ENFORCER_REL);
  const mod = require(enforcerFile);
  const cx = {
    dir,
    abs,
    write,
    fixtures,
    enforcerFile,
    fixtureRel: (id) => `${FIXTURES_REL}/${fixtures.find((f) => f.id === id).file}`,
    async runItems(items) {
      const results = await mod.runRecordTrustExit({ items });
      return { results, code: mod.exitCodeFor(results), byId: Object.fromEntries(results.map((r) => [r.id, r])) };
    },
  };
  const cleanup = () => {
    delete require.cache[enforcerFile];
    delete require.cache[abs(H.REL.loader)];
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      /* temp dir; best effort on Windows file locks */
    }
  };
  return Promise.resolve()
    .then(() => fn(cx))
    .finally(cleanup);
}

test("record-trust-exit GREEN: the real clean tree -> exit 0, all four items PASS, the committed ledger unchanged", { timeout: 25 * 60 * 1000 }, () => {
  const ledgerBefore = fs.readFileSync(H.LOADER.COMMITTED_LEDGER_PATH, "utf8");
  const r = spawnEnforcer(ENFORCER, H.REAL_ROOT, 20 * 60 * 1000);
  const lines = itemLines(r.stdout);
  assert.strictEqual(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.deepStrictEqual(lines.map((l) => [l.n, l.id, l.verdict]), [
    [1, "fixtures", "PASS"],
    [2, "guard", "PASS"],
    [3, "deny-list", "PASS"],
    [4, "dry-run", "PASS"],
  ]);
  assert.match(r.stdout, /^record-trust-exit: PASS \(4\/4 items pass\)$/m);
  assert.match(lines[3].detail, /unclassified=0; unpinned-unrewritten-underived=0; PRE-apply derived set == the 5 generated views/);
  assert.strictEqual(fs.readFileSync(H.LOADER.COMMITTED_LEDGER_PATH, "utf8"), ledgerBefore, "the exit gate must not change the committed ledger");
});

test("record-trust-exit: every required falsifier id is present in the real fixture set", () => {
  const { REQUIRED_FALSIFIERS } = require(ENFORCER);
  const ids = realFixtures().map((f) => f.id);
  for (const id of REQUIRED_FALSIFIERS) assert.ok(ids.includes(id), `real fixture set lacks ${id}`);
});

test("record-trust-exit: an empty or partial result set never yields exit 0", () => {
  const { exitCodeFor } = require(ENFORCER);
  assert.strictEqual(exitCodeFor([]), 1);
  assert.strictEqual(exitCodeFor(undefined), 1);
  assert.strictEqual(exitCodeFor([{ ok: true }, { ok: "yes" }]), 1);
  assert.strictEqual(exitCodeFor([{ ok: true }]), 0);
});

test("record-trust-exit RED (fixture removed): removing ANY required falsifier fixture flips item 1 PASS -> FAIL naming it", { timeout: 5 * 60 * 1000 }, async () => {
  await withTempCopy(async (cx) => {
    const base = await cx.runItems(["fixtures"]);
    assert.strictEqual(base.code, 0, `baseline copy must pass: ${JSON.stringify(base.results)}`);
    const { REQUIRED_FALSIFIERS } = require(cx.enforcerFile);
    for (const id of REQUIRED_FALSIFIERS) {
      const rel = cx.fixtureRel(id);
      const saved = fs.readFileSync(cx.abs(rel), "utf8");
      fs.rmSync(cx.abs(rel));
      const red = await cx.runItems(["fixtures"]);
      assert.strictEqual(red.code, 1, `removing ${id} must exit 1`);
      assert.match(red.byId.fixtures.detail, new RegExp(`missing required falsifier fixture\\(s\\): ${id}\\b`));
      cx.write(rel, saved);
    }
  });
});

test("record-trust-exit RED (fixture fails / skips): a failing or fully-skipped fixture is a FAIL, never green", { timeout: 5 * 60 * 1000 }, async () => {
  await withTempCopy(async (cx) => {
    const rel = cx.fixtureRel("F8");
    const file = path.posix.basename(rel);

    cx.write(rel, stubSource("F8", ` throw new Error("planted fixture failure"); `));
    const failing = await cx.runItems(["fixtures"]);
    assert.strictEqual(failing.code, 1);
    assert.ok(failing.byId.fixtures.detail.includes(`${file}: exit 1`), failing.byId.fixtures.detail);

    cx.write(rel, `"use strict";\nconst FALSIFIER_ID = "F8";\nrequire("node:test").skip("F8 stub skipped", () => {});\n`);
    const skipped = await cx.runItems(["fixtures"]);
    assert.strictEqual(skipped.code, 1);
    assert.match(skipped.byId.fixtures.detail, /skipped=1 .*a skipped falsifier reads green/);

    cx.write(rel, stubSource("F8"));
    assert.strictEqual((await cx.runItems(["fixtures"])).code, 0, "restored stub passes again");
  });
});

test("record-trust-exit RED (deny-list header stripped / removed): item 3 PASS -> FAIL", { timeout: 2 * 60 * 1000 }, async () => {
  await withTempCopy(async (cx) => {
    const base = await cx.runItems(["deny-list"]);
    assert.strictEqual(base.code, 0, JSON.stringify(base.results));

    const artifact = cx.abs(H.REL.partition);
    const original = fs.readFileSync(artifact, "utf8");
    const stripped = JSON.parse(original);
    delete stripped.$question;
    fs.writeFileSync(artifact, JSON.stringify(stripped, null, 2) + "\n", "utf8");
    const red = await cx.runItems(["deny-list"]);
    assert.strictEqual(red.code, 1);
    assert.match(red.byId["deny-list"].detail, /\$question/);

    fs.rmSync(artifact);
    const gone = await cx.runItems(["deny-list"]);
    assert.strictEqual(gone.code, 1);
    assert.match(gone.byId["deny-list"].detail, /is missing/);
  });
});

test("record-trust-exit RED (CLI): the copied CLI exits 1 with the planted items' FAIL lines", { timeout: 5 * 60 * 1000 }, async () => {
  await withTempCopy(async (cx) => {
    fs.rmSync(cx.abs(cx.fixtureRel("F3")));
    const stripped = JSON.parse(fs.readFileSync(cx.abs(H.REL.partition), "utf8"));
    delete stripped.$question;
    fs.writeFileSync(cx.abs(H.REL.partition), JSON.stringify(stripped, null, 2) + "\n", "utf8");

    const r = spawnEnforcer(cx.enforcerFile, cx.dir, 4 * 60 * 1000);
    assert.strictEqual(r.status, 1, `${r.stdout}\n${r.stderr}`);
    const byId = Object.fromEntries(itemLines(r.stdout).map((l) => [l.id, l]));
    assert.deepStrictEqual(Object.keys(byId).sort(), ["deny-list", "dry-run", "fixtures", "guard"]);
    assert.strictEqual(byId.fixtures.verdict, "FAIL");
    assert.match(byId.fixtures.detail, /missing required falsifier fixture\(s\): F3\b/);
    assert.strictEqual(byId["deny-list"].verdict, "FAIL");
    assert.match(r.stdout, /^record-trust-exit: FAIL /m);
  });
});
