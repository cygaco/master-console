#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// writeback-roundtrip.test.js — SP-20260614-001 / S-3 (LOAD-BEARING write-back).
//
// Exercises the ACTUAL source of src/lib/readiness/writeback.ts.tmpl — the test
// reads the real template bytes, strips TS-only syntax to plain JS, and loads it
// as a module. So a render-from-model / append / silent-noop implementation in
// the source genuinely FAILS these cases (the AC requirement).
//
//   AC-A6  roundtrip-preserves-annotations-and-flips-one-bit
//   AC-A6b patch-on-current-survives-interleaved-edit
//   AC-A6c unknown-id-no-write
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const TMPL = path.join(
  ROOT,
  "_mc",
  "templates",
  "app-scaffold",
  "src",
  "lib",
  "readiness",
  "writeback.ts.tmpl",
);
const PRODUCER = path.join(ROOT, "scripts", "scaffold", "founders-checklist.js");
const { parseFoundersChecklist } = require(PRODUCER);

let pass = 0;
let fail = 0;
function ok(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    fail++;
    console.log(`FAIL  ${name}\n      ${e.message}`);
  }
}

// ── Load the REAL writeback source as a module ──────────────────────────────
// Strip TS-only syntax (type aliases, param/return annotations, the `import`
// form) so node can evaluate the actual runtime logic of the template.
function loadWriteback() {
  let src = fs.readFileSync(TMPL, "utf8");

  // Drop the multi-line `export type PatchResult = ... ;` declaration.
  src = src.replace(/export type PatchResult[\s\S]*?;\n/, "");
  // Drop the single-line `type LineSegment = { ... };` declaration.
  src = src.replace(/type LineSegment = \{[^}]*\};\n/, "");

  // Rewrite the node:crypto / node:fs imports to CommonJS requires.
  src = src.replace(
    /import \{ randomBytes \} from "node:crypto";/,
    'const { randomBytes } = require("node:crypto");',
  );
  // Rewrite the fs import to LIVE-lookup wrappers so a test can monkey-patch fs.renameSync /
  // fs.writeFileSync at runtime (a plain destructure would freeze the binding at load time and the
  // override wouldn't take). All wrappers delegate to the SAME require("node:fs") singleton the
  // test patches.
  src = src.replace(
    /import \{ existsSync, readFileSync, renameSync, unlinkSync, writeFileSync \} from "node:fs";/,
    [
      'const __wbfs = require("node:fs");',
      "const existsSync = (...a) => __wbfs.existsSync(...a);",
      "const readFileSync = (...a) => __wbfs.readFileSync(...a);",
      "const renameSync = (...a) => __wbfs.renameSync(...a);",
      "const unlinkSync = (...a) => __wbfs.unlinkSync(...a);",
      "const writeFileSync = (...a) => __wbfs.writeFileSync(...a);",
    ].join("\n"),
  );

  // Strip the `: PatchResult` return annotation on the helper + exported fn.
  src = src.replace(/\): PatchResult \{/g, ") {");
  src = src.replace(/function lineMatchesId\(line: string, id: string\): boolean/, "function lineMatchesId(line, id)");
  // Strip splitLinesPreservingEol signature + inner annotations.
  src = src.replace(/function splitLinesPreservingEol\(text: string\): LineSegment\[\]/, "function splitLinesPreservingEol(text)");
  src = src.replace(/const segments: LineSegment\[\] = \[\];/, "const segments = [];");
  src = src.replace(/let m: RegExpExecArray \| null;/, "let m;");

  // Strip param type annotations on patchChecklistItem.
  src = src.replace(/checklistPath: string,/, "checklistPath,");
  src = src.replace(/  id: string,/, "  id,");
  src = src.replace(/  nextChecked: boolean,/, "  nextChecked,");

  // Strip simple local variable annotations (e.g. `let raw: string;`).
  src = src.replace(/\blet raw: string;/, "let raw;");

  // Strip `(e as Error)` casts and `export` keyword for CJS eval.
  src = src.replace(/\(e as Error\)/g, "e");
  src = src.replace(/export function patchChecklistItem/, "function patchChecklistItem");
  src += "\nmodule.exports = { patchChecklistItem };\n";

  const m = new Module(TMPL, module);
  m.filename = TMPL.replace(/\.tmpl$/, ".js");
  m.paths = Module._nodeModulePaths(path.dirname(TMPL));
  m._compile(src, m.filename);
  return m.exports;
}

const { patchChecklistItem } = loadWriteback();

// ── Fixture: a realistic FOUNDERS_CHECKLIST.md with the things parse() drops ──
const FIXTURE = [
  "<!-- mc:founders-checklist v1 -->",
  "schema: mc/founders-checklist/v1",
  "declared_stack_source: _requirements/00-canonical/DATA_AND_ACCOUNTS.md",
  "declared_stack: auth=clerk, payments=stripe, hosting=vercel",
  "",
  "## Human-only launch gates",
  "",
  "<!-- NOTE: payouts owner is Jordan; legal entity filed 2026-05-01 — do not toggle until bank verified -->",
  "- [ ] id=provider.accounts dim=product source=core Create production developer and provider accounts for the declared stack",
  "- [x] id=domain.dns dim=deployment source=core Confirm domain ownership and DNS access",
  "- [ ] id=legal.entity dim=monetization source=core Confirm legal entity, tax profile, and payout owner",
  "- [ ] id=legal.privacy_terms dim=privacy source=core Publish privacy policy and terms",
  "",
  "## Stack-conditional launch gates",
  "",
  "- [ ] id=auth.clerk.production dim=security source=declared-stack:auth=clerk Create Clerk production instance and allowed domains",
  "- [x] id=payments.stripe.identity dim=monetization source=declared-stack:payments=stripe Verify Stripe identity and live-mode payouts",
  "<!-- /mc:founders-checklist -->",
  "",
].join("\n");

function writeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-rt-"));
  const file = path.join(dir, "FOUNDERS_CHECKLIST.md");
  fs.writeFileSync(file, FIXTURE, "utf8");
  return { dir, file };
}

function listTmp(dir) {
  return fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"));
}

// ── AC-A6 ────────────────────────────────────────────────────────────────────
ok("roundtrip-preserves-annotations-and-flips-one-bit", () => {
  const { dir, file } = writeFixture();
  const before = parseFoundersChecklist(fs.readFileSync(file, "utf8"));
  const beforeLines = FIXTURE.split("\n");

  // Toggle exactly one currently-open item.
  const targetId = "provider.accounts";
  const res = patchChecklistItem(file, targetId, true);
  assert.strictEqual(res.ok, true, "patch should succeed");
  assert.strictEqual(res.changed, true, "the target bit should flip");

  const afterRaw = fs.readFileSync(file, "utf8");
  const after = parseFoundersChecklist(afterRaw);
  const afterLines = afterRaw.split("\n");

  // Same items, same order.
  assert.strictEqual(after.items.length, before.items.length, "item count preserved");
  for (let i = 0; i < before.items.length; i += 1) {
    assert.strictEqual(after.items[i].id, before.items[i].id, `item order preserved at ${i}`);
  }

  // EXACTLY ONE flipped checked bit, ZERO other item diffs.
  let flips = 0;
  for (let i = 0; i < before.items.length; i += 1) {
    if (before.items[i].checked !== after.items[i].checked) {
      flips += 1;
      assert.strictEqual(before.items[i].id, targetId, "only the target item flipped");
      assert.strictEqual(after.items[i].checked, true, "target now checked");
    }
  }
  assert.strictEqual(flips, 1, "exactly one bit flipped");

  // Raw line-diff: ONLY one line changed.
  assert.strictEqual(afterLines.length, beforeLines.length, "no lines added/removed");
  const changedLineIdxs = [];
  for (let i = 0; i < beforeLines.length; i += 1) {
    if (beforeLines[i] !== afterLines[i]) changedLineIdxs.push(i);
  }
  assert.strictEqual(changedLineIdxs.length, 1, "exactly one raw line changed");

  // Note, header, metadata, BOTH markers survive byte-for-byte.
  assert.ok(afterRaw.includes("<!-- mc:founders-checklist v1 -->"), "open marker survives");
  assert.ok(afterRaw.includes("<!-- /mc:founders-checklist -->"), "close marker survives");
  assert.ok(afterRaw.includes("## Human-only launch gates"), "section header survives");
  assert.ok(
    afterRaw.includes("<!-- NOTE: payouts owner is Jordan; legal entity filed 2026-05-01"),
    "human note survives byte-for-byte",
  );
  assert.ok(afterRaw.includes("schema: mc/founders-checklist/v1"), "schema metadata survives");
  assert.ok(
    afterRaw.includes("declared_stack: auth=clerk, payments=stripe, hosting=vercel"),
    "declared_stack metadata survives",
  );

  fs.rmSync(dir, { recursive: true, force: true });
});

// ── AC-A6b ─────────────────────────────────────────────────────────────────
ok("patch-on-current-survives-interleaved-edit", () => {
  const { dir, file } = writeFixture();

  // A human edits a DIFFERENT line on disk AFTER render but BEFORE the toggle
  // submit lands. (Simulated by mutating the file in place.)
  const edited = FIXTURE.replace(
    "## Human-only launch gates",
    "## Human-only launch gates (reviewed by Jordan 2026-06-14)",
  );
  fs.writeFileSync(file, edited, "utf8");

  // Now the toggle runs — it must re-read current disk state, not a stale copy.
  const res = patchChecklistItem(file, "legal.entity", true);
  assert.strictEqual(res.ok, true, "patch succeeds on current state");

  const afterRaw = fs.readFileSync(file, "utf8");

  // Human's interleaved edit survives.
  assert.ok(
    afterRaw.includes("## Human-only launch gates (reviewed by Jordan 2026-06-14)"),
    "human's interleaved header edit survives the patch",
  );

  // Toggle landed on the right id.
  const after = parseFoundersChecklist(afterRaw);
  const target = after.items.find((it) => it.id === "legal.entity");
  assert.ok(target, "target item present");
  assert.strictEqual(target.checked, true, "toggle landed on legal.entity");

  // No collateral: provider.accounts stays open, domain.dns stays done.
  assert.strictEqual(after.items.find((it) => it.id === "provider.accounts").checked, false);
  assert.strictEqual(after.items.find((it) => it.id === "domain.dns").checked, true);

  fs.rmSync(dir, { recursive: true, force: true });
});

// ── AC-A6c ─────────────────────────────────────────────────────────────────
ok("unknown-id-no-write", () => {
  const { dir, file } = writeFixture();
  const beforeRaw = fs.readFileSync(file, "utf8");

  const res = patchChecklistItem(file, "does.not.exist", true);

  // Error surfaced, no write.
  assert.strictEqual(res.ok, false, "unknown id returns error");
  assert.ok(/not found/i.test(res.error), "error explains the missing id");

  // Original byte-identical.
  const afterRaw = fs.readFileSync(file, "utf8");
  assert.strictEqual(afterRaw, beforeRaw, "original untouched byte-for-byte");

  // No tmp file left behind.
  assert.deepStrictEqual(listTmp(dir), [], "no stray .tmp file");

  fs.rmSync(dir, { recursive: true, force: true });
});

// ── B4 — duplicate-id fail-closed ────────────────────────────────────────────
// A corrupt checklist with TWO lines carrying the SAME id= marker must NOT be silently
// patched-on-the-first-match. The write-back fails closed: NO write (original byte-identical,
// no tmp left behind) and an error is returned.
ok("duplicate-id-fails-closed-no-write", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-dup-"));
  const file = path.join(dir, "FOUNDERS_CHECKLIST.md");

  // Two lines share id=provider.accounts — a corrupt-checklist signal.
  const dup = [
    "<!-- mc:founders-checklist v1 -->",
    "schema: mc/founders-checklist/v1",
    "",
    "## Human-only launch gates",
    "- [ ] id=provider.accounts dim=product source=core Create production developer accounts",
    "- [x] id=domain.dns dim=deployment source=core Confirm domain ownership and DNS access",
    "- [ ] id=provider.accounts dim=product source=core DUPLICATE id — corrupt checklist",
    "<!-- /mc:founders-checklist -->",
    "",
  ].join("\n");
  fs.writeFileSync(file, dup, "utf8");
  const beforeRaw = fs.readFileSync(file, "utf8");

  const res = patchChecklistItem(file, "provider.accounts", true);

  // Error surfaced, fail-closed.
  assert.strictEqual(res.ok, false, "duplicate id returns an error (fail closed)");
  assert.ok(/duplicate/i.test(res.error), "error explains the duplicate id");

  // NO write: original byte-identical (the first match was NOT silently patched).
  const afterRaw = fs.readFileSync(file, "utf8");
  assert.strictEqual(afterRaw, beforeRaw, "original untouched byte-for-byte — first match not patched");

  // No tmp file left behind.
  assert.deepStrictEqual(listTmp(dir), [], "no stray .tmp file on duplicate-id bail");

  fs.rmSync(dir, { recursive: true, force: true });
});

// ── AC-A6 byte-preservation on MIXED / CRLF EOLs ────────────────────────────
// The producer's .md may be edited on Windows (CRLF), unix (LF), or end up mixed after a
// cross-platform edit. AC-A6 requires EVERY byte preserved except the one toggled glyph — a
// CRLF-normalizing write-back would silently rewrite every \r\n -> \n (or vice-versa) and fail
// this. We build a MIXED-EOL fixture and assert (a) only ONE byte changed and (b) every \r\n and
// every bare-\n is preserved exactly where it was.
ok("crlf-mixed-eol-preserved-only-one-byte-changes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-eol-"));
  const file = path.join(dir, "FOUNDERS_CHECKLIST.md");

  // Deliberately MIXED: header block CRLF, the item lines LF, the close marker CRLF, and a final
  // line with NO trailing newline. The target line itself ends in LF.
  const mixed =
    "<!-- mc:founders-checklist v1 -->\r\n" +
    "schema: mc/founders-checklist/v1\r\n" +
    "\r\n" +
    "## Human-only launch gates\r\n" +
    "<!-- NOTE: keep my CRLF endings intact -->\r\n" +
    "- [ ] id=provider.accounts dim=product source=core Create production accounts\n" +
    "- [x] id=domain.dns dim=deployment source=core Confirm domain ownership\n" +
    "<!-- /mc:founders-checklist -->\r\n" +
    "trailing line with no newline";
  fs.writeFileSync(file, mixed, "utf8");

  const beforeBuf = fs.readFileSync(file);
  const res = patchChecklistItem(file, "provider.accounts", true);
  assert.strictEqual(res.ok, true, "patch should succeed on mixed-EOL file");
  assert.strictEqual(res.changed, true, "target bit should flip");

  const afterBuf = fs.readFileSync(file);

  // (a) EXACTLY one byte differs, and it is the checkbox glyph going from space(0x20) to 'x'(0x78).
  assert.strictEqual(afterBuf.length, beforeBuf.length, "file length unchanged (no EOL rewrite)");
  const diffIdx = [];
  for (let i = 0; i < beforeBuf.length; i += 1) {
    if (beforeBuf[i] !== afterBuf[i]) diffIdx.push(i);
  }
  assert.strictEqual(diffIdx.length, 1, `exactly one byte changed, got ${diffIdx.length}`);
  assert.strictEqual(beforeBuf[diffIdx[0]], 0x20, "changed byte was a space (unchecked glyph)");
  assert.strictEqual(afterBuf[diffIdx[0]], 0x78, "changed byte is now 'x' (checked glyph)");

  // (b) Every EOL preserved byte-for-byte: same count of \r\n and same count of bare \n.
  const countCrlf = (b) => {
    let n = 0;
    for (let i = 0; i + 1 < b.length; i += 1) if (b[i] === 0x0d && b[i + 1] === 0x0a) n += 1;
    return n;
  };
  const countBareLf = (b) => {
    let n = 0;
    for (let i = 0; i < b.length; i += 1) if (b[i] === 0x0a && b[i - 1] !== 0x0d) n += 1;
    return n;
  };
  assert.strictEqual(countCrlf(afterBuf), countCrlf(beforeBuf), "CRLF count preserved");
  assert.strictEqual(countBareLf(afterBuf), countBareLf(beforeBuf), "bare-LF count preserved");

  // (c) No trailing newline was introduced (final line had none).
  assert.notStrictEqual(afterBuf[afterBuf.length - 1], 0x0a, "no trailing newline added");

  // No stray tmp.
  assert.deepStrictEqual(listTmp(dir), [], "no stray .tmp file");

  fs.rmSync(dir, { recursive: true, force: true });
});

// ── AC-A6 / FIX-5c — tmp cleanup on the RENAME failure path ──────────────────
// The atomic write is writeFileSync(tmp) then renameSync(tmp, target). If renameSync throws AFTER
// the tmp is fully written, the tmp MUST be removed — otherwise every failed toggle orphans a tmp
// next to the user's checklist. We force renameSync to throw and assert: result is an error, the
// original file is byte-identical, and ZERO .tmp files remain.
ok("tmp-cleanup-on-rename-error-no-orphan", () => {
  const { dir, file } = writeFixture();
  const beforeRaw = fs.readFileSync(file, "utf8");

  // Make the target path un-renameable-onto by making renameSync fail: point the rename at a
  // directory that exists as a child path is awkward; instead, monkey-patch fs.renameSync for the
  // duration of this call. The writeback module captured renameSync at load via the rewritten
  // `require("node:fs")` — which returns the SAME singleton we patch here, so the override applies.
  const realRename = fs.renameSync;
  let renameAttempted = false;
  fs.renameSync = () => {
    renameAttempted = true;
    const err = new Error("simulated rename failure (EXDEV)");
    err.code = "EXDEV";
    throw err;
  };
  let res;
  try {
    res = patchChecklistItem(file, "provider.accounts", true);
  } finally {
    fs.renameSync = realRename;
  }

  assert.strictEqual(renameAttempted, true, "rename was attempted (tmp was written first)");
  assert.strictEqual(res.ok, false, "rename failure surfaces an error");
  assert.ok(/atomic write failed/i.test(res.error), "error explains the failed atomic write");

  // Original untouched (rename never landed).
  const afterRaw = fs.readFileSync(file, "utf8");
  assert.strictEqual(afterRaw, beforeRaw, "original untouched after failed rename");

  // The fully-written tmp must have been cleaned up — NO orphan.
  assert.deepStrictEqual(listTmp(dir), [], "no orphan .tmp after rename failure");

  fs.rmSync(dir, { recursive: true, force: true });
});

// ── B4 / tmp cleanup FAILURE is SURFACED, not swallowed ──────────────────────
// If renameSync fails AND the tmp unlink (cleanup) ALSO fails, a possible orphan tmp must be
// SURFACED in the returned error — never silently swallowed (the hidden-orphan failure mode).
ok("tmp-cleanup-failure-surfaced-not-swallowed", () => {
  const { dir, file } = writeFixture();
  const realRename = fs.renameSync;
  const realUnlink = fs.unlinkSync;
  fs.renameSync = () => {
    const e = new Error("simulated rename failure (EXDEV)");
    e.code = "EXDEV";
    throw e;
  };
  fs.unlinkSync = () => {
    throw new Error("simulated cleanup failure (EBUSY)");
  };
  let res;
  try {
    res = patchChecklistItem(file, "provider.accounts", true);
  } finally {
    fs.renameSync = realRename;
    fs.unlinkSync = realUnlink;
  }
  assert.strictEqual(res.ok, false, "failure surfaces an error");
  assert.ok(/atomic write failed/i.test(res.error), "error explains the failed atomic write");
  assert.ok(
    /cleanup also failed|orphan/i.test(res.error),
    "the cleanup failure is SURFACED in the error, not swallowed",
  );
  // The forced-failure left a real orphan tmp — remove it with the real unlink.
  for (const f of listTmp(dir)) {
    try {
      realUnlink(path.join(dir, f));
    } catch {
      /* ignore */
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
