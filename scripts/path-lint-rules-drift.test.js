"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const LINT = path.join(__dirname, "path-lint.js");
const GENERATED = JSON.parse(fs.readFileSync(path.join(__dirname, "path-lint.rules.generated.json"), "utf8"));
const src = (m) => new RegExp(m, "g").source;

function dump(scriptPath, cwd) {
  const r = spawnSync(process.execPath, [scriptPath, "--dump-rules"], { encoding: "utf8", cwd, env: { ...process.env, CLAUDE_PROJECT_DIR: cwd } });
  assert.strictEqual(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test("embedded fallback rules equal the generated rules wherever both define the same match", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pl-drift-"));
  try {
    const copy = path.join(tmp, "path-lint.js");
    fs.copyFileSync(LINT, copy);
    const embedded = dump(copy, tmp);
    const gen = new Map(GENERATED.critical.map((r) => [src(r.match), r]));
    let shared = 0;
    const drift = [];
    for (const e of embedded) {
      const g = gen.get(e.match);
      if (!g) continue;
      shared++;
      if (e.suggestion !== g.suggestion || e.why !== g.why) drift.push(e.match);
    }
    assert.ok(shared >= 11, `expected the 11 registry-derived rules in both tables, found ${shared}`);
    assert.deepStrictEqual(drift, [], "embedded rules drifted from generated: " + drift.join(", "));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("with the generated file present, a shared rule appears once with the generated wording", () => {
  const eff = dump(LINT, path.resolve(__dirname, ".."));
  const seen = new Map();
  for (const e of eff) seen.set(e.match, (seen.get(e.match) || 0) + 1);
  for (const [m, n] of seen) assert.strictEqual(n, 1, `duplicate rule ${m}`);
  for (const g of GENERATED.critical) {
    const e = eff.find((x) => x.match === src(g.match));
    assert.ok(e, `generated rule missing: ${g.match}`);
    assert.strictEqual(e.why, g.why);
    assert.strictEqual(e.suggestion, g.suggestion);
  }
});
