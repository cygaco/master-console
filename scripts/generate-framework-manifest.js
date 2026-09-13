#!/usr/bin/env node

/**
 * generate-framework-manifest.js — build .claude/framework-manifest.json
 *
 * Walks the MC source tree, classifies every shippable asset by kind,
 * and writes a single declarative manifest at .claude/framework-manifest.json.
 *
 * The installer (warp-setup.js) consumes this manifest instead of hand-coded
 * copyDir calls. Missing assets become impossible because every dir is
 * enumerated — if a file isn't in the manifest, the installer doesn't see it.
 *
 * Usage:
 *   node scripts/generate-framework-manifest.js
 *
 * Run this:
 *   - After adding/removing/renaming any .claude/, scripts/, _requirements/,
 *     patterns/ asset
 *   - Before every MC commit that touches assets (enforced by the
 *     framework-manifest-guard hook at commit time)
 *
 * Not auto-run via hook because:
 *   - PostToolUse rewriting a committed file on every edit is noisy
 *   - Mid-session manifest bouncing during rapid edits is worse than the
 *     deterministic "run before commit" model
 *   - β DECIDE 2026-04-18 (0.91): "Guards that block, not guards that mutate"
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, ".claude", "framework-manifest.json");

// Phase 1C — manifest schema v2.
// Each asset gains:
//   id              stable identity for diffing across renames: <kind>.<scope>.<name>
//   sha256          full 64-char sha256 (LF-normalized for text assets,
//                   raw for binary). Pre-0.7.0 capsules emitted a 12-char
//                   prefix; read-path back-compat lives in update.js via
//                   hashMatches. T-20260514-070 dropped the .slice(0, 12)
//                   truncation here.
//   mergeStrategy   how /warp:update reconciles upstream changes for this asset
//   owner           framework | generated | runtime | project (lifecycle policy)
//   introducedIn    semver where it first shipped (read from version.json or "0.0.0")
//   removedIn       null while alive
//   replaces        previous id if this entry was renamed
const MANIFEST_SCHEMA_VERSION = "mc/framework-manifest/v2";

// EXCLUDE_GLOBS — tree paths the generator must skip when walking ASSET_DIRS.
// Phase 1C bug fix: dispatch-backups was being included, blowing up the asset
// list with stale snapshots. Run-level retros are also runtime-only.
// Phase 4J (2026-04-30): broadened to cover every per-project runtime
// surface so /warp:promote sees a clean framework-only manifest.
const EXCLUDE_RELATIVE_PREFIXES = [
  // Existing exclusions
  ".claude/agents/.system/dispatch-backups/",
  // SP-20260723-005 (β B/0.88): builder-right-size is canonical-only (a build-chain prompt-size heuristic,
  // dev-tooling, NOT invoked by any shipped skill) — exclude it from the scripts/enforcement dir-ship so it
  // stays out of product installs. Classified in KNOWN_NOT_SHIPPED (mc-ship-coverage.js). The prefix
  // covers both builder-right-size.js and builder-right-size.test.js.
  "scripts/enforcement/builder-right-size",
  // ADR-0007: oneshot runtime state moved under president/_system/oneshot/.
  ".claude/agents/president/_system/oneshot/retros/",
  ".claude/agents/president/_system/oneshot/store.json", // per-project state
  ".claude/agents/president/_system/oneshot/store.json.prev-run-backup.json",
  // Phase 4J — runtime + per-session + per-project event/memory state
  ".claude/runtime/",
  ".claude/project/events/",
  ".claude/project/memory/",
  ".claude/runtime/dispatch/",
  ".claude/runtime/handoffs/",
  ".claude/runtime/notes/",
  ".claude/runtime/logs/",
  ".claude/.agent-result-hashes.json",
  ".claude/.last-checkpoint",
  ".claude/.session-checkpoint.json",
  ".claude/scheduled_tasks.lock",
  ".claude/agents/store.json", // alpha heartbeat marker — per-project
  ".claude/.session_index.json",
  // SP-20260514-001 R-4 / T-20260514-074 — migrations stop shipping as
  // installed assets. They are referenced via capsule release.json#migrations[]
  // and run via scripts/mc/migrations-loader.js. Including them in
  // assets[] caused the apply→flag-stale→delete→re-copy loop.
  // The canonical migration source lives at `migrations/` (top-level), not
  // `framework/migrations/` — historical path from before the framework/
  // subtree split.
  "migrations/",
];

function isExcluded(relPath) {
  // Release capsules ship their metadata, notes, and migrations. The manifest
  // snapshot and checksums inside each capsule are generated from this manifest,
  // so including them would make `manifest -> capsule -> manifest` unstable.
  if (
    /^mc\/releases\/[^/]+\/(framework-manifest|checksums)\.json$/.test(
      relPath,
    )
  ) {
    return true;
  }
  // Runtime append-only logs must NEVER ship in the capsule (W-8 class): per-agent
  // event logs (`.system/**/events.jsonl`), `maps/tools.jsonl`, skill-usage — owner=runtime
  // telemetry that got swept into the agents/maps directory walk and mislabeled
  // framework/generated. Drop by filename pattern regardless of where the walk found it.
  if (/(^|\/)(events|tools|skill-usage)\.jsonl$/.test(relPath)) {
    return true;
  }
  return EXCLUDE_RELATIVE_PREFIXES.some(
    (p) => relPath === p || relPath.startsWith(p),
  );
}

// Default mergeStrategy by kind. Per-asset overrides may be added later.
const DEFAULT_MERGE_STRATEGY = {
  agent: "three_way_markdown",
  skill: "three_way_markdown",
  reference: "three_way_markdown",
  maps_baseline: "regenerate",
  hook: "replace_if_unmodified",
  hook_lib: "replace_if_unmodified",
  tool: "replace_if_unmodified",
  top_script: "replace_if_unmodified",
  requirement: "keep_local",
  pattern: "three_way_markdown",
  framework_doc: "three_way_markdown",
  kernel: "replace_if_unmodified",
};

const DEFAULT_OWNER_BY_KIND = {
  agent: "framework",
  skill: "framework",
  reference: "framework",
  maps_baseline: "generated",
  hook: "framework",
  hook_lib: "framework",
  tool: "framework",
  top_script: "framework",
  requirement: "project",
  pattern: "framework",
  framework_doc: "framework",
  kernel: "framework",
};

// SP-20260514-001 R-1 / T-20260514-070 — full 64-char sha256 via the central
// content-hash module. Text assets are LF-normalized (extension allowlist);
// binary assets get rawHash. destPath governs the classification so the
// semantics travel with the on-disk path, not the canonical source path.
const cHash = require("./mc/lib/content-hash");

function sha256OfFile(absPath, destPath) {
  if (cHash.isTextAsset(destPath || absPath)) {
    return cHash.contentHash(absPath, { text: true });
  }
  return cHash.rawHash(absPath);
}

// Stable id: <kind>.<scope>.<name>. Scope is the relative path with the kind's
// root stripped and slashes flattened to dots. Extension is preserved when it
// disambiguates (e.g. .md vs .jsonl maps share the same stem under
// .claude/project/maps/) — without it, ids collide across kinds with parallel
// formats.
function idForAsset(kind, srcRel, srcRoot) {
  const stripped = srcRel.replace(srcRoot + "/", "");
  const scope = stripped.replace(/\//g, ".");
  return `${kind}.${scope}`;
}

// ── What counts as a shippable asset ────────────────────
// Directories the manifest enumerates, and the kind label for each.
const ASSET_DIRS = [
  { src: ".claude/agents", kind: "agent" },
  { src: ".claude/commands", kind: "skill" },
  // SP-20260718-001 Phase 0 (β Q1 manifest-walker check): the kernel governance
  // home (Top-Level Runtime Contract + JSON companions + conformance fixtures)
  // was previously NOT enumerated by any ASSET_DIRS entry — a silent-drop gap,
  // not a dot-dir skip (the walker has no dot-dir special-case at all; it
  // simply never visited .claude/kernel because nothing named it as a root).
  // Without this entry the kernel contract could drift untracked by
  // shipping/update — exactly what Phase 0 exists to prevent.
  { src: ".claude/kernel", kind: "kernel" },
  { src: ".claude/project/reference", kind: "reference" },
  { src: ".claude/project/maps", kind: "maps_baseline" },
  { src: "scripts/hooks", kind: "hook" }, // refined to hook_lib by path below
  { src: "scripts/tools", kind: "tool" },
  // NOTE: '_requirements/' is INTENTIONALLY NOT shipped from canonical to product
  // installs. It is product-owned content under owner='project' / merge='keep_local'.
  // The old `{ src: 'requirements', kind: 'requirement' }` entry pointed at a
  // directory that no longer exists (renamed to '_requirements/') AND would have
  // leaked the maintainer's product specs into every install if it had matched.
  // See /warp:flag F-20260521 — manifest-install-gap for context.
  { src: "patterns", kind: "pattern" },
  { src: "fixtures/hooks", kind: "fixture" },
  { src: "fixtures/install-empty-next-app", kind: "fixture" },
  { src: "fixtures/update-from-0.0.0-clean", kind: "fixture" },
  { src: "fixtures/update-from-0.0.0-customized-claude-md", kind: "fixture" },
  // Phase 4 codex review fix-forward (2026-04-30): the engines + capsules +
  // schemas + migrations Phase 4 introduced were NOT shipped by the installer.
  // /warp:update couldn't materialize them because they weren't in the
  // manifest. Now they are.
  { src: "scripts/mc", kind: "mc_script" },
  { src: "scripts/checks", kind: "check_tool" },
  // SP-20260723-005 (β B/0.88): ship the /scan:full-invoked enforcement lints so a product's scaffolded
  // full.md (which invokes betaevents-dedup-lint / ed-dup-id-lint / pipe-masks-gate-lint) + /enforcement:log
  // (invokes next-ed-id) don't reference a missing script. They SKIP on an absent MC ledger (product
  // state). builder-right-size (a build-chain prompt-size heuristic, NOT invoked by any shipped skill) is
  // EXCLUDED below + KNOWN_NOT_SHIPPED (canonical-only, dev-tooling).
  { src: "scripts/enforcement", kind: "check_tool" },
  { src: "scripts/agents", kind: "agent_tool" },
  { src: "scripts/decisions", kind: "decision_tool" },
  { src: "scripts/runtime", kind: "runtime_tool" },
  { src: "scripts/memory", kind: "memory_tool" },
  { src: "scripts/security", kind: "security_tool" },
  { src: "scripts/deps", kind: "dependency_tool" },
  { src: "scripts/timeline", kind: "timeline_tool" },
  { src: "scripts/budgets", kind: "budget_tool" },
  { src: "scripts/self-mod", kind: "self_mod_tool" },
  { src: "scripts/preflight", kind: "preflight_tool" },
  { src: "scripts/requirements", kind: "requirements_engine" },
  { src: "scripts/paths", kind: "paths_engine" },
  // 0.4.2 fix-forward: scripts/sprint/ (Sprint Workflow v0.1 engine) and
  // scripts/dispatch/ (dispatch infrastructure) were missing from the
  // scan list — so product repos installing 0.4.0/0.4.1 received the
  // slash commands but not the backing scripts. Adding both as
  // first-class kinds.
  { src: "scripts/sprint", kind: "sprint_engine" },
  { src: "scripts/trackers", kind: "tracker_tool" },
  { src: "scripts/dispatch", kind: "dispatch_engine" },
  // 0.8.2 fix-forward (2026-05-21): 15 scripts subdirs shipped slash commands
  // that referenced backing scripts under these dirs, but the dirs were never
  // classified — so /warp:setup installed the .md skills with no backing logic.
  // A consumer install surfaced this by failing /mode:adhoc --turbo (missing
  // scripts/turbo/apply.js) and /portfolio:* (missing scripts/portfolio/).
  // The 17 dirs on disk are split as follows:
  //   SHIP (15): the dirs below
  //   EXCLUDE (2): scripts/one-off/ + scripts/products/ — framework-dev artifacts
  //                (e.g. append-beta-event-007.js, _log-alpha-followup-decisions.js)
  { src: "scripts/check", kind: "check_runner_tool" },
  { src: "scripts/docs", kind: "docs_tool" },
  { src: "scripts/events", kind: "events_tool" },
  // SP-20260718-002 C2: scripts/state backs the materialized-state engine
  // (materialize-core primitive + what-running/what-happened). Registered so the
  // new state scripts are hash-tracked in the framework manifest (AC-13 / QA-3).
  { src: "scripts/state", kind: "state_tool" },
  { src: "scripts/fix-deep", kind: "fix_deep_tool" },
  { src: "scripts/learn", kind: "learn_tool" },
  // E4 (M1 §8): scripts/skills backs the skill→agent hook-points registry +
  // resolver (skill-hook-points.js) + its bite-test — framework logic the
  // migrated skills and scan:skill-hook-coverage rely on, so it must ship.
  // (Latent unshipped gap from the E4 land, caught here by ship-coverage.)
  { src: "scripts/skills", kind: "skills_tool" },
  // E5 (_knowledge layer): scripts/knowledge backs the knowledge registry
  // engine + the knowledge-coverage enforcer (runs in products via scan:full).
  { src: "scripts/knowledge", kind: "knowledge_tool" },
  { src: "scripts/lib", kind: "script_lib" },
  { src: "scripts/linters", kind: "linter_tool" },
  { src: "scripts/manifest", kind: "manifest_tool" },
  { src: "scripts/maps", kind: "maps_tool" },
  { src: "scripts/portfolio", kind: "portfolio_tool" },
  { src: "scripts/product", kind: "product_tool" },
  { src: "scripts/research", kind: "research_tool" },
  { src: "scripts/schemas", kind: "schema_tool" },
  { src: "scripts/system", kind: "system_tool" },
  { src: "scripts/turbo", kind: "turbo_tool" },
  // 2026-06-10 fix-forward (E-LIFECYCLE-001 Wave 1 tail): scripts/teams/ (the
  // S-LC-05 persistent-team lifecycle manager, lifecycle.js) was added without
  // being classified — so the SHIPPED SessionEnd teardown hook
  // (session-end-team-teardown.js) would have had no backing lifecycle.js
  // downstream. ship-coverage caught it (framework-owned, unshipped, unallowlisted)
  // during the Wave 3 build. It must ship.
  { src: "scripts/teams", kind: "team_tool" },
  { src: "scripts/epic", kind: "epic_tool" }, // S-LC-09 epic-suite backing (plan.js/fold.js/lib.js) for /epic:plan + /epic:fold; must ship (Wave-3, 2026-06-10)
  // 2026-06-16 fix-forward (ship-coverage RED, caught by the roadmap-state-honesty audit):
  // the panels (SP-20260615-001/002), cockpit (/cockpit:readiness), and admin:* (SP-20260614-002)
  // sprints added backing scripts + panel registries but never classified them — so the SHIPPED
  // /panel:*, /cockpit:readiness, and /admin:* skills had no backing logic downstream, and
  // mc-ship-coverage exited 1 (2 essential-root registries + 7 framework-owned scripts shipping
  // to nobody). E-CONTENT-DELIVERY DoD#2 (ship-coverage GREEN) was OVERSTATED until this. They must ship.
  { src: "scripts/panel", kind: "panel_tool" },     // /panel:* unified opener namespace (list.js/roadmap.js/roadmap-gui.js)
  { src: "scripts/cockpit", kind: "cockpit_tool" }, // /cockpit:readiness board (readiness-board.js + its .test.js, mirroring scripts/checks)
  { src: "scripts/admin", kind: "admin_tool" },     // admin:* suite backing (preview.js/seed.js) for /admin:preview etc.
  { src: "framework/panel-registry.json", kind: "panel_registry" },             // /panel:* synonym-layer registry (consumed by the forwarders + /panel:list)
  { src: "framework/admin-panel-registry.json", kind: "admin_panel_registry" }, // admin:* panel registry (alias-beside panel-registry.json)
  // 2026-05-30 reconcile (gap E3, multiple downstream registers): bootstrap:spinup
  // + canon skills shipped their .md but NOT their backing scripts (spinup-orchestrate.js,
  // phases/onscreen.js, canon/generate.js) — so every consumer got DEAD skills. These
  // two dirs were never classified. Shipping them closes the skill↔script gap.
  { src: "scripts/bootstrap", kind: "bootstrap_tool" },
  { src: "scripts/canon", kind: "canon_tool" },
  { src: "schemas", kind: "schema" },
  // SP-20260718-005 BE-1/BE-3 (INC-2.5 / ED-249): the machine-readable schema
  // contracts under .claude/schemas/ (workorder-min.schema.json — the shape
  // scripts/dispatch/workorder-schema.js mirrors by hand). Same silent-drop gap
  // the .claude/kernel entry fixed: no ASSET_DIRS root visited .claude/schemas,
  // so it shipped to nobody and its build.js framework classification pointed at
  // an un-mirrored _mc/schemas/ source. Placed adjacent to the top-level
  // `schemas` root (same `schema` kind) so regen adds entries without reordering
  // the kind-keyed output. Enumerated here so it ships + mirrors.
  { src: ".claude/schemas", kind: "schema" },
  { src: "migrations", kind: "migration" },
  { src: "framework/releases", kind: "release_capsule" },
  { src: "framework/paths.registry.json", kind: "paths_registry" },
  // SP-20260525-024 (downstream ship-coverage fix): the templates/* are
  // GENERIC framework templates (canon doc templates the canon engine renders,
  // product-bootstrap/clone/import, portfolio, sprint *.tmpl) — owner=framework,
  // no product content (framework-purity-guard enforces). They were NEVER
  // shipped, so every consumer's /bootstrap:spinup + /sprint:* + /canon hit
  // missing templates. hooks.registry.json is the hook source-of-truth the hook
  // build reads; also absent. Both surfaced by the ship-coverage enforcer.
  // SP-20260618-001: migrated framework/templates → _mc/templates (the
  // SP-20260522-001 end-state home; framework/templates deleted in the same sprint).
  { src: "_mc/templates", kind: "template" },
  // 2026-06-06: trackers/templates/* are the enforced-tracker (Epic) system's
  // reusable scaffolding templates — owner=framework (build.js
  // framework-trackers-templates rule). The tracker validator (validate.js §33)
  // demands them, but before this they shipped to nobody: a consumer that
  // updated to the tracker system got the validator with no templates + no way
  // to scaffold ("shipped the referee, not the field"; mc-enforcer-shippability).
  // /trackers:init consumes these downstream.
  { src: "trackers/templates", kind: "template" },
  { src: "framework/hooks.registry.json", kind: "hooks_registry" },
  // SP-20260531-002 (ADR-0005): `_guides/` ships MC-authored,
  // product-facing launch guides (e.g. DEV_SETUP_GUIDE.md) to consumer products.
  // owner=framework + managed=true (build.js framework-guides-dir rule); the
  // fail-closed ship boundary is asserted by scan:mc-ship-coverage.
  { src: "_guides", kind: "guide" },
  // E5 / ADR-0007: `_knowledge/` is the shared agent-grounding knowledge layer
  // (the company "brain" — the design-principles guide library + per-domain
  // knowledge stores). Ships as framework content like `_guides/`; the build.js
  // framework-knowledge-dir rule sets owner=framework + managed=true. The design
  // library migrated here from `_guides/design/` (E5/M3).
  { src: "_knowledge", kind: "knowledge" },
];

// Top-level scripts (peers of scripts/hooks/, scripts/tools/).
const TOP_LEVEL_SCRIPTS = [
  { src: "scripts/path-lint.js", kind: "top_script" },
  { src: "scripts/dispatch-agent.js", kind: "top_script" },
  { src: "scripts/generate-maps.js", kind: "top_script" },
  // T-20260610-296 (Lane A class-closer): generate-steps-maps.js is mandated by the
  // pre-commit-steps-check.js guard ("node scripts/generate-steps-maps.js --check")
  // but was absent from the ship payload — the same closed-trap class as WG-1, surfaced
  // by the new --ship-coverage assertion. It is a top-level peer of generate-maps.js.
  { src: "scripts/generate-steps-maps.js", kind: "top_script" },
  { src: "scripts/generate-framework-manifest.js", kind: "top_script" },
  // 0.8.2 fix-forward (2026-05-21): mode-set.js backs /mode:* skills (adhoc/oneshot/solo).
  // a consumer install couldn't run /mode:adhoc --turbo because this file wasn't classified.
  { src: "scripts/mode-set.js", kind: "top_script" },
  // SP-20260718-002 C2 (gauntlet R3 / QA-3): materialize-decisions.js is a top-level
  // delivery script the sprint MODIFIED (routed through scripts/state/materialize-core
  // — AC-7). It was never enumerated, so the modification (and its new test) were not
  // shipped. Enumerate both so the framework generator tracks + ships them.
  { src: "scripts/materialize-decisions.js", kind: "top_script" },
  { src: "scripts/materialize-decisions.test.js", kind: "top_script" },
  // WG-1 (T-20260610-292): dispatch-claude.js is the MANDATORY build-chain dispatch
  // wrapper (reap-guarded) for all Claude builder/fixer roles. The dispatch guides
  // instruct products to use `node scripts/dispatch-claude.js <role> <prompt-file> -w`
  // for every build-chain invocation — without this entry it never reached product installs,
  // creating a closed trap (guide mandates a file the installer never shipped).
  // Note: scripts/dispatch/dispatch-claude.test.js ships via the scripts/dispatch/ dir
  // walk (kind: dispatch_engine) — no duplicate entry needed here.
  { src: "scripts/dispatch-claude.js", kind: "top_script" },
  // dispatch-skill.js + dispatch-review.js are peer dispatch wrappers referenced by
  // SHIPPED scan skills (scan/full.md → dispatch-review.js; scan/admin-suite-coverage.md
  // + scan/panel-registry-coverage.md → dispatch-skill.js). Without these entries the
  // shipped skills reference scripts the installer never shipped — the same closed-trap
  // class as WG-1 (dispatch-claude.js), surfaced by release-build's dangling-ref check
  // at the 0.17.0 release. Same class as dispatch-claude/agent: ship them.
  { src: "scripts/dispatch-skill.js", kind: "top_script" },
  { src: "scripts/dispatch-review.js", kind: "top_script" },
  // SP-20260718-003 D4 (gauntlet R1 / QA-007 · AC-19): the ED-205 run-opts regression guard is a NEW
  // top-level test. Top-level scripts/*.test.js are NOT auto-walked (only scripts/<subdir> is), so a new
  // top-level test must be enumerated here or it stays un-hash-tracked (the AC-19 all-new-scripts gap).
  { src: "scripts/dispatch-agent-model-semantics.test.js", kind: "top_script" },
  // warp-setup.js is NOT shipped to target projects — it's the installer itself.
  //   Clients invoke it from ../MC/, not from their own scripts/.
];

// Root-level Phase 4 artifacts that ship as single files (not dirs).
const TOP_LEVEL_FRAMEWORK_FILES = [
  { src: "version.json", kind: "version_file" },
  { src: "install.ps1", kind: "installer_script" },
  { src: ".github/workflows/test.yml", kind: "ci_workflow" },
  // 2026-05-30 reconcile (gap B1): `scripts/package.json` = {"type":"commonjs"}
  // insulates every framework script + hook from a product root that declares
  // "type":"module" (WG-9/W-005 class — hit across downstream products). It existed
  // in canonical but was NEVER shipped — the generator only walks scripts/<subdir>
  // + .js TOP_LEVEL_SCRIPTS, so a scripts-root non-.js file had no path to inclusion.
  // Enumerating it here ships + honesty-tracks the insulation for every product.
  { src: "scripts/package.json", kind: "module_scope" },
];

// Root-level docs installed into the target project root (not into .claude/).
const FRAMEWORK_DOCS = [
  { src: "CLAUDE.md", dest: "CLAUDE.md", merge: "append-if-exists" },
  { src: "AGENTS.md", dest: "AGENTS.md", merge: "append-if-exists" },
  // Provider-entrypoint shims for non-Claude executors. The ownership manifest treats
  // them as the same root-doc class as CLAUDE.md/AGENTS.md, so they must ship too.
  { src: "CODEX.md", dest: "CODEX.md", merge: "append-if-exists" },
  // ANTIGRAVITY.md (agy) — SP-20260723-001 / ADR-0036, same executor-entrypoint class
  // as CODEX.md. The GEMINI.md sunset-redirect shim was deleted per the ADR-0036
  // removal-trigger (E-OPEN-SOURCE-001 S-OS-05); Gemini-family work routes through agy.
  { src: "ANTIGRAVITY.md", dest: "ANTIGRAVITY.md", merge: "append-if-exists" },
  // ADR-0007: org-structure companion to AGENTS.md, referenced from CLAUDE.md.
  // Ships to consumer roots like AGENTS.md so the agent-tree doc travels with
  // the org doc it complements.
  { src: "AGENT-STRUCTURE.md", dest: "AGENT-STRUCTURE.md", merge: "append-if-exists" },
];

// Files the installer GENERATES at install time (not copied from source).
// Each entry lists the output path + the name of the code block that builds it.
// These are declarative markers — the installer code still writes the logic,
// but the manifest declares what outputs must exist post-install.
const GENERATED_FILES = [
  { dest: ".claude/paths.json", builder: "paths-builder" },
  { dest: ".claude/manifest.json", builder: "manifest-builder" },
  { dest: ".claude/agents/store.json", builder: "store-builder" },
  { dest: ".claude/project/memory/events.jsonl", builder: "empty-file" },
  { dest: ".claude/project/memory/learnings.jsonl", builder: "empty-file" },
  { dest: ".claude/project/memory/traces.jsonl", builder: "empty-file" },
  { dest: ".claude/project/memory/systems.jsonl", builder: "systems-seeder" },
  {
    dest: ".claude/settings.json",
    builder: "settings-merger",
    idempotent: true,
  },
  { dest: ".gitignore", builder: "gitignore-block-appender", idempotent: true },
];

// Refine kind labels based on file path — e.g. files inside scripts/hooks/lib/
// are hook_lib, not hook. Keeps category-level counts accurate for the installer.
function refineKind(baseKind, relPath) {
  if (baseKind === "hook" && relPath.includes("scripts/hooks/lib/")) {
    return "hook_lib";
  }
  return baseKind;
}

// ── Walker ──────────────────────────────────────────────
// Skips EXCLUDE_RELATIVE_PREFIXES (dispatch-backups, retros, oneshot store).
function walkDir(absDir, relBase = "", srcRoot = "") {
  const out = [];
  if (!fs.existsSync(absDir)) return out;
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const abs = path.join(absDir, entry.name);
    const rel = path.join(relBase, entry.name).replace(/\\/g, "/");
    const fullRel = srcRoot ? `${srcRoot}/${rel}` : rel;
    if (isExcluded(fullRel)) continue;
    if (entry.isDirectory()) {
      out.push(...walkDir(abs, rel, srcRoot));
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

function decorateAsset(asset) {
  const kind = asset.kind;
  const absSrc = path.join(ROOT, asset.src);
  const id = idForAsset(
    kind,
    asset.src,
    asset.srcRoot || asset.src.split("/")[0],
  );
  const sha256 = fs.existsSync(absSrc)
    ? sha256OfFile(absSrc, asset.dest || asset.src)
    : null;
  const owner = asset.owner || DEFAULT_OWNER_BY_KIND[kind] || "framework";
  const mergeStrategy =
    asset.mergeStrategy ||
    asset.merge ||
    DEFAULT_MERGE_STRATEGY[kind] ||
    "replace_if_unmodified";
  return {
    id,
    src: asset.src,
    dest: asset.dest,
    kind,
    sha256,
    owner,
    mergeStrategy,
    introducedIn: asset.introducedIn || "0.0.0",
    removedIn: asset.removedIn || null,
    replaces: asset.replaces || null,
    ...(asset.merge ? { merge: asset.merge } : {}),
  };
}

function collectAssets() {
  const assets = [];
  for (const dir of ASSET_DIRS) {
    const abs = path.join(ROOT, dir.src);
    if (!fs.existsSync(abs)) continue;
    // Phase 4 fix-forward: ASSET_DIRS may now point at single files (e.g.
    // framework/paths.registry.json), not just directories. Handle both.
    const stat = fs.statSync(abs);
    if (stat.isFile()) {
      if (isExcluded(dir.src)) continue;
      assets.push({
        src: dir.src,
        dest: dir.src,
        kind: refineKind(dir.kind, dir.src),
        srcRoot: path.posix.dirname(dir.src),
      });
      continue;
    }
    const files = walkDir(abs, "", dir.src);
    for (const f of files) {
      const fullRel = `${dir.src}/${f}`;
      if (isExcluded(fullRel)) continue;
      assets.push({
        src: fullRel,
        dest: fullRel,
        kind: refineKind(dir.kind, fullRel),
        srcRoot: dir.src,
      });
    }
  }
  for (const t of TOP_LEVEL_SCRIPTS) {
    if (fs.existsSync(path.join(ROOT, t.src))) {
      assets.push({
        src: t.src,
        dest: t.src,
        kind: t.kind,
        srcRoot: "scripts",
      });
    }
  }
  // Phase 4 fix-forward: top-level framework files (version.json, install.ps1)
  if (typeof TOP_LEVEL_FRAMEWORK_FILES !== "undefined") {
    for (const t of TOP_LEVEL_FRAMEWORK_FILES) {
      if (fs.existsSync(path.join(ROOT, t.src))) {
        assets.push({
          src: t.src,
          dest: t.src,
          kind: t.kind,
          srcRoot: "",
        });
      }
    }
  }
  for (const d of FRAMEWORK_DOCS) {
    if (fs.existsSync(path.join(ROOT, d.src))) {
      assets.push({
        src: d.src,
        dest: d.dest,
        kind: "framework_doc",
        merge: d.merge,
        srcRoot: "",
      });
    }
  }
  return assets.map(decorateAsset);
}

// ── Exports (for unit tests and release-build gate) ──────────────────────────
// isExcluded is exported so release-build.js#runtimeExclusionGate can apply
// the SAME exclusion predicate the generator uses, without duplicating the
// regex. Keeping them in sync here (single source of truth) is the whole point.
// RUNTIME_JSONL_PATTERN is the filename pattern for owner=runtime append-only
// logs that must NEVER ship in a capsule (W-8 class, events/tools/skill-usage).
// FIX2: separator-agnostic ([\\/] matches both / and \) + case-insensitive flag.
// A Windows-style path like beta\events.jsonl would evade a /\/-only pattern.
// The /i flag catches events.JSONL etc. (CWE-436 evasion hardening, SP-0181 E1).
const RUNTIME_JSONL_PATTERN = /(^|[\\/])(events|tools|skill-usage)\.jsonl$/i;

module.exports = { isExcluded, RUNTIME_JSONL_PATTERN };

// ── Build manifest ──────────────────────────────────────
if (require.main === module) {
  const assets = collectAssets();

  // Group by kind for human readability. Within a kind, sort by src path.
  const byKind = {};
  for (const a of assets) {
    (byKind[a.kind] = byKind[a.kind] || []).push(a);
  }
  for (const kind of Object.keys(byKind)) {
    byKind[kind].sort((x, y) => x.src.localeCompare(y.src));
  }

  const version = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(ROOT, "version.json"), "utf8"))
        .version;
    } catch {
      return "0.0.0";
    }
  })();

  const manifest = {
    $schema: MANIFEST_SCHEMA_VERSION,
    version,
    generated_by: "scripts/generate-framework-manifest.js",
    counts: Object.fromEntries(
      Object.entries(byKind).map(([k, v]) => [k, v.length]),
    ),
    total: assets.length,
    assets: byKind,
    generated_files: GENERATED_FILES,
  };

  // Phase 4 fix-forward (codex review 2026-04-30): honor --check flag.
  // Without this, release-gates.js gate "framework_manifest" always passes
  // while silently mutating the file under test.
  const CHECK_MODE = process.argv.includes("--check");
  const newJson = JSON.stringify(manifest, null, 2) + "\n";

  if (CHECK_MODE) {
    let existing = "";
    try {
      existing = fs.readFileSync(OUT, "utf8");
    } catch {
      console.error(
        `framework-manifest.json missing — run: node scripts/generate-framework-manifest.js`,
      );
      process.exit(1);
    }
    // Strip volatile fields (sha256 of any in-flight ts-bearing assets is fine
    // since the manifest itself has no timestamp; compare verbatim).
    if (existing !== newJson) {
      console.error(
        `framework-manifest.json is stale — run: node scripts/generate-framework-manifest.js`,
      );
      process.exit(1);
    }
    console.log(`framework-manifest.json is current.`);
    process.exit(0);
  }

  // Ensure output dir exists
  fs.mkdirSync(path.dirname(OUT), { recursive: true });

  // Stable JSON output (sorted keys at each level would be nicer, but grouping
  // by kind already gives us determinism where it matters)
  fs.writeFileSync(OUT, newJson);

  // Reporting
  const pad = (s, n) => s.padEnd(n, " ");
  console.log(`\n  MC framework manifest written`);
  console.log(`  Output: .claude/framework-manifest.json`);
  console.log(`  Version: ${version}`);
  console.log(`  Schema: ${manifest.$schema}\n`);
  console.log(`  Asset counts by kind:`);
  for (const [k, v] of Object.entries(manifest.counts).sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(`    ${pad(k, 20)} ${v}`);
  }
  console.log(`    ${pad("TOTAL", 20)} ${manifest.total}`);
  console.log(`    ${pad("+ generated", 20)} ${GENERATED_FILES.length}\n`);
}
