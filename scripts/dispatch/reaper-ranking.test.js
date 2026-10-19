#!/usr/bin/env node
"use strict";

const { harness } = require("../checks/lib/fixture-harness");
const {
  SIGNALS,
  SIGNAL_IDS,
  WEAKEST_SIGNAL_ID,
  shouldReap,
  rankedEvidence,
  CONFORMANCE_FIXTURES,
} = require("./reaper-ranking");

const h = harness("reaper-ranking");

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

h.test("exactly 8 ranked signals, rank 1..8, no gaps/dupes", () => {
  assert(SIGNALS.length === 8, `expected 8 signals, got ${SIGNALS.length}`);
  const ranks = SIGNALS.map((s) => s.rank).sort((a, b) => a - b);
  assert(
    JSON.stringify(ranks) === JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8]),
    "ranks must be exactly 1..8 with no gaps or dupes",
  );
  assert(new Set(SIGNAL_IDS).size === 8, "signal ids must be unique");
});
h.test("process_absent is rank 8 (the weakest signal) by construction", () => {
  const weakest = SIGNALS.find((s) => s.id === WEAKEST_SIGNAL_ID);
  assert(weakest, "WEAKEST_SIGNAL_ID must resolve to a real signal");
  assert(weakest.rank === 8, "process_absent must be rank 8, the highest (weakest) rank number");
});

for (const fx of CONFORMANCE_FIXTURES) {
  h.test(`fixture: ${fx.name}`, () => {
    const result = shouldReap(fx.signals);
    assert(
      result.reap === fx.expectReap,
      `expected reap=${fx.expectReap} for ${JSON.stringify(fx.signals)}, got reap=${result.reap} (reason: ${result.reason})`,
    );
    assert(
      Array.isArray(result.rankedEvidence) && result.rankedEvidence.length === 8,
      "rankedEvidence must carry all 8 signals regardless of the decision",
    );
    assert(typeof result.reason === "string" && result.reason.length > 0, "reason must be a non-empty string");
  });
}

h.test("the fixture corpus exercises every one of the 8 signals", () => {
  const covered = new Set();
  for (const fx of CONFORMANCE_FIXTURES) {
    for (const id of Object.keys(fx.signals)) covered.add(id);
  }
  for (const id of SIGNAL_IDS) {
    assert(covered.has(id), `signal '${id}' is never exercised by any fixture in the corpus`);
  }
});

h.violation("process-absence ALONE is refused (never a no-op safety hole)", () => {
  const result = shouldReap({ process_absent: true });
  return { ok: result.reap === true };
});

h.test("process-absence + a stronger signal DOES allow reap (not reject-everything)", () => {
  const result = shouldReap({ process_absent: true, completion_record: true });
  assert(result.reap === true, "corroborated process-absence must be allowed to reap");
});
h.test("EVERY rank 1-7 signal, taken alone, is independently sufficient to reap", () => {
  for (const sig of SIGNALS) {
    if (sig.id === WEAKEST_SIGNAL_ID) continue;
    const result = shouldReap({ [sig.id]: true });
    assert(result.reap === true, `rank ${sig.rank} signal '${sig.id}' alone must be sufficient to reap`);
  }
});

h.test("rankedEvidence is in strict rank order 1..8 regardless of input", () => {
  for (const signals of [{}, { completion_record: true }, { process_absent: true }]) {
    const ev = rankedEvidence(signals);
    assert(ev.length === 8, "rankedEvidence must always carry all 8 signals");
    for (let i = 0; i < ev.length; i++) {
      assert(ev[i].rank === i + 1, `rankedEvidence[${i}] must be rank ${i + 1}`);
    }
  }
});

h.failClosed("shouldReap(null) does not green-light a reap", () => ({
  ok: shouldReap(null).reap === true,
}));
h.failClosed("shouldReap(undefined) does not green-light a reap", () => ({
  ok: shouldReap(undefined).reap === true,
}));
h.failClosed("shouldReap('garbage-string') does not green-light a reap", () => ({
  ok: shouldReap("garbage-string").reap === true,
}));
h.failClosed("shouldReap({}) (empty object) does not green-light a reap", () => ({
  ok: shouldReap({}).reap === true,
}));

h.done();
