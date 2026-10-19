#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const NAME = "integration-seam";

function buildSpecPrecedence() {
  try {
    const s = JSON.parse(
      fs.readFileSync(
        path.join(ROOT, "schemas", "contracts", "build_spec.schema.json"),
        "utf8",
      ).replace(/^﻿/, ""),
    );
    const p = s && s.contract && s.contract.precedence;
    return typeof p === "number" ? p : 70;
  } catch {
    return 70;
  }
}

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8").replace(/^﻿/, ""));
}

function distinct(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}

function evaluate({ manifest, typeShapeResolver, smokeResolver } = {}) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("integration manifest is not an object");
  }
  if (!manifest.feature || !Array.isArray(manifest.builders)) {
    throw new Error("integration manifest missing required `feature` / `builders[]`");
  }

  const builders = distinct(manifest.builders);
  if (builders.length < 2) {
    return { applicable: false, errors: [] };
  }

  const errors = [];
  const builderSet = new Set(builders);

  const sharedReconciledBy = new Set();
  for (const sf of manifest.shared_files || []) {
    const editors = distinct(sf.edited_by);
    if (editors.length >= 2) {
      const reconciled =
        sf.reconciled_by &&
        String(sf.reconciled_by).trim() &&
        sf.reconciliation &&
        String(sf.reconciliation).trim();
      if (!reconciled) {
        errors.push(
          `shared-file-unreconciled: "${sf.path}" edited by ${editors.join(" + ")} has no reconciliation record (reconciled_by + reconciliation) — own-the-integration-seam`,
        );
      }
    }
    for (const e of editors) sharedReconciledBy.add(e);
  }

  for (const tc of manifest.type_contracts || []) {
    const consumers = distinct(tc.consumed_by);
    if (consumers.length === 0) continue;
    if (!tc.produced_by || !String(tc.produced_by).trim()) {
      errors.push(
        `consumed-type-no-producer: type "${tc.name}" is consumed by ${consumers.join(", ")} but no producer (produced_by) defines its shape`,
      );
      continue;
    }
    let resolved = null;
    if (typeof typeShapeResolver === "function") {
      try {
        resolved = typeShapeResolver(tc);
      } catch {
        resolved = false;
      }
    }
    const matches = resolved === null ? tc.shape_match === true : resolved === true;
    if (!matches) {
      errors.push(
        `type-shape-mismatch: FE-consumed type "${tc.name}" does not match the ${tc.produced_by}-produced shape (consumer must adapt to producer)`,
      );
    }
  }

  for (const sc of manifest.seam_contracts || []) {
    const required = distinct(sc.required_fields);
    const present = new Set(distinct(sc.present_fields));
    for (const field of required) {
      if (!present.has(field)) {
        errors.push(
          `seam-contract-missing-field: seam contract "${sc.name}" (${sc.kind || "?"}) is missing required field "${field}"`,
        );
      }
    }
  }

  const smoke = manifest.smoke_test && String(manifest.smoke_test).trim();
  if (!smoke) {
    errors.push(
      `smoke-test-absent: multi-builder feature "${manifest.feature}" declares no FE<->BE boundary smoke test (smoke_test)`,
    );
  } else if (typeof smokeResolver === "function" && !smokeResolver(smoke)) {
    errors.push(
      `smoke-test-absent: declared smoke test "${smoke}" does not resolve on disk`,
    );
  }

  const merge = manifest.merge || {};
  const order = distinct(merge.order);
  if (order.length) {
    for (const m of order) {
      if (!builderSet.has(m)) {
        errors.push(
          `merge-order-incoherent: merge.order names "${m}" which is not one of this feature's builders [${builders.join(", ")}]`,
        );
      }
    }
    for (const editor of sharedReconciledBy) {
      if (!order.includes(editor)) {
        errors.push(
          `merge-order-incoherent: "${editor}" edited a shared file but is absent from merge.order [${order.join(", ")}] — its changes would not be merged`,
        );
      }
    }
  }

  return { applicable: true, errors };
}

function parkIfOneshot({ manifest, errors, emitFn }) {
  if (!errors.length) return null;
  if (manifest.mode !== "oneshot") return null;
  const emit = emitFn || require(path.join(ROOT, "scripts", "arbitration", "emit.js")).emit;
  return emit({
    unit: manifest.feature,
    owner: "gamma_integration",
    decision: `integration seam unresolved for "${manifest.feature}" (${errors.length} reject(s))`,
    rationale: errors.join(" | "),
    precedenceBasis: `build_spec.precedence=${buildSpecPrecedence()} (producer/BE shape leads; own-the-integration-seam)`,
    artifactPrecedence: buildSpecPrecedence(),
  });
}

function main(argv) {
  const json = argv.includes("--json");
  const emitOnConflict = argv.includes("--emit-on-conflict");
  const manifestPath = argv.slice(2).find((a) => !a.startsWith("--"));

  if (!manifestPath) {
    process.stderr.write(
      `${NAME}: usage: node scripts/checks/integration-seam-gate.js <manifest.json> [--json] [--emit-on-conflict]\n`,
    );
    return 2;
  }

  let manifest, result;
  try {
    manifest = readJSON(path.resolve(ROOT, manifestPath));
    result = evaluate({ manifest });
  } catch (e) {
    process.stderr.write(`${NAME}-gate error: ${e.message}\n`);
    return 2;
  }

  const { applicable, errors } = result;

  let parked = null;
  if (emitOnConflict && errors.length) {
    try {
      parked = parkIfOneshot({ manifest, errors });
    } catch (e) {
      process.stderr.write(`${NAME}-gate arbitration emit failed: ${e.message}\n`);
      return 2;
    }
  }

  if (json) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: errors.length === 0,
          check: NAME,
          feature: manifest.feature,
          mode: manifest.mode || "adhoc",
          applicable,
          errors,
          parked_arbitration: parked ? parked.id : null,
        },
        null,
        2,
      ) + "\n",
    );
    return errors.length ? 1 : 0;
  }

  if (!applicable) {
    process.stdout.write(
      `OK   [${NAME}] feature "${manifest.feature}" is single-builder — integration phase N/A\n`,
    );
    return 0;
  }
  if (errors.length === 0) {
    process.stdout.write(
      `OK   [${NAME}] feature "${manifest.feature}" FE<->BE seam governed (shared files reconciled, types match, seam contracts complete, smoke present, merge coherent)\n`,
    );
    return 0;
  }
  process.stderr.write(
    `FAIL [${NAME}] integration seam REJECTED for "${manifest.feature}" (${errors.length}):\n${errors.map((e) => `  - ${e}`).join("\n")}\n`,
  );
  if (parked) {
    process.stderr.write(
      `  ▸ oneshot: parked for arbitration as ${parked.id} (owner gamma_integration, @prec ${parked.artifact_precedence}) — run-end resolver blocks ship-ready until alpha/beta resolve.\n`,
    );
  } else if (manifest.mode === "oneshot") {
    process.stderr.write(
      `  ▸ oneshot: re-run with --emit-on-conflict to park this for the run-end arbitration resolver (no alpha/beta in the room).\n`,
    );
  } else {
    process.stderr.write(
      `  ▸ adhoc: surface to alpha (live alpha/beta) — treat as a blocking gauntlet failure; fixer/re-builder, max 3.\n`,
    );
  }
  return 1;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = { evaluate, parkIfOneshot, buildSpecPrecedence, NAME };
