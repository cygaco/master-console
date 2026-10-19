#!/usr/bin/env node

const { spawnSync } = require("child_process");

let prettierBin = null;
try {
  prettierBin = require.resolve("prettier/bin/prettier.cjs");
} catch {
}

function killChildTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/F", "/T", "/PID", String(pid)], {
        stdio: "ignore",
      });
    } else {
      process.kill(pid, "SIGKILL");
    }
  } catch {
  }
}

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const filePath =
      event.tool_input?.file_path || event.tool_input?.content?.file_path;

    if (!filePath || !/\.(ts|tsx|js|jsx|json|css)$/.test(filePath)) {
      process.exit(0);
    }
    if (!prettierBin) process.exit(0);

    const r = spawnSync(
      process.execPath,
      [prettierBin, "--write", filePath],
      {
        cwd: event.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 10000,
      },
    );

    if (r.error && r.error.code === "ETIMEDOUT") {
      killChildTree(r.pid);
    }

    process.exit(0);
  } catch (err) {
    process.exit(0);
  }
});
