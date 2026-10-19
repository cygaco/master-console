#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const mem = require("./memory-integrity.js");

const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const NAME = "memory-apply";

const HOLD_MESSAGE =
  "the --apply (mutation) path is HELD — this is a deliberate governance hold, not a bug. See " +
  ".claude/commands/memory/verify.md for what is off, why, and when it comes back; ADR-0039 " +
  "(the disclosed-residual rule for security-lane HIGHs) is the provenance. The read-only detector " +
  "(scripts/checks/memory-integrity.js) is unaffected and still works. Dry-run (omit --apply) is " +
  "still available and mutates nothing. There is no override for this hold.";

const VALID_ACTIONS = new Set(["none", "correct", "delete"]);
const VALID_CLASSIFICATIONS = new Set(["verified", "contradicted", "unverifiable"]);

const INVIS = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u206A-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF9-\uFFFB]/g;
const SPACE_MAP = /[\s\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g;

function hasVisibleText(s) {
  return String(s == null ? "" : s).replace(INVIS, "").replace(SPACE_MAP, "") !== "";
}

const TMP_PREFIX = ".memory-apply.";

function tempFileName() {
  return `${TMP_PREFIX}${crypto.randomBytes(16).toString("hex")}.tmp`;
}

function strayTempNames(storeAbs) {
  let entries;
  try {
    entries = fs.readdirSync(storeAbs);
  } catch {
    return [];
  }
  return entries.filter((e) => String(e).startsWith(TMP_PREFIX));
}

function atomicWriteInStore(storeAbs, targetAbs, data) {
  const resolvedStore = path.resolve(storeAbs);
  const resolvedTarget = path.resolve(targetAbs);
  if (path.dirname(resolvedTarget) !== resolvedStore) {
    const err = new Error(
      `refusing to write '${path.basename(String(targetAbs))}': it resolves to '${resolvedTarget}', which is not a direct child of the store '${resolvedStore}' — aborting fail-closed`,
    );
    err.code = "EOUTOFSTORE";
    throw err;
  }

  const tmpAbs = path.join(storeAbs, tempFileName());

  let fd;
  try {
    fd = fs.openSync(tmpAbs, "wx", 0o600);
  } catch (e) {
    if (e && e.code === "EEXIST") {
      const err = new Error(
        `refusing to write '${path.basename(targetAbs)}': the temp path '${path.basename(tmpAbs)}' already exists — ` +
          "aborting fail-closed (a random temp name does not collide by chance, so this is not retried)",
      );
      err.code = "EEXIST";
      throw err;
    }
    throw e;
  }

  try {
    const st = fs.fstatSync(fd);
    if (typeof st.nlink === "number" && st.nlink !== 1) {
      throw new Error(
        `refusing to write '${path.basename(targetAbs)}': the freshly created temp has ${st.nlink} directory entries`,
      );
    }
    fs.writeFileSync(fd, data);
  } catch (e) {
    try {
      fs.closeSync(fd);
    } catch {
    }
    try {
      fs.unlinkSync(tmpAbs);
    } catch {
    }
    throw e;
  }

  try {
    fs.closeSync(fd);
  } catch (e) {
    try {
      fs.unlinkSync(tmpAbs);
    } catch {
    }
    const err = new Error(
      `refusing to write '${path.basename(String(targetAbs))}': closing the temp descriptor failed ` +
        `(${(e && (e.code || e.message)) || "unknown error"}) — the temp was NOT renamed over the target, because a failed ` +
        "close commonly reports a buffered write error and the temp may be truncated",
    );
    err.code = (e && e.code) || "ECLOSEFAILED";
    err.cause = e;
    throw err;
  }

  try {
    fs.renameSync(tmpAbs, targetAbs);
  } catch (e) {
    try {
      fs.unlinkSync(tmpAbs);
    } catch {
    }
    throw e;
  }
}

function isSafeStoreFilename(name) {
  if (typeof name !== "string") return false;
  const n = name.trim();
  if (!n) return false;
  if (n !== path.basename(n)) return false;
  if (path.isAbsolute(n)) return false;
  if (n === "." || n === "..") return false;
  if (n.includes("/") || n.includes("\\")) return false;
  if (n.includes(":")) return false;
  if (n.toLowerCase() === "memory.md") return false;
  return n.toLowerCase().endsWith(".md");
}

function canonicalStoreName(storeAbs, name) {
  let entries;
  try {
    entries = fs.readdirSync(storeAbs);
  } catch {
    return null;
  }
  const lower = String(name == null ? "" : name).toLowerCase();
  const matches = entries.filter((e) => e.toLowerCase() === lower);
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    const err = new Error(`ambiguous case-variant filenames for '${name}': ${matches.join(", ")}`);
    err.ambiguous = matches;
    throw err;
  }
  return matches[0];
}

function validateNewBody(body) {
  const fm = mem.parseFrontmatter(String(body == null ? "" : body));
  return mem.frontmatterProblems(fm).map((p) => p.message);
}

function validatePlan(plan) {
  const violations = [];
  const planned = [];
  const changes = plan && Array.isArray(plan.changes) ? plan.changes : [];
  const seen = new Set();
  for (const ch of changes) {
    const file = (ch && typeof ch.file === "string" && ch.file.trim()) || "(missing file)";
    const action = ch && ch.action;
    const classification = ch && ch.classification;

    if (!VALID_ACTIONS.has(action) || !VALID_CLASSIFICATIONS.has(classification)) {
      violations.push({ file, reason: "invalid action/classification" });
      continue;
    }
    const dedupKey = file.toLowerCase();
    if (seen.has(dedupKey)) {
      violations.push({ file, reason: "duplicate file entry (one change per file, case-insensitive)" });
      continue;
    }
    seen.add(dedupKey);

    if (action === "none") {
      planned.push({ file, action });
      continue;
    }
    if (!isSafeStoreFilename(ch && ch.file)) {
      violations.push({ file, reason: "unsafe file path (must be a plain *.md filename inside the store)" });
      continue;
    }
    if (classification !== "contradicted") {
      violations.push({ file, reason: "only a contradicted memory may be mutated" });
      continue;
    }
    const evidence = ch && typeof ch.evidence === "string" ? ch.evidence : "";
    if (!hasVisibleText(evidence)) {
      violations.push({ file, reason: "mutation requires ground-truth evidence" });
      continue;
    }
    if (action === "correct") {
      const newBody = ch && typeof ch.newBody === "string" ? ch.newBody : "";
      if (!newBody.trim()) {
        violations.push({ file, reason: "correct requires newBody" });
        continue;
      }
      planned.push({ file, action, newBody });
      continue;
    }
    planned.push({ file, action });
  }
  return { ok: violations.length === 0, violations, planned };
}

function removeIndexLines(indexText, filesToRemove) {
  const { entries } = mem.parseIndex(indexText);
  const removeLower = new Set([...filesToRemove].map((f) => String(f).toLowerCase()));
  const removeLineNums = new Set(
    entries.filter((e) => e && removeLower.has(String(e.target).toLowerCase())).map((e) => e.line),
  );
  const lines = String(indexText == null ? "" : indexText).split(/\r?\n/);
  const kept = lines.filter((_, i) => !removeLineNums.has(i + 1));
  return kept.join("\n");
}

function projectStoreState(storeAbs, mutations, indexText) {
  const dirLabel = String(storeAbs).replace(/\\/g, "/");
  const current = mem.readStore(storeAbs, dirLabel, mem.DEFAULT_MAX_INDEX_LINES);
  if (!current) return null;

  const deleted = new Set();
  const corrected = new Map();
  for (const p of mutations) {
    const key = String(p.canonicalFile).toLowerCase();
    if (p.action === "delete") deleted.add(key);
    else if (p.action === "correct") corrected.set(key, p.newBody);
  }

  const files = [];
  for (const f of current.files) {
    const key = String(f.file).toLowerCase();
    if (deleted.has(key)) continue;
    if (corrected.has(key)) {
      const fm = mem.parseFrontmatter(String(corrected.get(key)));
      files.push({
        file: f.file,
        hasFrontmatter: fm.hasFrontmatter,
        name: fm.name,
        description: fm.description,
        type: fm.type,
        wikilinks: mem.extractWikilinks(fm.body),
      });
      continue;
    }
    files.push(f);
  }

  const deletedCanonical = mutations.filter((p) => p.action === "delete").map((p) => p.canonicalFile);
  const projectedIndex = deletedCanonical.length
    ? removeIndexLines(indexText, new Set(deletedCanonical))
    : String(indexText == null ? "" : indexText);
  const { entries, lineCount, malformed } = mem.parseIndex(projectedIndex);

  return {
    dir: current.dir,
    maxIndexLines: current.maxIndexLines,
    indexEntries: entries,
    indexMalformed: malformed,
    indexLineCount: lineCount,
    files,
  };
}

function fatal(notes, problems) {
  return { ok: false, fatal: true, dryRun: false, applied: false, violations: [], planned: [], problems, notes };
}

function run(opts) {
  opts = opts || {};
  const notes = [];

  if (opts.apply) {
    return fatal(notes, [HOLD_MESSAGE]);
  }

  const planPath = opts.plan;
  if (!planPath) return fatal(notes, ["--plan <plan.json> is required"]);
  const planAbs = path.isAbsolute(planPath) ? planPath : path.join(ROOT, planPath);
  let raw;
  try {
    raw = fs.readFileSync(planAbs, "utf8");
  } catch (e) {
    return fatal(notes, [`plan file unreadable: ${e.message}`]);
  }
  let plan;
  try {
    plan = JSON.parse(raw.replace(/^﻿/, ""));
  } catch (e) {
    return fatal(notes, [`plan is not valid JSON: ${e.message}`]);
  }
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    return fatal(notes, ["plan JSON must be an object with a 'store' and 'changes'"]);
  }
  if (!Array.isArray(plan.changes)) {
    return fatal(notes, ["plan.changes must be an array (a non-array is a malformed plan, not an empty one)"]);
  }

  const storeRel = plan.store;
  if (!storeRel || typeof storeRel !== "string") {
    return fatal(notes, ["plan.store (memory store dir) is required"]);
  }
  const storeAbs = path.isAbsolute(storeRel) ? storeRel : path.join(ROOT, storeRel);
  const memPath = path.join(storeAbs, "MEMORY.md");
  if (!fs.existsSync(memPath)) {
    return fatal(notes, [`store '${storeRel}' has no MEMORY.md (not a memory store)`]);
  }

  const v = validatePlan(plan);
  if (!v.ok) {
    return {
      ok: false,
      fatal: true,
      dryRun: !opts.apply,
      applied: false,
      violations: v.violations,
      planned: v.planned,
      notes: [...notes, `${v.violations.length} violation(s) — fail-closed, nothing mutated`],
    };
  }

  const mutations = v.planned.filter((p) => p.action !== "none");

  const bodyViolations = [];
  for (const p of mutations) {
    if (p.action !== "correct") continue;
    for (const reason of validateNewBody(p.newBody)) {
      bodyViolations.push({ file: p.file, reason: `newBody is not a valid memory file: ${reason}` });
    }
  }
  if (bodyViolations.length) {
    return {
      ok: false,
      fatal: true,
      dryRun: !opts.apply,
      applied: false,
      violations: bodyViolations,
      planned: v.planned,
      notes: [
        ...notes,
        `${bodyViolations.length} newBody structural violation(s) — fail-closed, nothing mutated`,
      ],
    };
  }

  const storeReal = path.resolve(storeAbs);
  const fsViolations = [];
  for (const p of mutations) {
    let canonical;
    try {
      canonical = canonicalStoreName(storeAbs, p.file);
    } catch (e) {
      fsViolations.push({ file: p.file, reason: e.message });
      continue;
    }
    if (!canonical) {
      fsViolations.push({ file: p.file, reason: "no such file in the store (case-insensitive lookup)" });
      continue;
    }
    p.canonicalFile = canonical;
    const fileAbs = path.resolve(storeAbs, canonical);
    if (path.dirname(fileAbs) !== storeReal) {
      fsViolations.push({ file: p.file, reason: "resolves outside the store dir" });
      continue;
    }
    let st = null;
    try {
      st = fs.lstatSync(fileAbs);
    } catch (e) {
      fsViolations.push({ file: p.file, reason: `not present / unstattable (${e.code || e.message})` });
      continue;
    }
    if (!st.isFile()) {
      fsViolations.push({
        file: p.file,
        reason: st.isSymbolicLink()
          ? "target is a symlink (would escape the store)"
          : "target is not a regular file (directory / device / fifo) — would fault mid-apply",
      });
      continue;
    }
    if (typeof st.nlink === "number" && st.nlink > 1) {
      fsViolations.push({
        file: p.file,
        reason: `target has ${st.nlink} hard links — a memory file must have exactly one directory entry`,
      });
      continue;
    }
    if (p.action === "correct" && typeof p.newBody !== "string") {
      fsViolations.push({ file: p.file, reason: "newBody missing at apply time" });
    }
  }
  if (fsViolations.length) {
    return {
      ok: false,
      fatal: true,
      dryRun: !opts.apply,
      applied: false,
      violations: fsViolations,
      planned: v.planned,
      notes: [...notes, `${fsViolations.length} fs-safety violation(s) — fail-closed, nothing mutated`],
    };
  }

  let preReadIndexText = null;
  {
    const indexFail = (why) => ({
      ok: false,
      fatal: true,
      dryRun: !opts.apply,
      applied: false,
      violations: [],
      planned: v.planned,
      problems: [why],
      notes: [...notes, "index pre-check failed — fail-closed, nothing mutated"],
    });
    let ist;
    try {
      ist = fs.lstatSync(memPath);
    } catch (e) {
      return indexFail(`index (MEMORY.md) unstattable before apply: ${e.code || e.message}`);
    }
    if (!ist.isFile()) {
      return indexFail("index (MEMORY.md) is not a regular file (directory / symlink / device) — refusing to mutate");
    }
    try {
      preReadIndexText = fs.readFileSync(memPath, "utf8");
    } catch (e) {
      return indexFail(`index (MEMORY.md) unreadable before apply: ${e.code || e.message}`);
    }
  }

  if (mutations.length) {
    const strays = strayTempNames(storeAbs);
    if (strays.length) {
      return {
        ok: false,
        fatal: true,
        dryRun: !opts.apply,
        applied: false,
        violations: strays.map((n) => ({ file: n, reason: "stray apply temp file in the store (a previous run left it behind) — refusing to write into a store in an unexplained state" })),
        planned: v.planned,
        notes: [...notes, `${strays.length} stray temp file(s) in the store — fail-closed, nothing mutated`],
      };
    }
  }

  {
    let projected;
    try {
      projected = projectStoreState(storeAbs, mutations, preReadIndexText);
    } catch (e) {
      return {
        ok: false,
        fatal: true,
        dryRun: !opts.apply,
        applied: false,
        violations: [],
        planned: v.planned,
        problems: [`the store could not be read for the pre-check: ${e.message}`],
        notes: [...notes, "prospective store pre-check could not run — fail-closed, nothing mutated"],
      };
    }
    const prospectiveFindings = projected ? mem.evaluate({ stores: [projected] }).findings || [] : [];
    if (prospectiveFindings.length) {
      const correctedFiles = new Set(
        mutations.filter((p) => p.action === "correct").map((p) => p.canonicalFile),
      );
      const violations = prospectiveFindings.map((f) => {
        const subject = `${projected.dir}/${f.file} `;
        const clause = f.message.startsWith(subject)
          ? f.message.slice(subject.length).replace(/\.$/, "")
          : f.message;
        return f.kind === "invalid-frontmatter" && f.file && correctedFiles.has(f.file)
          ? { file: f.file, reason: `newBody is not a valid memory file: ${clause}` }
          : {
              file: f.file || "(store)",
              reason: `applying this plan would leave the store dirty — ${f.kind}: ${f.message}`,
            };
      });
      return {
        ok: false,
        fatal: true,
        dryRun: !opts.apply,
        applied: false,
        violations,
        planned: v.planned,
        prospectiveFindings,
        notes: [
          ...notes,
          `${prospectiveFindings.length} structural finding(s) in the projected store — fail-closed, nothing mutated`,
        ],
      };
    }
  }

  if (!opts.apply) {
    return {
      ok: true,
      fatal: false,
      dryRun: true,
      applied: false,
      violations: [],
      planned: v.planned,
      notes: [
        ...notes,
        `dry-run: ${mutations.length} mutating op(s) planned of ${v.planned.length} change(s); nothing written (pass --apply to execute)`,
      ],
    };
  }

  const backup = [];
  try {
    for (const p of mutations) {
      const fileAbs = path.resolve(storeAbs, p.canonicalFile);
      backup.push({ abs: fileAbs, bytes: fs.readFileSync(fileAbs) });
    }
    backup.push({ abs: memPath, bytes: fs.readFileSync(memPath) });
  } catch (e) {
    return {
      ok: false,
      fatal: true,
      applied: false,
      dryRun: false,
      violations: [],
      planned: v.planned,
      problems: [`backup capture failed before apply: ${e.message}`],
      notes: [...notes, "backup capture failed — fail-closed, nothing mutated"],
    };
  }

  try {
    const deletedFiles = new Set();
    for (const p of mutations) {
      const fileAbs = path.resolve(storeAbs, p.canonicalFile);
      if (p.action === "delete") {
        fs.unlinkSync(fileAbs);
        deletedFiles.add(p.canonicalFile);
      } else if (p.action === "correct") {
        atomicWriteInStore(storeAbs, fileAbs, p.newBody);
      }
    }
    if (deletedFiles.size) {
      atomicWriteInStore(storeAbs, memPath, removeIndexLines(preReadIndexText, deletedFiles));
    }

  } catch (e) {
    return undo(`apply error: ${e.message}`, "apply faulted mid-flight", null);
  }

  let post;
  try {
    post = mem.run({ dirs: [storeAbs] });
  } catch (e) {
    return undo(`post-check errored after apply — the store could not be verified: ${e.message}`, "post-check errored", null);
  }
  if (post.fatal) {
    return undo(
      `post-check fatal after apply: ${(post.problems || ["post-check fatal"]).join("; ")}`,
      "post-check fatal",
      null,
    );
  }
  const postFindings = post.findings || [];
  if (postFindings.length > 0) {
    return undo(
      `post-check found ${postFindings.length} structural finding(s) — the plan would leave the store dirty`,
      `post-check ${postFindings.length} finding(s)`,
      postFindings,
    );
  }
  return {
    ok: true,
    fatal: false,
    applied: true,
    dryRun: false,
    violations: [],
    planned: v.planned,
    postFindings,
    notes: [...notes, `applied ${mutations.length} mutation(s); post-check clean`],
  };

  function undo(problem, noteVerb, findings) {
    const rollbackErrors = [];
    for (const b of backup) {
      try {
        atomicWriteInStore(storeAbs, b.abs, b.bytes);
      } catch (re) {
        rollbackErrors.push(`${b.abs}: ${re.message}`);
      }
    }

    const changed = [];
    for (const b of backup) {
      let onDisk;
      try {
        onDisk = fs.readFileSync(b.abs);
      } catch (e) {
        changed.push({ abs: b.abs, why: `unreadable after restore (${e.code || e.message})` });
        continue;
      }
      if (!onDisk.equals(b.bytes)) {
        changed.push({
          abs: b.abs,
          why: `${onDisk.length} byte(s) on disk do NOT match the ${b.bytes.length} byte(s) captured before apply`,
        });
      }
    }

    const rolledBack = rollbackErrors.length === 0 && changed.length === 0;
    const res = {
      ok: false,
      fatal: true,
      applied: !rolledBack,
      dryRun: false,
      violations: [],
      planned: v.planned,
      rolledBack,
      rollbackVerified: changed.length === 0,
      changedFilesAfterRollback: changed.map((c) => path.basename(c.abs)),
      problems: [
        problem,
        rolledBack
          ? "rolled back — every captured path was RE-READ and is byte-identical to its pre-apply bytes, nothing changed"
          : `ROLLBACK INCOMPLETE: ${[...rollbackErrors, ...changed.map((c) => `${c.abs}: ${c.why}`)].join("; ")}`,
      ],
      notes: [
        ...notes,
        rolledBack
          ? `${noteVerb} → rolled back (all-or-nothing preserved, verified by re-reading the store)`
          : `${noteVerb} AND rollback incomplete — inspect the store manually`,
      ],
    };
    if (findings && findings.length) res.postFindings = findings;
    return res;
  }
}

function parseArgs(argv) {
  const opts = { plan: null, apply: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") opts.apply = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--plan") opts.plan = argv[++i];
  }
  return opts;
}

function exitCode(res) {
  return res.fatal ? 2 : 0;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const mode = opts.apply ? "apply" : "dry-run";

  if (opts.apply) {
    const msg = HOLD_MESSAGE;
    process.stdout.write(
      (opts.json
        ? JSON.stringify({
            check: NAME,
            mode,
            ok: false,
            fatal: true,
            dryRun: false,
            applied: false,
            violations: [],
            planned: [],
            problems: [msg],
            notes: [],
            error: msg,
          })
        : `ERROR  [${NAME}] (fail-closed, defense-in-depth) ${msg}`) + "\n",
    );
    process.exit(2);
  }

  let res;
  try {
    res = run(opts);
  } catch (e) {
    const msg = String((e && e.message) || e);
    process.stdout.write(
      (opts.json
        ? JSON.stringify({ check: NAME, mode, ok: false, fatal: true, error: msg })
        : `ERROR  [${NAME}] runner error (fail-closed): ${msg}`) + "\n",
    );
    process.exit(2);
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify({ check: NAME, mode, ...res }, null, 2) + "\n");
    process.exit(exitCode(res));
  }

  if (res.fatal) {
    process.stderr.write(`ERROR  [${NAME}] (fail-closed) ${mode}\n`);
    for (const vio of res.violations || []) {
      process.stderr.write(`  - REJECT ${vio.file}: ${vio.reason}\n`);
    }
    for (const p of res.problems || []) process.stderr.write(`  - ${p}\n`);
    for (const f of [...(res.postFindings || []), ...(res.prospectiveFindings || [])]) {
      process.stderr.write(`  - [${f.severity}] ${f.kind}: ${f.message}\n`);
    }
    if (res.notes && res.notes.length) process.stderr.write(`  (${res.notes.join(" · ")})\n`);
    process.exit(2);
  }

  if (res.dryRun) {
    process.stdout.write(`DRY-RUN [${NAME}] ${res.notes.join(" · ")}\n`);
    for (const p of res.planned || []) {
      const verb = p.action === "delete" ? "would delete" : p.action === "correct" ? "would correct" : "no-op";
      process.stdout.write(`  ~ ${verb} ${p.file}\n`);
    }
    process.exit(0);
  }

  process.stdout.write(`APPLIED [${NAME}] ${res.notes.join(" · ")}\n`);
  process.exit(0);
}

if (require.main === module) main();

module.exports = {
  validatePlan,
  validateNewBody,
  isSafeStoreFilename,
  canonicalStoreName,
  removeIndexLines,
  projectStoreState,
  tempFileName,
  strayTempNames,
  TMP_PREFIX,
  hasVisibleText,
  INVIS,
  SPACE_MAP,
  run,
  NAME,
  VALID_ACTIONS,
  VALID_CLASSIFICATIONS,

  __testonly__: {
    atomicWriteInStore,
  },
};
