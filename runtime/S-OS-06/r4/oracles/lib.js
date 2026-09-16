"use strict";

/**
 * S-OS-06 r4 ORACLE lane — STAGE 1 shared instrument library (MEASUREMENT ONLY).
 *
 * Nothing in here changes what the codemod rewrites, writes a warrant, or edits the partition. It reads:
 *   - the tracked population (git ls-files) — the PARTITION's population,
 *   - the partition through its one routed loader (scripts/open-source/partition-loader.js#loadPartition),
 *   - the codemod's exported classification helpers (scanStatus, categorizeOccurrence, CATEGORY_TRANSFORMS,
 *     genericSlugRewrite) so the oracles judge with the SAME rules the codemod applies, never a copy.
 *
 * Exit-code contract shared by all three oracles:
 *   0  measured, zero violations (the frame is still printed — a zero is never bare)
 *   1  measured, violations present (the frame + counts are printed)
 *   2  REFUSED — the instrument cannot certify this tree (reason printed); no count is reported as a result
 *
 * Self-reference hygiene: the legacy slug is assembled at runtime so these instrument sources never carry a
 * literal occurrence of the needle they measure (a literal here would be counted by oracle (ii) itself).
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const SLUG = ["warp", "os"].join("");
/** The four case forms the codemod's rewriter maps (rename-mc.js genericSlugRewrite / genericSlugRewriteScoped). */
const NEEDLE_ALL_RE = () => new RegExp(SLUG, "gi");

class OracleRefusal extends Error {
  constructor(message) {
    super(message);
    this.name = "OracleRefusal";
  }
}

function toPosix(p) {
  return String(p).split(path.sep).join("/").replace(/\\/g, "/");
}

function git(root, args, opts = {}) {
  return spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    ...opts,
  });
}

function loadCodemod(root = REPO_ROOT) {
  return require(path.join(root, "scripts", "open-source", "rename-mc.js"));
}

function loadLoader(root = REPO_ROOT) {
  return require(path.join(root, "scripts", "open-source", "partition-loader.js"));
}

/** The commit being measured. REFUSES on a dirty tracked tree: the population must be a commit, not a working state. */
function measuredHead(root = REPO_ROOT) {
  const head = git(root, ["rev-parse", "HEAD"]);
  if (head.status !== 0) throw new OracleRefusal(`git rev-parse HEAD failed: ${(head.stderr || "").trim()}`);
  const branch = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim();
  const dirty = git(root, ["status", "--porcelain", "--untracked-files=no"]);
  if (dirty.status !== 0) throw new OracleRefusal(`git status failed: ${(dirty.stderr || "").trim()}`);
  const dirtyLines = dirty.stdout.split(/\r?\n/).filter(Boolean);
  if (dirtyLines.length) {
    throw new OracleRefusal(
      `tracked tree is DIRTY (${dirtyLines.length} modified tracked path(s), first: ${dirtyLines[0].trim()}) — the oracle measures a COMMIT; commit or discard first`
    );
  }
  return { sha: head.stdout.trim(), branch };
}

function listTracked(root = REPO_ROOT) {
  const r = git(root, ["ls-files", "-z"]);
  if (r.status !== 0) throw new OracleRefusal(`git ls-files failed (status ${r.status}): ${(r.stderr || "").trim()}`);
  const NUL = String.fromCharCode(0);
  return r.stdout.split(NUL).filter(Boolean).map(toPosix);
}

// ── population reconciliation ──────────────────────────────────────────────
// eligible == scanned + binary + unreadable + oversized + generated + write-protected
// Every term is a COUNT of files, every excluded term names the RULE that excluded it, and the equation is
// asserted — an instrument whose terms do not sum REFUSES (it has lost a file somewhere, the fail-open shape).

const TERM_ORDER = ["scanned", "binary", "unreadable", "oversized", "generated", "write-protected"];

function newPopulation(label) {
  return {
    label,
    eligible: 0,
    terms: Object.fromEntries(TERM_ORDER.map((t) => [t, 0])),
    rules: {},
    sub: Object.fromEntries(TERM_ORDER.map((t) => [t, {}])),
    unreadableFiles: [],
    oversizedFiles: [],
  };
}

function popAdd(pop, term, subKey) {
  if (!TERM_ORDER.includes(term)) throw new Error(`population: unknown term ${term}`);
  pop.terms[term] += 1;
  if (subKey) pop.sub[term][subKey] = (pop.sub[term][subKey] || 0) + 1;
}

function popHolds(pop) {
  const sum = TERM_ORDER.reduce((a, t) => a + pop.terms[t], 0);
  return { sum, holds: sum === pop.eligible };
}

function formatPopulation(pop) {
  const { sum, holds } = popHolds(pop);
  const lines = [];
  lines.push(
    `  POPULATION RECONCILIATION (${pop.label}): eligible=${pop.eligible} == ` +
      TERM_ORDER.map((t) => `${t}=${pop.terms[t]}`).join(" + ") +
      `  [sum=${sum} holds=${holds}]`
  );
  for (const t of TERM_ORDER) {
    const subs = Object.entries(pop.sub[t]).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    const subTxt = subs.length ? `  {${subs.map(([k, v]) => `${k}=${v}`).join(", ")}}` : "";
    lines.push(`    ${t.padEnd(15)} ${String(pop.terms[t]).padStart(6)}  rule: ${pop.rules[t] || "(no rule stated — instrument defect)"}${subTxt}`);
  }
  return lines;
}

/** REFUSE conditions shared by the population: unreadable must be ZERO; the equation must hold; every term must state its rule. */
function assertPopulation(pop) {
  const missingRule = TERM_ORDER.filter((t) => !pop.rules[t]);
  if (missingRule.length) throw new OracleRefusal(`population ${pop.label}: term(s) without a stated rule: ${missingRule.join(", ")}`);
  const { sum, holds } = popHolds(pop);
  if (!holds) throw new OracleRefusal(`population ${pop.label}: reconciliation does not hold (eligible=${pop.eligible}, terms sum=${sum}) — a file escaped every term`);
  if (pop.terms.unreadable > 0) {
    throw new OracleRefusal(
      `population ${pop.label}: unreadable=${pop.terms.unreadable} (first: ${pop.unreadableFiles.slice(0, 5).join(", ")}) — zero occurrences from an unreadable file is indistinguishable from a clean file; REFUSING`
    );
  }
  if (pop.terms.oversized > 0) {
    throw new OracleRefusal(
      `population ${pop.label}: oversized=${pop.terms.oversized} (first: ${pop.oversizedFiles.slice(0, 5).join(", ")}) — an unscanned text file cannot be certified; REFUSING`
    );
  }
}

/**
 * Content status of one file, using the CODEMOD'S OWN rule (rename-mc.js#scanStatus): binary (extension or a NUL in the
 * first 8KB), unreadable (stat/open failure, not a regular file), oversized (text > MAX_SCAN_BYTES), else text. A text
 * file whose full read then throws is ALSO unreadable (rename-mc.js:656-658 swallowed that case).
 * -> { status, content? }
 */
function readForScan(absPath, codemod, contentOverride) {
  if (contentOverride !== undefined) return { status: "text", content: contentOverride };
  const status = codemod.scanStatus(absPath, codemod.MAX_SCAN_BYTES);
  if (status !== "text") return { status };
  try {
    return { status: "text", content: fs.readFileSync(absPath, "utf8") };
  } catch (e) {
    return { status: "unreadable", error: e.code || e.message };
  }
}

const RULE_TEXT = {
  binary: "rename-mc.js#scanStatus === 'binary' (extension in BINARY_EXTENSIONS, or a NUL byte in the first 8192 bytes) — no text to hold a token",
  unreadable: "rename-mc.js#scanStatus === 'unreadable' OR fs.readFileSync threw — MUST be 0 or the oracle REFUSES",
  oversized: "rename-mc.js#scanStatus === 'oversized' (non-binary, > MAX_SCAN_BYTES) — MUST be 0 or the oracle REFUSES",
};

// ── partition helpers ──────────────────────────────────────────────────────

/** exact-one classification; an invalid class is UNCLASSIFIED (refuse). */
function classify(partition, loader, rel) {
  const c = partition.classifyPath(rel);
  if (!c || !loader.VALID_CLASSES.includes(c.class)) return null;
  return c;
}

function sortedEntries(obj) {
  return Object.entries(obj).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}

function bump(obj, key, n = 1) {
  obj[key] = (obj[key] || 0) + n;
}

/** Case form of one needle match: one of the four the rewriter maps, or "odd-case". */
function caseForm(matchText, codemod) {
  const rewritten = codemod.genericSlugRewrite(matchText);
  return new RegExp(SLUG, "i").test(rewritten) ? "odd-case" : "four-form";
}

function writeOut(outPath, lines) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join("\n") + "\n", "utf8");
}

/** Standard CLI runner: build lines, print, persist (--out), exit with the contract code. */
function runCli(name, fn) {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const outPath = outIdx >= 0 ? path.resolve(args[outIdx + 1]) : null;
  const lines = [];
  let code;
  const started = Date.now();
  try {
    const r = fn(args, lines);
    code = r.code;
  } catch (e) {
    if (e instanceof OracleRefusal) {
      lines.push(`${name}: REFUSED — ${e.message}`);
      lines.push(`${name}: no count is reported as a result of this run (exit 2)`);
      code = 2;
    } else {
      lines.push(`${name}: INSTRUMENT ERROR (treated as REFUSAL) — ${e && e.stack ? e.stack : e}`);
      code = 2;
    }
  }
  lines.push(`${name}: exit=${code} elapsedMs=${Date.now() - started}`);
  const text = lines.join("\n");
  (code === 2 ? process.stderr : process.stdout).write(text + "\n");
  if (outPath) writeOut(outPath, lines);
  process.exit(code);
}

module.exports = {
  REPO_ROOT,
  SLUG,
  NEEDLE_ALL_RE,
  OracleRefusal,
  TERM_ORDER,
  RULE_TEXT,
  toPosix,
  git,
  loadCodemod,
  loadLoader,
  measuredHead,
  listTracked,
  newPopulation,
  popAdd,
  popHolds,
  formatPopulation,
  assertPopulation,
  readForScan,
  classify,
  sortedEntries,
  bump,
  caseForm,
  writeOut,
  runCli,
};
