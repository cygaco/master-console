#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");

const { PROJECT, PATHS } = require("../hooks/lib/paths");
const ledger = require("./ledger");
const { readYamlMaybe } = require("./fs");

const APPLY = process.argv.includes("--apply");
const ACTIVE_REGISTRY = PATHS.sprintActiveRegistry;
const RELEASES_DIR = PATHS.sprintReleases;
const VERSION_FILE = path.join(PROJECT, "version.json");
const FRAMEWORK_RELEASES_DIR = path.join(PROJECT, "framework", "releases");
const LEARNINGS_FILE = PATHS.learningsFile;

function fail(msg) {
  process.stderr.write(`backfill-ledgers: ${msg}\n`);
  process.exit(1);
}

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function collectSprintRows() {
  if (!fs.existsSync(ACTIVE_REGISTRY)) {
    fail(`active-sprints registry missing at ${ACTIVE_REGISTRY}`);
  }
  const reg = readYamlMaybe(ACTIVE_REGISTRY);
  if (!reg || !Array.isArray(reg.sprints)) {
    fail("active-sprints registry has no sprints[] array");
  }
  const sorted = [...reg.sprints].sort((a, b) =>
    String(b.id).localeCompare(String(a.id)),
  );
  return sorted.map((s) => ({
    id: s.id,
    title: s.title || "(untitled)",
    status: s.status || "planning",
    startedAt: s.created_at || s.updated_at || "",
    closedAt:
      s.status === "closed" ||
      s.status === "retrospected" ||
      s.status === "abandoned"
        ? s.updated_at || ""
        : "",
  }));
}

function collectReleaseRows() {
  if (!fs.existsSync(RELEASES_DIR)) return [];
  const files = fs
    .readdirSync(RELEASES_DIR)
    .filter((f) => /^RL-\d{8}-\d{3,4}\.yaml$/.test(f));
  const rows = [];
  for (const f of files) {
    const fp = path.join(RELEASES_DIR, f);
    const r = readYamlMaybe(fp);
    if (!r) {
      process.stderr.write(`backfill: skipped malformed ${f}\n`);
      continue;
    }
    if (
      r.status !== "deployed" &&
      r.status !== "prepared" &&
      r.status !== "rolled_back"
    ) {
      continue;
    }
    const changelogPath = r.changelog_path
      ? r.changelog_path
      : fs.existsSync(
            path.join(RELEASES_DIR, `${r.id}.changelog.md`),
          )
        ? `.claude/project/sprint/releases/${r.id}.changelog.md`
        : null;
    rows.push({
      id: r.id,
      sprint: r.sprint,
      status: r.status,
      target: r.deployment_target || r.deployment_environment || "internal-canary",
      deployedAt: r.deployed_at || "",
      changelogPath,
      notes: r.title || r.version || "",
    });
  }
  rows.sort((a, b) => String(b.id).localeCompare(String(a.id)));
  return rows;
}

function collectVersionRows() {
  if (!fs.existsSync(VERSION_FILE)) {
    fail(`version.json missing at ${VERSION_FILE}`);
  }
  const v = readJsonSafe(VERSION_FILE);
  if (!v || !v.version) fail("version.json missing 'version' field");

  const allVersions = [v.version, ...(v.previousVersions || [])];
  const seen = new Set();
  const rows = [];
  const learningCandidates = [];
  for (const ver of allVersions) {
    if (seen.has(ver)) continue;
    seen.add(ver);
    const capsuleJson = path.join(FRAMEWORK_RELEASES_DIR, ver, "release.json");
    const capsuleExists = fs.existsSync(capsuleJson);
    let summary = "";
    let releasedAt = "";
    if (capsuleExists) {
      const cap = readJsonSafe(capsuleJson);
      if (cap) {
        releasedAt = cap.releasedAt || cap.published_at || "";
        summary =
          (cap.notes && String(cap.notes).split(/\.\s/)[0]) ||
          (cap.title && String(cap.title)) ||
          `Release ${ver}.`;
      }
    } else {
      learningCandidates.push(ver);
    }
    if (!summary) {
      summary =
        ver === v.version
          ? (v.notes && String(v.notes).split(/\.\s/)[0]) || `Release ${ver}.`
          : `Historical release ${ver}.`;
    }
    summary = String(summary).replace(/\b(SP|RL|T)-\d{8}-\d{3,4}\b/g, "(internal)");
    if (!summary.trim()) summary = `Release ${ver}.`;
    rows.push({
      version: ver,
      releasedAt,
      summary,
      capsulePath: capsuleExists
        ? `framework/releases/${ver}/release.json`
        : "",
    });
  }
  rows.sort((a, b) => semverCmp(b.version, a.version));
  return { rows, learningCandidates };
}

function semverCmp(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

function writeOrPlan(label, rows, writerFn, keyExtractor, targetFile, anchor) {
  let inserted = 0;
  let alreadyPresent = 0;
  let failed = 0;
  let existingKeys = null;
  if (!APPLY && targetFile && anchor && fs.existsSync(targetFile)) {
    existingKeys = collectExistingKeys(targetFile, anchor);
  }
  for (const row of rows) {
    if (!APPLY) {
      const key = keyExtractor(row);
      if (existingKeys && key && existingKeys.has(key)) {
        process.stdout.write(
          `  already present: ${describeRow(label, row)}\n`,
        );
        alreadyPresent++;
      } else {
        process.stdout.write(`  would insert: ${describeRow(label, row)}\n`);
        inserted++;
      }
      continue;
    }
    const r = writerFn(row);
    if (r.written) {
      inserted++;
    } else if (r.reason === "already-present") {
      alreadyPresent++;
    } else {
      failed++;
      process.stderr.write(
        `  failed: ${describeRow(label, row)} — ${r.reason}\n`,
      );
    }
  }
  return { inserted, alreadyPresent, failed };
}

function collectExistingKeys(file, anchor) {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  const keys = new Set();
  let anchorLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(anchor)) {
      anchorLine = i;
      break;
    }
  }
  if (anchorLine === -1) return keys;
  let sepLine = -1;
  for (let i = anchorLine; i >= 0; i--) {
    if (/^\|\s*-+\s*\|/.test(lines[i])) {
      sepLine = i;
      break;
    }
    if (/^##\s/.test(lines[i])) break;
  }
  if (sepLine === -1) return keys;
  for (let i = sepLine + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) break;
    if (!/^\|/.test(lines[i])) continue;
    const inner = lines[i].trim();
    const cell0 = inner
      .slice(1, inner.endsWith("|") ? -1 : undefined)
      .split("|")[0]
      .trim();
    const m1 = cell0.match(/\[(SP-\d{8}-\d{3,4}|RL-\d{8}-\d{3,4})\]/);
    if (m1) keys.add(m1[1]);
    const m2 = cell0.match(/`(\d+\.\d+\.\d+)`/);
    if (m2) keys.add(m2[1]);
  }
  return keys;
}

function describeRow(label, row) {
  if (label === "sprint") return `${row.id} (${row.status})`;
  if (label === "release") return `${row.id} (${row.status}, sprint=${row.sprint})`;
  if (label === "version") return `${row.version} (${row.releasedAt || "?"})`;
  return JSON.stringify(row);
}

function appendLearningCandidate(missingVersions) {
  if (!missingVersions || missingVersions.length === 0) return;
  const learningsFile = LEARNINGS_FILE;
  const tip =
    `release-capsule-gap-revisit: backfill detected ${missingVersions.length} ` +
    `version(s) listed in version.json#previousVersions[] WITHOUT a capsule ` +
    `on disk under framework/releases/X.Y.Z/. Versions: ${missingVersions.join(", ")}.` +
    ` This is the canonical release-capsule-gap class.`;
  const entry = {
    ts: new Date().toISOString(),
    intent: "audit",
    tip,
    conditions: {
      trigger: "scripts/sprint/backfill-ledgers.js detected missing capsules",
      missing_versions: missingVersions,
      bug_class: "release-capsule-gap",
      fix: "Build the missing capsules retroactively OR delete the version from previousVersions[] if abandoned",
    },
    source: "backfill-ledgers.js",
    status: "candidate",
    score: null,
  };
  try {
    if (!APPLY) {
      process.stdout.write(
        `  would append learning candidate (${missingVersions.length} missing capsule(s))\n`,
      );
      return;
    }
    fs.appendFileSync(learningsFile, JSON.stringify(entry) + "\n", "utf8");
    process.stdout.write(
      `  learning candidate appended for ${missingVersions.length} missing capsule(s)\n`,
    );
  } catch (e) {
    process.stderr.write(
      `  learning-candidate append failed: ${e.message} — fail-open\n`,
    );
  }
}

function emitEvent(data) {
  try {
    const logger = require("../hooks/lib/logger");
    if (logger && typeof logger.log === "function") {
      logger.log("audit", { type: "backfill-ledgers.run", ...data });
    }
  } catch {
  }
}

function main() {
  process.stdout.write(
    `backfill-ledgers (${APPLY ? "apply" : "dry-run"}): scanning sources…\n`,
  );

  const sprintRows = collectSprintRows();
  const releaseRows = collectReleaseRows();
  const { rows: versionRows, learningCandidates } = collectVersionRows();

  process.stdout.write(
    `  found: ${sprintRows.length} sprint rows, ${versionRows.length} version rows, ${releaseRows.length} release rows\n`,
  );

  const ROADMAP = path.join(PROJECT, "ROADMAP.md");
  const RELEASES = path.join(PROJECT, "RELEASES.md");

  process.stdout.write("\nROADMAP.md sprints:\n");
  const sp = writeOrPlan(
    "sprint",
    sprintRows,
    (r) => ledger.appendSprintRow(r),
    (r) => r.id,
    ROADMAP,
    "<!-- ledger:sprints",
  );

  process.stdout.write("\nRELEASES.md versions:\n");
  const ve = writeOrPlan(
    "version",
    versionRows,
    (r) => ledger.appendVersionRow(r),
    (r) => r.version,
    RELEASES,
    "<!-- ledger:versions",
  );

  process.stdout.write("\nRELEASES.md sprints:\n");
  const re = writeOrPlan(
    "release",
    releaseRows,
    (r) => ledger.appendReleaseRow(r),
    (r) => r.id,
    RELEASES,
    "<!-- ledger:releases",
  );

  if (learningCandidates.length > 0) {
    process.stdout.write("\nLearning candidates (capsule gaps):\n");
    appendLearningCandidate(learningCandidates);
  }

  process.stdout.write("\nSummary:\n");
  process.stdout.write(
    `  ROADMAP.md sprints:  ${sp.inserted} ${APPLY ? "inserted" : "would-insert"}, ${sp.alreadyPresent} already present, ${sp.failed} failed\n`,
  );
  process.stdout.write(
    `  RELEASES.md versions: ${ve.inserted} ${APPLY ? "inserted" : "would-insert"}, ${ve.alreadyPresent} already present, ${ve.failed} failed\n`,
  );
  process.stdout.write(
    `  RELEASES.md sprints:  ${re.inserted} ${APPLY ? "inserted" : "would-insert"}, ${re.alreadyPresent} already present, ${re.failed} failed\n`,
  );

  if (!APPLY) {
    process.stdout.write("\nPass --apply to write.\n");
  }

  emitEvent({
    mode: APPLY ? "apply" : "dry-run",
    sprintRowsInserted: sp.inserted,
    versionRowsInserted: ve.inserted,
    releaseRowsInserted: re.inserted,
    alreadyPresent: sp.alreadyPresent + ve.alreadyPresent + re.alreadyPresent,
  });

  return sp.failed + ve.failed + re.failed === 0 ? 0 : 1;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  collectSprintRows,
  collectReleaseRows,
  collectVersionRows,
};
