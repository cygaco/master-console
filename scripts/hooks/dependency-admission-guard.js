#!/usr/bin/env node

const path = require("path");
const { checkPackageEdit } = require("../deps/admission");

function isUnderHome(filePath) {
  const home = path.resolve(process.env.CLAUDE_PROJECT_DIR || path.join(__dirname, "..", ".."));
  const norm = (p) => {
    const q = path.resolve(p).replace(/\\/g, "/").replace(/\/+$/, "");
    return process.platform === "win32" ? q.toLowerCase() : q;
  };
  const f = norm(filePath);
  const h = norm(home);
  return f === h || f.startsWith(h + "/");
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    if (!["Edit", "Write"].includes(event.tool_name)) process.exit(0);
    const filePath = String(event.tool_input?.file_path || "").replace(/\\/g, "/");
    if (!filePath.endsWith("/package.json") && path.basename(filePath) !== "package.json") process.exit(0);
    if (!isUnderHome(filePath)) process.exit(0);
    let oldText = event.tool_input?.old_string || "";
    let newText = event.tool_input?.new_string || event.tool_input?.content || "";
    if (!newText.trim()) process.exit(0);
    if (event.tool_name === "Edit" && event.tool_input?.old_string !== undefined) {
      const fs = require("fs");
      const current = fs.readFileSync(filePath, "utf8");
      const oldStr = String(event.tool_input.old_string);
      const newStr = String(event.tool_input.new_string || "");
      if (!current.includes(oldStr)) throw new Error("old_string not found in the current file");
      oldText = current;
      newText = event.tool_input.replace_all ? current.split(oldStr).join(newStr) : current.replace(oldStr, () => newStr);
    }
    const result = checkPackageEdit(oldText, newText);
    if (!result.ok) {
      console.log(
        JSON.stringify({
          decision: "block",
          reason:
            "dependency-admission-guard: new dependencies require .claude/project/decisions/dependency-admissions.jsonl records: " +
            result.missing.map((d) => `${d.name}@${d.version}`).join(", "),
        }),
      );
      process.exit(2);
    }
  } catch (e) {
    console.log(
      JSON.stringify({
        decision: "block",
        reason:
          "dependency-admission-guard: could not evaluate this edit (" +
          (e && e.message ? e.message : "unknown error") +
          ") — failing closed.",
      }),
    );
    process.exit(2);
  }
  process.exit(0);
});
