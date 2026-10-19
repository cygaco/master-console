#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");

function parseArgs(argv) {
  const a = {
    json: false,
    maxAgeDays: 14,
    researchDir: path.join(ROOT, "runtime", "models-research"),
    provider: null,
    toolProbe: true,
  };
  const needVal = (k, v) => {
    if (v === undefined || String(v).startsWith("--")) {
      console.error(`missing value for ${k}`);
      process.exit(2);
    }
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--json") a.json = true;
    else if (k === "--refresh") {
    } else if (k === "--provider") a.provider = needVal(k, argv[++i]);
    else if (k === "--max-age-days") {
      const v = needVal(k, argv[++i]);
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) {
        console.error(`--max-age-days must be a non-negative integer: ${v}`);
        process.exit(2);
      }
      a.maxAgeDays = n;
    } else if (k === "--research-dir") a.researchDir = path.resolve(needVal(k, argv[++i]));
    else if (k === "--no-tool-probe") a.toolProbe = false;
    else if (k === "--help" || k === "-h") a.help = true;
    else {
      console.error(`unknown arg: ${k}`);
      process.exit(2);
    }
  }
  return a;
}

const VENDOR_FILE = { claude: "claude", openai: "openai", antigravity: "gemini" };

const FLAGSHIP_KEY = {
  claude: "newest_opus",
  openai: "newest_flagship",
  antigravity: "newest_flagship",
};

const norm = (s) => String(s || "").trim().toLowerCase();
const isDeadStatus = (s) => {
  const t = String(s || "");
  if (/^\s*(GA|active|current|preview|live)\b/i.test(t)) return /shut\s*down|deprecat|sunset/i.test(t);
  return /shut\s*down|deprecat|retir|sunset/i.test(t);
};

function deadIdMap(research) {
  const dead = new Map();
  const add = (id, to) => {
    const key = norm(id);
    if (key && !dead.has(key)) dead.set(key, to || null);
  };
  for (const d of research.deprecations || []) {
    for (const piece of String(d.id || "").split("/")) {
      add(piece.replace(/\(.+?\)/g, ""), d.migrate_to || d.migrateTo || d.replacement);
    }
  }
  const liveInModels = new Set();
  for (const m of research.models || []) {
    if (m && m.id && !isDeadStatus(m.status)) liveInModels.add(norm(m.id));
  }
  for (const g of research.ghost_watch || []) {
    if (g && g.confidence === "advisory") continue;
    if (g && g.confidence === "low") continue;
    for (const piece of String(g.id || "").split("/")) {
      if (liveInModels.has(norm(piece))) continue;
      add(piece, g.migrate_to || g.migrateTo || g.replacement);
    }
  }
  for (const m of research.models || []) {
    if (isDeadStatus(m.status)) add(m.id, m.replaced_by);
  }
  return dead;
}

function lowConfidenceGhosts(research) {
  const s = new Set();
  for (const g of research.ghost_watch || []) {
    if (!g || g.confidence !== "low") continue;
    for (const piece of String(g.id || "").split("/")) s.add(norm(piece));
  }
  return s;
}

function knownIdSet(research) {
  const s = new Set();
  for (const m of research.models || []) s.add(norm(m.id));
  const extra = research.specialized_and_media_models_index_only;
  if (extra && Array.isArray(extra.models))
    for (const m of extra.models) s.add(norm(m.id));
  return s;
}

const CODEX_LAG_MINORS = 5;
function minorLag(fromVer, toVer) {
  const p = (v) => { const m = String(v || "").match(/(\d+)\.(\d+)\.(\d+)/); return m ? [Number(m[1]), Number(m[2])] : null; };
  const A = p(fromVer), B = p(toVer);
  if (!A || !B) return null;
  return (B[0] - A[0]) * 100 + (B[1] - A[1]);
}
function codexBinaryLag(resolution) {
  if (!resolution || !resolution.chosen_version) return null;
  const npm = (resolution.alternatives || []).find((a) => a && a.npm && a.version);
  if (!npm) return null;
  const lag = minorLag(resolution.chosen_version, npm.version);
  if (lag === null || lag <= CODEX_LAG_MINORS) return null;
  return `dispatch resolves codex to ${resolution.chosen} (${resolution.chosen_version}), ${lag} minor versions behind the npm-global codex ${npm.path} (${npm.version}) — newer GPT ids 400 on the old client; point MC_TOOL_CODEX_PATH at the npm binary or remove the older one from PATH.`;
}
const CODEX_FLOOR = "0.160.0";
function codexFloorWarn(resolution) {
  if (!resolution || !resolution.chosen) {
    return `no codex binary resolved — GPT-6 lanes need codex >= ${CODEX_FLOOR}; install the npm-global codex or set MC_TOOL_CODEX_PATH.`;
  }
  const v = String(resolution.chosen_version || "").match(/(\d+)\.(\d+)\.(\d+)/);
  if (!v) return `dispatch resolves codex to ${resolution.chosen} but its version is unknown — GPT-6 lanes need codex >= ${CODEX_FLOOR}.`;
  const lag = minorLag(resolution.chosen_version, CODEX_FLOOR);
  const [fa, fb, fc] = CODEX_FLOOR.split(".").map(Number);
  const below = Number(v[1]) * 1e6 + Number(v[2]) * 1e3 + Number(v[3]) < fa * 1e6 + fb * 1e3 + fc;
  if (!below || lag === null) return null;
  return `dispatch resolves codex to ${resolution.chosen} (${resolution.chosen_version}), below the GPT-6 servability floor ${CODEX_FLOOR} — every GPT-6 id 400s on this client; install/point MC_TOOL_CODEX_PATH at codex >= ${CODEX_FLOOR}.`;
}
function probeCodexBinary() {
  try {
    const { resolveTool } = require(path.join(ROOT, "scripts", "dispatch", "safe-spawn.js"));
    const r = resolveTool("codex");
    return r && r.ok ? r.resolution || null : null;
  } catch {
    return null;
  }
}

function ageDays(fetchedAt) {
  const t = Date.parse(fetchedAt);
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      "Usage: node scripts/models/check.js [--json] [--max-age-days N] [--research-dir <dir>]",
    );
    process.exit(0);
  }

  let PROVIDERS;
  try {
    ({ PROVIDERS } = require(path.join(ROOT, "scripts", "dispatch", "catalog.js")));
  } catch (e) {
    console.error(`failed to load dispatch catalog: ${e.message}`);
    process.exit(2);
  }

  const findings = [];
  const add = (provider, level, id, message) =>
    findings.push({ provider, level, id, message });
  const ages = [];

  let entries = Object.entries(PROVIDERS);
  if (args.provider && !PROVIDERS[args.provider]) {
    const byStem = Object.keys(VENDOR_FILE).find((pid) => VENDOR_FILE[pid] === args.provider);
    if (byStem) args.provider = byStem;
  }
  if (args.provider) {
    if (!PROVIDERS[args.provider]) {
      console.error(
        `unknown provider: ${args.provider} (valid: ${Object.keys(PROVIDERS).join(", ")})`,
      );
      process.exit(2);
    }
    entries = entries.filter(([pid]) => pid === args.provider);
  }

  for (const [pid, provider] of entries) {
    const stem = VENDOR_FILE[pid] || pid;
    const file = path.join(args.researchDir, `${stem}.json`);
    let research;
    try {
      research = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      add(
        pid,
        "WARN",
        null,
        `no research snapshot at ${path.relative(ROOT, file)} — run \`/models:check --refresh\` to deep-ingest the vendor docs.`,
      );
      ages.push({ provider: pid, ageDays: null, status: "missing" });
      continue;
    }

    const fetchedMs = Date.parse(research.fetched_at);
    const age = ageDays(research.fetched_at);
    ages.push({ provider: pid, ageDays: age, status: "present" });
    if (age === null || !Number.isFinite(fetchedMs)) {
      add(pid, "WARN", null, `research snapshot has no parseable fetched_at.`);
    } else if (Date.now() - fetchedMs > args.maxAgeDays * 86_400_000) {
      add(
        pid,
        "WARN",
        null,
        `research snapshot is ${age}d old (> ${args.maxAgeDays}d) — re-run \`/models:check --refresh\`.`,
      );
    }

    const dead = deadIdMap(research);
    const known = knownIdSet(research);
    const lowGhost = lowConfidenceGhosts(research);

    for (const m of provider.models || []) {
      const id = m.id;
      const key = norm(m.apiId || m.id);
      if (dead.has(key)) {
        const to = dead.get(key);
        add(
          pid,
          "ERROR",
          id,
          `configured model is DEPRECATED / shut down${to ? ` → migrate to ${to}` : ""}.`,
        );
      } else if (lowGhost.has(norm(id)) && !known.has(key)) {
        add(
          pid,
          "WARN",
          id,
          `listed in the snapshot's ghost_watch at LOW confidence — verify it is servable live before trusting or migrating it.`,
        );
      } else if (known.size && !known.has(key)) {
        add(
          pid,
          "WARN",
          id,
          `configured model not found in the latest docs — verify it is servable (id drift or new id not yet ingested).`,
        );
      }
    }

    const flagshipKey = FLAGSHIP_KEY[pid];
    const newest = flagshipKey ? research[flagshipKey] : null;
    if (
      newest &&
      norm(newest) !== norm(provider.defaultModel) &&
      !dead.has(norm(newest))
    ) {
      add(
        pid,
        "INFO",
        provider.defaultModel,
        `a newer flagship exists: ${newest} (current default: ${provider.defaultModel}). Keep if intentional.`,
      );
    }
  }

  if (args.toolProbe && entries.some(([pid]) => pid === "openai")) {
    const resolution = probeCodexBinary();
    const lagMsg = codexBinaryLag(resolution);
    if (lagMsg) add("openai", "WARN", null, lagMsg);
    const floorMsg = codexFloorWarn(resolution);
    if (floorMsg) add("openai", "WARN", null, floorMsg);
  }

  const errors = findings.filter((f) => f.level === "ERROR");
  const warns = findings.filter((f) => f.level === "WARN");
  const infos = findings.filter((f) => f.level === "INFO");

  if (args.json) {
    console.log(
      JSON.stringify(
        { ok: errors.length === 0, counts: { error: errors.length, warn: warns.length, info: infos.length }, snapshots: ages, findings },
        null,
        2,
      ),
    );
    process.exit(errors.length ? 1 : 0);
  }

  const NO_COLOR = process.env.NO_COLOR || !process.stdout.isTTY;
  const col = NO_COLOR
    ? { red: (s) => s, yellow: (s) => s, cyan: (s) => s, green: (s) => s, dim: (s) => s, bold: (s) => s }
    : {
        red: (s) => `\x1b[31m${s}\x1b[39m`,
        yellow: (s) => `\x1b[33m${s}\x1b[39m`,
        cyan: (s) => `\x1b[36m${s}\x1b[39m`,
        green: (s) => `\x1b[32m${s}\x1b[39m`,
        dim: (s) => `\x1b[2m${s}\x1b[22m`,
        bold: (s) => `\x1b[1m${s}\x1b[22m`,
      };

  console.log("");
  console.log(col.bold("Models Check — catalog vs latest vendor docs"));
  console.log(col.dim(`research dir: ${path.relative(ROOT, args.researchDir)} · max age ${args.maxAgeDays}d`));
  if (ages.length) {
    const agesStr = ages
      .map((x) => `${x.provider} ${x.status === "missing" ? "missing" : x.ageDays === null ? "?" : x.ageDays + "d"}`)
      .join(" · ");
    console.log(col.dim(`snapshot age: ${agesStr}`));
  }
  console.log("");

  if (!findings.length) {
    console.log(col.green("  ✓ all configured models are current — no drift, no deprecations."));
  } else {
    const icon = { ERROR: col.red("✗"), WARN: col.yellow("!"), INFO: col.cyan("i") };
    for (const f of [...errors, ...warns, ...infos]) {
      const where = f.id ? `${f.provider}/${f.id}` : f.provider;
      console.log(`  ${icon[f.level]} ${col.bold(where)} — ${f.message}`);
    }
  }
  console.log("");
  console.log(
    col.dim(
      `${errors.length} error · ${warns.length} warn · ${infos.length} info` +
        (errors.length ? "  → run /models:update to migrate" : ""),
    ),
  );
  process.exit(errors.length ? 1 : 0);
}

if (require.main === module) main();
module.exports = { minorLag, codexBinaryLag, codexFloorWarn, CODEX_LAG_MINORS, CODEX_FLOOR };
