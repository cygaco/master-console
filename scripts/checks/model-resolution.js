#!/usr/bin/env node
"use strict";
const path = require("path");

const FLOOR_MODEL = "claude-opus-5-5";
const COMBOS = Object.freeze([
  { name: "all three", claude: true, openai: true, antigravity: true },
  { name: "claude+codex", claude: true, openai: true, antigravity: false },
  { name: "claude+agy", claude: true, openai: false, antigravity: true },
  { name: "claude only", claude: true, openai: false, antigravity: false },
]);
const BARE_ALIASES = new Set(["opus", "sonnet", "haiku", "fable"]);

const signinFor = (c) => ({
  state: "known",
  providers: {
    claude: { signedIn: c.claude },
    openai: { signedIn: c.openai },
    antigravity: { signedIn: c.antigravity },
  },
});

function load(root) {
  const req = (rel) => require(path.join(root, rel));
  return {
    MR: req("scripts/dispatch/model-resolve.js"),
    presets: req("scripts/dispatch/presets.js"),
    catalog: req("scripts/dispatch/catalog.js"),
    readers: req("scripts/checks/model-resolution-readers.js"),
    registry: req(".claude/agents/_org/role-registry.json"),
  };
}

function catalogAlias(catalog, id) {
  const claude = catalog.PROVIDERS && catalog.PROVIDERS.claude;
  for (const m of (claude && claude.models) || []) {
    if (m.id !== id) continue;
    const a = (m.aliases || []).find((x) => BARE_ALIASES.has(x));
    return a || null;
  }
  return null;
}

function inCatalog(catalog, provider, model) {
  const p = catalog.PROVIDERS && catalog.PROVIDERS[provider];
  return !!(p && (p.models || []).some((m) => m.id === model));
}

function runChecks(opts) {
  const o = opts || {};
  const root = path.resolve(o.root || path.join(__dirname, "..", ".."));
  const m = o.mods || load(root);
  const rOpts = o.resolveOpts || {};
  const findings = [];
  const add = (f) => findings.push(f);
  const roles = Object.keys((m.registry && m.registry.roles) || {});
  const listed = m.presets.listPresets(rOpts) || [];
  for (const p of listed) if (p && p.error) add({ check: "matrix", preset: p.id, detail: `the preset is refused or unreadable: ${p.error}` });
  const presetIds = listed.filter((p) => p && !p.error).map((p) => p.id);
  if (!presetIds.includes(m.presets.DEFAULT_PRESET_ID)) add({ check: "matrix", detail: `no usable default preset (${m.presets.DEFAULT_PRESET_ID})` });
  let resolutions = 0;

  for (const preset of presetIds) {
    const chainsView = m.MR.effectiveChains({ ...rOpts, presetId: preset, activePreset: preset });
    for (const role of roles) {
      for (const combo of COMBOS) {
        for (const channel of ["in-process", "cli"]) {
          let r;
          try {
            r = m.MR.resolveRole(role, { ...rOpts, channel, signin: signinFor(combo), chainsView });
          } catch (e) {
            add({ check: "matrix", role, preset, combo: combo.name, channel, detail: `resolver threw: ${e.message}` });
            continue;
          }
          resolutions++;
          if (!r || !r.provider || !r.model) {
            add({ check: "matrix", role, preset, combo: combo.name, channel, detail: "no model resolved" });
            continue;
          }
          if (!inCatalog(m.catalog, r.provider, r.model)) {
            add({ check: "matrix", role, preset, combo: combo.name, channel, detail: `${r.provider}/${r.model} is not a catalog model of that provider` });
          }
          if (channel === "in-process" && r.provider !== "claude") {
            add({ check: "matrix", role, preset, combo: combo.name, channel, detail: `in-process resolved to a non-Claude model ${r.provider}/${r.model}` });
          }
          if (channel === "cli") {
            if (combo[r.provider] !== true) {
              add({ check: "matrix", role, preset, combo: combo.name, channel, detail: `cli resolved to ${r.provider}/${r.model}, a tool this sign-in combination is not signed in to` });
            }
            const chain = Array.isArray(r.chain) ? r.chain : [];
            const firstOk = chain.findIndex((e) => combo[e.provider] === true);
            if (firstOk !== -1 && r.index !== firstOk) {
              add({ check: "matrix", role, preset, combo: combo.name, channel, detail: `cli took chain entry ${r.index} (${r.source}) but entry ${firstOk} (${chain[firstOk].provider}/${chain[firstOk].model}) is signed in and earlier` });
            }
          }
          if (channel === "in-process" && r.spawn && r.spawn.unservable) {
            add({ check: "pins", role, preset, combo: combo.name, channel, detail: r.spawn.reason || "an in-process pin no Agent-tool alias reaches" });
          }
          if (channel === "in-process" && r.spawn && r.spawn.pinned && !r.spawn.unservable && r.spawn.model !== catalogAlias(m.catalog, r.model)) {
            add({ check: "pins", role, preset, detail: `the spawn-time alias ${JSON.stringify(r.spawn.model)} is not the catalog's alias for the pinned ${r.model}` });
          }
          if (channel === "in-process") {
            const want = catalogAlias(m.catalog, r.model);
            if ((r.alias || null) !== want) {
              add({ check: "alias", role, preset, detail: `alias ${JSON.stringify(r.alias)} for ${r.model}; the catalog's bare alias for it is ${JSON.stringify(want)}` });
            }
          }
        }
      }
    }
    for (const role of roles) {
      const chain = chainsView.chains && chainsView.chains[role];
      const last = Array.isArray(chain) && chain.length ? chain[chain.length - 1] : null;
      if (!last || last.provider !== "claude" || last.model !== FLOOR_MODEL) {
        add({ check: "floor", role, preset, detail: `chain ends on ${last ? `${last.provider}/${last.model}` : "nothing"}, not claude/${FLOOR_MODEL}` });
      }
    }
  }

  const dflt = m.MR.effectiveChains({ ...rOpts, presetId: m.presets.DEFAULT_PRESET_ID, activePreset: m.presets.DEFAULT_PRESET_ID });
  for (const role of roles) {
    const reg = m.registry.roles[role] || {};
    const head = dflt.chains && dflt.chains[role] && dflt.chains[role][0];
    if (!head) {
      add({ check: "parity", role, detail: "the default preset has no chain for this role" });
      continue;
    }
    const regEffort = reg.effort === undefined ? null : reg.effort;
    const headEffort = head.effort === undefined ? null : head.effort;
    if (reg.provider !== head.provider || reg.model !== head.model || regEffort !== headEffort) {
      add({ check: "parity", role, detail: `registry ${reg.provider}/${reg.model}@${regEffort} != default first entry ${head.provider}/${head.model}@${headEffort}` });
    }
  }

  const sync = m.MR.syncSpecs({ ...rOpts, check: true });
  for (const d of sync.drift || []) add({ check: "specs", role: d.role, detail: `${d.spec} frontmatter is not model ${d.model}${d.effort ? ` / effort ${d.effort}` : ""} — run node scripts/dispatch/model-resolve.js --sync-specs` });
  for (const e of sync.errors || []) add({ check: "specs", role: e.role, detail: e.error });

  const census = m.readers.findUnlistedReaders(o.root ? { root } : undefined);
  for (const f of census.unlisted || []) add({ check: "readers", detail: `unlisted provider/model reader ${f}` });
  for (const f of census.stale || []) add({ check: "readers", detail: `stale census row ${f}` });
  for (const f of census.bad || []) add({ check: "readers", detail: `bad census row ${f}` });
  const single = m.readers.findSigninCacheReaders(o.root ? { root } : undefined);
  for (const f of single.offenders || []) add({ check: "readers", detail: `second reader of the sign-in record: ${f}` });

  const diversity = [];
  for (const role of roles) {
    let r;
    try {
      r = m.MR.resolveRole(role, { ...rOpts, channel: "cli", signin: signinFor(COMBOS[3]) });
    } catch {
      continue;
    }
    if (r && r.diversity === "single-family") diversity.push(role);
  }

  return {
    ok: findings.length === 0,
    findings,
    counts: { roles: roles.length, presets: presetIds.length, resolutions, specs_checked: sync.checked },
    diversity_lost_for_claude_only: diversity,
  };
}

function main(argv) {
  const json = argv.includes("--json");
  let res;
  try {
    res = runChecks();
  } catch (e) {
    process.stderr.write(`model-resolution: could not run (${e && e.message})\n`);
    return 2;
  }
  if (json) {
    process.stdout.write(JSON.stringify(res, null, 2) + "\n");
    return res.ok ? 0 : 1;
  }
  for (const f of res.findings) {
    const where = [f.preset && `preset ${f.preset}`, f.role, f.combo, f.channel].filter(Boolean).join(" · ");
    process.stderr.write(`FAIL [${f.check}] ${where ? where + ": " : ""}${f.detail}\n`);
  }
  const c = res.counts;
  process.stdout.write(
    `${res.ok ? "OK  " : "FAIL"} [model-resolution] ${c.roles} roles x ${c.presets} presets x ${COMBOS.length} sign-in combinations x 2 channels = ${c.resolutions} resolutions; ${c.specs_checked} specs checked; ${res.findings.length} finding(s)\n`,
  );
  if (res.diversity_lost_for_claude_only.length) {
    process.stdout.write(
      `     Claude-only users: ${res.diversity_lost_for_claude_only.join(", ")} run on one model family only (the security panel's own rule decides what happens then).\n`,
    );
  }
  return res.ok ? 0 : 1;
}

module.exports = { runChecks, catalogAlias, COMBOS, FLOOR_MODEL };

if (require.main === module) process.exit(main(process.argv.slice(2)));
