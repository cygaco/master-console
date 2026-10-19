#!/usr/bin/env node
"use strict";

const path = require("path");
const { spawnSync } = require("child_process");
const {
  shouldSkip,
  looksInterrogativeOrNegated,
  shouldTriggerRegen,
  HIGH_TOKEN_CEILING,
  looksDeclarativeMention,
  capDeclarativeMention,
  buildInvoke,
  safeSessionId,
  MAX_STDIN_BYTES,
} = require("./skill-router.js");

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

check(
  "looksInterrogativeOrNegated: trailing question mark",
  looksInterrogativeOrNegated("does this change the permission model?"),
);
check(
  "looksInterrogativeOrNegated: leading wh-word, no question mark",
  looksInterrogativeOrNegated("what the full scan tiers its findings by"),
);
check(
  "looksInterrogativeOrNegated: leading auxiliary immediately followed by a pronoun (subject-aux inversion)",
  looksInterrogativeOrNegated("is it going to change the permission model for everyone on the team"),
);
check(
  "looksInterrogativeOrNegated: explicit negation",
  looksInterrogativeOrNegated("please do not scan anything yet, just explain the tiers"),
);
check(
  "looksInterrogativeOrNegated: ordinary declarative prose is NOT flagged",
  !looksInterrogativeOrNegated("the build failed last night with a timeout in the dispatch wrapper"),
);

check(
  "a bare auxiliary in declarative word order (pronoun THEN auxiliary — 'I have', 'we are') is NOT interrogative on its own",
  !looksInterrogativeOrNegated("I have finished the migration work and verified every module so please run the full scan") &&
    !looksInterrogativeOrNegated("we are completely done with the sprint work today so please wrap up the session"),
);
check(
  "the SAME auxiliary in question word order (auxiliary THEN pronoun — 'have I', 'are we') IS interrogative",
  looksInterrogativeOrNegated("have I finished every module that the migration touched before the full scan can run") &&
    looksInterrogativeOrNegated("are we completely done with the sprint work before we wrap up the session"),
);

check(
  "'whether' anywhere in the prompt is interrogative (an imperative opener followed by 'and whether')",
  looksInterrogativeOrNegated(
    "Remind me about the turbo setting and whether it widens permissions for the whole session or only for one batch of actions",
  ),
);
check(
  "'if' anywhere in the prompt is interrogative",
  looksInterrogativeOrNegated("let me know if the full scan would cause any trouble for the rest of the team today"),
);

check(
  "a wh-word buried past the first word (not the leading word) is still caught",
  looksInterrogativeOrNegated(
    "We were reading through the sample notes about widgets, and thinking about the gadget report, can you explain why that approach worked",
  ),
);
check(
  "an auxiliary inside the first 6 words (not the leading word) is caught",
  looksInterrogativeOrNegated(
    "Before you do anything else I want to understand whether the turbo setting changes the permission model",
  ),
);
check(
  "a wh-word immediately after a comma, well past the first 6 words, is caught (clause-initial branch)",
  looksInterrogativeOrNegated(
    "The team mentioned something about preparing a session handoff before the end of day, what do you think the best approach is here",
  ),
);
check(
  "a wh-word immediately after a conjunction is caught (not just after a comma)",
  looksInterrogativeOrNegated("the branch has been idle for days or should we just land it now"),
);
check(
  "a mid-sentence '?' (not just trailing) is caught",
  looksInterrogativeOrNegated("I noticed something odd? the sample job timed out and I am not sure why"),
);
check(
  "declarative prose with NO wh-word anywhere, no comma/conjunction-adjacent trigger, and no '?' is still NOT flagged (no new false positives)",
  !looksInterrogativeOrNegated(
    "the sample job failed with a timeout in the example wrapper please pull the record and tell me the elapsed time",
  ),
);

check(
  "shouldSkip: declarative preamble (>12 tokens) is skipped",
  shouldSkip(
    "We were reading through the sample notes about widgets, and thinking about the gadget report, can you explain why that approach worked",
    16,
  ) === "interrogative-long-prompt",
);
check(
  "shouldSkip: declarative preamble naming a widening skill is skipped",
  shouldSkip(
    "Before you do anything else I want to understand whether the turbo setting changes the permission model",
    13,
  ) === "interrogative-long-prompt",
);
check(
  "shouldSkip: the short-command recall controls are STILL unaffected by the broadened guard",
  shouldSkip("can you run the full scan across the whole project for me right now please", 7) === null &&
    shouldSkip("could you maybe switch us over into sprint mode", 6) === null,
);

const SHORT_QUESTION = "could you switch us to sprint mode";
const LONG_QUESTION =
  "could you explain whether the turbo setting changes the permission model and why that approach was chosen for this release";

check(
  "shouldSkip: a short question (<=HIGH_TOKEN_CEILING tokens) is NOT skipped — short exact commands phrased as questions still route",
  shouldSkip(SHORT_QUESTION, 7) === null,
);
check(
  "shouldSkip: the same long question (>HIGH_TOKEN_CEILING tokens) IS skipped",
  shouldSkip(LONG_QUESTION, 18) === "interrogative-long-prompt",
);
check(
  "shouldSkip: long ORDINARY prose (no question/negation) in the same band is unaffected by this rule",
  shouldSkip("the build failed last night with a timeout in the dispatch wrapper please pull the record", 15) !==
    "interrogative-long-prompt",
);
check(
  "shouldSkip: a long negated prompt (please do not scan anything yet, just explain how it tiers findings) is skipped",
  shouldSkip("please do not scan anything yet, just explain how the full scan tiers its findings for review", HIGH_TOKEN_CEILING + 3) ===
    "interrogative-long-prompt",
);
check(
  "shouldSkip: too-long still wins over the interrogative check past MAX_CONTENT_TOKENS",
  shouldSkip("is this a very long question that also exceeds every budget this hook enforces on itself today", 30) === "too-long",
);

check(
  "shouldTriggerRegen: no existing lock -> trigger",
  shouldTriggerRegen(null, 1000) === true,
);
check(
  "shouldTriggerRegen: a fresh 'running' lock -> debounced, do not pile on",
  shouldTriggerRegen({ status: "running", startedAt: 1000 }, 1010) === false,
);
check(
  "shouldTriggerRegen: a stale 'running' lock (process presumably dead) -> retry",
  shouldTriggerRegen({ status: "running", startedAt: 0 }, 60000) === true,
);
check(
  "shouldTriggerRegen: a fresh 'failed' lock -> suppressed during the backoff window",
  shouldTriggerRegen({ status: "failed", failedAt: 1000, exitCode: 1 }, 2000) === false,
);
check(
  "shouldTriggerRegen: a 'failed' lock past the backoff window -> retry",
  shouldTriggerRegen({ status: "failed", failedAt: 0, exitCode: 1 }, 6 * 60 * 1000) === true,
);
check(
  "shouldTriggerRegen: a completed 'ok' lock -> retry is allowed (CATALOG_MISSING wouldn't fire again anyway once the write lands)",
  shouldTriggerRegen({ status: "ok", completedAt: 1000 }, 1010) === true,
);

for (const say of ["I already ran the sample check", "the sample item is important for testing", "disable sample mode"]) {
  check(
    `"${say}" -> HIGH capped at MEDIUM`,
    capDeclarativeMention({ tier: "HIGH", tie: false }, say).tier === "MEDIUM",
  );
}
for (const say of ["run the full scan", "scan full", "is the tracker green", "how is the sprint going", "initiate turbo mode"]) {
  check(`imperative/question "${say}" is NOT capped`, !looksDeclarativeMention(say));
}
check(
  "MEDIUM/NONE decisions pass through the declarative cap untouched",
  capDeclarativeMention({ tier: "MEDIUM", tie: true }, "I already ran it").tie === true &&
    capDeclarativeMention({ tier: null }, "I already ran it").tier === null,
);
check(
  "buildInvoke escapes double quotes in the echoed remainder (no flag injection)",
  (() => {
    const line = buildInvoke({ entry: { slug: "a:b" } }, [], 'x" --force "y');
    return line === '/a:b "x\\" --force \\"y"';
  })(),
);
check(
  "buildInvoke escapes a trailing backslash so it cannot eat the closing quote",
  buildInvoke({ entry: { slug: "a:b" } }, [], "x\\") === '/a:b "x\\\\"',
);
check(
  "safeSessionId strips path traversal to [A-Za-z0-9_-]",
  safeSessionId("../../etc/x") === "etcx" && safeSessionId("ab-c_1") === "ab-c_1" && safeSessionId("..") === "unknown",
);
check(
  "stdin cap is 1 MB; an over-cap payload emits nothing and exits 0",
  (() => {
    if (MAX_STDIN_BYTES !== 1024 * 1024) return false;
    const payload = JSON.stringify({ prompt: "run the full scan", pad: "x".repeat(MAX_STDIN_BYTES + 1024) });
    const r = spawnSync(process.execPath, [path.join(__dirname, "skill-router.js")], {
      input: payload,
      encoding: "utf8",
      env: { ...process.env, MC_SKILL_ROUTER: "1" },
      maxBuffer: 64 * 1024 * 1024,
    });
    return r.status === 0 && r.stdout === "";
  })(),
);

console.log(`skill-router.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
