#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const os = require("os");
const preflight = require("./preflight");

const KEEP = process.argv.includes("--keep-fixtures");
const QA_ROOT = path.join(
  process.cwd(),
  "runtime",
  "qa-mc-update",
  "clean-0.4.4",
);
const REPO_ROOT = path.resolve(__dirname, "..", "..");

let failures = 0;
function assert(name, ok, extra) {
  const tag = ok ? "PASS" : "FAIL";
  console.log(`  ${tag} ${name}${extra ? " — " + extra : ""}`);
  if (!ok) failures += 1;
}

function buildCleanFixture(root, version) {
  fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "version.json"),
    JSON.stringify(
      {
        $schema: "mc/version/v1",
        name: "mc",
        version,
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(root, ".claude", "framework-manifest.json"),
    JSON.stringify(
      {
        $schema: "mc/framework-manifest/v2",
        version,
        counts: {},
        assets: {},
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(root, ".claude", "framework-installed.json"),
    JSON.stringify(
      {
        $schema: "mc/framework-installed/v2",
        installedVersion: version,
        installedAt: new Date().toISOString(),
        source: REPO_ROOT,
        assets: [],
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(root, ".claude", "paths.json"),
    JSON.stringify(
      {
        $schema: "mc/paths/v4",
        version: 4,
        eventsFile: ".claude/project/events/events.jsonl",
      },
      null,
      2,
    ),
  );
  fs.mkdirSync(path.join(root, ".claude", "project", "events"), {
    recursive: true,
  });
}

console.log(
  "\n[scenario 1] clean-fixture-green (fixture at 0.4.4, --to 0.5.0)",
);

if (fs.existsSync(QA_ROOT))
  fs.rmSync(QA_ROOT, { recursive: true, force: true });
buildCleanFixture(QA_ROOT, "0.4.4");

const r1 = preflight.runPreflight({
  targetRoot: QA_ROOT,
  sourceTreeRoot: REPO_ROOT,
  sourceRoot: REPO_ROOT,
  toVersion: "0.5.0",
  allRed: true,
});

const byName = Object.fromEntries(r1.gates.map((g) => [g.name, g]));
assert(
  "install-baseline GREEN on clean fixture",
  byName["mc-install-baseline"] &&
    byName["mc-install-baseline"].status === "green",
);
assert(
  "capsule-resolvable GREEN against canonical capsule",
  byName["mc-capsule-resolvable"] &&
    byName["mc-capsule-resolvable"].status === "green",
);
assert(
  "version-quorum GREEN when all sources agree",
  byName["mc-version-quorum"] &&
    byName["mc-version-quorum"].status === "green",
);
assert(
  "migration-presence GREEN when capsule has no migrations",
  byName["mc-migration-presence"] &&
    byName["mc-migration-presence"].status === "green",
);

console.log(
  "\n[scenario 2] drift-fixture-red (manifest.json mutated to 0.2.2)",
);

const manifestFile = path.join(QA_ROOT, ".claude", "framework-manifest.json");
const m = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
m.version = "0.2.2";
fs.writeFileSync(manifestFile, JSON.stringify(m, null, 2));

const r2 = preflight.runPreflight({
  targetRoot: QA_ROOT,
  sourceTreeRoot: REPO_ROOT,
  sourceRoot: REPO_ROOT,
  toVersion: "0.5.0",
  allRed: true,
});
const byName2 = Object.fromEntries(r2.gates.map((g) => [g.name, g]));
assert(
  "version-quorum RED on drift fixture",
  byName2["mc-version-quorum"] &&
    byName2["mc-version-quorum"].status === "red",
  byName2["mc-version-quorum"] && byName2["mc-version-quorum"].reason,
);
assert(
  "preflight aggregate ok=false",
  r2.ok === false,
  `ok=${r2.ok} redCount=${r2.redCount}`,
);

const r3 = preflight.runPreflight({
  targetRoot: QA_ROOT,
  sourceTreeRoot: REPO_ROOT,
  sourceRoot: REPO_ROOT,
  toVersion: "0.5.0",
  allRed: true,
  allowVersionDrift: true,
});
const byName3 = Object.fromEntries(r3.gates.map((g) => [g.name, g]));
assert(
  "--allow-version-drift override re-interprets version-quorum as yellow",
  byName3["mc-version-quorum"] &&
    byName3["mc-version-quorum"].status === "yellow" &&
    byName3["mc-version-quorum"].overrideUsed === true,
  byName3["mc-version-quorum"] && byName3["mc-version-quorum"].reason,
);

if (!KEEP) {
  try {
    fs.rmSync(QA_ROOT, { recursive: true, force: true });
  } catch {
  }
}

if (failures > 0) {
  console.log(`\n[bench] ${failures} ASSERTION(S) FAILED`);
  process.exit(1);
} else {
  console.log("\n[bench] ALL CROSS-VERSION REPLAY ASSERTIONS PASSED");
}
