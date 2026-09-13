"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { load, save, validate } = require("./registry");

// Reserved slugs that collide with skill names
const RESERVED = new Set([
  "list", "register", "open", "new", "adopt", "status",
  "dispatch", "sync", "bootstrap", "clone", "ponder", "import",
]);

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const GH_RE = /^(https:\/\/github\.com\/|git@github\.com:|git:\/\/github\.com\/)/;

function emitTrace(slug, status, rejectionReason) {
  try {
    const loggerPath = path.resolve(__dirname, "../hooks/lib/logger.js");
    const { log } = require(loggerPath);
    const payload = { type: "portfolio_register", slug, status };
    if (rejectionReason) payload.rejection_reason = rejectionReason;
    log("portfolio", payload);
  } catch {
    // fail-open
  }
}

function die(code, msg) {
  process.stderr.write(msg + "\n");
  process.exit(code);
}

function main() {
  const args = process.argv.slice(2);
  const slug = args[0];
  const rawPath = args[1];
  const githubUrl = args[2] || null;

  if (!slug) die(2, "Usage: register.js <slug> <path> [<github-url>]");
  if (!rawPath) die(2, "Usage: register.js <slug> <path> [<github-url>]");

  // Validate slug
  if (!SLUG_RE.test(slug)) {
    const normalized = slug.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^[^a-z0-9]+/, "");
    emitTrace(slug, "rejected", "invalid_slug");
    die(2, `Invalid slug '${slug}'. Slugs must match ^[a-z0-9][a-z0-9-]{0,63}$.\nSuggested: ${normalized || "<fix slug>"}`);
  }
  if (RESERVED.has(slug)) {
    emitTrace(slug, "rejected", "reserved_slug");
    die(2, `'${slug}' collides with a reserved /portfolio:* skill name. Choose a different slug.`);
  }

  // Validate github_url
  if (githubUrl && !GH_RE.test(githubUrl)) {
    emitTrace(slug, "rejected", "invalid_github_url");
    die(2, `Invalid github-url '${githubUrl}'. Only github.com URLs supported in v1 (https://, git@github.com:, git://).`);
  }

  // Resolve and validate repo_path
  const repoPath = path.resolve(rawPath);
  if (!fs.existsSync(repoPath)) {
    emitTrace(slug, "rejected", "path_not_found");
    die(4, `Directory does not exist: ${repoPath}`);
  }

  // Load registry
  let doc;
  try {
    doc = load();
  } catch (err) {
    die(2, err.message);
  }

  // Idempotency check
  const existing = doc.products[slug];
  if (existing) {
    if (existing.repo_path === repoPath) {
      process.stdout.write(`already registered: ${slug} → ${repoPath}\n`);
      process.exit(0);
    }
    emitTrace(slug, "rejected", "slug_conflict");
    die(2, `'${slug}' is already registered at ${existing.repo_path}. Unregister it first with /portfolio:register --remove ${slug}.`);
  }

  // Detect mc_version
  let mcVersion = null;
  try {
    const fi = path.join(repoPath, ".claude", "framework-installed.json");
    const data = JSON.parse(fs.readFileSync(fi, "utf8"));
    mcVersion = data.installedVersion || null;
  } catch {
    // not installed — that's fine
  }

  // Build entry
  const entry = {
    slug,
    repo_path: repoPath,
    github_url: githubUrl,
    mc_version: mcVersion,
    last_synced: new Date().toISOString(),
    role: "product",
    remote_type: githubUrl ? "github" : null,
  };

  const { valid, errors } = validate(entry);
  if (!valid) {
    emitTrace(slug, "rejected", "validation_failed");
    die(2, `Entry validation failed:\n${errors.map(e => "  " + e).join("\n")}`);
  }

  doc.products[slug] = entry;
  save(doc);

  // C-5 success
  process.stdout.write(
    `registered: ${slug} → ${repoPath} (github_url: ${githubUrl || "none"})\n`
  );

  emitTrace(slug, "registered");
  process.exit(0);
}

main();
