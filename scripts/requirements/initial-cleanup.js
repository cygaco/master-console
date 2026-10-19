
const fs = require("fs");
const { STAGED_FILE } = require("./config");

const beforeIdx = process.argv.indexOf("--before");
const BEFORE = beforeIdx !== -1 ? process.argv[beforeIdx + 1] : null;
if (beforeIdx !== -1 && (!BEFORE || !/^\d{4}-\d{2}-\d{2}$/.test(BEFORE) || Number.isNaN(Date.parse(`${BEFORE}T00:00:00Z`)))) {
  console.error("initial-cleanup: --before requires a date YYYY-MM-DD");
  process.exit(2);
}
if (!BEFORE) {
  console.log("initial-cleanup: no --before <YYYY-MM-DD> given; nothing to expire.");
  process.exit(0);
}
const CUTOFF = Date.parse(`${BEFORE}T00:00:00Z`);

if (!fs.existsSync(STAGED_FILE)) {
  console.log("No staged file present; nothing to clean up.");
  process.exit(0);
}

const lines = fs.readFileSync(STAGED_FILE, "utf8").split("\n");
let expired = 0;
let preserved = 0;
let alreadyResolved = 0;
const out = [];
for (const raw of lines) {
  if (!raw.trim()) continue;
  let e;
  try {
    e = JSON.parse(raw);
  } catch {
    out.push(raw);
    continue;
  }
  const isOpen = e.status === "open" || e.status === undefined;
  if (!isOpen) {
    alreadyResolved += 1;
    out.push(JSON.stringify(e));
    continue;
  }
  if (e.riskClass === "C") {
    preserved += 1;
    out.push(JSON.stringify(e));
    continue;
  }
  const at = e.stagedAt
    ? Date.parse(e.stagedAt)
    : e.ts
      ? Date.parse(e.ts)
      : NaN;
  if (Number.isNaN(at) || at >= CUTOFF) {
    out.push(JSON.stringify(e));
    continue;
  }
  e.status = "expired";
  e.resolution = {
    at: new Date().toISOString(),
    by: "initial-cleanup",
    notes: `Entry staged before ${BEFORE} auto-expired per validation-backlog-policy §6.`,
  };
  expired += 1;
  out.push(JSON.stringify(e));
}
fs.writeFileSync(STAGED_FILE, out.join("\n") + "\n");
console.log(
  `initial-cleanup: expired=${expired} preservedClassC=${preserved} alreadyResolved=${alreadyResolved}`,
);
