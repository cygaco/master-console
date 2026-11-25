#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");

const TAG = "agent-spawn-model-guard";
const HARNESS_ALIASES = new Set(["sonnet", "opus", "haiku", "fable"]);
const DEFAULT_AGENT_TYPE = "general-purpose";

function projectContext() {
  const { PROJECT, PATHS } = require("./lib/paths");
  const projectDir = path.resolve(PROJECT);
  return {
    projectDir,
    agentsDir: PATHS.agents || path.join(projectDir, ".claude", "agents"),
    registryFile: PATHS.orgRoleRegistry || path.join(projectDir, ".claude", "agents", "_org", "role-registry.json"),
    catalogFile: path.join(PATHS.hooks || path.join(projectDir, "scripts", "hooks"), "..", "dispatch", "catalog.js"),
  };
}

function normPath(p) {
  let q = path.resolve(p);
  try {
    q = fs.realpathSync.native(q);
  } catch {
  }
  q = q.replace(/[\\/]+$/, "");
  return process.platform === "win32" ? q.toLowerCase() : q;
}

function isSameOrUnder(child, parent) {
  const c = normPath(child);
  const p = normPath(parent);
  return c === p || c.startsWith(p + path.sep);
}

function relForUser(projectDir, file) {
  return path.relative(projectDir, file).split(path.sep).join("/");
}

function catalogClaudeIds(catalogFile) {
  const catalog = require(catalogFile);
  const models = catalog && catalog.PROVIDERS && catalog.PROVIDERS.claude && catalog.PROVIDERS.claude.models;
  const ids = Array.isArray(models)
    ? models.map((m) => (m && typeof m.id === "string" ? m.id.trim().toLowerCase() : "")).filter(Boolean)
    : [];
  if (!ids.length) throw new Error("the dispatch catalog lists no Claude models");
  return new Set(ids);
}

function scalar(rawValue) {
  const t = String(rawValue || "").trim();
  const q = t[0];
  if (q === '"' || q === "'") {
    const end = t.indexOf(q, 1);
    return end > 0 ? t.slice(1, end) : t.slice(1);
  }
  return t.replace(/\s+#.*$/, "").trim();
}

function readFrontmatter(file) {
  const { parse } = require("../dispatch/frontmatter");
  const raw = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
  const parsed = parse(raw);
  if (!parsed.fmLines.length && /^---\r?\n/.test(raw)) {
    throw new Error(`the frontmatter of ${path.basename(file)} is never closed`);
  }
  const out = {};
  for (const e of parsed.entries) if (!(e.key in out)) out[e.key] = scalar(e.rawValue);
  const fm = parsed.fmLines.slice(1, -1);
  const KEY_LINE = /^[A-Za-z_][A-Za-z0-9_-]*\s*:\s*(.*)$/;
  const nonCanonical = fm.some((l) => l.trim() !== "" && !/^\s/.test(l) && !/^#/.test(l) && !/^-(\s|$)/.test(l) && !KEY_LINE.test(l));
  const count = (k) => parsed.entries.filter((e) => e.key === k).length;
  const PLAIN_VIOLATION = {
    model: [/^model\s*:\s*(#.*)?$/, /^model\s*:\s*[|>&*!{[]/, /^\s+model\s*:/],
    name: [/^name\s*:\s*(#.*)?$/, /^name\s*:\s*[|>&*!{[]/, /^\s+name\s*:/],
  };
  const nonPlainValue = (k) => fm.some((l) => PLAIN_VIOLATION[k].some((re) => re.test(l)));
  out.__ambiguousModel = nonCanonical || count("model") > 1 || count("name") > 1 || nonPlainValue("model") || nonPlainValue("name");
  return out;
}

function walkSpecs(dir, out) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith(".system")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkSpecs(full, out);
    else if (e.isFile() && e.name.endsWith(".md")) out.push(full);
  }
  return out;
}

function specFilesFor(role, ctx) {
  const registry = JSON.parse(fs.readFileSync(ctx.registryFile, "utf8"));
  const roles = (registry && registry.roles) || {};
  const row = Object.prototype.hasOwnProperty.call(roles, role) ? roles[role] : null;
  const matches = [];
  if (row && typeof row.spec === "string" && row.spec.trim()) {
    const file = path.resolve(ctx.projectDir, row.spec.trim());
    if (fs.existsSync(file)) matches.push(file);
  }
  for (const file of walkSpecs(ctx.agentsDir, []).sort()) {
    if (matches.some((m) => path.resolve(m) === path.resolve(file))) continue;
    let fm = null;
    try {
      fm = readFrontmatter(file);
    } catch {
      continue;
    }
    if (fm.name === role) {
      matches.push(file);
    } else if (fm.__ambiguousModel) {
      let head = "";
      try {
        head = fs.readFileSync(file, "utf8").split(/\r?\n---/)[0];
      } catch {
        head = "";
      }
      const escaped = role.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`(^|[^A-Za-z0-9_-])${escaped}([^A-Za-z0-9_-]|$)`, "m").test(head)) matches.push(file);
    }
  }
  return matches;
}

function allowKind(model, claudeIds) {
  const m = String(model == null ? "" : model).trim().toLowerCase();
  if (!m || m === "inherit") return "inherit";
  if (HARNESS_ALIASES.has(m)) return "alias";
  const ids = typeof claudeIds === "function" ? claudeIds() : claudeIds;
  if (ids.has(m)) return "catalog";
  return null;
}

function refusal(role, specRel, model, origin) {
  const where =
    origin === "param"
      ? `passed as the Agent model parameter (spec: ${specRel || "none in this project"})`
      : `set by the model: line of its spec ${specRel}`;
  return (
    `${TAG}: refused the Agent spawn of role "${role}". Its model "${model}" is ${where}, and the Agent ` +
    `tool can only run Claude models, so this spawn would fail. Fix: pass the Claude model the resolver ` +
    `gives for this role (node scripts/dispatch/harness-spawn-model.js ${role}), or re-sync the role specs ` +
    `(node scripts/dispatch/model-resolve.js --sync-specs).`
  );
}

function decide(event, ctx) {
  if (!event || event.tool_name !== "Agent" || event.tool_response !== undefined) return { action: "allow", why: "not-an-agent-spawn" };
  if (!fs.existsSync(ctx.registryFile) || !fs.existsSync(ctx.catalogFile)) return { action: "allow", why: "not-a-framework-tree" };
  if (typeof event.cwd === "string" && event.cwd && !isSameOrUnder(event.cwd, ctx.projectDir)) {
    return { action: "allow", why: "cwd-outside-project" };
  }

  const input = event.tool_input || {};
  const role = String(input.subagent_type || "").trim() || DEFAULT_AGENT_TYPE;
  const passed = input.model != null && String(input.model).trim() !== "";
  let ids = null;
  const claudeIds = () => ids || (ids = catalogClaudeIds(ctx.catalogFile));
  const specs = specFilesFor(role, ctx);

  if (specs.length) {
    const pin = pinRequirement(role, ctx);
    if (pin && pin.warning) process.stderr.write(`[${TAG}] WARNING: ${pin.warning}\n`);
    if (pin && pin.pinned) {
      const spec = relForUser(ctx.projectDir, specs[0]);
      if (pin.unservable) {
        return { action: "block", role, model: "(pinned, unservable)", spec, reason: `${TAG}: refused the Agent spawn of role "${role}". ${pin.reason}` };
      }
      const gotModel = passed ? String(input.model).trim().toLowerCase() : null;
      const gotEffort = input.effort != null && String(input.effort).trim() !== "" ? String(input.effort).trim().toLowerCase() : null;
      const wantEffort = pin.effort ? String(pin.effort).toLowerCase() : null;
      if (gotModel !== pin.model || (wantEffort && gotEffort !== wantEffort)) {
        const need = `model: "${pin.model}"${wantEffort ? ` and effort: "${wantEffort}"` : ""}`;
        const got = `model: ${gotModel ? `"${gotModel}"` : "(none)"}${wantEffort ? `, effort: ${gotEffort ? `"${gotEffort}"` : "(none)"}` : ""}`;
        return {
          action: "block",
          role,
          model: gotModel || "(none)",
          spec,
          reason:
            `${TAG}: refused the Agent spawn of role "${role}". This project pins it to ${pin.model}${wantEffort ? ` at effort ${wantEffort}` : ""} ` +
            `(.claude/manifest.json, or the active model preset), but the spawn passed ${got}. Fix: re-issue the spawn with ${need}. ` +
            `To drop the pin instead: node scripts/dispatch.js set ${role} --default`,
        };
      }
      return { action: "allow", why: "pinned-alias" };
    }
  }

  if (passed) {
    if (allowKind(input.model, claudeIds)) return { action: "allow", why: "model-param" };
    const spec = specs.length ? relForUser(ctx.projectDir, specs[0]) : null;
    const model = String(input.model).trim();
    return { action: "block", role, model, spec, reason: refusal(role, spec, model, "param") };
  }
  if (!specs.length) return { action: "allow", why: "built-in-type" };
  for (const file of specs) {
    const fm = readFrontmatter(file);
    const spec = relForUser(ctx.projectDir, file);
    if (fm.__ambiguousModel) {
      const reason =
        `${TAG}: refused the Agent spawn of role "${role}". The model line of its spec ${spec} is written in a form ` +
        `this check cannot read the way Claude Code does (an empty value, a quoted or explicit key, a block value, ` +
        `or an indented model key). Fix: write it on one line as \`model: <claude model id>\` (node scripts/dispatch/model-resolve.js --sync-specs).`;
      return { action: "block", role, model: "(unreadable model line)", spec, reason };
    }
    const model = fm.model;
    if (allowKind(model, claudeIds)) continue;
    return { action: "block", role, model, spec, reason: refusal(role, spec, model, "spec") };
  }
  return { action: "allow", why: "spec-model" };
}

function pinRequirement(role, ctx) {
  const file = path.join(ctx.projectDir, "scripts", "dispatch", "model-resolve.js");
  if (!fs.existsSync(file)) return null;
  try {
    const r = require(file).resolveRole(role, { channel: "in-process" });
    const sp = (r && r.spawn) || {};
    return {
      pinned: !!sp.pinned,
      model: sp.model ? String(sp.model).toLowerCase() : null,
      effort: sp.effort || null,
      unservable: !!sp.unservable,
      reason: sp.reason || null,
      warning: (r && r.warning) || null,
    };
  } catch (e) {
    return { pinned: false, warning: `the model resolver could not say whether "${role}" is pinned (${(e && e.message) || "error"}); the spec default runs` };
  }
}

function logBlock(verdict) {
  try {
    const { logEvent } = require("./lib/logger");
    logEvent("block", "system", TAG, verdict.role, verdict.reason, { model: verdict.model, spec: verdict.spec });
  } catch {
  }
}

function main(raw) {
  let verdict;
  try {
    verdict = decide(JSON.parse(raw), projectContext());
  } catch (e) {
    const why = String((e && e.message) || e).replace(/\s+/g, " ").trim();
    process.stderr.write(`[${TAG}] WARNING: could not check this spawn's model (${why}); allowing it unchecked.\n`);
    process.exit(0);
  }
  if (verdict.action === "block") {
    logBlock(verdict);
    process.stdout.write(JSON.stringify({ decision: "block", reason: verdict.reason }) + "\n");
    process.stderr.write(verdict.reason + "\n");
    process.exit(2);
  }
  process.exit(0);
}

if (require.main === module) {
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => (raw += c));
  process.stdin.on("end", () => main(raw));
}

module.exports = { decide, allowKind, specFilesFor, readFrontmatter, catalogClaudeIds, HARNESS_ALIASES };
