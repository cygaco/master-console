"use strict";

const test = require("node:test");
const assert = require("node:assert");

const {
  evaluate,
  extractHeaderTableRows,
  headerTypesFromRows,
  hashRows,
  telemetrySummary,
} = require("./operator-contract-scan.js");

const DOC_ROWS = [
  "| `▶️ RUN THIS` | one thing to run |",
  "| `⚠️ DECISION NEEDED` | a decision |",
  "| `⛔ BLOCKED` | blocked |",
  "| `📌 FYI` | fyi |",
];
const CLAUDE_MD_ROWS = [...DOC_ROWS];
const LIB_HEADER_TYPES = new Set(["RUN THIS", "DECISION NEEDED", "BLOCKED", "FYI"]);
const REGISTRY_ENTRY_CLEAN = {
  enabled: true,
  registrations: [{ event: "Stop", matcher: "" }],
};

function baseArgs(overrides) {
  return {
    fixtureSuiteOk: true,
    registryEntry: REGISTRY_ENTRY_CLEAN,
    settingsHasHook: true,
    docRows: DOC_ROWS,
    claudeMdRows: CLAUDE_MD_ROWS,
    libHeaderTypes: LIB_HEADER_TYPES,
    ...overrides,
  };
}

function kindsOf(findings) {
  return findings.map((f) => f.kind).sort();
}

test("evaluate(): clean inputs -> zero findings", () => {
  const findings = evaluate(baseArgs());
  assert.deepStrictEqual(findings, []);
});

test("evaluate(): planted violation — fixture-suite-red", () => {
  const findings = evaluate(baseArgs({ fixtureSuiteOk: false }));
  assert.deepStrictEqual(kindsOf(findings), ["fixture-suite-red"]);
});

test("evaluate(): planted violation — not-registered (registryEntry null)", () => {
  const findings = evaluate(baseArgs({ registryEntry: null }));
  assert.deepStrictEqual(kindsOf(findings), ["not-registered"]);
});

test("evaluate(): planted violation — disabled-in-registry", () => {
  const findings = evaluate(
    baseArgs({ registryEntry: { enabled: false, registrations: [{ event: "Stop", matcher: "" }] } }),
  );
  assert.deepStrictEqual(kindsOf(findings), ["disabled-in-registry"]);
});

test("evaluate(): planted violation — no-stop-registration", () => {
  const findings = evaluate(
    baseArgs({ registryEntry: { enabled: true, registrations: [{ event: "SessionStart", matcher: "" }] } }),
  );
  assert.deepStrictEqual(kindsOf(findings), ["no-stop-registration"]);
});

test("evaluate(): planted violation — not-compiled", () => {
  const findings = evaluate(baseArgs({ settingsHasHook: false }));
  assert.deepStrictEqual(kindsOf(findings), ["not-compiled"]);
});

test("evaluate(): planted violation — doctrine-table-missing (doc side)", () => {
  const findings = evaluate(baseArgs({ docRows: [] }));
  assert.deepStrictEqual(kindsOf(findings), ["doctrine-table-missing"]);
});

test("evaluate(): planted violation — claude-md-table-missing", () => {
  const findings = evaluate(baseArgs({ claudeMdRows: [] }));
  assert.deepStrictEqual(kindsOf(findings), ["claude-md-table-missing"]);
});

test("evaluate(): planted violation — doctrine-drift (tables disagree)", () => {
  const findings = evaluate(
    baseArgs({ claudeMdRows: ["| `▶️ RUN THIS` | a DIFFERENT description |", ...CLAUDE_MD_ROWS.slice(1)] }),
  );
  assert.deepStrictEqual(kindsOf(findings), ["doctrine-drift"]);
});

test("evaluate(): planted violation — lib-missing-header (lib drops a doctrine header)", () => {
  const findings = evaluate(baseArgs({ libHeaderTypes: new Set(["RUN THIS", "DECISION NEEDED", "BLOCKED"]) }));
  assert.deepStrictEqual(kindsOf(findings), ["lib-missing-header"]);
});

test("evaluate(): planted violation — lib-extra-header (lib covers an undocumented header)", () => {
  const findings = evaluate(baseArgs({ libHeaderTypes: new Set([...LIB_HEADER_TYPES, "ESCALATED"]) }));
  assert.deepStrictEqual(kindsOf(findings), ["lib-extra-header"]);
});

test("evaluate(): multiple simultaneous violations all surface together", () => {
  const findings = evaluate(baseArgs({ fixtureSuiteOk: false, registryEntry: null, settingsHasHook: false }));
  assert.deepStrictEqual(kindsOf(findings), ["fixture-suite-red", "not-compiled", "not-registered"]);
});

test("extractHeaderTableRows: pulls only the Header-table rows, stops at table end", () => {
  const md = [
    "# Doctrine",
    "intro text",
    "| Header | Meaning |",
    "| --- | --- |",
    "| `▶️ RUN THIS` | run it |",
    "| `📌 FYI` | fyi |",
    "",
    "trailing prose, not a table row",
  ].join("\n");
  assert.deepStrictEqual(extractHeaderTableRows(md), [
    "| `▶️ RUN THIS` | run it |",
    "| `📌 FYI` | fyi |",
  ]);
});

test("extractHeaderTableRows: no table present -> empty array", () => {
  assert.deepStrictEqual(extractHeaderTableRows("# Doc\nno table here at all"), []);
});

test("headerTypesFromRows: extracts the TYPE label from each row's first cell", () => {
  const types = headerTypesFromRows([
    "| `▶️ RUN THIS` | run it |",
    "| `⚠️ decision needed` | lowercase still matches |",
  ]);
  assert.deepStrictEqual([...types].sort(), ["DECISION NEEDED", "RUN THIS"]);
});

test("hashRows: identical row sets hash identically, a changed row hashes differently", () => {
  const a = hashRows(["| x | y |"]);
  const b = hashRows(["| x | y |"]);
  const c = hashRows(["| x | z |"]);
  assert.strictEqual(a, b);
  assert.notStrictEqual(a, c);
});

test("telemetrySummary: missing events file -> empty summary, never throws", () => {
  const summary = telemetrySummary("/nonexistent/path/events.jsonl");
  assert.deepStrictEqual(summary, { verdicts: {}, codes: {}, totalEvents: 0 });
});
