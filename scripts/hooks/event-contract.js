#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { PROJECT } = require("./lib/paths");
const { getEventContractPrefix } = require("./lib/project-config");

const SRC_DIR = path.join(PROJECT, "src");

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildPatterns(prefix) {
  const name = `${escapeRegExp(prefix)}:[a-z0-9_-]+`;
  return {
    listen: new RegExp(`addEventListener\\s*\\(\\s*["'\`](${name})["'\`]`, "gi"),
    dispatch: new RegExp(
      `dispatchEvent\\s*\\(\\s*new\\s+(?:Custom)?Event\\s*\\(\\s*["'\`](${name})["'\`]`,
      "gi",
    ),
    token: new RegExp(`["'\`]${name}["'\`]`, "i"),
  };
}

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const filePath = event.tool_input?.file_path || "";
    if (!filePath || !/\.(ts|tsx|js|jsx)$/.test(filePath)) {
      process.exit(0);
    }
    if (!filePath.includes(`${path.sep}src${path.sep}`)) {
      process.exit(0);
    }

    const prefix = getEventContractPrefix();
    const {
      listen: LISTEN_RE,
      dispatch: DISPATCH_RE,
      token: TOKEN_RE,
    } = buildPatterns(prefix);

    const newText =
      (event.tool_input?.content || "") +
      "\n" +
      (event.tool_input?.new_string || "");
    if (!TOKEN_RE.test(newText)) {
      process.exit(0);
    }

    const listeners = new Map();
    const dispatchers = new Map();
    let scanned = 0;

    function walk(dir) {
      if (scanned > 600) return;
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === "node_modules" || e.name.startsWith(".")) continue;
          walk(full);
        } else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) {
          let body;
          try {
            body = fs.readFileSync(full, "utf8");
          } catch {
            continue;
          }
          scanned++;
          let m;
          LISTEN_RE.lastIndex = 0;
          while ((m = LISTEN_RE.exec(body)) !== null) {
            if (!listeners.has(m[1])) listeners.set(m[1], new Set());
            listeners.get(m[1]).add(full);
          }
          DISPATCH_RE.lastIndex = 0;
          while ((m = DISPATCH_RE.exec(body)) !== null) {
            if (!dispatchers.has(m[1])) dispatchers.set(m[1], new Set());
            dispatchers.get(m[1]).add(full);
          }
        }
      }
    }
    walk(SRC_DIR);

    const orphanListeners = [];
    const orphanDispatchers = [];
    for (const name of listeners.keys()) {
      if (!dispatchers.has(name)) orphanListeners.push(name);
    }
    for (const name of dispatchers.keys()) {
      if (!listeners.has(name)) orphanDispatchers.push(name);
    }

    if (orphanListeners.length === 0 && orphanDispatchers.length === 0) {
      process.exit(0);
    }

    const lines = [`event-contract: orphan ${prefix}:* event names detected`];
    if (orphanListeners.length > 0) {
      lines.push(
        `  listened but never dispatched: ${orphanListeners.join(", ")}`,
      );
    }
    if (orphanDispatchers.length > 0) {
      lines.push(
        `  dispatched but never listened: ${orphanDispatchers.join(", ")}`,
      );
    }
    lines.push("  (advisory — incomplete rename or dead code)");
    process.stderr.write(lines.join("\n") + "\n");
    process.exit(0);
  } catch {
    process.exit(0);
  }
});
