#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const NAME = "operator-contract";

const DOCTRINE_MD = path.join(
  ROOT,
  ".claude",
  "agents",
  "president",
  "_system",
  "policy",
  "operator-contract.md",
);
const CLAUDE_MD = path.join(ROOT, "CLAUDE.md");
const HOOKS_REGISTRY = path.join(ROOT, "framework", "hooks.registry.json");
const SETTINGS = path.join(ROOT, ".claude", "settings.json");
const LINT_TEST = path.join(ROOT, "scripts", "hooks", "operator-contract-lint.test.js");
const LIB = path.join(ROOT, "scripts", "hooks", "lib", "operator-contract.js");
const EVENTS_RELATIVE = ".claude/project/events/events.jsonl";

function extractHeaderTableRows(markdown) {
  const lines = markdown.split(/\r?\n/);
  const rows = [];
  let inTable = false;
  for (const line of lines) {
    const t = line.trim();
    if (!inTable) {
      if (/^\|\s*Header\s*\|/i.test(t)) inTable = true;
      continue;
    }
    if (/^\|\s*-{2,}/.test(t)) continue;
    if (!t.startsWith("|")) break;
    rows.push(t);
  }
  return rows;
}

function hashRows(rows) {
  return crypto.createHash("sha256").update(rows.join("\n")).digest("hex").slice(0, 16);
}

function headerTypesFromRows(rows) {
  const types = new Set();
  for (const row of rows) {
    const cell = row.split("|")[1] || "";
    const m = /(RUN THIS|DECISION NEEDED|BLOCKED|FYI)/i.exec(cell);
    if (m) types.add(m[1].toUpperCase());
  }
  return types;
}

function evaluate({ fixtureSuiteOk, registryEntry, settingsHasHook, docRows, claudeMdRows, libHeaderTypes }) {
  const findings = [];

  if (!fixtureSuiteOk) {
    findings.push({
      severity: "high",
      check: NAME,
      kind: "fixture-suite-red",
      message: "scripts/hooks/operator-contract-lint.test.js did not exit 0 — the fixture suite is not green",
    });
  }

  if (!registryEntry) {
    findings.push({
      severity: "high",
      check: NAME,
      kind: "not-registered",
      message: "operator-contract-lint is not in framework/hooks.registry.json",
    });
  } else {
    if (registryEntry.enabled === false) {
      findings.push({ severity: "high", check: NAME, kind: "disabled-in-registry", message: "operator-contract-lint is registered but enabled:false" });
    }
    const hasStop = (registryEntry.registrations || []).some((r) => r.event === "Stop");
    if (!hasStop) {
      findings.push({ severity: "high", check: NAME, kind: "no-stop-registration", message: "operator-contract-lint has no Stop registration" });
    }
  }

  if (!settingsHasHook) {
    findings.push({
      severity: "high",
      check: NAME,
      kind: "not-compiled",
      message: "operator-contract-lint.js is registered but not present in the compiled .claude/settings.json Stop block — run node scripts/hooks/build.js",
    });
  }

  if (docRows.length === 0) {
    findings.push({ severity: "high", check: NAME, kind: "doctrine-table-missing", message: "paths.operatorContract's doc has no header table to compare" });
  }
  if (claudeMdRows.length === 0) {
    findings.push({ severity: "high", check: NAME, kind: "claude-md-table-missing", message: "CLAUDE.md has no header table to compare" });
  }
  if (docRows.length > 0 && claudeMdRows.length > 0) {
    const docHash = hashRows(docRows);
    const claudeHash = hashRows(claudeMdRows);
    if (docHash !== claudeHash) {
      findings.push({
        severity: "high",
        check: NAME,
        kind: "doctrine-drift",
        message: `the header table in paths.operatorContract's doc (${docHash}) and CLAUDE.md (${claudeHash}) have drifted — keep both verbatim-identical`,
      });
    }
    const docTypes = headerTypesFromRows(docRows);
    const missingInLib = [...docTypes].filter((t) => !libHeaderTypes.has(t));
    const extraInLib = [...libHeaderTypes].filter((t) => !docTypes.has(t));
    if (missingInLib.length) {
      findings.push({ severity: "high", check: NAME, kind: "lib-missing-header", message: `doc names header(s) the lib's HEADERS constant does not cover: ${missingInLib.join(", ")}` });
    }
    if (extraInLib.length) {
      findings.push({ severity: "high", check: NAME, kind: "lib-extra-header", message: `lib's HEADERS constant covers header(s) not in the doctrine table: ${extraInLib.join(", ")}` });
    }
  }

  return findings;
}

function telemetrySummary(eventsFile) {
  const summary = { verdicts: {}, codes: {}, totalEvents: 0 };
  try {
    if (!fs.existsSync(eventsFile)) return summary;
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const lines = fs.readFileSync(eventsFile, "utf8").split("\n");
    for (const line of lines) {
      if (!line || !line.includes('"operator-contract-lint"')) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (!entry.data || entry.data.type !== "operator-contract-lint") continue;
      if (new Date(entry.ts).getTime() < sevenDaysAgo) continue;
      summary.totalEvents++;
      const verdict = entry.data.verdict || "unknown";
      summary.verdicts[verdict] = (summary.verdicts[verdict] || 0) + 1;
      for (const code of entry.data.findings || []) {
        summary.codes[code] = (summary.codes[code] || 0) + 1;
      }
    }
  } catch {
  }
  return summary;
}

function main() {
  const asJson = process.argv.includes("--json");

  let registry, settings, docMd, claudeMd, lib;
  try {
    registry = JSON.parse(fs.readFileSync(HOOKS_REGISTRY, "utf8"));
    settings = JSON.parse(fs.readFileSync(SETTINGS, "utf8"));
    docMd = fs.readFileSync(DOCTRINE_MD, "utf8");
    claudeMd = fs.readFileSync(CLAUDE_MD, "utf8");
    lib = require(LIB);
  } catch (e) {
    const msg = `setup error: ${e && e.message ? e.message : String(e)}`;
    process.stdout.write((asJson ? JSON.stringify({ ok: false, check: NAME, error: msg }) : `ERROR  ${NAME}: ${msg}`) + "\n");
    process.exit(2);
  }

  const registryEntry = (registry.hooks || []).find((h) => h.id === "operator-contract-lint") || null;

  let settingsHasHook = false;
  for (const block of settings.hooks && settings.hooks.Stop ? settings.hooks.Stop : []) {
    for (const h of block.hooks || []) {
      if (String(h.command || "").includes("operator-contract-lint.js")) settingsHasHook = true;
    }
  }

  const fixtureRun = spawnSync(process.execPath, ["--test", LINT_TEST], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60000,
  });
  const fixtureSuiteOk = fixtureRun.status === 0;

  const docRows = extractHeaderTableRows(docMd);
  const claudeMdRows = extractHeaderTableRows(claudeMd);
  const libHeaderTypes = new Set(Object.values(lib.HEADERS || {}).map((h) => h.labelUC));

  const findings = evaluate({ fixtureSuiteOk, registryEntry, settingsHasHook, docRows, claudeMdRows, libHeaderTypes });
  const telemetry = telemetrySummary(path.join(ROOT, EVENTS_RELATIVE));

  if (asJson) {
    process.stdout.write(
      JSON.stringify({ ok: findings.length === 0, check: NAME, findings, telemetry }, null, 2) + "\n",
    );
  } else {
    for (const f of findings) process.stdout.write(`FAIL  [${f.kind}] ${f.message}\n`);
    process.stdout.write(
      `# operator-contract: fixture-suite=${fixtureSuiteOk ? "green" : "RED"} registered=${!!registryEntry} ` +
        `compiled=${settingsHasHook} doctrine-parity=${findings.every((f) => f.kind !== "doctrine-drift")} ` +
        `— ${findings.length} finding(s); telemetry(7d): ${telemetry.totalEvents} event(s) ${JSON.stringify(telemetry.verdicts)}\n`,
    );
  }
  process.exit(findings.length ? 1 : 0);
}

if (require.main === module) main();

module.exports = { evaluate, extractHeaderTableRows, headerTypesFromRows, hashRows, telemetrySummary };
