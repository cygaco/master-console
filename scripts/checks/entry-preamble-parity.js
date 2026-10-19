#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const NAME = "entry-preamble-parity";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const BEGIN_LINE = /^<!--\s*MC:ENTERING-AGENT-PREAMBLE:BEGIN v1\s*-->$/;
const END_LINE = /^<!--\s*MC:ENTERING-AGENT-PREAMBLE:END\s*-->$/;

const TIERS = {
  tombstone: { maxBytes: 2048, maxLines: 40 },
  "full-entry": { maxBytes: 8192, maxLines: 120 },
};

const CANONICAL_REL = ".claude/project/reference/entry-preamble.md";

const FILES = [
  { rel: CANONICAL_REL, existsRequired: true, embeds: true, tier: null, canonical: true },
  { rel: "CLAUDE.md", existsRequired: true, embeds: false, tier: null },
  { rel: "AGENTS.md", existsRequired: true, embeds: true, tier: null },
  { rel: "CODEX.md", existsRequired: true, embeds: true, tier: "full-entry" },
  { rel: "ANTIGRAVITY.md", existsRequired: true, embeds: true, tier: "full-entry" },
];

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
      continue;
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
    res = runParity({});
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
