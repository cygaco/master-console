#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const PROJECT = path.resolve(__dirname, "..");
const MAPS = path.join(PROJECT, ".claude", "project", "maps");
const ISO = new Date().toISOString();
const TODAY = ISO.slice(0, 10);

function walk(dir, ext, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, ext, out);
    else if (!ext || entry.name.endsWith(ext)) out.push(full);
  }
  return out;
}

function rel(p) {
  return path.relative(PROJECT, p).replace(/\\/g, "/");
}

function statSafe(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

function lineCount(p) {
  try {
    const s = fs.readFileSync(p, "utf8");
    if (!s) return 0;
    return s.split(/\r?\n/).filter(Boolean).length;
  } catch {
    return 0;
  }
}

function parseFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeJSONL(p, header, entries) {
  const lines = [JSON.stringify(header)];
  for (const e of entries) lines.push(JSON.stringify(e));
  fs.writeFileSync(p, lines.join("\n") + "\n");
}

function writeText(p, s) {
  fs.writeFileSync(p, s);
}

function writeJSON(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");
}

const settings = readJSON(path.join(PROJECT, ".claude", "settings.json"));
const manifest = readJSON(path.join(PROJECT, ".claude", "manifest.json"));
const paths = readJSON(path.join(PROJECT, ".claude", "paths.json"));

const allCommandFiles = walk(
  path.join(PROJECT, ".claude", "commands"),
  ".md",
).sort();
const allHookScripts = fs
  .readdirSync(path.join(PROJECT, "scripts", "hooks"), { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith(".js"))
  .map((e) => path.join(PROJECT, "scripts", "hooks", e.name))
  .sort();
const allHookLib = fs.existsSync(path.join(PROJECT, "scripts", "hooks", "lib"))
  ? fs
      .readdirSync(path.join(PROJECT, "scripts", "hooks", "lib"))
      .filter((n) => n.endsWith(".js"))
      .map((n) => path.join(PROJECT, "scripts", "hooks", "lib", n))
      .sort()
  : [];

function collectRegisteredHooks() {
  const reg = new Set();
  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(walk);
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (typeof v === "string") {
        const m = v.match(/scripts[\\/]+hooks[\\/]+([a-zA-Z0-9._-]+\.js)/);
        if (m) reg.add(m[1]);
      } else walk(v);
    }
  }
  walk(settings);
  reg.add("pre-commit-steps-check.js");
  return reg;
}
const REGISTERED = collectRegisteredHooks();

function regenSkills() {
  const SKILL_REF = /\/([a-z][a-z0-9_]*):([a-z][a-zA-Z0-9_-]*)/g;
  const STORE_REF =
    /\.claude\/project\/(?:memory|events|maps)\/[a-zA-Z0-9_./-]+/g;
  const HOOK_REF = /scripts\/hooks\/[a-zA-Z0-9_.-]+\.js/g;

  const entries = [];
  const byNamespace = {};
  let userInvocableCount = 0;

  for (const f of allCommandFiles) {
    const r = rel(f);
    const parts = r.split("/");
    if (parts.length < 4) continue;
    const ns = parts[2];
    const name = parts.slice(3).join("/").replace(/\.md$/, "");
    const id = `skill:${ns}:${name.replace(/\//g, ":")}`;
    const content = fs.readFileSync(f, "utf8");
    const fm = parseFrontmatter(content);
    const desc = fm.description || "";
    const userInvocable = fm["user-invocable"]
      ? /true/i.test(fm["user-invocable"])
      : null;
    const st = statSafe(f);

    const calls = new Set();
    let m;
    SKILL_REF.lastIndex = 0;
    while ((m = SKILL_REF.exec(content)) !== null) {
      const target = `${m[1]}:${m[2]}`;
      if (target !== `${ns}:${name}`) calls.add(target);
    }
    const stores = [];
    STORE_REF.lastIndex = 0;
    while ((m = STORE_REF.exec(content)) !== null) stores.push(m[0]);
    const hookRefs = [];
    HOOK_REF.lastIndex = 0;
    while ((m = HOOK_REF.exec(content)) !== null) hookRefs.push(m[0]);

    const entry = {
      id,
      namespace: ns,
      name,
      path: r,
      description: desc,
      exists: true,
      size: st ? st.size : 0,
      modified: st ? st.mtime.toISOString() : null,
      user_invocable: userInvocable,
      calls: [...calls].sort(),
      reads_stores: [...new Set(stores)].sort(),
      references_hooks: [...new Set(hookRefs)].sort(),
    };
    entries.push(entry);
    if (userInvocable) userInvocableCount++;
    (byNamespace[ns] = byNamespace[ns] || []).push(entry);
  }

  const inboundMap = {};
  for (const e of entries) {
    for (const c of e.calls) {
      (inboundMap[c] = inboundMap[c] || []).push(`${e.namespace}:${e.name}`);
    }
  }
  for (const e of entries) {
    e.called_by = (inboundMap[`${e.namespace}:${e.name}`] || []).sort();
  }

  const meta = {
    _meta: true,
    name: "Skills Map",
    description: `All namespaced skill files under .claude/commands/<ns>/. Generated by scripts/regen-maps.js.`,
    version: TODAY,
    total_skills: entries.length,
    namespaces: Object.keys(byNamespace).length,
    user_invocable: userInvocableCount,
    last_regenerated: ISO,
    schema: {
      id: "skill:<namespace>:<name>",
      namespace: "command namespace",
      name: "skill name within namespace",
      path: "path to .md file",
      description: "frontmatter description",
      user_invocable: "frontmatter user-invocable flag (or null if absent)",
      calls: "outbound /ns:cmd references",
      called_by: "computed inbound calls",
      reads_stores: "memory/event/map paths referenced",
      references_hooks: "scripts/hooks/<file>.js paths referenced",
    },
  };

  writeJSONL(path.join(MAPS, "skills.jsonl"), meta, entries);

  const md = [];
  md.push(`# Skills Map`);
  md.push(``);
  md.push(`Generated: ${ISO}`);
  md.push(``);
  md.push(
    `Total: **${entries.length}** skills across **${Object.keys(byNamespace).length}** namespaces. ${userInvocableCount} user-invocable.`,
  );
  md.push(``);
  md.push(`## By namespace`);
  md.push(``);
  for (const ns of Object.keys(byNamespace).sort()) {
    md.push(`### ${ns} (${byNamespace[ns].length})`);
    md.push(``);
    md.push(`| Name | Description | Calls | Called by |`);
    md.push(`|---|---|---|---|`);
    for (const e of byNamespace[ns].sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const desc = (e.description || "").replace(/\|/g, "\\|").slice(0, 100);
      md.push(
        `| ${e.name} | ${desc} | ${e.calls.length} | ${e.called_by.length} |`,
      );
    }
    md.push(``);
  }
  md.push(`## Cross-references`);
  md.push(``);
  md.push(`Top referencing (skills that name the most others):`);
  md.push(``);
  const topCallers = [...entries]
    .filter((e) => e.calls.length > 0)
    .sort((a, b) => b.calls.length - a.calls.length)
    .slice(0, 10);
  for (const e of topCallers) {
    md.push(
      `- \`/${e.namespace}:${e.name}\` → ${e.calls.map((c) => `/${c}`).join(", ")}`,
    );
  }
  md.push(``);
  md.push(`Most referenced (skills the others name the most):`);
  md.push(``);
  const topCalled = [...entries]
    .filter((e) => e.called_by.length > 0)
    .sort((a, b) => b.called_by.length - a.called_by.length)
    .slice(0, 10);
  for (const e of topCalled) {
    md.push(
      `- \`/${e.namespace}:${e.name}\` ← ${e.called_by.map((c) => `/${c}`).join(", ")}`,
    );
  }
  md.push(``);
  writeText(path.join(MAPS, "skills.md"), md.join("\n"));

  const namespacesObj = {};
  for (const ns of Object.keys(byNamespace).sort()) {
    namespacesObj[ns] = {
      namespace: ns,
      count: byNamespace[ns].length,
      skills: byNamespace[ns]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((e) => ({
          id: `${e.namespace}:${e.name}`,
          name: e.name,
          description: e.description,
          file: e.path,
          user_invocable: e.user_invocable,
          data_flow: {
            reads: e.reads_stores,
            writes: [],
            references: e.references_hooks,
            calls: e.calls.map((c) => `/${c}`),
          },
        })),
    };
  }
  writeJSON(path.join(MAPS, "inventory-skills.json"), {
    metadata: {
      generated: ISO,
      lastUpdated: ISO,
      total_skills: entries.length,
      namespaces: Object.keys(byNamespace).length,
      user_invocable: userInvocableCount,
      regenerated_by: "scripts/regen-maps.js",
    },
    namespaces: namespacesObj,
    summary: {
      by_invocability: {
        user_invocable: userInvocableCount,
        system_only: entries.length - userInvocableCount,
      },
      most_referenced_namespaces: Object.keys(byNamespace)
        .sort((a, b) => byNamespace[b].length - byNamespace[a].length)
        .slice(0, 5)
        .map((ns) => ({ namespace: ns, count: byNamespace[ns].length })),
    },
  });

  return { count: entries.length, namespaces: Object.keys(byNamespace).length };
}

function regenHooks() {
  const existingHooks = {};
  const hooksPath = path.join(MAPS, "hooks.jsonl");
  if (fs.existsSync(hooksPath)) {
    for (const line of fs.readFileSync(hooksPath, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj._meta) continue;
        if (obj.id) existingHooks[obj.id] = obj;
      } catch {
      }
    }
  }

  const entries = [];
  for (const f of allHookScripts) {
    const r = rel(f);
    const name = path.basename(f);
    const st = statSafe(f);
    const id = `hook:${name.replace(/\.js$/, "")}`;
    const entry = {
      id,
      name,
      path: r,
      registered: REGISTERED.has(name),
      exists: true,
      size: st ? st.size : 0,
      modified: st ? st.mtime.toISOString() : null,
    };
    const prev = existingHooks[id];
    if (prev) {
      if (prev.kind) entry.kind = prev.kind;
      if (prev.disposition) entry.disposition = prev.disposition;
      if (prev.note) entry.note = prev.note;
    }
    entries.push(entry);
  }

  for (const f of allHookLib) {
    const r = rel(f);
    const name = path.basename(f);
    const st = statSafe(f);
    entries.push({
      id: `hook-lib:${name.replace(/\.js$/, "")}`,
      name,
      path: r,
      registered: false,
      type: "lib",
      exists: true,
      size: st ? st.size : 0,
      modified: st ? st.mtime.toISOString() : null,
    });
  }

  const wiring = [];
  for (const eventName of Object.keys(settings.hooks || {})) {
    for (const block of settings.hooks[eventName]) {
      const matcher = block.matcher || "";
      for (const h of block.hooks || []) {
        const m = (h.command || "").match(
          /scripts[\\/]+hooks[\\/]+([a-zA-Z0-9._-]+\.js)/,
        );
        if (m) wiring.push({ event: eventName, matcher, hook: m[1] });
      }
    }
  }
  wiring.push({
    event: "git-pre-commit",
    matcher: "(off-registry)",
    hook: "pre-commit-steps-check.js",
  });

  const meta = {
    _meta: true,
    name: "Hooks Map",
    description: `All .js hook scripts under scripts/hooks/ + lib modules + settings.json wiring.`,
    version: TODAY,
    total_hooks: entries.filter((e) => !e.type).length,
    total_lib_modules: entries.filter((e) => e.type === "lib").length,
    registered_hooks: entries.filter((e) => e.registered).length,
    orphan_hooks: entries.filter((e) => !e.registered && !e.type).length,
    wiring_count: wiring.length,
    last_regenerated: ISO,
  };

  writeJSONL(path.join(MAPS, "hooks.jsonl"), meta, entries);

  const md = [];
  md.push(`# Hooks Map`);
  md.push(``);
  md.push(`Generated: ${ISO}`);
  md.push(``);
  md.push(
    `**${meta.total_hooks}** hook scripts (${meta.registered_hooks} registered, ${meta.orphan_hooks} orphan), **${meta.total_lib_modules}** lib modules, **${meta.wiring_count}** wiring entries.`,
  );
  md.push(``);
  md.push(`## Wiring (event → matcher → hook)`);
  md.push(``);
  const byEvent = {};
  for (const w of wiring) (byEvent[w.event] = byEvent[w.event] || []).push(w);
  for (const ev of Object.keys(byEvent).sort()) {
    md.push(`### ${ev}`);
    md.push(``);
    for (const w of byEvent[ev]) {
      md.push(`- \`${w.matcher || "(no matcher)"}\` → \`${w.hook}\``);
    }
    md.push(``);
  }
  md.push(`## All hook scripts (.js)`);
  md.push(``);
  md.push(`| Hook | Registered | Size | Modified |`);
  md.push(`|---|---|---|---|`);
  for (const e of entries.filter((e) => !e.type)) {
    md.push(
      `| ${e.name} | ${e.registered ? "yes" : "no"} | ${e.size} | ${e.modified} |`,
    );
  }
  md.push(``);
  md.push(`## Lib modules`);
  md.push(``);
  md.push(`| Module | Size | Modified |`);
  md.push(`|---|---|---|`);
  for (const e of entries.filter((e) => e.type === "lib")) {
    md.push(`| ${e.name} | ${e.size} | ${e.modified} |`);
  }
  md.push(``);
  writeText(path.join(MAPS, "hooks.md"), md.join("\n"));

  writeJSON(path.join(MAPS, "inventory-hooks.json"), {
    metadata: {
      generated: ISO,
      lastUpdated: ISO,
      total_hooks: meta.total_hooks,
      total_lib_modules: meta.total_lib_modules,
      registered_hooks: meta.registered_hooks,
      orphan_hooks: meta.orphan_hooks,
      regenerated_by: "scripts/regen-maps.js",
    },
    hooks: entries,
    wiring,
  });

  return {
    count: meta.total_hooks,
    lib: meta.total_lib_modules,
    registered: meta.registered_hooks,
    orphan: meta.orphan_hooks,
  };
}

function regenTools() {
  const entries = [];

  const scriptsDir = path.join(PROJECT, "scripts");
  for (const e of fs.readdirSync(scriptsDir, { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith(".js")) {
      const full = path.join(scriptsDir, e.name);
      const st = statSafe(full);
      entries.push({
        id: `tool:${e.name.replace(/\.js$/, "")}`,
        name: e.name,
        path: rel(full),
        type: "script",
        exists: true,
        size: st ? st.size : 0,
        modified: st ? st.mtime.toISOString() : null,
      });
    }
  }

  let pkgScripts = {};
  try {
    pkgScripts = readJSON(path.join(PROJECT, "package.json")).scripts || {};
  } catch {
  }
  for (const [name, cmd] of Object.entries(pkgScripts)) {
    entries.push({
      id: `npm-script:${name}`,
      name,
      type: "npm-script",
      command: cmd,
    });
  }

  const knownCLIs = [
    {
      name: "agy",
      install: "standalone Antigravity CLI (not npm)",
      env: [],
    },
    {
      name: "codex",
      install: "npm i -g @openai/codex",
      env: ["OPENAI_API_KEY"],
    },
    {
      name: "claude",
      install: "(Claude Code itself)",
      env: ["ANTHROPIC_API_KEY"],
    },
  ];
  for (const c of knownCLIs) {
    entries.push({
      id: `cli:${c.name}`,
      name: c.name,
      type: "external_cli",
      install: c.install,
      required_env: c.env,
    });
  }

  entries.push({
    id: "xref:skills",
    type: "xref",
    note: "skills inventory lives in .claude/project/maps/inventory-skills.json",
    count: allCommandFiles.length,
  });
  entries.push({
    id: "xref:hooks",
    type: "xref",
    note: "hooks inventory lives in .claude/project/maps/inventory-hooks.json",
    count: allHookScripts.length,
  });

  const counts = {
    scripts: entries.filter((e) => e.type === "script").length,
    npm_scripts: entries.filter((e) => e.type === "npm-script").length,
    external_clis: entries.filter((e) => e.type === "external_cli").length,
    xrefs: entries.filter((e) => e.type === "xref").length,
  };

  const meta = {
    _meta: true,
    name: "Tools Map",
    description: `Utility scripts, npm scripts, external CLIs, cross-refs to skills/hooks.`,
    version: TODAY,
    counts,
    last_regenerated: ISO,
  };

  writeJSONL(path.join(MAPS, "tools.jsonl"), meta, entries);

  const md = [];
  md.push(`# Tools Map`);
  md.push(``);
  md.push(`Generated: ${ISO}`);
  md.push(``);
  md.push(
    `Scripts: **${counts.scripts}** | npm scripts: **${counts.npm_scripts}** | External CLIs: **${counts.external_clis}**`,
  );
  md.push(``);
  md.push(`## Utility scripts (scripts/*.js)`);
  md.push(``);
  md.push(`| Name | Size | Modified |`);
  md.push(`|---|---|---|`);
  for (const e of entries.filter((e) => e.type === "script")) {
    md.push(`| ${e.name} | ${e.size} | ${e.modified} |`);
  }
  md.push(``);
  md.push(`## npm scripts (package.json)`);
  md.push(``);
  md.push(`| Name | Command |`);
  md.push(`|---|---|`);
  for (const e of entries.filter((e) => e.type === "npm-script")) {
    md.push(
      `| ${e.name} | \`${(e.command || "").replace(/\|/g, "\\|").slice(0, 120)}\` |`,
    );
  }
  md.push(``);
  md.push(`## External CLIs`);
  md.push(``);
  for (const e of entries.filter((e) => e.type === "external_cli")) {
    md.push(
      `- **${e.name}** — install: \`${e.install}\`; required env: ${e.required_env.join(", ")}`,
    );
  }
  md.push(``);
  writeText(path.join(MAPS, "tools.md"), md.join("\n"));

  writeJSON(path.join(MAPS, "inventory-tools.json"), {
    metadata: {
      generated: ISO,
      lastUpdated: ISO,
      total_tools: entries.length,
      categories: 4,
      regenerated_by: "scripts/regen-maps.js",
    },
    categories: {
      scripts: {
        count: counts.scripts,
        items: entries.filter((e) => e.type === "script"),
      },
      npm_scripts: {
        count: counts.npm_scripts,
        items: entries.filter((e) => e.type === "npm-script"),
      },
      external_clis: {
        count: counts.external_clis,
        items: entries.filter((e) => e.type === "external_cli"),
      },
      xrefs: {
        count: counts.xrefs,
        items: entries.filter((e) => e.type === "xref"),
      },
    },
    summary: counts,
  });

  return counts;
}

function regenMemory() {
  const stores = [];

  const eventsDir = path.join(PROJECT, ".claude", "project", "events");
  if (fs.existsSync(eventsDir)) {
    for (const n of fs.readdirSync(eventsDir).sort()) {
      const full = path.join(eventsDir, n);
      const st = statSafe(full);
      if (!st || !st.isFile() || !n.endsWith(".jsonl")) continue;
      stores.push({
        id: n.replace(/\.jsonl$/, ""),
        path: rel(full),
        category: "events",
        tier: "centralized",
        entryCount: lineCount(full),
        exists: true,
        size: st.size,
        modified: st.mtime.toISOString(),
      });
    }
  }

  const memDir = path.join(PROJECT, ".claude", "project", "memory");
  if (fs.existsSync(memDir)) {
    for (const n of fs.readdirSync(memDir).sort()) {
      const full = path.join(memDir, n);
      const st = statSafe(full);
      if (!st || !st.isFile() || !n.endsWith(".jsonl")) continue;
      stores.push({
        id: n.replace(/\.jsonl$/, ""),
        path: rel(full),
        category: "memory",
        tier: "semantic",
        entryCount: lineCount(full),
        exists: true,
        size: st.size,
        modified: st.mtime.toISOString(),
      });
    }
  }

  const betaEvents = (() => {
    try {
      return require("./hooks/lib/paths").PATHS.betaEvents;
    } catch {
      return path.join(PROJECT, ".claude", "agents", "president", "_system", "beta", "events.jsonl");
    }
  })();
  if (fs.existsSync(betaEvents)) {
    const st = statSafe(betaEvents);
    stores.push({
      id: "beta-events",
      path: rel(betaEvents),
      category: "beta",
      tier: "beta",
      entryCount: lineCount(betaEvents),
      exists: true,
      size: st.size,
      modified: st.mtime.toISOString(),
    });
  }

  const meta = {
    _meta: true,
    name: "Memory Stores Map",
    description: `Centralized event log + semantic memory + beta events. Counts by line.`,
    version: TODAY,
    total_stores: stores.length,
    last_regenerated: ISO,
  };

  writeJSONL(path.join(MAPS, "memory.jsonl"), meta, stores);

  const md = [];
  md.push(`# Memory Stores Map`);
  md.push(``);
  md.push(`Generated: ${ISO}`);
  md.push(``);
  md.push(`| id | tier | category | path | entryCount | size | modified |`);
  md.push(`|---|---|---|---|---|---|---|`);
  for (const s of stores) {
    md.push(
      `| ${s.id} | ${s.tier} | ${s.category} | ${s.path} | ${s.entryCount} | ${s.size} | ${s.modified} |`,
    );
  }
  md.push(``);
  writeText(path.join(MAPS, "memory.md"), md.join("\n"));

  writeJSON(path.join(MAPS, "inventory-memory.json"), {
    metadata: {
      generated: ISO,
      lastUpdated: ISO,
      total_stores: stores.length,
      tiers: 3,
      regenerated_by: "scripts/regen-maps.js",
    },
    tiers: {
      centralized: stores.filter((s) => s.tier === "centralized"),
      semantic: stores.filter((s) => s.tier === "semantic"),
      beta: stores.filter((s) => s.tier === "beta"),
    },
    totals: {
      total_lines: stores.reduce((a, s) => a + s.entryCount, 0),
      total_size: stores.reduce((a, s) => a + s.size, 0),
    },
  });

  return {
    count: stores.length,
    total_lines: stores.reduce((a, s) => a + s.entryCount, 0),
  };
}

function regenSystems() {
  const systemsFile = path.join(
    PROJECT,
    ".claude",
    "project",
    "memory",
    "systems.jsonl",
  );
  const systems = [];
  if (fs.existsSync(systemsFile)) {
    for (const line of fs.readFileSync(systemsFile, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        systems.push(JSON.parse(line));
      } catch {
      }
    }
  }

  const byCat = {};
  for (const s of systems) {
    const c = s.category || "uncategorized";
    (byCat[c] = byCat[c] || []).push(s);
  }
  const byStatus = {};
  for (const s of systems) {
    const st = s.status || "unknown";
    (byStatus[st] = byStatus[st] || []).push(s.id);
  }

  let totalFiles = 0;
  let missingFiles = 0;
  for (const s of systems) {
    if (Array.isArray(s.files)) {
      for (const f of s.files) {
        totalFiles++;
        if (!fs.existsSync(path.join(PROJECT, f))) missingFiles++;
      }
    }
  }

  const md = [];
  md.push(`# Systems Manifest`);
  md.push(``);
  md.push(`Generated: ${ISO}`);
  md.push(``);
  md.push(
    `Total: **${systems.length}** systems across **${Object.keys(byCat).length}** categories. Files referenced: ${totalFiles}, missing on disk: ${missingFiles}.`,
  );
  md.push(``);
  md.push(`## By status`);
  md.push(``);
  md.push(`| Status | Count |`);
  md.push(`|---|---|`);
  for (const st of Object.keys(byStatus).sort()) {
    md.push(`| ${st} | ${byStatus[st].length} |`);
  }
  md.push(``);
  md.push(`## By category`);
  md.push(``);
  for (const c of Object.keys(byCat).sort()) {
    md.push(`### ${c} (${byCat[c].length})`);
    md.push(``);
    md.push(`| id | name | status | files |`);
    md.push(`|---|---|---|---|`);
    for (const s of byCat[c].sort((a, b) =>
      (a.id || "").localeCompare(b.id || ""),
    )) {
      const filesStr = Array.isArray(s.files) ? s.files.length : 0;
      const name = ((s.name || "") + "").replace(/\|/g, "\\|").slice(0, 80);
      md.push(
        `| ${s.id || "?"} | ${name} | ${s.status || "?"} | ${filesStr} |`,
      );
    }
    md.push(``);
  }
  writeText(path.join(MAPS, "systems.md"), md.join("\n"));

  const rollup = [];
  rollup.push({
    id: "identity",
    name: "Alex identity",
    category: "identity",
    files: ["CLAUDE.md", "AGENTS.md"],
  });
  rollup.push({
    id: "agents",
    name: "Agent team + build chains",
    category: "agents",
    count: walk(path.join(PROJECT, ".claude", "agents"), ".md").length,
  });
  rollup.push({
    id: "skills",
    name: "Skills",
    category: "capability",
    count: allCommandFiles.length,
  });
  rollup.push({
    id: "hooks",
    name: "Hooks",
    category: "automation",
    count: allHookScripts.length,
  });
  rollup.push({
    id: "memory",
    name: "Memory stores",
    category: "memory",
    count: 8,
  });
  rollup.push({
    id: "maps",
    name: "Relationship maps",
    category: "infrastructure",
    dir: ".claude/project/maps",
  });
  rollup.push({
    id: "paths-registry",
    name: "Paths registry",
    category: "infrastructure",
    path: ".claude/paths.json",
  });
  rollup.push({
    id: "manifest",
    name: "Project manifest",
    category: "infrastructure",
    path: ".claude/manifest.json",
  });
  rollup.push({
    id: "settings",
    name: "Hook settings",
    category: "infrastructure",
    path: ".claude/settings.json",
  });
  rollup.push({
    id: "store",
    name: "Build store",
    category: "orchestration",
    path: ".claude/agents/store.json",
  });
  rollup.push({
    id: "spec-graph",
    name: "Spec dependency graph",
    category: "infrastructure",
    path: ".claude/project/maps/SPEC_GRAPH.json",
  });
  rollup.push({
    id: "reference-docs",
    name: "Reference documentation",
    category: "knowledge",
    count: walk(path.join(PROJECT, ".claude", "project", "reference"), ".md")
      .length,
  });
  rollup.push({
    id: "patterns",
    name: "Engineering patterns library",
    category: "knowledge",
    count: walk(path.join(PROJECT, "patterns"), ".md").length,
  });
  rollup.push({
    id: "requirements-templates",
    name: "Requirements spec templates",
    category: "product",
    count: walk(path.join(PROJECT, "_requirements", "_standards"), ".md").length,
  });
  rollup.push({
    id: "installer",
    name: "Installer",
    category: "product",
    files: ["scripts/mc-setup.js", "install.ps1", "version.json"].filter(
      (f) => fs.existsSync(path.join(PROJECT, f)),
    ),
  });
  rollup.push({
    id: "linters",
    name: "Lint suite",
    category: "quality",
    files: fs
      .readdirSync(path.join(PROJECT, "scripts"))
      .filter((n) => n.startsWith("lint-") && n.endsWith(".js"))
      .map((n) => `scripts/${n}`)
      .concat(
        ["scripts/path-lint.js"].filter((f) =>
          fs.existsSync(path.join(PROJECT, f)),
        ),
      ),
  });

  fs.writeFileSync(
    path.join(MAPS, "systems-inventory.jsonl"),
    rollup.map((r) => JSON.stringify(r)).join("\n") + "\n",
  );

  const sumMd = [];
  sumMd.push(`# Systems Inventory (Category Rollup)`);
  sumMd.push(``);
  sumMd.push(`Generated: ${ISO}`);
  sumMd.push(``);
  sumMd.push(`| id | name | category | metric |`);
  sumMd.push(`|---|---|---|---|`);
  for (const r of rollup) {
    const metric =
      r.count !== undefined
        ? `count=${r.count}`
        : r.files
          ? `files=${r.files.length}`
          : r.path || r.dir || "—";
    sumMd.push(`| ${r.id} | ${r.name} | ${r.category} | ${metric} |`);
  }
  sumMd.push(``);
  writeText(path.join(MAPS, "systems-inventory.md"), sumMd.join("\n"));

  writeJSON(path.join(MAPS, "inventory-systems.json"), {
    metadata: {
      generated: ISO,
      lastUpdated: ISO,
      total_systems: systems.length,
      categories: Object.keys(byCat).length,
      total_files_referenced: totalFiles,
      missing_files_on_disk: missingFiles,
      regenerated_by: "scripts/regen-maps.js",
    },
    by_status: Object.fromEntries(
      Object.entries(byStatus).map(([k, v]) => [
        k,
        { count: v.length, ids: v },
      ]),
    ),
    by_category: Object.fromEntries(
      Object.entries(byCat).map(([k, v]) => [
        k,
        {
          count: v.length,
          systems: v.map((s) => ({
            id: s.id,
            name: s.name,
            status: s.status,
            files: s.files || [],
          })),
        },
      ]),
    ),
    category_rollup: rollup,
  });

  return {
    count: systems.length,
    categories: Object.keys(byCat).length,
    totalFiles,
    missingFiles,
  };
}

function regenEnforcements() {

  const existing = {};
  const existingMeta = {};
  const enfPath = path.join(MAPS, "enforcements.jsonl");
  if (fs.existsSync(enfPath)) {
    for (const line of fs.readFileSync(enfPath, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj._meta) Object.assign(existingMeta, obj);
        else if (obj.id) existing[obj.id] = obj;
      } catch {
      }
    }
  }

  const entries = [];
  let uncurated = 0;
  for (const f of allHookScripts) {
    const name = path.basename(f);
    const id = name.replace(/\.js$/, "");
    const st = statSafe(f);
    if (existing[id]) {
      entries.push({
        ...existing[id],
        registered: REGISTERED.has(name),
        file: rel(f),
        file_size: st ? st.size : 0,
        file_modified: st ? st.mtime.toISOString() : null,
      });
    } else {
      uncurated++;
      entries.push({
        id,
        type: "hook",
        matcher: "?",
        phase: "?",
        mode: "?",
        file: rel(f),
        file_size: st ? st.size : 0,
        file_modified: st ? st.mtime.toISOString() : null,
        registered: REGISTERED.has(name),
        gates: [],
        blocks: [],
        warns: [],
        allows: [],
        gaps_closed: [],
        uncurated: true,
        uncurated_note:
          "not in the existing enforcements map — fields ?, ?, ? need a /maps:enforcements review",
      });
    }
  }
  for (const f of allHookLib) {
    const name = path.basename(f);
    const id = name.replace(/\.js$/, "");
    const st = statSafe(f);
    if (existing[id]) {
      entries.push({
        ...existing[id],
        file: rel(f),
        file_size: st ? st.size : 0,
        file_modified: st ? st.mtime.toISOString() : null,
      });
    } else {
      entries.push({
        id,
        type: "module",
        file: rel(f),
        file_size: st ? st.size : 0,
        file_modified: st ? st.mtime.toISOString() : null,
        uncurated: true,
      });
    }
  }

  const meta = {
    _meta: true,
    name: "Enforcements Map",
    description: `All enforcement hooks + lib modules. Hand-curated gate/block/warn detail carried forward where IDs match; new hooks marked uncurated.`,
    version: TODAY,
    total_hooks: entries.filter((e) => e.type === "hook").length,
    total_modules: entries.filter((e) => e.type === "module").length,
    uncurated_count: entries.filter((e) => e.uncurated).length,
    total_gaps: existingMeta.total_gaps || 0,
    gaps_closed: existingMeta.gaps_closed || 0,
    gaps_open: existingMeta.gaps_open || 0,
    open_gaps: existingMeta.open_gaps || [],
    gate_types: existingMeta.gate_types || [],
    coverage: entries.some((e) => e.uncurated) ? "partial-uncurated" : "partial",
    last_regenerated: ISO,
    last_full_handcuration:
      existingMeta.last_regenerated || existingMeta.version || "unknown",
  };

  writeJSONL(path.join(MAPS, "enforcements.jsonl"), meta, entries);

  const md = [];
  md.push(`# Enforcements Map`);
  md.push(``);
  md.push(`Generated: ${ISO}`);
  md.push(``);
  md.push(
    `**${meta.total_hooks}** hooks, **${meta.total_modules}** lib modules. **${meta.uncurated_count}** uncurated.`,
  );
  md.push(``);
  md.push(`## Coverage`);
  md.push(``);
  md.push(`- Total gaps tracked: ${meta.total_gaps}`);
  md.push(`- Closed: ${meta.gaps_closed}`);
  md.push(`- Open: ${meta.gaps_open}`);
  if (meta.open_gaps.length)
    md.push(`- Open IDs: ${meta.open_gaps.join(", ")}`);
  md.push(``);
  md.push(`## Hooks`);
  md.push(``);
  md.push(`| id | matcher | phase | mode | registered | uncurated |`);
  md.push(`|---|---|---|---|---|---|`);
  for (const e of entries.filter((e) => e.type === "hook")) {
    md.push(
      `| ${e.id} | ${e.matcher || ""} | ${e.phase || ""} | ${e.mode || ""} | ${e.registered ? "yes" : "no"} | ${e.uncurated ? "yes" : ""} |`,
    );
  }
  md.push(``);
  md.push(`## Lib modules`);
  md.push(``);
  md.push(`| id | file | uncurated |`);
  md.push(`|---|---|---|`);
  for (const e of entries.filter((e) => e.type === "module")) {
    md.push(`| ${e.id} | ${e.file} | ${e.uncurated ? "yes" : ""} |`);
  }
  md.push(``);
  writeText(path.join(MAPS, "enforcements.md"), md.join("\n"));

  writeJSON(path.join(MAPS, "inventory-enforcements.json"), {
    metadata: {
      generated: ISO,
      lastUpdated: ISO,
      total_hooks: meta.total_hooks,
      total_modules: meta.total_modules,
      uncurated: meta.uncurated_count,
      total_gaps: meta.total_gaps,
      gaps_closed: meta.gaps_closed,
      gaps_open: meta.gaps_open,
      regenerated_by: "scripts/regen-maps.js",
    },
    entries,
  });

  return {
    hooks: meta.total_hooks,
    modules: meta.total_modules,
    uncurated: meta.uncurated_count,
  };
}

function regenArchitecture() {
  const sections = {
    pages: walk(path.join(PROJECT, "src", "components", "pages"), ".tsx"),
    dashboard: fs.existsSync(
      path.join(PROJECT, "src", "components", "dashboard"),
    )
      ? walk(path.join(PROJECT, "src", "components", "dashboard"), ".tsx")
      : [],
    steps: walk(path.join(PROJECT, "src", "components", "steps"), ".tsx"),
    ui: walk(path.join(PROJECT, "src", "components", "ui"), ".tsx"),
    lib: walk(path.join(PROJECT, "src", "lib"), ".ts").concat(
      walk(path.join(PROJECT, "src", "lib"), ".tsx"),
    ),
    api_routes: [],
    extension: fs.existsSync(path.join(PROJECT, "extension"))
      ? walk(path.join(PROJECT, "extension"), null).filter((f) =>
          /\.(js|html|css|json)$/.test(f),
        )
      : [],
  };

  const apiDir = path.join(PROJECT, "src", "app", "api");
  if (fs.existsSync(apiDir)) {
    const routes = walk(apiDir, ".ts").filter(
      (f) => path.basename(f) === "route.ts",
    );
    sections.api_routes = routes;
  }

  function names(arr, base) {
    return arr.map((f) => rel(f).replace(base + "/", ""));
  }

  const meta = {
    generated: ISO,
    counts: {
      pages: sections.pages.length,
      dashboard: sections.dashboard.length,
      steps: sections.steps.length,
      ui: sections.ui.length,
      lib: sections.lib.length,
      api_routes: sections.api_routes.length,
      extension: sections.extension.length,
    },
  };

  const md = [];
  md.push(`# Architecture Map — ${TODAY}`);
  md.push(``);
  md.push(`Generated: ${ISO}`);
  md.push(``);
  md.push(
    `Application structure derived from filesystem walk of src/ and extension/.`,
  );
  md.push(``);
  md.push(`## Counts`);
  md.push(``);
  md.push(`| Layer | Count |`);
  md.push(`|---|---|`);
  for (const [k, v] of Object.entries(meta.counts)) md.push(`| ${k} | ${v} |`);
  md.push(``);
  if (sections.pages.length) {
    md.push(`## Pages (src/components/pages/)`);
    md.push(``);
    for (const f of sections.pages) md.push(`- \`${rel(f)}\``);
    md.push(``);
  }
  if (sections.steps.length) {
    md.push(`## Steps (src/components/steps/)`);
    md.push(``);
    for (const f of sections.steps.sort()) md.push(`- \`${rel(f)}\``);
    md.push(``);
  }
  md.push(`## API Routes (src/app/api/)`);
  md.push(``);
  for (const f of sections.api_routes.sort()) md.push(`- \`${rel(f)}\``);
  md.push(``);
  md.push(`## UI atoms (src/components/ui/)`);
  md.push(``);
  for (const f of sections.ui.sort()) md.push(`- \`${rel(f)}\``);
  md.push(``);
  md.push(`## Lib (src/lib/)`);
  md.push(``);
  for (const f of sections.lib.sort()) md.push(`- \`${rel(f)}\``);
  md.push(``);
  if (sections.dashboard.length) {
    md.push(`## Dashboard components (src/components/dashboard/)`);
    md.push(``);
    for (const f of sections.dashboard.sort()) md.push(`- \`${rel(f)}\``);
    md.push(``);
  }
  if (sections.extension.length) {
    md.push(`## Extension (extension/)`);
    md.push(``);
    for (const f of sections.extension.sort()) md.push(`- \`${rel(f)}\``);
    md.push(``);
  }
  writeText(path.join(MAPS, "architecture.md"), md.join("\n"));

  writeJSON(path.join(MAPS, "inventory-architecture.json"), {
    metadata: {
      generated: ISO,
      lastUpdated: ISO,
      regenerated_by: "scripts/regen-maps.js",
    },
    counts: meta.counts,
    sections: Object.fromEntries(
      Object.entries(sections).map(([k, v]) => [
        k,
        v.map((f) => rel(f)).sort(),
      ]),
    ),
  });

  return meta.counts;
}

function regenInventoryMd(results) {
  const md = [];
  md.push(`# Tool Inventory — Project Ecosystem`);
  md.push(``);
  md.push(`**Generated:** ${ISO}`);
  md.push(
    `**Source:** \`scripts/regen-maps.js\` (deterministic file walks; no LLM synthesis).`,
  );
  md.push(``);
  md.push(`## Headline counts`);
  md.push(``);
  md.push(`| Category | Count |`);
  md.push(`|---|---|`);
  md.push(`| Skills (.claude/commands/**/*.md) | ${results.skills.count} |`);
  md.push(`| Skill namespaces | ${results.skills.namespaces} |`);
  md.push(`| Hook scripts (scripts/hooks/*.js) | ${results.hooks.count} |`);
  md.push(
    `| Hook lib modules (scripts/hooks/lib/*.js) | ${results.hooks.lib} |`,
  );
  md.push(
    `| Registered hooks (in settings.json) | ${results.hooks.registered} |`,
  );
  md.push(
    `| Orphan hooks (on disk, not registered) | ${results.hooks.orphan} |`,
  );
  md.push(`| Utility scripts (scripts/*.js) | ${results.tools.scripts} |`);
  md.push(`| npm scripts (package.json) | ${results.tools.npm_scripts} |`);
  md.push(`| External CLIs | ${results.tools.external_clis} |`);
  md.push(`| Memory stores | ${results.memory.count} |`);
  md.push(`| Memory total lines | ${results.memory.total_lines} |`);
  md.push(`| Systems (systems.jsonl entries) | ${results.systems.count} |`);
  md.push(`| System categories | ${results.systems.categories} |`);
  md.push(
    `| Enforcement hooks (curated) | ${results.enforcements.hooks - results.enforcements.uncurated} |`,
  );
  md.push(
    `| Enforcement hooks (uncurated, new) | ${results.enforcements.uncurated} |`,
  );
  md.push(`| Architecture: pages | ${results.architecture.pages} |`);
  md.push(`| Architecture: steps | ${results.architecture.steps} |`);
  md.push(`| Architecture: UI atoms | ${results.architecture.ui} |`);
  md.push(`| Architecture: lib | ${results.architecture.lib} |`);
  md.push(`| Architecture: API routes | ${results.architecture.api_routes} |`);
  md.push(``);
  md.push(`## Per-map outputs`);
  md.push(``);
  md.push(`| Map | jsonl | md | inventory.json |`);
  md.push(`|---|---|---|---|`);
  md.push(`| skills | skills.jsonl | skills.md | inventory-skills.json |`);
  md.push(`| hooks | hooks.jsonl | hooks.md | inventory-hooks.json |`);
  md.push(`| tools | tools.jsonl | tools.md | inventory-tools.json |`);
  md.push(`| memory | memory.jsonl | memory.md | inventory-memory.json |`);
  md.push(
    `| systems | (source: ../memory/systems.jsonl) | systems.md, systems-inventory.md | inventory-systems.json |`,
  );
  md.push(
    `| enforcements | enforcements.jsonl | enforcements.md | inventory-enforcements.json |`,
  );
  md.push(
    `| architecture | (source: src/) | architecture.md | inventory-architecture.json |`,
  );
  md.push(``);
  writeText(path.join(MAPS, "INVENTORY.md"), md.join("\n"));
}

function specGraphNodeCount(p) {
  try {
    const sg = JSON.parse(fs.readFileSync(p, "utf8"));
    return (sg.counts && sg.counts.nodes) || (sg.nodes && sg.nodes.length) || 0;
  } catch {
    return 0;
  }
}

const before = {
  skills: lineCount(path.join(MAPS, "skills.jsonl")),
  hooks: lineCount(path.join(MAPS, "hooks.jsonl")),
  tools: lineCount(path.join(MAPS, "tools.jsonl")),
  memory: lineCount(path.join(MAPS, "memory.jsonl")),
  enforcements: lineCount(path.join(MAPS, "enforcements.jsonl")),
  systems_inventory: lineCount(path.join(MAPS, "systems-inventory.jsonl")),
  spec_graph_nodes: specGraphNodeCount(path.join(MAPS, "SPEC_GRAPH.json")),
};

console.log("Before:", before);

const results = {};
console.log("\n[1/7] /maps:skills ...");
results.skills = regenSkills();
console.log(
  "      → skills.jsonl, skills.md, inventory-skills.json",
  results.skills,
);

console.log("\n[2/7] /maps:hooks ...");
results.hooks = regenHooks();
console.log(
  "      → hooks.jsonl, hooks.md, inventory-hooks.json",
  results.hooks,
);

console.log("\n[3/7] /maps:tools ...");
results.tools = regenTools();
console.log(
  "      → tools.jsonl, tools.md, inventory-tools.json",
  results.tools,
);

console.log("\n[4/7] /maps:memory ...");
results.memory = regenMemory();
console.log(
  "      → memory.jsonl, memory.md, inventory-memory.json",
  results.memory,
);

console.log("\n[5/7] /maps:systems ...");
results.systems = regenSystems();
console.log(
  "      → systems.md, systems-inventory.{jsonl,md}, inventory-systems.json",
  results.systems,
);

console.log("\n[6/7] /maps:enforcements ...");
results.enforcements = regenEnforcements();
console.log(
  "      → enforcements.jsonl, enforcements.md, inventory-enforcements.json",
  results.enforcements,
);

console.log("\n[7/9] /maps:architecture ...");
results.architecture = regenArchitecture();
console.log(
  "      → architecture.md, inventory-architecture.json",
  results.architecture,
);

console.log("\n[8/9] paths.specGraph (spec-graph.js) ...");
try {
  const { execFileSync } = require("child_process");
  const out = execFileSync(
    process.execPath,
    [path.join(PROJECT, "scripts", "maps", "spec-graph.js")],
    { encoding: "utf8" },
  );
  process.stdout.write(out);
  try {
    const sg = JSON.parse(
      fs.readFileSync(path.join(MAPS, "SPEC_GRAPH.json"), "utf8"),
    );
    results.specGraph = {
      nodes: sg.counts && sg.counts.nodes,
      edges: sg.counts && sg.counts.edges,
    };
  } catch {
    results.specGraph = { nodes: 0, edges: 0 };
  }
} catch (err) {
  console.error("      ! spec-graph.js failed:", err.message || err);
  results.specGraph = { nodes: 0, edges: 0, error: String(err.message || err) };
}

console.log("\n[9/9] paths.requireGraph (require-graph.js) ...");
try {
  const { regenRequireGraph } = require(
    path.join(PROJECT, "scripts", "maps", "require-graph.js"),
  );
  const rg = regenRequireGraph(PROJECT);
  results.requireGraph = {
    nodes: rg.counts.nodes,
    edges: rg.counts.edges,
    unresolved: rg.counts.unresolved,
  };
  console.log("      → require-graph.json", results.requireGraph);
} catch (err) {
  console.error("      ! require-graph.js failed:", err.message || err);
  results.requireGraph = {
    nodes: 0,
    edges: 0,
    unresolved: 0,
    error: String(err.message || err),
  };
}

console.log("\nINVENTORY.md ...");
regenInventoryMd(results);

const after = {
  skills: lineCount(path.join(MAPS, "skills.jsonl")),
  hooks: lineCount(path.join(MAPS, "hooks.jsonl")),
  tools: lineCount(path.join(MAPS, "tools.jsonl")),
  memory: lineCount(path.join(MAPS, "memory.jsonl")),
  enforcements: lineCount(path.join(MAPS, "enforcements.jsonl")),
  systems_inventory: lineCount(path.join(MAPS, "systems-inventory.jsonl")),
};
console.log("\nAfter: ", after);
console.log("\nDelta:");
for (const k of Object.keys(before)) {
  const d = after[k] - before[k];
  console.log(`  ${k}: ${before[k]} → ${after[k]} (${d >= 0 ? "+" : ""}${d})`);
}
