// Fixture for gate-failclosed-enforcer.test.js.
// Simulates a site the registry BELIEVES was repaired (expected_finding:
// "absent") but whose code, on this fixture, still reaches a permissive
// outcome on error — the enforcer must flag this as a REGRESSION.
"use strict";

function run(input) {
  try {
    const event = JSON.parse(input);
    return event.decision;
  } catch {
    process.exit(0);
  }
}

module.exports = { run };
