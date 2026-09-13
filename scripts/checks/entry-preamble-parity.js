#!/usr/bin/env node
"use strict";

/**
 * entry-preamble-parity.js — the named enforcer for the single-source "entering-agent preamble"
 * (SP-20260723-001, ADR-0036).
 *
 * The shared entering-agent block lives ONCE, canonically, at
 * `.claude/project/reference/entry-preamble.md` between a pair of HTML-comment markers
 * (`MC:ENTERING-AGENT-PREAMBLE:BEGIN`/`:END`). Every provider-neutral entry doc — `CODEX.md`,
 * `ANTIGRAVITY.md`, and a section of `AGENTS.md` — embeds that block VERBATIM. This
 * enforcer keys on REAL FILE BYTES only (never a self-declared field): it re-extracts the marked
 * region from each embedder, hashes it, and compares against the hash of the canonical source's own
 * region. A canonical file can never grade itself — the canonical's region IS the oracle every other
 * file is checked against, so a shim can never fabricate its own pass.
 *
 * Gauntlet-hardened (SP-20260723-001 fix cycle r1):
 *   - Markers must occupy their OWN line (the trimmed line is EXACTLY the marker). Bytes appended to
 *     a marker line therefore make it an INVALID marker (region not found -> finding), closing the
 *     "append to a marker line to escape both the hashed region and the thinness delta" evasion.
 *   - EXACTLY ONE BEGIN + ONE END is required; a second/contradictory marked block is a finding, not
 *     a silently-ignored extra pair.
 *   - The CLI + release gate resolve the repo root from the SCRIPT LOCATION only (never an inherited
 *     CLAUDE_PROJECT_DIR), so a caller cannot redirect the gate at a clean tree to green real drift.
 *
 * Checks (each failing check is a finding):
 *   1. EXISTS       — every required entry file is present.
 *   2. REGION       — every embedder has EXACTLY ONE well-formed, non-empty marked region on its own
 *                      marker lines (a dropped/mangled/duplicated block is a defect distinct from
 *                      thinness).
 *   3. HASH-PARITY  — sha256(region(file)) === sha256(region(canonical)).
 *   4. THINNESS     — for files with a declared tier, the bytes/lines OUTSIDE the marked region
 *                      (never the shared block itself) must stay within the tier's bound.
 *
 * Exit: 0 clean · 1 one or more findings · 2 could-not-run (canonical unreadable / no valid canonical
 * region / internal error — NEVER a silent green). Supports `--json`.
 *
 *   node scripts/checks/entry-preamble-parity.js [--json]
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const NAME = "entry-preamble-parity";

// SCRIPT-DERIVED repo root — the checkout that OWNS this script (…/scripts/checks/x.js -> repo root).
// Deliberately NOT process.env.CLAUDE_PROJECT_DIR: a release gate must verify ITS OWN tree, and an
// inherited/hostile CLAUDE_PROJECT_DIR pointed at a clean fixture would silently green real drift in
// the repo under release (the Phase-2 stale/hostile-CLAUDE_PROJECT_DIR fail-open class). The pure core
// `runParity({repoRoot})` still accepts an explicit root so tests can drive fixture trees.
const REPO_ROOT = path.resolve(__dirname, "..", "..");

// A VALID marker occupies its OWN line and is the EXACT marker text — no arbitrary bytes anywhere
// inside the comment (only whitespace is tolerated at the anchor points). The earlier [^>]* allowed
// content BEFORE `-->` (…BEGIN v1 IGNORE-CANONICAL -->) to ride the marker line, escaping BOTH the
// hashed region and the thinness delta — the gauntlet-r2 evasion. These literal forms close it: any
// extra byte (before OR after `-->`) makes the line NOT a marker -> region-not-found finding. Bumping
// the block version = update the `v1` literal here + re-embed every shim.
const BEGIN_LINE = /^<!--\s*MC:ENTERING-AGENT-PREAMBLE:BEGIN v1\s*-->$/;
const END_LINE = /^<!--\s*MC:ENTERING-AGENT-PREAMBLE:END\s*-->$/;

// Tier bounds apply to the DELTA — the file's bytes/lines OUTSIDE the marked region (everything
// except the region between-and-including the markers). The shared block is identical everywhere
// and must never count against a file's thinness.
const TIERS = {
  tombstone: { maxBytes: 2048, maxLines: 40 },
  "full-entry": { maxBytes: 8192, maxLines: 120 },
};

// The canonical oracle — the SOLE source of the expected hash. Never hash a shim as the oracle.
const CANONICAL_REL = ".claude/project/reference/entry-preamble.md";

// Hard-coded per-file config table (SP-20260723-001).
const FILES = [
  { rel: CANONICAL_REL, existsRequired: true, embeds: true, tier: null, canonical: true },
  { rel: "CLAUDE.md", existsRequired: true, embeds: false, tier: null },
  { rel: "AGENTS.md", existsRequired: true, embeds: true, tier: null },
  { rel: "CODEX.md", existsRequired: true, embeds: true, tier: "full-entry" },
  { rel: "ANTIGRAVITY.md", existsRequired: true, embeds: true, tier: "full-entry" },
  // GEMINI.md (tier "tombstone") was DELETED per the ADR-0036 removal-trigger
  // (E-OPEN-SOURCE-001 S-OS-05); the tombstone tier stays defined for any future shim.
];

/**
 * Analyze a file's text for its marked region + the out-of-region delta. CRLF/CR are normalized to LF
 * (Windows safety) before scanning; the marked region is trimmed of edge blank/whitespace-only lines.
 * No further normalization — no whitespace-collapse, no lowercasing: over-normalizing would mask a
 * real word-level edit, itself a false-green.
 *
 * Marker discipline: a marker is recognized ONLY when it is the whole (trimmed) line, and EXACTLY one
 * BEGIN + one END must be present. Returns one of:
 *   { markerError: "<reason>" }                         — no single well-formed region (a finding)
 *   { region: "<inner>", outside: { byteLength, lineCount } }
 */
function analyze(txt) {
  const lines = txt.replace(/\r\n?/g, "\n").split("\n");
  const begins = [];
  const ends = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (BEGIN_LINE.test(t)) begins.push(i);
    if (END_LINE.test(t)) ends.push(i);
  }
  if (begins.length !== 1 || ends.length !== 1) {
    return {
      markerError: `expected exactly one marked entering-agent-preamble region (1 BEGIN + 1 END, each on its own line), found ${begins.length} BEGIN / ${ends.length} END`,
    };
  }
  const b = begins[0];
  const e = ends[0];
  if (e <= b) {
    return { markerError: "END marker does not follow the BEGIN marker" };
  }
  let inner = lines.slice(b + 1, e);
  while (inner.length && inner[0].trim() === "") inner.shift();
  while (inner.length && inner[inner.length - 1].trim() === "") inner.pop();
  const region = inner.join("\n");
  const outsideLines = lines.slice(0, b).concat(lines.slice(e + 1));
  const outsideText = outsideLines.join("\n");
  return {
    region,
    outside: { byteLength: Buffer.byteLength(outsideText, "utf8"), lineCount: outsideLines.length },
  };
}

function sha256(str) {
  return crypto.createHash("sha256").update(str, "utf8").digest("hex");
}

/**
 * Pure core. `repoRoot` defaults to the SCRIPT-DERIVED repo root; a caller (the test) may pass a
 * fixture root so negative cases run against temp copies, never the real entry docs.
 *
 * Throws (fail-closed — the caller must exit 2, never a silent green) when the canonical oracle is
 * unreadable, or is readable but carries no single well-formed marked region of its own (no oracle
 * hash can be derived).
 *
 * Returns { findings: [{file, reason}], canonicalHash }.
 */
function runParity({ repoRoot = REPO_ROOT } = {}) {
  const canonicalAbs = path.join(repoRoot, CANONICAL_REL);
  let canonicalText;
  try {
    canonicalText = fs.readFileSync(canonicalAbs, "utf8");
  } catch (e) {
    throw new Error(
      `canonical oracle unreadable at ${CANONICAL_REL}: ${e && e.message ? e.message : e}`,
    );
  }
  const canonicalAnalysis = analyze(canonicalText);
  if (canonicalAnalysis.markerError || !canonicalAnalysis.region) {
    throw new Error(
      `canonical oracle at ${CANONICAL_REL} has no usable marked region: ${canonicalAnalysis.markerError || "empty region"}`,
    );
  }
  const canonicalHash = sha256(canonicalAnalysis.region);

  const findings = [];

  for (const cfg of FILES) {
    const abs = path.join(repoRoot, cfg.rel);
    const exists = fs.existsSync(abs);

    if (!exists) {
      if (cfg.existsRequired) {
        findings.push({ file: cfg.rel, reason: "required entry file is missing" });
      }
      continue; // nothing further to check on a missing file
    }

    let text;
    try {
      text = fs.readFileSync(abs, "utf8");
    } catch (e) {
      findings.push({ file: cfg.rel, reason: `unreadable: ${e && e.message ? e.message : e}` });
      continue;
    }

    const analysis = cfg.embeds || cfg.tier ? analyze(text) : null;

    if (cfg.embeds) {
      if (analysis.markerError) {
        findings.push({ file: cfg.rel, reason: analysis.markerError });
      } else if (analysis.region.length === 0) {
        findings.push({ file: cfg.rel, reason: "marked entering-agent-preamble region is empty (dropped shim)" });
      } else if (!cfg.canonical && sha256(analysis.region) !== canonicalHash) {
        findings.push({
          file: cfg.rel,
          reason: "embedded preamble region has drifted from the canonical oracle (hash mismatch)",
        });
      }
    }

    if (cfg.tier) {
      const bound = TIERS[cfg.tier];
      if (analysis.markerError) {
        // Already reported as a marker finding above; thinness cannot be measured around a region
        // that isn't well-formed, so don't double-report.
      } else if (analysis.outside.byteLength > bound.maxBytes || analysis.outside.lineCount > bound.maxLines) {
        findings.push({
          file: cfg.rel,
          reason: `oversized shim (tier "${cfg.tier}"): ${analysis.outside.byteLength} bytes / ${analysis.outside.lineCount} lines outside the marked region (bound: ${bound.maxBytes} bytes / ${bound.maxLines} lines)`,
        });
      }
    }
  }

  return { findings, canonicalHash };
}

module.exports = { runParity, analyze, FILES, TIERS, CANONICAL_REL, REPO_ROOT };

if (require.main === module) {
  const JSON_OUT = process.argv.includes("--json");
  let res;
  try {
    res = runParity({}); // repo root is SCRIPT-DERIVED — not redirectable via env
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    if (JSON_OUT) console.log(JSON.stringify({ check: NAME, ok: false, error: msg }));
    else console.error(`FAIL [${NAME}] could not run (fail-closed): ${msg}`);
    process.exit(2);
  }

  const ok = res.findings.length === 0;
  if (JSON_OUT) {
    console.log(JSON.stringify({ check: NAME, ok, findings: res.findings }));
  } else if (ok) {
    console.log(
      `OK   [${NAME}] ${FILES.length} entry file(s) checked — canonical hash parity + thinness clean.`,
    );
  } else {
    console.error(`FAIL [${NAME}] ${res.findings.length} finding(s) in the entry-preamble graph:`);
    for (const f of res.findings) console.error(`  - ${f.file}: ${f.reason}`);
  }
  process.exit(ok ? 0 : 1);
}
