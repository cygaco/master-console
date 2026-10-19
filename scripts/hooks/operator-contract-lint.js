#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

function readStdin() {
  try {
    const raw = fs.readFileSync(0, "utf8");
    if (!raw || !raw.trim()) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function main() {
  const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");

  let logger = null;
  try {
    logger = require("./lib/logger");
  } catch {
    logger = null;
  }
  function telemetry(data) {
    try {
      if (logger) logger.log("audit", { type: "operator-contract-lint", ...data });
    } catch {
    }
  }

  const payload = readStdin();
  if (!payload) {
    telemetry({ verdict: "skip", reason: "unreadable-stdin" });
    process.exit(0);
  }

  if (payload.stop_hook_active) {
    process.exit(0);
  }

  let contractCfg;
  try {
    contractCfg = require("./lib/project-config").getOperatorContract();
  } catch {
    telemetry({ verdict: "skip", reason: "config-unreadable" });
    process.exit(0);
  }

  if (!contractCfg.enabled || contractCfg.strictness === "off") {
    telemetry({ verdict: "pass", reason: "disabled", strictness: contractCfg.strictness });
    process.exit(0);
  }

  let opContract;
  try {
    opContract = require("./lib/operator-contract");
  } catch {
    telemetry({ verdict: "skip", reason: "lib-unreadable" });
    process.exit(0);
  }

  let resolved;
  try {
    resolved = opContract.resolveInput(payload, { root: ROOT });
  } catch {
    telemetry({ verdict: "skip", reason: "resolve-threw" });
    process.exit(0);
  }

  if (resolved.skip) {
    telemetry({ verdict: "pass", reason: `skipped:${resolved.reason}` });
    process.exit(0);
  }

  let result;
  try {
    result = opContract.lint(resolved.text, {
      strictness: contractCfg.strictness,
      maxLinesBeforeHeader: contractCfg.maxLinesBeforeHeader,
      allowIdentifiers: contractCfg.allowIdentifiers,
      extraCommandPrefixes: contractCfg.extraCommandPrefixes,
      detailRequested: resolved.detailRequested,
    });
  } catch (e) {
    telemetry({ verdict: "skip", reason: "lint-threw", detail: String(e && e.message).slice(0, 200) });
    process.exit(0);
  }

  const codes = result.findings.map((f) => f.code);
  telemetry({
    verdict: result.verdict,
    strictness: contractCfg.strictness,
    findings: codes,
    lines: resolved.text.split(/\r\n|\r|\n/).length,
  });

  if (result.verdict !== "block") {
    if (result.verdict === "warn") {
      const lines = result.findings
        .map((f) => `  ${f.code} (line ${f.line}): ${f.excerpt}`)
        .join("\n");
      process.stderr.write(
        `[operator-contract] advisory — this message would be blocked under a stricter ` +
          `setting:\n${lines}\n  See paths.operatorContract.\n`,
      );
    }
    process.exit(0);
  }

  const lines = result.findings
    .map((f) => `  ${f.code} (line ${f.line}): ${f.excerpt}`)
    .join("\n");
  process.stderr.write(
    `[operator-contract] BLOCKED — the message to the operator violates the contract:\n` +
      `${lines}\n` +
      `  Fix: use exactly one of ▶️ RUN THIS / ⚠️ DECISION NEEDED / ⛔ BLOCKED / 📌 FYI around ` +
      `anything the operator must see or act on; no bare command or question outside those ` +
      `blocks. See paths.operatorContract. (stop_hook_active guarantees this fires at most once.)\n`,
  );
  process.exit(2);
}

try {
  main();
} catch (e) {
  try {
    require("./lib/logger").log("audit", { type: "operator-contract-lint", verdict: "skip", reason: "main-threw", detail: String((e && e.message) || e).slice(0, 200) });
  } catch {
  }
  try {
    process.exit(0);
  } catch {
  }
}
