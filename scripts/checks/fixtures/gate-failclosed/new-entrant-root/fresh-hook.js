// Fixture for gate-failclosed-enforcer.test.js.
// A terminal-decision site (catch -> process.exit(0)) that is deliberately
// NOT a member of empty-baseline.json's site_ids. Scanning this fixture
// root must produce exactly one new-entrant finding and a non-zero exit.
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
