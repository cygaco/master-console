"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const { load } = require("./registry");

const PER_PRODUCT_TIMEOUT_MS = 5000;

const COL = {
  slug: 13,
  mc: 7,
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
      return settle({ stdout: "", status: err.code === "ENOENT" ? "missing" : "failed" });
    }

    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", () => {});

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

function mcVersion(repoPath) {
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

async function gatherPerProduct(entry) {
  const repoPath = entry.repo_path;
  const exists = repoPath && fs.existsSync(repoPath);

  if (!exists) {
    return {
      slug: entry.slug,
      mc: "?",
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

  const probeTimeout = new Promise((resolve) =>
    setTimeout(() => resolve("__per_product_timeout__"), PER_PRODUCT_TIMEOUT_MS),
  );

  const mc = mcVersion(repoPath);
  const sprint = currentSprint(repoPath);

  const subprocessProbes = Promise.all([
    runCmd("git", ["log", "-1", "--format=%h %ar"], {
      cwd: repoPath,
      timeoutMs: PER_PRODUCT_TIMEOUT_MS,
    }),
    runCmd("git", ["status", "--porcelain"], {
      cwd: repoPath,
      timeoutMs: PER_PRODUCT_TIMEOUT_MS,
    }),
    runCmd("gh", ["repo", "view", "--json", "url"], {
      cwd: repoPath,
      timeoutMs: PER_PRODUCT_TIMEOUT_MS,
    }),
  ]);

  const winner = await Promise.race([subprocessProbes, probeTimeout]);

  if (winner === "__per_product_timeout__") {
    return {
      slug: entry.slug,
      mc,
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
    remote = "(none)";
  }

  return {
    slug: entry.slug,
    mc,
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
    pad("MC", COL.mc) + " " +
    pad("LAST COMMIT", COL.commit) + " " +
    pad("DIRTY", COL.dirty) + " " +
    pad("SPRINT", COL.sprint) + " " +
    "REMOTE";
  const sep = "-".repeat(header.length);
  out.write(header + "\n" + sep + "\n");
  for (const r of rows) {
    out.write(
      pad(r.slug, COL.slug) + " " +
      pad(r.mc, COL.mc) + " " +
      pad(r.commit, COL.commit) + " " +
      pad(r.dirty, COL.dirty) + " " +
      pad(r.sprint, COL.sprint) + " " +
      r.remote +
      "\n"
    );
  }
}

function emitTrace(rows) {
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
  }
}

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

  const rows = await Promise.all(products.map(gatherPerProduct));

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
  gatherPerProduct,
  runCmd,
  PER_PRODUCT_TIMEOUT_MS,
};
