#!/usr/bin/env node
"use strict";

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
  "hook-wiring parse.";

const SKIP_DIRS = new Set([
  ".git",
  ".worktrees",
  "node_modules",
  ".claude",
]);

function cleanSource(src) {
  const n = src.length;
  const out = src.split("");
  let i = 0;
  let lastSig = "";
  let lastWord = "";

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

    if (c === "/" && src[i + 1] === "/") {
      let j = i;
      while (j < n && src[j] !== "\n") j++;
      mask(i, j);
      i = j;
      continue;
    }

    if (c === "/" && src[i + 1] === "*") {
      let j = i + 2;
      while (j < n && !(src[j] === "*" && src[j + 1] === "/")) j++;
      j = Math.min(j + 2, n);
      mask(i, j);
      i = j;
      continue;
    }

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
          if (src[j] === "\n") break;
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
  return -1;
}

function findCatchHandlers(clean) {
  const out = [];
  const tryRe = /\btry\b/g;
  let m;
  while ((m = tryRe.exec(clean))) {
    const tryIdx = m.index;
    if (precedingNonSpaceChar(clean, tryIdx) === ".") continue;
    const afterTry = nextNonSpaceIndex(clean, tryIdx + 3);
    if (clean[afterTry] !== "{") continue;
    const tryBlockEnd = matchDelim(clean, afterTry);
    if (tryBlockEnd === -1) continue;
    let pos = nextNonSpaceIndex(clean, tryBlockEnd + 1);
    if (clean.slice(pos, pos + 5) !== "catch") continue;
    const afterCatchWord = pos + 5;
    if (/[A-Za-z0-9_$]/.test(clean[afterCatchWord] || "")) continue;
    let p = nextNonSpaceIndex(clean, afterCatchWord);
    if (clean[p] === "(") {
      const parenEnd = matchDelim(clean, p);
      if (parenEnd === -1) continue;
      p = nextNonSpaceIndex(clean, parenEnd + 1);
    }
    if (clean[p] !== "{") continue;
    const handlerEnd = matchDelim(clean, p);
    if (handlerEnd === -1) continue;
    out.push({ catchIdx: pos, handlerStart: p + 1, handlerEnd });
  }
  return out;
}

function findTopLevelThrow(clean, start, end) {
  let depth = 0;
  const throwRe = /\bthrow\b/g;
  throwRe.lastIndex = start;
  let m;
  while ((m = throwRe.exec(clean)) && m.index < end) {
    depth = 0;
    for (let k = start; k < m.index; k++) {
      if (clean[k] === "{") depth++;
      else if (clean[k] === "}") depth--;
    }
    if (depth === 0) return m.index;
  }
  return -1;
}

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
    if (absClose === -1 || absClose >= end) continue;
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

function walkJsFiles(root) {
  const scanned = [];
  const unreadable = [];
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
        const lst = fs.lstatSync(full);
        if (lst.isSymbolicLink()) {
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
    return "unknown";
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
