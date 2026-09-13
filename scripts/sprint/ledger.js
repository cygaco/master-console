#!/usr/bin/env node

/**
 * scripts/sprint/ledger.js — Shared writer for ROADMAP.md (sprints) and
 * RELEASES.md (versions + sprints).
 *
 * Single entry point for every release-class skill that produces a durable
 * artifact. Callers: plan.js, add-sprint.js, retrospective.js, release.js,
 * scripts/mc/release-canonical.js (and any future /mc:release driver).
 *
 * Contract (from PRD R-2, sprint SP-20260519-001):
 *   - Idempotent: re-writing an existing row returns { written:false,
 *     reason:"already-present" } without modifying disk.
 *   - Fail-open: any error is caught, stderr emits "[ledger] failed: ...",
 *     the call returns { written:false, reason:"fail-open: ..." }, and the
 *     host script continues. Never throws.
 *   - Anchor-marker opt-out: if the target file lacks the section's anchor
 *     comment, the call returns { written:false, reason:"opted-out: no
 *     anchor" } and stderr emits an INFO line (not warn).
 *   - Atomic: writes go to a sibling `.tmp` file then rename-over to survive
 *     concurrent callers (multi-sprint parallelism case from SP-20260512-001).
 *   - Telemetry: every call (success or fail-open) emits a `ledger.write` or
 *     `ledger.fail-open` event via paths.eventsFile (logger.js).
 *
 * Anchors:
 *   ROADMAP.md   <!-- ledger:sprints  -->   (sprints section)
 *   RELEASES.md  <!-- ledger:versions -->   (versions section)
 *   RELEASES.md  <!-- ledger:releases -->   (sprints section in RELEASES.md)
 *
 * Status enums:
 *   sprint:  planning | designing | executing | releasing | closed |
 *            retrospected | abandoned
 *   release: prepared | deployed | rolled_back
 *
 * CLI:
 *   node scripts/sprint/ledger.js --self-test
 *     Runs an in-tempdir round-trip exercising append + update + idempotency
 *     + fail-open + anchor-missing path. Exits 0 on all-pass.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const { PROJECT, PATHS } = require("../hooks/lib/paths");
let logger = null;
try {
  // Fail-open on logger import — telemetry is best-effort.
  logger = require("../hooks/lib/logger");
} catch (_e) {
  logger = null;
}

// ── File targets ───────────────────────────────────────────
// ROADMAP.md and RELEASES.md are repo-root literals (intentional —
// they are not registered in paths.json because they ARE the entry
// points, not derived artifacts).
//
// Callers from outside the current repo (e.g. release-canonical.js
// bumping a sibling canonical clone) pass `{ projectRoot: <abs-path> }`
// as a 2nd arg to override the default PROJECT root. When omitted,
// PROJECT (this repo) wins.

const ROADMAP_FILE = path.join(PROJECT, "ROADMAP.md");
const RELEASES_FILE = path.join(PROJECT, "RELEASES.md");

function resolveTargets(opts) {
  const root = (opts && opts.projectRoot) || PROJECT;
  return {
    roadmap: path.join(root, "ROADMAP.md"),
    releases: path.join(root, "RELEASES.md"),
  };
}

const ANCHORS = {
  roadmapSprints: "<!-- ledger:sprints",
  releasesVersions: "<!-- ledger:versions",
  releasesSprints: "<!-- ledger:releases",
};

const SPRINT_STATUS_ENUM = new Set([
  "planning",
  "designing",
  "executing",
  "releasing",
  "closed",
  "retrospected",
  "abandoned",
]);

const RELEASE_STATUS_ENUM = new Set([
  "prepared",
  "deployed",
  "rolled_back",
]);

const SPRINT_ID_RE = /^(?:SP-\d{8}-\d{3,4}|S-[A-Z0-9]+-\d{2,3})$/;
const RELEASE_ID_RE = /^RL-\d{8}-\d{3,4}$/;
const VERSION_RE = /^\d+\.\d+\.\d+$/;

// ── Public API ────────────────────────────────────────────

function appendSprintRow(args, opts) {
  return failOpen("appendSprintRow", () => {
    const validation = validateSprintRow(args);
    if (validation) return validation;

    const targets = resolveTargets(opts);
    const row = formatSprintRow(args);
    return writeRow({
      file: targets.roadmap,
      anchor: ANCHORS.roadmapSprints,
      row,
      keyCol: 0, // sprint id is in column 0
      key: `[${args.id}]`,
    });
  }, args);
}

function updateSprintRow(args, opts) {
  return failOpen("updateSprintRow", () => {
    if (!args || !args.id) {
      return { written: false, reason: "validation: id required" };
    }
    if (args.status && !SPRINT_STATUS_ENUM.has(args.status)) {
      return {
        written: false,
        reason: `validation: status (got ${args.status})`,
      };
    }
    const targets = resolveTargets(opts);
    return updateRowByKey({
      file: targets.roadmap,
      anchor: ANCHORS.roadmapSprints,
      keyCol: 0,
      key: `[${args.id}]`,
      fieldUpdates: {
        2: args.status, // Status column (index 2)
        4: args.closedAt, // Closed column (index 4)
        5: args.releaseRef
          ? `[${args.releaseRef}](.claude/project/sprint/releases/${args.releaseRef}.yaml)`
          : undefined, // Release column (index 5)
      },
      // If row doesn't exist, fall through to append with whatever we have.
      onMissing: () => {
        if (args.title && args.startedAt) {
          return appendSprintRow(args, opts);
        }
        return {
          written: false,
          reason: "missing-row-and-insufficient-data-for-append",
        };
      },
    });
  }, args);
}

function appendVersionRow(args, opts) {
  return failOpen("appendVersionRow", () => {
    const validation = validateVersionRow(args);
    if (validation) return validation;

    const targets = resolveTargets(opts);
    const capsuleLink = args.capsulePath
      ? `[${path.posix.basename(path.posix.dirname(args.capsulePath.replace(/\\/g, "/")))}/release.json](${args.capsulePath.replace(/\\/g, "/")})`
      : "(missing — known gap)";

    const row = `| \`${args.version}\` | ${args.releasedAt || ""} | ${capsuleLink} | ${args.summary} |`;
    return writeRow({
      file: targets.releases,
      anchor: ANCHORS.releasesVersions,
      row,
      keyCol: 0,
      key: `\`${args.version}\``,
    });
  }, args);
}

function appendReleaseRow(args, opts) {
  return failOpen("appendReleaseRow", () => {
    const validation = validateReleaseRow(args);
    if (validation) return validation;

    const targets = resolveTargets(opts);
    const row = formatReleaseRow(args);
    return writeRow({
      file: targets.releases,
      anchor: ANCHORS.releasesSprints,
      row,
      keyCol: 0,
      key: `[${args.id}]`,
    });
  }, args);
}

function updateReleaseRow(args, opts) {
  return failOpen("updateReleaseRow", () => {
    if (!args || !args.id) {
      return { written: false, reason: "validation: id required" };
    }
    if (args.status && !RELEASE_STATUS_ENUM.has(args.status)) {
      return {
        written: false,
        reason: `validation: status (got ${args.status})`,
      };
    }
    const targets = resolveTargets(opts);
    return updateRowByKey({
      file: targets.releases,
      anchor: ANCHORS.releasesSprints,
      keyCol: 0,
      key: `[${args.id}]`,
      fieldUpdates: {
        2: args.status, // Status column
        4: args.deployedAt, // Deployed column
      },
      onMissing: () => ({
        written: false,
        reason: "missing-row-update-only",
      }),
    });
  }, args);
}

// ── Validators ─────────────────────────────────────────────

function validateSprintRow(args) {
  if (!args) return { written: false, reason: "validation: args required" };
  const { id, title, status, startedAt } = args;
  if (!id || !SPRINT_ID_RE.test(id))
    return { written: false, reason: `validation: id (got ${id})` };
  if (!title)
    return { written: false, reason: "validation: title required" };
  if (!status || !SPRINT_STATUS_ENUM.has(status))
    return {
      written: false,
      reason: `validation: status (got ${status})`,
    };
  if (!startedAt)
    return { written: false, reason: "validation: startedAt required" };
  return null;
}

function validateReleaseRow(args) {
  if (!args) return { written: false, reason: "validation: args required" };
  const { id, sprint, status, target } = args;
  if (!id || !RELEASE_ID_RE.test(id))
    return { written: false, reason: `validation: id (got ${id})` };
  if (!sprint || !SPRINT_ID_RE.test(sprint))
    return { written: false, reason: `validation: sprint (got ${sprint})` };
  if (!status || !RELEASE_STATUS_ENUM.has(status))
    return {
      written: false,
      reason: `validation: status (got ${status})`,
    };
  if (!target)
    return { written: false, reason: "validation: target required" };
  return null;
}

function validateVersionRow(args) {
  if (!args) return { written: false, reason: "validation: args required" };
  const { version, summary } = args;
  if (!version || !VERSION_RE.test(version))
    return { written: false, reason: `validation: version (got ${version})` };
  if (!summary || typeof summary !== "string" || summary.trim().length === 0)
    return { written: false, reason: "validation: summary required" };
  // Downstream-readable rule (AC-8.2): summary must not contain internal ids.
  if (/\b(SP|RL|T)-\d{8}-/.test(summary))
    return {
      written: false,
      reason:
        "downstream-readable: summary contains internal artifact id (SP-/RL-/T-)",
    };
  return null;
}

// ── Row formatters ─────────────────────────────────────────

function formatSprintRow(args) {
  const releaseCell = args.releaseRef
    ? `[${args.releaseRef}](.claude/project/sprint/releases/${args.releaseRef}.yaml)`
    : "";
  return `| [${args.id}](.claude/project/sprint/sprints/${args.id}/) | ${escapeCell(args.title)} | ${args.status} | ${args.startedAt} | ${args.closedAt || ""} | ${releaseCell} |`;
}

function formatReleaseRow(args) {
  const changelogLink = args.changelogPath
    ? `[changelog](${args.changelogPath.replace(/\\/g, "/")})`
    : "";
  const releaseLink = `[${args.id}](.claude/project/sprint/releases/${args.id}.yaml)`;
  const sprintLink = `[${args.sprint}](.claude/project/sprint/sprints/${args.sprint}/)`;
  const notesCell = args.notes
    ? `${escapeCell(args.notes)} ${changelogLink}`.trim()
    : changelogLink;
  return `| ${releaseLink} | ${sprintLink} | ${args.status} | ${args.target} | ${args.deployedAt || ""} | ${notesCell} |`;
}

function escapeCell(s) {
  if (!s) return "";
  // Pipes and newlines break markdown tables.
  return String(s).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

// ── Core write paths ───────────────────────────────────────

function writeRow({ file, anchor, row, keyCol, key }) {
  if (!fs.existsSync(file)) {
    return {
      written: false,
      reason: `opted-out: target ${path.basename(file)} missing`,
    };
  }
  const text = fs.readFileSync(file, "utf8");
  const anchorIdx = text.indexOf(anchor);
  if (anchorIdx === -1) {
    process.stderr.write(
      `[ledger] info: anchor ${anchor} not found in ${path.basename(file)} — opted out\n`,
    );
    return { written: false, reason: "opted-out: no anchor" };
  }

  // Idempotency: scan all rows in this section for the key.
  // Section boundary = from anchor line backwards to nearest "| ---" separator,
  // forward to end-of-file or first blank line followed by H2.
  const lines = text.split(/\r?\n/);
  const anchorLine = findLineIndex(lines, anchor);
  if (anchorLine === -1) {
    return { written: false, reason: "opted-out: no anchor (post-split)" };
  }

  // Find separator line (| --- | ... |) above the anchor.
  let sepLine = -1;
  for (let i = anchorLine; i >= 0; i--) {
    if (/^\|\s*-+\s*\|/.test(lines[i])) {
      sepLine = i;
      break;
    }
    if (/^##\s/.test(lines[i])) break; // bail at section header
  }
  if (sepLine === -1) {
    return {
      written: false,
      reason: "opted-out: table separator above anchor not found",
    };
  }

  // Rows live between sepLine+1 and the next blank line OR ## heading.
  let rowsEnd = lines.length;
  for (let i = sepLine + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      rowsEnd = i;
      break;
    }
  }

  // Existing rows are table rows (start with |) excluding the anchor comment.
  const rowLines = [];
  for (let i = sepLine + 1; i < rowsEnd; i++) {
    if (/^\|/.test(lines[i])) rowLines.push({ idx: i, content: lines[i] });
  }

  // Check for duplicate by key.
  const dupe = rowLines.find((r) => {
    const cols = parseRow(r.content);
    return cols[keyCol] && cols[keyCol].includes(key);
  });
  if (dupe) {
    return {
      written: false,
      reason: "already-present",
      file,
      row: dupe.content,
    };
  }

  // Insert new row at top of rows section (newest first).
  const insertAt = sepLine + 1;
  const newLines = [
    ...lines.slice(0, insertAt),
    row,
    ...lines.slice(insertAt),
  ];
  atomicWrite(file, newLines.join("\n"));
  emitEvent("ledger.write", {
    fn: "writeRow",
    file: path.basename(file),
    anchor,
    key,
  });
  return { written: true, file, row };
}

function updateRowByKey({ file, anchor, keyCol, key, fieldUpdates, onMissing }) {
  if (!fs.existsSync(file)) {
    if (onMissing) return onMissing();
    return {
      written: false,
      reason: `opted-out: target ${path.basename(file)} missing`,
    };
  }
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  const anchorLine = findLineIndex(lines, anchor);
  if (anchorLine === -1) {
    return { written: false, reason: "opted-out: no anchor" };
  }
  let sepLine = -1;
  for (let i = anchorLine; i >= 0; i--) {
    if (/^\|\s*-+\s*\|/.test(lines[i])) {
      sepLine = i;
      break;
    }
    if (/^##\s/.test(lines[i])) break;
  }
  if (sepLine === -1) {
    return { written: false, reason: "opted-out: no table separator" };
  }
  let rowsEnd = lines.length;
  for (let i = sepLine + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      rowsEnd = i;
      break;
    }
  }
  for (let i = sepLine + 1; i < rowsEnd; i++) {
    if (!/^\|/.test(lines[i])) continue;
    const cols = parseRow(lines[i]);
    if (!cols[keyCol] || !cols[keyCol].includes(key)) continue;

    let changed = false;
    for (const [idxStr, value] of Object.entries(fieldUpdates)) {
      if (value === undefined || value === null) continue;
      const idx = Number(idxStr);
      if (cols[idx] !== value) {
        cols[idx] = String(value);
        changed = true;
      }
    }
    if (!changed) {
      return { written: false, reason: "already-present" };
    }
    lines[i] = serializeRow(cols);
    atomicWrite(file, lines.join("\n"));
    emitEvent("ledger.write", {
      fn: "updateRowByKey",
      file: path.basename(file),
      anchor,
      key,
    });
    return { written: true, file, row: lines[i] };
  }
  if (onMissing) return onMissing();
  return { written: false, reason: "row-not-found" };
}

function parseRow(line) {
  // | a | b | c | -> ["a", "b", "c"]
  // Handles leading + trailing pipes and trimming. Doesn't handle escaped pipes
  // (we escape them at write time).
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return [];
  const inner = trimmed.slice(1, trimmed.endsWith("|") ? -1 : undefined);
  return inner.split("|").map((c) => c.trim());
}

function serializeRow(cols) {
  return `| ${cols.map((c) => c).join(" | ")} |`;
}

function findLineIndex(lines, needle) {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(needle)) return i;
  }
  return -1;
}

function atomicWrite(file, content) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, file);
}

// ── Fail-open wrapper ──────────────────────────────────────

function failOpen(fnName, work, args) {
  try {
    const result = work();
    return result;
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    process.stderr.write(`[ledger] failed: ${fnName}: ${msg}\n`);
    emitEvent("ledger.fail-open", {
      fn: fnName,
      errorMessage: msg,
      args: safeStringify(args),
    });
    return { written: false, reason: `fail-open: ${msg}` };
  }
}

function safeStringify(v) {
  try {
    return JSON.stringify(v);
  } catch (_e) {
    return String(v);
  }
}

function emitEvent(cat, data) {
  if (!logger || typeof logger.log !== "function") return;
  try {
    logger.log("audit", { type: cat, ...data });
  } catch (_e) {
    // best-effort
  }
}

// ── --self-test entrypoint ─────────────────────────────────

function selfTest() {
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-selftest-"));
  const roadmap = path.join(tmpdir, "ROADMAP.md");
  const releases = path.join(tmpdir, "RELEASES.md");

  // Seed fixtures with anchor markers.
  fs.writeFileSync(
    roadmap,
    [
      "# MC Roadmap",
      "",
      "## Sprints",
      "",
      "| Sprint | Title | Status | Started | Closed | Release |",
      "|---|---|---|---|---|---|",
      "<!-- ledger:sprints — selftest -->",
      "",
      "## Phase 1",
      "",
      "- existing backlog item",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
    releases,
    [
      "# MC Releases",
      "",
      "## Versions",
      "",
      "| Version | Released | Capsule | Summary |",
      "|---|---|---|---|",
      "<!-- ledger:versions — selftest -->",
      "",
      "## Sprints",
      "",
      "| Release | Sprint | Status | Target | Deployed | Notes |",
      "|---|---|---|---|---|---|",
      "<!-- ledger:releases — selftest -->",
      "",
    ].join("\n"),
    "utf8",
  );

  // Redirect ROADMAP_FILE / RELEASES_FILE for this test by monkey-patching
  // via require cache trick — but simpler: call internal writeRow directly.
  const results = [];
  function check(label, fn) {
    try {
      const r = fn();
      results.push({ label, ok: true, r });
    } catch (e) {
      results.push({ label, ok: false, err: e.message });
    }
  }

  // 1. appendSprintRow happy path.
  check("appendSprintRow happy", () => {
    const r = writeRow({
      file: roadmap,
      anchor: ANCHORS.roadmapSprints,
      row: "| [SP-99999999-001](.) | Self-test sprint | planning | 2026-01-01T00:00:00Z |  |  |",
      keyCol: 0,
      key: "[SP-99999999-001]",
    });
    if (!r.written) throw new Error("expected written:true, got " + JSON.stringify(r));
    return r;
  });

  // 2. Idempotency: same key again.
  check("appendSprintRow idempotency", () => {
    const r = writeRow({
      file: roadmap,
      anchor: ANCHORS.roadmapSprints,
      row: "| [SP-99999999-001](.) | Self-test sprint | planning | 2026-01-01T00:00:00Z |  |  |",
      keyCol: 0,
      key: "[SP-99999999-001]",
    });
    if (r.written) throw new Error("expected written:false, got " + JSON.stringify(r));
    if (r.reason !== "already-present")
      throw new Error("expected reason:already-present, got " + r.reason);
    return r;
  });

  // 3. updateRowByKey — change status.
  check("updateRowByKey status change", () => {
    const r = updateRowByKey({
      file: roadmap,
      anchor: ANCHORS.roadmapSprints,
      keyCol: 0,
      key: "[SP-99999999-001]",
      fieldUpdates: { 2: "designing" },
      onMissing: () => ({ written: false, reason: "missing" }),
    });
    if (!r.written) throw new Error("expected written:true, got " + JSON.stringify(r));
    return r;
  });

  // 4. Anchor missing → opted-out.
  check("anchor-missing opt-out", () => {
    const r = writeRow({
      file: roadmap,
      anchor: "<!-- ledger:nonexistent",
      row: "| irrelevant |",
      keyCol: 0,
      key: "[X]",
    });
    if (r.written) throw new Error("expected written:false");
    if (!r.reason.startsWith("opted-out"))
      throw new Error("expected opted-out, got " + r.reason);
    return r;
  });

  // 5. Validation: bad sprint id.
  check("validation: bad sprint id", () => {
    const r = validateSprintRow({
      id: "NOT-A-SPRINT",
      title: "x",
      status: "planning",
      startedAt: "2026-01-01T00:00:00Z",
    });
    if (!r || !r.reason.startsWith("validation: id"))
      throw new Error("expected validation:id failure, got " + JSON.stringify(r));
    return r;
  });

  // 6. Validation: downstream-readable rule rejects internal ids.
  check("validation: downstream-readable", () => {
    const r = validateVersionRow({
      version: "0.9.0",
      releasedAt: "2026-01-01",
      summary: "ships SP-20260519-001 ledger work",
      capsulePath: "framework/releases/0.9.0/release.json",
    });
    if (!r || !r.reason.startsWith("downstream-readable"))
      throw new Error("expected downstream-readable failure, got " + JSON.stringify(r));
    return r;
  });

  // 7. Fail-open: simulate read error by pointing at a non-existent file.
  check("fail-open on missing file", () => {
    const r = writeRow({
      file: path.join(tmpdir, "does-not-exist.md"),
      anchor: ANCHORS.roadmapSprints,
      row: "| x |",
      keyCol: 0,
      key: "[x]",
    });
    if (r.written) throw new Error("expected written:false");
    if (!r.reason.startsWith("opted-out"))
      throw new Error("expected opted-out, got " + r.reason);
    return r;
  });

  // Clean up tempdir.
  try {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  } catch (_e) {}

  const failed = results.filter((r) => !r.ok);
  const passed = results.length - failed.length;
  process.stdout.write(
    `ledger.js --self-test: ${passed}/${results.length} passed\n`,
  );
  for (const r of results) {
    if (r.ok) {
      process.stdout.write(`  ok    ${r.label}\n`);
    } else {
      process.stdout.write(`  FAIL  ${r.label}: ${r.err}\n`);
    }
  }
  return failed.length === 0 ? 0 : 1;
}

// ── Exports ────────────────────────────────────────────────

module.exports = {
  appendSprintRow,
  updateSprintRow,
  appendVersionRow,
  appendReleaseRow,
  updateReleaseRow,
  // Lower-level helpers exposed for tests and the backfill script.
  _internal: {
    writeRow,
    updateRowByKey,
    parseRow,
    serializeRow,
    formatSprintRow,
    formatReleaseRow,
    validateSprintRow,
    validateReleaseRow,
    validateVersionRow,
    ROADMAP_FILE,
    RELEASES_FILE,
    ANCHORS,
    SPRINT_STATUS_ENUM,
    RELEASE_STATUS_ENUM,
  },
};

// ── CLI ────────────────────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) {
    process.exit(selfTest());
  }
  process.stdout.write(
    "ledger.js — shared writer for ROADMAP.md / RELEASES.md.\n" +
      "Usage: require('./ledger') and call appendSprintRow / updateSprintRow /\n" +
      "appendVersionRow / appendReleaseRow / updateReleaseRow.\n" +
      "\n" +
      "Run --self-test to validate the writer in a tempdir.\n",
  );
  process.exit(0);
}
