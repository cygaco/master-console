"use strict";

const test = require("node:test");
const assert = require("node:assert");

test("MUST-BLOCK: the sample guard refuses an un-attested record", () => {
  const guardBlocks = (rec) => !rec || rec.attested !== true;
  assert.strictEqual(guardBlocks({ attested: false }), true, "an un-attested record MUST be blocked");
  assert.strictEqual(guardBlocks({ attested: true }), false, "an attested record passes the guard");
});
