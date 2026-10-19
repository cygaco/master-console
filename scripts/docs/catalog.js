#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

function loadPaths() {
  try {
    return require("../hooks/lib/paths").PATHS;
  } catch {
    return {
      reference: ".claude/project/reference",
    };
  }
}

function walk(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    let ents;
    try {
      ents = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of ents) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        if (
          e.name.startsWith(".") ||
          e.name === "node_modules" ||
          e.name === "dist"
        )
          continue;
        stack.push(full);
      } else if (e.isFile() && e.name.endsWith(".md")) {
        out.push(full);
      }
    }
  }
  return out;
}

function readTitle(file) {
  try {
    const text = fs.readFileSync(file, "utf8");
    const m = text.match(/^#\s+(.+)$/m);
    return m ? m[1].trim() : "";
  } catch {
    return "";
  }
}

function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const ri = args.indexOf("--root");
  const overrideRoot = ri !== -1 ? args[ri + 1] : null;

  const PATHS = loadPaths();
  const roots = overrideRoot
    ? [overrideRoot]
    : ["docs", PATHS.reference || ".claude/project/reference"];

  const seen = new Set();
  const items = [];
  for (const r of roots) {
    for (const f of walk(r)) {
      if (seen.has(f)) continue;
      seen.add(f);
      let stat;
      try {
        stat = fs.statSync(f);
      } catch {
        continue;
      }
      items.push({
        path: path.relative(process.cwd(), f).replace(/\\/g, "/"),
        title: readTitle(f),
        size: stat.size,
        mtime: stat.mtime.toISOString(),
      });
    }
  }

  if (items.length === 0) {
    process.stderr.write(`no docs found under ${roots.join(", ")}\n`);
    process.exit(1);
  }

  items.sort((a, b) => a.path.localeCompare(b.path));

  if (asJson) {
    process.stdout.write(JSON.stringify(items, null, 2) + "\n");
    process.exit(0);
  }
  process.stdout.write(`# ${items.length} doc(s)\n`);
  for (const it of items) {
    const t = it.title ? `  ${it.title}` : "";
    process.stdout.write(`  ${it.path}${t}\n`);
  }
  process.exit(0);
}

if (require.main === module) main();

module.exports = { walk, readTitle };
