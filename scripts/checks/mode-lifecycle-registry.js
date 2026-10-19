#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_REGISTRY = path.join(
  ROOT,
  ".claude",
  "agents",
  "_org",
  "mode-lifecycle.json",
);
const READER = path.join(ROOT, "scripts", "hooks", "lib", "mode-lifecycle.js");
const TEAM_GUARD = path.join(ROOT, "scripts", "hooks", "team-guard.js");
const SESSION_START = path.join(ROOT, "scripts", "hooks", "session-start.js");

const LIVE_MODES = ["solo", "adhoc", "oneshot", "sprint"];
const REQUIRED_FIELDS = {
  roster: (v) => Array.isArray(v),
  requires_team: (v) => typeof v === "boolean",
  bindings: (v) => Array.isArray(v),
  provider_tier: (v) => typeof v === "string" && v.length > 0,
  dispatch_profile_ref: (v) => typeof v === "string" && v.length > 0,
  teardown: (v) => v && typeof v === "object" && !Array.isArray(v),
};

const eqArr = (a, b) =>
  Array.isArray(a) &&
  Array.isArray(b) &&
  a.length === b.length &&
  a.every((x, i) => String(x).toLowerCase() === String(b[i]).toLowerCase());

function stripComments(src) {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, " ");
  return noBlock
    .split("\n")
    .map((line) => {
      let i = line.indexOf("//");
      while (i > 0 && line[i - 1] === ":") i = line.indexOf("//", i + 1);
      return i === -1 ? line : line.slice(0, i);
    })
    .join("\n");
}

const READER_IMPORT = /require\([^)]*lib\/mode-lifecycle[^)]*\)/;
const READER_CALL = /\.\s*(allFaces|faces|roster|requiresTeam|modeEntry)\s*\(/;
const HARDCODED_ROSTER_CONST =
  /\b(FACE_TYPES|TEAM_MODES|TEAM_BY_MODE|REQUIRED_TEAM(?:_MODES)?|MODE_ROSTERS?|ROSTER_BY_MODE)\b\s*=\s*(new\s+Set\s*\(\s*\[|\[|\{)/;
const MODE_ROSTER_MAP =
  /["']?\b(solo|adhoc|oneshot|sprint)\b["']?\s*:\s*\[\s*["'](alpha|beta|gamma|delta|epsilon)\b/;
const BARE_ROSTER_LITERAL =
  /["']alpha["']\s*,\s*["'](?:alpha|beta|gamma|delta|epsilon)["']|["'](?:beta|gamma|delta|epsilon)["']\s*,\s*["']alpha["']/;

function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const flagVal = (flag, dflt) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
  };
  const registryPath = flagVal("--registry", DEFAULT_REGISTRY);
  const readerPath = flagVal("--reader", READER);
  const teamGuardPath = flagVal("--team-guard", TEAM_GUARD);
  const sessionStartPath = flagVal("--session-start", SESSION_START);

  const problems = [];

  let modes = null;
  try {
    const doc = JSON.parse(fs.readFileSync(registryPath, "utf8"));
    modes = doc && doc.modes;
    if (!modes || typeof modes !== "object") {
      problems.push(`schema: registry has no \`modes\` object (${registryPath})`);
    }
  } catch (e) {
    problems.push(`schema: registry unreadable/unparseable (${registryPath}): ${e.message}`);
  }

  if (modes && typeof modes === "object") {
    for (const m of LIVE_MODES) {
      const entry = modes[m];
      if (!entry || typeof entry !== "object") {
        problems.push(`schema: mode "${m}" missing from registry`);
        continue;
      }
      for (const [field, ok] of Object.entries(REQUIRED_FIELDS)) {
        if (!(field in entry)) {
          problems.push(`schema: mode "${m}" missing field "${field}"`);
        } else if (!ok(entry[field])) {
          problems.push(`schema: mode "${m}" field "${field}" has the wrong type`);
        }
      }
    }
    for (const k of Object.keys(modes)) {
      if (!LIVE_MODES.includes(String(k).toLowerCase())) {
        problems.push(
          `schema: UNKNOWN mode "${k}" present in registry — the live-mode set is ` +
            `CLOSED (${LIVE_MODES.join("|")}); a stray mode widens the bootstrap ` +
            `face allow-list`,
        );
      }
    }
  }

  let FALLBACK = null;
  try {
    delete require.cache[require.resolve(readerPath)];
    FALLBACK = require(readerPath).FALLBACK;
  } catch (e) {
    problems.push(`mirror: cannot load lib/mode-lifecycle.js FALLBACK: ${e.message}`);
  }
  if (FALLBACK && modes) {
    for (const m of LIVE_MODES) {
      const reg = modes[m];
      const fb = FALLBACK[m];
      if (!fb) {
        problems.push(
          `mirror: live mode "${m}" MISSING from reader FALLBACK ` +
            `(lib/mode-lifecycle.js) — the fail-open mirror must cover every live mode`,
        );
      }
      if (!reg || !fb) continue;
      if (!eqArr(reg.roster, fb.roster)) {
        problems.push(
          `drift: mode "${m}" roster — registry [${(reg.roster || []).join(",")}] ` +
            `≠ reader FALLBACK [${(fb.roster || []).join(",")}]`,
        );
      }
      if (Boolean(reg.requires_team) !== Boolean(fb.requires_team)) {
        problems.push(
          `drift: mode "${m}" requires_team — registry ${reg.requires_team} ` +
            `≠ reader FALLBACK ${fb.requires_team}`,
        );
      }
    }
  }

  let canonicalRoles = null;
  try {
    delete require.cache[require.resolve(READER)];
    const realFB = require(READER).FALLBACK;
    canonicalRoles = new Set();
    for (const m of Object.keys(realFB || {})) {
      const r = realFB[m] && realFB[m].roster;
      if (Array.isArray(r)) {
        for (const id of r) canonicalRoles.add(String(id).toLowerCase());
      }
    }
  } catch (e) {
    problems.push(
      `roster: cannot derive the canonical face allowlist from reader FALLBACK: ${e.message}`,
    );
  }
  if (modes && canonicalRoles && canonicalRoles.size) {
    for (const m of LIVE_MODES) {
      const entry = modes[m];
      if (!entry || !Array.isArray(entry.roster)) continue;
      for (const r of entry.roster) {
        if (!canonicalRoles.has(String(r).toLowerCase())) {
          problems.push(
            `roster: mode "${m}" roster contains NON-FACE id "${r}" — not a ` +
              `recognized face (${[...canonicalRoles].join("|")}); a bogus roster ` +
              `id injects a non-face into the bootstrap FACE_TYPES allow-list`,
          );
        }
      }
    }
  }

  for (const [label, file] of [
    ["team-guard.js", teamGuardPath],
    ["session-start.js", sessionStartPath],
  ]) {
    try {
      const code = stripComments(fs.readFileSync(file, "utf8"));
      if (!READER_IMPORT.test(code) || !READER_CALL.test(code)) {
        problems.push(
          `readers: ${label} does not DERIVE its roster from ./lib/mode-lifecycle ` +
            `(missing the import or a roster-deriving call: allFaces/faces/roster/` +
            `requiresTeam/modeEntry) — it must resolve required-team-by-mode FROM ` +
            `the registry, not a hardcoded literal`,
        );
      }
      if (
        HARDCODED_ROSTER_CONST.test(code) ||
        MODE_ROSTER_MAP.test(code) ||
        BARE_ROSTER_LITERAL.test(code)
      ) {
        problems.push(
          `readers: ${label} reintroduces a HARDCODED roster literal (a ` +
            `FACE_TYPES/TEAM_MODES-style const, a mode→roster map [bare- OR ` +
            `quoted-key], or a bare lead-inclusive roster array) — the roster ` +
            `must be derived from the registry, not re-hardcoded`,
        );
      }
    } catch (e) {
      problems.push(`readers: cannot read ${label}: ${e.message}`);
    }
  }

  const ok = problems.length === 0;
  if (asJson) {
    process.stdout.write(
      JSON.stringify({ ok, problems, registry: registryPath }, null, 2) + "\n",
    );
  } else if (ok) {
    console.log("mode-lifecycle-registry: OK — readers consistent with the registry.");
  } else {
    console.log(`mode-lifecycle-registry: ${problems.length} problem(s) — FAIL (closed):`);
    for (const p of problems) console.log(`  ✗ ${p}`);
  }
  process.exit(ok ? 0 : 1);
}

try {
  main();
} catch (e) {
  console.error(`mode-lifecycle-registry: internal error — ${e.message}`);
  process.exit(2);
}
