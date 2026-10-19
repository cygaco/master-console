#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");

function anchoredProjectDir() {
  const lexical = path.resolve(__dirname, "..", "..");
  try {
    return fs.realpathSync(lexical);
  } catch {
    return lexical;
  }
}

let input = "";
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  try {
    let event = {};
    try {
      event = JSON.parse(input || "{}");
    } catch {
    }
    const projectDir = anchoredProjectDir();
    const corroboratingCwd =
      (event && typeof event.cwd === "string" && event.cwd) ||
      process.env.CLAUDE_PROJECT_DIR ||
      null;
    const cwdMatchesAnchor = (() => {
      try {
        if (!corroboratingCwd) return null;
        return fs.realpathSync(corroboratingCwd) === projectDir;
      } catch {
        return false;
      }
    })();

    let lifecycle;
    try {
      lifecycle = require(path.join(
        projectDir,
        "scripts",
        "teams",
        "lifecycle.js",
      ));
    } catch {
      process.exit(0);
    }

    const result = lifecycle.teardown({ projectDir, apply: false });

    try {
      const { log } = require(path.join(
        projectDir,
        "scripts",
        "hooks",
        "lib",
        "logger.js",
      ));
      log(
        "team-lifecycle",
        {
          event: "session:end:team-kill",
          slug: result.slug,
          requested: (result.requested || []).map((r) => r.team),
          foreignProtected: result.foreignProtected || [],
          killedGuaranteed: false,
          residual: result.residual,
          anchoredProjectDir: projectDir,
          corroboratingCwdMatches: cwdMatchesAnchor,
        },
        { actor: "session-end-team-teardown" },
      );
    } catch {
    }
    process.exit(0);
  } catch {
    process.exit(0);
  }
});
