// S-OS-06 r4 lane I8 item 1 — per-OCCURRENCE property test for the six live-unallowed legacy-slug occurrences in
// tests/quarantine.json. Output quotes NO line text (lane C f490592e shape): occurrence ids + booleans only.
"use strict";
const { spawnSync } = require("child_process");
const fs = require("fs");
const root = process.cwd();
const q = JSON.parse(fs.readFileSync("tests/quarantine.json", "utf8"));
const git = (a) => spawnSync("git", a, { cwd: root, encoding: "utf8" });
const at = (rev, p) => git(["cat-file", "-e", `${rev}:${p}`]).status === 0;
const out = [];
let n = 0;
for (const e of q.entries.filter((x) => x.basePath && /warpos/i.test(x.basePath))) {
  n += 1;
  const rewritten = e.basePath.replace(/warpos/gi, "mc");
  const d = git(["-c", "diff.renames=true", "diff", "-M50%", "--name-status", q.base, "HEAD", "--", e.basePath, e.file]);
  const isRename = d.stdout.trim().split(/\r?\n/).some((l) => l.startsWith("R") && l.split("\t")[1] === e.basePath && l.split("\t")[2] === e.file);
  out.push({
    occurrence: `O${n} basePath of entry #${q.entries.indexOf(e)}`,
    A_legacyPathExistsAtBase: at(q.base, e.basePath),
    A_renamedPathExistsAtBase: at(q.base, e.file),
    A_pairLimitedDiffIsRename: isRename,
    A_rewriteEqualsFile_schemaRefuses: rewritten === e.file,
    A_rewriteExistsAtBase: at(q.base, rewritten),
    PROPERTY_A: at(q.base, e.basePath) && !at(q.base, rewritten),
    PROPERTY_B_recordsPreRenamePath: at(q.base, e.basePath) && !at("HEAD", e.basePath),
  });
}
const pol = q.$policy;
const hits = (pol.match(/warpos/gi) || []).length;
const renamed = pol.replace(/WARPOS_/g, "MC_");
const m = renamed.match(/(\w+) became (\w+)/);
out.push({
  occurrence: "O6 $policy codemod-event sentence",
  legacyHitsInPolicy: hits,
  PROPERTY_A: "n/a (not a path; no base-identity function reads it)",
  B_afterRewriteSentenceIsTautology: !!m && m[1] === m[2],
  PROPERTY_B: !!m && m[1] === m[2],
});
console.log(JSON.stringify(out, null, 1));
