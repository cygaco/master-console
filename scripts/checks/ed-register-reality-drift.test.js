"use strict";
const assert = require("assert");
const { evaluate } = require("./ed-register-reality-drift");

let pass = 0, fail = 0;
function t(desc, fn) {
  try { fn(); console.log("  PASS  " + desc); pass++; }
  catch (e) { console.error("  FAIL  " + desc + "\n        " + e.message); fail++; }
}

function mkExists(paths) {
  const s = new Set(paths);
  return (rel) => s.has(rel);
}

const row = (o) => JSON.stringify(o);

t("open ED naming a new enforcer that exists WITH a sibling test -> drift finding", () => {
  const text = row({ id: "ED-999900", status: "open", severity: "medium", gap: "no dup detector",
    trigger: "Build scripts/enforcement/foo-lint.js + wire scan:full" });
  const exists = mkExists(["scripts/enforcement/foo-lint.js", "scripts/enforcement/foo-lint.test.js"]);
  const r = evaluate({ registerText: text, fileExists: exists });
  assert.strictEqual(r.findings.length, 1, "expected 1 finding");
  assert.strictEqual(r.findings[0].id, "ED-999900");
  assert.strictEqual(r.findings[0].deliverable, "scripts/enforcement/foo-lint.js");
});

t("open ED naming a file that exists but has NO sibling test -> no false-RED (modify-existing)", () => {
  const text = row({ id: "ED-999901", status: "open", gap: "add a check to scripts/checks/epsilon-liveness.js",
    trigger: "extend scripts/checks/epsilon-liveness.js" });
  const exists = mkExists(["scripts/checks/epsilon-liveness.js"]);
  const r = evaluate({ registerText: text, fileExists: exists });
  assert.strictEqual(r.findings.length, 0, "modify-existing (no new test sibling) must not RED");
});

t("open ED naming an enforcer that does not exist -> no finding", () => {
  const text = row({ id: "ED-999902", status: "open", trigger: "Build scripts/enforcement/not-built.js" });
  const r = evaluate({ registerText: text, fileExists: mkExists([]) });
  assert.strictEqual(r.findings.length, 0);
});

t("closed ED (closure row present) -> not a drift candidate", () => {
  const text = [
    row({ id: "ED-999903", status: "open", gap: "x", trigger: "Build scripts/enforcement/done-lint.js" }),
    row({ id: "ED-999903", status: "closed", closure_receipt: "SP-X", closed_ts: "2026-07-24" }),
  ].join("\n");
  const exists = mkExists(["scripts/enforcement/done-lint.js", "scripts/enforcement/done-lint.test.js"]);
  const r = evaluate({ registerText: text, fileExists: exists });
  assert.strictEqual(r.findings.length, 0, "a closed ED must never be a drift finding");
});

t("malformed register line -> skipped + counted, no crash", () => {
  const text = ["{not json", row({ id: "ED-999904", status: "open", trigger: "Build scripts/enforcement/m.js" })].join("\n");
  const exists = mkExists(["scripts/enforcement/m.js", "scripts/enforcement/m.test.js"]);
  const r = evaluate({ registerText: text, fileExists: exists });
  assert.strictEqual(r.malformedLines, 1, "expected 1 malformed line counted");
  assert.strictEqual(r.findings.length, 1, "the well-formed drift row still flagged");
});

t("two enforcer paths in one open row -> each flagged once (deduped)", () => {
  const text = row({ id: "ED-999905", status: "open",
    trigger: "Build scripts/checks/a.js AND scripts/enforcement/b.js; also mention scripts/checks/a.js again" });
  const exists = mkExists(["scripts/checks/a.js", "scripts/checks/a.test.js", "scripts/enforcement/b.js", "scripts/enforcement/b.test.js"]);
  const r = evaluate({ registerText: text, fileExists: exists });
  assert.strictEqual(r.findings.length, 2, "expected exactly 2 (a + b), a deduped");
});

t("cjs enforcer -> sibling .test.cjs checked", () => {
  const text = row({ id: "ED-999906", status: "open", trigger: "Build scripts/enforcement/c.cjs" });
  const exists = mkExists(["scripts/enforcement/c.cjs", "scripts/enforcement/c.test.cjs"]);
  const r = evaluate({ registerText: text, fileExists: exists });
  assert.strictEqual(r.findings.length, 1);
});

t("open ED with an open-residual marker + shipped enforcer -> excluded (managed partial)", () => {
  const exists = mkExists(["scripts/enforcement/p.js", "scripts/enforcement/p.test.js"]);
  const t1 = row({ id: "ED-999907", status: "open", trigger: "Build scripts/enforcement/p.js", gap: "REMAINING OPEN: sub-item (ii)" });
  assert.strictEqual(evaluate({ registerText: t1, fileExists: exists }).findings.length, 0, "text marker must exclude");
  const t2 = row({ id: "ED-999908", status: "open", trigger: "Build scripts/enforcement/p.js", open_adr: true });
  assert.strictEqual(evaluate({ registerText: t2, fileExists: exists }).findings.length, 0, "open_adr field must exclude");
  const t3 = [
    row({ id: "ED-999909", status: "open", trigger: "Build scripts/enforcement/p.js" }),
    row({ id: "ED-999909", record_kind: "amendment", amends: "ED-999909", note: "sub-item (i) still open" }),
  ].join("\n");
  assert.strictEqual(evaluate({ registerText: t3, fileExists: exists }).findings.length, 0, "amendment residual must exclude");
});

t("CONTROL: live register — no flagged id carries a partial-resolution marker (false-positive class closed)", () => {
  const fs = require("fs"), path = require("path");
  const reg = path.join(__dirname, "..", "..", ".claude", "project", "memory", "enforcement-debt.jsonl");
  let text; try { text = fs.readFileSync(reg, "utf8"); } catch { console.log("        (register absent — skipped)"); return; }
  const realExists = (rel) => { try { return fs.existsSync(path.join(__dirname, "..", "..", rel)); } catch { return false; } };
  const parseRegister = require("../enforcement/ed-registry").parseRegister;
  const r = evaluate({ registerText: text, fileExists: realExists });
  const PARTIAL = /\b(REMAINING OPEN|open_adr|residual|sub-item|partially|partial_enforced|deferred|still open|remains open)\b/i;
  const rows = parseRegister(text);
  for (const f of r.findings) {
    const idText = rows.filter((x) => !x.malformed && x.id === f.id).map((x) => JSON.stringify(x.obj)).join(" ");
    assert.ok(!PARTIAL.test(idText), `flagged id ${f.id} carries a partial marker — false positive not excluded`);
  }
  assert.ok(Array.isArray(r.findings) && typeof r.skippedPartial === "number");
});

t("closed ED whose closure names an enforcer that does NOT exist -> phantom-close candidate", () => {
  const text = [
    row({ id: "ED-999910", status: "open", gap: "x", trigger: "Build scripts/enforcement/ghost.js" }),
    row({ id: "ED-999910", status: "closed", closure_receipt: "SP-Y", enforcer: "scripts/enforcement/ghost.js", closed_ts: "2026-07-24" }),
  ].join("\n");
  const r = evaluate({ registerText: text, fileExists: mkExists([]) });
  assert.strictEqual(r.findings.length, 0, "not a stale-open (it is closed)");
  assert.strictEqual(r.phantomClose.length, 1, "closed+absent -> phantom-close");
  assert.strictEqual(r.phantomClose[0].id, "ED-999910");
});

t("closed ED whose closure names an enforcer that exists -> no phantom-close", () => {
  const text = row({ id: "ED-999911", status: "closed", closure_receipt: "SP-Z", enforcer: "scripts/checks/real.js", closed_ts: "2026-07-24" });
  const r = evaluate({ registerText: text, fileExists: mkExists(["scripts/checks/real.js"]) });
  assert.strictEqual(r.phantomClose.length, 0, "closure naming a present file is healthy");
});

t("open genesis naming an absent target on a still-OPEN ED is not phantom-close", () => {
  const text = row({ id: "ED-999912", status: "open", trigger: "Build scripts/enforcement/todo.js" });
  const r = evaluate({ registerText: text, fileExists: mkExists([]) });
  assert.strictEqual(r.phantomClose.length, 0, "an open ED's not-yet-built target is not a phantom-close");
});

t("open ED with open_adr:false + shipped enforcer -> STILL flagged (false field does not suppress)", () => {
  const text = row({ id: "ED-999920", status: "open", open_adr: false, trigger: "Build scripts/enforcement/f7.js" });
  const exists = mkExists(["scripts/enforcement/f7.js", "scripts/enforcement/f7.test.js"]);
  const r = evaluate({ registerText: text, fileExists: exists });
  assert.strictEqual(r.findings.length, 1, "open_adr:false must not suppress via a JSON-key match");
});
t("partial_enforced:false + shipped enforcer -> STILL flagged", () => {
  const text = row({ id: "ED-999925", status: "open", partial_enforced: false, trigger: "Build scripts/enforcement/f7b.js" });
  const exists = mkExists(["scripts/enforcement/f7b.js", "scripts/enforcement/f7b.test.js"]);
  assert.strictEqual(evaluate({ registerText: text, fileExists: exists }).findings.length, 1);
});
t("open_adr:TRUE (real partial) still suppresses", () => {
  const text = row({ id: "ED-999926", status: "open", open_adr: true, trigger: "Build scripts/enforcement/f7c.js" });
  const exists = mkExists(["scripts/enforcement/f7c.js", "scripts/enforcement/f7c.test.js"]);
  assert.strictEqual(evaluate({ registerText: text, fileExists: exists }).findings.length, 0, "a real open_adr:true partial is excluded");
});

t("resolution-only closure naming an ABSENT enforcer -> phantom-close candidate", () => {
  const text = [
    row({ id: "ED-999921", status: "open", gap: "x", trigger: "Build scripts/checks/f8.js" }),
    row({ id: "ED-999921", resolution: "resolved via scripts/checks/f8.js" }),
  ].join("\n");
  const r = evaluate({ registerText: text, fileExists: mkExists([]) });
  assert.strictEqual(r.findings.length, 0, "resolution => closed, not stale-open");
  assert.strictEqual(r.phantomClose.length, 1, "resolution-only closure + absent enforcer -> phantom-close");
});

t("amendment names the shipped enforcer while genesis has only gap text -> flagged", () => {
  const text = [
    row({ id: "ED-999922", status: "open", gap: "a descriptive gap naming no concrete path" }),
    row({ id: "ED-999922", record_kind: "amendment", amends: "ED-999922", note: "Build scripts/enforcement/f9.js as the enforcer" }),
  ].join("\n");
  const exists = mkExists(["scripts/enforcement/f9.js", "scripts/enforcement/f9.test.js"]);
  const r = evaluate({ registerText: text, fileExists: exists });
  assert.strictEqual(r.findings.length, 1, "amendment-named enforcer must be scanned (all rows), not just genesis");
});

t("open ED that MODIFIES an existing enforcer (file+test exist) -> not flagged", () => {
  const text = row({ id: "ED-999923", status: "open", trigger: "Add a waiter-armed check to scripts/checks/existing.js" });
  const exists = mkExists(["scripts/checks/existing.js", "scripts/checks/existing.test.js"]);
  assert.strictEqual(evaluate({ registerText: text, fileExists: exists }).findings.length, 0, "modify-existing must not false-flag");
});
t("a CREATION context for a new enforcer IS flagged", () => {
  const text = row({ id: "ED-999924", status: "open", trigger: "Build scripts/checks/brandnew.js" });
  const exists = mkExists(["scripts/checks/brandnew.js", "scripts/checks/brandnew.test.js"]);
  assert.strictEqual(evaluate({ registerText: text, fileExists: exists }).findings.length, 1);
});

t("resolution:null does NOT close an open ED (stale-open still detected)", () => {
  const text = row({ id: "ED-999930", status: "open", resolution: null, trigger: "Build scripts/enforcement/c3.js" });
  const exists = mkExists(["scripts/enforcement/c3.js", "scripts/enforcement/c3.test.js"]);
  assert.strictEqual(evaluate({ registerText: text, fileExists: exists }).findings.length, 1, "resolution:null is not a real closure");
});
t("closed_ts:false / closure_receipt:'' do NOT close an ED", () => {
  const text = row({ id: "ED-999931", status: "open", closed_ts: false, closure_receipt: "", trigger: "Build scripts/enforcement/c3b.js" });
  const exists = mkExists(["scripts/enforcement/c3b.js", "scripts/enforcement/c3b.test.js"]);
  assert.strictEqual(evaluate({ registerText: text, fileExists: exists }).findings.length, 1, "false/empty closure fields do not close");
});
t("a NON-EMPTY resolution string DOES close (regression guard)", () => {
  const text = row({ id: "ED-999932", status: "open", resolution: "fixed via scripts/enforcement/c3c.js", trigger: "Build scripts/enforcement/c3c.js" });
  const exists = mkExists(["scripts/enforcement/c3c.js", "scripts/enforcement/c3c.test.js"]);
  assert.strictEqual(evaluate({ registerText: text, fileExists: exists }).findings.length, 0, "a real non-empty resolution closes -> not stale-open");
});

t("'Create a new enforcer in <path>' -> creation (flagged), not modification", () => {
  const text = row({ id: "ED-999933", status: "open", trigger: "Create a new enforcer in scripts/checks/c4.js" });
  const exists = mkExists(["scripts/checks/c4.js", "scripts/checks/c4.test.js"]);
  assert.strictEqual(evaluate({ registerText: text, fileExists: exists }).findings.length, 1, "'create ... in' is creation despite the 'in' preposition");
});
t("'modify <path>' inflection is caught as modification (not flagged)", () => {
  const text = row({ id: "ED-999934", status: "open", trigger: "modify scripts/checks/c4b.js to add a case" });
  const exists = mkExists(["scripts/checks/c4b.js", "scripts/checks/c4b.test.js"]);
  assert.strictEqual(evaluate({ registerText: text, fileExists: exists }).findings.length, 0, "'modify' inflection -> modify-context");
});
t("creation at a LATER occurrence wins over an earlier modify mention -> flagged", () => {
  const text = [
    row({ id: "ED-999935", status: "open", gap: "extend scripts/checks/c4c.js somehow" }),
    row({ id: "ED-999935", record_kind: "amendment", amends: "ED-999935", note: "actually Build scripts/checks/c4c.js as a new enforcer" }),
  ].join("\n");
  const exists = mkExists(["scripts/checks/c4c.js", "scripts/checks/c4c.test.js"]);
  assert.strictEqual(evaluate({ registerText: text, fileExists: exists }).findings.length, 1, "a creation occurrence wins over an earlier modify mention");
});

t("a neutral path mention ('see <path> for reference') with file+test -> NOT flagged", () => {
  const text = row({ id: "ED-999940", status: "open", gap: "some gap", note: "see scripts/checks/r4.js for reference" });
  const exists = mkExists(["scripts/checks/r4.js", "scripts/checks/r4.test.js"]);
  assert.strictEqual(evaluate({ registerText: text, fileExists: exists }).findings.length, 0, "a neutral mention is not a creation candidate");
});
t("a bare path with NO surrounding verb -> NOT flagged (requires positive creation signal)", () => {
  const text = row({ id: "ED-999941", status: "open", trigger: "scripts/checks/r4b.js" });
  const exists = mkExists(["scripts/checks/r4b.js", "scripts/checks/r4b.test.js"]);
  assert.strictEqual(evaluate({ registerText: text, fileExists: exists }).findings.length, 0, "no creation signal -> not flagged");
});

t("'modify the old thing. Build <path>' -> the Build clause is creation (flagged), unaffected by the earlier modify", () => {
  const text = row({ id: "ED-999942", status: "open", gap: "modify the old thing. Build scripts/checks/r3.js as a new enforcer" });
  const exists = mkExists(["scripts/checks/r3.js", "scripts/checks/r3.test.js"]);
  assert.strictEqual(evaluate({ registerText: text, fileExists: exists }).findings.length, 1, "an earlier-clause modify verb must not suppress the creation clause");
});
t("'Build a helper; then wire it into <path>' -> the wire clause is modify (NOT flagged), unaffected by the earlier Build", () => {
  const text = row({ id: "ED-999943", status: "open", gap: "Build a helper; then wire it into scripts/checks/r3b.js" });
  const exists = mkExists(["scripts/checks/r3b.js", "scripts/checks/r3b.test.js"]);
  assert.strictEqual(evaluate({ registerText: text, fileExists: exists }).findings.length, 0, "an earlier-clause Build must not creation-flag a modify occurrence");
});

console.log("");
console.log(pass + "/" + (pass + fail) + " passed" + (fail ? " (" + fail + " FAILED)" : ""));
process.exit(fail ? 1 : 0);
