#!/usr/bin/env node

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const MODE = process.argv.includes("--apply") ? "apply" : "plan";
const ROOT = path.resolve(__dirname, "..", "..");

function sh(cmd, opts = {}) {
  try {
    return execSync(cmd, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      ...opts,
    }).trim();
  } catch (e) {
    return { error: e.stderr ? e.stderr.toString() : e.message };
  }
}

function parsePorcelain(out) {
  const blocks = out
    .split(/\n\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return blocks.map((blk) => {
    const lines = blk.split("\n");
    const wt = {};
    for (const line of lines) {
      const m = line.match(/^(\S+)\s*(.*)$/);
      if (!m) continue;
      const [, key, val] = m;
      wt[key] = val || true;
    }
    return wt;
  });
}

const SHA_RE = /^[0-9a-f]{40,64}$/;

function isSha(v) {
  return typeof v === "string" && SHA_RE.test(v);
}

function resolveDefaultBranch() {
  for (const name of ["main", "master"]) {
    const sha = sh(`git rev-parse --verify --quiet refs/heads/${name}`);
    if (isSha(sha)) return { sha, label: name };
  }
  const sha = sh("git rev-parse --verify --quiet HEAD");
  if (isSha(sha)) {
    return { sha, label: `none (no main or master); compared against HEAD ${sha.slice(0, 8)}` };
  }
  return null;
}

if (sh("git rev-parse --is-inside-work-tree") !== "true") {
  console.log(`worktree-audit: nothing to audit — ${ROOT} is not inside a git working tree (or git is not available).`);
  process.exit(0);
}

const porcelainOut = sh("git worktree list --porcelain");
if (typeof porcelainOut !== "string") {
  console.error(`worktree-audit: git worktree list failed: ${String(porcelainOut.error).trim().split("\n")[0]}`);
  process.exit(1);
}
const worktrees = parsePorcelain(porcelainOut);

const defaultBranch = resolveDefaultBranch();
const defaultBranchLabel = defaultBranch ? defaultBranch.label : "none (no main or master, and HEAD has no commit)";

const report = {
  generated: new Date().toISOString(),
  total: worktrees.length,
  mode: MODE,
  defaultBranch: defaultBranchLabel,
  buckets: {
    main: [],
    "missing-dir": [],
    "dirty-product": [],
    "detached-unreferenced": [],
    "dirty-runtime-only": [],
    "clean-mergeable": [],
    "clean-orphan": [],
  },
};

const RUNTIME_DIRS = [".claude/runtime/", ".claude/project/events/"];
const RUNTIME_FILES = new Set([
  ".claude/project/decisions/provider-trace.jsonl",
  ".claude/project/maps/system-coherence.graph.json",
  ".claude/project/maps/require-graph.json",
  ".claude/.session-checkpoint.json",
  ".claude/.last-checkpoint",
  ".claude/.agent-result-hashes.json",
  ".claude/.session-start-commit",
  ".claude/.store-lock",
]);

function isRuntimePath(p) {
  return RUNTIME_DIRS.some((dir) => p.startsWith(dir)) || RUNTIME_FILES.has(p);
}

function classifyDirty(statusOut) {
  const lines = statusOut.split("\n").filter((l) => l.trim());
  for (const line of lines) {
    const m = line.match(/^\s*[MDA?!]+\s+(\S.*)$/);
    if (!m || m[1].startsWith('"') || !isRuntimePath(m[1])) {
      return "product";
    }
  }
  return "runtime-only";
}

function refsContaining(sha) {
  if (!isSha(sha)) return null;
  const out = sh(`git for-each-ref --contains ${sha} "--format=%(refname)"`);
  if (typeof out !== "string") return null;
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter((ref) => ref && ref !== "refs/stash");
}

const REMOVABLE_BUCKETS = new Set(["missing-dir", "clean-mergeable", "clean-orphan", "dirty-runtime-only"]);

function place(bucket, entry) {
  if (REMOVABLE_BUCKETS.has(bucket) && !entry.branch) {
    const refs = refsContaining(entry.head);
    if (refs === null || refs.length === 0) {
      entry.refusedFrom = bucket;
      entry.refusedReason =
        refs === null
          ? "detached, and git for-each-ref --contains could not be read for its HEAD commit"
          : "detached, and no branch, tag or other ref except refs/stash contains its HEAD commit";
      report.buckets["detached-unreferenced"].push(entry);
      return;
    }
  }
  report.buckets[bucket].push(entry);
}

for (const wt of worktrees) {
  const wtPath = wt.worktree;
  const branch = wt.branch ? wt.branch.replace(/^refs\/heads\//, "") : null;
  const head = wt.HEAD;

  if (path.resolve(wtPath) === path.resolve(ROOT)) {
    report.buckets.main.push({ path: wtPath, branch, head });
    continue;
  }

  if (!fs.existsSync(wtPath)) {
    place("missing-dir", { path: wtPath, branch, head, missingDir: true });
    continue;
  }

  const statusOut = sh(`git -C "${wtPath}" status --porcelain`);

  if (typeof statusOut !== "string") {
    report.buckets["dirty-product"].push({
      path: wtPath,
      branch,
      head,
      statusUnreadable: true,
      statusError: String(statusOut.error).trim().split("\n")[0].trim(),
    });
    continue;
  }

  const isDirty = statusOut.length > 0;

  if (isDirty) {
    const dirtyLines = statusOut.split("\n").filter((l) => l.trim()).length;
    const dirtyClass = classifyDirty(statusOut);
    const bucket =
      dirtyClass === "runtime-only" ? "dirty-runtime-only" : "dirty-product";
    place(bucket, {
      path: wtPath,
      branch,
      head,
      dirtyLines,
      sample: statusOut.split("\n").slice(0, 5),
    });
    continue;
  }

  const reachable =
    isSha(head) && defaultBranch !== null && sh(`git merge-base ${head} ${defaultBranch.sha}`) === head;

  if (reachable) {
    place("clean-mergeable", { path: wtPath, branch, head });
  } else {
    place("clean-orphan", { path: wtPath, branch, head });
  }
}

const lines = [];
lines.push(`# Worktree audit — ${report.generated}`);
lines.push("");
lines.push(`Total worktrees: ${report.total}`);
lines.push(`Mode: ${report.mode}`);
lines.push(`Default branch: ${report.defaultBranch}`);
lines.push("");
for (const [bucket, items] of Object.entries(report.buckets)) {
  lines.push(`## ${bucket} (${items.length})`);
  lines.push("");
  if (items.length === 0) {
    lines.push("_(none)_");
  } else {
    for (const it of items) {
      lines.push(
        `- \`${it.path}\` — branch: \`${it.branch || "(detached)"}\`, head: \`${it.head?.slice(0, 8) || "?"}\`${it.dirtyLines ? `, dirtyLines: ${it.dirtyLines}` : ""}${it.statusUnreadable ? `, status could not be read: ${it.statusError || "git status failed"}` : ""}${it.refusedReason ? `, refused (would have been ${it.refusedFrom}): ${it.refusedReason}` : ""}`,
      );
    }
  }
  lines.push("");
}

const notesDir = path.join(ROOT, ".claude", "runtime", "notes");
fs.mkdirSync(notesDir, { recursive: true });
const reportFile = path.join(notesDir, "worktree-audit.md");
fs.writeFileSync(reportFile, lines.join("\n"));

console.log(`\nWorktree audit (mode: ${report.mode})`);
console.log(`  Default branch: ${report.defaultBranch}`);
console.log(`  Total: ${report.total}`);
for (const [bucket, items] of Object.entries(report.buckets)) {
  console.log(`  ${bucket}: ${items.length}`);
}
console.log(`\nReport: ${path.relative(ROOT, reportFile)}`);

function tagAndMaybeRemove(wt, { remove }) {
  let tagged = false;
  let removed = false;
  let error = null;
  if (wt.branch) {
    const tagName = `archive/worktree/${wt.branch.replace(/[^a-zA-Z0-9_-]/g, "-")}-${wt.head.slice(0, 8)}`;
    const tagResult = sh(`git tag -f "${tagName}" ${wt.head}`);
    if (typeof tagResult !== "object") tagged = true;
  }
  if (remove) {
    const r = sh(`git worktree remove --force "${wt.path}"`);
    if (typeof r === "object" && r.error) {
      error = r.error;
    } else {
      removed = true;
    }
  }
  return { tagged, removed, error };
}

if (MODE === "apply") {
  let removed = 0;
  let tagged = 0;
  let frozen = 0;
  let failed = 0;

  const refused = report.buckets["detached-unreferenced"];
  const refusedMissing = refused.filter((wt) => wt.missingDir).length;
  if (report.buckets["missing-dir"].length > 0) {
    if (refusedMissing > 0) {
      console.log(
        `\nSkipped git worktree prune: ${refusedMissing} detached-unreferenced worktree(s) with a missing directory would be pruned with the rest, and no ref except refs/stash is known to contain their HEAD commit`,
      );
    } else {
      sh("git worktree prune");
      console.log(`\nPruned missing-dir worktrees`);
    }
  }

  console.log(
    `\nRefusing ${refused.length} detached-unreferenced worktrees (no tag, NOT removed, NOT pruned)...`,
  );
  for (const wt of refused) {
    console.log(`  REFUSED: ${wt.path} — ${wt.refusedReason}`);
  }

  console.log(
    `\nRemoving ${report.buckets["clean-mergeable"].length} clean-mergeable worktrees...`,
  );
  for (const wt of report.buckets["clean-mergeable"]) {
    const r = tagAndMaybeRemove(wt, { remove: true });
    if (r.error) {
      failed++;
      console.log(`  FAIL: ${wt.path} — ${r.error.slice(0, 80)}`);
    } else if (r.removed) {
      removed++;
    }
  }

  console.log(
    `\nTagging + removing ${report.buckets["clean-orphan"].length} clean-orphan worktrees...`,
  );
  for (const wt of report.buckets["clean-orphan"]) {
    const r = tagAndMaybeRemove(wt, { remove: true });
    if (r.tagged) tagged++;
    if (r.error) {
      failed++;
      console.log(`  FAIL: ${wt.path} — ${r.error.slice(0, 80)}`);
    } else if (r.removed) {
      removed++;
    }
  }

  console.log(
    `\nTagging + force-removing ${report.buckets["dirty-runtime-only"].length} dirty-runtime-only worktrees (runtime churn dropped)...`,
  );
  for (const wt of report.buckets["dirty-runtime-only"]) {
    const r = tagAndMaybeRemove(wt, { remove: true });
    if (r.tagged) tagged++;
    if (r.error) {
      failed++;
      console.log(`  FAIL: ${wt.path} — ${r.error.slice(0, 80)}`);
    } else if (r.removed) {
      removed++;
    }
  }

  console.log(
    `\nFreezing ${report.buckets["dirty-product"].length} dirty-product worktrees (tag only, NOT removed)...`,
  );
  for (const wt of report.buckets["dirty-product"]) {
    const r = tagAndMaybeRemove(wt, { remove: false });
    if (r.tagged) tagged++;
    frozen++;
  }

  console.log(`\nApply complete:`);
  console.log(`  Removed: ${removed}`);
  console.log(`  Tagged:  ${tagged}`);
  console.log(`  Frozen:  ${frozen} (dirty-product, kept on disk)`);
  console.log(`  Refused: ${refused.length} (detached-unreferenced, kept)`);
  console.log(`  Failed:  ${failed}`);
  console.log(`Review: ${path.relative(ROOT, reportFile)}`);
}
