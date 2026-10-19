#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const STORE = (() => {
  try {
    return require("./hooks/lib/paths").PATHS.oneshotStore;
  } catch {
    return path.join(__dirname, "..", ".claude", "agents", "president", "_system", "oneshot", "store.json");
  }
})();

const [, , feature, commit, typecheckArg, ...noteParts] = process.argv;
if (!feature || !commit) {
  console.error(
    "usage: delta-mark-built.js <feature> <commit-sha> <typecheck-clean> [note]",
  );
  process.exit(1);
}

const typecheckClean = String(typecheckArg).toLowerCase() === "true";
const note = noteParts.join(" ").trim() || undefined;

const s = JSON.parse(fs.readFileSync(STORE, "utf8"));
if (!s.features[feature]) {
  console.error(`feature '${feature}' not in store.features`);
  process.exit(1);
}

function git(cmd) {
  return execSync(cmd, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function envelopeGuard(commitSha, featureName) {
  const violations = [];

  try {
    git(`git cat-file -e ${commitSha}`);
  } catch {
    violations.push({
      type: "PHANTOM_COMMIT_SHA",
      detail: `commit ${commitSha} does not resolve in repo`,
    });
    return violations;
  }

  let filesChanged = 0;
  try {
    const stat = git(`git show --name-only --format= ${commitSha}`);
    filesChanged = stat.split("\n").filter((l) => l.trim()).length;
  } catch (e) {
    violations.push({
      type: "COMMIT_STAT_FAIL",
      detail: `git show failed: ${e.message}`,
    });
    return violations;
  }

  if (filesChanged === 0) {
    violations.push({
      type: "BUILDER_EMPTY_MERGE",
      detail: `commit ${commitSha} changed 0 files`,
      remediation:
        "Do NOT auto-retry. Halt cycle. Manual recovery required; cite EMPTY_MERGE in recovery commit.",
    });
  }

  try {
    const branches = git(`git branch --contains ${commitSha}`);
    if (
      !branches
        .split("\n")
        .some(
          (b) => b.replace(/^[*+]?\s*/, "").trim() === `agent/${featureName}`,
        )
    ) {
      violations.push({
        type: "BRANCH_THEFT",
        detail: `commit ${commitSha} not reachable from agent/${featureName}`,
      });
    }
  } catch {
  }

  return violations;
}

function techIntroGuard(commitSha) {
  const candidates = [];
  let touchesPkg = false;
  try {
    const filesInCommit = git(`git show --name-only --format= ${commitSha}`);
    touchesPkg = filesInCommit
      .split("\n")
      .map((l) => l.trim())
      .includes("package.json");
  } catch {
    return candidates;
  }

  if (!touchesPkg) return candidates;

  try {
    const before = git(`git show ${commitSha}^:package.json`);
    const after = git(`git show ${commitSha}:package.json`);
    const beforePkg = JSON.parse(before);
    const afterPkg = JSON.parse(after);
    const beforeDeps = {
      ...(beforePkg.dependencies || {}),
      ...(beforePkg.devDependencies || {}),
    };
    const afterDeps = {
      ...(afterPkg.dependencies || {}),
      ...(afterPkg.devDependencies || {}),
    };
    for (const dep of Object.keys(afterDeps)) {
      if (!(dep in beforeDeps)) {
        candidates.push({ name: dep, version: afterDeps[dep] });
      }
    }
  } catch {
  }

  return candidates;
}

const violations = envelopeGuard(commit, feature);
const halting = violations.some(
  (v) =>
    v.type === "BUILDER_EMPTY_MERGE" ||
    v.type === "BRANCH_THEFT" ||
    v.type === "PHANTOM_COMMIT_SHA",
);

if (!s.runLog) s.runLog = { entries: [] };
if (!Array.isArray(s.runLog.entries)) s.runLog.entries = [];

if (violations.length > 0) {
  for (const v of violations) {
    s.runLog.entries.push({
      type: v.type,
      feature,
      phase: s.heartbeat?.phase ?? null,
      commit_sha: commit,
      severity: halting ? "CRITICAL" : "WARNING",
      issue: v.detail,
      remediation:
        v.remediation ||
        "Inspect builder dispatch; do not advance cycle until resolved.",
      policy_ref:
        "paths.decisionPolicy §Decision classes (Class C: halt + escalate)",
      timestamp: new Date().toISOString(),
    });
  }
}

if (halting) {
  s.features[feature].status = "escalated";
  fs.writeFileSync(STORE, JSON.stringify(s, null, 2) + "\n");
  console.error(
    `BLOCKED: ${feature} failed builder-envelope guard. Violations:\n${violations
      .map((v) => `  - ${v.type}: ${v.detail}`)
      .join("\n")}`,
  );
  console.error(
    "Feature marked 'escalated'. runLog updated. Halt cycle with reason EMPTY_MERGE.",
  );
  process.exit(2);
}

const newDeps = techIntroGuard(commit);
for (const dep of newDeps) {
  s.runLog.entries.push({
    type: "NEW_DEP_CANDIDATE",
    feature,
    phase: s.heartbeat?.phase ?? null,
    commit_sha: commit,
    dependency: dep.name,
    version: dep.version,
    policy_class: "B",
    policy_ref: "paths.decisionPolicy §Tech-Introduction Rule",
    requirement:
      "ADR required at paths.policy/adr/NNNN-slug.md before next phase. Apply 4-condition rule: (1) current stack cannot solve; (2) benefit > complexity; (3) ADR documented; (4) tests + rollback path.",
    timestamp: new Date().toISOString(),
  });
  console.warn(
    `NEW_DEP_CANDIDATE: ${dep.name}@${dep.version} added by ${feature}. ADR required before next phase (paths.decisionPolicy Class B).`,
  );
}

s.features[feature].status = "built";
s.features[feature].builderCommit = commit;
s.features[feature].typecheckClean = typecheckClean;
if (note) s.features[feature].builderNote = note;
s.features[feature].builtAt = new Date().toISOString();

fs.writeFileSync(STORE, JSON.stringify(s, null, 2) + "\n");
console.log(
  `marked ${feature}=built commit=${commit} typecheck=${typecheckClean}${note ? " (note attached)" : ""}${
    newDeps.length > 0 ? ` (${newDeps.length} NEW_DEP_CANDIDATE flagged)` : ""
  }`,
);
