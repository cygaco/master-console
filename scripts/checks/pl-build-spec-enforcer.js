#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const NAME = "pl-build-spec-enforcer";
const OWNER = "product_lead";

function toItems(input) {
  if (Array.isArray(input)) return input;
  if (input && Array.isArray(input.chain)) return input.chain;
  return [input];
}

function evaluate({ items, validateChain, reg }) {
  const errors = [];
  const emits = [];

  const chainResult = validateChain(items, reg);
  for (const e of chainResult.errors) errors.push(`contract: ${e}`);

  const buildSpecs = items.filter((it) => it && it.type === "build_spec");
  const messageBriefs = items.filter((it) => it && it.type === "message_brief");
  const designBriefs = items.filter((it) => it && it.type === "design_brief");
  const mbIds = new Set(messageBriefs.map((m) => m.id));
  const bsPrecedence =
    (reg && reg.build_spec && reg.build_spec.contract && reg.build_spec.contract.precedence) || 70;

  if (buildSpecs.length === 0) {
    errors.push(
      "missing-upstream: no build_spec present in the input — the PL enforcer was pointed at a chain with nothing to build (fail-closed, not a no-op pass)",
    );
    return { errors, emits };
  }

  for (const bs of buildSpecs) {
    const ref = bs.derived_from_message_brief;

    if (messageBriefs.length === 0) {
      errors.push(
        `missing-upstream: build_spec#${bs.id || "(no id)"} has no message_brief (the spine) present in the chain — not buildable truth (contract-first-construction)`,
      );
    } else if (typeof ref === "string" && ref && !mbIds.has(ref)) {
      errors.push(
        `missing-upstream: build_spec#${bs.id || "(no id)"} derives from message_brief '${ref}' which is absent from the chain (dangling spine)`,
      );
    }

    for (const db of designBriefs) {
      const dbRef = db.derived_from_message_brief;
      if (
        typeof ref === "string" && ref &&
        typeof dbRef === "string" && dbRef &&
        dbRef !== ref
      ) {
        emits.push({
          reason: "design-conflict",
          decision: `park: build_spec#${bs.id} and design_brief#${db.id} disagree on the spine`,
          rationale: `build_spec derives from message_brief '${ref}' but design_brief#${db.id} derives from '${dbRef}'; two upstreams claim different spines and the Product Lead cannot pick the winner alone (precedence: build_spec 70 > design_brief 30, but a contradicted upstream is a coherence defect, not an override license)`,
          confidence: 0.3,
          precedenceBasis: "build_spec(70) > design_brief(30); contradicted upstream => arbitration",
          artifactPrecedence: bsPrecedence,
        });
      }
    }

    if (
      designBriefs.length === 0 &&
      messageBriefs.length > 0 &&
      !(typeof ref === "string" && ref && !mbIds.has(ref))
    ) {
      emits.push({
        reason: "low-confidence-no-design-brief",
        decision: `park: build_spec#${bs.id} has no design_brief upstream to realize`,
        rationale: `build_spec validates against the contract and its spine is present, but no design_brief is in the chain for it to realize (design_brief is a declared consumer-of-message_brief that build_spec consumes); the Product Lead flags this coherence gap for arbitration rather than certifying a build with no design intent`,
        confidence: 0.4,
        precedenceBasis: "design_brief(30) is a declared upstream of build_spec(70)",
        artifactPrecedence: bsPrecedence,
      });
    }
  }

  return { errors, emits };
}

function main(argv) {
  const json = argv.includes("--json");
  const file = argv.slice(2).find((a) => !a.startsWith("--"));
  if (!file) {
    process.stderr.write("usage: pl-build-spec-enforcer.js <chain.json> [--json]\n");
    return 2;
  }

  let result, emitted;
  try {
    const { loadSchemas, validateChain, DEFAULT_SCHEMAS_DIR } = require(
      path.join(ROOT, "scripts/contracts/validate-artifact.js"),
    );
    const { emit } = require(path.join(ROOT, "scripts/arbitration/emit.js"));
    const reg = loadSchemas(DEFAULT_SCHEMAS_DIR);
    const input = JSON.parse(fs.readFileSync(path.resolve(file), "utf8").replace(/^﻿/, ""));
    const items = toItems(input);
    result = evaluate({ items, validateChain, reg });

    emitted = [];
    const unit = items.find((it) => it && it.type === "build_spec" && it.id)
      ? items.find((it) => it && it.type === "build_spec" && it.id).id
      : path.basename(file);
    for (const e of result.emits) {
      emitted.push(
        emit({
          unit,
          owner: OWNER,
          decision: e.decision,
          rationale: e.rationale,
          confidence: e.confidence,
          precedenceBasis: e.precedenceBasis,
          artifactPrecedence: e.artifactPrecedence,
        }),
      );
    }
  } catch (e) {
    process.stderr.write(`${NAME} error: ${e.message}\n`);
    return 2;
  }

  const { errors, emits } = result;
  const rejected = errors.length > 0;
  const parked = emits.length > 0;

  if (json) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: !rejected && !parked,
          check: NAME,
          owner: OWNER,
          rejected,
          parked,
          errors,
          arbitration: emitted.map((r) => ({ id: r.id, unit: r.unit, decision: r.decision })),
        },
        null,
        2,
      ) + "\n",
    );
    return rejected ? 1 : parked ? 1 : 0;
  }

  if (rejected) {
    process.stderr.write(
      `REJECT [${NAME}] build_spec failed Product-Lead enforcement (${errors.length}):\n${errors.map((e) => "  - " + e).join("\n")}\n`,
    );
    return 1;
  }
  if (parked) {
    process.stderr.write(
      `ARBITRATION [${NAME}] build_spec parked for arbitration (${emits.length}) — NOT ship-ready until α/β resolve:\n${emits.map((e) => "  ▸ " + e.decision + " :: " + e.rationale.slice(0, 140)).join("\n")}\n  (emitted to runtime/arbitration; the resolver gate will block ship-ready)\n`,
    );
    return 1;
  }
  process.stdout.write(`OK   [${NAME}] build_spec is buildable truth (contract valid + spine + design intent present)\n`);
  return 0;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = { evaluate, toItems, NAME, OWNER };
