#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { nextEdId, findDuplicateGenesisIds, findGenesisEvadingUpdates, parseRegister } = require("./ed-registry.js");
const { resolveRegisterText } = require("./next-ed-id.js");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  PASS  " + name); }
  catch (e) { fail++; console.error("  FAIL  " + name + " — " + (e && e.message ? e.message : e)); }
}
const row = (o) => JSON.stringify(o);

t("nextEdId: true max + 1 (not line count)", () => {
  const reg = [row({ id: "ED-999001" }), row({ id: "ED-999005" }), row({ id: "ED-999003" })].join("\n");
  assert.strictEqual(nextEdId(reg), "ED-999006");
});

t("nextEdId: empty register -> ED-001", () => {
  assert.strictEqual(nextEdId(""), "ED-001");
  assert.strictEqual(nextEdId(null), "ED-001");
});

t("nextEdId: line count > max id uses MAX, not the count", () => {
  const reg = [
    row({ id: "ED-999269", status: "open" }),
    row({ id: "ED-999269", amendment: true, status: "open" }),
    row({ id: "ED-999268", status: "open" }),
    row({ id: "ED-999100", record_kind: "amendment", amends: "ED-999100" }),
  ].join("\n");
  assert.strictEqual(nextEdId(reg), "ED-999270");
});

t("nextEdId: malformed line skipped, never crashes/collides", () => {
  const reg = [row({ id: "ED-999002" }), "{ this is not json", row({ id: "ED-999004" })].join("\n");
  assert.strictEqual(nextEdId(reg), "ED-999005");
});

t("an ABSENT register (ENOENT read + ENOENT lstat) -> empty text (=> ED-001), not fail-closed", () => {
  const enoent = (m) => { const e = new Error(m); e.code = "ENOENT"; throw e; };
  const read = () => enoent("no file"); const lstat = () => enoent("no path");
  assert.strictEqual(resolveRegisterText("/nope", read, lstat), "");
  assert.strictEqual(nextEdId(resolveRegisterText("/nope", read, lstat)), "ED-001");
});

t("a DANGLING symlink (read ENOENT via follow, but lstat SUCCEEDS) -> fail-closed, NOT ED-001", () => {
  const read = () => { const e = new Error("target absent"); e.code = "ENOENT"; throw e; };
  const lstat = () => ({ isSymbolicLink: () => true });
  assert.throws(() => resolveRegisterText("/dangling", read, lstat), (err) => err && err.failClosed === true,
    "a dangling-symlink register path EXISTS -> must fail-closed, never mint a colliding ED-001");
});

t("an lstat that fails for a NON-ENOENT reason -> fail-closed (cannot confirm absence)", () => {
  const read = () => { const e = new Error("t"); e.code = "ENOENT"; throw e; };
  const lstat = () => { const e = new Error("perm"); e.code = "EACCES"; throw e; };
  assert.throws(() => resolveRegisterText("/x", read, lstat), (err) => err && err.failClosed === true);
});

t("a PRESENT-but-unreadable register (EACCES/EISDIR) -> throws failClosed (NEVER empty/ED-001)", () => {
  for (const code of ["EACCES", "EISDIR", "EPERM", "EIO"]) {
    const read = () => { const e = new Error(code); e.code = code; throw e; };
    assert.throws(() => resolveRegisterText("/locked", read), (err) => err && err.failClosed === true,
      `${code} must fail-closed, not fall through to an empty register (which would mint a colliding ED-001)`);
  }
});

t("a readable register -> returns its text verbatim", () => {
  const read = () => '{"id":"ED-999042"}';
  assert.strictEqual(resolveRegisterText("/ok", read), '{"id":"ED-999042"}');
  assert.strictEqual(nextEdId(resolveRegisterText("/ok", read)), "ED-999043");
});

t("REAL genesis dup: two distinct debt loggings on one id -> RED", () => {
  const reg = [
    row({ id: "ED-999100", policy: "first debt", status: "open" }),
    row({ id: "ED-999100", policy: "SECOND distinct debt collided on the id", status: "open" }),
  ].join("\n");
  const dups = findDuplicateGenesisIds(reg);
  assert.strictEqual(dups.length, 1, JSON.stringify(dups));
  assert.strictEqual(dups[0].id, "ED-999100");
  assert.strictEqual(dups[0].count, 2);
});

t("BENIGN closure (amendment:true) re-using an id -> GREEN (the false-RED-inverse closed)", () => {
  const reg = [
    row({ id: "ED-999100", policy: "the debt", status: "open" }),
    row({ id: "ED-999100", amendment: true, status: "resolved", note: "closed" }),
  ].join("\n");
  assert.deepStrictEqual(findDuplicateGenesisIds(reg), []);
});

t("BENIGN append-only record_kind/amends row re-using an id -> GREEN", () => {
  const reg = [
    row({ id: "ED-999264", policy: "the debt", status: "open" }),
    row({ id: "ED-999264", record_kind: "amendment", amends: "ED-999264", note: "sub-item resolved" }),
    row({ id: "ED-999264", record_kind: "amendment", amends: "ED-999264", note: "rider" }),
  ].join("\n");
  assert.deepStrictEqual(findDuplicateGenesisIds(reg), []);
});

t("BENIGN thin closure row (status:closed + closure_receipt, NO description) -> GREEN (the thin-closure pattern)", () => {
  const reg = [
    row({ id: "ED-999244", policy: "the debt", source: "x", severity: "medium", status: "open" }),
    row({ id: "ED-999244", status: "closed", closure_receipt: "abc", enforcer: "scripts/x.js", closed_ts: "2026-07-01T00:00:00Z" }),
  ].join("\n");
  assert.deepStrictEqual(findDuplicateGenesisIds(reg), []);
});

t("dup lint: malformed + non-ED lines skipped", () => {
  const reg = [
    row({ id: "ED-999100", policy: "first", status: "open" }),
    "garbage{",
    row({ id: "not-an-ed", policy: "x" }),
    row({ id: "ED-999100", policy: "second collision", status: "open" }),
  ].join("\n");
  const dups = findDuplicateGenesisIds(reg);
  assert.strictEqual(dups.length, 1);
  assert.strictEqual(dups[0].id, "ED-999100");
});

t("parseRegister: genesis discriminator (description=genesis; amendment/record_kind/amends/thin-closure=update)", () => {
  const rows = parseRegister([
    row({ id: "ED-999999001", policy: "the debt", status: "open" }),
    row({ id: "ED-999999001", amendment: true }),
    row({ id: "ED-999999001", record_kind: "amendment" }),
    row({ id: "ED-999999001", amends: "ED-999999001" }),
    row({ id: "ED-999999001", status: "closed", closure_receipt: "x", enforcer: "y" }),
  ].join("\n"));
  assert.deepStrictEqual(rows.map((r) => r.isGenesis), [true, false, false, false, false]);
});

t("update-marked row (amendment:true) carrying a fresh policy -> FLAGGED (evading)", () => {
  const reg = [
    row({ id: "ED-999100", policy: "the debt", status: "open" }),
    row({ id: "ED-999100", amendment: true, policy: "a SECOND distinct debt hiding under an update marker", status: "open" }),
  ].join("\n");
  const ev = findGenesisEvadingUpdates(reg);
  assert.strictEqual(ev.length, 1, JSON.stringify(ev));
  assert.strictEqual(ev[0].id, "ED-999100");
  assert.deepStrictEqual(findDuplicateGenesisIds(reg), []);
});

t("update-marked row (record_kind) carrying a fresh origin -> FLAGGED (evading)", () => {
  const reg = row({ id: "ED-999101", record_kind: "amendment", amends: "ED-999101", origin: "fresh debt text" });
  assert.strictEqual(findGenesisEvadingUpdates(reg).length, 1);
});

t("BENIGN: a legit amendment (note only, no description) -> NOT flagged evading", () => {
  const reg = [
    row({ id: "ED-999100", policy: "the debt", status: "open" }),
    row({ id: "ED-999100", amendment: true, note: "a real update via note", status: "open" }),
  ].join("\n");
  assert.deepStrictEqual(findGenesisEvadingUpdates(reg), []);
});

t("BENIGN: a plain genesis (description, no update marker) -> NOT flagged evading", () => {
  assert.deepStrictEqual(findGenesisEvadingUpdates(row({ id: "ED-999100", policy: "the debt", status: "open" })), []);
});

t("CONTROL: the live register has NO genesis-evading update rows", () => {
  const ROOT = path.join(__dirname, "..", "..");
  let p;
  try { p = require(path.join(ROOT, "scripts", "hooks", "lib", "paths")).PATHS.enforcementDebt; }
  catch { p = ".claude/project/memory/enforcement-debt.jsonl"; }
  if (!path.isAbsolute(p)) p = path.join(ROOT, p);
  let text;
  try { text = fs.readFileSync(p, "utf8"); } catch { console.log("    (skip — register not present)"); return; }
  assert.deepStrictEqual(findGenesisEvadingUpdates(text), [], "live register has genesis-evading updates");
});

t("CONTROL: the live enforcement-debt register has NO genesis dups", () => {
  const ROOT = path.join(__dirname, "..", "..");
  let p;
  try { p = require(path.join(ROOT, "scripts", "hooks", "lib", "paths")).PATHS.enforcementDebt; }
  catch { p = ".claude/project/memory/enforcement-debt.jsonl"; }
  if (!path.isAbsolute(p)) p = path.join(ROOT, p);
  let text;
  try { text = fs.readFileSync(p, "utf8"); } catch { console.log("    (skip — register not present)"); return; }
  const dups = findDuplicateGenesisIds(text);
  assert.deepStrictEqual(dups, [], "the live register has genesis dups: " + JSON.stringify(dups));
});

console.log("\n" + pass + "/" + (pass + fail) + " passed");
process.exit(fail ? 1 : 0);
