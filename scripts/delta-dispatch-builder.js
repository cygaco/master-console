#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const STORE = (() => {
  try {
    return require("./hooks/lib/paths").PATHS.oneshotStore;
  } catch {
    return path.join(__dirname, "..", ".claude", "agents", "president", "_system", "oneshot", "store.json");
  }
})();
const MANIFEST = path.join(ROOT, ".claude", "manifest.json");
const RETROS_DIR = (() => {
  try {
    return require("./hooks/lib/paths").PATHS.oneshotRetros;
  } catch {
    return path.join(__dirname, "..", ".claude", "agents", "president", "_system", "oneshot", "retros");
  }
})();
const DISPATCH_DIR = path.join(ROOT, ".claude", "runtime", "dispatch");

const feature = process.argv[2];
if (!feature) {
  console.error("usage: delta-dispatch-builder.js <feature-id>");
  process.exit(1);
}

fs.mkdirSync(DISPATCH_DIR, { recursive: true });

const store = JSON.parse(fs.readFileSync(STORE, "utf8"));
const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));

const featureEntry = store.features[feature];
if (!featureEntry) {
  console.error(`feature '${feature}' not in store.features`);
  process.exit(1);
}

const files = featureEntry.files || [];
if (files.length === 0) {
  console.error(`feature '${feature}' has no files in store.features[].files`);
  process.exit(1);
}

const featureDir = manifest.build.featureIdToDir?.[feature] || feature;

const retroDirs = (fs.existsSync(RETROS_DIR) ? fs.readdirSync(RETROS_DIR, { withFileTypes: true }) : [])
  .filter((d) => d.isDirectory() && /^\d+(-halted)?$/.test(d.name))
  .map((d) => {
    const m = d.name.match(/^(\d+)(-halted)?$/);
    return { name: d.name, num: parseInt(m[1], 10), halted: !!m[2] };
  })
  .sort((a, b) => b.num - a.num || Number(b.halted) - Number(a.halted));

const latestRetro = retroDirs[0]?.name;
const hygienePath = latestRetro ? path.join(RETROS_DIR, latestRetro, "HYGIENE.md") : null;

const foundationFiles = (manifest.fileOwnership?.foundation || []).slice(0, 30);

const bugDataset = Array.isArray(store.bugDataset) ? store.bugDataset : [];
const featureBugs = bugDataset
  .filter((b) => b && (b.feature === feature || !b.feature))
  .slice(0, 5);
const fallbackBugs = bugDataset.slice(0, 5);
const top5Bugs = (featureBugs.length >= 3 ? featureBugs : fallbackBugs)
  .slice(0, 5)
  .map(
    (b) =>
      `- **${b.id}** — ${b.pattern}${b.feature ? ` (feature: ${b.feature})` : ""}`,
  )
  .join("\n");

let runLabel = "current";
try {
  const runJson = JSON.parse(
    fs.readFileSync(path.join(ROOT, ".claude", "runtime", "run.json"), "utf8"),
  );
  if (runJson && typeof runJson.runNumber === "number") {
    runLabel = `${runJson.runNumber}`;
  }
} catch {
}

const prompt = `feature: ${feature}
You are a Builder Agent in the Delta oneshot build system. Run ${runLabel} on current skeleton branch.

## MANDATORY FIRST ACTION (worktree isolation preamble)
Run \`pwd && git worktree list --porcelain | head\` BEFORE any git command.
Your cwd MUST be inside a \`.worktrees/wt-*\` path. If it resolves to the main project root, halt immediately and return:
\`\`\`json
{"status": "isolation-violation", "cwd": "<resolved-path>"}
\`\`\`
Do not commit, do not checkout, do not branch.

After isolation is verified, ensure you're on branch \`agent/${feature}\`:
\`git checkout -b agent/${feature} 2>/dev/null || git checkout agent/${feature}\`
Commit ONLY to this branch — not to the auto-generated \`agent/wt-*\` name.

## Top-5 Bug Patterns — Do NOT Repeat
${top5Bugs || "- (no bug dataset available)"}

## Your Role
You are stateless. Produce code, commit to branch \`agent/${feature}\`, return JSON envelope.

## File Scope (read-only elsewhere)
You may ONLY modify these files:
${files.map((f) => `- ${f}`).join("\n")}

All other files are read-only. If you need to change a foundation file, emit to stdout:
\`FOUNDATION-UPDATE-REQUEST: <file> — <reason>\`
then halt without modifying it. Foundation list (partial): ${foundationFiles
  .slice(0, 10)
  .join(", ")}…

## Specs to Read (in this order)
0. ${hygienePath ? `${hygienePath.replace(ROOT + path.sep, "").replace(/\\/g, "/")} — cumulative HYGIENE rules, hard-fail on violation` : "(no retro HYGIENE file yet)"}
1. AGENTS.md
2. _requirements/04-features/${featureDir}/PRD.md
3. _requirements/04-features/${featureDir}/STORIES.md
4. _requirements/04-features/${featureDir}/COPY.md (if exists)
5. _requirements/04-features/${featureDir}/INPUTS.md (if exists)
6. _requirements/03-architecture/FLOW_SPEC.md — find your feature's section
7. _requirements/03-architecture/DATA-CONTRACTS.md
8. _requirements/03-architecture/VALIDATION_RULES.md (if feature has user inputs)
9. _requirements/03-architecture/AUTH_SCHEMAS.md (if feature involves auth)
10. _requirements/03-architecture/PROMPT_TEMPLATES.md (if feature calls Claude API)
11. CLAUDE.md

## Build Verification (before commit)
In a TypeScript product, run \`node node_modules/typescript/bin/tsc --noEmit\` — NOT \`npx tsc\`, NOT \`npm run build\`.

## Commit Rules
- Commit to branch \`agent/${feature}\` (you should already be on it — verify via \`git branch --show-current\`)
- Conventional commit message: \`feat(${feature}): implement feature\`
- Do NOT push to origin

## Return Format
After completing (or hitting an issue), output ONE JSON envelope as your final message:
\`\`\`json
{
  "status": "built" | "isolation-violation" | "foundation-update-needed" | "spec-missing" | "build-failed",
  "feature": "${feature}",
  "branch": "agent/${feature}",
  "files_modified": ["<relative-paths>"],
  "commit_sha": "<sha>" | null,
  "typecheck_clean": true | false,
  "notes": "<brief — up to 500 chars>"
}
\`\`\`
`;

const promptFile = path.join(DISPATCH_DIR, `${feature}-prompt.txt`);
fs.writeFileSync(promptFile, prompt);

const REGISTRY = (() => {
  try {
    return require("./hooks/lib/paths").PATHS.orgRoleRegistry;
  } catch {
    return path.join(__dirname, "..", ".claude", "agents", "_org", "role-registry.json");
  }
})();
let doerPin = null;
try {
  const policy = JSON.parse(fs.readFileSync(REGISTRY, "utf8")).model_policy;
  const mp = policy && policy.doers;
  if (mp && typeof mp.model === "string" && /^[A-Za-z0-9._-]+$/.test(mp.model)) {
    doerPin = { model: mp.model, effort: typeof mp.effort === "string" && /^[a-z]+$/.test(mp.effort) ? mp.effort : null };
  }
} catch {
}
const pinFlags = doerPin ? ` --model ${doerPin.model}${doerPin.effort ? ` --effort ${doerPin.effort}` : ""}` : "";

const launchFile = path.join(DISPATCH_DIR, `${feature}-launch.sh`);
const logFile = path.join(DISPATCH_DIR, `${feature}-output.json`);
const launchScript = `#!/bin/bash
# Auto-generated by delta-dispatch-builder.js for feature: ${feature}
set -e
cd "${ROOT.replace(/\\/g, "/")}"

# Worktree isolation per oneshot doctrine: every dispatch gets a fresh worktree.
# Reuse of a prior worktree is forbidden; remove + recreate on every dispatch.
WT_DIR=".worktrees/wt-${feature}"
if [ -d "$WT_DIR" ]; then
  git worktree remove --force "$WT_DIR" 2>/dev/null || rm -rf "$WT_DIR"
fi
git worktree prune 2>/dev/null || true

# Create worktree on agent/${feature} branch FROM CURRENT HEAD (skeleton-testN).
# -B force-resets the branch to HEAD if it exists from a prior run (the old tip is not kept).
git worktree add -B "agent/${feature}" "$WT_DIR" HEAD

cd "$WT_DIR"
if [ -n "$(git status --porcelain)" ]; then
  echo "[${feature}] worktree pollution detected immediately after creation"
  git status --short
  exit 2
fi
set +e
# Dispatch through the bounded wrapper, NOT raw claude -p --agent
# builder (which silently reaps: 0 bytes, no completion record, exit lost). The
# wrapper bounds the call, writes a death record + non-zero exit on a reap, and a
# completion record on success. We are already inside the fresh worktree (PWD),
# so pass it as --worktree (claude runs there; telemetry resolves canonical).
node "${ROOT.replace(/\\/g, "/")}/scripts/dispatch-claude.js" builder "${promptFile.replace(/\\/g, "/")}"${pinFlags} --worktree "$PWD" > "${logFile.replace(/\\/g, "/")}" 2>&1
EXIT=$?
echo "[${feature}] exit=$EXIT (worktree=$WT_DIR)"
exit $EXIT
`;
fs.writeFileSync(launchFile, launchScript);
fs.chmodSync(launchFile, 0o755);

console.log(
  JSON.stringify(
    {
      feature,
      promptFile,
      launchFile,
      logFile,
      files: files.length,
      hygieneRef: hygienePath,
      doerPin: doerPin || "none (no readable doer pin in the role registry)",
      featureDir,
    },
    null,
    2,
  ),
);
