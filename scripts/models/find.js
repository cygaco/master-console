#!/usr/bin/env node
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const DEFAULT_ROOT = path.resolve(__dirname, "..", "..");
const PROVIDER_IDS = ["claude", "openai", "antigravity"];
const CLI_OF = { claude: "claude", openai: "codex", antigravity: "agy" };
const SNAPSHOT_OF = { claude: "claude.json", openai: "openai.json", antigravity: "gemini.json" };
const AGY_TIMEOUT_MS = 20000;
const PROBE_TIMEOUT_MS = 10000;
const NO_SUCH_MODEL = "No Such Model Probe";
const CACHE_FRESH_MS = 7 * 24 * 3600 * 1000;

function defaultExec(cmd, args, opts) {
  const timeout = (opts && opts.timeoutMs) || PROBE_TIMEOUT_MS;
  const run = (shell) =>
    spawnSync(cmd, args, {
      encoding: "utf8",
      timeout,
      killSignal: "SIGKILL",
      windowsHide: true,
      shell,
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 4 * 1024 * 1024,
    });
  let r = run(false);
  if (r.error && r.error.code === "ENOENT" && process.platform === "win32") r = run(true);
  const timedOut = !!(r.error && r.error.code === "ETIMEDOUT");
  return {
    code: timedOut ? null : r.error ? 127 : r.status,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
    timedOut,
  };
}

function slugOf(display) {
  return String(display)
    .toLowerCase()
    .replace(/[()]/g, "")
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseAgyRows(stdout) {
  const rows = [];
  let dropped = 0;
  for (const line of String(stdout || "").split(/\r?\n/)) {
    const parts = line.split("\t");
    if (parts.length < 2) continue;
    const id = parts[0].trim();
    const displayName = parts.slice(1).join("\t").trim();
    if (/^[a-z0-9][a-z0-9._-]*$/.test(id) && displayName) rows.push({ id, displayName });
    else dropped++;
  }
  return { rows, dropped };
}

function parseAgyModels(stdout) {
  return parseAgyRows(stdout).rows;
}

function parseFailFastRows(stderr) {
  const rows = [];
  let dropped = 0;
  let inList = false;
  for (const line of String(stderr || "").split(/\r?\n/)) {
    if (/^\s*available models\s*:/i.test(line)) {
      inList = true;
      continue;
    }
    if (!inList) continue;
    const name = line.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9 .()\-]{0,63}$/.test(name)) {
      if (name && /^\s/.test(line)) {
        dropped++;
        continue;
      }
      if (rows.length || dropped) break;
      continue;
    }
    rows.push({ id: slugOf(name), displayName: name });
  }
  return { rows, dropped };
}

function parseFailFast(stderr) {
  return parseFailFastRows(stderr).rows;
}

function readSnapshot(provider, root) {
  const file = SNAPSHOT_OF[provider];
  const p = path.join(root, "runtime", "models-research", file);
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (_) {
    return null;
  }
  const models = [];
  for (const m of Array.isArray(doc && doc.models) ? doc.models : []) {
    if (!m || typeof m.id !== "string") continue;
    if (/retired|shut ?down|deprecat/i.test(String(m.status || ""))) continue;
    models.push({
      id: m.id,
      displayName: m.display_name || m.id,
      extraNames: Array.isArray(m.agy_display_names) ? m.agy_display_names : [],
    });
  }
  return { file, models, fetchedAt: doc.fetched_at || null };
}

function toDate(v) {
  const d = typeof v === "number" ? new Date(v) : new Date(String(v || ""));
  return Number.isNaN(d.getTime()) ? null : d;
}

function codexHomeDir(o) {
  if (o.codexHome) return o.codexHome;
  const env = (o.env || process.env).CODEX_HOME;
  if (env) return env;
  try {
    return require("../dispatch/safe-spawn").resolveCodexHome(o.homeDir || os.homedir()).path;
  } catch (_) {
    return path.join(o.homeDir || os.homedir(), ".codex-mc");
  }
}

function claudeConfigDir(o) {
  if (o.claudeDir) return o.claudeDir;
  const env = (o.env || process.env).CLAUDE_CONFIG_DIR;
  return env || path.join(o.homeDir || os.homedir(), ".claude");
}

function cacheResult(provider, label, fetchedAt, models, now) {
  const when = toDate(fetchedAt);
  const stamp = when ? when.toISOString() : "unknown time";
  const ageMs = when ? now - when.getTime() : Infinity;
  const fresh = ageMs >= -3600000 && ageMs <= CACHE_FRESH_MS;
  const days = Number.isFinite(ageMs) ? Math.max(0, Math.floor(ageMs / 86400000)) : null;
  return {
    provider,
    source: `cli-cache:${label} (fetched ${stamp})`,
    live: fresh,
    note: fresh ? "" : days === null ? "cache has no readable fetch time" : `cache is ${days} days old (older than 7)`,
    models,
  };
}

function readCodexCache(o, now) {
  const file = path.join(codexHomeDir(o), "models_cache.json");
  const doc = readJson(file);
  const list = doc && Array.isArray(doc.models) ? doc.models : [];
  const models = [];
  for (const m of list) {
    if (!m || typeof m.slug !== "string" || !m.slug) continue;
    models.push({ id: m.slug, displayName: m.display_name || m.slug, hidden: m.visibility === "hide" });
  }
  if (!models.length) return null;
  return cacheResult("openai", "models_cache.json", doc.fetched_at, models, now);
}

function readClaudeCache(o, now) {
  const dir = path.join(claudeConfigDir(o), "cache", "model-catalog");
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => /-cc\.json$/.test(n) && !/headless-failed/.test(n));
  } catch (_) {
    return null;
  }
  let best = null;
  for (const n of names) {
    const doc = readJson(path.join(dir, n));
    const models = doc && doc.catalog && doc.catalog.config && doc.catalog.config.models;
    if (!Array.isArray(models) || !models.length || typeof doc.fetchedAt !== "number") continue;
    if (!best || doc.fetchedAt > best.fetchedAt) best = { fetchedAt: doc.fetchedAt, models };
  }
  if (!best) return null;
  const rows = best.models
    .filter((m) => m && typeof m.id === "string" && m.id)
    .map((m) => ({ id: m.id, displayName: m.name || m.id }));
  return rows.length ? cacheResult("claude", "model-catalog", best.fetchedAt, rows, now) : null;
}

function snapshotResult(provider, root, why) {
  const snap = readSnapshot(provider, root);
  if (!snap) {
    return { provider, source: "none", live: false, note: `${why}; no snapshot at runtime/models-research/${SNAPSHOT_OF[provider]}`, models: [] };
  }
  const date = snap.fetchedAt ? `snapshot from ${snap.fetchedAt}` : "snapshot of unknown date";
  return {
    provider,
    source: `snapshot:${snap.file}`,
    live: false,
    note: `${why}; ${date} — not a live listing`,
    models: snap.models,
  };
}

function findListingSubcommand(cli, exec) {
  const r = exec(cli, ["--help"], { timeoutMs: PROBE_TIMEOUT_MS });
  if (!r || r.code !== 0) return null;
  const m = /^\s{1,6}(models|list-models)\b/m.exec(`${r.stdout}\n${r.stderr}`);
  return m ? m[1] : null;
}

function listServed(provider, opts) {
  const o = opts || {};
  const now = o.now || Date.now();
  const root = o.root || DEFAULT_ROOT;
  const exec = o.exec || defaultExec;
  const timeoutMs = o.timeoutMs || AGY_TIMEOUT_MS;
  if (!PROVIDER_IDS.includes(provider)) throw new Error(`unknown provider: ${provider}`);

  if (provider === "antigravity") {
    const notes = [];
    const r = exec("agy", ["models"], { timeoutMs });
    if (r && !r.timedOut && r.code === 0) {
      const { rows, dropped } = parseAgyRows(r.stdout);
      if (rows.length) {
        return {
          provider,
          source: "cli:agy models",
          live: dropped === 0,
          partial: dropped > 0,
          note: dropped ? `${dropped} listing row(s) could not be parsed and were dropped` : "",
          models: rows,
        };
      }
      notes.push("`agy models` returned no rows");
    } else {
      notes.push(r && r.timedOut ? "`agy models` timed out" : "`agy models` failed");
    }
    const f = exec("agy", ["--model", NO_SUCH_MODEL, "--print-timeout", "10s", "-p", "ping"], { timeoutMs });
    const ff = f && !f.timedOut ? parseFailFastRows(f.stderr) : { rows: [], dropped: 0 };
    if (ff.rows.length) {
      const drop = ff.dropped ? `; ${ff.dropped} name(s) could not be parsed and were dropped` : "";
      return {
        provider,
        source: "cli:agy --model <invalid>",
        live: false,
        partial: true,
        note: `${notes.join("; ")}; names read from the fail-fast error listing, ids derived from the names${drop}`,
        models: ff.rows,
      };
    }
    notes.push("the fail-fast listing gave no names");
    return snapshotResult(provider, root, notes.join("; "));
  }

  const cli = CLI_OF[provider];
  const sub = findListingSubcommand(cli, exec);
  let why;
  if (sub) {
    const r = exec(cli, [sub], { timeoutMs: PROBE_TIMEOUT_MS });
    const { rows, dropped } = r && r.code === 0 ? parseAgyRows(r.stdout) : { rows: [], dropped: 0 };
    if (rows.length) {
      return {
        provider,
        source: `cli:${cli} ${sub}`,
        live: dropped === 0,
        partial: dropped > 0,
        note: dropped ? `${dropped} listing row(s) could not be parsed and were dropped` : "",
        models: rows,
      };
    }
    why = `\`${cli} ${sub}\` gave no parseable rows`;
  } else {
    why = `\`${cli}\` has no model-listing subcommand`;
  }
  const cached = provider === "openai" ? readCodexCache(o, now) : provider === "claude" ? readClaudeCache(o, now) : null;
  if (cached) return cached;
  return snapshotResult(provider, root, `${why}; no CLI cache found`);
}

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (_) {
    return null;
  }
}

function stringFormPin(root, role) {
  try {
    const pin = require("../dispatch/effective-pin").projectLayer(role, {
      registryPath: path.join(root, ".claude", "agents", "_org", "role-registry.json"),
      manifestPath: path.join(root, ".claude", "manifest.json"),
      projectRoot: root,
    });
    return pin && pin.provider && pin.model ? pin : null;
  } catch (_) {
    return null;
  }
}

function configuredChoices(root) {
  const found = [];
  const add = (provider, model, where) => {
    if (typeof provider === "string" && typeof model === "string" && model) found.push({ provider, model, where });
  };
  const org = path.join(root, ".claude", "agents", "_org");
  let presetFiles = [];
  try {
    presetFiles = fs.readdirSync(path.join(org, "presets")).filter((f) => f.endsWith(".json")).sort();
  } catch (_) {
  }
  for (const f of presetFiles) {
    const j = readJson(path.join(org, "presets", f));
    for (const [role, chain] of Object.entries((j && j.chains) || {})) {
      (Array.isArray(chain) ? chain : []).forEach((e, i) =>
        add(e && e.provider, e && e.model, `presets/${f} chains.${role}[${i}]`),
      );
    }
  }
  const reg = readJson(path.join(org, "role-registry.json"));
  for (const [role, r] of Object.entries((reg && reg.roles) || {})) {
    if (!r) continue;
    add(r.provider, r.model, `role-registry.json ${role}`);
    for (const k of ["second_pass", "third_pass", "panel_judge"]) {
      if (r[k]) add(r[k].provider, r[k].model, `role-registry.json ${role}.${k}`);
    }
  }
  const lanes = readJson(path.join(org, "panel-lane-manifest.json"));
  for (const [lane, l] of Object.entries((lanes && lanes.lanes) || {})) {
    if (l) add(l.provider, l.model, `panel-lane-manifest.json lanes.${lane}`);
  }
  const mf = readJson(path.join(root, ".claude", "manifest.json"));
  for (const [role, e] of Object.entries((mf && mf.agentProviders) || {})) {
    if (e && typeof e === "object") {
      add(e.provider, e.model, `manifest.json agentProviders.${role}`);
    } else if (typeof e === "string") {
      const pin = stringFormPin(root, role);
      if (pin) add(pin.provider, pin.model, `manifest.json agentProviders.${role} (spec pin)`);
    }
  }
  for (const [prov, p] of Object.entries((mf && mf.providers) || {})) {
    if (p && typeof p === "object") add(prov, p.default_model, `manifest.json providers.${prov}.default_model`);
  }
  return found;
}

function knownNames(providerSpec) {
  const ids = new Set();
  const names = new Set();
  for (const m of (providerSpec && providerSpec.models) || []) {
    ids.add(m.id);
    for (const a of m.aliases || []) ids.add(a);
    if (m.apiId) ids.add(m.apiId);
    for (const n of [m.displayName, m.agyModelName]) if (n) names.add(n);
  }
  return { ids, names };
}

function runFind(opts) {
  const o = opts || {};
  const root = o.root || DEFAULT_ROOT;
  const catalog = o.catalog || require("../dispatch/catalog");
  const providers = o.provider ? [o.provider] : PROVIDER_IDS;
  const configured = configuredChoices(root);
  const labs = [];
  for (const provider of providers) {
    const served = listServed(provider, {
      root,
      exec: o.exec,
      timeoutMs: o.timeoutMs,
      now: o.now,
      codexHome: o.codexHome,
      claudeDir: o.claudeDir,
      homeDir: o.homeDir,
      env: o.env,
    });
    const spec = catalog.PROVIDERS[provider];
    const { ids, names } = knownNames(spec);
    const fresh = served.models
      .filter(
        (m) =>
          !m.hidden &&
          !ids.has(m.id) &&
          !names.has(m.displayName) &&
          !(m.extraNames || []).some((n) => names.has(n) || ids.has(slugOf(n))),
      )
      .map((m) => ({ id: m.id, displayName: m.displayName }));

    const gone = [];
    if (served.live && !served.partial) {
      const byId = new Set(served.models.map((m) => m.id));
      const byName = new Set(served.models.map((m) => m.displayName));
      const seen = new Map();
      for (const c of configured) {
        if (c.provider !== provider) continue;
        const entry = spec && spec.models.find((m) => m.id === c.model || (m.aliases || []).includes(c.model));
        const display = entry && entry.agyModelName;
        const isServed = byId.has(c.model) || (entry && byId.has(entry.id)) || (display && byName.has(display));
        if (isServed) continue;
        if (!seen.has(c.model)) seen.set(c.model, { id: c.model, where: [] });
        seen.get(c.model).where.push(c.where);
      }
      gone.push(...seen.values());
    }
    const goneChecked = !!(served.live && !served.partial);
    const goneNote = goneChecked
      ? ""
      : served.partial
        ? "partial listing"
        : /^cli-cache:/.test(served.source)
          ? served.note || "cache is not recent enough"
          : "source is not a live listing";
    labs.push({ provider, source: served.source, note: served.note, new: fresh, gone, goneChecked, goneNote });
  }
  return { labs };
}

function formatHuman(result) {
  const lines = [];
  for (const lab of result.labs) {
    lines.push(`${lab.provider} — source: ${lab.source}${lab.note ? ` (${lab.note})` : ""}`);
    lines.push(`  new:  ${lab.new.length ? `${lab.new.length} — ${lab.new.map((m) => m.id).join(", ")}` : "none"}`);
    if (lab.goneChecked) {
      const g = lab.gone.map((x) => {
        const more = x.where.length > 2 ? "; ..." : "";
        return `${x.id} (${x.where.length}: ${x.where.slice(0, 2).join("; ")}${more})`;
      });
      lines.push(`  gone: ${g.length ? `${g.length} — ${g.join(", ")}` : "none"}`);
    } else {
      lines.push(`  gone: not checked (${lab.goneNote})`);
    }
  }
  return lines.join("\n");
}

function main(argv, deps) {
  const args = argv || [];
  const d = deps || {};
  let json = false;
  let provider;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--json") json = true;
    else if (a === "--provider") {
      const catalog = require("../dispatch/catalog");
      provider = catalog.normalizeProviderId(args[++i] || "");
      if (!PROVIDER_IDS.includes(provider)) {
        process.stderr.write("find: --provider needs one of claude, openai, antigravity\n");
        return 2;
      }
    } else {
      process.stderr.write(`find: unknown argument ${a}\nusage: find [--json] [--provider claude|openai|antigravity]\n`);
      return 2;
    }
  }
  const result = runFind({ ...d, provider });
  process.stdout.write(`${json ? JSON.stringify(result, null, 2) : formatHuman(result)}\n`);
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { listServed, runFind, main, parseAgyModels, parseAgyRows, parseFailFast, parseFailFastRows, configuredChoices, slugOf };
