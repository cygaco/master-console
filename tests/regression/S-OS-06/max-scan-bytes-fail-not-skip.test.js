#!/usr/bin/env node
"use strict";
/**
 * max-scan-bytes-fail-not-skip — S-OS-06 T5-C (T-20260913-364).
 *
 * rename-mc.js used to SILENTLY SKIP any tracked file larger than MAX_SCAN_BYTES (5MB): its content was
 * never scanned, so a `warpos` occurrence inside it went unledgered and unrewritten while --dry-run read
 * green (the β fail-open class). Zero tracked files exceed the cap today, so this test PLANTS one:
 *   - attribution: the clean fixture's --dry-run exits 0 with oversizedUnscanned=0 FIRST;
 *   - RED: after committing a tracked non-binary file over the cap, --dry-run exits NON-ZERO, prints
 *     oversizedUnscanned=1, NAMES the file on stderr, and records it in the plan;
 *   - --apply refuses (non-zero, naming it) before renaming or rewriting anything;
 *   - a BINARY blob over the cap (NUL byte / binary extension) stays a legitimate skip — never flagged.
 *
 *   node --test tests/regression/S-OS-06/max-scan-bytes-fail-not-skip.test.js
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const H = require("./falsifier-harness");

const CODEMOD = require(path.join(H.REAL_ROOT, "scripts", "open-source", "rename-mc.js"));
const { MAX_SCAN_BYTES, scanStatus, listOversizedUnscanned } = CODEMOD;

const BIG_REL = "src/huge-generated.txt";
const BIG_BODY = `// the ${H.SLUG} blob, one occurrence the scan would never see\n` + "x".repeat(MAX_SCAN_BYTES + 1) + "\n";

const readPlan = (fx) => JSON.parse(fs.readFileSync(path.join(fx.dir, "runtime", "S-OS-06", "rename-plan.json"), "utf8"));

test("MAX_SCAN_BYTES is the documented 5MB cap", () => {
  assert.strictEqual(MAX_SCAN_BYTES, 5 * 1024 * 1024);
});

test("RED: a tracked non-binary file over MAX_SCAN_BYTES makes --dry-run FAIL and NAME it (clean fixture passes first)", () => {
  H.withFixture({}, (fx) => {
    const base = fx.runCodemod(["--dry-run"]);
    assert.strictEqual(base.status, 0, `the clean fixture must pass first (attribution): ${base.out}`);
    assert.match(base.stdout, /^\s*oversizedUnscanned=0 /m, base.out);

    fx.write(BIG_REL, BIG_BODY);
    fx.commit("T5-C plant: a tracked text file over MAX_SCAN_BYTES", [BIG_REL]);

    const red = fx.runCodemod(["--dry-run"]);
    assert.notStrictEqual(red.status, 0, `an oversized tracked text file must fail the dry-run, not skip: ${red.out.slice(0, 2000)}`);
    assert.match(red.stdout, /^\s*oversizedUnscanned=1 /m, red.out.slice(0, 2000));
    assert.match(red.stderr, /rename-mc --dry-run FAILED: 1 tracked non-binary file\(s\) exceed MAX_SCAN_BYTES and were NOT scanned:/);
    assert.match(red.stderr, /- src\/huge-generated\.txt \(\d+ bytes > MAX_SCAN_BYTES 5242880; non-binary/);

    const plan = readPlan(fx);
    assert.strictEqual(plan.oversizedUnscanned, 1);
    assert.deepStrictEqual(plan.oversizedUnscannedFiles.map((o) => o.file), [BIG_REL]);
    assert.ok(plan.oversizedUnscannedFiles[0].bytes > MAX_SCAN_BYTES);
  });
});

test("RED: --apply refuses on an oversized tracked text file before renaming or rewriting anything", () => {
  const extraFiles = { [BIG_REL]: BIG_BODY, "src/banner.js": `// ${H.SLUG} banner\n` };
  H.withFixture({ extraFiles }, (fx) => {
    const apply = fx.runCodemod(["--apply"]);
    assert.notStrictEqual(apply.status, 0, `--apply must refuse: ${apply.out.slice(0, 2000)}`);
    assert.match(apply.stderr, /--apply refused: src\/huge-generated\.txt \(\d+ bytes > MAX_SCAN_BYTES/);
    assert.strictEqual(fx.read("src/banner.js"), `// ${H.SLUG} banner\n`, "the refusal happens before ANY rewrite");
    assert.strictEqual(fx.trackedDirty(), "", "no tracked file changed");
  });
});

test("binary blobs over the cap stay a legitimate skip; only oversized TEXT is flagged", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sos06-maxscan-"));
  try {
    const cap = 64; // scanStatus/listOversizedUnscanned take the cap as a parameter; no multi-MB writes needed here
    const files = {
      "big.txt": "y".repeat(cap + 1),
      "nul.dat": Buffer.concat([Buffer.from([0x00]), Buffer.from("z".repeat(cap + 1))]),
      "image.png": "not really a png but binary by extension ".repeat(4),
      "small.txt": "fits",
      "empty.txt": "",
    };
    for (const [rel, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, rel), body);

    assert.strictEqual(scanStatus(path.join(dir, "big.txt"), cap), "oversized");
    assert.strictEqual(scanStatus(path.join(dir, "nul.dat"), cap), "binary");
    assert.strictEqual(scanStatus(path.join(dir, "image.png"), cap), "binary");
    assert.strictEqual(scanStatus(path.join(dir, "small.txt"), cap), "text");
    assert.strictEqual(scanStatus(path.join(dir, "empty.txt"), cap), "text");
    assert.strictEqual(scanStatus(path.join(dir, "missing.txt"), cap), "unreadable");

    const listed = listOversizedUnscanned(dir, [...Object.keys(files), "missing.txt"], cap);
    assert.deepStrictEqual(listed.map((o) => o.file), ["big.txt"]);
    assert.strictEqual(listed[0].bytes, cap + 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
