#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const NAME = "reader-discipline";

const ALLOWLIST = new Set([
  "scripts/events/cli.js",
  "scripts/hooks/lib/logger.js",
  "scripts/hooks/lib/rotate.js",
  "scripts/hooks/lib/archive.js",
  "scripts/hooks/lib/retention.js",
  "scripts/materialize-decisions.js",
  "scripts/state/materialize.js",
  "scripts/state/materialize-core.js",
  "scripts/events/events-compact.js",
]);

const SELF = "scripts/checks/reader-discipline.js";

function isSanctioned(rel) {
  if (typeof rel !== "string" || !rel) return false;
  const p = rel.replace(/\\/g, "/");
  if (p === SELF) return true;
  if (p.endsWith(".test.js")) return true;
  return ALLOWLIST.has(p);
}

function stripComments(src) {
  const out = [];
  let inBlock = false;
  for (const line of String(src).split("\n")) {
    if (inBlock) {
      const end = line.indexOf("*/");
      if (end === -1) {
        out.push("");
        continue;
      }
      out.push(" ".repeat(end + 2) + stripLine(line.slice(end + 2)));
      inBlock = false;
      continue;
    }
    const { text, opened } = stripLine(line, true);
    out.push(text);
    if (opened) inBlock = true;
  }
  return out.join("\n");
}

function stripLine(line, trackOpen) {
  let s = line;
  s = s.replace(/\/\*[^]*?\*\//g, (m) => " ".repeat(m.length));
  let opened = false;
  const blockOpen = s.indexOf("/*");
  if (blockOpen !== -1) {
    s = s.slice(0, blockOpen);
    opened = true;
  } else {
    const lineComment = s.indexOf("//");
    if (lineComment !== -1) s = s.slice(0, lineComment);
  }
  return trackOpen ? { text: s, opened } : s;
}

const READ_VERBS = "readFileSync|readFile|createReadStream|readJsonl|readLines";
const EVENTS_TOKEN = "events\\.jsonl|\\.eventsFile\\b|\\bEVENTS_FILE\\b";
const READ_RE = new RegExp(
  "\\b(?:" + READ_VERBS + ")\\s*\\(.*?(?:" + EVENTS_TOKEN + ")",
);

function findReads(content) {
  const hits = [];
  const stripped = stripComments(content);
  const lines = stripped.split("\n");
  const rawLines = String(content).split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (READ_RE.test(lines[i])) {
      hits.push({ line: i + 1, snippet: (rawLines[i] || "").trim().slice(0, 200) });
    }
  }
  return hits;
}

function evaluate(input) {
  const files = (input && input.files) || [];
  const offenders = [];
  for (const f of files) {
    const rel = f && f.path;
    if (typeof rel !== "string" || !rel) {
      offenders.push({ path: "(unknown)", reason: "malformed-file-record" });
      continue;
    }
    if (f.unreadable) {
      offenders.push({ path: rel, reason: "unreadable" });
      continue;
    }
    if (isSanctioned(rel)) continue;
    const hits = findReads(f.content == null ? "" : String(f.content));
    if (hits.length) offenders.push({ path: rel, reason: "unsanctioned-reader", hits });
  }
  return { ok: offenders.length === 0, offenders };
}

function collectJsFiles(dirAbs, acc) {
  const entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dirAbs, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      collectJsFiles(full, acc);
    } else if (e.isFile() && e.name.endsWith(".js")) {
      acc.push(full);
    }
  }
  return acc;
}

function scan(root) {
  const rootAbs = root || process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
  const scriptsDir = path.join(rootAbs, "scripts");
  let realScripts;
  try {
    realScripts = fs.realpathSync(scriptsDir);
  } catch (e) {
    throw new Error(
      `scripts dir not found or inaccessible under root (${scriptsDir}) — cannot scan: ${e && e.message ? e.message : e}`,
    );
  }
  if (!fs.lstatSync(realScripts).isDirectory()) {
    throw new Error(`scripts path is not a directory: ${scriptsDir}`);
  }
  let realRoot;
  try {
    realRoot = fs.realpathSync(rootAbs);
  } catch (e) {
    throw new Error(`root inaccessible (${rootAbs}): ${e && e.message ? e.message : e}`);
  }
  const sep = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;
  if (realScripts !== realRoot && !realScripts.startsWith(sep)) {
    throw new Error(`scripts dir escapes root (realpath): ${scriptsDir} → ${realScripts}`);
  }
  const files = [];
  for (const abs of collectJsFiles(realScripts, [])) {
    const rel = path.relative(rootAbs, abs).replace(/\\/g, "/");
    let content = null;
    let unreadable = false;
    try {
      content = fs.readFileSync(abs, "utf8");
    } catch {
      unreadable = true;
    }
    files.push({ path: rel, content, unreadable });
  }
  return { ...evaluate({ files }), scanned: files.length };
}

module.exports = { evaluate, findReads, isSanctioned, stripComments, scan, ALLOWLIST, SELF };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const JSON_OUT = argv.includes("--json");
  const ENFORCE = argv.includes("--enforce");
  const rootIdx = argv.indexOf("--root");
  const root = rootIdx !== -1 ? argv[rootIdx + 1] : undefined;

  let res;
  try {
    res = scan(root);
  } catch (e) {
    const msg = e && e.message ? e.message : e;
    if (JSON_OUT) console.log(JSON.stringify({ check: NAME, ok: false, error: String(msg) }));
    else console.error(`[${NAME}] runner error (fail-closed): ${msg}`);
    process.exit(2);
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ check: NAME, enforce: ENFORCE, ...res }));
  } else if (res.ok) {
    console.log(`OK   [${NAME}] ${res.scanned} scripts/ file(s) scanned; all direct events-log reads are sanctioned`);
  } else {
    const verb = ENFORCE ? "FAIL" : "REPORT";
    console.error(`${verb} [${NAME}] ${res.offenders.length} un-sanctioned direct events-log reader(s):`);
    for (const o of res.offenders) {
      if (o.hits && o.hits.length) {
        for (const h of o.hits) console.error(`  - ${o.path}:${h.line}  ${h.snippet}`);
      } else {
        console.error(`  - ${o.path}: ${o.reason}`);
      }
    }
    console.error(
      `[${NAME}] sanctioned readers: the CLOSED allowlist in this check + *.test.js. ` +
        `Route other reads through a materialized state file or 'events:query --archive' ` +
        `(doctrine: .claude/project/reference/reader-discipline.md). Undecidable residual.`,
    );
    if (!ENFORCE) {
      console.error(`[${NAME}] report-only — re-run with --enforce to make this a blocking gate.`);
    }
  }
  process.exit(ENFORCE ? (res.ok ? 0 : 1) : 0);
}
