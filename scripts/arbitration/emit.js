#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT =
  process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const STORE = path.join(ROOT, "runtime", "arbitration");

function emit(o = {}) {
  const { unit, owner, decision, rationale } = o;
  if (!unit || !owner || !decision || !rationale) {
    throw new Error(
      "arbitration.emit: `unit`, `owner`, `decision`, `rationale` are required",
    );
  }
  const rec = {
    type: "decision_record",
    id: "dr-" + Date.now().toString(36) + "-" + crypto.randomBytes(3).toString("hex"),
    unit: String(unit),
    decision: String(decision),
    owner: String(owner),
    rationale: String(rationale),
    precedence_basis: o.precedenceBasis ? String(o.precedenceBasis) : "n/a",
    confidence: typeof o.confidence === "number" ? o.confidence : 0,
    arbitration_needed: o.arbitrationNeeded !== false,
    artifact_precedence:
      typeof o.artifactPrecedence === "number" ? o.artifactPrecedence : 0,
    emitted_at: new Date().toISOString(),
    resolved: false,
  };
  const safeUnit = rec.unit.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const dir = path.join(STORE, safeUnit);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, rec.id + ".json"), JSON.stringify(rec, null, 2));
  return rec;
}

module.exports = { emit, STORE };

if (require.main === module) {
  const [, , unit, owner, decision, rationale] = process.argv;
  const rec = emit({ unit, owner, decision, rationale });
  process.stdout.write(JSON.stringify(rec, null, 2) + "\n");
}
