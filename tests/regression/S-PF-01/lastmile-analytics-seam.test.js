#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const analytics = require("../../../scripts/bootstrap/lastmile/modules/analytics");
const {
  CANONICAL_EVENTS,
  parseConstStringArray,
} = require("../../../scripts/checks/scaffold-coverage-scan");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const eventsTemplate = fs.readFileSync(
  path.join(REPO_ROOT, "_mc/templates/app-scaffold/src/lib/telemetry/events.ts.tmpl"),
  "utf8",
);

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("analytics-enriches-canonical-base", () => {
  const seamEvents = parseConstStringArray(eventsTemplate, "LIFECYCLE_EVENTS");
  assert.deepStrictEqual(analytics.CANONICAL_BASE_EVENTS, CANONICAL_EVENTS);
  assert.deepStrictEqual(analytics.REQUIRED_EVENTS, seamEvents);
  assert(analytics.ENRICHMENT_EVENTS.includes("activation_definition_change"));
  assert(analytics.ENRICHMENT_EVENTS.includes("complete_payment"));
});

test("analytics-canonical-drift-fails", () => {
  const seamEvents = parseConstStringArray(
    eventsTemplate.replace('"checkout"', '"payment"'),
    "LIFECYCLE_EVENTS",
  );
  assert.notDeepStrictEqual(analytics.CANONICAL_BASE_EVENTS, seamEvents);
});

test("activation-revision-emits-change-event", () => {
  const emitted = [];
  const next = analytics.confirmOrReviseActivationDefinition(
    {
      predicate: "old core action",
      provenance: "derived-at-canon",
      confidence: 0.6,
      derivedFrom: "canon",
    },
    {
      revision: { predicate: "new core action", confidence: 0.8 },
      emit: (event, props) => emitted.push({ event, props }),
    },
  );

  assert.strictEqual(next.predicate, "new core action");
  assert.strictEqual(next.provenance, "revised-at-lastmile");
  assert.strictEqual(next.lastmileConfirmed, true);
  assert.deepStrictEqual(emitted, [
    {
      event: "activation_definition_change",
      props: {
        oldPredicate: "old core action",
        newPredicate: "new core action",
        oldProvenance: "derived-at-canon",
        newProvenance: "revised-at-lastmile",
        oldConfidence: 0.6,
        newConfidence: 0.8,
        oldDerivedFrom: "canon",
        newDerivedFrom: "canon",
        changedFields: ["predicate", "provenance", "confidence"],
      },
    },
  ]);
});

test("activation-revision-emits-confidence-only-change", () => {
  const emitted = [];
  const next = analytics.confirmOrReviseActivationDefinition(
    {
      predicate: "core action",
      provenance: "revised-at-lastmile",
      confidence: 0.6,
      derivedFrom: "canon",
    },
    {
      revision: { confidence: 0.8 },
      emit: (event, props) => emitted.push({ event, props }),
    },
  );

  assert.strictEqual(next.confidence, 0.8);
  assert.deepStrictEqual(emitted, [
    {
      event: "activation_definition_change",
      props: {
        oldPredicate: "core action",
        newPredicate: "core action",
        oldProvenance: "revised-at-lastmile",
        newProvenance: "revised-at-lastmile",
        oldConfidence: 0.6,
        newConfidence: 0.8,
        oldDerivedFrom: "canon",
        newDerivedFrom: "canon",
        changedFields: ["confidence"],
      },
    },
  ]);
});

test("activation-revision-emits-source-only-change", () => {
  const emitted = [];
  const next = analytics.confirmOrReviseActivationDefinition(
    {
      predicate: "core action",
      provenance: "founder-named-at-intake",
      confidence: 0.6,
      derivedFrom: "founder interview",
    },
    {
      revision: { derivedFrom: "lastmile interview" },
      emit: (event, props) => emitted.push({ event, props }),
    },
  );

  assert.strictEqual(next.derivedFrom, "lastmile interview");
  assert.deepStrictEqual(emitted, [
    {
      event: "activation_definition_change",
      props: {
        oldPredicate: "core action",
        newPredicate: "core action",
        oldProvenance: "founder-named-at-intake",
        newProvenance: "revised-at-lastmile",
        oldConfidence: 0.6,
        newConfidence: 0.6,
        oldDerivedFrom: "founder interview",
        newDerivedFrom: "lastmile interview",
        changedFields: ["provenance", "derivedFrom"],
      },
    },
  ]);
});

test("activation-revision-rejects-placeholder-derived-from", () => {
  const emitted = [];
  assert.throws(
    () =>
      analytics.confirmOrReviseActivationDefinition(
        {
          predicate: "old core action",
          provenance: "derived-at-canon",
          confidence: 0.6,
          derivedFrom: "canon",
        },
        {
          revision: { predicate: "new core action", derivedFrom: "{{ACTIVATION_SOURCE}}" },
          emit: (event, props) => emitted.push({ event, props }),
        },
      ),
    /invalid activation definition: derivedFrom must be resolved/,
  );
  assert.deepStrictEqual(emitted, []);
});

test("activation-revision-rejects-placeholder-provenance", () => {
  const emitted = [];
  assert.throws(
    () =>
      analytics.confirmOrReviseActivationDefinition(
        {
          predicate: "old core action",
          provenance: "derived-at-canon",
          confidence: 0.6,
          derivedFrom: "canon",
        },
        {
          revision: { predicate: "new core action", provenance: "{{ACTIVATION_PROVENANCE}}" },
          emit: (event, props) => emitted.push({ event, props }),
        },
      ),
    /invalid activation definition: provenance must be one of the known activation sources/,
  );
  assert.deepStrictEqual(emitted, []);
});

test("activation-revision-rejects-confidence-out-of-range", () => {
  const emitted = [];
  assert.throws(
    () =>
      analytics.confirmOrReviseActivationDefinition(
        {
          predicate: "old core action",
          provenance: "derived-at-canon",
          confidence: 0.6,
          derivedFrom: "canon",
        },
        {
          revision: { predicate: "new core action", confidence: 2 },
          emit: (event, props) => emitted.push({ event, props }),
        },
      ),
    /invalid activation definition: confidence must be numeric between 0 and 1/,
  );
  assert.deepStrictEqual(emitted, []);
});

let pass = 0;
let fail = 0;
for (const t of tests) {
  try {
    t.fn();
    console.log(`PASS ${t.name}`);
    pass++;
  } catch (err) {
    console.error(`FAIL ${t.name}: ${err.stack || err.message}`);
    fail++;
  }
}

console.log(`lastmile-analytics-seam: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
