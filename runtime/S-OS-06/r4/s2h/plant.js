// s2h mutation planter — applies ONE named plant to a throwaway clone (never the worktree).
//   usage: node plant.js <clone> <plant>
"use strict";
const fs = require("fs"), path = require("path");
const [cloneArg, plant] = process.argv.slice(2);
const W = path.resolve(cloneArg);
if (!/[\\/]Temp[\\/]s2h[\\/]/.test(W)) throw new Error("refusing to plant outside the s2h temp dir: " + W);
const RM = path.join(W, "scripts", "panel", "roadmap.js");
function replace(file, a, b) {
  const s = fs.readFileSync(file, "utf8");
  if (!s.includes(a)) throw new Error(`anchor not found in ${file}: ${a}`);
  fs.writeFileSync(file, s.replace(a, b));
}
const PLANTS = {
  // P1: an unreadable register is silently swallowed as count 0 (EISDIR no longer degrades).
  "eisdir-swallow": () =>
    replace(RM, 'const text = fs.readFileSync(file, "utf8");\n  const items = [];',
      'let text; try { text = fs.readFileSync(file, "utf8"); } catch { text = ""; } // PLANT eisdir-swallow\n  const items = [];'),
  // P2: a MISSING register reads as count 0 instead of "section unavailable" (the B4 regression).
  "b4-missing-as-zero": () =>
    replace(RM, "if (debtAbsent && issuesAbsent) {", "if (false && debtAbsent && issuesAbsent) { // PLANT b4-missing-as-zero") ||
    replace(RM, "if (debtAbsent) {", "if (false && debtAbsent) {") ||
    replace(RM, "if (issuesAbsent) {", "if (false && issuesAbsent) {"),
  // P3: the generator's configured source path drifts (the rename-sprint regression class).
  "sprints-path-drift": () =>
    replace(RM, '"sprint", "active-sprints.yaml");', '"sprint", "active-sprints.yml"); // PLANT sprints-path-drift'),
  // Simulates the operator's main checkout: the two gitignored runtime registers present.
  "host-registers": () => {
    const m = path.join(W, ".claude", "project", "memory");
    fs.mkdirSync(m, { recursive: true });
    fs.writeFileSync(path.join(m, "enforcement-debt.jsonl"), JSON.stringify({ id: "ED-HOST-1", status: "open", policy: "host row" }) + "\n");
    fs.writeFileSync(path.join(m, "recurring-issues.jsonl"), JSON.stringify({ id: "RI-HOST-1", status: "open", title: "host row" }) + "\n");
  },
};
if (!PLANTS[plant]) throw new Error("unknown plant " + plant);
PLANTS[plant]();
console.log(`planted ${plant} in ${W}`);
