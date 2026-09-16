#!/usr/bin/env node
"use strict";
/**
 * run-tests.js: the `npm test` runner (ED-434). It runs the FULL test glob, minus a registered,
 * self-policing quarantine.
 *
 *   node scripts/checks/run-tests.js [--root <dir>] [--quarantine <file>] [--verify-base]
 *
 * 1. Expands `scripts/** /*.test.js` + `tests/** /*.test.js` (the space is there only to keep this
 *    comment open) from what git sees under <root>: tracked files plus untracked-not-ignored
 *    files (`git ls-files --cached --others --exclude-standard`). A gitignored local file never
 *    runs, and a new test runs before its first commit. Tracked files deleted on disk are dropped.
 * 2. Subtracts the quarantine set read from <root>/tests/quarantine.json (or --quarantine).
 * 3. PRIMARY: `node --test --test-reporter=tap <remaining files>`, in batches that fit the Windows
 *    command line. A failing batch's exit code is the runner's exit code.
 * 4. TEETH: every quarantined file runs ALONE, sequentially, under the same PINNED reporter (TAP).
 *    The runner FAILS if a quarantined file passes, is missing, is not at the register's base
 *    (or its basePath is not a rename there), or fails with a different MULTISET of cause lines
 *    than registered (CAUSE-LOCK), more failing tests (COUNT-LOCK) or past its expiry.
 *
 * THE CAPTURE RULE (β row 476 P3): the reporter synthesizes the CONTAINER, the test authors the
 * CONTENT. Strip the reporter's rendering, keep the author's content, in both regimes:
 *   - TAP comment lines: the `#` marker is the reporter's; the text after it is the author's
 *     (console output, stderr, t.diagnostic). The `# Subtest:` lines and the run summary after the
 *     top-level plan are the reporter's own and are not captured.
 *   - TAP YAML diagnostic blocks: the block, its keys and its escaping are the reporter's; the
 *     `error` VALUE is the author's assertion message, captured when node unwraps it from an
 *     author-thrown error (see AUTHOR_ERROR_FAILURE_TYPES).
 * Every captured line is then normalized (NORMALIZER, a declared six-step order) and the
 * drop class (DROP_CLASS, stated as shapes) is removed. The result is the entry's UNORDERED MULTISET
 * of cause lines (duplicates kept; β verdict 2d7f5b83, ledger row 479, correcting the ordered-set
 * rule of row 473 §2). The register must DECLARE exactly this normalizer, drop class and ceiling set
 * (`$normalizer`, `$dropClass`, `$ceilings`); every stored line must be a FIXED POINT of the
 * normalizer, and the stored lines must already be in canonical (sorted) order, so stored and observed
 * are mechanically guaranteed identical treatment, order included.
 *
 * --verify-base (registration check, additive only): also materializes the register's base tree in
 * a temp dir and requires every entry's base path to FAIL there. It never relaxes a check.
 *
 * Fail-closed everywhere: a git error, a malformed quarantine artifact, zero files to run, a spawn
 * error, a timeout, a kill, a null exit code or an over-limit capture is a FAILURE, never a pass.
 *
 * Exit: 0 = primary green AND every quarantine entry valid and still failing; otherwise non-zero
 * (the primary run's own exit code when the primary run failed, else 1).
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const DEFAULT_ROOT = path.resolve(__dirname, "..", "..");
const QUARANTINE_REL = "tests/quarantine.json";
const TEST_DIRS = ["scripts", "tests"];
const TEST_FILE_RE = /^(?:scripts|tests)\/(?:.+\/)?[^/]+\.test\.js$/;
const GLOB_META_RE = /[*?[\]{}]/; // node --test treats its file args as glob patterns
const MAX_BATCH_CHARS = 12000; // well under the 32,767-char Windows CreateProcess limit
const PRIMARY_BATCH_TIMEOUT_MS = 30 * 60 * 1000;
const QUARANTINE_FILE_TIMEOUT_MS = 10 * 60 * 1000;
const CAPTURE_LIMIT = 8 * 1024 * 1024;
const GIT_LOCATOR_ENV = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_PREFIX", "GIT_OBJECT_DIRECTORY", "GIT_NAMESPACE"];

/** The reporter is PINNED (β row 473 §1): TAP is a specified format; the default follows the Node major. */
const REPORTER = "tap";
/**
 * The REAL register's base. It is the pre-sprint commit every entry was verified against. The runner
 * asserts the real register names it and refuses otherwise. This is a check local to this runner.
 * It is NOT freeze coverage: nothing freezes tests/quarantine.json. A change to the committed field
 * is visible in a diff and in review, and that is all (enforcement debt filed for the freeze extension).
 */
const EXPECTED_REAL_BASE = "669aadc1ab7dc03d74f5b95cb613a5573f4e54a6";
/** Declared similarity threshold for the pair-limited basePath rename check (git's own default, stated). */
const RENAME_SIMILARITY = "50%";

/**
 * node's test runner unwraps an author-thrown error into the YAML `error` value only for these failure
 * types (its own kUnwrapErrors set). Outside the set the message is composed by the runner itself
 * ("1 subtest failed", "test timed out after …"). A block that carries `exitCode` is the runner's
 * process-level wrapper ("test failed"), built from a child's exit status. Both are CONTAINER.
 */
const AUTHOR_ERROR_FAILURE_TYPES = new Set(["testCodeFailure", "hookFailed", "uncaughtException", "unhandledRejection"]);

/**
 * The HERMETIC CHILD ENVIRONMENT (β row 486, lane I7). Every child this runner spawns (each primary batch,
 * each quarantined file run alone, each --verify-base run, and every git call) receives ONLY the variables
 * named here, copied from the runner's own environment when they are present there, names matched without
 * regard to case. Everything else is scrubbed, so an ambient variable that makes the code under test write
 * to stderr cannot reach the capture: the capture is a property of the code, not of the machine.
 *
 * win32: exactly the set libuv itself copies from the parent into any child whose env block lacks them
 * (measured, lane I7: a child spawned with an EMPTY env on Windows receives these eleven and no others), so
 * a smaller Windows list would be a false declaration. other: the POSIX essentials for spawning a program
 * by name (PATH), git's global config (HOME) and the temp dir the normalizer masks (TMPDIR).
 * `node --test` itself adds NODE_TEST_CONTEXT and NODE_TEST_WORKER_ID to each test file's process; those
 * are the runner's own, not ambient. The declaration is generated from this object into the normalizer's
 * declaration below, so declared and actual cannot drift.
 */
const CHILD_ENV_ALLOWLIST = Object.freeze({
  win32: Object.freeze(["HOMEDRIVE", "HOMEPATH", "LOGONSERVER", "PATH", "SYSTEMDRIVE", "SYSTEMROOT", "TEMP", "USERDOMAIN", "USERNAME", "USERPROFILE", "WINDIR"]),
  other: Object.freeze(["HOME", "PATH", "TMPDIR"]),
});

/** The declared normalizer. The register's `$normalizer` must equal this array, element for element. */
const NORMALIZER_DECLARATION = [
  `E environment (hermetic, β row 486): every captured line comes from a child spawned with ONLY these variables from the runner's environment, names matched without regard to case; all others are scrubbed. win32: ${CHILD_ENV_ALLOWLIST.win32.join(", ")}. Other platforms: ${CHILD_ENV_ALLOWLIST.other.join(", ")}. node --test adds its own NODE_TEST_CONTEXT and NODE_TEST_WORKER_ID to each test file's process.`,
  "0 input: every captured line enters in TAP comment rendering. A YAML error value is decoded from its YAML scalar and re-rendered with node's own TAP comment escape before step 1, so both regimes share one normalizer.",
  "1 unescape: a single left-to-right scan decoding \\\\ to \\ and \\# to #; every other backslash pair is left as its two characters.",
  "2 separators: every run of one or more backslashes becomes one /. It runs AFTER unescape (ordering trap: in the other order an escaped pair becomes //).",
  "3 roots: the absolute repo root (in / form) becomes <repo>; THEN the OS temp dir (in / form, not preceded by a word character or >, not followed by a word character, . or -) becomes <tmp>, and the trailing 6 alphanumerics of the first path segment under <tmp>/ become XXXXXX (the fs.mkdtemp suffix).",
  "4 timings: every (N ms) timing, (Nms) or (N.Nms), is deleted, repeated until none remains.",
  "5 whitespace: every run of whitespace becomes one space, then the line is trimmed.",
  "6 markers: a leading reporter marker token (ℹ or #, followed by a space or the end of the line) is stripped, repeated until none remains.",
  "7 after the six steps: a line that normalizes to the empty string is dropped, then the drop class removes whole lines. The result is an UNORDERED MULTISET of lines (duplicates kept). Its canonical form is the lines sorted in ascending UTF-16 code-unit order (JavaScript's default sort, locale-independent). Stored and observed are compared in canonical form by exact equality of every element and of the length, never containment, never a hash. A stored causeLines not already in canonical form is refused.",
];

/** The drop class, stated as SHAPES (never as specific frames). Applied to normalized lines. */
const DROP_CLASS = [
  { shape: "stack frame", re: /^at (?:async )?(?:\S.*? \()?(?:<repo>|<tmp>|node:|file:|[A-Za-z]:\/|\/)[^()]*?(?::\d+){1,2}\)?(?: \{)?$/ },
  { shape: "stack frame", re: /^at (?:async )?\S.*? \((?:native|<anonymous>)\)(?: \{)?$/ },
  { shape: "runtime banner", re: /^Node\.js v\d+\.\d+\.\d+$/ },
  { shape: "internal module path", re: /^node:[\w/.-]+(?::\d+){0,2}$/ },
];
const DROP_CLASS_DECLARATION = [
  "stack frame: a line of the V8 frame shape, at [async] [<callee> (]<location>:<line>[:<col>][)] with an optional trailing { (the error's own property dump begins on that line), where <location> starts with <repo>, <tmp>, node:, file:, a drive letter or /; or a frame whose location is (native) or (<anonymous>).",
  "runtime banner: a line of the shape Node.js v<major>.<minor>.<patch>.",
  "internal module path: a line that is only a node: builtin module location, node:<id>[:<line>[:<col>]] (for example node:fs:441 or node:internal/modules/cjs/loader:1503). When it heads a runtime source excerpt (the next two lines are one source line and a line of only ^ carets), those two lines are the runtime's own source, not the test's, and are dropped with it.",
];

/** Stated ceilings: places where the lock provably cannot distinguish. A reader must see them here, not in a footnote. */
const CEILINGS = [
  "NON-INJECTIVE ESCAPE (lock collision): node's TAP comment escape renders a real tab and a literal backslash-t identically (likewise \\n, \\r, \\b, \\f, \\v). Two different source strings can therefore normalize identically.",
  "SEPARATOR COLLAPSE (lock collision): step 2 maps every backslash run to one /, so a message differing only in backslash count, or in \\ versus /, normalizes identically.",
  "TEST NAMES ARE METADATA: test names are not captured. Two tests failing with the same author lines and the same count normalize identically.",
  "SYNTHESIZED-SHAPE COLLISION: an author line printed as exactly Subtest: <x>, or a counter line after the top-level plan, is indistinguishable from the reporter's own and is not captured.",
  "TEMP MASK: step 3 masks the last 6 alphanumerics of ANY first segment under <tmp>/ (at least 6 alphanumerics long), not only real fs.mkdtemp suffixes.",
  "BENIGN OUTPUT CHURN BREAKS A LOCK: every author-emitted line is captured, so a harmless console-output change fails the lock. This is intended and fail-closed: for a rotted test, changed output is the moment to re-examine the entry.",
  "ORDER IS NOT LOCKED: the lock is the unordered multiset (duplicates kept), so a pure reordering of identical lines is not detected. The capture reads the TAP reporter's output, where a line from the child's stdout and a line from its stderr render as identical comment lines, so which stream a line came from, and therefore the cross-stream order, is not observable in what the capture consumes (the order is pipe scheduling; measured flapping on a control entry, 3 orderings in 6 passes). A different sub-case changes line CONTENT, and so changes the multiset. A line appearing twice and later once is a change and is detected.",
];

const ENTRY_FIELDS_REQUIRED = ["file", "causeLines", "failCount", "cause", "filedUnder", "expiry", "expiryVersion", "observedOn"];
const ENTRY_FIELDS_OPTIONAL = ["basePath"];
const LEGACY_EMPTY_SENTINEL = "(no failure line captured)";

function usage(msg) {
  if (msg) process.stderr.write(`run-tests: ${msg}\n`);
  process.stderr.write("usage: node scripts/checks/run-tests.js [--root <dir>] [--quarantine <file>] [--verify-base]\n");
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { root: DEFAULT_ROOT, quarantine: null, verifyBase: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root" || a === "--quarantine") {
      const v = argv[++i];
      if (!v) usage(`${a} needs a value`);
      opts[a.slice(2)] = path.resolve(v);
    } else if (a === "--verify-base") {
      opts.verifyBase = true;
    } else if (a === "--help" || a === "-h") {
      usage();
    } else {
      usage(`unknown argument: ${a}`);
    }
  }
  if (!opts.quarantine) opts.quarantine = path.join(opts.root, ...QUARANTINE_REL.split("/"));
  return opts;
}

/** The hermetic child environment: CHILD_ENV_ALLOWLIST applied to `source` (default: this process's env). */
function childEnv(source, platform) {
  const src = source || process.env;
  const allowed = new Set(((platform || process.platform) === "win32" ? CHILD_ENV_ALLOWLIST.win32 : CHILD_ENV_ALLOWLIST.other).map((n) => n.toUpperCase()));
  const env = {};
  for (const [k, v] of Object.entries(src)) if (allowed.has(k.toUpperCase()) && typeof v === "string") env[k] = v;
  return env; // NODE_TEST_CONTEXT is never allowed: children must not report into an enclosing test runner
}

function gitEnv() {
  const env = childEnv();
  for (const k of GIT_LOCATOR_ENV) delete env[k];
  return env;
}

function git(root, args, opts) {
  return spawnSync("git", args, { cwd: root, env: gitEnv(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true, ...(opts || {}) });
}

/** Test files git sees under root (tracked + untracked-not-ignored), existing on disk, sorted. */
function discoverTestFiles(root) {
  const r = git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...TEST_DIRS]);
  if (r.error) throw new Error(`git ls-files could not run: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`git ls-files exited ${r.status}: ${String(r.stderr).trim()}`);
  const files = new Set();
  for (const rel of String(r.stdout).split("\0")) {
    if (!rel || !TEST_FILE_RE.test(rel)) continue;
    if (!fs.existsSync(path.join(root, ...rel.split("/")))) continue;
    files.add(rel);
  }
  return [...files].sort();
}

// ─────────────────────────────── normalizer ───────────────────────────────

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** node's TAP comment escape (reporter/tap.js tapEscape), mirrored exactly, used to re-render YAML values. */
function tapCommentEscape(s) {
  return String(s)
    .replaceAll("\b", "\\b")
    .replaceAll("\f", "\\f")
    .replaceAll("\t", "\\t")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\v", "\\v")
    .replaceAll("\\", "\\\\")
    .replaceAll("#", "\\#");
}

/** The context the normalizer's step 3 needs: the repo root and the OS temp dir, both in / form. */
function normalizerContext(root, tmpdir) {
  const fwd = (p) => String(p || "").replace(/\\+/g, "/").replace(/\/+$/, "");
  const tmp = fwd(tmpdir === undefined ? os.tmpdir() : tmpdir);
  return { root: fwd(root), tmp: tmp && tmp !== "/" ? tmp : "" };
}

/** Apply the declared normalizer (NORMALIZER_DECLARATION steps 1-6) to ONE line. */
function normalizeLine(s, ctx) {
  let t = String(s);
  // 1 unescape (single left-to-right scan)
  t = t.replace(/\\([\\#])/g, "$1");
  // 2 separators
  t = t.replace(/\\+/g, "/");
  // 3 roots: repo root, THEN temp dir, then the mkdtemp suffix of the first segment under <tmp>/
  if (ctx.root) t = t.split(ctx.root).join("<repo>");
  if (ctx.tmp) {
    t = t.replace(new RegExp(`(?<![\\w>])${escapeRe(ctx.tmp)}(?![\\w.-])`, "g"), "<tmp>");
    t = t.replace(/<tmp>\/([^/\s'"`)\]]*?)[A-Za-z0-9]{6}(?=[/\s'"`)\]]|$)/g, "<tmp>/$1XXXXXX");
  }
  // 4 timings (repeated)
  for (let prev = null; prev !== t; ) {
    prev = t;
    t = t.replace(/\(\d+(?:\.\d+)?ms\)/g, "");
  }
  // 5 whitespace
  t = t.replace(/\s+/g, " ").trim();
  // 6 leading reporter marker tokens (repeated; the counts() alternation)
  for (let prev = null; prev !== t; ) {
    prev = t;
    t = t.replace(/^(?:ℹ|#)(?: |$)/, "");
  }
  return t;
}

function isFixedPoint(line, ctx) {
  return normalizeLine(line, ctx) === line;
}

function dropShape(line) {
  const hit = DROP_CLASS.find((d) => d.re.test(line));
  return hit ? hit.shape : null;
}

// ─────────────────────────────── capture ───────────────────────────────

/** Decode a util.inspect string literal ('…', "…" or `…`) as node's TAP reporter writes single-line YAML values. */
function decodeInspectLiteral(v) {
  const q = v[0];
  if (!(q === "'" || q === '"' || q === "`") || v.length < 2 || v[v.length - 1] !== q) return v;
  const body = v.slice(1, -1);
  let out = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c !== "\\" || i === body.length - 1) {
      out += c;
      continue;
    }
    const n = body[++i];
    const simple = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", 0: "\0" };
    if (n in simple) out += simple[n];
    else if (n === "x" && /^[0-9a-fA-F]{2}$/.test(body.slice(i + 1, i + 3))) {
      out += String.fromCharCode(parseInt(body.slice(i + 1, i + 3), 16));
      i += 2;
    } else if (n === "u" && body[i + 1] === "{") {
      const end = body.indexOf("}", i + 2);
      out += String.fromCodePoint(parseInt(body.slice(i + 2, end), 16));
      i = end;
    } else if (n === "u" && /^[0-9a-fA-F]{4}$/.test(body.slice(i + 1, i + 5))) {
      out += String.fromCharCode(parseInt(body.slice(i + 1, i + 5), 16));
      i += 4;
    } else out += n; // \\ \' \" \` and anything else: the escaped character itself
  }
  return out;
}

/**
 * Parse one YAML diagnostic block starting at lines[start] (the `---` line, indent `ind`).
 * Returns { end, error: string|null, authored: boolean }.
 *
 * KEY INDENT IS A PROPERTY, NOT A LITERAL (S-OS-06 r4 lane I6): a reporter may put the block's keys AT the
 * marker's indent (node 24: `  ---` then `  error: |-`) or DEEPER (`  ---` then `    error: |-`). Both are one
 * variance. The block's key indent is the indent of its first key-shaped line at >= ind, and the whole block is
 * read at that indent. A block scalar's content indent is the indent of its first content line, when deeper.
 */
function parseDiagnosticBlock(lines, start, ind) {
  let keyInd = -1;
  for (let j = start + 1; j < lines.length; j++) {
    if (lines[j] === `${" ".repeat(ind)}...`) break;
    const k = /^( *)[A-Za-z_][\w]*:(?: .*)?$/.exec(lines[j]);
    if (k && k[1].length >= ind) {
      keyInd = k[1].length;
      break;
    }
  }
  const keyRe = keyInd < 0 ? /(?!)/ : new RegExp(`^ {${keyInd}}([A-Za-z_][\\w]*):(?: (.*))?$`);
  const keys = new Map();
  let error = null;
  let i = start + 1;
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (l === `${" ".repeat(ind)}...`) break;
    const m = keyRe.exec(l);
    if (!m) continue;
    const key = m[1];
    const inline = m[2] === undefined ? "" : m[2];
    keys.set(key, inline);
    if (key !== "error") continue;
    if (/^\|[-+]?$/.test(inline)) {
      const next = i + 1 < lines.length ? /^( *)/.exec(lines[i + 1])[1].length : 0;
      const contentInd = " ".repeat(next > keyInd ? next : keyInd + 2);
      const body = [];
      while (i + 1 < lines.length && (lines[i + 1].startsWith(contentInd) || (lines[i + 1].trim() === "" && lines[i + 1] !== ""))) {
        body.push(lines[++i].slice(contentInd.length));
      }
      error = body.join("\n");
    } else {
      error = decodeInspectLiteral(inline);
    }
  }
  const failureType = keys.has("failureType") ? decodeInspectLiteral(keys.get("failureType")) : null;
  const authored = error !== null && AUTHOR_ERROR_FAILURE_TYPES.has(failureType) && !keys.has("exitCode");
  return { end: i, error, authored };
}

/**
 * Capture the cause lines from a TAP run's output.
 * Returns { lines, testNames } where lines are normalized, non-empty and outside the drop class, in the
 * order they appeared in the reporter's output. That order is NOT part of the lock: see causeMultiset().
 */
function captureCauseLines(output, ctx) {
  const all = String(output).split(/\r?\n/);
  let summaryFrom = -1;
  for (let i = all.length - 1; i >= 0; i--) {
    if (/^1\.\.\d+$/.test(all[i])) {
      summaryFrom = i;
      break;
    }
  }
  const rendered = [];
  const testNames = [];
  for (let i = 0; i < all.length; i++) {
    const l = all[i];
    const t = /^(\s*)(?:not )?ok \d+(?: - (.*))?$/.exec(l);
    if (t) {
      if (t[2] !== undefined) testNames.push(t[2].replace(/ # (?:SKIP|TODO)\b.*$/i, ""));
      if (i + 1 < all.length && all[i + 1] === `${t[1]}  ---`) {
        const b = parseDiagnosticBlock(all, i + 1, t[1].length + 2);
        if (b.authored) for (const el of b.error.split(/\r?\n/)) rendered.push(`# ${tapCommentEscape(el)}`);
        i = b.end;
      }
      continue;
    }
    const c = /^\s*#(?: (.*)|)$/.exec(l);
    if (!c) continue; // TAP version, plans, bail-outs, and the parent process's own non-TAP stderr
    if (summaryFrom >= 0 && i > summaryFrom) continue; // the reporter's run summary
    if (/^Subtest: /.test(c[1] || "")) continue; // the reporter's subtest announcement
    rendered.push(l);
  }
  const normalized = rendered.map((r) => normalizeLine(r, ctx)).filter((n) => n !== "");
  const lines = [];
  for (let i = 0; i < normalized.length; i++) {
    const n = normalized[i];
    const shape = dropShape(n);
    if (!shape) {
      lines.push(n);
      continue;
    }
    // an internal module path heading a runtime source excerpt takes the excerpt (source line + caret line) with it
    if (shape === "internal module path" && i + 2 < normalized.length && /^\^+$/.test(normalized[i + 2])) i += 2;
  }
  return { lines, testNames: testNames.map((n) => normalizeLine(`# ${n}`, ctx)).filter(Boolean) };
}

/**
 * THE LOCK IS THE UNORDERED MULTISET OF CAUSE LINES, DUPLICATES KEPT (β verdict 2d7f5b83, ledger row 479).
 * Its canonical form is the lines sorted by ascending UTF-16 code unit (the default sort: no locale).
 *
 * Why not the ordered sequence (the earlier rule, row 473 §2): order was never a property of the subject
 * under test. It is PIPE SCHEDULING. A lock that varies with which pipe the operating system drained first
 * asserts on the harness, not on the code. Measured: over six sequential passes of all 23 entries the
 * ordered sequence was identical for 22 of 23 (a CONTROL entry flapped, three distinct orderings) and the
 * multiset was identical for 23 of 23. The ordered form existed to stop a different sub-case failing behind
 * an identical lock; a different sub-case changes line CONTENT, so it changes the multiset, and order was
 * never doing that work. The only thing the ordered form catches that the multiset does not is a pure
 * reordering with identical content, which is exactly the scheduling artifact: the entire loss is false
 * positives.
 *
 * Why duplicates are kept (a multiset, not a set): a line appearing twice and later once is a real change,
 * and a plain set would erase it.
 *
 * Where the stream separation went, stated so nobody re-derives it as a miss: at the PROCESS layer the
 * child's stdout and stderr do arrive on separate pipes, so an implementation that read the child's pipes
 * directly could keep order WITHIN each stream, which is strictly more information. At the REPORTER layer,
 * which is what this capture consumes, the TAP reporter renders lines from both streams as identical comment
 * lines and the origin is erased in the bytes read here. The separation exists upstream and is DECLINED
 * DELIBERATELY, not missed: the multiset is measured, simple and reversible (row 479, epsilon's resolution).
 */
function causeMultiset(lines) {
  return [...lines].sort();
}

/** true iff a and b hold the same lines the same number of times (multiset equality, via canonical form). */
function sameMultiset(a, b) {
  // an EMPTY side is never a match: "I could not look" must never render as "it matches" (S-OS-06 r4 lane I6)
  return Array.isArray(a) && Array.isArray(b) && a.length > 0 && b.length > 0 && sameArray(causeMultiset(a), causeMultiset(b));
}

/** The multiset difference, for the violation report: lines (with multiplicity) only in a, and only in b. */
function multisetDifference(a, b) {
  const count = (xs) => xs.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map());
  const ca = count(a);
  const cb = count(b);
  const onlyA = [];
  const onlyB = [];
  for (const [x, n] of ca) for (let k = cb.get(x) || 0; k < n; k++) onlyA.push(x);
  for (const [x, n] of cb) for (let k = ca.get(x) || 0; k < n; k++) onlyB.push(x);
  return { onlyA: causeMultiset(onlyA), onlyB: causeMultiset(onlyB) };
}

/**
 * VACUITY (β row 473 §3), stated as a property: a sequence is vacuous when its content is fully derivable
 * from the entry's own metadata (its file path, base path, or test names), because then it distinguishes
 * nothing about the cause. An empty sequence is vacuous.
 */
function isVacuous(lines, { file, basePath, testNames }) {
  if (!Array.isArray(lines) || lines.length === 0) return true;
  const forms = [];
  for (const p of [file, basePath]) if (p) forms.push(`<repo>/${p}`, p);
  for (const n of testNames || []) if (n) forms.push(n);
  forms.sort((a, b) => b.length - a.length);
  return lines.every((line) => {
    let rest = line;
    for (const f of forms) rest = rest.split(f).join("");
    return !/[A-Za-z0-9]/.test(rest);
  });
}

// ─────────────────────────────── register ───────────────────────────────

function sameArray(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Load + validate the quarantine artifact. Throws on anything malformed (fail-closed). */
function loadQuarantine(file, root) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (e) {
    throw new Error(`cannot read quarantine artifact ${file}: ${e.message}`);
  }
  let doc;
  try {
    doc = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw); // tolerate a UTF-8 BOM
  } catch (e) {
    throw new Error(`quarantine artifact ${file} is not valid JSON: ${e.message}`);
  }
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.entries)) {
    throw new Error(`quarantine artifact ${file} must be an object with an "entries" array`);
  }
  // EMPTY-SUBJECT guard (β): the artifact must carry a numeric $floor, the minimum number of test files
  // discovery must find. A broken glob / empty tree that finds fewer than $floor is a FAILURE, not a pass.
  if (!Number.isInteger(doc.$floor) || doc.$floor < 1) {
    throw new Error(`quarantine artifact ${file} must carry an integer "$floor" >= 1 (the minimum discovered test-file count)`);
  }
  const problems = [];
  // BASE (β row 473 §4): a required register field naming the commit every entry was verified against.
  if (typeof doc.base !== "string" || !/^[0-9a-f]{40}$/.test(doc.base)) {
    problems.push(`"base" must be a full 40-hex commit id (the commit every entry was verified against)`);
  }
  // DECLARED = ACTUAL (β row 476 I7): the register declares exactly what this runner performs.
  if (!sameArray(doc.$normalizer, NORMALIZER_DECLARATION)) problems.push(`"$normalizer" must equal the runner's declared normalizer (declared-versus-actual; see NORMALIZER_DECLARATION in run-tests.js)`);
  if (!sameArray(doc.$dropClass, DROP_CLASS_DECLARATION)) problems.push(`"$dropClass" must equal the runner's declared drop class (see DROP_CLASS_DECLARATION in run-tests.js)`);
  if (!sameArray(doc.$ceilings, CEILINGS)) problems.push(`"$ceilings" must equal the runner's stated ceilings (see CEILINGS in run-tests.js)`);
  const ctx = normalizerContext(root);
  const seen = new Set();
  doc.entries.forEach((e, i) => {
    const at = `entries[${i}]`;
    if (!e || typeof e !== "object" || Array.isArray(e)) return problems.push(`${at} is not an object`);
    const who = `${at} (${typeof e.file === "string" ? e.file : "?"})`;
    for (const k of Object.keys(e)) {
      if (!ENTRY_FIELDS_REQUIRED.includes(k) && !ENTRY_FIELDS_OPTIONAL.includes(k)) problems.push(`${who} has an unknown field "${k}"`);
    }
    for (const f of ["file", "cause", "filedUnder", "expiry", "expiryVersion"]) {
      if (typeof e[f] !== "string" || e[f].trim() === "") problems.push(`${who} is missing a non-empty "${f}"`);
    }
    // per-test count-lock (β per-TEST grain): the number of failing tests the entry absolves.
    if (!Number.isInteger(e.failCount) || e.failCount < 1) problems.push(`${who} needs an integer "failCount" >= 1 (the failing-test count this entry absolves)`);
    // per-entry expiry ON THE TREE VERSION (β): a semver at which the quarantine MUST be empty.
    if (typeof e.expiryVersion === "string" && !parseSemver(e.expiryVersion)) problems.push(`${who} "expiryVersion" must be a semver a.b.c`);
    // PROVENANCE STAMP (β row 473 §5): platform, node major and reporter of the registering observation.
    const o = e.observedOn;
    if (!o || typeof o !== "object" || Array.isArray(o) || typeof o.platform !== "string" || !o.platform || !Number.isInteger(o.nodeMajor) || o.nodeMajor < 1 || typeof o.reporter !== "string") {
      problems.push(`${who} needs an "observedOn" stamp { platform, nodeMajor, reporter } (an unstamped entry is refused)`);
    } else if (o.reporter !== REPORTER) {
      problems.push(`${who} "observedOn.reporter" is "${o.reporter}"; the reporter is pinned to "${REPORTER}"`);
    }
    // CAUSE LINES: a non-empty multiset of stored lines, each a FIXED POINT of the normalizer, stored in
    // canonical (sorted) form so the stored array is a fixed point of the whole capture, order included.
    if (!Array.isArray(e.causeLines) || e.causeLines.length === 0) {
      problems.push(`${who} is missing a non-empty "causeLines" array (the multiset of cause lines, in canonical order)`);
    } else {
      if (e.causeLines.every((l) => typeof l === "string") && !sameArray(e.causeLines, causeMultiset(e.causeLines))) {
        const k = e.causeLines.findIndex((l, j) => l !== causeMultiset(e.causeLines)[j]);
        problems.push(`${who} "causeLines" is not in canonical order (ascending UTF-16 code units; first out of place at causeLines[${k}]): the lock is an unordered multiset, so its stored form is the sorted one and any other order is refused`);
      }
      e.causeLines.forEach((line, j) => {
        if (typeof line !== "string" || line === "") return problems.push(`${who} causeLines[${j}] must be a non-empty string`);
        if (line === LEGACY_EMPTY_SENTINEL) return problems.push(`${who} causeLines[${j}] is the empty-capture placeholder, not an observation`);
        if (!isFixedPoint(line, ctx)) return problems.push(`${who} causeLines[${j}] is not a fixed point of the normalizer (stored and observed text would not have had identical treatment): ${JSON.stringify(line)} normalizes to ${JSON.stringify(normalizeLine(line, ctx))}`);
        const shape = dropShape(line);
        if (shape) problems.push(`${who} causeLines[${j}] is in the drop class (${shape}) and can never be observed: ${JSON.stringify(line)}`);
      });
      if (isVacuous(e.causeLines, { file: e.file, basePath: e.basePath })) problems.push(`${who} "causeLines" is vacuous: its content is fully derivable from the entry's own metadata`);
    }
    if (typeof e.file !== "string") return;
    if (!TEST_FILE_RE.test(e.file) || e.file.split("/").includes("..")) {
      problems.push(`${at} file "${e.file}" is not a repo-relative scripts/** or tests/** *.test.js path`);
    }
    if (e.basePath !== undefined && (typeof e.basePath !== "string" || !TEST_FILE_RE.test(e.basePath) || e.basePath.split("/").includes("..") || e.basePath === e.file)) {
      problems.push(`${who} "basePath" must be a repo-relative *.test.js path different from "file" (absent means identical)`);
    }
    if (seen.has(e.file)) problems.push(`${at} file "${e.file}" is quarantined more than once`);
    seen.add(e.file);
  });
  if (problems.length) throw new Error(`quarantine artifact ${file} is malformed:\n  - ${problems.join("\n  - ")}`);
  return { entries: doc.entries, floor: doc.$floor, base: doc.base };
}

/** The REAL register (this runner's own repo) must name EXPECTED_REAL_BASE. A fixture's register is a different register. */
function checkRealRegisterBase(quarantineFile, base) {
  const real = path.resolve(DEFAULT_ROOT, ...QUARANTINE_REL.split("/"));
  const same = process.platform === "win32" ? path.resolve(quarantineFile).toLowerCase() === real.toLowerCase() : path.resolve(quarantineFile) === real;
  if (same && base !== EXPECTED_REAL_BASE) {
    return `the real register ${QUARANTINE_REL} names base ${base}, but the expected pre-sprint base is ${EXPECTED_REAL_BASE}; changing it is refused here (this is a runner check, not freeze coverage)`;
  }
  return null;
}

/** Base-identity problems for one entry, or [] (existence at base; basePath must be a pair-limited rename). */
function baseIdentityProblems(root, base, e) {
  const basePathEff = e.basePath || e.file;
  const exists = git(root, ["cat-file", "-e", `${base}:${basePathEff}`]);
  if (exists.error) return [`NOT VERIFIABLE AT BASE: ${e.file}: git could not run: ${exists.error.message}`];
  if (exists.status !== 0) {
    return [
      e.basePath
        ? `NOT AT BASE: ${e.file} names basePath ${e.basePath}, which does not exist at base ${base}`
        : `NOT AT BASE: ${e.file} does not exist at base ${base} (a test absent at base is not pre-existing rot and cannot be quarantined; if it was renamed, record "basePath")`,
    ];
  }
  if (!e.basePath) return [];
  const d = git(root, ["-c", "diff.renames=true", "diff", `-M${RENAME_SIMILARITY}`, "--name-status", base, "HEAD", "--", e.basePath, e.file]);
  if (d.error || d.status !== 0) return [`BASEPATH NOT VERIFIABLE: ${e.file}: git diff failed (${d.error ? d.error.message : String(d.stderr).trim()})`];
  const want = new RegExp(`^R\\d{3}\\t${escapeRe(e.basePath)}\\t${escapeRe(e.file)}$`);
  if (!String(d.stdout).split(/\r?\n/).some((l) => want.test(l))) {
    return [`BASEPATH NOT A RENAME: ${e.file} names basePath ${e.basePath}, but the pair-limited diff ${base.slice(0, 12)}..HEAD at -M${RENAME_SIMILARITY} does not report a rename between them: ${JSON.stringify(String(d.stdout).trim())}`];
  }
  return [];
}

// ─────────────────────────────── running ───────────────────────────────

function batches(files) {
  const out = [];
  let cur = [];
  let len = 0;
  for (const f of files) {
    if (cur.length && len + f.length + 1 > MAX_BATCH_CHARS) {
      out.push(cur);
      cur = [];
      len = 0;
    }
    cur.push(f);
    len += f.length + 1;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** The spawn arguments for a test run. The reporter is pinned here, for the primary run AND each quarantined file. */
function nodeTestArgs(files) {
  return ["--test", `--test-reporter=${REPORTER}`, ...files];
}

/**
 * Run `node --test --test-reporter=tap <files>` from root. Resolves { status, signal, error, output }.
 * status is a number only when the child really exited; anything else is not an observation.
 */
function runNodeTest(root, files, { tee, timeoutMs }) {
  return new Promise((resolve) => {
    let output = "";
    let truncated = false;
    const capture = (chunk, stream) => {
      const s = chunk.toString("utf8");
      if (tee) stream.write(s);
      output += s;
      if (output.length > CAPTURE_LIMIT) {
        output = output.slice(-CAPTURE_LIMIT);
        truncated = true;
      }
    };
    let settled = false;
    let timedOut = false;
    const done = (res) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ output, truncated, ...res });
    };
    let child;
    try {
      child = spawn(process.execPath, nodeTestArgs(files), { cwd: root, env: childEnv(), windowsHide: true });
    } catch (e) {
      return resolve({ status: null, signal: null, error: `spawn failed: ${e.message}`, output, truncated });
    }
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.on("data", (c) => capture(c, process.stdout));
    child.stderr.on("data", (c) => capture(c, process.stderr));
    child.on("error", (e) => done({ status: null, signal: null, error: `spawn error: ${e.message}` }));
    child.on("close", (code, signal) => {
      if (timedOut) return done({ status: null, signal, error: `timed out after ${timeoutMs}ms` });
      if (typeof code !== "number") return done({ status: null, signal, error: `killed by ${signal || "unknown signal"} (no exit code)` });
      done({ status: code, signal: null, error: null });
    });
  });
}

/** Last reported value of each node:test summary counter (spec "ℹ pass 3" or tap "# pass 3"). */
function counts(output) {
  const c = {};
  const re = /^(?:ℹ|#) (tests|pass|fail|cancelled|skipped|todo) (\d+)\s*$/gm;
  let m;
  while ((m = re.exec(output))) c[m[1]] = Number(m[2]);
  return c;
}

/** Count reported test failures in node:test output (for the per-test count-lock). */
function failCount(output) {
  const c = counts(output);
  return typeof c.fail === "number" ? c.fail : null;
}

/**
 * The per-entry lock decision for a quarantined file that FAILED with an exit code (extracted in S-OS-06 r4 lane I8
 * so every layer can be planted exactly). Inputs are observations: `observed` = the canonical cause multiset,
 * `testNames` = the capture's test names, `fc` = the observed failing-test count (null = not observed),
 * `tv` = tree version (parsed semver or null), `here` = this platform stamp.
 * -> { findings: [{ rule, message }], unobserved: boolean }. No findings = the entry still fails as registered.
 */
function lockVerdict(e, { observed, testNames, fc, tv, here }) {
  const findings = [];
  const add = (rule, message) => findings.push({ rule, message });
  const ev = parseSemver(e.expiryVersion);
  const stampDiffers = e.observedOn.platform !== here.platform || e.observedOn.nodeMajor !== here.nodeMajor;
  let unobserved = false;
  if (observed.length === 0) {
    // INDETERMINATE (β row 490, α r-32): an EMPTY observed capture means the runner could not look. It knows
    // nothing about whether the cause changed, so it REFUSES, independently of the vacuity rule below. It may never pass.
    unobserved = true;
    add("INDETERMINATE", `INDETERMINATE: ${e.file} fails, but the observed cause capture is EMPTY — the runner could not look, which is not an observation that the cause is unchanged; refused`);
  } else if (isVacuous(observed, { file: e.file, basePath: e.basePath, testNames })) {
    add("CAUSE-LOCK", `CAUSE-LOCK: ${e.file} fails, but the observed cause lines are vacuous (empty, or derivable from the file path and test names) — nothing distinguishes this failure\n${listing(observed)}`);
  } else if (!sameMultiset(observed, e.causeLines)) {
    const diff = multisetDifference(observed, e.causeLines);
    add(
      "CAUSE-LOCK",
      `CAUSE-LOCK: ${e.file} fails, but the multiset of its cause lines does not equal the registered one — a NEW/different regression the quarantine must not absolve.` +
        `\n    observed but not registered (${diff.onlyA.length}):\n${listing(diff.onlyA)}\n    registered but not observed (${diff.onlyB.length}):\n${listing(diff.onlyB)}` +
        (stampDiffers
          ? ` Registered on ${e.observedOn.platform}/node${e.observedOn.nodeMajor}, observed on ${here.platform}/node${here.nodeMajor}: per the pre-committed interpretation this is a FINDING ABOUT THE NORMALIZER, not a violation to wave through.`
          : "") +
        `\n    observed, canonical order (${observed.length}):\n${listing(observed)}\n    registered, canonical order (${e.causeLines.length}):\n${listing(e.causeLines)}`
    );
  } else if (fc !== null && fc > e.failCount) {
    add("COUNT-LOCK", `COUNT-LOCK: ${e.file} now has ${fc} failing test(s), more than the registered ${e.failCount} — a new failing test the quarantine must not absolve`);
  } else if (ev && tv && semverGte(tv, ev)) {
    add("EXPIRED", `EXPIRED: ${e.file} quarantine expired at ${e.expiryVersion} (tree ${tv.join(".")}) — resolve the rot or re-warrant [${e.filedUnder}, ${e.expiry}]`);
  }
  return { findings, unobserved };
}

/** Parse a semver "a.b.c" -> [a,b,c] or null. */
function parseSemver(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v || "").trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
/** true iff version a >= b (both parsed semvers). */
function semverGte(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return true;
}
/** The tree's own version (package.json), for per-entry expiry checks. null if unreadable. */
function treeVersion(root) {
  try {
    return parseSemver(JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version);
  } catch {
    return null;
  }
}

function currentStamp() {
  return { platform: process.platform, nodeMajor: Number(process.versions.node.split(".")[0]), reporter: REPORTER };
}

function listing(lines) {
  return lines.length ? lines.map((l, i) => `      ${String(i + 1).padStart(2)}| ${l}`).join("\n") : "      (none)";
}

/** Materialize <base> into a fresh temp dir (read-tree into a temp index + checkout-index). Returns the dir. */
function materializeBase(root, base) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "run-tests-base-"));
  const index = path.join(dir, ".base-index");
  const env = { ...gitEnv(), GIT_INDEX_FILE: index };
  const rt = spawnSync("git", ["read-tree", base], { cwd: root, env, encoding: "utf8", windowsHide: true });
  if (rt.error || rt.status !== 0) throw new Error(`git read-tree ${base} failed: ${rt.error ? rt.error.message : rt.stderr}`);
  const co = spawnSync("git", ["checkout-index", "-a", "-f", `--prefix=${dir}${path.sep}`], { cwd: root, env, encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (co.error || co.status !== 0) throw new Error(`git checkout-index of ${base} failed: ${co.error ? co.error.message : co.stderr}`);
  fs.rmSync(index, { force: true });
  return dir;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const log = (s) => process.stdout.write(`${s}\n`);

  let discovered;
  let entries;
  let floor;
  let base;
  try {
    discovered = discoverTestFiles(opts.root);
    ({ entries, floor, base } = loadQuarantine(opts.quarantine, opts.root));
  } catch (e) {
    log(`run-tests: FAIL — ${e.message}`);
    return 1;
  }
  const realBaseProblem = checkRealRegisterBase(opts.quarantine, base);
  if (realBaseProblem) {
    log(`run-tests: FAIL — ${realBaseProblem}`);
    return 1;
  }
  const baseCommit = git(opts.root, ["cat-file", "-e", `${base}^{commit}`]);
  if (baseCommit.error || baseCommit.status !== 0) {
    log(`run-tests: FAIL — the register's base ${base} is not a commit available in ${opts.root} (a shallow clone cannot verify base identity; that is a failure, not a skip)`);
    return 1;
  }
  // EMPTY-SUBJECT / broken-glob guard (β): discovery must find at least $floor test files.
  if (discovered.length < floor) {
    log(`run-tests: FAIL — discovered only ${discovered.length} test file(s), below the committed floor of ${floor} — a broken glob or empty tree is not a pass`);
    return 1;
  }
  log(`run-tests: discovered ${discovered.length} test file(s) (floor ${floor}); reporter pinned to ${REPORTER}; register base ${base}`);
  const bad = discovered.filter((f) => GLOB_META_RE.test(f));
  if (bad.length) {
    log(`run-tests: FAIL — test file path(s) contain glob metacharacters and cannot be passed literally to node --test: ${bad.join(", ")}`);
    return 1;
  }

  const discoveredSet = new Set(discovered);
  const quarantined = new Set(entries.map((e) => e.file));
  const primaryFiles = discovered.filter((f) => !quarantined.has(f));
  const violations = [];
  const ctx = normalizerContext(opts.root);
  const here = currentStamp();

  // ---- PRIMARY ----
  let primaryExit = 0;
  const primaryCounts = { tests: 0, pass: 0, fail: 0, cancelled: 0, skipped: 0, todo: 0 };
  const primaryBatches = batches(primaryFiles);
  if (primaryFiles.length === 0) {
    log("run-tests: FAIL — zero non-quarantined test files to run (nothing run is not a pass)");
    primaryExit = 1;
  }
  for (let i = 0; i < primaryBatches.length; i++) {
    const b = primaryBatches[i];
    log(`run-tests: primary batch ${i + 1}/${primaryBatches.length} — node --test --test-reporter=${REPORTER} ${b.length} file(s)`);
    const r = await runNodeTest(opts.root, b, { tee: true, timeoutMs: PRIMARY_BATCH_TIMEOUT_MS });
    const c = counts(r.output);
    for (const k of Object.keys(primaryCounts)) primaryCounts[k] += c[k] || 0;
    if (r.status === null) {
      log(`run-tests: primary batch ${i + 1} did not exit with a code (${r.error}) — FAILURE`);
      if (primaryExit === 0) primaryExit = 1;
    } else if (r.status !== 0 && primaryExit === 0) {
      primaryExit = r.status;
    }
  }

  // ---- QUARANTINE TEETH ----
  let stillFailing = 0;
  let unexpectedlyPassed = 0;
  let missing = 0;
  let unobserved = 0;
  let notAtBase = 0;
  let baseDir = null;
  if (opts.verifyBase) {
    try {
      baseDir = materializeBase(opts.root, base);
    } catch (e) {
      log(`run-tests: FAIL — --verify-base could not materialize base ${base}: ${e.message}`);
      return 1;
    }
  }
  try {
    for (const e of entries) {
      const abs = path.join(opts.root, ...e.file.split("/"));
      if (!fs.existsSync(abs)) {
        missing++;
        violations.push(`MISSING: quarantined file ${e.file} no longer exists on disk — remove its entry from the quarantine`);
        continue;
      }
      if (!discoveredSet.has(e.file)) {
        missing++;
        violations.push(`NOT DISCOVERED: quarantined file ${e.file} exists but is not a discovered test file (gitignored?) — the quarantine cannot subtract it`);
        continue;
      }
      const baseProblems = baseIdentityProblems(opts.root, base, e);
      if (baseProblems.length) {
        notAtBase++;
        violations.push(...baseProblems);
        continue;
      }
      if (baseDir) {
        const bp = e.basePath || e.file;
        const br = await runNodeTest(baseDir, [bp], { tee: false, timeoutMs: QUARANTINE_FILE_TIMEOUT_MS });
        if (br.status === null || br.status === 0) {
          notAtBase++;
          violations.push(`DOES NOT FAIL AT BASE: ${bp} at ${base} ${br.status === 0 ? "passes (exit 0)" : `did not exit with a code (${br.error})`} — the entry is not pre-existing rot`);
          continue;
        }
        // "fails at base" is the claim. Whether the cause lines are ALSO identical at base is reported, never required:
        // the codemod rewrote text inside at least one entry's own cause line, so the stronger claim cannot hold.
        const baseLines = captureCauseLines(br.output, normalizerContext(baseDir)).lines;
        log(`run-tests: base check ${bp} fails at ${base.slice(0, 8)} (exit ${br.status}); cause-line multiset at base ${sameMultiset(baseLines, e.causeLines) ? "EQUALS the register" : `DIFFERS from the register (informational):\n${listing(causeMultiset(baseLines))}`}`);
      }
      const r = await runNodeTest(opts.root, [e.file], { tee: false, timeoutMs: QUARANTINE_FILE_TIMEOUT_MS });
      if (r.status === null || r.truncated) {
        unobserved++;
        violations.push(`UNOBSERVED: quarantined file ${e.file} ${r.truncated ? `produced more than ${CAPTURE_LIMIT} bytes (a truncated capture is not an observation)` : `did not exit with a code (${r.error})`} — not an observation that it still fails`);
      } else if (r.status === 0) {
        unexpectedlyPassed++;
        violations.push(`UNEXPECTEDLY PASSED: quarantined file ${e.file} now passes (exit 0) — its disposition is no longer true; remove its entry from the quarantine`);
      } else {
        // CAUSE-LOCK (β): the observed MULTISET of cause lines (duplicates kept, order not locked; see causeMultiset)
        // must EQUAL the registered one, otherwise the entry would silently absolve a NEW/different regression.
        // COUNT-LOCK: no more failing tests than registered (per-TEST grain), a separate redundant check.
        // EXPIRY: the entry must not be past its tree-version expiry.
        const cap = captureCauseLines(r.output, ctx);
        const observed = causeMultiset(cap.lines);
        const verdict = lockVerdict(e, { observed, testNames: cap.testNames, fc: failCount(r.output), tv: treeVersion(opts.root), here });
        if (verdict.unobserved) unobserved++;
        if (verdict.findings.length) {
          for (const f of verdict.findings) violations.push(f.message);
        } else {
          stillFailing++;
          log(`run-tests: quarantine ${e.file} still fails (exit ${r.status}) [${e.cause}; ${e.filedUnder}; expiry ${e.expiry} / <${e.expiryVersion}]${e.basePath ? ` [basePath ${e.basePath}]` : ""} — ${observed.length} cause line(s), a multiset equal to the register:\n${listing(observed)}`);
        }
      }
    }
  } finally {
    if (baseDir) {
      try {
        fs.rmSync(baseDir, { recursive: true, force: true, maxRetries: 3 });
      } catch {
        /* temp dir; best effort on Windows file locks */
      }
    }
  }
  for (const v of violations) log(`run-tests: QUARANTINE VIOLATION — ${v}`);

  const quarantineOk = violations.length === 0;
  const ok = primaryExit === 0 && quarantineOk;
  log(
    `run-tests: ${ok ? "PASS" : "FAIL"} — primary: ${primaryFiles.length} file(s) in ${primaryBatches.length} batch(es), exit ${primaryExit} ` +
      `(tests ${primaryCounts.tests}, pass ${primaryCounts.pass}, fail ${primaryCounts.fail}, cancelled ${primaryCounts.cancelled}, skipped ${primaryCounts.skipped}, todo ${primaryCounts.todo}) · ` +
      `quarantine: ${entries.length} entr${entries.length === 1 ? "y" : "ies"}, ${stillFailing} still failing, ${unexpectedlyPassed} unexpectedly passed, ${missing} missing/undiscovered, ${unobserved} unobserved, ${notAtBase} not verified at base`
  );
  if (primaryExit !== 0) return primaryExit;
  return quarantineOk ? 0 : 1;
}

module.exports = {
  REPORTER,
  EXPECTED_REAL_BASE,
  RENAME_SIMILARITY,
  NORMALIZER_DECLARATION,
  CHILD_ENV_ALLOWLIST,
  childEnv,
  DROP_CLASS_DECLARATION,
  CEILINGS,
  AUTHOR_ERROR_FAILURE_TYPES,
  nodeTestArgs,
  normalizerContext,
  normalizeLine,
  isFixedPoint,
  dropShape,
  tapCommentEscape,
  decodeInspectLiteral,
  captureCauseLines,
  causeMultiset,
  sameMultiset,
  multisetDifference,
  isVacuous,
  loadQuarantine,
  checkRealRegisterBase,
  baseIdentityProblems,
  runNodeTest,
  currentStamp,
  failCount,
  lockVerdict,
};

if (require.main === module) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      process.stdout.write(`run-tests: FAIL — runner crashed: ${e && e.stack ? e.stack : e}\n`);
      process.exitCode = 1;
    }
  );
}
