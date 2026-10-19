#!/usr/bin/env node
"use strict";

const path = require("path");
const { evaluate, MIGRATION_LIST, ENFORCE_ALL_AFTER, enforcedScope } = require("./skill-says-lint.js");
const FIXTURE_ENFORCE_ALL_AFTER = "2026-06-01";

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

function skill(overrides) {
  return {
    slug: "session:end",
    says: ["wrap up the session", "end the session", "session end"],
    saysFlags: {},
    saysArgs: "none",
    saysConfirm: "never",
    documentedFlags: ["--fast", "--quick"],
    userInvocable: true,
    isAlias: false,
    ...overrides,
  };
}

check(
  "clean skill -> 0 findings",
  evaluate({ skills: [skill()], enforcedSlugs: [], now: "2026-01-01", enforceAllAfter: FIXTURE_ENFORCE_ALL_AFTER }).findings
    .length === 0,
);

check(
  "missing says: on enforced skill pre-ramp -> warned, 0 findings",
  (() => {
    const r = evaluate({
      skills: [skill({ says: [] })],
      enforcedSlugs: ["session:end"],
      now: "2026-01-01",
      enforceAllAfter: FIXTURE_ENFORCE_ALL_AFTER,
    });
    return r.findings.length === 0 && r.warnedCount === 1;
  })(),
);

check(
  "missing says: on enforced skill post-ramp -> fails",
  evaluate({
    skills: [skill({ says: [] })],
    enforcedSlugs: ["session:end"],
    now: "2027-01-01",
    enforceAllAfter: FIXTURE_ENFORCE_ALL_AFTER,
  }).findings.some((f) => f.kind === "missing-says"),
);

check("ENFORCE_ALL_AFTER defaults to null (no calendar end)", ENFORCE_ALL_AFTER === null);
check(
  "missing says: on enforced skill, default ramp, far future -> still warned, 0 findings",
  (() => {
    const r = evaluate({ skills: [skill({ says: [] })], enforcedSlugs: ["session:end"], now: "2099-01-01", enforceAllAfter: ENFORCE_ALL_AFTER });
    return r.findings.length === 0 && r.warnedCount === 1;
  })(),
);

check(
  "missing says: outside enforced scope -> never fails",
  evaluate({
    skills: [skill({ says: [] })],
    enforcedSlugs: [],
    now: "2027-01-01",
    enforceAllAfter: FIXTURE_ENFORCE_ALL_AFTER,
  }).findings.length === 0,
);

check(
  "says-count: 2 phrases fails",
  evaluate({ skills: [skill({ says: ["one two", "three four"] })] }).findings.some(
    (f) => f.kind === "says-count",
  ),
);
check(
  "says-count: 7 phrases fails",
  evaluate({
    skills: [
      skill({
        says: Array.from({ length: 7 }, (_, i) => `phrase number ${i}`),
      }),
    ],
  }).findings.some((f) => f.kind === "says-count"),
);

check(
  "says-phrase-shape: a phrase with a comma fails",
  evaluate({ skills: [skill({ says: ["wrap up, the session", "end session", "session end"] })] }).findings.some(
    (f) => f.kind === "says-phrase-shape",
  ),
);
check(
  "says-phrase-shape: an uppercase phrase fails",
  evaluate({ skills: [skill({ says: ["Wrap up session", "end session", "session end"] })] }).findings.some(
    (f) => f.kind === "says-phrase-shape",
  ),
);

check(
  "says-phrase-length: a 1-word phrase fails",
  evaluate({ skills: [skill({ says: ["end", "end session", "session end"] })] }).findings.some(
    (f) => f.kind === "says-phrase-length",
  ),
);
check(
  "says-phrase-length: a 9-word phrase fails",
  evaluate({
    skills: [skill({ says: ["this phrase has way too many words to ever be dictated naturally by anyone", "end session", "session end"] })],
  }).findings.some((f) => f.kind === "says-phrase-length"),
);

check(
  "says-collision: identical phrase across two skills fails",
  evaluate({
    skills: [
      skill({ slug: "session:end", says: ["wrap up the session", "end session", "session end"] }),
      skill({ slug: "session:dump", says: ["wrap up the session", "dump the session", "session dump"] }),
    ],
  }).findings.some((f) => f.kind === "says-collision"),
);

check(
  "says-collision: a phrase equals another skill's slug signature fails",
  evaluate({
    skills: [
      skill({ slug: "fix:deep", says: ["root cause this", "fix deep", "diagnose properly"] }),
      skill({ slug: "sleep:quick", says: ["fix deep", "light sleep", "short rest"] }),
    ],
  }).findings.some((f) => f.kind === "says-collision"),
);

check(
  "invented-flag: a says-flags value not in documentedFlags fails",
  evaluate({
    skills: [skill({ saysFlags: { "no push": "--no-push", turbo: "--does-not-exist" } })],
  }).findings.some((f) => f.kind === "invented-flag"),
);
check(
  "documented flag passes clean",
  !evaluate({
    skills: [skill({ saysFlags: { "no push": "--no-push" }, documentedFlags: ["--fast", "--no-push"] })],
  }).findings.some((f) => f.kind === "invented-flag"),
);

check(
  "bad-args-mode fails on an invalid says-args value",
  evaluate({ skills: [skill({ saysArgs: "verbatim" })] }).findings.some((f) => f.kind === "bad-args-mode"),
);

check(
  "ceiling: commit:land with confirm=never fails",
  evaluate({
    skills: [skill({ slug: "commit:land", says: ["land it", "land the branch", "commit and merge"], saysConfirm: "never" })],
  }).findings.some((f) => f.kind === "ceiling"),
);
check(
  "ceiling: commit:land with confirm=always passes",
  !evaluate({
    skills: [skill({ slug: "commit:land", says: ["land it", "land the branch", "commit and merge"], saysConfirm: "always" })],
  }).findings.some((f) => f.kind === "ceiling"),
);
check(
  "ceiling: session:turbo with confirm=fuzzy-only ALSO passes (fuzzy-only raises the ceiling too)",
  !evaluate({
    skills: [skill({ slug: "session:turbo", says: ["turbo", "speed mode", "session turbo"], saysConfirm: "fuzzy-only" })],
  }).findings.some((f) => f.kind === "ceiling"),
);
check(
  "ceiling: a documented --force flag (not the slug) also trips the ceiling",
  evaluate({
    skills: [skill({ slug: "scan:full", documentedFlags: ["--force"], saysConfirm: "never" })],
  }).findings.some((f) => f.kind === "ceiling"),
);
check(
  "ceiling: --enforce is NOT 'force' (token-prefix vocabulary)",
  !evaluate({
    skills: [skill({ slug: "scan:full", documentedFlags: ["--enforce", "--fast"], saysConfirm: "never" })],
  }).findings.some((f) => f.kind === "ceiling"),
);
check(
  "ceiling: a documented irreversible flag NO spoken form maps to (--force-evidence) is unreachable by voice -> no ceiling",
  !evaluate({
    skills: [skill({ slug: "epic:close", documentedFlags: ["--force-evidence"], saysConfirm: "never" })],
  }).findings.some((f) => f.kind === "ceiling"),
);
check(
  "ceiling: an emittable --force is ACCEPTED with confirm=never when the runtime caps it (confirmFlags includes --force)",
  !evaluate({
    skills: [skill({ slug: "sprint:plan", says: ["plan the sprint", "sprint plan", "make a sprint plan"], documentedFlags: ["--force"], saysConfirm: "never" })],
    confirmFlags: ["--force"],
  }).findings.some((f) => f.kind === "ceiling"),
);
check(
  "ceiling: the runtime cap never excuses an irreversible SLUG (commit:land stays a ceiling finding)",
  evaluate({
    skills: [skill({ slug: "commit:land", says: ["land it", "land the branch", "commit and merge"], saysConfirm: "never" })],
    confirmFlags: ["--force", "--turbo"],
  }).findings.some((f) => f.kind === "ceiling"),
);

check(
  "alias-carries-says: an alias with says: fails, always (never ramped)",
  evaluate({
    skills: [skill({ slug: "check:all", isAlias: true, says: ["run every scan", "scan everything", "full scan"] })],
  }).findings.some((f) => f.kind === "alias-carries-says"),
);
check(
  "alias with NO says: is fine (the normal shape)",
  evaluate({
    skills: [skill({ slug: "check:all", isAlias: true, says: [] })],
  }).findings.length === 0,
);

check(
  "MIGRATION_LIST includes the documented keystone skills",
  MIGRATION_LIST.includes("session:end") &&
    MIGRATION_LIST.includes("commit:land") &&
    MIGRATION_LIST.includes("sprint:full"),
);

check(
  "a NO-says irreversible slug (mc:uninstall) with confirm=never trips the ceiling",
  evaluate({
    skills: [skill({ slug: "mc:uninstall", says: [], saysConfirm: "never" })],
    enforcedSlugs: [],
  }).findings.some((f) => f.kind === "ceiling"),
);
check(
  "a NO-says permissions:authorized with confirm=never trips the ceiling; fuzzy-only passes",
  evaluate({ skills: [skill({ slug: "permissions:authorized", says: [], saysConfirm: "never" })], enforcedSlugs: [] })
    .findings.some((f) => f.kind === "ceiling") &&
    !evaluate({ skills: [skill({ slug: "permissions:authorized", says: [], saysConfirm: "fuzzy-only" })], enforcedSlugs: [] })
      .findings.some((f) => f.kind === "ceiling"),
);
check(
  "production enforced scope is non-trivially LARGER than MIGRATION_LIST (list ∪ explicit user-invocable)",
  (() => {
    const scope = enforcedScope(path.join(__dirname, "..", "..", ".claude", "commands"));
    return scope.size > MIGRATION_LIST.length;
  })(),
);

console.log(`skill-says-lint.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
