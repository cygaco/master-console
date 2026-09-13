#!/usr/bin/env node
"use strict";
/**
 * migration — S-OS-06 T4 stage C, gate G5 (T-20260913-363): the 1.2.0 -> 2.0.0 downstream migration
 * (migrations/1.2.0-to-2.0.0/001 layout, 002 settings, 003 skills) run against a FIXTURE product through the REAL
 * loader update.js calls (scripts/mc/migrations-loader.js#applyAll / #planAll).
 *
 * CEILING (stated, not implied): ONLY the fixture product is exercised. No portfolio product's repository is opened or
 * migrated. Portfolio coverage (test 6) classifies each registry product from its RECORDED registry version against
 * the loader's migration chain; a product that cannot reach this migration must be RECORDED not-live with its
 * registry line (runtime/S-OS-06/portfolio-coverage.json). With no portfolio registry on the machine, test 6 covers
 * zero products and says so in its diagnostic.
 *
 * FIXTURE: fixtureSeed() below is the ONE source of the fake 1.2.0 product shell. Every run re-materializes it at
 * runtime/S-OS-06/fixture-product/ (the evidence copy; runtime/ is never committed) and composes TEMP roots from that
 * copy plus the real _mc/BASELINE placed where 1.2.0 shipped it (_<legacy>/BASELINE/). The real tree is never migrated.
 *   (1) real update ordering — the 2.0.0 files are already copied and the update holds .mc/transactions/active.lock:
 *       layout + settings + skills migrate, the product BOOTS (and did not before), the update's lock is untouched,
 *       the stale legacy lock is never moved/deleted, a product-modified legacy skill is never clobbered
 *   (2) idempotent — a second run is a byte-identical no-op; an update.js alreadyApplied run skips all three
 *   (3) bare root (the migration alone) — everything moves, the stale lock is NOT promoted into .mc/transactions
 *   (4) an interrupted skill move resumes; plan() is read-only
 *   (5) fail-closed — an unparseable settings file halts the chain before 003
 *   (6) portfolio coverage (see CEILING)
 *
 *   node --test tests/regression/S-OS-06/migration.test.js
 */
const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const H = require("./falsifier-harness");

const ROOT = H.REAL_ROOT;
const loader = require(path.join(ROOT, "scripts", "mc", "migrations-loader.js"));
const transaction = require(path.join(ROOT, "scripts", "mc", "transaction.js"));
const mcDirs = require(path.join(ROOT, "scripts", "hooks", "lib", "mc-dirs.js"));
const mcEnv = require(path.join(ROOT, "scripts", "hooks", "lib", "mc-env.js"));
const registry = require(path.join(ROOT, "scripts", "portfolio", "registry.js"));

const LEG = H.SLUG; // the legacy slug
const UP = LEG.toUpperCase();
const NS = "warp"; // the legacy skill namespace
const FIXTURE_REL = "runtime/S-OS-06/fixture-product";
const FIXTURE_DIR = path.join(ROOT, ...FIXTURE_REL.split("/"));
const RECORD_REL = "runtime/S-OS-06/portfolio-coverage.json";
const MIGRATION_IDS = ["001-warpos-to-mc-layout", "002-warpos-to-mc-settings", "003-warpos-to-mc-skills"];
const UPDATE_TX = "2026-09-13T00-00-00-000Z-warp-update-pantry-pilot";
const STALE_TX = "tx-20260801-stale";
const ALIAS_RE = require(path.join(ROOT, "migrations", "1.2.0-to-2.0.0", "003-warpos-to-mc-skills.js")).ALIAS_RE;

const J = (o) => JSON.stringify(o, null, 2) + "\n";
const toPosix = (p) => String(p).split(path.sep).join("/");
const abs = (root, rel) => path.join(root, ...rel.split("/"));
const exists = (root, rel) => fs.existsSync(abs(root, rel));
const readBuf = (root, rel) => fs.readFileSync(abs(root, rel));
const readText = (root, rel) => fs.readFileSync(abs(root, rel), "utf8");
function write(root, rel, content) {
  fs.mkdirSync(path.dirname(abs(root, rel)), { recursive: true });
  fs.writeFileSync(abs(root, rel), content);
}

// ── the fixture seed (the only source) ────────────────────────────────────────────────────────────────────────────

const REGISTER = [
  `# ${UP}.md — Pantry Pilot framework gap register (fixture)`,
  "",
  "Product-owned register of framework gaps observed while building Pantry Pilot on the 1.2.0 framework.",
  "",
  "| ID | Observed | Gap | Status |",
  "|---|---|---|---|",
  "| G-001 | 2026-07-30 | `/sprint:full` close did not surface the stale transaction lock | open |",
  "| G-002 | 2026-08-01 | settings compile left a disabled hook note pointing at a moved script | open |",
  "",
].join("\n");

const SETTINGS = {
  _disabled_hooks: {
    "smart-context": {
      event: "UserPromptSubmit",
      hook: { type: "command", command: 'node "$CLAUDE_PROJECT_DIR/scripts/hooks/smart-context.js"' },
      disabledAt: "2026-07-09",
      reason: `Operator directive (Warp${"OS"}-v1 plan): prompt context injector off. Re-enable: run scripts/hooks/build.js + scripts/${LEG}/settings/compile.js.`,
    },
  },
  hooks: {
    SessionStart: [
      {
        hooks: [
          { type: "command", command: 'node "$CLAUDE_PROJECT_DIR/scripts/hooks/session-start.js"' },
          { type: "command", command: `node "$CLAUDE_PROJECT_DIR/scripts/${LEG}/provider-smoke.js" --quiet` },
        ],
        matcher: "",
      },
    ],
    PreToolUse: [{ hooks: [{ type: "command", command: 'node "$CLAUDE_PROJECT_DIR/scripts/hooks/framework-manifest-guard.js"' }], matcher: "Bash" }],
  },
  env: {
    CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
    [`${UP}_DISPATCH_BACKGROUND`]: "1",
    [`${UP}_PORTFOLIO_REGISTRY`]: `~/.${LEG}/portfolio.json`,
    [`${UP}_MANIFEST_GUARD`]: "on",
    MC_MANIFEST_GUARD: "on",
    [`${UP}_SMOKE_MODE`]: "strict",
    MC_SMOKE_MODE: "lenient",
  },
  permissions: {
    allow: [
      `Bash(${UP}_DISPATCH_BACKGROUND=1 node scripts/dispatch-claude.js *)`,
      `Write(_${LEG}/templates/**)`,
      `Write(.${LEG}/transactions/**)`,
      `Read(~/.${LEG}/portfolio.json)`,
      `Bash(node scripts/${LEG}/snapshot-installed.js)`,
    ],
  },
  _compiledBy: `${LEG}/settings-compiler/v1`,
};

const SKILL_UPDATE_1_2_0 = [
  "---",
  'description: "Update this project\'s framework install to a newer release (1.2.0 skill body)."',
  "---",
  "",
  `# /${NS}:update`,
  "",
  `Run \`/${NS}:check\` first, then \`/${NS}:update --to <version>\`. Stale installs: \`/scan:${LEG}-staleness\`.`,
  `Outbound changes are \`/${NS}:promote\`'s job. Source: .claude/commands/${NS}/update.md`,
  "",
].join("\n");

const SKILL_CHECK_MODIFIED = [
  "---",
  'description: "Check framework health (Pantry Pilot local edit: also verifies the pantry seed data)."',
  "---",
  "",
  `# /${NS}:check — Pantry Pilot variant`,
  "",
  `Runs the stock checks, then \`/scan:pantry-audit\`. Follow with \`/${NS}:update\` when stale.`,
  "",
].join("\n");

const SKILL_PANTRY_SYNC = [
  "---",
  'description: "Product-owned skill in the legacy namespace: sync the pantry catalog, then update."',
  "---",
  "",
  `# /${NS}:pantry-sync`,
  "",
  `Sync the catalog, then run \`/${NS}:update\` and \`/${NS}:check\`; audit with \`/scan:${LEG}-staleness\`.`,
  `\`/${NS}:promote\` is not ours to call.`,
  "",
].join("\n");

const SKILL_STALENESS_1_2_0 = [
  "---",
  'description: "Report stale framework files (1.2.0 skill body)."',
  "---",
  "",
  `# /scan:${LEG}-staleness`,
  "",
  `Compares the install against the release capsule; remediation is \`/${NS}:update\`.`,
  "",
].join("\n");

function fixtureSeed() {
  return {
    "README.md": [
      "# S-OS-06 fixture product — a FAKE pre-2.0.0 (1.2.0) install",
      "",
      "GENERATED — do not edit. `tests/regression/S-OS-06/migration.test.js` re-materializes this directory from its",
      "`fixtureSeed()` on every run (the seed is the only source; runtime/ is never committed). Gate G5, T4 stage C.",
      "",
      "| Seed path | Simulates |",
      "|---|---|",
      `| \`_${LEG}/MANIFEST.json\`, \`_${LEG}/settings/defaults.json\` | the 1.2.0 framework-owned root (the test adds \`_${LEG}/BASELINE/\` from the real \`_mc/BASELINE\`) |`,
      `| \`.${LEG}/audit/\`, \`.${LEG}/transactions/${STALE_TX}/\` | 1.2.0 per-install state (an interrupted transaction journal) |`,
      `| \`.${LEG}/transactions/active.lock\` | a STALE 1.2.0 transaction lock (never moved into \`.mc/\`, never deleted) |`,
      `| \`${UP}.md\` | the product's legacy gap register |`,
      `| \`.claude/settings.json\` | 1.2.0 settings: legacy hook wiring, \`${UP}_*\` env keys (one identical pair, one divergent pair), legacy permission rules, a HOME-anchored legacy path |`,
      `| \`.claude/commands/${NS}/\`, \`.claude/commands/scan/${LEG}-*.md\` | installed legacy skills: a stock body, a product-modified body, a product-owned skill, a non-skill file |`,
      "| `.claude/framework-installed.json` | `installedVersion: 1.2.0` |",
      "| `gitignore.seed` | the product `.gitignore` (a non-dot name so it does not ignore this seed's own state dir) |",
      "",
      "Ceiling: only this fixture is exercised. Portfolio products are classified from their recorded registry",
      "version; none of their repositories are opened.",
      "",
    ].join("\n"),
    [`${UP}.md`]: REGISTER,
    ".claude/framework-installed.json": J({ installedVersion: "1.2.0", migrationsApplied: [], _fixture: `S-OS-06 T4 fake pre-2.0.0 install (${FIXTURE_REL}/README.md)` }),
    ".claude/settings.json": J(SETTINGS),
    [`_${LEG}/MANIFEST.json`]: J({
      schema: "fixture/ownership-manifest/v1",
      frameworkVersion: "1.2.0",
      product: "pantry-pilot",
      paths: { [`_${LEG}/BASELINE/`]: "framework", [`_${LEG}/settings/defaults.json`]: "framework", [`${UP}.md`]: "project", [`.${LEG}/`]: "runtime" },
    }),
    [`_${LEG}/settings/defaults.json`]: J({ _compiledBy: `${LEG}/settings-compiler/v1`, env: { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1" } }),
    [`.${LEG}/transactions/active.lock`]: `${STALE_TX}\n`,
    [`.${LEG}/transactions/${STALE_TX}/plan.json`]: J({ fromVersion: "1.1.0", toVersion: "1.2.0", _fixture: "an interrupted 1.2.0 transaction journal" }),
    [`.${LEG}/audit/manifest-guard.log`]: "2026-08-01T10:12:03Z blocked git commit: framework-manifest.json not staged (fixture)\n",
    "gitignore.seed": `node_modules/\n.env\n.claude/runtime/\n.${LEG}/\n`,
    [`.claude/commands/${NS}/update.md`]: SKILL_UPDATE_1_2_0,
    [`.claude/commands/${NS}/check.md`]: SKILL_CHECK_MODIFIED,
    [`.claude/commands/${NS}/pantry-sync.md`]: SKILL_PANTRY_SYNC,
    [`.claude/commands/${NS}/NOTES.txt`]: "not a skill — a stray note the migration must ignore\n",
    [`.claude/commands/scan/${LEG}-staleness.md`]: SKILL_STALENESS_1_2_0,
    ".claude/commands/scan/pantry-audit.md": '---\ndescription: "Product-owned audit skill (unrelated to the rename)."\n---\n\n# /scan:pantry-audit\n',
  };
}

// ── helpers ───────────────────────────────────────────────────────────────────────────────────────────────────────

function walk(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, base));
    else out.push(toPosix(path.relative(base, p)));
  }
  return out.sort();
}

/** { rel: sha256 } over every file under root (dot dirs included). */
function snapshot(root) {
  const snap = {};
  for (const rel of walk(root)) snap[rel] = crypto.createHash("sha256").update(readBuf(root, rel)).digest("hex");
  return snap;
}

function rmrf(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    /* temp dir; best effort on Windows file locks */
  }
}

/** Re-materialize the evidence copy from the seed and prove it is exactly the seed. */
function materializeFixture() {
  const seed = fixtureSeed();
  const tmp = `${FIXTURE_DIR}.tmp-${process.pid}`;
  rmrf(tmp);
  for (const [rel, content] of Object.entries(seed)) write(tmp, rel, content);
  rmrf(FIXTURE_DIR);
  fs.renameSync(tmp, FIXTURE_DIR);
  assert.deepStrictEqual(walk(FIXTURE_DIR), Object.keys(seed).sort(), `${FIXTURE_REL} is exactly the seed (no stray files)`);
  for (const [rel, content] of Object.entries(seed)) assert.strictEqual(readText(FIXTURE_DIR, rel), content, `${FIXTURE_REL}/${rel} == seed`);
  return seed;
}

const SEED = materializeFixture();

/** A TEMP product root: the fixture shell + the real _mc/BASELINE where 1.2.0 shipped it (+ the 2.0.0 copy when overlay). */
function compose({ overlay }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sos06-migration-"));
  fs.cpSync(FIXTURE_DIR, dir, { recursive: true });
  fs.renameSync(path.join(dir, "gitignore.seed"), path.join(dir, ".gitignore"));
  fs.cpSync(abs(ROOT, "_mc/BASELINE"), path.join(dir, `_${LEG}`, "BASELINE"), { recursive: true });
  if (overlay) {
    // What update.js#applyUpdateDecisions has ALREADY done when migrations run: the 2.0.0 framework files are copied
    // (canonical skills + the shipped deprecated aliases over the stock legacy bodies; the product-modified legacy
    // check.md is a conflict the update did not overwrite) and the update holds its own transaction lock.
    for (const rel of [
      "_mc/MANIFEST.json",
      "_mc/settings/defaults.json",
      ".claude/commands/mc/update.md",
      ".claude/commands/mc/check.md",
      ".claude/commands/scan/mc-staleness.md",
      `.claude/commands/${NS}/update.md`,
      `.claude/commands/scan/${LEG}-staleness.md`,
    ]) {
      write(dir, rel, readBuf(ROOT, rel));
    }
    fs.cpSync(abs(ROOT, "_mc/BASELINE"), path.join(dir, "_mc", "BASELINE"), { recursive: true });
    write(dir, ".mc/transactions/active.lock", UPDATE_TX);
    write(dir, `.mc/transactions/${UPDATE_TX}/header.json`, J({ txId: UPDATE_TX, fromVersion: "1.2.0", toVersion: "2.0.0" }));
  }
  return dir;
}

function withRoot(opts, fn) {
  const dir = compose(opts);
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => rmrf(dir));
}

const runAll = (root, extra) => loader.applyAll("1.2.0", "2.0.0", { targetRoot: root, ...(extra || {}) });
const byId = (log) => Object.fromEntries(log.map((e) => [e.migration, e]));
const statuses = (log) => log.map((e) => `${e.migration}:${e.skipped ? "skipped" : e.result.status}`);

/**
 * The migrated product BOOTS: its settings, manifest, register, transaction lock and skills all load/resolve on the
 * mc@2.0.0 names against the real 2.0.0 framework. -> the list of problems ([] = boots).
 */
function bootProblems(root, { keptSkills = [] } = {}) {
  const problems = [];
  let settings;
  try {
    settings = JSON.parse(readText(root, ".claude/settings.json"));
  } catch (e) {
    return [`.claude/settings.json does not load: ${e.message}`];
  }
  const wiring = JSON.stringify({ hooks: settings.hooks, _disabled_hooks: settings._disabled_hooks });
  const scripts = [...wiring.matchAll(/\$CLAUDE_PROJECT_DIR\/([^"\s\\]+\.js)/g)].map((m) => m[1]);
  if (scripts.length === 0) problems.push("no hook script wiring found (vacuous boot)");
  for (const rel of scripts) if (!exists(ROOT, rel)) problems.push(`hook script ${rel} does not exist in the 2.0.0 framework`);
  const env = settings.env || {};
  for (const k of Object.keys(env)) {
    if (!k.startsWith(`${UP}_`)) continue;
    const twin = `MC_${k.slice(UP.length + 1)}`;
    if (!(twin in env)) problems.push(`env ${k} is legacy-only (no ${twin})`);
  }
  if (mcEnv.readEnv("DISPATCH_BACKGROUND", env) !== "1") problems.push("MC_DISPATCH_BACKGROUND does not resolve to 1");

  for (const [current, legacy] of [["_mc", `_${LEG}`], [".mc", `.${LEG}`], ["MC.md", `${UP}.md`]]) {
    const r = mcDirs.resolvePair(path.join(root, current), path.join(root, legacy), { warn: false });
    if (r.deprecated || r.source !== "current") problems.push(`${current} resolves to the legacy ${legacy} (state ${r.state})`);
  }
  const manifestPath = mcDirs.resolveProjectPath(root, "_mc/MANIFEST.json", { warn: false });
  if (manifestPath !== abs(root, "_mc/MANIFEST.json")) problems.push("_mc/MANIFEST.json resolves to a legacy fallback");
  else {
    try {
      JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch (e) {
      problems.push(`_mc/MANIFEST.json does not load: ${e.message}`);
    }
  }
  try {
    JSON.parse(readText(root, ".claude/framework-installed.json"));
  } catch (e) {
    problems.push(`.claude/framework-installed.json does not load: ${e.message}`);
  }
  const lock = transaction.checkActiveLock(root);
  if (lock.locked && lock.existingTxId === STALE_TX) problems.push("the stale 1.2.0 transaction lock blocks .mc/transactions");

  const skillDirs = [
    [`.claude/commands/${NS}`, (name) => `.claude/commands/mc/${name}`],
    [".claude/commands/scan", (name) => (name.startsWith(`${LEG}-`) ? `.claude/commands/scan/mc-${name.slice(LEG.length + 1)}` : null)],
  ];
  for (const [dirRel, canonicalOf] of skillDirs) {
    if (!exists(root, dirRel)) continue;
    for (const name of fs.readdirSync(abs(root, dirRel))) {
      const rel = `${dirRel}/${name}`;
      const canonical = canonicalOf(name);
      if (!canonical || !name.endsWith(".md")) continue;
      if (!exists(root, canonical)) problems.push(`legacy skill ${rel} has no canonical ${canonical}`);
      else if (!ALIAS_RE.test(readText(root, rel)) && !keptSkills.includes(rel)) problems.push(`legacy skill ${rel} is neither a deprecated alias nor a reported keep`);
    }
  }
  return problems;
}

function expectedSettings() {
  return {
    ...SETTINGS,
    _disabled_hooks: {
      "smart-context": { ...SETTINGS._disabled_hooks["smart-context"], reason: SETTINGS._disabled_hooks["smart-context"].reason.replace(`scripts/${LEG}/`, "scripts/mc/") },
    },
    hooks: JSON.parse(JSON.stringify(SETTINGS.hooks).replace(`scripts/${LEG}/provider-smoke.js`, "scripts/mc/provider-smoke.js")),
    env: {
      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
      MC_DISPATCH_BACKGROUND: "1",
      MC_PORTFOLIO_REGISTRY: `~/.${LEG}/portfolio.json`, // HOME-anchored legacy state: never rewritten
      MC_MANIFEST_GUARD: "on", // the identical legacy twin is dropped
      [`${UP}_SMOKE_MODE`]: "strict", // divergent pair: both kept, MC_ wins at read time
      MC_SMOKE_MODE: "lenient",
    },
    permissions: {
      allow: [
        `Bash(${UP}_DISPATCH_BACKGROUND=1 node scripts/dispatch-claude.js *)`,
        "Bash(MC_DISPATCH_BACKGROUND=1 node scripts/dispatch-claude.js *)",
        `Write(_${LEG}/templates/**)`,
        "Write(_mc/templates/**)",
        `Write(.${LEG}/transactions/**)`,
        "Write(.mc/transactions/**)",
        `Read(~/.${LEG}/portfolio.json)`,
        `Bash(node scripts/${LEG}/snapshot-installed.js)`,
        "Bash(node scripts/mc/snapshot-installed.js)",
      ],
    },
    _compiledBy: "mc/settings-compiler/v1",
  };
}

// ── (1) + (2): real update ordering, boot, adversarial locks, idempotency ────────────────────────────────────────

test("migration (1): real update ordering — layout + settings + skills migrate, the product boots, locks are respected", async (t) => {
  await withRoot({ overlay: true }, async (root) => {
    assert.deepStrictEqual(
      loader.listMigrations("1.2.0", "2.0.0").map((f) => path.basename(f, ".js")),
      MIGRATION_IDS,
      "the loader resolves exactly 001/002/003 for 1.2.0 -> 2.0.0"
    );
    const baselineFiles = walk(abs(ROOT, "_mc/BASELINE")).length;
    assert.ok(baselineFiles > 50, `non-vacuous: the real _mc/BASELINE is composed in (${baselineFiles} files)`);

    const before = bootProblems(root);
    assert.ok(before.length >= 4, `baseline-first: the UNMIGRATED product must not boot on the mc names (got ${JSON.stringify(before)})`);
    assert.ok(before.some((p) => p.includes(`scripts/${LEG}/provider-smoke.js`)), "the legacy hook script is a boot problem before migration");

    const log = await runAll(root);
    assert.deepStrictEqual(statuses(log), MIGRATION_IDS.map((id) => `${id}:migrated`), JSON.stringify(log, null, 2).slice(0, 3000));
    const r = byId(log);

    // 001 layout
    const l = r["001-warpos-to-mc-layout"].result;
    assert.ok(!exists(root, `_${LEG}`), `_${LEG}/ is gone`);
    assert.ok(!exists(root, `${UP}.md`), `${UP}.md is gone`);
    assert.strictEqual(readText(root, "MC.md"), REGISTER, "MC.md carries the product register byte-for-byte");
    assert.strictEqual(l.dedupedIdentical.filter((p) => p.startsWith(`_${LEG}/BASELINE/`)).length, baselineFiles, "the identical 1.2.0 BASELINE copy is dropped (lossless)");
    assert.deepStrictEqual(l.backedUp.map((b) => b.from), [`_${LEG}/MANIFEST.json`, `_${LEG}/settings/defaults.json`], "divergent framework copies are backed up, never clobbering the 2.0.0 ones");
    for (const rel of [`_${LEG}/MANIFEST.json`, `_${LEG}/settings/defaults.json`]) {
      assert.strictEqual(readText(root, `.mc/migration-backup/1.2.0-to-2.0.0/${rel}`), SEED[rel], `backup of ${rel} is byte-identical`);
    }
    for (const rel of ["_mc/MANIFEST.json", "_mc/settings/defaults.json"]) assert.ok(readBuf(root, rel).equals(readBuf(ROOT, rel)), `${rel}: the 2.0.0 copy wins, untouched`);
    assert.strictEqual(readText(root, `.mc/audit/manifest-guard.log`), SEED[`.${LEG}/audit/manifest-guard.log`], "audit state moved");
    assert.strictEqual(readText(root, `.mc/transactions/${STALE_TX}/plan.json`), SEED[`.${LEG}/transactions/${STALE_TX}/plan.json`], "the stale tx journal moved intact");
    // adversarial: the update's OWN lock is never clobbered; the stale legacy lock is never moved or deleted
    assert.strictEqual(readText(root, ".mc/transactions/active.lock"), UPDATE_TX, "the 2.0.0 update's active.lock is untouched");
    assert.deepStrictEqual(walk(abs(root, `.${LEG}`)), ["transactions/active.lock"], `only the stale lock remains under .${LEG}/`);
    assert.strictEqual(readText(root, `.${LEG}/transactions/active.lock`), SEED[`.${LEG}/transactions/active.lock`], "the stale lock is byte-identical, in place");
    assert.deepStrictEqual(l.keptLegacy.map((k) => k.path), [`.${LEG}/transactions/active.lock`]);
    const lock = transaction.checkActiveLock(root);
    assert.strictEqual(lock.existingTxId, UPDATE_TX, "transaction.js sees the update's own lock, not the stale one");
    const ignore = readText(root, ".gitignore").split(/\r?\n/);
    assert.ok(ignore.includes(".mc/") && ignore.includes(`.${LEG}/`), ".mc/ is ignored (legacy line kept)");

    // 002 settings
    assert.deepStrictEqual(JSON.parse(readText(root, ".claude/settings.json")), expectedSettings(), "settings rewired");
    assert.strictEqual(mcEnv.readEnv("SMOKE_MODE", JSON.parse(readText(root, ".claude/settings.json")).env), "lenient", "a divergent pair resolves MC_ first");

    // 003 skills
    const s = r["003-warpos-to-mc-skills"].result;
    assert.deepStrictEqual(s.keptAliases.map((k) => k.path), [`.claude/commands/${NS}/update.md`, `.claude/commands/scan/${LEG}-staleness.md`], "shipped aliases kept");
    assert.deepStrictEqual(s.kept.map((k) => k.path), [`.claude/commands/${NS}/check.md`], "the product-modified legacy skill is reported, not clobbered");
    assert.deepStrictEqual(s.moved.map((m) => `${m.from} -> ${m.to}`), [`.claude/commands/${NS}/pantry-sync.md -> .claude/commands/mc/pantry-sync.md`]);
    assert.deepStrictEqual(s.ignored.map((i) => i.path), [`.claude/commands/${NS}/NOTES.txt`]);
    assert.strictEqual(readText(root, `.claude/commands/${NS}/check.md`), SKILL_CHECK_MODIFIED, "product-modified legacy skill byte-identical");
    assert.strictEqual(readText(root, `.claude/commands/${NS}/NOTES.txt`), SEED[`.claude/commands/${NS}/NOTES.txt`]);
    assert.strictEqual(readText(root, ".claude/commands/scan/pantry-audit.md"), SEED[".claude/commands/scan/pantry-audit.md"], "unrelated skills untouched");
    for (const rel of [".claude/commands/mc/update.md", ".claude/commands/mc/check.md", ".claude/commands/scan/mc-staleness.md", `.claude/commands/${NS}/update.md`, `.claude/commands/scan/${LEG}-staleness.md`]) {
      assert.ok(readBuf(root, rel).equals(readBuf(ROOT, rel)), `${rel}: the 2.0.0 copy is untouched`);
    }
    assert.strictEqual(
      readText(root, ".claude/commands/mc/pantry-sync.md"),
      SKILL_PANTRY_SYNC.replaceAll(`/${NS}:pantry-sync`, "/mc:pantry-sync")
        .replaceAll(`/${NS}:update`, "/mc:update")
        .replaceAll(`/${NS}:check`, "/mc:check")
        .replaceAll(`/scan:${LEG}-staleness`, "/scan:mc-staleness"),
      "the moved body's resolvable invocations are mc:, the unresolvable one stays verbatim"
    );
    assert.ok(readText(root, ".claude/commands/mc/pantry-sync.md").includes(`/${NS}:promote`), "unresolvable invocation kept verbatim");
    const stub = readText(root, `.claude/commands/${NS}/pantry-sync.md`);
    assert.match(stub, ALIAS_RE, "the legacy product skill is now a deprecated alias");
    assert.ok(stub.includes("/mc:pantry-sync $ARGUMENTS"), "the alias forwards to the canonical skill");

    // boots
    assert.deepStrictEqual(bootProblems(root, { keptSkills: [`.claude/commands/${NS}/check.md`] }), [], "the migrated product boots on the mc names");

    // (2) idempotent: a second run is a byte-identical no-op; an update.js alreadyApplied run skips all three
    const snap = snapshot(root);
    const again = await runAll(root);
    assert.deepStrictEqual(statuses(again), MIGRATION_IDS.map((id) => `${id}:noop`), "second run: every migration is a no-op");
    assert.deepStrictEqual(snapshot(root), snap, "second run changed no byte");
    const skipped = await runAll(root, { alreadyApplied: new Set(MIGRATION_IDS) });
    assert.deepStrictEqual(statuses(skipped), MIGRATION_IDS.map((id) => `${id}:skipped`));
    assert.deepStrictEqual(snapshot(root), snap);

    t.diagnostic(
      `G5 overlay: files=${Object.keys(snap).length} moved=${l.moved.length} deduped=${l.dedupedIdentical.length} backedUp=${l.backedUp.length} ` +
        `keptLegacy=${l.keptLegacy.length} env=${r["002-warpos-to-mc-settings"].result.files[0].env.length} skillsMoved=${s.moved.length} ` +
        `aliasesKept=${s.keptAliases.length} skillsKept=${s.kept.length} bootProblemsBefore=${before.length} bootProblemsAfter=0 secondRun=noop`
    );
  });
});

// ── (3) bare root ─────────────────────────────────────────────────────────────────────────────────────────────────

test("migration (3): bare root — everything moves, the stale lock is NOT promoted, second run is a no-op", async (t) => {
  await withRoot({ overlay: false }, async (root) => {
    const log = await runAll(root);
    assert.deepStrictEqual(statuses(log), MIGRATION_IDS.map((id) => `${id}:migrated`));
    assert.ok(!exists(root, `_${LEG}`) && !exists(root, `${UP}.md`));
    assert.strictEqual(readText(root, "_mc/MANIFEST.json"), SEED[`_${LEG}/MANIFEST.json`], "_mc/ took the moved framework root");
    assert.strictEqual(walk(abs(root, "_mc/BASELINE")).length, walk(abs(ROOT, "_mc/BASELINE")).length);
    assert.ok(!exists(root, ".mc/migration-backup"), "nothing diverged, nothing backed up");
    assert.ok(!exists(root, ".mc/transactions/active.lock"), "the stale lock was NOT promoted into .mc/transactions");
    assert.strictEqual(transaction.checkActiveLock(root).locked, false, "a new 2.0.0 transaction is not blocked by the stale lock");
    assert.strictEqual(readText(root, `.${LEG}/transactions/active.lock`), SEED[`.${LEG}/transactions/active.lock`], "the stale lock stays in place, intact");
    assert.strictEqual(readText(root, `.mc/transactions/${STALE_TX}/plan.json`), SEED[`.${LEG}/transactions/${STALE_TX}/plan.json`]);

    const s = byId(log)["003-warpos-to-mc-skills"].result;
    assert.deepStrictEqual(s.keptAliases, []);
    assert.deepStrictEqual(s.kept, []);
    assert.deepStrictEqual(s.moved.map((m) => m.to).sort(), [".claude/commands/mc/check.md", ".claude/commands/mc/pantry-sync.md", ".claude/commands/mc/update.md", ".claude/commands/scan/mc-staleness.md"]);
    assert.strictEqual(
      readText(root, ".claude/commands/mc/update.md"),
      SKILL_UPDATE_1_2_0.replaceAll(`/${NS}:check`, "/mc:check")
        .replaceAll(`/${NS}:update`, "/mc:update")
        .replaceAll(`/scan:${LEG}-staleness`, "/scan:mc-staleness")
        .replaceAll(`commands/${NS}/update.md`, "commands/mc/update.md"),
      "stock body moved with every resolvable token + command path rewritten"
    );
    for (const rel of [`.claude/commands/${NS}/update.md`, `.claude/commands/${NS}/check.md`, `.claude/commands/${NS}/pantry-sync.md`, `.claude/commands/scan/${LEG}-staleness.md`]) {
      assert.match(readText(root, rel), ALIAS_RE, `${rel} is a deprecated alias`);
    }
    assert.deepStrictEqual(bootProblems(root), [], "the bare-migrated product boots");

    const snap = snapshot(root);
    const again = await runAll(root);
    assert.deepStrictEqual(statuses(again), MIGRATION_IDS.map((id) => `${id}:noop`));
    assert.deepStrictEqual(snapshot(root), snap, "second run changed no byte");
    t.diagnostic(`G5 bare: skillsMoved=${s.moved.length} staleLockPromoted=false secondRun=noop`);
  });
});

// ── (4) interrupted skill move resumes; plan() is read-only ──────────────────────────────────────────────────────

test("migration (4): an interrupted skill move resumes; plan() is read-only", async () => {
  await withRoot({ overlay: false }, async (root) => {
    const planSnap = snapshot(root);
    const planned = await loader.planAll("1.2.0", "2.0.0", { targetRoot: root });
    assert.deepStrictEqual(planned.map((p) => p.migration), MIGRATION_IDS);
    for (const p of planned) assert.ok(p.ops.length > 0 && !p.ops.some((o) => o.op === "error"), `${p.migration} plans real ops: ${JSON.stringify(p.ops).slice(0, 400)}`);
    assert.deepStrictEqual(snapshot(root), planSnap, "plan() wrote nothing");

    await runAll(root);
    // Crash between 003's two writes: the canonical body was written, the legacy alias was not.
    write(root, `.claude/commands/${NS}/update.md`, SKILL_UPDATE_1_2_0);
    const resumed = await runAll(root);
    assert.deepStrictEqual(statuses(resumed), ["001-warpos-to-mc-layout:noop", "002-warpos-to-mc-settings:noop", "003-warpos-to-mc-skills:migrated"]);
    const s = byId(resumed)["003-warpos-to-mc-skills"].result;
    assert.deepStrictEqual(s.aliased.map((a) => a.path), [`.claude/commands/${NS}/update.md`]);
    assert.match(s.aliased[0].reason, /interrupted move/);
    assert.match(readText(root, `.claude/commands/${NS}/update.md`), ALIAS_RE);
    const snap = snapshot(root);
    assert.deepStrictEqual(statuses(await runAll(root)), MIGRATION_IDS.map((id) => `${id}:noop`));
    assert.deepStrictEqual(snapshot(root), snap);
  });
});

// ── (5) fail-closed ──────────────────────────────────────────────────────────────────────────────────────────────

test("migration (5): an unparseable settings file halts the chain before 003 (update.js rolls back)", async () => {
  await withRoot({ overlay: false }, async (root) => {
    write(root, ".claude/settings.json", "{ not json");
    const log = await runAll(root);
    assert.deepStrictEqual(log.map((e) => e.migration), MIGRATION_IDS.slice(0, 2), "003 never ran");
    assert.strictEqual(log[1].result.ok, false);
    assert.strictEqual(log[1].halted, true);
    assert.match(log[1].result.reason, /not valid JSON/);
    assert.strictEqual(readText(root, ".claude/settings.json"), "{ not json", "the unparseable file is not rewritten");
    assert.ok(!exists(root, ".claude/commands/mc"), "skills untouched");
  });
});

// ── (6) portfolio coverage ───────────────────────────────────────────────────────────────────────────────────────

/** A registry entry as a stable one-line record: keys sorted, local paths / remote URLs redacted. */
function registryLine(entry) {
  const out = {};
  for (const k of Object.keys(entry).sort()) out[k] = k === "repo_path" || k === "github_url" ? (entry[k] == null ? entry[k] : "<redacted>") : entry[k];
  return JSON.stringify(out);
}

test("migration (6): every portfolio-registry product upgrades via this migration OR is recorded not-live (ceiling: fixture only)", (t) => {
  const migFiles = loader.listMigrations("1.2.0", "2.0.0").map((f) => toPosix(path.relative(ROOT, f)));
  assert.strictEqual(migFiles.length, 3);

  const rp = registry.registryPath();
  if (!fs.existsSync(rp)) {
    t.diagnostic("CEILING: no portfolio registry on this machine — 0 products classified; only the fixture product is exercised");
    return;
  }
  const doc = JSON.parse(fs.readFileSync(rp, "utf8").replace(/^﻿/, ""));
  const products = Object.entries(doc.products || {});
  assert.ok(exists(ROOT, RECORD_REL), `the portfolio registry lists ${products.length} product(s) but ${RECORD_REL} is missing — record each product's disposition, never infer it silently`);
  const record = JSON.parse(readText(ROOT, RECORD_REL));
  const recorded = record.products || {};

  const summary = { migrates: [], notLive: [] };
  for (const [slug, entry] of products) {
    const version = entry.mc_version || entry[`${LEG}_version`] || null;
    let chain = [];
    try {
      chain = loader.listMigrationsBetween(version, "2.0.0").map((f) => toPosix(path.relative(ROOT, f)));
    } catch {
      chain = []; // an unparseable/absent version cannot reach the migration
    }
    const reaches = migFiles.every((f) => chain.includes(f));
    const rec = recorded[slug];
    assert.ok(rec, `portfolio product ${slug} (registry version ${version}) has no coverage record in ${RECORD_REL}`);
    if (reaches) {
      assert.strictEqual(rec.disposition, "migrates", `${slug}: the loader chain from ${version} reaches 1.2.0-to-2.0.0, record says ${rec.disposition}`);
      summary.migrates.push(`${slug}@${version}`);
    } else {
      assert.strictEqual(rec.disposition, "not-live", `${slug}: no migration chain from ${version} reaches 2.0.0, so it must be RECORDED not-live (record says ${rec.disposition})`);
      assert.strictEqual(rec.registryLine, registryLine(entry), `${slug}: the recorded registry line is stale — the registry entry changed since it was recorded not-live`);
      summary.notLive.push(`${slug}@${version}`);
    }
  }
  const stale = Object.keys(recorded).filter((slug) => !(doc.products || {})[slug]);
  assert.deepStrictEqual(stale, [], "the coverage record names no product the registry no longer lists");
  t.diagnostic(`CEILING: only the fixture product is exercised. portfolio products=${products.length} migrates=[${summary.migrates}] recorded-not-live=[${summary.notLive}]`);
});
