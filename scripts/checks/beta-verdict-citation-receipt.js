#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..", "..");
const NAME = "beta-verdict-citation-receipt";
const DISCLAIMER = "receipt PRESENT, not authenticated — a cited msg_id resolving to a betaEvents VERDICT row is NOT proof the row is authentic/right-instance (that is not verified here). /scan:full-only, never CI.";
const DEFAULT_BETA_EVENTS = path.join(REPO, ".claude", "agents", "president", "_system", "beta", "events.jsonl");
const DEFAULT_DOC_DIRS = [
  path.join(REPO, ".claude", "agents", "president", "_system", "policy", "adr"),
  path.join(REPO, "trackers", "epics"),
];
const DEFAULT_DOC_FILES = [path.join(REPO, "ROADMAP.md")];

const CITATION_RE = /(?<![A-Za-z])(?:β|beta|Beta)[\s:\u2014\u2013-]*(?:DECIDE|DIRECTIVE|ESCALATE|ruled|verdict|approved|DECIDES)\b/;
const MSGID_IN_TEXT_RE = /\bmsg_id[:=\s]+[`'"]?([A-Za-z0-9][A-Za-z0-9_-]*)/i;
const MSGID_SHAPE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const EMPHASIS_RE = /[*_`~]/u;
const INVIS = "\\p{M}\\p{Cf}\\p{Cc}\\p{Default_Ignorable_Code_Point}";
const STRIP_INVIS_G = new RegExp("[" + INVIS + "]", "gu");
const SPACE_MAP_RE = /[\p{White_Space}\u2800\u3164\u1160\u115f\uffa0]/u;
const SPACE_MAP_G = new RegExp(SPACE_MAP_RE.source, "gu");
const CLAUSE_STRIP_G = new RegExp("[*`~]|[" + INVIS + "]", "gu");
const RECEIPT_SEP_INVIS_G = new RegExp("(msg_id)[" + INVIS + "]+(?=[`'\"]?[A-Za-z0-9])", "giu");
const BIDI_RE = /[‪-‮⁦-⁩]/u;
const LINE_SPLIT_RE = /\r\n|[\n\r]/;
const DANGEROUS_BREAK_RE = new RegExp("[\\u000b\\u000c\\u0085\\u2028\\u2029]", "u");
const identityMap = (s) => { const m = new Array(s.length + 1); for (let i = 0; i <= s.length; i++) m[i] = i; return m; };
function mapReplace(text, map, re, repl) {
  let out = "";
  const omap = [];
  let last = 0, m;
  re.lastIndex = 0;
  while ((m = re.exec(text)) !== null) {
    for (let i = last; i < m.index; i++) { out += text[i]; omap.push(map[i]); }
    const r = repl(m);
    for (let k = 0; k < r.length; k++) { out += r[k]; omap.push(map[m.index]); }
    last = m.index + m[0].length;
    if (m[0].length === 0) {
      if (last < text.length) { out += text[last]; omap.push(map[last]); last++; }
      re.lastIndex = last;
      if (last >= text.length) break;
    }
  }
  for (let i = last; i < text.length; i++) { out += text[i]; omap.push(map[i]); }
  omap.push(map[text.length]);
  return { text: out, map: omap };
}
function mapNFKD(text, map) {
  let out = "";
  const omap = [];
  let idx = 0;
  for (const cp of text) {
    const d = cp.normalize("NFKD");
    for (let k = 0; k < d.length; k++) { out += d[k]; omap.push(map[idx]); }
    idx += cp.length;
  }
  omap.push(map[text.length]);
  return { text: out, map: omap };
}
const CHAR_REF_G = /&#[xX]([0-9a-fA-F]+);|&#(\d+);|&(beta|Beta);/g;
const NAMED_REFS = { beta: "β", Beta: "Β" };
function decodeCharRefs(s) {
  const src = String(s);
  return mapReplace(src, identityMap(src), CHAR_REF_G, (m) => {
    try {
      if (m[1] !== undefined) { const c = parseInt(m[1], 16); return c >= 0 && c <= 0x10ffff ? String.fromCodePoint(c) : m[0]; }
      if (m[2] !== undefined) { const c = parseInt(m[2], 10); return c >= 0 && c <= 0x10ffff ? String.fromCodePoint(c) : m[0]; }
      return NAMED_REFS[m[3]] !== undefined ? NAMED_REFS[m[3]] : m[0];
    } catch { return m[0]; }
  });
}
const RAW_ID_CLEAN_G = new RegExp("[*`~]|[\\p{Cf}\\p{Cc}\\p{Default_Ignorable_Code_Point}]", "gu");
function normalizeForDetection(src) {
  let norm = "";
  const map = [];
  let srcIdx = 0;
  for (const cp of src) {
    const cpLen = cp.length;
    let out;
    if (EMPHASIS_RE.test(cp)) out = "";
    else if (SPACE_MAP_RE.test(cp)) out = " ";
    else out = cp.normalize("NFKD").replace(STRIP_INVIS_G, "");
    for (let j = 0; j < out.length; j++) { map.push(srcIdx); norm += out[j]; }
    srcIdx += cpLen;
  }
  map.push(srcIdx);
  return { norm, map };
}
function buildClause(text, map, fold) {
  let cur = fold ? mapNFKD(text, map) : { text, map };
  cur = mapReplace(cur.text, cur.map, SPACE_MAP_G, () => " ");
  cur = mapReplace(cur.text, cur.map, RECEIPT_SEP_INVIS_G, (m) => m[1] + " ");
  cur = mapReplace(cur.text, cur.map, fold ? CLAUSE_STRIP_G : RAW_ID_CLEAN_G, () => "");
  return cur;
}
function extractReceipts(clauseText, clauseMap) {
  const out = [];
  const re = new RegExp(MSGID_IN_TEXT_RE.source, "gid");
  let m;
  while ((m = re.exec(clauseText)) !== null) {
    if (MSGID_SHAPE_RE.test(m[1])) out.push({ id: m[1], origStart: clauseMap[m.indices[1][0]] });
    if (re.lastIndex === m.index) re.lastIndex++;
  }
  return out;
}
const VERDICT_TYPES = new Set([
  "beta-consult-verdict", "beta-consult-verdict-reconfirm", "beta-verdict", "beta-directive",
  "design-boundary-verdict", "fix-lock-verdict", "design-lock", "fix-lock", "beta-consult-retraction",
  "boundary", "beta-consult",
]);
const DECISION_VOCAB = new Set(["DECIDE", "DIRECTIVE", "ESCALATE"]);

function isVerdictRow(o) {
  if (!o || typeof o !== "object") return false;
  const type = typeof o.type === "string" ? o.type : null;
  if (!type || !VERDICT_TYPES.has(type)) return false;
  const decision = typeof o.decision === "string" ? o.decision.trim().toUpperCase() : null;
  if (decision && DECISION_VOCAB.has(decision)) return true;
  const verdict = typeof o.verdict === "string" ? o.verdict.trim().toLowerCase() : "";
  return verdict.length > 0 && verdict !== "pending";
}

function verdictMsgIds(betaEventsText) {
  if (betaEventsText == null) return null;
  const set = new Set();
  for (const line of String(betaEventsText).split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    let o;
    try { o = JSON.parse(t); } catch { continue; }
    if (!isVerdictRow(o)) continue;
    const mid = typeof o.msg_id === "string" ? o.msg_id : null;
    if (mid && MSGID_SHAPE_RE.test(mid)) set.add(mid);
    if (Array.isArray(o.msg_ids)) for (const m of o.msg_ids) if (typeof m === "string" && MSGID_SHAPE_RE.test(m)) set.add(m);
  }
  return set;
}

const HISTORY_LABEL_RE = /^(Session log|Change log|Changelog|History)\b/i;
function historyMask(lines) {
  const mask = new Array(lines.length).fill(false);
  let historyLevel = null;
  for (let i = 0; i < lines.length; i++) {
    const atx = lines[i].match(/^ {0,3}(#{1,6})\s+(.*)$/);
    const setextUnder = /^ {0,3}(=+|-+)\s*$/.test(lines[i]) && i > 0 && lines[i - 1].trim() !== "" && !/^ {0,3}#{1,6}\s/.test(lines[i - 1]);
    if (atx) {
      const level = atx[1].length;
      if (historyLevel !== null && level <= historyLevel) historyLevel = null;
      if (historyLevel === null && HISTORY_LABEL_RE.test(atx[2].trim())) {
        historyLevel = level;
        mask[i] = true;
        continue;
      }
    } else if (setextUnder) {
      const level = /^ {0,3}=+\s*$/.test(lines[i]) ? 1 : 2;
      const headingText = lines[i - 1].trim();
      if (historyLevel !== null && level <= historyLevel) {
        historyLevel = null;
        mask[i - 1] = false; mask[i] = false;
      }
      if (historyLevel === null && HISTORY_LABEL_RE.test(headingText)) {
        historyLevel = level;
        mask[i - 1] = true; mask[i] = true;
        continue;
      }
    }
    if (historyLevel !== null) mask[i] = true;
  }
  return mask;
}

function evaluate({ docs, betaEventsText }) {
  const known = verdictMsgIds(betaEventsText);
  if (known === null) return { skip: true, hard: [], soft: [], scannedCitations: 0 };
  const hard = [];
  const soft = [];
  let scannedCitations = 0;
  const citationGlobal = new RegExp(CITATION_RE.source, "g");
  for (const d of docs || []) {
    const rawLines = String(d.text || "").split(LINE_SPLIT_RE);
    const inHistory = historyMask(rawLines);
    for (let i = 0; i < rawLines.length; i++) {
      const origLine = rawLines[i];
      const decoded = decodeCharRefs(origLine);
      const rendered = decoded.text;
      if (BIDI_RE.test(rendered)) {
        hard.push({
          doc: d.path, line: i + 1, msg_id: null,
          reason: `bidi control (U+202A-202E / U+2066-2069) on a scanned line — rendering order differs from logical order, so a β-verdict citation may be visually MASKED (e.g. "β <RLO>EDICED<PDF>" renders "β DECIDE" while the scanner sees "EDICED"). Bidi overrides do not belong in prose ADR/tracker/ROADMAP; remove or justify. Line: ${rendered.replace(new RegExp(BIDI_RE.source, "gu"), "<BIDI>").trim().slice(0, 120)}`,
        });
      }
      if (DANGEROUS_BREAK_RE.test(rendered)) {
        hard.push({
          doc: d.path, line: i + 1, msg_id: null,
          reason: `non-CommonMark line/whitespace break (VT U+000B / FF U+000C / NEL U+0085 / LS U+2028 / PS U+2029) on a scanned line — the markdown render surface differs from the scanned line model, so a citation can be split-hidden (\`β<FF>DECIDE\`) or a history-section heading masked. These do not belong in prose ADR/tracker/ROADMAP; remove or justify. Line: ${rendered.replace(new RegExp(DANGEROUS_BREAK_RE.source, "gu"), "<BREAK>").trim().slice(0, 120)}`,
        });
      }
      if (inHistory[i]) continue;
      const { norm, map: mapNorm } = normalizeForDetection(rendered);
      const starts = [];
      citationGlobal.lastIndex = 0;
      let cm;
      while ((cm = citationGlobal.exec(norm)) !== null) {
        starts.push(cm.index);
        if (citationGlobal.lastIndex === cm.index) citationGlobal.lastIndex++;
      }
      for (let c = 0; c < starts.length; c++) {
        scannedCitations++;
        const decStart = mapNorm[starts[c]];
        const decEnd = c + 1 < starts.length ? mapNorm[starts[c + 1]] : rendered.length;
        const origStart = decoded.map[decStart];
        const origEnd = decoded.map[decEnd];
        const decClauseText = rendered.slice(decStart, decEnd);
        const decClauseMap = new Array(decClauseText.length + 1);
        for (let j = 0; j <= decClauseText.length; j++) decClauseMap[j] = decoded.map[decStart + j];
        const citedClause = buildClause(decClauseText, decClauseMap, true);
        const clause = citedClause.text;
        const origClauseText = origLine.slice(origStart, origEnd);
        const origClauseMap = new Array(origClauseText.length + 1);
        for (let j = 0; j <= origClauseText.length; j++) origClauseMap[j] = origStart + j;
        const rawClause = buildClause(origClauseText, origClauseMap, false);
        const rawReceipts = extractReceipts(rawClause.text, rawClause.map);
        const cited = extractReceipts(citedClause.text, citedClause.map);
        if (cited.length === 0) {
          soft.push({
            doc: d.path, line: i + 1,
            reason: `load-bearing β-verdict citation with NO msg_id receipt — add the delivered verdict's msg_id (conductor-side contract). Citation: ${clause.trim().slice(0, 120)}`,
          });
        } else {
          const isLaundered = (occ) => !rawReceipts.some((r) => r.origStart === occ.origStart && r.id === occ.id);
          const unresolved = cited.filter((occ) => isLaundered(occ) || !known.has(occ.id));
          if (unresolved.length) {
            const first = unresolved[0];
            hard.push({
              doc: d.path, line: i + 1, msg_id: first.id,
              reason: isLaundered(first)
                ? `β-verdict citation cites msg_id '${first.id}' that exists ONLY via a render/normalization transformation (character-reference decode, compat-fold or mark-strip minted it from an obfuscated payload — e.g. &#x72;… / fullwidth / accented id) and is NOT a raw ASCII receipt at that position — a transformation must never mint a credential. Citation: ${clause.trim().slice(0, 120)}`
                : `β-verdict citation cites msg_id '${first.id}' which does NOT resolve to a betaEvents VERDICT row — unverified receipt (${unresolved.length} of ${cited.length} cited receipt(s) unresolved; forged/typo/stale). Citation: ${clause.trim().slice(0, 120)}`,
            });
          }
        }
      }
    }
  }
  return { skip: false, hard, soft, scannedCitations };
}

function gatherDocs(dirs, files, io = fs) {
  const out = [];
  const errors = [];
  const pushFile = (fp) => {
    try { out.push({ path: path.relative(REPO, fp), text: io.readFileSync(fp, "utf8") }); }
    catch (e) { if (!e || e.code !== "ENOENT") errors.push({ path: fp, error: (e && e.message) || "read failed" }); }
  };
  for (const dir of dirs) {
    let entries;
    try { entries = io.readdirSync(dir); }
    catch (e) { if (!e || e.code !== "ENOENT") errors.push({ path: dir, error: (e && e.message) || "readdir failed" }); continue; }
    for (const n of entries) if (/\.md$/i.test(n)) pushFile(path.join(dir, n));
  }
  for (const f of files) pushFile(f);
  return { docs: out, errors };
}

function main(argv) {
  const jsonOut = argv.includes("--json");
  const enforce = argv.includes("--enforce");
  const bi = argv.indexOf("--beta-events");
  const betaEventsPath = bi !== -1 && argv[bi + 1] ? path.resolve(argv[bi + 1]) : DEFAULT_BETA_EVENTS;

  let betaEventsText;
  try {
    betaEventsText = fs.readFileSync(betaEventsPath, "utf8");
  } catch (e) {
    if (e && e.code === "ENOENT") {
      const out = { name: NAME, status: "skip", reason: `betaEvents absent (${betaEventsPath}) — receipt resolution skipped`, disclaimer: DISCLAIMER };
      process.stdout.write(jsonOut ? JSON.stringify(out) + "\n" : `SKIP [${NAME}] betaEvents absent (gitignored) — nothing to resolve against\n     (${DISCLAIMER})\n`);
      return 0;
    }
    if (jsonOut) process.stdout.write(JSON.stringify({ name: NAME, status: "error", reason: `betaEvents unreadable: ${e.message}`, disclaimer: DISCLAIMER }) + "\n");
    else process.stderr.write(`ERROR [${NAME}] betaEvents unreadable (fail-closed): ${e.message}\n     NOTE: ${DISCLAIMER}\n`);
    return 2;
  }

  const { docs, errors } = gatherDocs(DEFAULT_DOC_DIRS, DEFAULT_DOC_FILES);
  if (errors.length) {
    if (jsonOut) process.stdout.write(JSON.stringify({ name: NAME, status: "error", reason: "unreadable corpus input(s)", errors, disclaimer: DISCLAIMER }) + "\n");
    else {
      process.stderr.write(`ERROR [${NAME}] ${errors.length} present-but-unreadable corpus input(s) (fail-closed):\n`);
      for (const er of errors) process.stderr.write(`     - ${er.path}: ${er.error}\n`);
      process.stderr.write(`     NOTE: ${DISCLAIMER}\n`);
    }
    return 2;
  }

  const { hard, soft, scannedCitations } = evaluate({ docs, betaEventsText });
  const blocking = enforce && hard.length > 0;
  const out = {
    name: NAME, status: blocking ? "red" : "green", betaEvents: betaEventsPath,
    enforced: enforce, scannedCitations, hardFindings: hard, softAdvisories: soft, disclaimer: DISCLAIMER,
  };
  if (jsonOut) {
    process.stdout.write(JSON.stringify(out) + "\n");
  } else {
    if (hard.length) {
      process.stderr.write(`${blocking ? "FAIL" : "WARN"} [${NAME}] ${hard.length} β-verdict citation(s) with an UNRESOLVED msg_id receipt:\n`);
      for (const f of hard) process.stderr.write(`     - ${f.doc}:${f.line} msg_id '${f.msg_id}' not in betaEvents\n`);
    }
    if (soft.length) {
      process.stderr.write(`INFO [${NAME}] ${soft.length} β-verdict citation(s) with no msg_id receipt (report-only advisory):\n`);
      for (const f of soft.slice(0, 20)) process.stderr.write(`     - ${f.doc}:${f.line}\n`);
      if (soft.length > 20) process.stderr.write(`     … +${soft.length - 20} more\n`);
    }
    if (!hard.length && !soft.length) process.stdout.write(`OK   [${NAME}] ${scannedCitations} β-verdict citation(s) scanned; all receipt-backed\n`);
    process.stderr.write(`     NOTE (${NAME}): ${DISCLAIMER}\n`);
  }
  return blocking ? 1 : 0;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = { evaluate, verdictMsgIds, isVerdictRow, historyMask, gatherDocs, NAME, DISCLAIMER };
