
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ROLES, validateTuple } = require("./catalog");
const {
  readManifest,
  writeManifest,
  MANIFEST_PATH,
} = require("./manifest-patch");
const {
  parse: parseFm,
  serialize: serializeFm,
  setValue,
  removeKey,
} = require("./frontmatter");
const { filesForRole } = require("./role-files");
const { validateFallback, requiresFallback } = require("./required-fallback");
const { createBackup } = require("./backup");
const { fileDiff } = require("./diff");

const PROJECT_ROOT = process.cwd();

function rootOpts(root) {
  const base = root || PROJECT_ROOT;
  const { PROJECT, PATHS } = require("../hooks/lib/paths");
  const at = (abs, fallback) =>
    typeof abs === "string" ? path.join(base, path.relative(PROJECT, abs)) : path.join(base, fallback);
  return {
    projectRoot: base,
    manifestPath: path.join(base, ".claude", "manifest.json"),
    registryPath: at(PATHS.orgRoleRegistry, ".claude/agents/_org/role-registry.json"),
    presetsDir: path.join(at(PATHS.agents, ".claude/agents"), "_org", "presets"),
    logPath: at(PATHS.modelPresetLog, ".claude/project/model-presets.log.jsonl"),
  };
}

function roleKnown(role) {
  if (ROLES.includes(role)) return true;
  try {
    return !!require("./effective-pin").registryLayer(role, rootOpts());
  } catch (_) {
    return false;
  }
}

function tierAlias(model) {
  try {
    return require("./model-resolve").agentAlias(require("./catalog").resolveModelAlias(model));
  } catch (_) {
    return null;
  }
}

function validateInput(input) {
  if (!roleKnown(input.role)) return `Unknown role: ${input.role}`;
  if (input.remove) return null;
  const tupleErr = validateTuple(input.provider, input.model, input.effort);
  if (tupleErr) return tupleErr;
  if (input.provider === "claude" && !tierAlias(input.model)) {
    return `An in-process pin chooses a tier: ${input.model} is not the current model of any tier (opus / sonnet / haiku / fable), so a spawn could not be given it. Pin the tier's current model instead, or run: node scripts/dispatch.js set ${input.role} --default`;
  }
  const fb = validateFallback(input.provider, input.fallback);
  if (!fb.ok) return fb.reason || "Invalid fallback";
  return null;
}

function planManifestWrite(input) {
  const before = fs.readFileSync(MANIFEST_PATH, "utf8");
  const { data, indent, eol } = readManifest();
  const next = JSON.parse(JSON.stringify(data));
  next.agentProviders = next.agentProviders || {};
  if (input.remove) {
    delete next.agentProviders[input.role];
  } else if (input.provider === "claude") {
    const model = require("./catalog").resolveModelAlias(input.model);
    next.agentProviders[input.role] = { provider: "claude", model, ...(input.effort ? { effort: input.effort } : {}) };
  } else {
    next.agentProviders[input.role] = input.provider;
  }
  let serialized = JSON.stringify(next, null, indent);
  if (eol === "\r\n") serialized = serialized.replace(/\n/g, "\r\n");
  if (!serialized.endsWith(eol)) serialized += eol;
  return { path: MANIFEST_PATH, before, after: serialized };
}

function patchFrontmatter(parsed, input) {
  let next = parsed;
  if (input.provider === "claude") {
    next = setValue(next, "model", input.model);
    if (input.effort) {
      next = setValue(next, "effort", input.effort);
      if (parsed.entries.find((e) => e.key === "provider_reasoning_effort")) {
        next = setValue(next, "provider_reasoning_effort", input.effort);
      }
    } else {
      next = removeKey(next, "effort");
    }
    next = removeKey(next, "provider");
    next = removeKey(next, "provider_model");
    next = removeKey(next, "provider_fallback");
    if (!input.effort) next = removeKey(next, "provider_reasoning_effort");
  } else {
    const ip = inProcessAnswer(input.role);
    next = setValue(next, "model", ip.model);
    next = setValue(next, "provider", input.provider);
    next = setValue(next, "provider_model", input.model);
    if (input.fallback) {
      next = setValue(next, "provider_fallback", input.fallback);
    } else if (!requiresFallback(input.provider)) {
      next = removeKey(next, "provider_fallback");
    }
    if (input.effort) {
      next = setValue(next, "provider_reasoning_effort", input.effort);
    } else {
      next = removeKey(next, "provider_reasoning_effort");
    }
    next = ip.effort ? setValue(next, "effort", ip.effort) : removeKey(next, "effort");
  }
  return next;
}

function inProcessAnswer(role) {
  try {
    return require("./model-resolve").inProcessFromPreset(role, rootOpts());
  } catch (_) {
    return { model: "claude-opus-5-5", effort: "high", source: "fail-safe" };
  }
}

function patchToDefault(parsed, role) {
  const MR = require("./model-resolve");
  const ro = rootOpts();
  const def = MR.specDefault(role, ro) || { model: "claude-opus-5-5", effort: "high" };
  let next = setValue(parsed, "model", def.model);
  next = def.effort ? setValue(next, "effort", def.effort) : removeKey(next, "effort");
  let head = null;
  try {
    const P = require("./presets");
    const view = MR.effectiveChains({ ...ro, presetId: P.DEFAULT_PRESET_ID });
    head = view.chains[role] && view.chains[role][0];
  } catch (_) {
    head = null;
  }
  if (head && head.provider !== "claude") {
    next = setValue(next, "provider", head.provider);
    next = setValue(next, "provider_model", head.model);
    next = head.effort ? setValue(next, "provider_reasoning_effort", head.effort) : removeKey(next, "provider_reasoning_effort");
  } else {
    for (const k of ["provider", "provider_model", "provider_fallback", "provider_reasoning_effort"]) next = removeKey(next, k);
  }
  return next;
}

function planFrontmatterWrites(input) {
  if (!input.remove && input.provider === "claude") return [];
  const files = filesForRole(input.role);
  const writes = [];
  for (const f of files) {
    const before = fs.readFileSync(f, "utf8");
    const parsed = parseFm(before);
    if (parsed.fmLines.length === 0) continue;
    const next = input.remove ? patchToDefault(parsed, input.role) : patchFrontmatter(parsed, input);
    const after = serializeFm(next);
    writes.push({ path: f, before, after });
  }
  return writes;
}

function planDiffs(writes) {
  const out = [];
  for (const w of writes) {
    if (w.before === w.after) continue;
    const rel = path.relative(PROJECT_ROOT, w.path).split(path.sep).join("/");
    out.push(fileDiff(rel, w.before, w.after));
  }
  return out;
}

function previewSave(input) {
  const err = validateInput(input);
  if (err) return { ok: false, error: err, diffs: [], changedFiles: [] };
  const writes = [planManifestWrite(input), ...planFrontmatterWrites(input)];
  const diffs = planDiffs(writes);
  return { ok: true, diffs, changedFiles: diffs.map((d) => d.path), writes };
}

function applySave(input, sopts) {
  const so = sopts || {};
  const source = so.source === "preset" ? "preset" : "operator";
  const err = validateInput(input);
  if (err) return { ok: false, error: err, changedFiles: [], diffs: [] };
  const writes = [planManifestWrite(input), ...planFrontmatterWrites(input)];
  const changedWrites = writes.filter((w) => w.before !== w.after);
  if (changedWrites.length === 0) {
    return { ok: true, changedFiles: [], diffs: [] };
  }
  const diffs = planDiffs(writes);
  const changedFiles = changedWrites.map((w) => w.path);

  const backup = so.skipBackup
    ? null
    : createBackup(changedFiles, {
        summary: input.remove ? `${input.role} → product default (pin removed)` : `${input.role} → ${input.provider}/${input.model}/${input.effort || "—"}`,
        diffSummary: diffs
          .map((d) => `${d.path}: +${d.added} -${d.removed}`)
          .join("; "),
      });

  const ro = rootOpts();
  let previousPin = null;
  try {
    const p = require("./effective-pin").effectivePin(input.role, ro);
    if (p) previousPin = { provider: p.provider, model: p.model, effort: p.effort };
  } catch (_) {
  }

  const manifestWrite = changedWrites.find((w) => w.path === MANIFEST_PATH);
  if (manifestWrite) {
    const { indent, eol } = readManifest();
    const nextData = JSON.parse(manifestWrite.after.trim());
    writeManifest(nextData, indent, eol);
  }
  for (const w of changedWrites) {
    if (w.path === MANIFEST_PATH) continue;
    fs.writeFileSync(w.path, w.after, "utf8");
  }

  let provenanceLogged = true;
  let provenanceError = null;
  let provenanceMarked = false;
  if (source === "operator" && !input.remove) {
    try {
      const presets = require("./presets");
      const change = {
        role: input.role,
        from: previousPin,
        to: input.remove ? null : { provider: input.provider, model: input.model, effort: input.effort || null },
      };
      presets.recordManualPin(change, ro);
      presets.recordOverride(change, ro);
    } catch (e) {
      provenanceLogged = false;
      provenanceError = e.message;
      console.error(`preset log not updated: ${e.message}`);
      try {
        require("./presets").markProvenanceIncomplete({ role: input.role, error: e.message }, ro);
        provenanceMarked = true;
      } catch (me) {
        console.error(`provenance-incomplete marker not written: ${me.message}`);
      }
    }
  }

  return {
    ok: true,
    provenanceLogged,
    provenanceError,
    provenanceMarked,
    backup,
    changedFiles: changedFiles.map((p) =>
      path.relative(PROJECT_ROOT, p).split(path.sep).join("/"),
    ),
    diffs,
  };
}

module.exports = { previewSave, applySave, rootOpts };
