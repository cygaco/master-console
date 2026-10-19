#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

function loadPaths() {
  try {
    return require("../hooks/lib/paths").PATHS;
  } catch {
    return { eventsFile: ".claude/project/events/events.jsonl" };
  }
}

function parseJsonl(text) {
  if (!text || !text.trim()) return [];
  const out = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
    }
  }
  return out;
}

function readJsonl(file) {
  if (!fs.existsSync(file)) {
    process.stderr.write(`events file not found: ${file}\n`);
    process.exit(1);
  }
  return parseJsonl(fs.readFileSync(file, "utf8"));
}

function readJsonlSafe(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  return parseJsonl(text);
}

function loadArchive() {
  try {
    return require("../hooks/lib/archive");
  } catch {
    return null;
  }
}

function containedReal(rootAbs, candidate) {
  try {
    const lexical = path.resolve(candidate);
    const sep = rootAbs.endsWith(path.sep) ? rootAbs : rootAbs + path.sep;
    if (lexical !== rootAbs && !lexical.startsWith(sep)) return null;
    let probe = lexical;
    let real = null;
    for (let i = 0; i < 128; i++) {
      try {
        real = fs.realpathSync(probe);
        break;
      } catch (e) {
        if (e && e.code === "ENOENT") {
          const parent = path.dirname(probe);
          if (parent === probe) return null;
          probe = parent;
          continue;
        }
        return null;
      }
    }
    if (real === null) return null;
    if (real !== rootAbs && !real.startsWith(sep)) return null;
    const suffix = path.relative(probe, lexical);
    if (suffix.startsWith("..")) return null;
    const composed = suffix ? path.join(real, suffix) : real;
    if (composed !== rootAbs && !composed.startsWith(sep)) return null;
    return composed;
  } catch {
    return null;
  }
}

function readLiveStrict(file) {
  let st;
  try {
    st = fs.lstatSync(file);
  } catch (e) {
    if (e && e.code === "ENOENT") return { ok: true, events: [] };
    return { ok: false, error: `live events file inaccessible: ${file}` };
  }
  if (!st.isFile()) return { ok: false, error: `live events path is not a regular file: ${file}` };
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return { ok: false, error: `live events file unreadable: ${file}` };
  }
  return { ok: true, events: parseJsonl(text) };
}

function dedupById(events) {
  const seen = new Set();
  const out = [];
  for (const e of events) {
    const id = e && e.id;
    if (id === undefined || id === null || id === "") {
      out.push(e);
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(e);
  }
  return out;
}

function readArchiveStrict(root) {
  const archive = loadArchive();
  if (!archive) {
    return { tier: "corrupt", error: "archive module unavailable — cannot verify tier completeness" };
  }
  let rootAbs;
  let idxPath;
  try {
    rootAbs = path.resolve(root);
    idxPath = archive.archiveIndexPath(rootAbs);
  } catch {
    return { tier: "corrupt", error: "cannot resolve archive index path" };
  }

  let idxStat;
  try {
    idxStat = fs.lstatSync(idxPath);
  } catch (e) {
    if (e && e.code === "ENOENT") return { tier: "absent" };
    return { tier: "corrupt", error: `archive index inaccessible (not a clean cold install): ${idxPath}` };
  }
  if (!idxStat.isFile()) {
    return { tier: "corrupt", error: `archive index is not a regular file: ${idxPath}` };
  }
  const idxSafe = containedReal(rootAbs, idxPath);
  if (!idxSafe) {
    return { tier: "corrupt", error: `archive index escapes root (realpath): ${idxPath}` };
  }

  let raw;
  try {
    raw = fs.readFileSync(idxSafe, "utf8");
  } catch {
    return { tier: "corrupt", error: `archive index unreadable: ${idxPath}` };
  }

  const indexEntries = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let entry;
    try {
      entry = JSON.parse(t);
    } catch {
      return {
        tier: "corrupt",
        error: "archive index has an unparseable line (strict parse) — history may be incomplete",
      };
    }
    indexEntries.push(entry);
  }

  let dirSafe;
  try {
    dirSafe = containedReal(rootAbs, archive.archiveDir(rootAbs));
  } catch {
    dirSafe = null;
  }
  if (!dirSafe) {
    return { tier: "corrupt", error: "archive dir escapes root (realpath)" };
  }

  const genBuffers = [];
  const presentRefs = [];
  for (const entry of indexEntries) {
    const rel = entry && entry.archived;
    if (typeof rel !== "string" || !rel) {
      return { tier: "corrupt", error: "archive index entry missing an `archived` reference" };
    }
    const genSafe = containedReal(rootAbs, path.resolve(rootAbs, rel));
    if (!genSafe) {
      return { tier: "corrupt", error: `archived generation escapes root (realpath): ${rel}` };
    }
    if (path.dirname(genSafe) !== dirSafe) {
      return {
        tier: "corrupt",
        error: `archived generation is not inside the archive dir (decoy?): ${rel}`,
      };
    }
    let content;
    try {
      const st = fs.lstatSync(genSafe);
      if (!st.isFile()) {
        return { tier: "corrupt", error: `archived generation is not a regular file (dangling): ${rel}` };
      }
      content = fs.readFileSync(genSafe, "utf8");
    } catch {
      return { tier: "corrupt", error: `archived generation missing or unreadable (dangling): ${rel}` };
    }
    genBuffers.push(content);
    presentRefs.push(rel);
  }

  let dirents;
  try {
    dirents = fs.readdirSync(dirSafe, { withFileTypes: true });
  } catch {
    return { tier: "corrupt", error: "archive dir unreadable" };
  }
  const indexedGenReal = new Set();
  for (const e of indexEntries) {
    const rel = e && e.archived;
    if (typeof rel !== "string" || !rel) continue;
    const abs = containedReal(rootAbs, path.resolve(rootAbs, rel));
    if (abs && path.dirname(abs) === dirSafe) indexedGenReal.add(abs);
  }
  for (const d of dirents) {
    if (!d.isFile()) continue;
    if (d.name === archive.INDEX_BASENAME) continue;
    if (d.name.endsWith(".lock")) continue;
    const genReal = containedReal(rootAbs, path.join(dirSafe, d.name));
    if (!genReal || !indexedGenReal.has(genReal)) {
      return {
        tier: "corrupt",
        error:
          `archive has an un-indexed generation on disk (raw history not in the index): ${d.name} — ` +
          "run the compactor/reconcile to re-index before querying (fail-closed to never omit raw)",
      };
    }
  }

  const entries = [];
  for (const content of genBuffers) {
    for (const e of parseJsonl(content)) entries.push(e);
  }
  return { tier: "healthy", entries, presentRefs };
}

function compareByTsId(a, b) {
  const ta = (a && (a.ts || a.timestamp)) || "";
  const tb = (b && (b.ts || b.timestamp)) || "";
  if (ta < tb) return -1;
  if (ta > tb) return 1;
  const ia = (a && a.id) || "";
  const ib = (b && b.id) || "";
  if (ia < ib) return -1;
  if (ia > ib) return 1;
  return 0;
}

function suppressRedundantSummaries(events, presentRefs) {
  const present = new Set(presentRefs || []);
  return events.filter((e) => {
    if (
      e &&
      e.type === "compaction-summary" &&
      e.data &&
      typeof e.data.archived_generation_ref === "string" &&
      present.has(e.data.archived_generation_ref)
    ) {
      return false;
    }
    return true;
  });
}

function getArg(args, ...names) {
  for (const n of names) {
    const i = args.indexOf(n);
    if (i !== -1 && i + 1 < args.length) return args[i + 1];
    const eq = args.find((a) => a.startsWith(`${n}=`));
    if (eq) return eq.slice(n.length + 1);
  }
  return null;
}

function tail(args) {
  const PATHS = loadPaths();
  const file = getArg(args, "--source") || PATHS.eventsFile;
  const n = parseInt(getArg(args, "-n", "--count") || "20", 10);
  const events = readJsonl(file);
  if (events.length === 0) {
    process.stderr.write(
      "events log is empty — start the system and try again\n",
    );
    return 0;
  }
  const slice = events.slice(-n);
  for (const e of slice) {
    const ts = e.ts || e.timestamp || "";
    const type = e.type || e.event || "?";
    const msg = e.message || e.summary || JSON.stringify(e);
    process.stdout.write(`${ts}  ${type}  ${msg}\n`);
  }
  return 0;
}

function query(args) {
  if (args.includes("--help")) {
    process.stdout.write(
      [
        "query flags:",
        "  --type=<str>       filter by event.type",
        "  --since=<ISO>      events with ts >= ISO",
        "  --until=<ISO>      events with ts <= ISO",
        "  --grep=<regex>     match against JSON-serialized event",
        "  --source=<file>    override events file (fixture testing)",
        "  --archive          union live events with archived raw (complete history)",
        "  --root=<dir>       project root for the archive tier (default: cwd; with --archive)",
        "  --json             emit one JSON per match (default text)",
      ].join("\n") + "\n",
    );
    return 0;
  }
  const PATHS = loadPaths();
  const file = getArg(args, "--source") || PATHS.eventsFile;
  const type = getArg(args, "--type");
  const since = getArg(args, "--since");
  const until = getArg(args, "--until");
  const grep = getArg(args, "--grep");
  const asJson = args.includes("--json");
  const useArchive = args.includes("--archive");

  let events;
  if (useArchive) {
    const root = getArg(args, "--root") || process.cwd();
    const arch = readArchiveStrict(root);
    if (arch.tier === "corrupt") {
      process.stderr.write(`error: archive tier is corrupt — ${arch.error}\n`);
      process.stderr.write(
        "fail-closed: refusing to print a partial/incomplete history (no output)\n",
      );
      return 1;
    }
    const liveRes = readLiveStrict(file);
    if (!liveRes.ok) {
      process.stderr.write(`error: ${liveRes.error}\n`);
      process.stderr.write(
        "fail-closed: refusing to print a partial/incomplete history (no output)\n",
      );
      return 1;
    }
    const liveEvents = liveRes.events;
    if (arch.tier === "absent") {
      process.stderr.write("note: no archive tier yet — showing live events only\n");
      events = liveEvents.slice();
    } else {
      events = dedupById(
        suppressRedundantSummaries(
          liveEvents.concat(arch.entries),
          arch.presentRefs,
        ),
      );
    }
    events.sort(compareByTsId);
  } else {
    events = readJsonl(file);
  }
  if (events.length === 0) {
    process.stderr.write(
      "events log is empty — start the system and try again\n",
    );
    return 0;
  }
  const grepRe = grep ? new RegExp(grep) : null;
  let matched = 0;
  for (const e of events) {
    if (type && (e.type || e.event) !== type) continue;
    const ts = e.ts || e.timestamp || "";
    if (since && ts < since) continue;
    if (until && ts > until) continue;
    if (grepRe && !grepRe.test(JSON.stringify(e))) continue;
    matched++;
    if (asJson) {
      process.stdout.write(JSON.stringify(e) + "\n");
    } else {
      process.stdout.write(
        `${ts}  ${e.type || e.event || "?"}  ${e.message || e.summary || ""}\n`,
      );
    }
  }
  process.stderr.write(`# ${matched} match(es)\n`);
  return 0;
}

function main() {
  const [, , sub, ...rest] = process.argv;
  if (!sub || sub === "--help") {
    process.stdout.write(
      "usage: node scripts/events/cli.js <tail|query> [args]\n",
    );
    process.exit(sub ? 0 : 2);
  }
  if (sub === "tail") process.exit(tail(rest));
  if (sub === "query") process.exit(query(rest));
  process.stderr.write(`unknown subcommand: ${sub}\n`);
  process.exit(2);
}

if (require.main === module) main();

module.exports = {
  tail,
  query,
  readJsonl,
  readJsonlSafe,
  readLiveStrict,
  parseJsonl,
  containedReal,
  dedupById,
  readArchiveStrict,
  suppressRedundantSummaries,
  compareByTsId,
};
