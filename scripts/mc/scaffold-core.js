#!/usr/bin/env node

/**
 * scripts/mc/scaffold-core.js — shared product-scaffold core.
 *
 * SP-20260525-019 / T-20260525-219.
 *
 * THE EXTRACTION: this module holds the product-scaffold logic that previously
 * lived inline in scripts/warp-setup.js (added by SP-20260525-018 + the
 * SP-20260525-003 _mc/ source-mirror migration). warp-setup.js now requires
 * this module and calls these functions in place of the inline blocks. The goal
 * is a SINGLE shared scaffold core so other install/adopt entry points can reuse
 * the exact same product-scaffolding behavior without copy-pasting it.
 *
 * GUARDRAIL (T-219): this was a pure file MOVE, not a rewrite. The function
 * bodies are the same code, only relocated and parameterized (TARGET → target,
 * MC → mcRoot, the `log` reporter, and `shipManifest` passed in). No
 * registry keys, dir lists, or ordering changed. Idempotency (check-before-write
 * throughout) is preserved verbatim. The install matrix
 * (scripts/mc/test-install-matrix.js) is the regression guard proving the
 * extraction is behavior-preserving.
 *
 * WHY TWO ENTRY POINTS (not one): in warp-setup.js the four scaffold blocks are
 * NOT contiguous, and their ordering relative to other install steps is
 * load-bearing:
 *   - The paths.json / skeleton / ROADMAP blocks (A+B+C) run EARLY — the
 *     skeleton's `_requirements/01-design-system` dir is read later by the
 *     hook-config "missing tools" notice, so it must exist before that point.
 *   - The `_mc/` source-mirror (D) runs LATE — specifically AFTER the
 *     settings-compile check, which keys on whether `_mc/settings/
 *     defaults.json` exists. D is what creates that file, so running D earlier
 *     would flip the compile branch on a fresh install (a behavior change).
 * Merging A+B+C+D into one call site would therefore alter behavior. To keep
 * the move behavior-preserving, the core exposes:
 *   - scaffoldProduct(...)       → blocks A (paths.json) + B (skeleton) + C (ROADMAP)
 *   - populateMcMirror(...)  → block D (_mc/ source mirror)
 * warp-setup.js calls each at the exact site the inline block previously sat.
 *
 * All functions return an `installedDelta` so the caller can keep its `installed`
 * counter identical to the pre-extraction value (the inline blocks incremented a
 * shared `installed` variable).
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

// ── SKELETON_DIRS — the structure-parity seed zones (SP-20260525-018) ──
// Every dir /scan:mc-structure-parity declares, plus the _docs brief/clone
// homes. Lifted to module scope (was inline in scaffoldProduct) so the seed-zone
// PROVENANCE writer (views/populate-seed-provenance.js, SP-20260618-001/U2) reads
// the SAME list scaffoldProduct ensures — one source of truth for "what is a seed
// zone." Exported below.
const SKELETON_DIRS = [
  "_requirements/_audits", "_requirements/_index", "_requirements/_shared",
  "_requirements/_standards", "_requirements/00-canonical",
  "_requirements/01-design-system", "_requirements/02-copy-system",
  "_requirements/03-architecture", "_requirements/04-features",
  "_requirements/05-operations", "_requirements/06-security",
  "_requirements/07-testing", "_requirements/08-automation",
  "_docs", "_docs/briefs", "_docs/clones",
];

/**
 * scaffoldProduct — the EARLY scaffold bundle (blocks A + B + C).
 *
 * @param {object}   opts
 * @param {string}   opts.target       product root (was TARGET)
 * @param {string}   opts.mcRoot   canonical MC clone (was MC)
 * @param {function} opts.log          reporter, signature log(status, msg, detail?)
 * @returns {{ installedDelta: number }}
 */
function scaffoldProduct({ target, mcRoot, log }) {
  const TARGET = target;
  const MC = mcRoot;
  let installed = 0;

  // ── 5. Create paths.json ────────────────────────────────
  // Principle: paths.json is CREATED at install time, never ASSUMED to exist pre-install.
  // MC does not ship a paths.json — the installer builds it here so every client
  // project gets its own. To move a location, edit this object (and lib/paths.js fallback).
  const pathsFile = path.join(TARGET, ".claude/paths.json");
  // SP-20260525-018: source the product paths.json from the SINGLE registry
  // (framework/paths.registry.json) instead of a hardcoded map, so every
  // product gets ALL keys — sprint-orchestrator infra (sprintFullAutonomy,
  // sprintSchemas, …) and the _requirements zones — and stays in sync as the
  // registry grows. A-015-safe: keys live in the registry, never raw-inserted.
  // Idempotent: fresh install writes the full map; re-run backfills only
  // MISSING keys (operator values are never overwritten).
  const registryFile = path.join(TARGET, "framework", "paths.registry.json");
  let _registry = null;
  try {
    _registry = JSON.parse(fs.readFileSync(registryFile, "utf8"));
  } catch {
    /* registry not installed (older capsule) — fall back below */
  }
  const _regEntries = _registry ? _registry.paths || _registry : null;
  if (_regEntries) {
    // GATE-B 3c convergence (β beta-ceremony-freshpath-go-b089): generate paths.json via the SINGLE canonical
    // generator scripts/paths/build.js — the SAME one /mc:update runs (runGenerators) — instead of a forked
    // hand-rolled projection. The old inline map hardcoded `version: 3` (stale; build.js is v5), omitted
    // `$schema`, and included removedIn keys (re-adding the dead portfolioRegistry that build.js drops,
    // build.js:68), so a fresh install diverged from an upgraded tree at 3c. Delegating makes both byte-identical
    // by construction (proven on the preserved trees). build.js also (re)writes PATH_KEYS.md + paths.schema.json
    // — symmetric with the upgrade, deterministic. This fixes BOTH forks: the fresh create AND the upgrade's
    // scaffoldProduct backfill (both are THIS block) now route through build.js, so the dead key stays gone on
    // the upgrade side too. Falls back to an inline (removedIn-filtered, v5-header) projection only when build.js
    // is absent (very old capsule).
    const buildScript = path.join(TARGET, "scripts", "paths", "build.js");
    let built = false;
    if (fs.existsSync(buildScript)) {
      const r = spawnSync(process.execPath, [buildScript], { cwd: TARGET, encoding: "utf8" });
      if (r.status === 0) {
        built = true;
        log("ok", "Generated paths.json via scripts/paths/build.js (canonical generator)");
        installed++;
      } else {
        log("warn", `paths/build.js exited ${r.status} — inline fallback. stderr: ${(r.stderr || "").trim().slice(0, 200)}`);
      }
    }
    if (!built) {
      // Fallback (build.js absent/failed): inline registry projection, v5 header + removedIn EXCLUDED so it
      // stays as close to the canonical output as possible.
      const flat = { $schema: "mc/paths/v5", version: 5 };
      for (const [key, entry] of Object.entries(_regEntries)) {
        if (entry && typeof entry === "object" && typeof entry.path === "string" && !entry.removedIn) {
          flat[key] = entry.path;
        }
      }
      if (!fs.existsSync(pathsFile)) {
        fs.writeFileSync(pathsFile, JSON.stringify(flat, null, 2) + "\n");
        log("ok", `Created paths.json (inline fallback, ${Object.keys(flat).length} keys)`);
        installed++;
      } else {
        const existing = JSON.parse(fs.readFileSync(pathsFile, "utf8"));
        let added = 0;
        for (const [k, v] of Object.entries(flat)) {
          if (!(k in existing)) {
            existing[k] = v;
            added++;
          }
        }
        if (added > 0) {
          fs.writeFileSync(pathsFile, JSON.stringify(existing, null, 2) + "\n");
          log("ok", `Backfilled paths.json inline fallback (+${added} keys)`);
        }
      }
    }
    // Scaffold every runtime dir the registry declares (kind=dir) so the sprint
    // orchestrator + zones exist on disk. Idempotent.
    for (const entry of Object.values(_regEntries)) {
      if (entry && typeof entry === "object" && entry.kind === "dir" && typeof entry.path === "string") {
        try {
          fs.mkdirSync(path.join(TARGET, entry.path), { recursive: true });
        } catch {
          /* best-effort */
        }
      }
    }
  } else if (!fs.existsSync(pathsFile)) {
    // Fallback when the registry is absent (pre-0.8 capsule): minimal map.
    const paths = {
      version: 3,
      events: ".claude/project/events",
      memory: ".claude/project/memory",
      reference: ".claude/project/reference",
      runtime: ".claude/runtime",
      agents: ".claude/agents",
      commands: ".claude/commands",
      manifest: ".claude/manifest.json",
      settings: ".claude/settings.json",
      eventsFile: ".claude/project/events/events.jsonl",
      learningsFile: ".claude/project/memory/learnings.jsonl",
    };
    fs.writeFileSync(pathsFile, JSON.stringify(paths, null, 2) + "\n");
    log("warn", "Created minimal paths.json (registry not found)");
    installed++;
  }

  // ── 5b. Structure-parity skeleton + _docs zones (SP-20260525-018) ──
  // Guarantee every dir /scan:mc-structure-parity declares, plus the
  // _docs brief/clone homes, exist. Idempotent; .gitkeep so git tracks them.
  // (SKELETON_DIRS is module-scoped — see top of file — so the provenance
  // writer below seeds the SAME zone set.)
  let _skeletonNew = 0;
  for (const d of SKELETON_DIRS) {
    const abs = path.join(TARGET, d);
    try {
      if (!fs.existsSync(abs)) _skeletonNew++;
      fs.mkdirSync(abs, { recursive: true });
      const keep = path.join(abs, ".gitkeep");
      if (!fs.existsSync(keep)) fs.writeFileSync(keep, "");
    } catch {
      /* best-effort */
    }
  }
  log("ok", `Skeleton zones ensured (_requirements/*, _docs/; ${_skeletonNew} created this run)`);

  // ── 5b-prov. Seed-zone PROVENANCE markers (SP-20260618-001 / U2) ──
  // A bare .gitkeep records nothing about where the seeded skeleton came from.
  // After the zones exist, write a `.provenance.json` marker into each one
  // recording `seeded_from` = `_mc/BASELINE/<zone>` (the U1 baseline home —
  // never the deleted framework templates location), the framework version, and
  // a "seeded by /mc:setup" note. Idempotent + skip-if-modified (it leaves an
  // operator-edited marker untouched). Lazy require so there is no load-time
  // circular dependency. Fail-open: a provenance error must never block install.
  try {
    const { populateSeedProvenance } = require("./views/populate-seed-provenance");
    populateSeedProvenance({
      targetRoot: TARGET,
      mcRoot: MC,
      zones: SKELETON_DIRS,
      log,
    });
  } catch (err) {
    log("warn", `Seed-zone provenance skipped (${err.message}) — zones still seeded, markers missing`);
  }

  // ── 5c. ROADMAP scaffold (SP-20260525-018) ─────────────────
  // Idempotent — generate-roadmap-scaffold.js no-ops when ROADMAP.md exists.
  try {
    const rmGen = path.join(MC, "scripts", "mc", "generate-roadmap-scaffold.js");
    if (fs.existsSync(rmGen)) {
      const r = spawnSync("node", [rmGen, TARGET], { encoding: "utf8" });
      if (r.status === 0) log("ok", "ROADMAP.md scaffold ensured");
      else log("warn", `ROADMAP scaffold skipped: ${(r.stderr || "").trim().slice(0, 80)}`);
    }
  } catch {
    /* non-fatal */
  }

  // ── 5d. PROJECT.md scaffold (SP-20260525-019 / T-221) ──────
  // CLAUDE.md references [PROJECT.md](PROJECT.md) for product-specific context,
  // but MC does NOT ship PROJECT.md as a framework asset (the canonical
  // PROJECT.md is MC-about-MC — copying it would leak framework content
  // into the product). So that link dangled on every install. Write a minimal,
  // GENERIC template here so both install paths (warp-setup + install.ps1, which
  // share this core) close the dangling reference. The operator fills the
  // placeholder sections in. Idempotent / skip-if-present: never clobber an
  // operator's PROJECT.md or MC's own (this core also runs in canonical).
  const projectMdFile = path.join(TARGET, "PROJECT.md");
  if (!fs.existsSync(projectMdFile)) {
    const projectMd = [
      `# ${path.basename(TARGET)} — Project Context`,
      "",
      "> Product-specific context for this project. For the framework instructions an",
      "> agent operates under, see [CLAUDE.md](CLAUDE.md). For the agent system router,",
      "> see [AGENTS.md](AGENTS.md). MC will never overwrite this file — it's yours.",
      "",
      "> **Founding brief:** see `_docs/briefs/` — the brief this product was scaffolded from (if one was provided).",
      "",
      "## Product",
      "",
      "_What is this product? One or two sentences: what it does and who it's for._",
      "",
      "## Stack",
      "",
      "_Languages, frameworks, key dependencies, hosting / deployment target._",
      "",
      "## Goals",
      "",
      "_What does success look like? Near-term objectives and the bar for \"done\"._",
      "",
      "## JTBD",
      "",
      "_Jobs To Be Done — the concrete jobs a user hires this product to do._",
      "",
    ].join("\n");
    fs.writeFileSync(projectMdFile, projectMd + "\n");
    log("ok", "Created PROJECT.md template (fill in Product/Stack/Goals/JTBD)");
    installed++;
  } else {
    log("ok", "PROJECT.md already present — leaving it alone");
  }

  // ── 5e. Product maps nudge (SP-20260525-019 / T-222) ───────
  // SAFE OPTION (chosen): write a nudge, do NOT generate maps inline. Reasons:
  //  1. scripts/regen-maps.js hardcodes PROJECT = resolve(__dirname, "..") — it
  //     ALWAYS targets the MC clone it lives in, with no target/CWD param.
  //     It cannot cheaply or safely target the product (the T-222 bar for inline
  //     generation).
  //  2. The framework-manifest ships ~24 canonical maps assets
  //     (.claude/project/maps/skills.jsonl, hooks.jsonl, architecture.md, …) that
  //     the installer copies in. Those describe MC'S OWN inventory. Without a
  //     marker the product silently presents MC's canonical maps as its own —
  //     exactly the failure T-222 calls out.
  // So we drop a README into the maps dir (paths.maps → .claude/project/maps/)
  // flagging the shipped maps as canonical-MC placeholders and pointing the
  // operator at /maps:all to regenerate them for THIS product. Idempotent /
  // skip-if-present. No new paths.json key needed — paths.maps already keys the
  // dir; this is a fixed-name file inside it.
  try {
    const mapsDir = path.join(TARGET, ".claude", "project", "maps");
    fs.mkdirSync(mapsDir, { recursive: true });
    const mapsReadme = path.join(mapsDir, "README.md");
    if (!fs.existsSync(mapsReadme)) {
      const readme = [
        "# Project Maps",
        "",
        "> **These maps are not yours yet.** A fresh MC install ships the",
        "> framework's OWN canonical relationship maps (skills, hooks, tools, memory,",
        "> systems, enforcements, architecture) as placeholders in this directory.",
        "> They describe MC itself — not this product.",
        "",
        "## Generate maps for THIS product",
        "",
        "Open the project in Claude Code and run:",
        "",
        "```",
        "/maps:all",
        "```",
        "",
        "That regenerates every map by walking THIS project's `.claude/` and source",
        "tree (no LLM synthesis — deterministic file walks), replacing the shipped",
        "MC placeholders with your real inventory.",
        "",
        "Until you do, treat any pre-existing `*.jsonl` / `*.md` / `inventory-*.json`",
        "in this directory as framework defaults, not project truth.",
        "",
      ].join("\n");
      fs.writeFileSync(mapsReadme, readme + "\n");
      log("ok", "Wrote maps/README.md nudge (run /maps:all to generate product maps)");
      installed++;
    } else {
      log("ok", "maps/README.md already present — leaving it alone");
    }
  } catch {
    /* non-fatal — maps nudge is informational */
  }

  // ── 5f. .claude/runtime/ ESM/CJS insulation (G4.2 / WG-9 class) ────
  // MC framework scripts are CommonJS (require()). Hand-written `.js`
  // helpers under `.claude/runtime/` (session scratch, ad-hoc one-offs) inherit
  // the PRODUCT root's module type — so if the product's root package.json
  // declares "type":"module", those helpers load as ESM and break with
  // "require is not defined in ES module scope". Drop a {"type":"commonjs"}
  // package.json INSIDE .claude/runtime/ so that subtree resolves as CommonJS
  // regardless of the product root's module type. (Mirrors the scripts/
  // package.json insulation /scan:install now enforces — same bug class, the
  // runtime side.)
  //
  // .claude/runtime/ is gitignored (see .gitignore: ".claude/runtime/"), so the
  // file is correctly created at SCAFFOLD time, not shipped as a tracked
  // framework asset. Idempotent / skip-if-present. Fail-open.
  try {
    const runtimeDir = path.join(TARGET, ".claude", "runtime");
    fs.mkdirSync(runtimeDir, { recursive: true });
    const runtimePkg = path.join(runtimeDir, "package.json");
    if (!fs.existsSync(runtimePkg)) {
      fs.writeFileSync(
        runtimePkg,
        JSON.stringify({ type: "commonjs" }, null, 2) + "\n",
      );
      log("ok", 'Wrote .claude/runtime/package.json ({"type":"commonjs"} — insulates runtime .js helpers from ESM product roots)');
      installed++;
    } else {
      log("ok", ".claude/runtime/package.json already present — leaving it alone");
    }
  } catch {
    /* non-fatal — runtime insulation is best-effort */
  }

  // ── 5g. scripts/ ESM/CJS insulation (WG-9/W-005 class, gap B1) ────────
  // The scripts/ subtree is all CommonJS. scripts/package.json={"type":"commonjs"}
  // is now a SHIPPED framework asset (generate-framework-manifest TOP_LEVEL_FRAMEWORK_FILES,
  // 2026-05-30), so the installer copies it. This block is belt-and-suspenders:
  // if the copy path ever misses it, scaffold writes it so a product whose root
  // declares "type":"module" never has its framework scripts/hooks break as ESM.
  // Idempotent / skip-if-present. Fail-open. /scan:install enforces presence.
  try {
    const scriptsDir = path.join(TARGET, "scripts");
    if (fs.existsSync(scriptsDir)) {
      const scriptsPkg = path.join(scriptsDir, "package.json");
      if (!fs.existsSync(scriptsPkg)) {
        fs.writeFileSync(
          scriptsPkg,
          JSON.stringify({ type: "commonjs" }, null, 2) + "\n",
        );
        log("ok", 'Wrote scripts/package.json ({"type":"commonjs"} — insulates framework scripts+hooks from ESM product roots)');
        installed++;
      }
    }
  } catch {
    /* non-fatal — scripts insulation is best-effort */
  }

  return { installedDelta: installed };
}

/**
 * populateMcMirror — the LATE scaffold block (block D).
 *
 * Populates the product's `_mc/` framework SOURCE mirror so
 * scripts/mc/views/regenerate.js does real work. Must run AFTER the
 * settings-compile check (see module docstring) and BEFORE manifest coverage.
 *
 * @param {object}   opts
 * @param {string}   opts.target        product root (was TARGET)
 * @param {string}   opts.mcRoot    canonical MC clone (was MC)
 * @param {object}   opts.shipManifest  pre-parsed framework-manifest
 * @param {function} opts.log           reporter, signature log(status, msg, detail?)
 * @param {string}  [opts.HEADER]       ANSI header escape (for the section banner)
 * @param {string}  [opts.RESET]        ANSI reset escape
 * @returns {{ installedDelta: number }}
 */
function populateMcMirror({ target, mcRoot, shipManifest, log, HEADER = "", RESET = "" }) {
  const TARGET = target;
  const MC = mcRoot;
  let installed = 0;

  // ── 8.9. Populate _mc/ framework SOURCE mirror (SP-20260525-003) ──
  // THE MODEL (regenerate.js docstring + Strategy line 17): a product holds
  // framework SOURCE at `_mc/` (a mirror); `.claude/` is the COMPILED VIEW
  // regenerated from it. Before this, /mc:setup copied framework files only to
  // the root + `.claude/` and created NO `_mc/`, so scripts/mc/views/
  // regenerate.js had no source mirror and was inert in products.
  //
  // We mirror the framework view-source (commands, agents, project/reference,
  // agent .system policy json) from the CANONICAL clone (MC) into the
  // product's `_mc/`, then the MANIFEST COVERAGE block below regenerates
  // _mc/MANIFEST.json with `--source-prefix _mc` so framework-view
  // entries carry `source` pointers into `_mc/` (`.claude/commands/foo.md`
  // → `_mc/commands/foo.md`). regenerate.js then does real work.
  //
  // Idempotent / content-addressed: a re-run only rewrites mirror files that are
  // missing or differ from canonical — this is the migration path for existing
  // products. DRY-RUN already returned above, so no guard
  // needed here. Fail-open: never block install on a mirror error.
  {
    console.log(`\n${HEADER}  FRAMEWORK SOURCE MIRROR (_mc/)${RESET}`);
    const populateScript = path.join(
      MC,
      "scripts",
      "mc",
      "views",
      "populate-source.js",
    );
    try {
      const { populateSource } = require(populateScript);
      const pr = populateSource({
        targetRoot: TARGET,
        mcRoot: MC,
        shipManifest,
      });
      if (!pr.ok && pr.code === 2) {
        log("warn", `_mc/ mirror skipped: ${pr.error}`);
      } else {
        log(
          "ok",
          `_mc/ source mirror: ${pr.copied.length} copied, ${pr.unchanged.length} unchanged (${pr.mirroredCount} view files mirrored)`,
        );
        installed += pr.copied.length;
        if (pr.missingSource.length > 0) {
          log(
            "warn",
            `_mc/ mirror: ${pr.missingSource.length} source(s) declared by manifest but missing in clone (first 3): ${pr.missingSource
              .slice(0, 3)
              .map((m) => m.src)
              .join(", ")}`,
          );
        }
        if (pr.failed.length > 0) {
          log(
            "warn",
            `_mc/ mirror: ${pr.failed.length} copy failure(s) (first 3): ${pr.failed
              .slice(0, 3)
              .map((f) => `${f.mirror} (${f.reason})`)
              .join("; ")}`,
          );
        }
      }
    } catch (err) {
      log("warn", `_mc/ mirror failed (${err.message}) — install continues; regenerate.js stays inert until re-run`);
    }
  }

  return { installedDelta: installed };
}

/**
 * regenerateMcManifest — the MANIFEST COVERAGE build step (extracted from
 * warp-setup.js, SP-20260525-019 / T-220).
 *
 * Regenerates `_mc/MANIFEST.json` (the dest→{owner,source} map that
 * scripts/mc/views/regenerate.js reads) by running the manifest builder with
 * `--source-prefix _mc`, so framework-view entries carry `source` pointers
 * into `_mc/`. Without this, populateMcMirror copies the mirror SOURCE
 * files but the mirror has no MANIFEST.json and regenerate.js stays inert.
 *
 * WHY EXTRACTED: warp-setup.js ran this inline (its "MANIFEST COVERAGE" block);
 * the install.ps1/CLI path didn't, so a consumer install shipped a _mc/ with
 * no MANIFEST.json (caught by the install matrix's installps1_path + both-path
 * parity gate). Both paths now call THIS one function (β: extract-don't-fork).
 * warp-setup keeps its own validate + --strict-manifest install-refusal policy
 * wrapped AROUND this build step; the CLI just needs the regeneration.
 *
 * Must run AFTER populateMcMirror (the mirror source must exist first).
 * Fail-open: never crash the install on a manifest-build error.
 *
 * @param {object}   opts
 * @param {string}   opts.target      product root
 * @param {string}   opts.mcRoot  clone holding scripts/mc/manifest/build.js
 * @param {function} opts.log         reporter, signature log(status, msg, detail?)
 * @returns {{ ok: boolean, skipped: boolean, status: (number|null), stderr: string }}
 */
function regenerateMcManifest({ target, mcRoot, log }) {
  const mcZone = path.join(target, "_mc");
  if (!fs.existsSync(mcZone)) {
    log("info", "_mc/ not present — skipping manifest regeneration (legacy install layout)");
    return { ok: false, skipped: true, status: null, stderr: "" };
  }
  const buildScript = path.join(mcRoot, "scripts/mc/manifest/build.js");
  if (!fs.existsSync(buildScript)) {
    log("warn", `manifest build.js not found at ${buildScript} — _mc/MANIFEST.json not regenerated`);
    return { ok: false, skipped: true, status: null, stderr: "" };
  }
  const res = spawnSync(
    process.execPath,
    [buildScript, "--root", target, "--source-prefix", "_mc"],
    { encoding: "utf8" },
  );
  if (res.status !== 0) {
    log("warn", `manifest build.js exited ${res.status} — _mc/MANIFEST.json may be missing/stale. stderr: ${(res.stderr || "").trim().slice(0, 200)}`);
    return { ok: false, skipped: false, status: res.status, stderr: res.stderr || "" };
  }
  log("ok", "_mc/MANIFEST.json regenerated (--source-prefix _mc)");
  return { ok: true, skipped: false, status: 0, stderr: "" };
}

/**
 * writeProductManifest — `.claude/manifest.json` (extracted from warp-setup.js
 * step 6, SP-20260525-019 / T-220).
 *
 * WHY EXTRACTED: warp-setup wrote manifest.json inline; the install.ps1/CLI path
 * did not, so an install.ps1 consumer shipped NO manifest.json (caught by the
 * install-matrix both-path parity gate, which listed it in `onlyInSetup`). Both
 * paths now call THIS one function (β: extract-don't-fork).
 *
 * Interview-driven: warp-setup passes its collected `interview` answers; the
 * non-interactive CLI/install.ps1 path passes `{}` and the `interview.X ||
 * basename`-style fallbacks below produce a valid manifest. (scenario 1 also runs
 * non-interactive `--yes`, so the warp-setup and CLI defaults coincide.)
 *
 * Idempotent / skip-if-present: never clobber an existing manifest.json.
 *
 * @param {object}   opts
 * @param {string}   opts.target       product root (was TARGET)
 * @param {object}  [opts.interview]   interview answers (projectName, pitch, mainBranch, mcSource)
 * @param {string}  [opts.stack]       detected stack ("node"|"python"|…); default "unknown"
 * @param {string}  [opts.framework]   detected framework; default "unknown"
 * @param {function} opts.log          reporter, signature log(status, msg, detail?)
 * @returns {{ installedDelta: number }}
 */
// Resolve the MC version being installed. Was hardcoded "0.1.0", which baked a
// version-quorum mismatch (manifest.mc.version != version.json) into EVERY fresh
// install — caught by the artifact-first fresh-install smoke (test-fresh-install-smoke.js).
// Prefer an explicit override; else read the installing source's version.json — this
// module ships inside the MC source / capsule, so __dirname/../../version.json is
// the version actually being installed.
function resolveMcVersion(override) {
  if (override && typeof override === "string") return override;
  try {
    const vj = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "..", "..", "version.json"), "utf8"),
    );
    if (vj && typeof vj.version === "string" && vj.version) return vj.version;
  } catch {
    /* fall through to a safe default */
  }
  return "0.0.0";
}

function writeProductManifest({ target, interview = {}, stack = "unknown", framework = "unknown", mcVersion, log }) {
  const TARGET = target;
  let installed = 0;

  const manifestFile = path.join(TARGET, ".claude/manifest.json");
  if (!fs.existsSync(manifestFile)) {
    const projectName = interview.projectName || path.basename(TARGET);
    const manifest = {
      $schema: "mc/manifest/v1",
      project: {
        name: projectName,
        slug: projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        description: interview.pitch || "",
        techStack: [stack],
        framework: framework,
      },
      git: {
        mainBranch: interview.mainBranch,
      },
      mc: {
        version: resolveMcVersion(mcVersion),
        installed: true,
        source: interview.mcSource,
        features: ["agents", "hooks", "skills", "memory", "maps", "events"],
      },
      agents: {
        team: {
          name: "alex",
          identity: "Alex",
          members: {
            alpha: { symbol: "α", role: "orchestrator" },
            beta: { symbol: "β", role: "judgment" },
            gamma: { symbol: "γ", role: "adhoc builder" },
            delta: { symbol: "δ", role: "oneshot builder" },
          },
        },
        modes: ["adhoc", "oneshot", "solo"],
        build: [
          "builder",
          "evaluator",
          "compliance",
          "auditor",
          "qa",
          "redteam",
          "fixer",
        ],
      },
      source_dirs: stack === "node" ? ["src/"] : [],
      build: { features: [], phases: [] },
      // Cross-provider agent diversity — review-layer on GPT, security on Gemini,
      // orchestration/code on Claude. See scripts/hooks/lib/providers.js.
      providers: {
        claude: {
          cli: "claude",
          default_model: "sonnet",
          invocation: "native",
        },
        openai: {
          cli: "codex",
          default_model: "gpt-5.5",
          fallback: "claude",
          // `codex exec --sandbox workspace-write -m <model> -` (dash reads prompt
          // from stdin; `--full-auto` was DEPRECATED in Codex ≥0.135, and exec is
          // non-interactive so `--ask-for-approval` is not a valid exec flag).
          syntax: "codex exec --sandbox workspace-write -m {model} -",
        },
        antigravity: {
          cli: "agy",
          default_model: "gemini-3.1-pro-high",
          fallback: "openai",
          // Antigravity (`agy`) — the supported Gemini lab. The individual-tier `gemini` CLI is
          // SUNSET (removed in the 2026-07-20 deep-clean); agy self-auths via its own keyring and
          // its `--model` takes DISPLAY names ("Gemini 3.1 Pro (High)"). CROSS-FAMILY fallback is
          // openai (a Google-lab outage retries on the GPT lab, never another google endpoint).
          syntax: "agy --model {model} --print-timeout 90s -p",
        },
      },
      agentProviders: {
        alpha: "claude",
        beta: "claude",
        gamma: "claude",
        delta: "claude",
        builder: "claude",
        fixer: "claude",
        evaluator: "openai",
        compliance: "openai",
        auditor: "openai",
        qa: "openai",
        // Security FLOOR = the VERIFIABLE GPT lane (never the SUNSET gemini CLI); the live
        // security-reviewer default is antigravity via the role-registry keystone.
        redteam: "openai",
      },
      buildCommands: {},
      fileOwnership: { foundation: [] },
    };

    // Auto-detect build commands (self-contained: re-detect package.json here so
    // the CLI path doesn't need a separate hasPackageJson param).
    if (fs.existsSync(path.join(TARGET, "package.json"))) {
      try {
        const pkg = JSON.parse(
          fs.readFileSync(path.join(TARGET, "package.json"), "utf8"),
        );
        const scripts = pkg.scripts || {};
        if (scripts.build) manifest.buildCommands.build = "npm run build";
        if (scripts.test) manifest.buildCommands.test = "npm run test";
        if (scripts.lint) manifest.buildCommands.lint = "npm run lint";
      } catch {
        /* skip */
      }
    }

    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
    log("ok", `Created manifest.json for "${projectName}"`);
    installed++;
  } else {
    // UPDATE-side restamp — symmetric with the create branch's version stamping. manifest.json is a
    // project-owned identity card written ONCE at fresh install, so update must NOT recreate it — but its
    // framework-managed mc.version MUST track the installed version, else it stays at the install-era
    // version while version.json advances (scan:install version-match FAIL — scripts/check/install.js:89).
    // SURGICAL: touch ONLY mc.version; preserve every project-owned field. Engine-level, NOT a per-pair
    // migration (which would need a restamp entry for every version pair).
    try {
      const existing = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
      const want = resolveMcVersion(mcVersion);
      if (
        existing &&
        existing.mc &&
        typeof existing.mc === "object" &&
        existing.mc.version !== want
      ) {
        existing.mc.version = want;
        fs.writeFileSync(manifestFile, JSON.stringify(existing, null, 2) + "\n");
        log("ok", `Restamped manifest.json mc.version → ${want}`);
        installed++;
      }
    } catch (e) {
      log("warn", `manifest.json restamp skipped (${e.message})`);
    }
  }

  return { installedDelta: installed };
}

/**
 * writeAgentStore — `.claude/agents/store.json` (extracted from warp-setup.js
 * step 7, SP-20260525-019 / T-220). Static object; build-system state.
 *
 * WHY EXTRACTED: same as writeProductManifest — the install.ps1/CLI path didn't
 * produce store.json, so it showed up in the parity gate's `onlyInSetup`. Both
 * paths now call this one function. Idempotent / skip-if-present.
 *
 * @param {object}   opts
 * @param {string}   opts.target   product root (was TARGET)
 * @param {function} opts.log      reporter, signature log(status, msg, detail?)
 * @returns {{ installedDelta: number }}
 */
function writeAgentStore({ target, log }) {
  const TARGET = target;
  let installed = 0;

  const storeFile = path.join(TARGET, ".claude/agents/store.json");
  if (!fs.existsSync(storeFile)) {
    const store = {
      features: {},
      tasks: [],
      bugDataset: [],
      conflictDataset: [],
      cycle: 0,
      circuitBreaker: "closed",
      consecutiveFailures: 0,
      totalFailures: 0,
      lastCooldownMs: 0,
      evolution: [],
      heartbeat: {
        cycle: 0,
        phase: 0,
        feature: "",
        agent: "",
        status: "idle",
        cycleStep: null,
        workstream: null,
        timestamp: new Date().toISOString(),
      },
      compliance: {
        command: "codex",
        fallback: "claude",
        model: "gpt-5.4",
        syntax: "codex exec --model gpt-5.4",
        note: "Deprecated — use manifest.providers + manifest.agentProviders instead. Kept for backwards compat.",
      },
      snapshots: { features: {}, interfaces: {}, datasets: {} },
      knownStubs: [],
      points: { configs: {} },
      runLog: { runId: null, startedAt: null, entries: [], finalStatus: null },
      sharedFiles: {},
    };
    // store.json lives under .claude/agents/ — ensure the dir exists (the CLI
    // path may reach here before any agent asset has created it).
    fs.mkdirSync(path.dirname(storeFile), { recursive: true });
    fs.writeFileSync(storeFile, JSON.stringify(store, null, 2) + "\n");
    log("ok", "Created store.json (build system state)");
    installed++;
  }

  return { installedDelta: installed };
}

/**
 * writeProductSettings — `.claude/settings.json` (extracted from warp-setup.js
 * step 8 "CONFIGURING HOOKS", SP-20260525-019 / T-220).
 *
 * WHY EXTRACTED: warp-setup merged settings.json inline (env + permissions + the
 * full hook registration map); the install.ps1/CLI path did not, so a consumer
 * install shipped NO settings.json — meaning NO hooks fired. It also showed up in
 * the parity gate's `onlyInSetup`. Both paths now call this one function (β:
 * extract-don't-fork).
 *
 * TWO-PHASE settings model (preserved verbatim):
 *   1. BASE WRITE — read any existing settings.json, additively merge MC env
 *      vars, permissions, and the hook registrations (dedup-on-command so re-runs
 *      are idempotent), write it back.
 *   2. LAYERED COMPILE — if `_mc/settings/defaults.json` exists, recompile the
 *      effective settings.json from the layered sources (defaults + settings.local)
 *      via scripts/mc/settings/compile.js. Older installs without defaults.json
 *      keep the base write. Fail-open.
 *
 * The two phases are exposed as ONE call but the compile only fires when
 * defaults.json is present, so the CALLER controls net behavior via ORDERING:
 *   - warp-setup calls this at its original site (BEFORE the _mc/ mirror), so
 *     on a fresh install defaults.json doesn't exist yet → compile is SKIPPED →
 *     warp-setup ships the inlined base write, exactly as before (behavior-preserving).
 *   - the CLI calls this AFTER populateMcMirror (which created defaults.json) →
 *     compile fires → settings.json is compiled from defaults. Either way settings.json
 *     EXISTS with the MC hooks (defaults.json carries the same hook events as the
 *     inlined write), satisfying the path-set parity gate.
 *
 * Idempotent throughout: the base merge dedups by command string; compile.js is
 * deterministic.
 *
 * @param {object}   opts
 * @param {string}   opts.target       product root (was TARGET)
 * @param {string}   opts.mcRoot   clone holding scripts/mc/settings/compile.js (was MC)
 * @param {object}  [opts.hookTools]   { prettier, tsc, eslint } for the missing-tools notice (optional)
 * @param {function} opts.log          reporter, signature log(status, msg, detail?)
 * @param {string}  [opts.HEADER]      ANSI header escape (for the section banner)
 * @param {string}  [opts.RESET]       ANSI reset escape
 * @returns {{ installedDelta: number }}
 */
function writeProductSettings({ target, mcRoot, hookTools = {}, log, HEADER = "", RESET = "" }) {
  const TARGET = target;
  const MC = mcRoot;
  let installed = 0;

  // ── 8. Merge settings.json ──────────────────────────────
  console.log(`\n${HEADER}  CONFIGURING HOOKS${RESET}`);

  const settingsFile = path.join(TARGET, ".claude/settings.json");
  // settings.json lives under .claude/ — ensure the dir exists (the CLI path may
  // reach here before any .claude asset has created it).
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  let settings = {};
  if (fs.existsSync(settingsFile)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
    } catch {
      settings = {};
    }
  }

  // Add env vars if not present
  if (!settings.env) settings.env = {};
  if (!settings.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS) {
    settings.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = "1";
  }

  // Add permissions if not present (additive)
  if (!settings.permissions) settings.permissions = {};
  if (!settings.permissions.allow) settings.permissions.allow = [];
  const requiredPerms = [
    "Bash(npm run *)",
    "Bash(node *)",
    "Bash(git *)",
    "Bash(ls *)",
    "Bash(pwd)",
    "Bash(which *)",
    "Bash(cat *)",
    "Bash(head *)",
    "Read",
    "Edit",
    "Write",
    "Glob",
    "Grep",
    "Agent",
  ];
  for (const perm of requiredPerms) {
    if (!settings.permissions.allow.includes(perm)) {
      settings.permissions.allow.push(perm);
    }
  }

  // Add hook registrations if not present
  if (!settings.hooks) settings.hooks = {};

  // Hook-entry helper: Claude Code schema requires every hook to have type:"command".
  // Also: event keys must be single event names (Stop, SessionEnd, StopFailure as
  // three separate keys — NOT "Stop|SessionEnd|StopFailure" as one key).
  const cmd = (script) => ({
    type: "command",
    command: `node "$CLAUDE_PROJECT_DIR/scripts/hooks/${script}"`,
  });

  const sessionStopEntry = [
    {
      matcher: "",
      hooks: [cmd("session-stop.js")],
    },
  ];

  const hookConfig = {
    SessionStart: [
      {
        matcher: "",
        hooks: [cmd("session-start.js")],
      },
    ],
    UserPromptSubmit: [
      {
        matcher: "",
        hooks: [cmd("smart-context.js"), cmd("prompt-logger.js")],
      },
    ],
    PreToolUse: [
      {
        matcher: "Bash",
        hooks: [
          cmd("merge-guard.js"),
          cmd("memory-guard.js"),
          cmd("framework-manifest-guard.js"),
        ],
      },
      {
        matcher: "Edit|Write",
        hooks: [
          cmd("secret-guard.js"),
          cmd("foundation-guard.js"),
          cmd("ownership-guard.js"),
          cmd("memory-guard.js"),
          cmd("store-validator.js"),
          cmd("path-guard.js"),
        ],
      },
      {
        matcher: "Agent",
        hooks: [cmd("team-guard.js")],
      },
    ],
    PostToolUse: [
      {
        matcher: "",
        hooks: [cmd("session-tracker.js")],
      },
      {
        matcher: "Edit|Write",
        hooks: [
          // All quality hooks registered unconditionally. Each hook self-skips
          // (exits 0) when its underlying tool (prettier / tsc / eslint) is
          // absent — see the hook source. This keeps install simple and lets
          // users add tooling later without re-registering.
          cmd("format.js"),
          cmd("typecheck.js"),
          cmd("lint.js"),
          cmd("edit-watcher.js"),
          cmd("systems-sync.js"),
          cmd("save-session-lint.js"),
          cmd("learning-validator.js"),
          cmd("ui-lint.js"),
          cmd("path-guard.js"),
        ],
      },
    ],
    PostCompact: [
      {
        matcher: "",
        hooks: [cmd("compact-saver.js")],
      },
    ],
    // Session lifecycle: session-stop.js registered on all three end-of-session events.
    // Claude Code schema requires separate keys per event, not a pipe-joined key.
    Stop: sessionStopEntry,
    SessionEnd: sessionStopEntry,
    StopFailure: sessionStopEntry,
  };

  // Merge MC hooks with any user-existing hooks, per event.
  // Each event's value is an array of { matcher, hooks: [...] } blocks.
  // We want: (a) preserve every user block, (b) add our blocks, (c) dedupe our
  // own entries so re-running the installer is idempotent.
  function mcScriptPath(entry) {
    // Stable identity for a MC hook entry — the command string.
    return typeof entry === "object" && entry?.command ? entry.command : null;
  }

  function mergeEventHooks(existing, incoming) {
    // existing: array of blocks already in user's settings.hooks[event]
    // incoming: array of blocks MC wants to register
    const result = Array.isArray(existing) ? [...existing] : [];

    for (const block of incoming) {
      // Does the user already have a block with the same matcher?
      const match = result.find(
        (b) => (b.matcher || "") === (block.matcher || ""),
      );
      if (match) {
        // Merge our hook entries INTO the existing matcher's hooks list, deduping
        // by command string. User's other hooks for this matcher stay intact.
        match.hooks = match.hooks || [];
        const existingCmds = new Set(match.hooks.map(mcScriptPath));
        for (const entry of block.hooks) {
          if (!existingCmds.has(mcScriptPath(entry))) {
            match.hooks.push(entry);
          }
        }
      } else {
        // No matching block — append our full block alongside user's.
        result.push(block);
      }
    }
    return result;
  }

  for (const [event, incomingBlocks] of Object.entries(hookConfig)) {
    const before = JSON.stringify(settings.hooks[event] || []);
    settings.hooks[event] = mergeEventHooks(
      settings.hooks[event],
      incomingBlocks,
    );
    const after = JSON.stringify(settings.hooks[event]);
    if (before === after) {
      log("ok", `${event}: MC hooks already registered (no-op, idempotent)`);
    } else if (before === "[]") {
      log("ok", `Registered MC hooks for ${event}`);
      installed++;
    } else {
      log(
        "ok",
        `Merged MC hooks into existing ${event} (user hooks preserved)`,
      );
      installed++;
    }
  }

  // Report which tools are missing (hooks self-skip silently — this is just info)
  const missing = [];
  if (!hookTools.prettier) missing.push("prettier");
  if (!hookTools.tsc) missing.push("tsc (TypeScript)");
  if (!hookTools.eslint) missing.push("eslint");
  if (!fs.existsSync(path.join(TARGET, "_requirements/01-design-system")))
    missing.push("design-system docs (for ui-lint)");
  if (missing.length > 0) {
    log(
      "info",
      `All hooks wired. Tool(s) missing: ${missing.join(", ")} — related hooks self-skip until installed; no action needed.`,
    );
  }

  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + "\n");

  // SP-20260523-002: If the target has the three-layer source-of-truth
  // (`_mc/settings/defaults.json`), regenerate the effective
  // `.claude/settings.json` from the layered sources via compile.js. This
  // is the new model — `_mc/settings/defaults.json` (framework defaults)
  // + `.claude/settings.local.json` (operator overrides) → compiled
  // `.claude/settings.json`. Older installs without defaults.json keep the
  // inlined-write above; the defaults.json check makes this backward
  // compatible. Fail-open: never block install on a compile error.
  const settingsDefaultsFile = path.join(TARGET, "_mc/settings/defaults.json");
  if (fs.existsSync(settingsDefaultsFile)) {
    const compileScript = path.join(MC, "scripts/mc/settings/compile.js");
    if (fs.existsSync(compileScript)) {
      const settingsLocalFile = path.join(TARGET, ".claude/settings.local.json");
      const compileArgs = [
        compileScript,
        "--defaults", settingsDefaultsFile,
        "--out", settingsFile,
      ];
      if (fs.existsSync(settingsLocalFile)) {
        compileArgs.push("--local", settingsLocalFile);
      }
      try {
        const cr = spawnSync(process.execPath, compileArgs, { encoding: "utf8" });
        if (cr.status === 0) {
          log("ok", `Compiled .claude/settings.json from _mc/settings/defaults.json + settings.local.json`);
        } else {
          log("warn", `compile.js exited ${cr.status} — kept inlined settings.json. stderr: ${(cr.stderr || "").slice(0, 200)}`);
        }
      } catch (err) {
        log("warn", `compile.js spawn failed: ${err.message} — kept inlined settings.json`);
      }
    }
  }

  return { installedDelta: installed };
}

module.exports = {
  SKELETON_DIRS,
  scaffoldProduct,
  populateMcMirror,
  regenerateMcManifest,
  writeProductManifest,
  writeAgentStore,
  writeProductSettings,
};

// ── CLI entry (SP-20260525-019 / T-220) ────────────────────
// `node scripts/mc/scaffold-core.js <target> [--mc-root <path>]` runs
// the FULL product scaffold (every entry point) against <target>. This is the
// SHARED core that install.ps1 shells out to AFTER its file-copy + manifest-regen
// — a real shell-out to this script file (β A-006: extract-don't-fork +
// cross-platform shell-out), so a PowerShell install ends up identical to the
// warp-setup path (manifest.json, store.json, settings.json, registry-driven
// paths.json, _requirements/_docs zones, ROADMAP, PROJECT.md, maps nudge, and the
// _mc/ source mirror).
//
// mcRoot resolution (the mirror-source question):
//   - DEFAULT (no flag): mcRoot = path.resolve(__dirname,"..","..") — the
//     clone this script file lives in. Used by the install-matrix node-mode path,
//     which runs the CANONICAL scaffold-core.js (so mcRoot = canonical), and
//     as a backward-compatible fallback.
//   - install.ps1 NOW PASSES `--mc-root $Source` (the canonical repo where
//     install.ps1 lives). This matters: populate-source.js sources the framework
//     files for the _mc/ mirror — including `_mc/settings/defaults.json` —
//     from `mcRoot/...`. If install.ps1 let mcRoot default to the IN-PRODUCT
//     copy (`<target>/scripts/mc/scaffold-core.js`'s __dirname/../.. = the
//     product itself), the mirror would self-source from the fresh product, which
//     has no `_mc/` yet, so defaults.json would NOT land. Threading
//     `--mc-root $Source` makes the mirror source from canonical, exactly like
//     warp-setup (whose MC is the canonical clone, separate from the target).
if (require.main === module) {
  // Parse argv: first positional = target; optional `--mc-root <path>`.
  const argv = process.argv.slice(2);
  let targetArg = null;
  let mcRootArg = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--mc-root") {
      mcRootArg = argv[++i];
    } else if (a.startsWith("--mc-root=")) {
      mcRootArg = a.slice("--mc-root=".length);
    } else if (!targetArg && !a.startsWith("--")) {
      targetArg = a;
    }
  }
  if (!targetArg) {
    process.stderr.write(
      "usage: node scripts/mc/scaffold-core.js <target-dir> [--mc-root <canonical-clone>]\n",
    );
    process.exit(2);
  }
  const target = path.resolve(targetArg);
  if (!fs.existsSync(target)) {
    process.stderr.write(`target directory does not exist: ${target}\n`);
    process.exit(2);
  }
  // mcRoot: use --mc-root when passed (install.ps1 passes $Source =
  // canonical), else default to two levels up from this file (matrix node-mode /
  // back-compat). When the flag is absent and this is an install.ps1
  // self-invocation of the in-product copy, target === mcRoot.
  const mcRoot = mcRootArg
    ? path.resolve(mcRootArg)
    : path.resolve(__dirname, "..", "..");

  // Console-backed reporter matching warp-setup's log(status, msg, detail?)
  // signature. Plain ASCII tags — this runs under whatever shell install.ps1
  // is using, and not all terminals render the colored glyphs cleanly.
  const TAG = { ok: "[ ok ]", warn: "[warn]", fail: "[fail]", info: "[info]" };
  const log = (status, msg, detail) => {
    process.stdout.write(`${TAG[status] || "[info]"} ${msg}\n`);
    if (detail) process.stdout.write(`       ${detail}\n`);
  };

  // Stack/framework detection for manifest.json (mirrors warp-setup's scan).
  // The CLI/install.ps1 path is NON-INTERACTIVE: no interview, so manifest
  // fallbacks (interview.X || basename) apply. Detect the stack the same way
  // warp-setup does so the two paths produce the same manifest defaults.
  let stack = "unknown";
  let framework = "unknown";
  if (fs.existsSync(path.join(target, "package.json"))) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(target, "package.json"), "utf8"));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.next) { stack = "node"; framework = "next.js"; }
      else if (deps.react) { stack = "node"; framework = "react"; }
      else if (deps.express) { stack = "node"; framework = "express"; }
      else if (deps.vue) { stack = "node"; framework = "vue"; }
      else { stack = "node"; framework = "node.js"; }
    } catch {
      stack = "node";
    }
  } else if (fs.existsSync(path.join(target, "requirements.txt"))) {
    stack = "python"; framework = "python";
  } else if (fs.existsSync(path.join(target, "go.mod"))) {
    stack = "go"; framework = "go";
  } else if (fs.existsSync(path.join(target, "Cargo.toml"))) {
    stack = "rust"; framework = "rust";
  }

  log("info", `scaffold-core: target=${target}`);
  log("info", `scaffold-core: mcRoot=${mcRoot}`);

  let total = 0;
  try {
    // EARLY bundle (A+B+C+D+E): paths.json + skeleton + ROADMAP + PROJECT.md + maps nudge.
    total += scaffoldProduct({ target, mcRoot, log }).installedDelta;

    // manifest.json + store.json (warp-setup steps 6 + 7). Non-interactive:
    // interview={} so fallbacks apply. These complete the install-path parity
    // (both showed up in the parity gate's `onlyInSetup`).
    total += writeProductManifest({ target, interview: {}, stack, framework, log }).installedDelta;
    total += writeAgentStore({ target, log }).installedDelta;

    // BASE settings write (warp-setup step 8). Runs BEFORE the _mc/ mirror so
    // settings.json EXISTS even if the mirror fails. The layered compile inside
    // writeProductSettings is SKIPPED here (defaults.json doesn't exist yet — the
    // mirror below creates it); we run a SECOND writeProductSettings AFTER the
    // mirror to fire the compile. hookTools omitted (CLI doesn't probe formatter
    // tooling — the missing-tools notice is informational only).
    total += writeProductSettings({ target, mcRoot, log }).installedDelta;

    // LATE block: _mc/ source mirror. populate-source needs the ship
    // manifest; read the canonical clone's copy (mcRoot). Skip the mirror
    // (with a clear notice) if it's absent rather than crash — fail-open, the
    // way warp-setup treats this block.
    const manifestPath = path.join(
      mcRoot,
      ".claude",
      "framework-manifest.json",
    );
    let shipManifest = null;
    try {
      shipManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
      /* manifest missing/unreadable — handled below */
    }
    if (shipManifest) {
      total += populateMcMirror({
        target,
        mcRoot,
        shipManifest,
        log,
      }).installedDelta;
      // MANIFEST COVERAGE: regenerate _mc/MANIFEST.json so regenerate.js has
      // its dest→{owner,source} map (the same step warp-setup runs after the
      // mirror). Without this the mirror has source files but no MANIFEST.json
      // and regenerate.js stays inert — the install.ps1-path gap the parity
      // matrix caught. Fail-open; the helper logs its own outcome.
      regenerateMcManifest({ target, mcRoot, log });

      // LAYERED settings compile: now that the mirror has created
      // `_mc/settings/defaults.json`, re-run writeProductSettings so its
      // compile branch fires and settings.json is compiled from the layered
      // sources — the SAME compile.js warp-setup uses. The base merge above is
      // idempotent, so this second call only adds the compile. (ORDER, per the
      // ticket: layered-compile AFTER populateMcMirror.)
      total += writeProductSettings({ target, mcRoot, log }).installedDelta;
    } else {
      log(
        "warn",
        `_mc/ mirror skipped — no readable framework-manifest at ${manifestPath}. Re-run /mc:setup or regenerate the manifest, then re-run this script.`,
      );
    }
    log("ok", `scaffold-core complete (${total} item(s) scaffolded)`);
    process.exit(0);
  } catch (err) {
    process.stderr.write(`scaffold-core failed: ${err && err.message ? err.message : err}\n`);
    process.exit(1);
  }
}
