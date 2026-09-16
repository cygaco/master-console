#!/usr/bin/env node
"use strict";
// S-OS-06 r4 lane I6: per-case byte comparison of the falsifier file's test(...) blocks, lane-I5 head d72fa29e vs the worktree file.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..");
const REL = "tests/regression/S-OS-06/falsify-quarantine-runner.test.js";
const blocks = (src) => {
  const parts = src.split("\ntest(`${FALSIFIER_ID}").slice(1);
  const m = new Map();
  for (const p of parts) {
    const id = (/^ ?(\([a-j]\))?/.exec(p)[1] || "(real-register)");
    m.set(id, crypto.createHash("sha256").update(p.split("\n});\n")[0]).digest("hex").slice(0, 16));
  }
  return m;
};
const before = blocks(execFileSync("git", ["show", `d72fa29e:${REL}`], { cwd: ROOT, encoding: "utf8" }));
const after = blocks(fs.readFileSync(path.join(ROOT, REL), "utf8"));
for (const id of new Set([...before.keys(), ...after.keys()])) {
  const b = before.get(id);
  const a = after.get(id);
  process.stdout.write(`${id.padEnd(16)} before ${b || "(absent)".padEnd(16)} after ${a || "(absent)".padEnd(16)} ${!b ? "NET-ADDED" : a === b ? "BYTE-UNCHANGED" : "CHANGED"}\n`);
}
