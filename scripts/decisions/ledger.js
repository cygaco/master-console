#!/usr/bin/env node

const mcEnv = require("../hooks/lib/mc-env");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");

function loadPaths() {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(ROOT, ".claude", "paths.json"), "utf8"),
    );
  } catch {
    return {};
  }
}

function ledgerPath() {
  const paths = loadPaths();
  return path.join(
    ROOT,
    paths.decisionLedger || ".claude/project/decisions/decision-ledger.jsonl",
  );
}

function readEntries() {
  const file = ledgerPath();
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, idx) => {
      try {
        return JSON.parse(line);
      } catch (e) {
        return { _invalid: true, line: idx + 1, error: e.message };
      }
    });
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) out[key] = true;
      else {
        out[key] = next;
        i += 1;
      }
    }
  }
  return out;
}

function appendDecision(fields) {
  const file = ledgerPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const entry = {
    id:
      fields.id ||
      `DEC-${new Date().toISOString().slice(0, 10)}-${Date.now().toString(36)}`,
    ts: fields.ts || new Date().toISOString(),
    class: fields.class || fields.riskClass || "B",
    owner: fields.owner || "alpha",
    topic: fields.topic || "unspecified",
    decision: fields.decision || "",
    why: fields.why || "",
    reversible: fields.reversible === true || fields.reversible === "true",
    reversalPlan: fields.reversalPlan || fields["reversal-plan"] || "",
    expiresOrReviewAfter:
      fields.expiresOrReviewAfter || fields["review-after"] || null,
    topic_tags: fields.tags
      ? String(fields.tags)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
    source: fields.source || "manual",
  };
  const sid = fields.sprint_id || mcEnv.readEnv("SPRINT_ID") || null;
  if (sid) entry.sprint_id = sid;
  fs.appendFileSync(file, JSON.stringify(entry) + "\n", "utf8");
  return entry;
}

function validate(entries) {
  const findings = [];
  for (const e of entries) {
    if (e._invalid) {
      findings.push({
        severity: "red",
        message: `invalid JSON on line ${e.line}: ${e.error}`,
      });
      continue;
    }
    for (const key of [
      "id",
      "ts",
      "class",
      "owner",
      "topic",
      "decision",
      "why",
      "reversible",
      "reversalPlan",
    ]) {
      if (e[key] === undefined || e[key] === "") {
        findings.push({
          severity: "red",
          message: `${e.id || "(missing id)"} missing ${key}`,
        });
      }
    }
    if (!["A", "B", "C"].includes(e.class)) {
      findings.push({
        severity: "red",
        message: `${e.id} has invalid class ${e.class}`,
      });
    }
  }
  const bc = entries.filter(
    (e) => e && !e._invalid && ["B", "C"].includes(e.class),
  );
  if (entries.length === 0) {
    findings.push({
      severity: "yellow",
      message:
        "no decisions recorded yet; record one with node scripts/decisions/ledger.js --record --class B --topic <topic> --decision <text> --why <text> --reversal-plan <text>",
    });
  } else if (bc.length === 0) {
    findings.push({
      severity: "red",
      message: "decision ledger has no Class B/C entries",
    });
  }
  const status = findings.some((f) => f.severity === "red")
    ? "red"
    : findings.length > 0
      ? "yellow"
      : "green";
  return {
    ok: findings.length === 0,
    status,
    entries: entries.length,
    classBC: bc.length,
    findings,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.record) {
    const entry = appendDecision(args);
    console.log(JSON.stringify(entry, null, 2));
    return;
  }
  const result = validate(readEntries());
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const f of result.findings)
      console.log(`[${f.severity.toUpperCase()}] ${f.message}`);
    console.log(
      `decision-ledger: ${result.entries} entries, ${result.classBC} Class B/C, ${result.status === "green" ? "PASS" : result.status === "yellow" ? "NOT STARTED" : "FAIL"}`,
    );
  }
  process.exit(result.status === "green" ? 0 : result.status === "yellow" ? 1 : 2);
}

if (require.main === module) main();

module.exports = { appendDecision, readEntries, validate, ledgerPath };
