#!/usr/bin/env node
"use strict";

const { spawnSync } = require("child_process");
const path = require("path");

const GUARD = path.join(__dirname, "scope-contract-guard.js");

function run(fixture) {
  const result = spawnSync(process.execPath, [GUARD], {
    input: JSON.stringify(fixture),
    encoding: "utf8",
    timeout: 10000,
  });
  return { exit: result.status ?? -1, stdout: result.stdout || "" };
}

function makeDispatch(role, prompt) {
  return {
    tool_name: "Agent",
    cwd: ".",
    tool_input: { subagent_type: role, prompt },
  };
}

let passed = 0;
let failed = 0;

function assert(name, result, expectedExit, expectedReasonContains) {
  const { exit, stdout } = result;
  let ok = exit === expectedExit;
  if (ok && expectedReasonContains) {
    ok = stdout.includes(expectedReasonContains);
  }
  if (ok) {
    console.log(`  PASS  ${name}`);
    passed++;
  } else {
    console.error(
      `  FAIL  ${name} — got exit=${exit} stdout=${stdout.trim().slice(0, 200)}`,
    );
    if (expectedReasonContains && !stdout.includes(expectedReasonContains)) {
      console.error(`        expected stdout to include: ${expectedReasonContains}`);
    }
    failed++;
  }
}

assert(
  "empty allowedFiles, no forbiddenFiles → LOUD BLOCK [planted]",
  run(
    makeDispatch(
      "builder",
      'Build this.\n\n## scopeContract\n{"allowedFiles":[]}\n',
    ),
  ),
  2,
  "EMPTY allowedFiles",
);

assert(
  "empty allowedFiles + forbiddenFiles → ALLOW (blocklist mode)",
  run(
    makeDispatch(
      "backend-builder",
      'Build this.\n\nscopeContract: {"allowedFiles":[],"forbiddenFiles":["package.json","README.md"]}\n',
    ),
  ),
  0,
  null,
);

assert(
  "non-empty allowedFiles → ALLOW (golden)",
  run(
    makeDispatch(
      "frontend-builder",
      'Build this.\n\nscopeContract: {"allowedFiles":["src/lib/types.ts"],"forbiddenFiles":[]}\n',
    ),
  ),
  0,
  null,
);

assert(
  "malformed scopeContract → fail-closed BLOCK",
  run(
    makeDispatch(
      "builder",
      "Build this.\n\nscopeContract: {allowedFiles: [broken json here\n",
    ),
  ),
  2,
  "unparseable",
);

assert(
  "no scopeContract, build-chain role → BLOCK (existing behavior)",
  run(makeDispatch("builder", "Build this feature. No scope info at all.")),
  2,
  null,
);

assert(
  "non-build-chain role (researcher) → exit 0 (existing behavior)",
  run(makeDispatch("researcher", "Research this topic. No scope info.")),
  0,
  null,
);

assert(
  "response-hook event → exit 0 (not a dispatch)",
  run({
    tool_name: "Agent",
    cwd: ".",
    tool_input: { subagent_type: "builder", prompt: "build" },
    tool_response: '{"ok":true}',
  }),
  0,
  null,
);

assert(
  "allowedFiles with multiple entries → ALLOW",
  run(
    makeDispatch(
      "security-builder",
      'Build this.\n\nscopeContract: {"allowedFiles":["src/a.ts","src/b.ts"],"forbiddenFiles":[]}\n',
    ),
  ),
  0,
  null,
);

assert(
  "malformed event JSON → fail-open exit 0 (guard bug safety)",
  run("NOT JSON AT ALL {{{"),
  0,
  null,
);

assert(
  "brace-glob in allowedFiles → ALLOW (string-aware walker)",
  run(
    makeDispatch(
      "builder",
      'Build this.\n\nscopeContract: {"allowedFiles":["{engineering,product}/**/*.ts","src/x.ts"],"forbiddenFiles":[]}\n',
    ),
  ),
  0,
  null,
);

assert(
  "equals-separator empty allowedFiles → LOUD BLOCK",
  run(
    makeDispatch(
      "builder",
      'Build this.\n\nscopeContract={"allowedFiles":[]}\n',
    ),
  ),
  2,
  "EMPTY allowedFiles",
);

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
