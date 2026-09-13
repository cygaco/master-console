"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const SCHEMA_ID = "mc/portfolio-registry/v1";
const SCHEMA_PATH = path.resolve(
  __dirname,
  "../../schemas/portfolio/registry.schema.json"
);

// ── Registry location ──────────────────────────────────────
// Resolved fresh on every call — never cached — so WARPOS_PORTFOLIO_REGISTRY
// overrides and os.homedir() changes (e.g. in tests) are always respected.
function registryPath() {
  const override = process.env.WARPOS_PORTFOLIO_REGISTRY;
  if (override) return path.resolve(override);
  const home = os.homedir();
  if (!home) {
    throw Object.assign(
      new Error(
        "cannot resolve HOME dir; set WARPOS_PORTFOLIO_REGISTRY to override"
      ),
      { exitCode: 2 }
    );
  }
  return path.join(home, ".warpos", "portfolio.json");
}

// ── Empty document shape ───────────────────────────────────
function emptyRegistry() {
  return { schema: SCHEMA_ID, products: {} };
}

// ── load() ────────────────────────────────────────────────
// Returns the registry document. Missing file → empty shape (not an error).
// Corrupt JSON → throws with exitCode 2.
function load() {
  const rp = registryPath();
  let doc;

  if (!fs.existsSync(rp)) {
    doc = emptyRegistry();
    _emitRegistryRead(rp, 0, true);
    return doc;
  }

  let raw;
  try {
    raw = fs.readFileSync(rp, "utf8");
  } catch (err) {
    throw Object.assign(
      new Error(`Portfolio registry is unreadable at ${rp}: ${err.message}`),
      { exitCode: 2 }
    );
  }

  try {
    // Strip a leading UTF-8 BOM — PowerShell's default Out-File/Set-Content
    // encoding prepends one, which JSON.parse rejects. Tolerate it on read.
    doc = JSON.parse(raw.replace(/^﻿/, ""));
  } catch {
    throw Object.assign(
      new Error(
        `Portfolio registry is corrupt at ${rp}. Fix manually or delete to reset.`
      ),
      { exitCode: 2 }
    );
  }

  const count = doc.products ? Object.keys(doc.products).length : 0;
  _emitRegistryRead(rp, count, false);
  return doc;
}

// ── save(doc) ─────────────────────────────────────────────
// Atomic write: write to .portfolio.json.tmp, then rename.
// Creates ~/.warpos/ dir lazily.
function save(doc) {
  const rp = registryPath();
  const dir = path.dirname(rp);
  fs.mkdirSync(dir, { recursive: true });

  const tmp = rp + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, rp);
}

// ── list() ────────────────────────────────────────────────
// Returns array of product entry objects.
function list() {
  const doc = load();
  return Object.values(doc.products || {});
}

// ── findBySlug(slug) ──────────────────────────────────────
// Returns the product entry or null.
function findBySlug(slug) {
  const doc = load();
  return (doc.products && doc.products[slug]) || null;
}

// ── validate(entry) ───────────────────────────────────────
// Validates a product entry object against the schema definition.
// Returns { valid: boolean, errors: string[] }.
// Intentionally inline — avoids pulling in ajv/jsonschema for a simple
// field check at framework layer.
function validate(entry) {
  const errors = [];

  if (!entry || typeof entry !== "object") {
    return { valid: false, errors: ["entry must be an object"] };
  }

  // Required fields
  const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
  if (!entry.slug || !SLUG_RE.test(entry.slug)) {
    errors.push(
      `slug must match ^[a-z0-9][a-z0-9-]{0,63}$ (got: ${JSON.stringify(entry.slug)})`
    );
  }
  if (!entry.repo_path || typeof entry.repo_path !== "string") {
    errors.push("repo_path is required and must be a string");
  }
  const ROLES = ["framework", "product", "fork"];
  if (!entry.role || !ROLES.includes(entry.role)) {
    errors.push(`role must be one of ${ROLES.join("|")} (got: ${JSON.stringify(entry.role)})`);
  }
  if (!entry.last_synced || typeof entry.last_synced !== "string") {
    errors.push("last_synced is required and must be an ISO-8601 string");
  }

  // Optional fields with constraints
  if (entry.github_url !== undefined && entry.github_url !== null) {
    const GH_RE = /^(https:\/\/github\.com\/|git@github\.com:|git:\/\/github\.com\/)/;
    if (!GH_RE.test(entry.github_url)) {
      errors.push(
        `github_url must be a github.com URL (https://, git@, or git://) (got: ${JSON.stringify(entry.github_url)})`
      );
    }
  }
  const REMOTE_TYPES = ["github", "gitlab", "bitbucket", null, undefined];
  if (!REMOTE_TYPES.includes(entry.remote_type)) {
    errors.push(
      `remote_type must be one of github|gitlab|bitbucket|null (got: ${JSON.stringify(entry.remote_type)})`
    );
  }

  return { valid: errors.length === 0, errors };
}

// ── Internal: emit trace events ───────────────────────────
function _emitRegistryRead(rp, productCount, wasCreated) {
  try {
    const loggerPath = path.resolve(
      __dirname,
      "../hooks/lib/logger.js"
    );
    const { log } = require(loggerPath);
    if (wasCreated) {
      log("portfolio", {
        type: "portfolio_registry_initialized",
        registry_path: _pathOffset(rp),
        created_at: new Date().toISOString(),
        schema: SCHEMA_ID,
      });
    } else {
      log("portfolio", {
        type: "portfolio_registry_read",
        product_count: productCount,
        registry_version: SCHEMA_ID,
      });
    }
  } catch {
    // fail-open — telemetry never blocks core registry operations
  }
}

// path_offset: path relative to os.homedir() — never log absolute paths
function _pathOffset(absPath) {
  try {
    return path.relative(os.homedir(), absPath);
  } catch {
    return "<path>";
  }
}

module.exports = { load, save, list, findBySlug, validate, registryPath, emptyRegistry };
