#!/usr/bin/env node
"use strict";

/**
 * gate-failclosed-audit.js
 *
 * PROPERTY THIS DETECTOR SERVES (quoted verbatim from the authorizing brief,
 * SP-20260829-001 bundle B1):
 *
 *   "Every failure on a path the decision depends on must terminate on the
 *   restrictive side of that gate's own decision — never at a permissive
 *   outcome reached by having skipped the decision. (Pre-decision failure
 *   kinds seen so far include payload parse, store read, validator run and
 *   discriminator read; the list is illustrative, not definitional.)"
 *
 * NOTE what this does NOT say: it does not say "terminates non-zero". A
 * *grant* gate — one whose decision is to bestow elevated permission — is
 * RESTRICTIVE when it exits 0 without granting. scripts/hooks/authorization-gate.js
 * around its `catch { process.exit(0); }` fallback is exactly that case: a
 * detector that flags it as a bug is WORSE than no detector, because
 * "fixing" it would make the system less safe. Polarity is per-gate and is
 * a human judgment recorded elsewhere — this module does NOT judge polarity.
 * It only finds and reports catch clauses whose handler body can reach a
 * permissive-shaped outcome (process.exit(0) or a `{ ok: true, ... }`-shaped
 * return), honestly scoped to what it can and cannot see.
 *
 * CEILING (state it, do not overstate it):
 *   CLOSES: nested braces inside the handler, unbounded handler length,
 *   string-literal false positives, process.exit(0) spacing variants,
 *   quoted/reordered success-object keys, method-named-`catch` false
 *   positives (no preceding `try` block), and the single-statement
 *   unconditional-`throw`-makes-the-rest-unreachable case.
 *   DOES NOT CLOSE: reachability in the general case (e.g. a catch that
 *   sets a flag and falls through to a LATER, separate exit/return site),
 *   full control-flow / data-flow polarity, dynamically registered
 *   callbacks, error-first callbacks, event-emitter `.on('error', ...)`
 *   handlers, cross-file propagation, and template-literal `${...}`
 *   expressions containing further nested template literals (those are
 *   masked opaquely rather than recursively re-lexed).
 *   Regex-literal vs. division-operator disambiguation is heuristic
 *   (previous-significant-token based), not a full parser.
 *   `wired` status is a substring match of the file's repo-relative path
 *   inside the raw text of .claude/settings.json, NOT a structural parse of
 *   the hooks config — it can false-positive if the path string appears in
 *   an unrelated field, and it correctly degrades to "unknown" (never
 *   "false") when settings.json cannot be read or parsed.
 *   NESTED-TRY BLIND SPOT (found by SP-20260829-001 bundle B2 reading seeded
 *   registry sites directly, not fixed by B2 — out of that bundle's scope):
 *   findCatchHandlers() advanced its scan cursor to `handlerEnd + 1` after
 *   matching an outer try/catch, which skips back OVER that outer pair's own
 *   span — so a try/catch textually NESTED inside the outer try's body (or
 *   inside its already-matched catch handler) was never independently
 *   examined. This is a DIFFERENT failure shape than the "flag-then-later-
 *   SIBLING-exit" reachability gap stated above: it is an EARLIER, NESTED
 *   site the scan never revisits, not a later one it never looks ahead to.
 *   Confirmed against 4 real, directly-read registry sites this module's own
 *   live scan could not reach for exactly this reason (see
 *   scripts/checks/gate-failclosed-registry.json's tool_correlation_note).
 *   This means the enumeration this module claims ("the N sites this
 *   detector found") was narrower than even its own reachable-syntax ceiling
 *   implied — a new, untriaged site sitting inside an already-matched outer
 *   try was invisible to it.
 *
 * Output is *"the N sites this detector at <sha> found, ceiling as stated"*
 * — never "the population", never "all fail-open sites". No bare count
 * anywhere without the emitted list it derives from. An omitted/unknowable
 * field reads as UNKNOWN, never as "nothing to report".
 *
 * Node built-ins only. No dependencies (MC has no package.json / node_modules).
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const PROPERTY_TEXT =
  "Every failure on a path the decision depends on must terminate on the " +
  "restrictive side of that gate's own decision — never at a permissive " +
  "outcome reached by having skipped the decision. (Pre-decision failure " +
  "kinds seen so far include payload parse, store read, validator run and " +
  "discriminator read; the list is illustrative, not definitional.)";

const CEILING_TEXT =
  "CLOSES: nested braces, unbounded handler length, string-literal false " +
  "positives, process.exit(0) spacing variants, quoted/reordered " +
  "success-object keys, method-named-catch false positives, unconditional " +
  "top-level throw-makes-rest-unreachable. DOES NOT CLOSE: general " +
  "reachability (flag-then-later-exit), full control-flow/data-flow " +
  "polarity, dynamically registered callbacks, error-first callbacks, " +
  "event-emitter error handlers, cross-file propagation, nested template " +
  "literals inside ${...} (masked opaquely), regex-vs-division " +
  "disambiguation (heuristic), and structural (vs. substring) settings.json " +
  "hook-wiring parse. NESTED-TRY BLIND SPOT (found by SP-20260829-001 bundle " +
  "B2, not fixed by B2): findCatchHandlers() previously advanced its scan " +
  "cursor past an outer try/catch's own span after matching it, so a " +
  "try/catch nested inside that outer try's body or its already-matched " +
  "catch handler was never independently examined — a different shape than " +
  "the flag-then-later-SIBLING-exit gap above (this is an earlier, NESTED " +
  "site the scan never revisits, not a later one it never looks ahead to). " +
  "Confirmed against 4 real registry sites the live scan could not reach " +
  "for exactly this reason; see gate-failclosed-registry.json's " +
  "tool_correlation_note. The detector's own enumeration was narrower than " +
  "its stated reachable-syntax ceiling implied.";

const SKIP_DIRS = new Set([
  ".git",
  ".worktrees",
  "node_modules",
  ".claude", // settings.json etc. live here; hooks under .claude are still
  // reachable if --root explicitly targets them, but the default walk
  // (scripts/) does not descend into .claude to avoid re-walking every
  // isolation worktree nested under .claude/worktrees.
]);

// ---------------------------------------------------------------------------
// Lexer: single-pass scanner producing a same-length "clean" buffer with
// string/template-text/comment/regex contents masked to spaces (newlines
// preserved for line-number accuracy). Real code — identifiers, keywords,
// punctuation, and the code inside `${...}` template expressions — is left
// intact so brace matching and keyword search operate on real code only.
// ---------------------------------------------------------------------------
function cleanSource(src) {
  const n = src.length;
  const out = src.split("");
  let i = 0;
  let lastSig = ""; // last significant code character (for regex heuristic)
  let lastWord = ""; // last identifier/keyword scanned

  const regexPrevChars = new Set([
    "(", ",", ";", ":", "=", "&", "|", "!", "?", "{", "}", "[", "<", ">",
    "+", "-", "*", "%", "^", "~", "\n", "",
  ]);
  const regexPrevWords = new Set([
    "return", "typeof", "case", "do", "else", "yield", "in", "of", "new",
    "delete", "void", "throw", "instanceof",
  ]);

  function mask(a, b) {
    for (let k = a; k < b; k++) {
      if (out[k] !== "\n") out[k] = " ";
    }
  }

  while (i < n) {
    const c = src[i];

    // line comment
    if (c === "/" && src[i + 1] === "/") {
      let j = i;
      while (j < n && src[j] !== "\n") j++;
      mask(i, j);
      i = j;
      continue;
    }

    // block comment
    if (c === "/" && src[i + 1] === "*") {
      let j = i + 2;
      while (j < n && !(src[j] === "*" && src[j + 1] === "/")) j++;
      j = Math.min(j + 2, n);
      mask(i, j);
      i = j;
      continue;
    }

    // single/double-quoted string
    if (c === "'" || c === '"') {
      const quote = c;
      let j = i + 1;
      while (j < n && src[j] !== quote) {
        if (src[j] === "\\") j += 2;
        else j++;
      }
      j = Math.min(j + 1, n);
      mask(i, j);
      lastSig = quote;
      lastWord = "";
      i = j;
      continue;
    }

    // template literal (backtick), with real ${...} expression code kept live
    if (c === "`") {
      let j = i + 1;
      let inExpr = false;
      let depth = 0;
      while (j < n) {
        if (!inExpr) {
          if (src[j] === "\\") {
            j += 2;
            continue;
          }
          if (src[j] === "`") {
            j++;
            break;
          }
          if (src[j] === "$" && src[j + 1] === "{") {
            inExpr = true;
            depth = 1;
            j += 2;
            continue;
          }
          if (out[j] !== "\n") out[j] = " ";
          j++;
          continue;
        }
        // inside ${ ... } — real code
        const ch = src[j];
        if (ch === "{") {
          depth++;
          j++;
          continue;
        }
        if (ch === "}") {
          depth--;
          j++;
          if (depth === 0) inExpr = false;
          continue;
        }
        if (ch === "'" || ch === '"') {
          const q = ch;
          let k = j + 1;
          while (k < n && src[k] !== q) {
            if (src[k] === "\\") k += 2;
            else k++;
          }
          k = Math.min(k + 1, n);
          mask(j, k);
          j = k;
          continue;
        }
        if (ch === "`") {
          // Nested template literal inside an interpolation: masked opaquely
          // rather than recursively re-lexed. Stated ceiling item.
          let k = j + 1;
          while (k < n && src[k] !== "`") {
            if (src[k] === "\\") k += 2;
            else k++;
          }
          k = Math.min(k + 1, n);
          mask(j, k);
          j = k;
          continue;
        }
        if (ch === "/" && src[j + 1] === "/") {
          let k = j;
          while (k < n && src[k] !== "\n") k++;
          mask(j, k);
          j = k;
          continue;
        }
        if (ch === "/" && src[j + 1] === "*") {
          let k = j + 2;
          while (k < n && !(src[k] === "*" && src[k + 1] === "/")) k++;
          k = Math.min(k + 2, n);
          mask(j, k);
          j = k;
          continue;
        }
        j++;
      }
      i = j;
      lastSig = "";
      lastWord = "";
      continue;
    }

    // regex literal (heuristic: previous significant token decides)
    if (c === "/") {
      const allow = regexPrevChars.has(lastSig) || regexPrevWords.has(lastWord);
      if (allow) {
        let j = i + 1;
        let inClass = false;
        let ok = false;
        while (j < n) {
          if (src[j] === "\\") {
            j += 2;
            continue;
          }
          if (src[j] === "[") {
            inClass = true;
            j++;
            continue;
          }
          if (src[j] === "]") {
            inClass = false;
            j++;
            continue;
          }
          if (src[j] === "\n") break; // not a regex after all — bail safely
          if (src[j] === "/" && !inClass) {
            j++;
            ok = true;
            break;
          }
          j++;
        }
        if (ok) {
          while (j < n && /[a-z]/i.test(src[j])) j++;
          mask(i, j);
          i = j;
          lastSig = "/";
          lastWord = "";
          continue;
        }
        // fall through: treat as division operator, not a regex
      }
    }

    if (/\s/.test(c)) {
      i++;
      continue;
    }

    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++;
      lastWord = src.slice(i, j);
      lastSig = lastWord[lastWord.length - 1];
      i = j;
      continue;
    }

    lastSig = c;
    lastWord = "";
    i++;
  }

  return out.join("");
}

function lineOf(src, idx) {
  let line = 1;
  for (let k = 0; k < idx && k < src.length; k++) {
    if (src[k] === "\n") line++;
  }
  return line;
}

function precedingNonSpaceChar(clean, idx) {
  let k = idx - 1;
  while (k >= 0 && /\s/.test(clean[k])) k--;
  return k >= 0 ? clean[k] : "";
}

function nextNonSpaceIndex(clean, idx) {
  let k = idx;
  while (k < clean.length && /\s/.test(clean[k])) k++;
  return k;
}

// Match the brace/paren/bracket starting at openIdx (clean[openIdx] must be
// the opening char) and return the index of its matching closer (inclusive).
function matchDelim(clean, openIdx) {
  const open = clean[openIdx];
  const pairs = { "{": "}", "(": ")", "[": "]" };
  const close = pairs[open];
  if (!close) return -1;
  let depth = 0;
  for (let k = openIdx; k < clean.length; k++) {
    if (clean[k] === open) depth++;
    else if (clean[k] === close) {
      depth--;
      if (depth === 0) return k;
    }
  }
  return -1; // unbalanced — caller must treat as "could not determine"
}

// Find all try{...}catch(...){...} pairs. Returns array of
// { catchIdx, handlerStart, handlerEnd } (handlerEnd exclusive).
function findCatchHandlers(clean) {
  const out = [];
  const tryRe = /\btry\b/g;
  let m;
  while ((m = tryRe.exec(clean))) {
    const tryIdx = m.index;
    if (precedingNonSpaceChar(clean, tryIdx) === ".") continue; // property access, not the statement
    const afterTry = nextNonSpaceIndex(clean, tryIdx + 3);
    if (clean[afterTry] !== "{") continue; // not followed by a block — not a try statement we can bound
    const tryBlockEnd = matchDelim(clean, afterTry);
    if (tryBlockEnd === -1) continue; // unbalanced — cannot determine, skip honestly
    let pos = nextNonSpaceIndex(clean, tryBlockEnd + 1);
    if (clean.slice(pos, pos + 5) !== "catch") continue; // try without catch (try/finally) — no handler to inspect
    // confirm word boundary after "catch"
    const afterCatchWord = pos + 5;
    if (/[A-Za-z0-9_$]/.test(clean[afterCatchWord] || "")) continue;
    let p = nextNonSpaceIndex(clean, afterCatchWord);
    if (clean[p] === "(") {
      const parenEnd = matchDelim(clean, p);
      if (parenEnd === -1) continue;
      p = nextNonSpaceIndex(clean, parenEnd + 1);
    }
    if (clean[p] !== "{") continue; // optional-binding catch with no body brace we can find
    const handlerEnd = matchDelim(clean, p);
    if (handlerEnd === -1) continue;
    out.push({ catchIdx: pos, handlerStart: p + 1, handlerEnd });
    // NESTED-TRY FIX (SP-20260829-001 bundle B2'): do NOT jump the scan
    // cursor to `handlerEnd + 1` here. `tryRe` is a global regex; after
    // `exec()` matched `\btry\b`, its `lastIndex` already auto-advanced to
    // just past THIS try's own keyword (tryIdx + 3). Leaving that alone (no
    // explicit reassignment) lets the next `exec()` call find a `try`
    // keyword textually nested inside the try block or the catch handler
    // just matched — e.g. `try { try {...} catch(e){...} } catch(e){...}` —
    // which the previous `handlerEnd + 1` jump skipped over entirely,
    // producing an invisible blind spot on any nested handler (documented in
    // CEILING_TEXT and gate-failclosed-registry.json's tool_correlation_note
    // before this fix; 4 real registry sites were unreachable for exactly
    // this reason). Every `continue` branch above already relies on this
    // same default auto-advance, so this restores consistent behavior across
    // both the success and skip paths, not a special case.
  }
  return out;
}

// Find the first top-level (brace-depth 0 relative to the handler) `throw`
// keyword inside [start, end). Returns its index, or -1 if none.
function findTopLevelThrow(clean, start, end) {
  let depth = 0;
  const throwRe = /\bthrow\b/g;
  throwRe.lastIndex = start;
  let m;
  while ((m = throwRe.exec(clean)) && m.index < end) {
    // compute depth of braces between start and m.index
    depth = 0;
    for (let k = start; k < m.index; k++) {
      if (clean[k] === "{") depth++;
      else if (clean[k] === "}") depth--;
    }
    if (depth === 0) return m.index;
  }
  return -1;
}

// Split an object-literal body into top-level { key, value } pairs.
// Depth/comma/colon splitting is done on `cleanBody` (so commas/braces
// hidden inside string literals don't corrupt the split), but the actual
// key/value TEXT is read from the aligned `srcBody` — quoted keys like
// `"ok"` are real string literals, and cleanSource() masks all string
// content to spaces, so reading key text from `clean` would silently erase
// every quoted key. Indices are aligned 1:1 since masking never changes length.
function parseTopLevelProps(cleanBody, srcBody) {
  const segments = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < cleanBody.length; i++) {
    const c = cleanBody[i];
    if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") depth--;
    else if (c === "," && depth === 0) {
      segments.push([start, i]);
      start = i + 1;
    }
  }
  segments.push([start, cleanBody.length]);

  const props = [];
  for (const [segStart, segEnd] of segments) {
    const segClean = cleanBody.slice(segStart, segEnd);
    let d = 0;
    let colonIdx = -1;
    for (let i = 0; i < segClean.length; i++) {
      const c = segClean[i];
      if (c === "{" || c === "[" || c === "(") d++;
      else if (c === "}" || c === "]" || c === ")") d--;
      else if (c === ":" && d === 0) {
        colonIdx = i;
        break;
      }
    }
    if (colonIdx === -1) continue;
    const segSrc = srcBody.slice(segStart, segEnd);
    let key = segSrc.slice(0, colonIdx).trim();
    key = key.replace(/^['"]|['"]$/g, "");
    const value = segSrc.slice(colonIdx + 1).trim();
    props.push({ key, value });
  }
  return props;
}

// Analyze one handler region [start, end) of `clean`/`src` (aligned, same
// length). Returns { permissive: bool, kind: string|null, atIndex: number|null }.
function analyzeHandler(clean, src, start, end) {
  const throwIdx = findTopLevelThrow(clean, start, end);
  const reachableEnd = throwIdx === -1 ? end : throwIdx;
  const region = clean.slice(start, reachableEnd);

  const exitRe = /process\s*\.\s*exit\s*\(\s*0\s*\)/;
  const exitMatch = exitRe.exec(region);
  if (exitMatch) {
    return { permissive: true, kind: "process.exit(0)", atIndex: start + exitMatch.index };
  }

  const returnRe = /\breturn\b/g;
  let m;
  while ((m = returnRe.exec(region))) {
    const afterReturn = nextNonSpaceIndex(region, m.index + 6);
    if (region[afterReturn] !== "{") continue;
    const absOpen = start + afterReturn;
    const absClose = matchDelim(clean, absOpen);
    if (absClose === -1 || absClose >= end) continue; // unbalanced within handler — skip honestly
    const cleanBody = clean.slice(absOpen + 1, absClose);
    const srcBody = src.slice(absOpen + 1, absClose);
    const props = parseTopLevelProps(cleanBody, srcBody);
    for (const p of props) {
      if (p.key === "ok" && p.value === "true") {
        return { permissive: true, kind: "success-shaped return", atIndex: start + m.index };
      }
    }
  }

  return { permissive: false, kind: null, atIndex: null };
}

function analyzeSource(src) {
  const clean = cleanSource(src);
  const handlers = findCatchHandlers(clean);
  const findings = [];
  for (const h of handlers) {
    const result = analyzeHandler(clean, src, h.handlerStart, h.handlerEnd);
    if (result.permissive) {
      findings.push({
        line: lineOf(src, result.atIndex),
        kind: result.kind,
      });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Old naive-regex predicate — kept ONLY so the fixture battery can
// demonstrate, by execution, that it gets each of the eight near-miss cases
// wrong. Not used by the real audit path. Deliberately reproduces the shape
// described in the brief: no string-state tracking, no try-precedes-catch
// check, a length-capped non-brace-aware handler window, exact-spacing
// process.exit(0), and substring `ok:\s*true` matching.
// ---------------------------------------------------------------------------
function oldNaiveDetect(src) {
  const re = /catch\s*\([^)]{0,80}\)\s*\{([^}]{0,300})\}/g;
  let m;
  while ((m = re.exec(src))) {
    const body = m[1];
    if (/process\.exit\(0\)/.test(body)) return true;
    if (/ok:\s*true/.test(body)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// File walking with honest "successfully read" accounting.
// ---------------------------------------------------------------------------
function walkJsFiles(root) {
  const scanned = []; // { relPath, content }
  const unreadable = []; // relPath (or best-effort identifier) that could not be read
  const repoRoot = process.cwd();

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      unreadable.push(path.relative(repoRoot, dir) + " (directory unreadable: " + e.code + ")");
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".js")) continue;
      const rel = path.relative(repoRoot, full);
      try {
        // lstat first so a dangling symlink is caught explicitly rather than
        // counted as a directory entry that "should" be scannable.
        const lst = fs.lstatSync(full);
        if (lst.isSymbolicLink()) {
          // resolve; if target is missing this throws ENOENT below on read
        }
        const content = fs.readFileSync(full, "utf8");
        scanned.push({ relPath: rel, content });
      } catch (e) {
        unreadable.push(rel + " (" + (e.code || "read-error") + ")");
      }
    }
  }

  walk(root);
  return { scanned, unreadable };
}

function getWiredStatus(repoRoot, relFilePath) {
  const settingsPath = path.join(repoRoot, ".claude", "settings.json");
  let raw;
  try {
    raw = fs.readFileSync(settingsPath, "utf8");
  } catch (e) {
    return "unknown";
  }
  try {
    JSON.parse(raw);
  } catch (e) {
    return "unknown"; // malformed — never collapse into "false"
  }
  const needle = relFilePath.split(path.sep).join("/");
  return raw.includes(needle) ? true : false;
}

function getDetectorSha() {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch (e) {
    return "unknown";
  }
}

function runAudit(root) {
  const repoRoot = process.cwd();
  const { scanned, unreadable } = walkJsFiles(root);

  if (scanned.length === 0) {
    return {
      exitCode: 2,
      report: {
        status: "unknown",
        reason: "zero files successfully read under root=" + root,
        files_scanned: 0,
        files_unreadable: unreadable,
        findings: [],
        detector_sha: getDetectorSha(),
        property: PROPERTY_TEXT,
        ceiling: CEILING_TEXT,
      },
    };
  }

  const findings = [];
  for (const f of scanned) {
    let results;
    try {
      results = analyzeSource(f.content);
    } catch (e) {
      // A parse/scan failure on one file must not silently vanish, and must
      // not be reported as "clean" for that file.
      unreadable.push(f.relPath + " (analysis-error: " + e.message + ")");
      continue;
    }
    const wired = results.length > 0 ? getWiredStatus(repoRoot, f.relPath) : null;
    for (const r of results) {
      findings.push({ file: f.relPath, line: r.line, kind: r.kind, wired });
    }
  }

  return {
    exitCode: 0,
    report: {
      status: "ok",
      files_scanned: scanned.length,
      files_unreadable: unreadable,
      findings,
      detector_sha: getDetectorSha(),
      property: PROPERTY_TEXT,
      ceiling: CEILING_TEXT,
    },
  };
}

function main() {
  const args = process.argv.slice(2);
  let root = "scripts";
  const rootFlagIdx = args.indexOf("--root");
  if (rootFlagIdx !== -1 && args[rootFlagIdx + 1]) root = args[rootFlagIdx + 1];

  const { exitCode, report } = runAudit(root);
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  process.exit(exitCode);
}

if (require.main === module) {
  main();
}

module.exports = {
  cleanSource,
  findCatchHandlers,
  analyzeHandler,
  analyzeSource,
  oldNaiveDetect,
  walkJsFiles,
  getWiredStatus,
  runAudit,
  PROPERTY_TEXT,
  CEILING_TEXT,
};
