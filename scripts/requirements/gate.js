
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { GRAPH_FILE, SPECS_ROOT, listFeatureDirs } = require("./config");
const { loadGraph } = require("./graph-load");
const { listOpen, listByClass } = require("./apply-rco");

function gitStagedFiles() {
  try {
    return execSync("git diff --cached --name-only", { encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

const { resolveRepoRole } = require("../mc/repo-role");
function isCanonicalRepo() {
  return resolveRepoRole({ root: path.resolve(__dirname, "..", "..") }).role === "canonical";
}

function checkGraphPresent() {
  if (!fs.existsSync(GRAPH_FILE)) {
    if (listFeatureDirs().length === 0) {
      const specsRel = path.relative(path.resolve(__dirname, "..", ".."), SPECS_ROOT).replace(/\\/g, "/");
      return {
        ok: true,
        severity: "yellow",
        message: `Requirements graph not built yet (no feature specs under ${specsRel}). Run: node scripts/requirements/graph-build.js`,
      };
    }
    return {
      ok: false,
      severity: "red",
      message:
        "Requirements graph missing. Run: node scripts/requirements/graph-build.js",
    };
  }
  const g = loadGraph();
  if (!g) {
    return {
      ok: false,
      severity: "red",
      message: "Requirements graph unreadable.",
    };
  }
  if (!g.counts || g.counts.requirements === 0) {
    if (isCanonicalRepo()) {
      return {
        ok: true,
        severity: "green",
        message:
          "Canonical framework repo — no product requirements to measure (empty graph is expected, not a merge blocker).",
      };
    }
    return {
      ok: false,
      severity: "red",
      message:
        "Requirements graph has zero requirements — coverage cannot be measured.",
    };
  }
  return {
    ok: true,
    severity: "green",
    message: `Graph OK: ${g.counts.requirements} requirements across ${g.counts.features} features.`,
  };
}

function checkGraphFresh() {
  const g = loadGraph();
  if (!g)
    return { ok: true, severity: "green", message: "no graph; covered above" };

  if (
    !g.counts ||
    typeof g.counts.requirements !== "number" ||
    typeof g.counts.features !== "number" ||
    typeof g.counts.mappedFiles !== "number"
  ) {
    return {
      ok: false,
      severity: "red",
      message:
        "Requirements graph missing or malformed counts envelope — refuse to trust. Re-run scripts/requirements/graph-build.js",
    };
  }
  const actualReqs = Object.keys(g.requirements || {}).length;
  const actualFeats = Object.keys(g.features || {}).length;
  const actualFiles = Object.keys(g.files || {}).length;
  if (
    actualReqs !== g.counts.requirements ||
    actualFeats !== g.counts.features ||
    actualFiles !== g.counts.mappedFiles
  ) {
    return {
      ok: false,
      severity: "red",
      message: `Requirements graph integrity mismatch: counts say ${g.counts.requirements}/${g.counts.features}/${g.counts.mappedFiles} but document holds ${actualReqs}/${actualFeats}/${actualFiles}. Re-run scripts/requirements/graph-build.js`,
    };
  }

  const stale = [];
  const crypto = require("crypto");
  for (const [name, rec] of Object.entries(g.features)) {
    const dir = path.resolve(__dirname, "..", "..", rec.specDir);
    for (const [file, snap] of [
      ["PRD.md", rec.prdSha],
      ["STORIES.md", rec.storiesSha],
      ["HL-STORIES.md", rec.hlStoriesSha],
    ]) {
      const full = path.join(dir, file);
      if (!snap) continue;
      if (!fs.existsSync(full)) continue;
      const cur = crypto
        .createHash("sha256")
        .update(fs.readFileSync(full))
        .digest("hex");
      if (cur !== snap) stale.push(`${name}/${file}`);
    }
  }
  if (stale.length === 0) {
    return {
      ok: true,
      severity: "green",
      message: "Graph is fresh against spec content hashes.",
    };
  }
  return {
    ok: false,
    severity: "red",
    message:
      "Spec content has changed since graph was built. Re-run scripts/requirements/graph-build.js",
    details: stale,
  };
}

function checkOpenClassC() {
  const open = listByClass("C").filter(
    (e) => e.status === "open" || e.status === undefined,
  );
  if (open.length === 0)
    return { ok: true, severity: "green", message: "No open Class C RCOs." };
  return {
    ok: false,
    severity: "red",
    message: `${open.length} open Class C RCO(s) require human resolution before merge.`,
    details: open.map((e) => ({ id: e.id, summary: e.summary || e.reason })),
  };
}

function checkStaleRequirementsHaveRCO() {
  const g = loadGraph();
  if (!g) return { ok: true, severity: "green", message: "no graph" };
  const { loadStatus } = require("./status");
  const statusFile = loadStatus();
  const persisted = statusFile.requirements || {};
  const allReqs = Object.values(g.requirements);
  const stalePending = allReqs.filter((r) => {
    const live = (persisted[r.id] || {}).verificationStatus;
    return (
      live === "stale_pending_review" ||
      r.verificationStatus === "stale_pending_review"
    );
  });
  if (stalePending.length === 0) {
    return {
      ok: true,
      severity: "green",
      message: "No stale_pending_review requirements.",
    };
  }
  const open = listOpen();
  const coveredIds = new Set();
  for (const e of open) {
    for (const id of e.impactedRequirements || []) coveredIds.add(id);
  }
  const uncovered = stalePending.filter((r) => !coveredIds.has(r.id));
  if (uncovered.length === 0) {
    return {
      ok: true,
      severity: "green",
      message: `${stalePending.length} stale requirements all have RCOs.`,
    };
  }
  return {
    ok: false,
    severity: "red",
    message: `${uncovered.length} stale_pending_review requirement(s) have no RCO.`,
    details: uncovered.map((r) => r.id),
  };
}

function checkUnmappedStaged(stagedFiles) {
  const g = loadGraph();
  if (!g) return { ok: true, severity: "green", message: "no graph" };
  const codePatterns = [/\.tsx?$/, /\.jsx?$/];
  const concerning = [];
  for (const f of stagedFiles) {
    if (!codePatterns.some((re) => re.test(f))) continue;
    const norm = f.replace(/\\/g, "/");
    if (g.files[norm]) continue;
    let matched = false;
    for (const k of Object.keys(g.files)) {
      if (norm.startsWith(k.replace(/\/$/, "") + "/") || k === norm) {
        matched = true;
        break;
      }
    }
    if (matched) continue;
    let content = "";
    try {
      content = fs.readFileSync(f, "utf8");
    } catch {
    }
    if (/requirements-unmapped-allowed/.test(content)) continue;
    concerning.push(f);
  }
  if (concerning.length === 0) {
    return {
      ok: true,
      severity: "green",
      message: "All staged code files map to requirements.",
    };
  }
  return {
    ok: false,
    severity: "yellow",
    message: `${concerning.length} staged code file(s) are not in any feature's implementation map.`,
    details: concerning,
  };
}

function runGate(opts) {
  const stagedOnly = opts && opts.stagedOnly;
  const checks = [
    { name: "graph_present", run: checkGraphPresent },
    { name: "graph_fresh", run: checkGraphFresh },
    { name: "open_class_c", run: checkOpenClassC },
    { name: "stale_requirements_have_rco", run: checkStaleRequirementsHaveRCO },
  ];
  if (stagedOnly) {
    const staged = gitStagedFiles();
    checks.push({
      name: "unmapped_staged",
      run: () => checkUnmappedStaged(staged),
    });
  }

  const results = [];
  let red = 0;
  let yellow = 0;
  for (const c of checks) {
    let r;
    try {
      r = c.run();
    } catch (e) {
      r = {
        ok: false,
        severity: "red",
        message: `${c.name} threw: ${e.message}`,
      };
    }
    results.push({ name: c.name, ...r });
    if (r.severity === "red") red += 1;
    if (r.severity === "yellow") yellow += 1;
  }

  const summary = {
    ok: red === 0,
    red,
    yellow,
    green: results.length - red - yellow,
    results,
  };
  return summary;
}

function format(summary) {
  const lines = [];
  for (const r of summary.results) {
    const flag =
      r.severity === "red" ? "RED " : r.severity === "yellow" ? "YEL " : "GRN ";
    lines.push(`[${flag}] ${r.name}: ${r.message}`);
    if (r.details) {
      const ds = Array.isArray(r.details) ? r.details : [r.details];
      for (const d of ds.slice(0, 10)) {
        lines.push(
          `        - ${typeof d === "string" ? d : JSON.stringify(d)}`,
        );
      }
      if (ds.length > 10) lines.push(`        ... (${ds.length - 10} more)`);
    }
  }
  lines.push(
    `\nSummary: ${summary.green} green, ${summary.yellow} yellow, ${summary.red} red — gate ${summary.ok ? "PASS" : "FAIL"}`,
  );
  return lines.join("\n");
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const stagedOnly = args.includes("--staged-only");
  const summary = runGate({ stagedOnly });
  if (json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(format(summary));
  }
  process.exit(summary.red > 0 ? 2 : summary.yellow > 0 ? 1 : 0);
}

module.exports = {
  runGate,
  format,
};
