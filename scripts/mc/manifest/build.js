#!/usr/bin/env node
/**
 * scripts/mc/manifest/build.js — produce _mc/MANIFEST.json.
 *
 * SP-20260522-001 / T-180-followup. Walks the canonical framework source
 * tree, classifies each path's ownership (framework | generated | project
 * | runtime), computes sha256 for owner=framework entries, and emits a
 * manifest matching schemas/mc-manifest.schema.json (v1).
 *
 * Usage:
 *   node scripts/mc/manifest/build.js \
 *     [--root <dir>]               # default: repo root (process.cwd())
 *     [--out <file>]               # default: <root>/_mc/MANIFEST.json
 *     [--source-prefix <dir>]      # default: framework  (canonical-style)
 *                                  # use _mc when running in a product install
 *     [--mc-version <v>]       # default: read from <root>/version.json
 *     [--dry-run]                  # print to stdout instead of writing
 *     [--json]                     # print summary as JSON
 *
 * Default classification rules — keep these explicit so the generator's
 * output is reviewable:
 *
 *   1. Anything under `<source-prefix>/`                       → owner=framework
 *      (source path = the file itself; products inherit via /warp:update)
 *   2. `.claude/settings.json`                                 → owner=generated
 *      (compiled_from = [<source-prefix>/settings/defaults.json,
 *                        .claude/settings.local.json])
 *   3. `.claude/commands/**`, `.claude/agents/**` (excluding
 *      the .system/policy/, .system/beta/, store.json carve-outs) → owner=framework
 *      with source pointer to <source-prefix>/commands or /agents
 *   4. `.claude/agents/00-alex/.system/policy/decision-policy.md` → owner=project
 *      seeded_from = the file itself (0.16.0 prefix-drift fix: the old
 *      <source-prefix>/templates/policy/decision-policy.md never existed)
 *   5. .claude/agents/<*>/events.jsonl,
 *      .claude/agents/<*>/.workspace/,
 *      .claude/runtime/, .claude/content/,
 *      .claude/project/events/, .claude/project/memory/,
 *      .claude/.session-<*>, .claude/.store-lock,
 *      .claude/project/builds/, .claude/project/sprint/,
 *      .claude/project/decisions/, .claude/project/maps/         -> owner=runtime
 *   6. _requirements/<*>, _docs/<*>, root-level user content    -> owner=project
 *      seeded_from = the real resolvable path (0.16.0 prefix-drift fix: for
 *      _requirements/<x> this is `_requirements/<x>` itself, not the dangling
 *      `<source-prefix>/templates/_requirements/<x>` the no-op .replace() emitted)
 *
 * Anything outside these rules is reported as `unclassified` and the
 * generator refuses to write the manifest unless `--allow-unclassified`
 * is passed. Better to fail loudly than silently fork ownership.
 *
 * Exit codes:
 *   0  manifest written (or printed in dry-run)
 *   1  unclassified paths blocked the write
 *   2  CLI parse error / missing root / schema-write failure
 */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
// Lock-step source of "what is a framework VIEW" — the SAME predicate
// populate-source.js uses to decide which .claude/** dests get mirrored into a
// product's _mc/. Imported (not re-derived) so the canonical manifest's
// view-mirror exclusion below can never drift from what the installer generates.
// test-build.js §F enforces the buildRules ↔ isFrameworkViewDest lock-step.
const { isFrameworkViewDest } = require("../views/populate-source");

const SCHEMA_ID = "mc/manifest/v1";

function parseArgs(argv) {
  const out = {
    root: process.cwd(),
    outPath: null,
    sourcePrefix: "framework",
    mcVersion: null,
    dryRun: false,
    json: false,
    allowUnclassified: false,
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--root") out.root = path.resolve(argv[++i]);
    else if (a === "--out") out.outPath = argv[++i];
    else if (a === "--source-prefix") out.sourcePrefix = argv[++i];
    else if (a === "--mc-version") out.mcVersion = argv[++i];
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--json") out.json = true;
    else if (a === "--allow-unclassified") out.allowUnclassified = true;
  }
  return out;
}

function printHelp() {
  process.stdout.write(`
scripts/mc/manifest/build.js — produce _mc/MANIFEST.json

Usage:
  node scripts/mc/manifest/build.js [flags]

Flags:
  --root <dir>            walk this dir (default: cwd)
  --out <file>            manifest destination (default: <root>/_mc/MANIFEST.json)
  --source-prefix <dir>   framework source dir (default: framework; products use _mc)
  --mc-version <v>    pin manifest's mcVersion (default: read version.json)
  --dry-run               print to stdout, no write
  --json                  emit summary as JSON
  --allow-unclassified    write manifest even with unclassified paths (NOT RECOMMENDED)
  --help, -h              show this message

Schema: schemas/mc-manifest.schema.json (v1)
`);
}

// ── Classification rules ─────────────────────────────────────────────

/**
 * Build the rule set as an ordered array of predicates. Each rule returns
 * a partial pathEntry (without sha256/installedSha; those are filled by
 * the walker) or null if the path doesn't match.
 *
 * Order matters — first match wins. More specific rules MUST appear
 * before more general ones.
 */
function buildRules(sourcePrefix) {
  return [
    // RUNTIME — most specific first
    {
      name: "runtime-session-files",
      match: (rel) =>
        /^\.claude\/\.(session-id|session-prompts\.log|session-tracking\.jsonl|session-checkpoint\.json|session-start-commit|store-lock|agent-result-hashes\.json|last-checkpoint)$/.test(
          rel,
        ),
      entry: () => ({ owner: "runtime", managed: false }),
    },
    {
      name: "runtime-agent-events",
      match: (rel) =>
        rel.startsWith(".claude/agents/") &&
        (rel.endsWith("/events.jsonl") ||
          rel.endsWith("/.system/events.jsonl")),
      entry: () => ({
        owner: "runtime",
        managed: false,
        kind: "jsonl",
      }),
    },
    {
      name: "runtime-agent-workspace",
      match: (rel) => /^\.claude\/agents\/[^\/]+\/\.workspace\//.test(rel),
      entry: () => ({ owner: "runtime", managed: false, kind: "dir" }),
    },
    {
      name: "runtime-claude-buckets",
      match: (rel) =>
        rel.startsWith(".claude/runtime/") ||
        rel.startsWith(".claude/content/") ||
        rel.startsWith(".claude/project/events/") ||
        rel.startsWith(".claude/project/memory/") ||
        rel.startsWith(".claude/project/builds/") ||
        rel.startsWith(".claude/project/decisions/") ||
        rel.startsWith(".claude/project/maps/") ||
        rel.startsWith(".claude/project/sprint/") ||
        rel.startsWith(".claude/project/etc/") || // S0.4: /etc eval-packs + emitted decision_records — per-product mutable state, not shipped

        rel.startsWith(".claude/logs/") || // manifest classifier matches this prefix by design; path-literal-allowed
        rel.startsWith(".claude/handoffs/") || // manifest classifier matches this prefix by design; path-literal-allowed
        rel === ".claude/handoff.md",
      entry: () => ({ owner: "runtime", managed: false }),
    },
    {
      name: "runtime-mc-transactions",
      match: (rel) => rel.startsWith(".mc/"),
      entry: () => ({ owner: "runtime", managed: false }),
    },
    {
      // Build-system state created by warp-setup.js (NOT shipped via the
      // framework-manifest). Explicitly a carve-out from owner=framework per
      // this file's header. Mutable; never regenerated. Present in every
      // installed product, absent in canonical — so without this rule a
      // product manifest build fails with store.json unclassified.
      name: "runtime-build-store",
      match: (rel) => rel === ".claude/agents/store.json",
      entry: () => ({
        owner: "runtime",
        managed: false,
        kind: "json",
        _note: "Build-mode state — created/mutated by warp-setup.js + dispatch. Not a framework view.",
      }),
    },
    // PROJECT — decision policy + filled requirement templates
    {
      name: "project-decision-policy",
      match: (rel) =>
        rel ===
        ".claude/agents/president/_system/policy/decision-policy.md",
      entry: () => ({
        owner: "project",
        managed: false,
        // seeded_from must resolve to a real on-disk path (0.16.0 prefix-drift fix).
        // The old `${sourcePrefix}/templates/policy/decision-policy.md` dangled —
        // `framework/templates/policy/` never existed. The honest seed source is the
        // matched file itself. (SP-20260618-001: NOT flipped to `_mc/templates/` —
        // policy/ is not one of the 9 template categories under _mc/templates, so a
        // flip would re-introduce a dangle. The matched file is the permanent seed source.)
        // ADR-0007: policy moved 00-alex/.system → president/_system.
        seeded_from: ".claude/agents/president/_system/policy/decision-policy.md",
        class: "fillable",
      }),
    },
    {
      name: "project-requirements",
      match: (rel) => rel.startsWith("_requirements/"),
      entry: (rel) => ({
        owner: "project",
        managed: false,
        // 0.16.0 prefix-drift fix: the old value was
        // `${sourcePrefix}/templates/${rel.replace(/^_requirements\//,"_requirements/")}`
        // — the .replace() was a NO-OP, so it emitted `framework/templates/_requirements/<rest>`,
        // a path that never existed (the "100 dangling seeded_from"). `rel` itself
        // (`_requirements/<rest>`) is the real, resolvable seed source. (SP-20260618-001:
        // NOT flipped to `_mc/templates/_requirements/` — _mc/templates contains
        // only the 9 template categories, no _requirements/ subtree, so a flip would dangle.)
        seeded_from: rel,
        class: "fillable",
      }),
    },
    {
      name: "project-docs",
      match: (rel) =>
        rel.startsWith("_docs/") &&
        !rel.startsWith("_docs/briefs/") &&
        !rel.startsWith("_docs/clones/") &&
        !rel.startsWith("_docs/imports/"),
      entry: () => ({
        owner: "project",
        managed: false,
        class: "reference",
      }),
    },
    {
      name: "project-portfolio-output",
      match: (rel) =>
        rel.startsWith("_docs/briefs/") ||
        rel.startsWith("_docs/clones/") ||
        rel.startsWith("_docs/imports/"),
      entry: () => ({
        owner: "project",
        managed: false,
        class: "data",
      }),
    },

    // GENERATED — settings.json (compiled from layered inputs)
    {
      name: "generated-settings",
      match: (rel) => rel === ".claude/settings.json",
      entry: () => ({
        owner: "generated",
        managed: false,
        compiled_from: [
          `${sourcePrefix}/settings/defaults.json`,
          ".claude/settings.local.json",
        ],
        compiler: "scripts/mc/settings/compile.js",
        kind: "json",
      }),
    },
    {
      name: "generated-paths-json",
      match: (rel) => rel === ".claude/paths.json",
      entry: () => ({
        owner: "generated",
        managed: false,
        compiled_from: [`${sourcePrefix}/paths.registry.json`],
        compiler: "scripts/paths/build.js",
        kind: "json",
      }),
    },
    {
      name: "generated-framework-manifest-legacy",
      match: (rel) => rel === ".claude/framework-manifest.json",
      entry: () => ({
        owner: "generated",
        managed: false,
        compiled_from: [`${sourcePrefix}/`],
        compiler: "scripts/generate-framework-manifest.js",
        kind: "json",
        _note: "Legacy v0.x manifest. Will be superseded by _mc/MANIFEST.json in v1.0.",
      }),
    },
    {
      name: "generated-framework-installed",
      match: (rel) => rel === ".claude/framework-installed.json",
      entry: () => ({
        owner: "generated",
        managed: false,
        compiled_from: [".claude/framework-manifest.json"],
        compiler: "scripts/warp-setup.js",
        kind: "json",
        _note: "Per-install snapshot of what was copied to this project at /warp:setup time. Will be folded into _mc/MANIFEST.json#paths.*.installedSha in v1.0.",
      }),
    },
    {
      name: "generated-project-manifest",
      match: (rel) => rel === ".claude/manifest.json",
      entry: () => ({
        owner: "generated",
        managed: false,
        compiled_from: ["scripts/dispatch/providers.js"],
        compiler: "scripts/warp-setup.js",
        kind: "json",
        _note: "Project identity card — metadata, features, providers. Seeded at install with DEFAULT_AGENT_PROVIDERS.",
      }),
    },
    {
      name: "project-settings-local",
      match: (rel) => rel === ".claude/settings.local.json",
      entry: () => ({
        owner: "project",
        managed: false,
        class: "config",
        _note: "Per-project override layer for the three-layer settings compiler. Edit THIS file; .claude/settings.json is generated.",
      }),
    },

    // FRAMEWORK — generated view (.claude/commands/, .claude/agents/) mirroring source
    //
    // Source-pointer semantics:
    //   - In CANONICAL (sourcePrefix=framework): the file at `.claude/commands/foo.md`
    //     IS the source (canonical has no separate `framework/commands/` mirror yet).
    //     Source pointer is self-referential; the regenerator no-ops.
    //   - In PRODUCT (sourcePrefix=_mc): the source lives at
    //     `_mc/commands/foo.md` (populated by /warp:setup from canonical).
    //     Regenerator copies source → .claude/commands/foo.md.
    {
      name: "framework-claude-command",
      match: (rel) =>
        rel.startsWith(".claude/commands/") && rel.endsWith(".md"),
      entry: (rel) => ({
        owner: "framework",
        managed: true,
        source:
          sourcePrefix === "framework"
            ? rel
            : `${sourcePrefix}/${rel.replace(/^\.claude\//, "")}`,
        kind: "md",
      }),
    },
    {
      name: "framework-claude-agent",
      match: (rel) =>
        rel.startsWith(".claude/agents/") &&
        rel.endsWith(".md") &&
        !rel.includes("/.system/policy/decision-policy.md"),
      entry: (rel) => ({
        owner: "framework",
        managed: true,
        source:
          sourcePrefix === "framework"
            ? rel
            : `${sourcePrefix}/${rel.replace(/^\.claude\//, "")}`,
        kind: "md",
      }),
    },
    {
      // Org-governance machine-readable data under .claude/agents/_*/ (ADR-0007:
      // moved out of 03-managers/ to the agents root — _org/role-registry.json,
      // _org/org-map.json, _principles/registry.json, _evals/*.json) — framework
      // source. The framework-claude-agent rule above only matches .md, so these
      // .json data files would otherwise be unclassified (S0.1). Any .md in these
      // dirs is already caught by the .md rule above (first-match-wins); this
      // catches the .json data.
      name: "framework-manager-data",
      match: (rel) =>
        /^\.claude\/agents\/_(org|principles|evals)\//.test(rel),
      entry: (rel) => ({
        owner: "framework",
        managed: true,
        source:
          sourcePrefix === "framework"
            ? rel
            : `${sourcePrefix}/${rel.replace(/^\.claude\//, "")}`,
        kind: rel.endsWith(".json") ? "json" : "md",
      }),
    },
    {
      // Agent `_system/` machine-readable data: policy/*.json + *.schema.json
      // under .claude/agents/**/_system/ (e.g. president/_system/policy/
      // sprint-routing.json, provider-fallback.json, skill-frontmatter.schema.json).
      // Framework source — canonical defines them and they ship to products,
      // analogous to framework-manager-data for _org/_principles/_evals. The
      // framework-claude-agent rule above is .md-only, and project-decision-policy
      // carves out ONLY decision-policy.md (project/fillable — the user's policy);
      // these .json data files would otherwise be unclassified (RI-003 fix,
      // 2026-06-09). `_system/events.jsonl` is already caught by runtime-agent-events
      // above (first-match-wins). NOTE: sprint-routing/sprint-full-autonomy are
      // operator-tunable; if a product needs them preserved across /warp:update,
      // reclassify those two as project/fillable (a later refinement).
      name: "framework-agent-system-data",
      match: (rel) =>
        /^\.claude\/agents\/.+\/_system\//.test(rel) && rel.endsWith(".json"),
      entry: (rel) => ({
        owner: "framework",
        managed: true,
        source:
          sourcePrefix === "framework"
            ? rel
            : `${sourcePrefix}/${rel.replace(/^\.claude\//, "")}`,
        kind: "json",
      }),
    },

    // FRAMEWORK — source tree itself
    {
      name: "framework-source",
      match: (rel) => rel.startsWith(`${sourcePrefix}/`),
      entry: (rel) => ({
        owner: "framework",
        managed: true,
        source: rel,
      }),
    },
    {
      // SP-20260531-002 (ADR-0005): root-level `_guides/` is
      // MC-authored, product-facing documentation (e.g. DEV_SETUP_GUIDE.md)
      // that SHIPS to consumer products and is update-managed by /warp:update.
      // Framework content despite the root location — a deliberate ownership-model
      // precedent (root-level owner=framework). The fail-closed ship boundary is
      // asserted by scan:mc-ship-coverage (MUST_SHIP _guides/).
      name: "framework-guides-dir",
      match: (rel) => rel.startsWith("_guides/"),
      entry: (rel) => ({
        owner: "framework",
        managed: true,
        source: rel,
      }),
    },
    {
      // E5 / ADR-0007: `_knowledge/` is the shared agent-grounding knowledge
      // layer (the company "brain" — the design-principles guide library plus
      // per-domain knowledge stores). Framework content that ships to consumer
      // products like `_guides/` (owner=framework, managed=true). Migrated home
      // of the design library (was `_guides/design/`, E5/M3). The fail-closed
      // ship boundary is asserted by scan:mc-ship-coverage (MUST_SHIP).
      name: "framework-knowledge-dir",
      match: (rel) => rel.startsWith("_knowledge/"),
      entry: (rel) => ({
        owner: "framework",
        managed: true,
        source: rel,
      }),
    },
    {
      // The canonical `framework/` directory (releases, paths.registry.json,
      // migrations) ships into every product verbatim via the framework-
      // manifest. It is framework source-of-truth INDEPENDENT of --source-
      // prefix: in canonical sourcePrefix=framework so the rule above already
      // catches it, but in a product (sourcePrefix=_mc) the rule above
      // matches `_mc/` instead, leaving `framework/` unclassified. This
      // rule classifies it as self-referential framework source in both cases.
      name: "framework-canonical-dir",
      match: (rel) => rel.startsWith("framework/"),
      entry: (rel) => ({
        owner: "framework",
        managed: true,
        source: rel,
      }),
    },
    {
      name: "framework-scripts",
      match: (rel) =>
        rel.startsWith("scripts/") && !rel.startsWith("scripts/one-off/"),
      entry: (rel) => ({
        owner: "framework",
        managed: true,
        source: rel,
      }),
    },
    {
      name: "framework-schemas",
      match: (rel) => rel.startsWith("schemas/"),
      entry: (rel) => ({
        owner: "framework",
        managed: true,
        source: rel,
      }),
    },
    {
      name: "framework-root-doc",
      match: (rel) =>
        rel === "CLAUDE.md" ||
        rel === "AGENTS.md" ||
        // ADR-0007: org-structure companion doc to AGENTS.md, referenced from
        // CLAUDE.md. Framework root doc — same class as AGENTS.md.
        rel === "AGENT-STRUCTURE.md" ||
        // Provider-entrypoint shims (TRACKER fold 72801243): thin per-executor
        // entrypoints that point at the canonical docs. Same framework-root-doc
        // class as CLAUDE.md/AGENTS.md.
        rel === "CODEX.md" ||
        rel === "ANTIGRAVITY.md" ||
        // GEMINI.md (sunset tombstone, ADR-0036) was DELETED by E-OPEN-SOURCE-001 S-OS-05
        // per the ADR's removal-trigger; the Gemini family routes through ANTIGRAVITY.md.
        rel === "PROJECT.md" ||
        rel === "README.md" ||
        rel === "USER_GUIDE.md" ||
        rel === "DICTIONARY.md" ||
        rel === "ROADMAP.md" ||
        rel === "RELEASES.md" ||
        rel === ".gitignore" ||
        rel === ".gitattributes" ||
        // LICENSE — the AGPL-3.0 text added by E-OPEN-SOURCE-001 S-OS-02; same root-doc class.
        rel === "LICENSE" ||
        rel === "version.json",
      entry: () => ({
        owner: "framework",
        managed: true,
        source: null,
        _note: "Root document — source path same as destination (canonical-side).",
      }),
    },
    {
      name: "framework-misc",
      match: (rel) =>
        rel === "package.json" ||
        rel === "package-lock.json" ||
        rel === "install.ps1" ||
        rel === "install.sh" ||
        rel.startsWith("tests/") ||
        rel.startsWith(".github/") ||
        rel.startsWith("migrations/") ||
        rel.startsWith("patterns/") ||
        rel.startsWith("fixtures/") ||
        rel.startsWith("scripts/one-off/") ||
        rel.endsWith(".env.example"),
      entry: () => ({
        owner: "framework",
        managed: true,
        source: null,
      }),
    },
    {
      name: "runtime-root-issues-ledger",
      match: (rel) => rel === "issues.md",
      entry: () => ({
        owner: "runtime",
        managed: false,
        kind: "md",
        _note: "paths.sprintIssuesLedger — auto-managed by scripts/sprint/issue.js",
      }),
    },
    {
      name: "runtime-working-doc",
      // DUMP.md (session handoff), TRACKER.md (the burndown) and the other root
      // working docs are canonical-internal — tracked, but NOT shipped to products
      // and not a framework view. owner=runtime, managed=false. (The former
      // WARP.md design spec and the tracker-system brief moved under _planning/
      // — a walk-skipped dir — in E-OPEN-SOURCE-001 S-OS-05.)
      match: (rel) =>
        rel === "DUMP.md" ||
        rel === "TRACKER.md" ||
        rel === "UNTRACKED_WORK.md" ||
        rel === "REGRESSIONS.md" ||
        rel === "GRAPH.md",
      entry: () => ({ owner: "runtime", managed: false }),
    },
    {
      name: "repo-community-doc",
      // Public-repo community + provenance docs (E-OPEN-SOURCE-001 S-OS-05):
      // CONTRIBUTING / SECURITY / CODE_OF_CONDUCT / CHANGELOG at root and docs/*.
      // They describe the canonical repo itself and are NEVER shipped to a
      // consumer install (a product gets its own), so they are owner=project,
      // managed=false — the same posture as the project-docs rule for _docs/.
      match: (rel) =>
        rel === "CONTRIBUTING.md" ||
        rel === "SECURITY.md" ||
        rel === "CODE_OF_CONDUCT.md" ||
        rel === "CHANGELOG.md" ||
        rel.startsWith("docs/"),
      entry: () => ({
        owner: "project",
        managed: false,
        class: "reference",
        _note: "Canonical-repo community/provenance doc — describes this repo, not shipped to consumers.",
      }),
    },
    {
      name: "framework-trackers-templates",
      // The "future ship-boundary call" the runtime-trackers-tree rule below
      // anticipated, made now (2026-06-06): the trackers/templates/* subset is
      // REUSABLE FRAMEWORK scaffolding — products receive it via /warp:update so
      // /trackers:init can scaffold the enforced-tracker system downstream.
      // Closes the "shipped the referee, not the field" gap (the tracker
      // validator demands these templates; before this they shipped to nobody —
      // mc-enforcer-shippability). Must precede the trackers/ runtime rule
      // (first-match wins). The rest of trackers/ (epics/sprints/README + the
      // TRACKER.md instance data) stays owner=runtime below.
      match: (rel) => rel.startsWith("trackers/templates/"),
      entry: (rel) => ({
        owner: "framework",
        managed: true,
        source: rel,
        kind: rel.endsWith(".md") ? "md" : undefined,
      }),
    },
    {
      name: "runtime-trackers-tree",
      // The rest of the /trackers/ working tree (epics, sprints, README) is the
      // enforced-tracker system's INSTANCE data — MC-internal working state,
      // tracked but NOT shipped to products and not a framework view.
      // owner=runtime, managed=false. (templates/ split out above → framework.)
      match: (rel) => rel.startsWith("trackers/"),
      entry: () => ({ owner: "runtime", managed: false }),
    },
    {
      name: "framework-claude-reference",
      match: (rel) => rel.startsWith(".claude/project/reference/"),
      entry: (rel) => ({
        owner: "framework",
        managed: true,
        source:
          sourcePrefix === "framework"
            ? rel
            : `${sourcePrefix}/${rel.replace(/^\.claude\//, "")}`,
        kind: rel.endsWith(".md") ? "md" : undefined,
      }),
    },
    {
      name: "framework-claude-agent-system",
      match: (rel) =>
        rel.startsWith(".claude/agents/") &&
        (rel.endsWith(".json") || rel.endsWith(".schema.json")) &&
        rel.includes("/.system/"),
      entry: (rel) => ({
        owner: "framework",
        managed: true,
        source:
          sourcePrefix === "framework"
            ? rel
            : `${sourcePrefix}/${rel.replace(/^\.claude\//, "")}`,
        kind: "json",
      }),
    },
    {
      // MC 1.0 kernel (`paths.kernel`, SP-20260718-001 Phase 0): the
      // Top-Level Runtime Contract (top-level-runtime-contract.md), its JSON
      // companions (role-binding.json, support-matrix.json,
      // workorder-min.schema.json), and the kernel-conformance fixtures/ tree.
      // The provider-independent trust-boundary + runtime-portability contract
      // every MC 1.0 install binds to — SHIPPED framework content. The
      // legacy generate-framework-manifest.js already classifies `.claude/kernel`
      // as owner=framework (replace_if_unmodified) and ships it as a root; this
      // is the SP-20260522-001-taxonomy equivalent for the ownership manifest.
      // Source is self-referential in canonical; in a product install the
      // framework source lives under _mc/ (same model as framework-claude-
      // command / framework-claude-agent / framework-claude-reference).
      name: "framework-kernel",
      match: (rel) => rel.startsWith(".claude/kernel/"),
      entry: (rel) => ({
        owner: "framework",
        managed: true,
        source:
          sourcePrefix === "framework"
            ? rel
            : `${sourcePrefix}/${rel.replace(/^\.claude\//, "")}`,
        kind: rel.endsWith(".md")
          ? "md"
          : rel.endsWith(".json")
            ? "json"
            : undefined,
      }),
    },
    {
      // `.claude/schemas/` — MC 1.0 machine-readable schema contracts (e.g.
      // workorder-min.schema.json). Shipped framework content, same class as the
      // top-level `schemas/` root (framework-schemas) and the kernel's own
      // schema companion. Source self-referential in canonical; _mc-mirrored
      // in products (same model as the .claude/** framework rules above).
      name: "framework-claude-schemas",
      match: (rel) => rel.startsWith(".claude/schemas/"),
      entry: (rel) => ({
        owner: "framework",
        managed: true,
        source:
          sourcePrefix === "framework"
            ? rel
            : `${sourcePrefix}/${rel.replace(/^\.claude\//, "")}`,
        kind: rel.endsWith(".json") ? "json" : undefined,
      }),
    },
    {
      name: "project-dreams",
      match: (rel) => rel.startsWith(".claude/dreams/"),
      entry: () => ({
        owner: "project",
        managed: false,
        class: "guide",
        _note: "Operator's dream journal — written by /sleep:* skills + manual edits. Project-owned; never overwritten.",
      }),
    },
    {
      name: "generated-mc-manifest",
      match: (rel) => rel === "_mc/MANIFEST.json",
      entry: () => ({
        owner: "generated",
        managed: false,
        compiled_from: ["framework/"],
        compiler: "scripts/mc/manifest/build.js",
        kind: "json",
        _note: "Per-install ownership manifest. Regenerated on /warp:setup and /warp:update. SP-20260522-001.",
      }),
    },
    {
      // RI-003 CLOSURE (SP-20260721-001 D-4 GATE-A Leg-3 lane): the _mc/ VIEW
      // MIRROR — agents/, commands/, project/reference/, kernel/, schemas/ — is the
      // COMPILED .claude/ view, NOT canonical-shipped framework source. In an
      // installed product it is re-materialized by scaffold-core Stage-2.5
      // (views/populate-source.js) from canonical's .claude/* at /warp:setup; a
      // fresh CANONICAL checkout does not carry it. Enumerating it in the CANONICAL
      // manifest (framework-mc-zone did, as a broad catch-all) makes the manifest
      // PROMISE owner=framework files that a clean canonical tree lacks — BC-02
      // "missing" AND mc-ship-coverage "not shipped" both red on a clean
      // checkout, while the mirror is regenerated in the product regardless. This
      // rule SKIPS (does not enumerate) exactly those paths, ONLY in canonical mode:
      //   - Canonical (sourcePrefix=framework): the view mirror is generated-not-
      //     shipped → skip. The manifest stays honest on a clean AND a dirty tree
      //     (a re-materialized mirror is skipped by the rule, not merely absent — so
      //     it can never re-enter the manifest; deletion alone would regress).
      //   - Product (sourcePrefix=_mc): the _mc/ mirror IS the shipped
      //     source → this rule does NOT fire; framework-mc-zone enumerates it.
      // "is a view" is decided by the SAME predicate populate-source uses
      // (isFrameworkViewDest over the .claude/ equivalent), imported above so the
      // exclusion is lock-step with the installer's mirror set by construction.
      name: "mc-generated-view-mirror",
      skip: true,
      match: (rel) =>
        sourcePrefix === "framework" &&
        rel.startsWith("_mc/") &&
        rel !== "_mc/MANIFEST.json" &&
        !!isFrameworkViewDest(".claude/" + rel.slice("_mc/".length)),
    },
    {
      name: "framework-mc-zone",
      match: (rel) => rel.startsWith("_mc/") && rel !== "_mc/MANIFEST.json",
      entry: (rel) => ({
        owner: "framework",
        managed: true,
        source: rel,
        _note: "_mc/ is the framework source-of-truth zone in installed products (post-SP-20260522-001).",
      }),
    },
  ];
}

function classify(rel, rules) {
  for (const rule of rules) {
    if (rule.match(rel)) {
      // A `skip:true` rule MATCHES a path but deliberately does NOT enumerate it
      // (e.g. the canonical-side generated view mirror — see
      // mc-generated-view-mirror). It is a matched-and-excluded verdict, NOT
      // an "unclassified" one, so the build does not fail on it.
      if (rule.skip) return { rule: rule.name, skip: true };
      const e = rule.entry(rel);
      return { rule: rule.name, entry: e };
    }
  }
  return null;
}

// ── Filesystem walk ──────────────────────────────────────────────────

// Skip sets are shared with validate.js via ./walk-skip so the builder and the
// validator can never disagree about what is not-shipped (BC-02 drift class).
const { WALK_SKIP_DIRS, WALK_SKIP_FILES } = require("./walk-skip");

function* walk(rootAbs) {
  const stack = [rootAbs];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (WALK_SKIP_DIRS.has(ent.name)) continue;
      if (WALK_SKIP_FILES.has(ent.name)) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (ent.isFile()) {
        yield full;
      }
      // ignore symlinks + special files
    }
  }
}

function sha256OfFile(file) {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(file));
  return h.digest("hex");
}

function relPath(rootAbs, fullPath) {
  return path
    .relative(rootAbs, fullPath)
    .split(path.sep)
    .join("/");
}

// ── Driver ───────────────────────────────────────────────────────────

function build(opts) {
  const root = path.resolve(opts.root);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return { ok: false, code: 2, error: `--root not a directory: ${root}` };
  }

  let mcVersion = opts.mcVersion;
  if (!mcVersion) {
    try {
      const vj = JSON.parse(
        fs.readFileSync(path.join(root, "version.json"), "utf8"),
      );
      mcVersion = vj.version || "0.0.0";
    } catch {
      mcVersion = "0.0.0";
    }
  }

  const rules = buildRules(opts.sourcePrefix);
  const paths = {};
  const unclassified = [];
  const ruleHits = Object.create(null);

  for (const full of walk(root)) {
    const rel = relPath(root, full);
    if (!rel || rel.startsWith("..")) continue;
    const classification = classify(rel, rules);
    if (!classification) {
      unclassified.push(rel);
      continue;
    }
    if (classification.skip) {
      // Matched a skip:true rule — intentionally NOT enumerated. Counted for
      // observability, but never written to paths (so the manifest cannot promise
      // a generated/not-shipped path that a clean checkout lacks).
      ruleHits[classification.rule] = (ruleHits[classification.rule] || 0) + 1;
      continue;
    }
    const entry = { ...classification.entry };
    if (entry.owner === "framework") {
      try {
        const sha = sha256OfFile(full);
        entry.sha256 = sha;
        entry.installedSha = sha;
      } catch {
        /* unreadable */
      }
    }
    paths[rel] = entry;
    ruleHits[classification.rule] =
      (ruleHits[classification.rule] || 0) + 1;
  }

  if (unclassified.length > 0 && !opts.allowUnclassified) {
    return {
      ok: false,
      code: 1,
      error: `${unclassified.length} unclassified path(s); add a rule or pass --allow-unclassified`,
      unclassified,
      ruleHits,
    };
  }

  const manifest = {
    $schema: SCHEMA_ID,
    version: 1,
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    generatedBy: "scripts/mc/manifest/build.js",
    mcVersion,
    migrations: [],
    paths,
  };

  const outPath =
    opts.outPath || path.join(root, "_mc", "MANIFEST.json");

  if (opts.dryRun) {
    return {
      ok: true,
      code: 0,
      dryRun: true,
      outPath,
      ruleHits,
      pathCount: Object.keys(paths).length,
      unclassifiedCount: unclassified.length,
      manifestPreview: { ...manifest, paths: undefined, _pathCount: Object.keys(paths).length },
    };
  }

  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n");
  } catch (err) {
    return {
      ok: false,
      code: 2,
      error: `write failed: ${err.message}`,
      outPath,
    };
  }

  return {
    ok: true,
    code: 0,
    outPath,
    ruleHits,
    pathCount: Object.keys(paths).length,
    unclassifiedCount: unclassified.length,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────

function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    printHelp();
    return 0;
  }
  const r = build(opts);
  if (opts.json) {
    process.stdout.write(JSON.stringify(r, null, 2) + "\n");
  } else if (!r.ok) {
    process.stderr.write(`manifest build failed: ${r.error}\n`);
    if (r.unclassified) {
      process.stderr.write(
        `unclassified (showing first 10):\n${r.unclassified.slice(0, 10).map((p) => "  " + p).join("\n")}\n`,
      );
      if (r.unclassified.length > 10) {
        process.stderr.write(
          `  ... and ${r.unclassified.length - 10} more\n`,
        );
      }
    }
  } else {
    process.stdout.write(
      `manifest written: ${r.outPath}\n  paths: ${r.pathCount}\n  rules hit: ${Object.keys(r.ruleHits).length}\n`,
    );
    if (r.dryRun)
      process.stdout.write(`  (dry-run — no file was written)\n`);
  }
  return r.code;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { build, buildRules, classify, sha256OfFile };
