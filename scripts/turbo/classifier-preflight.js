#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");

const MAPPING = {
  honored: [
    { scope: "commit", basis: "local commit auto-approved under permissions.allow; reversible" },
    { scope: "branch", basis: "branch/worktree ops auto-approved under permissions.allow" },
    { scope: "spend", basis: "metered API spend governed by the $5/op line + session ceiling, not classifier per-action gating" },
    { scope: "manifest-edit", basis: "Edit/Write to .claude/manifest.json auto-approved under permissions.allow" },
    { scope: "write-jsonl", basis: ".jsonl writes auto-approved under permissions.allow" },
    { scope: "worktree-ops", basis: "git worktree add/remove/prune auto-approved under permissions.allow" },
  ],
  gated: [
    {
      scope: "push-to-main",
      basis:
        "the classifier sits above permissions.allow and gates push on per-action intent.",
      evidence: "empirical observation",
    },
    {
      scope: "merge-to-main",
      basis: "the push that lands a merge to the default branch is classifier-gated for the same reason.",
    },
    {
      scope: "force-push-main",
      basis: "hard ceiling — never, independent of the classifier.",
    },
  ],
};

function resolveProject() {
  return path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
}

function runtimeDir(project) {
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(project, ".claude", "paths.json"), "utf8"),
    );
    if (raw.runtime) return path.join(project, raw.runtime);
  } catch {
  }
  return path.join(project, ".claude", "runtime");
}

function buildMapping() {
  return {
    schema: "mc/turbo-classifier-preflight/v1",
    recorded_at: new Date().toISOString(),
    honored: MAPPING.honored.map((h) => h.scope),
    gated: MAPPING.gated.map((g) => g.scope),
    detail: MAPPING,
    provenance:
      "Empirically proven. " +
      "Refresh by attempting one push-to-main under an active Bash(git push *) allow rule.",
  };
}

function classify(scope) {
  const s = String(scope || "").toLowerCase();
  if (MAPPING.honored.some((h) => h.scope === s)) return "honored";
  if (MAPPING.gated.some((g) => g.scope === s)) return "gated";
  return "unknown";
}

function writeMapping(opts = {}) {
  const project = resolveProject();
  const dir = opts.outDir || runtimeDir(project);
  const file = opts.outFile || path.join(dir, "turbo-classifier-preflight.json");
  const record = buildMapping();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(record, null, 2) + "\n", "utf8");
    fs.renameSync(tmp, file);
    return { ok: true, file, record };
  } catch (e) {
    return { ok: false, file, record, error: String(e.message || e) };
  }
}

function renderMapping(record) {
  const lines = [
    "turbo classifier preflight (which scopes the harness auto-mode classifier honors)",
    "",
    "  HONORED (permissions.allow auto-approves → turbo level `auto`):",
    ...record.detail.honored.map((h) => `    ${h.scope.padEnd(16)} ${h.basis}`),
    "",
    "  GATED per-action (classifier sits ABOVE permissions.allow → turbo level `confirm`/`never`):",
    ...record.detail.gated.map((g) => `    ${g.scope.padEnd(16)} ${g.basis}`),
    "",
    `  provenance: ${record.provenance}`,
  ];
  return lines.join("\n");
}

module.exports = {
  MAPPING,
  buildMapping,
  classify,
  writeMapping,
  renderMapping,
};

if (require.main === module) {
  const json = process.argv.includes("--json");
  const write = process.argv.includes("--write");
  const record = buildMapping();
  if (write) {
    const r = writeMapping();
    if (!json) {
      process.stdout.write(
        (r.ok ? `[preflight] mapping written → ${r.file}\n` : `[preflight] write failed (fail-open): ${r.error}\n`),
      );
    }
  }
  if (json) {
    process.stdout.write(JSON.stringify(record, null, 2) + "\n");
  } else if (!write) {
    process.stdout.write(renderMapping(record) + "\n");
  }
  process.exit(0);
}
