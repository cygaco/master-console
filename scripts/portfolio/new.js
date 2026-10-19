"use strict";

const { createProductRepo } = require("./new-lib");

const args = process.argv.slice(2);
const fromBriefIdx = args.indexOf("--from-brief");
const fromBrief = fromBriefIdx !== -1 ? args[fromBriefIdx + 1] : null;
const wantGithub = args.includes("--github");
const wantNoScaffold = args.includes("--no-scaffold");
const wantInstall = args.includes("--install");
const slug = args.filter((a, i) => {
  if (a.startsWith("--")) return false;
  if (fromBriefIdx !== -1 && i === fromBriefIdx + 1) return false;
  return true;
})[0];

const res = createProductRepo({
  slug,
  fromBrief,
  wantGithub,
  wantNoScaffold,
  wantInstall,
  log: (m) => console.log(m),
  errorLog: (m) => console.error(m),
});

if (!res.ok) {
  if (res.error) console.error(res.error);
  process.exit(res.code || 1);
}
