#!/usr/bin/env node
"use strict";

/**
 * S-OS-06 r4 lane K — lexical CONTEXT of each legacy root-token occurrence in a JavaScript file (measurement only).
 *
 * Classifies every case-insensitive root-token match as one of:
 *   code     — inside an identifier / code token (a binding, property or function NAME the file owns)
 *   string   — inside a '…' / "…" string or the text part of a `…` template literal
 *   regex    — inside a regular-expression literal
 *   comment  — inside a // or block comment
 * This is the mechanical half of the regression-suite GUARD: a literal that is the SUBJECT of an assertion lives in
 * string / regex / comment context; a legacy identifier the file owns lives in code context. The lexer is a
 * deliberately small hand-written scanner (no parser dependency may be added); every code-context hit is then read by
 * hand and the reading is recorded in adjudication-k.json — this output is evidence, not the ruling.
 *
 * Usage: node js-context-k.js <file> [<file> ...]   -> JSON lines { file, line, col, context, identifier? }
 * Self-reference hygiene: the root token is assembled at runtime.
 */

const fs = require("fs");

const TOKEN = ["wa", "rp"].join("");

function lex(src) {
  const ctx = new Array(src.length).fill("code");
  let i = 0;
  const n = src.length;
  const braceStack = []; // for template literal ${ } nesting: push "tpl" when entering ${
  let lastSignificant = ""; // last non-space char in code context (regex heuristic)
  let lastWord = "";
  const regexAllowedAfter = new Set(["", "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "~", "^"]);
  const regexKeywords = new Set(["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "yield", "await"]);
  function mark(from, to, kind) {
    for (let k = from; k < to && k < n; k++) ctx[k] = kind;
  }
  function readTemplate(start) {
    // start at the char after the opening backtick; returns index after the closing backtick
    let j = start;
    while (j < n) {
      const ch = src[j];
      if (ch === "\\") {
        mark(j, j + 2, "string");
        j += 2;
        continue;
      }
      if (ch === "`") {
        mark(j, j + 1, "string");
        return j + 1;
      }
      if (ch === "$" && src[j + 1] === "{") {
        mark(j, j + 2, "string");
        j = readCode(j + 2, true);
        continue;
      }
      mark(j, j + 1, "string");
      j += 1;
    }
    return j;
  }
  function readCode(start, inTemplateExpr) {
    let j = start;
    let depth = 0;
    while (j < n) {
      const ch = src[j];
      const nx = src[j + 1];
      if (ch === "/" && nx === "/") {
        const e = src.indexOf("\n", j);
        const end = e === -1 ? n : e;
        mark(j, end, "comment");
        j = end;
        continue;
      }
      if (ch === "/" && nx === "*") {
        const e = src.indexOf("*/", j + 2);
        const end = e === -1 ? n : e + 2;
        mark(j, end, "comment");
        j = end;
        continue;
      }
      if (ch === "'" || ch === '"') {
        let k = j + 1;
        while (k < n && src[k] !== ch && src[k] !== "\n") k += src[k] === "\\" ? 2 : 1;
        mark(j, k + 1, "string");
        j = k + 1;
        lastSignificant = "a";
        lastWord = "";
        continue;
      }
      if (ch === "`") {
        mark(j, j + 1, "string");
        j = readTemplate(j + 1);
        lastSignificant = "a";
        lastWord = "";
        continue;
      }
      if (ch === "/" && (regexAllowedAfter.has(lastSignificant) || regexKeywords.has(lastWord))) {
        let k = j + 1;
        let inClass = false;
        while (k < n && src[k] !== "\n") {
          if (src[k] === "\\") {
            k += 2;
            continue;
          }
          if (src[k] === "[") inClass = true;
          else if (src[k] === "]") inClass = false;
          else if (src[k] === "/" && !inClass) break;
          k += 1;
        }
        let e = k + 1;
        while (e < n && /[a-z]/i.test(src[e])) e += 1;
        mark(j, e, "regex");
        j = e;
        lastSignificant = "a";
        lastWord = "";
        continue;
      }
      if (inTemplateExpr) {
        if (ch === "{") depth += 1;
        else if (ch === "}") {
          if (depth === 0) {
            mark(j, j + 1, "string");
            return j + 1;
          }
          depth -= 1;
        }
      }
      if (/\s/.test(ch)) {
        j += 1;
        continue;
      }
      if (/[A-Za-z0-9_$]/.test(ch)) {
        let k = j;
        while (k < n && /[A-Za-z0-9_$]/.test(src[k])) k += 1;
        lastWord = src.slice(j, k);
        lastSignificant = "a";
        j = k;
        continue;
      }
      lastSignificant = ch;
      lastWord = "";
      j += 1;
    }
    return j;
  }
  // shebang line counts as comment
  if (src.startsWith("#!")) {
    const e = src.indexOf("\n");
    mark(0, e === -1 ? n : e, "comment");
    i = e === -1 ? n : e;
  }
  readCode(i, false);
  void braceStack;
  return ctx;
}

function scan(file) {
  const src = fs.readFileSync(file, "utf8");
  const ctx = lex(src);
  const re = new RegExp(TOKEN, "gi");
  const rows = [];
  const lineStarts = [0];
  for (let k = 0; k < src.length; k++) if (src[k] === "\n") lineStarts.push(k + 1);
  let m;
  while ((m = re.exec(src)) !== null) {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= m.index) lo = mid;
      else hi = mid - 1;
    }
    const row = { file, line: lo + 1, col: m.index - lineStarts[lo] + 1, context: ctx[m.index] };
    if (row.context === "code") {
      let s = m.index;
      let e = m.index + TOKEN.length;
      while (s > 0 && /[A-Za-z0-9_$]/.test(src[s - 1])) s -= 1;
      while (e < src.length && /[A-Za-z0-9_$]/.test(src[e])) e += 1;
      row.identifier = src.slice(s, e);
    }
    rows.push(row);
  }
  return rows;
}

if (require.main === module) {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error("usage: js-context-k.js <file> [...]");
    process.exit(2);
  }
  for (const f of files) for (const r of scan(f)) console.log(JSON.stringify(r));
}

module.exports = { scan, lex };
