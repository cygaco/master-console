"use strict";

const path = require("path");
const { spawnSync } = require("child_process");

function defaultRunCheck(repoRoot) {
  const script = path.join(repoRoot, "scripts", "check", "install.js");
  const r = spawnSync(process.execPath, [script, "--json"], { cwd: repoRoot, encoding: "utf8" });
  return { code: r.status == null ? 1 : r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

module.exports = {
  name: "preflight",
  defaultRunCheck,
  async run(ctx) {
    const runCheck = (ctx.args && ctx.args._runCheck) || defaultRunCheck;
    ctx.log("running /scan:install (incl. sprint-subsystem probe)...");
    const res = runCheck(ctx.repoRoot);
    if (res.code === 0) {
      return { ok: true, status: "done", message: "install complete", data: { exit: 0 } };
    }
    return {
      ok: false,
      status: "failed",
      message:
        "install incomplete or not a MC repo (/scan:install exit " +
        res.code +
        ") — refusing to proceed. Run /mc:setup (or fix the gaps) first.",
      data: { exit: res.code },
    };
  },
};
