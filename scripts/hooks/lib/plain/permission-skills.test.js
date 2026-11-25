"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const cat = require("./catalog");

const MEMBERS = [
  "session/turbo", "turbo", "permissions/authorized", "scan/turbo-spend",
  "mode/adhoc", "mode/oneshot", "mode/solo", "mode/sprint", "session/resume",
  "hooks/add", "karpathy/run", "mc/uninstall", "mc/setup",
];

function denyOf(text, slug) {
  const r = cat.readFrontmatter(text);
  return cat.denyClassOf([slug], r.fm, r.body, r.flagged, r.values);
}

test("every permission-writing skill that ships is deny-class through its flag", () => {
  let checked = 0;
  for (const m of MEMBERS) {
    const f = path.join(ROOT, ".claude", "commands", ...m.split("/")) + ".md";
    if (!fs.existsSync(f)) continue;
    const d = denyOf(fs.readFileSync(f, "utf8"), m.replace(/\//g, ":"));
    assert.ok(d && d.kind === "flag" && d.flag === "disable-model-invocation", `${m} must carry disable-model-invocation: true (got ${JSON.stringify(d)})`);
    checked++;
  }
  assert.ok(checked > 0, "no member found");
});

test("removing the flag from a member makes it startable again (the check has teeth)", () => {
  const f = path.join(ROOT, ".claude", "commands", "session", "turbo.md");
  if (!fs.existsSync(f)) return;
  const stripped = fs.readFileSync(f, "utf8").replace(/^disable-model-invocation:\s*true\s*\r?\n/m, "");
  assert.strictEqual(denyOf(stripped, "session:turbo"), null, "without the flag /session:turbo has no deny word, so the model could start it");
});
