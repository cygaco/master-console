#!/usr/bin/env node
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

let input = "";
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  const enforce =
    process.argv.includes("--enforce") ||
    process.env.RETRO_ENFORCE === "1" ||
    process.env.RETRO_ENFORCE === "true";
  try {
    const PROJECT = process.env.CLAUDE_PROJECT_DIR || process.cwd();

    let retrosDir;
    try {
      const paths = JSON.parse(
        fs.readFileSync(path.join(PROJECT, ".claude", "paths.json"), "utf8"),
      );
      retrosDir = path.join(PROJECT, paths.oneshotRetros);
    } catch {
      retrosDir = path.join(
        PROJECT,
        ".claude",
        "agents",
        "president",
        ".system",
        "oneshot",
        "retros",
      );
    }

    let branch = "";
    try {
      branch = execSync("git branch --show-current", {
        cwd: PROJECT,
        encoding: "utf8",
      }).trim();
    } catch (e) {
      if (enforce) {
        process.stderr.write(
          `\n[retro-presence-check] BLOCKED (enforced): could not determine the current branch (${e && e.message ? e.message.split("\n")[0] : "runner failure"}) — failing closed; cannot verify retro obligation.\n\n`,
        );
        process.exit(2);
      }
      process.exit(0);
    }
    const m = branch.match(/^skeleton-test(\d+)$/);
    if (!m) {
      process.exit(0);
    }
    const runN = m[1];
    const retroDir = path.join(retrosDir, runN);
    const retroFile = path.join(retroDir, "RETRO.md");

    if (!fs.existsSync(retroFile)) {
      const header = enforce
        ? `[retro-presence-check] BLOCKED (enforced): session ending on ${branch} but ${retroDir}/RETRO.md does not exist.`
        : `[retro-presence-check] WARNING (advisory): session ending on ${branch} but ${retroDir}/RETRO.md does not exist.`;

      process.stderr.write(
        `\n${header}\n` +
          `  Run /oneshot:retro to capture this session's learnings before the branch is gutted.\n` +
          `  ${enforce ? "enforce mode prevents the gap" : "this warning is the mitigation"}.\n\n`,
      );

      if (enforce) process.exit(2);
    }
    process.exit(0);
  } catch (e) {
    if (enforce) {
      process.stderr.write(
        `\n[retro-presence-check] BLOCKED (enforced): unexpected error while checking retro presence (${e && e.message ? e.message.split("\n")[0] : "unknown error"}) — failing closed.\n\n`,
      );
      process.exit(2);
    }
    process.exit(0);
  }
});
