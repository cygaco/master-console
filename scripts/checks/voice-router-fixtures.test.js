#!/usr/bin/env node
"use strict";

const { evaluate } = require("./voice-router-fixtures.js");

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

function syntheticCatalog() {
  return {
    entries: [
      {
        id: "skill:fix:deep",
        slug: "fix:deep",
        description: "Root-cause diagnosis.",
        says: [],
        says_norm: [],
        slug_tokens: ["fix", "deep"],
        flags: { fast: "--fast" },
        documented_flags: ["--fast"],
        args_mode: "none",
        confirm: "never",
        alias_of: null,
        user_invocable: true,
      },
      {
        id: "skill:scan:full",
        slug: "scan:full",
        description: "Full system scan.",
        says: [],
        says_norm: [],
        slug_tokens: ["scan", "full"],
        flags: {},
        documented_flags: [],
        args_mode: "none",
        confirm: "never",
        alias_of: null,
        user_invocable: true,
      },
    ],
  };
}

check(
  "clean positive row -> 0 findings",
  evaluate({ rows: [{ say: "fix deep", expect: { skill: "fix:deep", tier: "HIGH" } }], catalog: syntheticCatalog() })
    .findings.length === 0,
);

check(
  "wrong-skill fires when the expected skill doesn't win",
  evaluate({ rows: [{ say: "full scan", expect: { skill: "fix:deep" } }], catalog: syntheticCatalog() }).findings.some(
    (f) => f.kind === "wrong-skill",
  ),
);

check(
  "false-positive-hijack fires on an unexpected suggestion",
  evaluate({ rows: [{ say: "fix deep", expect: { skill: null } }], catalog: syntheticCatalog() }).findings.some(
    (f) => f.kind === "false-positive-hijack",
  ),
);

check(
  "negative row (approval word) passes clean",
  evaluate({ rows: [{ say: "yes", expect: { skill: null } }], catalog: syntheticCatalog() }).findings.length === 0,
);

check(
  "wrong-tier fires when tier doesn't match",
  evaluate({ rows: [{ say: "fix deep", expect: { skill: "fix:deep", tier: "MEDIUM" } }], catalog: syntheticCatalog() })
    .findings.some((f) => f.kind === "wrong-tier"),
);

check(
  "missing-flag fires when an expected flag isn't emitted",
  evaluate({
    rows: [{ say: "fix deep", expect: { skill: "fix:deep", flags: ["--does-not-exist"] } }],
    catalog: syntheticCatalog(),
  }).findings.some((f) => f.kind === "missing-flag"),
);
check(
  "a correctly-emitted flag passes clean",
  evaluate({ rows: [{ say: "fix deep fast", expect: { skill: "fix:deep", flags: ["--fast"] } }], catalog: syntheticCatalog() })
    .findings.length === 0,
);

check(
  "a skill absent from the catalog SKIPS (not a finding) when the catalog is NOT truncated",
  (() => {
    const r = evaluate({ rows: [{ say: "do the thing", expect: { skill: "ghost:skill" } }], catalog: syntheticCatalog() });
    return r.findings.length === 0 && r.skipped.length === 1;
  })(),
);

check(
  "a skill absent from a TRUNCATED catalog is a hard finding, not a skip",
  (() => {
    const truncated = syntheticCatalog();
    truncated.truncated = 117;
    const r = evaluate({ rows: [{ say: "do the thing", expect: { skill: "session:turbo" } }], catalog: truncated });
    return (
      r.skipped.length === 0 &&
      r.findings.length === 1 &&
      r.findings[0].kind === "truncated-catalog-skill-missing"
    );
  })(),
);
check(
  "the same shape for an any_of row is also a hard finding under truncation",
  (() => {
    const truncated = syntheticCatalog();
    truncated.truncated = 117;
    const r = evaluate({
      rows: [{ say: "wrap it up", expect: { any_of: ["session:end", "epic:close"] } }],
      catalog: truncated,
    });
    return (
      r.skipped.length === 0 &&
      r.findings.length === 1 &&
      r.findings[0].kind === "truncated-catalog-skill-missing"
    );
  })(),
);

check(
  "a typed slash command is skipped, not routed",
  evaluate({ rows: [{ say: "/fix:deep --fast", expect: { skill: null } }], catalog: syntheticCatalog() }).findings
    .length === 0,
);

function wideningCatalog() {
  const c = syntheticCatalog();
  c.entries[0].flags = { fast: "--fast", turbo: "--turbo" };
  c.entries[0].documented_flags = ["--fast", "--turbo"];
  c.confirm_flags = ["--turbo"];
  return c;
}
check(
  "widening --turbo as a secondary flag caps the winner at MEDIUM (fix deep turbo)",
  evaluate({
    rows: [{ say: "fix deep turbo", expect: { skill: "fix:deep", flags: ["--turbo"], tier: "MEDIUM" } }],
    catalog: wideningCatalog(),
  }).findings.length === 0,
);
check(
  "the same sentence expected HIGH is reported as wrong-tier (the cap is real, not a no-op)",
  evaluate({
    rows: [{ say: "fix deep turbo", expect: { skill: "fix:deep", tier: "HIGH" } }],
    catalog: wideningCatalog(),
  }).findings.some((f) => f.kind === "wrong-tier"),
);
check(
  "a non-widening flag on the same catalog still routes HIGH (fix deep fast)",
  evaluate({
    rows: [{ say: "fix deep fast", expect: { skill: "fix:deep", flags: ["--fast"], tier: "HIGH" } }],
    catalog: wideningCatalog(),
  }).findings.length === 0,
);

check(
  "a catalog entry lacking user_invocable === true never routes (fixture runner mirrors the hook)",
  (() => {
    const cat = syntheticCatalog();
    delete cat.entries[0].user_invocable;
    const r = evaluate({ rows: [{ say: "fix deep", expect: { skill: null } }], catalog: cat });
    return r.findings.length === 0;
  })(),
);

console.log(`voice-router-fixtures.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
