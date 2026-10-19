"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { load } = require("./registry");

const COL = { slug: 18, path: 48, mc: 7, commit: 19, dirty: 7, sprint: 20 };

function pad(str, len) {
  return String(str || "").padEnd(len).slice(0, len);
}

function run(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, stdio: ["pipe", "pipe", "pipe"], timeout: 5000 })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

function mcVersion(repoPath) {
  try {
    const fi = path.join(repoPath, ".claude", "framework-installed.json");
    const data = JSON.parse(fs.readFileSync(fi, "utf8"));
    return data.installedVersion || "?";
  } catch {
    return "?";
  }
}

function lastCommit(repoPath) {
  const out = run('git log -1 --format="%h %ar"', repoPath);
  return out || "----";
}

function dirtyCount(repoPath) {
  const out = run("git status --porcelain", repoPath);
  if (out === null) return "?";
  return out === "" ? "0" : String(out.split("\n").length);
}

function currentSprint(repoPath) {
  try {
    const fp = path.join(repoPath, ".claude", "project", "sprint", "current-sprint.yaml");
    const raw = fs.readFileSync(fp, "utf8");
    const m = raw.match(/^sprint:\s*(.+)$/m);
    return m ? m[1].trim() : "(none)";
  } catch {
    return "(none)";
  }
}

function emitTrace(slugs) {
  try {
    const loggerPath = path.resolve(__dirname, "../hooks/lib/logger.js");
    const { log } = require(loggerPath);
    log("portfolio", { type: "portfolio_list", product_count: slugs.length, slugs });
  } catch {
  }
}

function main() {
  let doc;
  try {
    doc = load();
  } catch (err) {
    process.stderr.write(err.message + "\n");
    process.exit(2);
  }

  const products = Object.values(doc.products || {});

  if (products.length === 0) {
    process.stdout.write(
      "No products registered yet. Use /portfolio:register <slug> <path> [<github-url>] to add one, or /portfolio:new <slug> to scaffold a fresh private repo.\n"
    );
    emitTrace([]);
    process.exit(0);
  }

  const header =
    pad("SLUG", COL.slug) +
    " " +
    pad("PATH", COL.path) +
    " " +
    pad("MC", COL.mc) +
    " " +
    pad("LAST COMMIT", COL.commit) +
    " " +
    pad("DIRTY", COL.dirty) +
    " " +
    "SPRINT";
  const sep = "-".repeat(header.length);
  process.stdout.write(header + "\n" + sep + "\n");

  const slugs = [];
  for (const p of products) {
    slugs.push(p.slug);
    const repoPath = p.repo_path;
    const exists = fs.existsSync(repoPath);
    const mc = exists ? mcVersion(repoPath) : "?";
    const commit = exists ? lastCommit(repoPath) : "----";
    const dirty = exists ? dirtyCount(repoPath) : "?";
    const sprint = exists ? currentSprint(repoPath) : "(none)";

    process.stdout.write(
      pad(p.slug, COL.slug) +
        " " +
        pad(repoPath, COL.path) +
        " " +
        pad(mc, COL.mc) +
        " " +
        pad(commit, COL.commit) +
        " " +
        pad(dirty, COL.dirty) +
        " " +
        sprint +
        "\n"
    );
  }

  emitTrace(slugs);
  process.exit(0);
}

main();
