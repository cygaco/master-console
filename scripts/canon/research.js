#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCHEMA_PATH = path.join(
  REPO_ROOT,
  "schemas",
  "canon",
  "research-fields.schema.json",
);

const DEFAULT_MAX_QUERIES = 6;
const DEFAULT_BACKEND = "simple";

function loadCapSchema(schemaPath = SCHEMA_PATH) {
  if (!fs.existsSync(schemaPath))
    throw new Error(`canon research cap schema missing at ${schemaPath}`);
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  const perDoc = (schema.properties && schema.properties.per_doc &&
    schema.properties.per_doc.properties) || {};
  const fieldsByDoc = {};
  for (const [doc, def] of Object.entries(perDoc)) {
    fieldsByDoc[doc] = Array.isArray(def["x-fields"]) ? def["x-fields"] : [];
  }
  const capProps =
    (schema.properties && schema.properties.research_cap &&
      schema.properties.research_cap.properties) || {};
  const cap = {
    max_queries:
      (capProps.max_queries && capProps.max_queries.default) ||
      DEFAULT_MAX_QUERIES,
    backend:
      (capProps.backend && capProps.backend.default) || DEFAULT_BACKEND,
  };
  return { schema, fieldsByDoc, cap, allowedDocs: Object.keys(fieldsByDoc) };
}

function fieldToQuestion(field, product) {
  const subject = product ? `the product "${product}"` : "this product";
  const human = field.replace(/_/g, " ");
  return (
    `For ${subject} and its product category: ${human}? ` +
    `Answer in 1-3 sentences and cite real sources.`
  );
}

function buildResearchQuerySet(thinDocs, capInfo, product) {
  const { fieldsByDoc, cap } = capInfo;
  const queries = [];
  for (const doc of thinDocs) {
    const fields = fieldsByDoc[doc];
    if (!fields) continue;
    for (const field of fields) {
      queries.push({ doc, field, question: fieldToQuestion(field, product) });
    }
  }
  const total = queries.length;
  const max = cap.max_queries;
  const truncated = total > max;
  return {
    backend: cap.backend,
    max_queries: max,
    total_candidates: total,
    truncated,
    queries: queries.slice(0, max),
  };
}

function validateFindings(findings, capInfo) {
  const { fieldsByDoc, allowedDocs } = capInfo;
  const errors = [];
  const warnings = [];
  const rejected = [];
  const thinDocs = [];
  const valid = {};

  if (!findings || typeof findings !== "object") {
    errors.push("research findings: not an object");
    return { valid, errors, warnings, thinDocs, rejected };
  }
  for (const k of Object.keys(findings)) {
    if (k !== "per_doc" && k !== "research_cap") {
      rejected.push(`root.${k}`);
      warnings.push(`research findings: discarded out-of-schema root key "${k}"`);
    }
  }
  const perDoc = findings.per_doc;
  if (!perDoc || typeof perDoc !== "object") {
    errors.push('research findings: missing or non-object "per_doc"');
    return { valid, errors, warnings, thinDocs, rejected };
  }

  for (const [doc, def] of Object.entries(perDoc)) {
    if (!allowedDocs.includes(doc)) {
      rejected.push(`per_doc.${doc}`);
      warnings.push(
        `research findings: discarded out-of-schema doc "${doc}" (not in cap)`,
      );
      continue;
    }
    if (!def || typeof def !== "object") {
      warnings.push(`research findings: "${doc}" is not an object — skipped`);
      continue;
    }
    const allowedFields = fieldsByDoc[doc] || [];
    const rawFindings =
      def.findings && typeof def.findings === "object" ? def.findings : {};
    const cleanFindings = {};
    for (const [field, val] of Object.entries(rawFindings)) {
      if (!allowedFields.includes(field)) {
        rejected.push(`per_doc.${doc}.findings.${field}`);
        warnings.push(
          `research findings: discarded out-of-schema field "${doc}.${field}"`,
        );
        continue;
      }
      if (typeof val === "string" && val.trim()) cleanFindings[field] = val.trim();
    }
    const sources = Array.isArray(def.sources)
      ? def.sources.filter((s) => typeof s === "string" && s.trim())
      : [];

    if (Object.keys(cleanFindings).length === 0) {
      continue;
    }
    if (sources.length === 0) {
      thinDocs.push(doc);
      warnings.push(
        `research findings: "${doc}" has findings but EMPTY sources[] — treated as THIN (not merged)`,
      );
      continue;
    }
    valid[doc] = { findings: cleanFindings, sources };
  }

  return { valid, errors, warnings, thinDocs, rejected };
}

function findingsBlock(validForDoc) {
  const lines = [
    "",
    "## Research Signals (non-canonical — cited)",
    "",
    "<!-- Capped research fill (research-fields.schema.json). Supplementary " +
      "category signal, NOT canonical assertions — refine into the canonical " +
      "sections above as the product is validated. -->",
    "",
  ];
  for (const [field, val] of Object.entries(validForDoc.findings)) {
    lines.push(`- **${field.replace(/_/g, " ")}:** ${val}`);
  }
  lines.push("");
  lines.push("**Sources:**");
  for (const s of validForDoc.sources) lines.push(`- ${s}`);
  lines.push("");
  return lines.join("\n");
}

function mergeFindings(artifacts, valid) {
  const merged = [];
  const skipped = [];
  for (const [doc, def] of Object.entries(valid)) {
    const fname = `${doc}.md`;
    if (typeof artifacts[fname] !== "string") {
      skipped.push(doc);
      continue;
    }
    artifacts[fname] = artifacts[fname].replace(/\s*$/, "\n") + findingsBlock(def);
    merged.push(doc);
  }
  return { merged, skipped };
}

module.exports = {
  loadCapSchema,
  buildResearchQuerySet,
  validateFindings,
  mergeFindings,
  fieldToQuestion,
  SCHEMA_PATH,
};
