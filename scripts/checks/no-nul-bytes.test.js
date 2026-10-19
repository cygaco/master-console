#!/usr/bin/env node
"use strict";

const { harness } = require("./lib/fixture-harness");
const { evaluate } = require("./no-nul-bytes");

const h = harness("no-nul-bytes");

h.pass("clean text files pass", () =>
  evaluate({ files: [{ path: "a.js", buf: Buffer.from("const x = /[`$;&|<>\\s]/;\n", "utf8") }] }));

h.violation("a file with a NUL byte is flagged", () =>
  evaluate({ files: [{ path: "bad.js", buf: Buffer.concat([Buffer.from("const x = /[<>"), Buffer.from([0x00]), Buffer.from("]/;")]) }] }));

h.violation("a NUL anywhere in the buffer is caught", () =>
  evaluate({ files: [{ path: "bad2.js", buf: Buffer.concat([Buffer.from("ok line\n"), Buffer.from([0x00])]) }] }));

h.done();
