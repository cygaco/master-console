"use strict";
/**
 * THROWAWAY neuter harness (S-OS-06 r4, R-110). NOT an enforcer change: the enforcer file on
 * disk is never written. At require-time this preload reads scripts/dispatch/dispatch-contract.js,
 * makes an IN-MEMORY neutered copy (also dumped to os.tmpdir for inspection), and compiles that
 * copy under the real filename (so its relative requires + __dirname still resolve).
 *
 *   MC_NEUTER=N1  → neuter ONLY the forbidden_shapes refusal branch
 *   MC_NEUTER=N2  → neuter the forbidden_shapes branch AND the not-in-allowed_shapes branch
 *   MC_NEUTER=N3  → control: neuter ONLY the not-in-allowed_shapes branch
 *
 * Fails LOUDLY if a replacement does not apply — a neuter that silently didn't neuter would
 * make the RED leg vacuous in the other direction.
 */
const Module = require("module");
const path = require("path");
const fs = require("fs");
const os = require("os");
const level = process.env.MC_NEUTER;
const TARGET = path.resolve(__dirname, "..", "..", "..", "..", "..", "scripts", "dispatch", "dispatch-contract.js");
// Anchors include validateDispatch's OWN comment lines, so they cannot match the
// look-alike branch in validateDispatchForClass (first anchor attempt matched 2 — caught by the n!==1 guard).
const FORBID_FROM = "    if (forbidden.includes(shape)) {\n      // (iii) in-process-when-subprocess for build-chain is the canonical case.\n";
const ALLOW_FROM = "    } else if (!allowed.includes(shape)) {\n      // (ii) api-when-CLI lands here:";
const EDITS = {
  N1: [[FORBID_FROM, FORBID_FROM.replace("if (forbidden.includes(shape))", "if (false /* NEUTER N1 */)")]],
  N2: [
    [FORBID_FROM, FORBID_FROM.replace("if (forbidden.includes(shape))", "if (false /* NEUTER N2a */)")],
    [ALLOW_FROM, ALLOW_FROM.replace("else if (!allowed.includes(shape))", "else if (false /* NEUTER N2b */)")],
  ],
  // N3 control: neuter ONLY the not-in-allowed_shapes fallback; forbidden_shapes refusal stays live.
  N3: [[ALLOW_FROM, ALLOW_FROM.replace("else if (!allowed.includes(shape))", "else if (false /* NEUTER N3 */)")]],
};
if (!EDITS[level]) throw new Error(`neuter-preload: MC_NEUTER must be N1, N2 or N3 (got ${level})`);
const origJs = Module._extensions[".js"];
let applied = false;
Module._extensions[".js"] = function (mod, filename) {
  if (path.resolve(filename).toLowerCase() !== TARGET.toLowerCase()) return origJs(mod, filename);
  let src = fs.readFileSync(filename, "utf8");
  for (const [from, to] of EDITS[level]) {
    const n = src.split(from).length - 1;
    if (n !== 1) throw new Error(`neuter-preload ${level}: expected exactly 1 occurrence of ${JSON.stringify(from)}, found ${n}`);
    src = src.replace(from, to);
  }
  fs.writeFileSync(path.join(os.tmpdir(), `dispatch-contract.neutered-${level}.js`), src);
  applied = true;
  process.stderr.write(`[neuter-preload] ${level} applied to in-memory copy of ${filename}\n`);
  mod._compile(src, filename);
};
process.on("exit", () => {
  if (!applied) process.stderr.write(`[neuter-preload] ${level} NOT APPLIED — enforcer never loaded in this process\n`);
});
