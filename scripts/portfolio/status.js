"use strict";

/**
 * scripts/portfolio/status.js — /portfolio:status dashboard (T-20260521-173).
 *
 * Per-product columns: SLUG, WARP, LAST COMMIT, DIRTY, SPRINT, REMOTE.
 * Parallel execution mandatory (Beta design-review directive 2026-05-21T21:11Z):
 *   - Promise.all over the product list
 *   - Per-product 5s timeout — a slow disk or unreachable gh remote MUST NOT
 *     block sibling products
 *
 * Sources of truth (do not paraphrase here):
 *   - Granular story:        requirements/SP-20260521-001/granular-stories.md S-6
 *   - Acceptance criteria:   requirements/SP-20260521-001/acceptance-criteria.md AC-6.1..6.3
 *   - Table format:          requirements/SP-20260521-001/copy.md C-11
 *   - Telemetry payload:     requirements/SP-20260521-001/trace.md TR-9
 *
 * Privacy contract (Scenario-9 / ticket description): TR-9 carries counts
 * only — no slugs, no repo_path strings. Counts: product_count, dirty_count,
 * stale_count, remote_unreachable_count.
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const { load } = require("./registry");

const PER_PRODUCT_TIMEOUT_MS = 5000;

// Column widths chosen to fit C-11's sample line:
//   "pantry-pilot  0.8.2   a1b2c3d 2 days ago   0       SP-20260530-001  ✓ github"
const COL = {
  slug: 13,
  warp: 7,
  commit: 20,
  dirty: 7,
  sprint: 16,
  remote: 12,
};

function pad(str, len) {
  const s = String(str == null ? "" : str);
  if (s.length >= len) return s.slice(0, len);
  return s + " ".repeat(len - s.length);
}

// ── runCmd: spawn-array + bounded timeout, returns {stdout, status} ──
// Used for git + gh probes. No shell, no string concat (redteam T-4 stays
// closed even though all inputs here are framework-controlled). Resolves
// with status: "ok" | "timeout" | "missing" | "failed".
function runCmd(cmd, args, opts) {
  return new Promise((resolve) => {
    let child;
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    try {
      child = spawn(cmd, args, {
        cwd: opts && opts.cwd,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      });
    } catch (err) {
      // ENOENT on Windows when the binary is missing manifests here.
      return settle({ stdout: "", status: err.code === "ENOENT" ? "missing" : "failed" });
    }

    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", () => {}); // discarded

    const tid = setTimeout(() => {
      try { child.kill(); } catch {}
      settle({ stdout: stdout.trim(), status: "timeout" });
    }, (opts && opts.timeoutMs) || PER_PRODUCT_TIMEOUT_MS);

    child.on("error", (err) => {
      clearTimeout(tid);
      settle({ stdout: "", status: err.code === "ENOENT" ? "missing" : "failed" });
    });
    child.on("close", (code) => {
      clearTimeout(tid);
      if (code === 0) return settle({ stdout: stdout.trim(), status: "ok" });
      settle({ stdout: stdout.trim(), status: "failed" });
    });
  });
}

function warpVersion(repoPath) {
  try {
    const fi = path.join(repoPath, ".claude", "framework-installed.json");
    const data = JSON.parse(fs.readFileSync(fi, "utf8"));
    return data.installedVersion || "?";
  } catch {
    return "?";
  }
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

// gatherPerProduct — runs all per-product probes for one product, bounded by
// PER_PRODUCT_TIMEOUT_MS via Promise.race against a single timeout.
// Returns a row object that the renderer can format.
async function gatherPerProduct(entry) {
  const repoPath = entry.repo_path;
  const exists = repoPath && fs.existsSync(repoPath);

  if (!exists) {
    // AC-6.2: stale indicator when repo_path no longer exists.
    return {
      slug: entry.slug,
      warp: "?",
      commit: "----",
      commitRelative: "stale",
      dirty: "?",
      sprint: "(none)",
      remote: "? stale",
      stale: true,
      dirtyCount: 0,
      remoteUnreachable: true,
    };
  }

  // Bound the whole per-product probe set with a single timeout.
  const probeTimeout = new Promise((resolve) =>
    setTimeout(() => resolve("__per_product_timeout__"), PER_PRODUCT_TIMEOUT_MS),
  );

  // Synchronous reads first (warp, sprint) — these never block on subprocesses.
  const warp = warpVersion(repoPath);
  const sprint = currentSprint(repoPath);

  // Subprocess probes in parallel.
  const subprocessProbes = Promise.all([
    runCmd("git", ["log", "-1", "--format=%h %ar"], {
      cwd: repoPath,
      timeoutMs: PER_PRODUCT_TIMEOUT_MS,
    }),
    runCmd("git", ["status", "--porcelain"], {
      cwd: repoPath,
      timeoutMs: PER_PRODUCT_TIMEOUT_MS,
    }),
    // gh remote check: AC-6.3 — if `gh` not on PATH, REMOTE column shows "?".
    runCmd("gh", ["repo", "view", "--json", "url"], {
      cwd: repoPath,
      timeoutMs: PER_PRODUCT_TIMEOUT_MS,
    }),
  ]);

  const winner = await Promise.race([subprocessProbes, probeTimeout]);

  if (winner === "__per_product_timeout__") {
    return {
      slug: entry.slug,
      warp,
      commit: "----",
      commitRelative: "timeout",
      dirty: "?",
      sprint,
      remote: "? timeout",
      stale: false,
      dirtyCount: 0,
      remoteUnreachable: true,
    };
  }

  const [commitR, dirtyR, ghR] = winner;

  let commit = "----";
  if (commitR.status === "ok" && commitR.stdout) commit = commitR.stdout;

  let dirty = "?";
  let dirtyCount = 0;
  if (dirtyR.status === "ok") {
    if (dirtyR.stdout === "") {
      dirty = "0";
      dirtyCount = 0;
    } else {
      const n = dirtyR.stdout.split(/\r?\n/).filter(Boolean).length;
      dirty = String(n);
      dirtyCount = n;
    }
  }

  let remote;
  let remoteUnreachable = true;
  if (ghR.status === "missing") {
    remote = "?";
  } else if (ghR.status === "ok" && ghR.stdout.includes("github.com")) {
    remote = "✓ github";
    remoteUnreachable = false;
  } else if (ghR.status === "ok") {
    remote = "✓ remote";
    remoteUnreachable = false;
  } else if (ghR.status === "timeout") {
    remote = "? timeout";
  } else {
    // failed: gh present but repo has no remote (or gh auth not set up).
    remote = "(none)";
  }

  return {
    slug: entry.slug,
    warp,
    commit,
    dirty,
    sprint,
    remote,
    stale: false,
    dirtyCount,
    remoteUnreachable,
  };
}

function renderTable(rows, out) {
  const header =
    pad("SLUG", COL.slug) + " " +
    pad("WARP", COL.warp) + " " +
    pad("LAST COMMIT", COL.commit) + " " +
    pad("DIRTY", COL.dirty) + " " +
    pad("SPRINT", COL.sprint) + " " +
    "REMOTE";
  const sep = "-".repeat(header.length);
  out.write(header + "\n" + sep + "\n");
  for (const r of rows) {
    out.write(
      pad(r.slug, COL.slug) + " " +
      pad(r.warp, COL.warp) + " " +
      pad(r.commit, COL.commit) + " " +
      pad(r.dirty, COL.dirty) + " " +
      pad(r.sprint, COL.sprint) + " " +
      r.remote +
      "\n"
    );
  }
}

function emitTrace(rows) {
  // TR-9 privacy contract — counts only, no slug/repo_path strings.
  const payload = {
    type: "portfolio_status",
    product_count: rows.length,
    dirty_count: rows.reduce((acc, r) => acc + (r.dirtyCount > 0 ? 1 : 0), 0),
    stale_count: rows.reduce((acc, r) => acc + (r.stale ? 1 : 0), 0),
    remote_unreachable_count: rows.reduce(
      (acc, r) => acc + (r.remoteUnreachable ? 1 : 0),
      0,
    ),
  };
  try {
    const loggerPath = path.resolve(__dirname, "..", "hooks", "lib", "logger.js");
    const { log } = require(loggerPath);
    log("portfolio", payload);
  } catch {
    // fail-open
  }
}

/**
 * statusForRegistry — programmatic entry point. Used by the /portfolio:status
 * skill body and by tests.
 *
 * @param {object} [opts]
 * @param {Writable} [opts.stdout] — defaults to process.stdout
 * @param {Writable} [opts.stderr] — defaults to process.stderr
 * @returns {Promise<{exitCode:number, rows:object[]}>}
 */
async function statusForRegistry(opts) {
  const stdout = (opts && opts.stdout) || process.stdout;
  const stderr = (opts && opts.stderr) || process.stderr;

  let doc;
  try {
    doc = load();
  } catch (err) {
    stderr.write((err.message || "registry load failed") + "\n");
    return { exitCode: 2, rows: [] };
  }
  const products = Object.values(doc.products || {});

  if (products.length === 0) {
    stdout.write(
      "No products registered yet. Use /portfolio:register <slug> <path> [<github-url>] to add one.\n",
    );
    emitTrace([]);
    return { exitCode: 0, rows: [] };
  }

  // Parallel by default (Beta directive + user feedback parallelize_multi_sprint).
  const rows = await Promise.all(products.map(gatherPerProduct));

  // Render in registry order to keep output stable across runs.
  renderTable(rows, stdout);
  emitTrace(rows);
  return { exitCode: 0, rows };
}

async function main() {
  const r = await statusForRegistry({});
  process.exit(r.exitCode);
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write("portfolio:status failed: " + (err.message || err) + "\n");
    process.exit(2);
  });
}

module.exports = {
  statusForRegistry,
  // exported for tests:
  gatherPerProduct,
  runCmd,
  PER_PRODUCT_TIMEOUT_MS,
};
