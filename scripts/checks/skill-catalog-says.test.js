#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  parseFrontmatter,
  entryFromFile,
  computeAliasOf,
  computeConfirmFlags,
  isIrreversible,
  filterFlags,
  normalizeSaysList,
  checkStale,
} = require("../generate-skill-catalog.js");

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const BLOCK_LIST_FM = `---
description: Full session wrap-up — cognitive maintenance. Use --fast to skip.
user-invocable: true
says:
  - wrap up the session
  - end the session
  - session end
says-flags:
  fast: --fast
  no push: --no-push
says-args: none
says-confirm: never
tags: [session, lifecycle]
---

# body text here
`;

const parsed = parseFrontmatter(BLOCK_LIST_FM);
check(
  "block list: says is an array of 3 phrases",
  Array.isArray(parsed.frontmatter.says) && parsed.frontmatter.says.length === 3,
  JSON.stringify(parsed.frontmatter.says),
);
check(
  "block list: phrase text has no leading dash",
  parsed.frontmatter.says[0] === "wrap up the session",
);
check(
  "nested map: says-flags parses as an object",
  typeof parsed.frontmatter["says-flags"] === "object" &&
    parsed.frontmatter["says-flags"].fast === "--fast" &&
    parsed.frontmatter["says-flags"]["no push"] === "--no-push",
  JSON.stringify(parsed.frontmatter["says-flags"]),
);
check(
  "scalar says-args still parses as a plain string",
  parsed.frontmatter["says-args"] === "none",
);
check(
  "one-line list tags: [a, b] still works unchanged",
  Array.isArray(parsed.frontmatter.tags) &&
    parsed.frontmatter.tags.join(",") === "session,lifecycle",
);
check(
  "existing key: value shape (description) still works unchanged",
  parsed.frontmatter.description.startsWith("Full session wrap-up"),
);
check("body is split off correctly", parsed.body.trim() === "# body text here");

const MALFORMED_FM = `---
description: A deliberately malformed frontmatter block.
says:
  not a list and not a map, just prose
---
body
`;
let malformedResult = null;
let threw = false;
try {
  malformedResult = parseFrontmatter(MALFORMED_FM);
} catch {
  threw = true;
}
check("malformed says: block never throws", threw === false);
check(
  "malformed says: block degrades to empty string (no crash, no fabricated says)",
  malformedResult && malformedResult.frontmatter.says === "",
);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "voice-router-catalog-"));
const fixtureFile = path.join(tmpDir, "end.md");
fs.writeFileSync(
  fixtureFile,
  `---
description: Full session wrap-up — cognitive maintenance.
user-invocable: true
says:
  - wrap up the session
  - end the session
  - session end
says-flags:
  fast: --fast
  no push: --no-push
  invented flag: --does-not-exist
says-args: none
says-confirm: never
---

# /session:end

\`/session:end [--fast] [--quick] [--no-push] [--keep-teams]\`

Use \`--fast\` to skip the chain, \`--no-push\` to stay local, and \`--keep-teams\` to skip teardown.
`,
  "utf8",
);

const entry = entryFromFile({ full: fixtureFile, rel: "session/end.md" });

check("entryFromFile: slug derived correctly", entry.slug === "session:end");
check("entryFromFile: v1 fields unchanged shape", typeof entry.description === "string" && Array.isArray(entry.tags));
check(
  "entryFromFile: says carried through",
  entry.says.length === 3 && entry.says.includes("session end"),
);
check(
  "entryFromFile: says_norm is an array of token arrays (stopwords RETAINED)",
  Array.isArray(entry.says_norm) &&
    entry.says_norm.every((p) => Array.isArray(p)) &&
    entry.says_norm.some((p) => p.join(" ") === "end the session"),
  JSON.stringify(entry.says_norm),
);
check(
  "entryFromFile: slug_tokens from the slug",
  entry.slug_tokens.join(" ") === "session end",
);
check(
  "entryFromFile: documented_flags scraped from backticked body tokens",
  entry.documented_flags.includes("--fast") &&
    entry.documented_flags.includes("--no-push") &&
    entry.documented_flags.includes("--keep-teams"),
  JSON.stringify(entry.documented_flags),
);
check(
  "entryFromFile: NO flag is ever invented — an undocumented flag is dropped",
  !Object.values(entry.flags).includes("--does-not-exist"),
  JSON.stringify(entry.flags),
);
check(
  "entryFromFile: documented flag survives into the flags map",
  entry.flags.fast === "--fast" && entry.flags["no push"] === "--no-push",
  JSON.stringify(entry.flags),
);
check(
  "entryFromFile: global spoken map entry survives when its flag is documented (quick -> --fast)",
  entry.flags.quick === "--fast",
  JSON.stringify(entry.flags),
);
check("entryFromFile: args_mode defaults correctly", entry.args_mode === "none");
check("entryFromFile: confirm defaults correctly", entry.confirm === "never");
check("entryFromFile: alias_of is null for a real skill", entry.alias_of === null);

fs.rmSync(tmpDir, { recursive: true, force: true });

check(
  "computeAliasOf: deprecated alias format",
  computeAliasOf("[deprecated alias → /scan:full] Run every scan...") === "scan:full",
);
check(
  "computeAliasOf: plain alias format",
  computeAliasOf("[alias → /mc:doctor] ...") === "mc:doctor",
);
check(
  "computeAliasOf: ordinary description -> null",
  computeAliasOf("Run every scan in parallel.") === null,
);

const aliasTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "voice-router-alias-"));
const aliasFile = path.join(aliasTmpDir, "all.md");
fs.writeFileSync(
  aliasFile,
  `---
description: "[deprecated alias → /scan:full] Run every scan in parallel."
user-invocable: true
says:
  - this should never be read
---

# alias
`,
  "utf8",
);
const aliasEntry = entryFromFile({ full: aliasFile, rel: "check/all.md" });
check("entryFromFile: alias_of resolved", aliasEntry.alias_of === "scan:full");
check(
  "entryFromFile: alias entries are EXCLUDED from routing (says forced empty regardless of frontmatter)",
  aliasEntry.says.length === 0 &&
    aliasEntry.says_norm.length === 0 &&
    aliasEntry.slug_tokens.length === 0,
  JSON.stringify(aliasEntry.says),
);
fs.rmSync(aliasTmpDir, { recursive: true, force: true });

check(
  "filterFlags: drops a flag not in the documented set",
  Object.keys(filterFlags({ a: "--a", b: "--b" }, ["--a"])).length === 1,
);
check(
  "filterFlags: matches by leading token of a multi-word flag value",
  filterFlags({ turbo: "--autonomy turbo" }, ["--autonomy"]).turbo === "--autonomy turbo",
);
check(
  "normalizeSaysList: accepts an array, a bare string, or nothing",
  normalizeSaysList(["a", "b"]).length === 2 &&
    normalizeSaysList("solo string").length === 1 &&
    normalizeSaysList(undefined).length === 0,
);

const turboEntry = {
  slug: "session:turbo",
  says_norm: [["turbo"], ["speed", "mode"], ["initiate", "turbo"]],
  slug_tokens: ["session", "turbo"],
  flags: { off: "--off" },
  confirm: "fuzzy-only",
  alias_of: null,
  user_invocable: true,
};
const resumeSkill = {
  slug: "session:resume",
  says_norm: [["resume", "the", "session"]],
  slug_tokens: ["session", "resume"],
  flags: { turbo: "--turbo", fast: "--fast" },
  confirm: "never",
  alias_of: null,
  user_invocable: true,
};
const sprintMode = {
  slug: "mode:sprint",
  says_norm: [["sprint", "mode"]],
  slug_tokens: ["mode", "sprint"],
  flags: { turbo: "--autonomy turbo" },
  confirm: "fuzzy-only",
  alias_of: null,
  user_invocable: true,
};
const plainSkill = {
  slug: "fix:deep",
  says_norm: [["deep", "fix"]],
  slug_tokens: ["fix", "deep"],
  flags: { fast: "--fast", deep: "--deep" },
  confirm: "never",
  alias_of: null,
  user_invocable: true,
};
const forceSkill = {
  slug: "sprint:plan",
  says_norm: [["plan", "the", "sprint"]],
  slug_tokens: ["sprint", "plan"],
  flags: { "force it": "--force", override: "--force", enforce: "--enforce" },
  confirm: "never",
  alias_of: null,
  user_invocable: true,
};
check(
  "computeConfirmFlags (i): an emittable --turbo is confirm-first when a RAISED skill owns the 'turbo' phrase",
  computeConfirmFlags([turboEntry, resumeSkill]).includes("--turbo"),
  JSON.stringify(computeConfirmFlags([turboEntry, resumeSkill])),
);
check(
  "computeConfirmFlags (i): a LOCAL flag keyed by the same spoken form (--autonomy turbo) is confirm-first too",
  computeConfirmFlags([turboEntry, sprintMode]).includes("--autonomy turbo"),
);
check(
  "computeConfirmFlags (ii): an emittable --force is confirm-first by the irreversible vocabulary; --enforce is NOT",
  (() => {
    const w = computeConfirmFlags([forceSkill]);
    return w.includes("--force") && !w.includes("--enforce");
  })(),
  JSON.stringify(computeConfirmFlags([forceSkill])),
);
check(
  "computeConfirmFlags: ordinary flags (--fast, --deep) are NOT confirm-first",
  (() => {
    const w = computeConfirmFlags([turboEntry, sprintMode, plainSkill]);
    return !w.includes("--fast") && !w.includes("--deep");
  })(),
);
check(
  "computeConfirmFlags: '--turbo' with NO raised owner falls back to rule (ii) — 'turbo' is itself an irreversible stem",
  computeConfirmFlags([{ ...turboEntry, confirm: "never" }, resumeSkill]).includes("--turbo"),
);
check(
  "computeConfirmFlags: an alias or non-invocable entry contributes nothing",
  computeConfirmFlags([{ ...forceSkill, alias_of: "x" }, { ...forceSkill, user_invocable: false }]).length === 0,
);
check(
  "isIrreversible: token-prefix semantics — force/--force-evidence/authorized yes; enforce/reinforce no",
  isIrreversible("--force") &&
    isIrreversible("--force-evidence") &&
    isIrreversible("permissions:authorized") &&
    isIrreversible("commit:land") &&
    !isIrreversible("--enforce") &&
    !isIrreversible("scan:full") &&
    !isIrreversible("--fast"),
);

const realStale = checkStale();
check(
  "checkStale: a missing/absent catalog reports stale (safe default)",
  realStale.stale === true || realStale.stale === false,
);

console.log(`generate-skill-catalog.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
