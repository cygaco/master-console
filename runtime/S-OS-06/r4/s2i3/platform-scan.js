"use strict";
// Which stored cause lines carry platform- or machine-shaped content (population note for the CI question).
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const d = JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "quarantine.json"), "utf8"));
const pats = { errno4058: /-4058/, drive: /\b[A-Za-z]:\//, appdata: /AppData/i, exeCmd: /\.(cmd|exe)\b/i, eperm: /EPERM|EBUSY/, win32: /win32|windows/i, tmpMask: /<tmp>/, repoMask: /<repo>/, crlf: /\r/, userName: /Vlad/i };
const hits = [];
for (const e of d.entries) for (const l of e.causeLines) { const h = Object.keys(pats).filter((k) => pats[k].test(l)); if (h.length) hits.push({ entry: e.file, kinds: h, line: l.slice(0, 200) }); }
console.log(JSON.stringify(hits, null, 1));
