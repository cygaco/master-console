"use strict";

const { createProductRepo } = require("./new-lib");

const args = process.argv.slice(2);
const fromBriefIdx = args.indexOf("--from-brief");
const fromBrief = fromBriefIdx !== -1 ? args[fromBriefIdx + 1] : null;
const wantGithub = args.includes("--github");
const wantNoScaffold = args.includes("--no-scaffold");
const wantInstall = args.includes("--install");
const parentIdx = args.indexOf("--parent");
const parentDir = parentIdx !== -1 ? args[parentIdx + 1] : null;
if (parentIdx !== -1) {
  let isDir = false;
  try {
    isDir = !!parentDir && !parentDir.startsWith("--") && require("fs").statSync(parentDir).isDirectory();
  } catch { }
  if (!isDir) {
    console.error(`--parent needs an existing folder (got: ${JSON.stringify(parentDir)})`);
    process.exit(2);
  }
}
const slug = args.filter((a, i) => {
  if (a.startsWith("--")) return false;
  if (fromBriefIdx !== -1 && i === fromBriefIdx + 1) return false;
  if (parentIdx !== -1 && i === parentIdx + 1) return false;
  return true;
})[0];

const res = createProductRepo({
  slug,
  parentDir,
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
