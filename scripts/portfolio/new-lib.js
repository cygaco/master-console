"use strict";

/**
 * scripts/portfolio/new-lib.js — the reusable create()/scaffold() callables behind
 * /portfolio:new (MC-PROMPT §4 reconcile).
 *
 * ONE implementation per phase: the deterministic "make a product repo" work
 * (`createProductRepo`) and the app-scaffold work (`scaffoldProductApp`, a thin
 * wrapper over scripts/scaffold/app.js) live here. Both `/portfolio:new` (the CLI,
 * scripts/portfolio/new.js) AND the bootstrap:spinup `setup` step
 * (scripts/bootstrap/phases/setup.js) call these — never a duplicated copy. This
 * resolves the §4 "no duplicated create/scaffold logic" requirement and makes
 * `portfolio:new` literally "the setup step composed."
 *
 * Pure-on-require: requiring this module runs nothing. Callers invoke the exported
 * functions, which return a result object ({ ok, ... }) instead of process.exit —
 * so an in-process consumer (setup.js) and a CLI (new.js) share one path.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const { save, load, findBySlug, validate } = require("./registry");

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const RESERVED = new Set([
  "list", "register", "open", "new", "adopt", "status",
  "dispatch", "sync", "bootstrap", "clone", "ponder", "import",
]);

const TEMPLATES_DIR = path.resolve(__dirname, "../../_mc/templates/portfolio");
const WARPOS_ROOT = path.resolve(__dirname, "../..");

// ── Validation seam (reused by both create + the CLI) ───────────────────────
function validateSlug(slug) {
  if (!slug) return { ok: false, code: 2, error: "Usage: /portfolio:new <slug> [--from-brief <brief-slug>]" };
  if (!SLUG_RE.test(slug))
    return { ok: false, code: 2, error: `slug must match ^[a-z0-9][a-z0-9-]{0,63}$ (got: ${JSON.stringify(slug)})` };
  if (RESERVED.has(slug))
    return { ok: false, code: 2, error: `'${slug}' collides with a reserved skill name. Choose a different slug.` };
  const existing = findBySlug(slug);
  if (existing) return { ok: false, code: 2, error: `'${slug}' already registered at ${existing.repo_path}` };
  return { ok: true };
}

/**
 * scaffoldProductApp — the app-scaffold callable. Thin wrapper over
 * scripts/scaffold/app.js so the MC Next+Tailwind+shadcn baseline is
 * materialized by exactly one engine. Idempotent (no-op when package.json exists)
 * and fail-open. `platform` is recorded by the caller; v1 the scaffold is the
 * web/PWA baseline for every target (§3 native-packaging is a follow-on).
 *
 * @returns { ok, alreadyPresent?, created?, error? }
 */
function scaffoldProductApp({ repoRoot, slug, install = false, log = () => {} }) {
  try {
    const { scaffoldApp } = require("../scaffold/app");
    return scaffoldApp({ repoRoot, slug, install, log });
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * createProductRepo — the deterministic "make a product repo" callable. Mirrors
 * the former new.js body exactly: validate → sibling repo + git init + seed
 * identity + copy templates + initial commit + /mc:setup install + register +
 * --from-brief + brief pointer + app scaffold + commit + optional GitHub remote.
 *
 * Returns a result object (never process.exit) so setup.js and the CLI share it.
 *
 * @param {object} opts
 * @param {string} opts.slug
 * @param {string|null} [opts.fromBrief]
 * @param {boolean} [opts.wantGithub]
 * @param {boolean} [opts.wantNoScaffold]
 * @param {boolean} [opts.wantInstall]
 * @param {string|null} [opts.parentDir] TEST/SANDBOX-ONLY seam (GATE-A
 *   fresh_scaffold_all_ways, SP-20260721-001 D-4 INC-2). Overrides the sibling
 *   parent the new repo is scaffolded under (default: WARPOS_ROOT/..). This is
 *   a NON-TRUST seam (β R3): it relocates WHERE the scaffold lands, it never
 *   weakens any assertion the caller makes afterward. Production /portfolio:new
 *   callers never pass it — real users always get the real sibling location.
 * @param {(m:string)=>void} [opts.log]
 * @param {(m:string)=>void} [opts.errorLog]
 * @returns {{ ok:boolean, code?:number, error?:string, repoPath?:string, githubUrl?:string|null, slug?:string }}
 */
function createProductRepo(opts) {
  const {
    slug,
    fromBrief = null,
    wantGithub = false,
    wantNoScaffold = false,
    wantInstall = false,
    parentDir = null,
    log = (m) => console.log(m),
    errorLog = (m) => console.error(m),
  } = opts || {};

  const v = validateSlug(slug);
  if (!v.ok) return v;

  // ── resolve sibling path ───────────────────────────────────
  // parentDir (test/sandbox seam) overrides the parent dir; default stays the
  // real sibling-of-WARPOS_ROOT location every production caller gets.
  const repoPath = path.resolve(parentDir || path.resolve(WARPOS_ROOT, ".."), slug);

  if (fs.existsSync(repoPath)) {
    const allowedLeftovers = new Set([".git", ".gitignore", "README.md", ".claude"]);
    let partialScaffold = false;
    try {
      const existing = fs.readdirSync(repoPath);
      partialScaffold = existing.length > 0 && existing.every((e) => allowedLeftovers.has(e));
    } catch { /* ignore */ }
    if (partialScaffold) {
      return {
        ok: false, code: 4,
        error:
          `Directory ${repoPath} exists with only partial-scaffold contents from a prior failed run. ` +
          `Remove it (rm -rf "${repoPath}") and re-run, or use /portfolio:register to register it as-is.`,
      };
    }
    return { ok: false, code: 4, error: `Directory already exists: ${repoPath}. Remove it first or use /portfolio:register.` };
  }

  // ── scaffold ───────────────────────────────────────────────
  log(`scaffolding ${slug} at ${repoPath}... running /mc:setup... done.`);
  fs.mkdirSync(repoPath, { recursive: true });

  const gitInit = spawnSync("git", ["init"], { cwd: repoPath, encoding: "utf8" });
  if (gitInit.status !== 0) {
    fs.rmSync(repoPath, { recursive: true, force: true });
    return { ok: false, code: 4, error: `git init failed: ${gitInit.stderr}` };
  }

  _seedGitIdentity(repoPath);
  _copyTemplates(TEMPLATES_DIR, repoPath, slug);

  const gitAdd = spawnSync("git", ["add", "-A"], { cwd: repoPath, encoding: "utf8" });
  if (gitAdd.status !== 0) return { ok: false, code: 4, error: `git add failed: ${gitAdd.stderr}` };
  const gitCommit = spawnSync(
    "git", ["commit", "-m", `init: scaffold ${slug} via /portfolio:new`],
    { cwd: repoPath, encoding: "utf8" },
  );
  if (gitCommit.status !== 0) return { ok: false, code: 4, error: `git commit failed: ${gitCommit.stderr}` };

  // ── install MC into the new repo (LOUD, never silent) ──
  // WI-50 regression: this step used to resolve scripts/warp-setup.js against
  // WARPOS_ROOT and existsSync-GUARD it. But warp-setup.js is the canonical
  // installer that is INTENTIONALLY NEVER SHIPPED (release-build.js: "lives in
  // the canonical clone, never shipped") — so on any CONSUMER install the guard
  // was false and the install SILENTLY no-op'd, producing a project with app
  // files but no MC engine (no .claude/, no scripts/ tree) → dead on
  // arrival. Fix: install via install.ps1 (shipped in every capsule), and FAIL
  // LOUDLY if no installer exists or the install produced no engine.
  const install = _installMC(repoPath);
  if (!install.ok) {
    return { ok: false, code: 4, error: install.error };
  }

  // ── register ───────────────────────────────────────────────
  const doc = load();
  doc.products = doc.products || {};
  const entry = {
    slug,
    repo_path: repoPath,
    github_url: null,
    mc_version: _readInstalledVersion(repoPath),
    last_synced: new Date().toISOString(),
    role: "product",
    remote_type: null,
    kind: null,
  };
  const { valid, errors } = validate(entry);
  if (!valid) return { ok: false, code: 2, error: `registry validation failed: ${errors.join("; ")}` };
  doc.products[slug] = entry;
  save(doc);

  // ── --from-brief (move brief into the new repo) ─────────────
  if (fromBrief) {
    const adoptScript = path.resolve(__dirname, "adopt.js");
    const adopt = spawnSync(
      "node", [adoptScript, fromBrief, "--target-path", repoPath, "--skip-new"],
      { cwd: WARPOS_ROOT, encoding: "utf8", timeout: 30_000 },
    );
    if (adopt.stdout) process.stdout.write(adopt.stdout);
    if (adopt.stderr) process.stderr.write(adopt.stderr);
    _pointToFoundingBrief(repoPath, fromBrief, log);
  }

  // ── S0.3: scaffold the app (Next+Tailwind+shadcn/ui+Radix+Lucide) ──
  if (!wantNoScaffold) {
    const res = scaffoldProductApp({ repoRoot: repoPath, slug, install: wantInstall, log: (m) => log(`  ${m}`) });
    if (!res.ok) errorLog(`app scaffold skipped: ${res.error}`);
  }

  // ── commit the full scaffold ───────────────────────────────
  spawnSync("git", ["add", "-A"], { cwd: repoPath, encoding: "utf8" });
  spawnSync(
    "git", ["commit", "-m", "chore(scaffold): mc install" + (fromBrief ? " + brief" : "")],
    { cwd: repoPath, encoding: "utf8" },
  );

  // ── GitHub remote: OPT-IN only (--github) ───────────────────
  let githubUrl = null;
  if (wantGithub) {
    const ghResult = _ghRepoCreate(slug, repoPath, log, errorLog);
    if (ghResult.url) {
      githubUrl = ghResult.url;
      const doc2 = load();
      if (doc2.products[slug]) {
        doc2.products[slug].github_url = githubUrl;
        doc2.products[slug].remote_type = "github";
        doc2.products[slug].last_synced = new Date().toISOString();
        save(doc2);
      }
    }
  } else {
    _printLocalOnlyNextSteps(slug, repoPath, log);
  }

  _emit("portfolio_new", {
    slug,
    repo_path_offset: _pathOffset(repoPath),
    from_brief: fromBrief || null,
    warp_setup_status: "ok",
    github: wantGithub,
    gh_repo_create_surfaced: wantGithub,
  });

  return { ok: true, repoPath, githubUrl, slug };
}

// ── helpers (moved verbatim from new.js) ───────────────────────────────────

function _copyTemplates(srcDir, destDir, slugVal) {
  if (!fs.existsSync(srcDir)) return;
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destName = entry.name.endsWith(".tmpl") ? entry.name.slice(0, -5) : entry.name;
    const destPath = path.join(destDir, destName);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      _copyTemplates(srcPath, destPath, slugVal);
    } else {
      let content = fs.readFileSync(srcPath, "utf8");
      content = content.replace(/\{\{SLUG\}\}/g, slugVal);
      fs.writeFileSync(destPath, content, "utf8");
    }
  }
}

function _seedGitIdentity(repoPathVal) {
  const nameRes = spawnSync("git", ["config", "user.name"], { cwd: WARPOS_ROOT, encoding: "utf8" });
  const emailRes = spawnSync("git", ["config", "user.email"], { cwd: WARPOS_ROOT, encoding: "utf8" });
  const name = (nameRes.stdout || "").trim();
  const email = (emailRes.stdout || "").trim();
  if (name) spawnSync("git", ["config", "user.name", name], { cwd: repoPathVal, encoding: "utf8" });
  if (email) spawnSync("git", ["config", "user.email", email], { cwd: repoPathVal, encoding: "utf8" });
}

function _ghRepoCreate(slugVal, cwd, log = console.log, errorLog = console.error) {
  const viewResult = spawnSync(
    "gh", ["repo", "view", slugVal, "--json", "isPrivate,owner"],
    { cwd, encoding: "utf8", timeout: 15_000 },
  );
  if (viewResult.status === 0) {
    try {
      const info = JSON.parse(viewResult.stdout);
      const isPrivate = info.isPrivate;
      const ownerLogin = info.owner && info.owner.login;
      const whoami = spawnSync("gh", ["api", "user", "--jq", ".login"], { cwd, encoding: "utf8", timeout: 10_000 });
      const currentUser = whoami.status === 0 ? whoami.stdout.trim() : null;
      if (isPrivate && ownerLogin && ownerLogin === currentUser) {
        log(`note: ${currentUser}/${slugVal} already exists on GitHub (private). Reusing it as origin remote. Pushing local commits...`);
        spawnSync("git", ["remote", "add", "origin", `https://github.com/${currentUser}/${slugVal}.git`], { cwd, encoding: "utf8" });
        spawnSync("git", ["push", "-u", "origin", "HEAD"], { cwd, encoding: "utf8", timeout: 30_000 });
        return { url: `https://github.com/${currentUser}/${slugVal}` };
      }
      const visibility = isPrivate ? "private" : "public";
      const owner = ownerLogin || "another user";
      errorLog(`⚠  cannot reuse name: github.com/${owner}/${slugVal} exists and is ${visibility === "private" ? `owned by ${owner}` : "public"}. Choose a different slug or run \`gh repo delete ${owner}/${slugVal}\` first if you own it. Local repo at ${cwd} remains intact and registered.`);
      return { url: null };
    } catch { /* parse error — fall through to create */ }
  } else if (_isAuthError(viewResult.stderr + viewResult.stdout)) {
    errorLog(`⚠  gh CLI not authenticated. Local repo at ${cwd} is intact and registered. Run \`gh auth login\` then \`gh repo create ${slugVal} --private --source=. --remote=origin --push\` to finish.`);
    return { url: null };
  }
  log(`creating private GitHub repo: ${slugVal} (--private --source=. --remote=origin --push)...`);
  const create = spawnSync(
    "gh", ["repo", "create", slugVal, "--private", "--source=.", "--remote=origin", "--push"],
    { cwd, encoding: "utf8", timeout: 60_000 },
  );
  if (create.status !== 0) {
    if (_isAuthError(create.stderr + create.stdout)) {
      errorLog(`⚠  gh CLI not authenticated. Local repo at ${cwd} is intact and registered. Run \`gh auth login\` then \`gh repo create ${slugVal} --private --source=. --remote=origin --push\` to finish.`);
      return { url: null };
    }
    errorLog(`gh repo create failed: ${create.stderr || create.stdout}`);
    return { url: null };
  }
  const urlMatch = (create.stdout || "").match(/https:\/\/github\.com\/[^\s]+/);
  const url = urlMatch ? urlMatch[0] : null;
  log(`  ✓ remote created: ${url || `https://github.com/<owner>/${slugVal}`} (private)`);
  log(`  ✓ initial commit pushed`);
  log(`  ✓ origin set, branch ${_defaultBranch(cwd)} tracked`);
  log(`Next: invite collaborators with \`gh repo edit ${slugVal} --add-collaborator <username>\`.`);
  return { url };
}

function _isAuthError(output) {
  return /not logged in|auth|authentication|401|403|token/.test(output || "");
}

function _defaultBranch(cwd) {
  try {
    const r = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, encoding: "utf8" });
    return (r.stdout || "main").trim();
  } catch { return "main"; }
}

function _printLocalOnlyNextSteps(slugVal, repoPathVal, log = console.log) {
  log(`\nLocal repo ready — MC installed, app scaffolded, committed, no remote:`);
  log(`  ${repoPathVal}`);
  log(`Install deps and see it on screen (the scaffold ships pinned deps, not node_modules):`);
  log(`  cd "${repoPathVal}" && npm install && npm run dev`);
  log(`Next — open it in its own session and work there:`);
  log(`  /portfolio:open ${slugVal} --spawn`);
  log(`Create a private GitHub remote when you want one (run from inside the repo):`);
  log(`  gh repo create ${slugVal} --private --source=. --remote=origin --push`);
  log(`Or re-run /portfolio:new with --github to do that automatically (operator-run — the agent is gated from pushing to a brand-new remote in auto mode).`);
}

function _briefRootsRel() {
  const fallback = { briefs: "_docs/briefs", clones: "_docs/clones" };
  try {
    const reg = JSON.parse(fs.readFileSync(path.join(WARPOS_ROOT, "framework", "paths.registry.json"), "utf8"));
    const entries = reg.paths || reg;
    const briefs = entries.briefsRoot && entries.briefsRoot.path;
    const clones = entries.clonesRoot && entries.clonesRoot.path;
    return { briefs: briefs || fallback.briefs, clones: clones || fallback.clones };
  } catch { return fallback; }
}

function _pointToFoundingBrief(repoPathVal, briefSlug, log = console.log) {
  const roots = _briefRootsRel();
  const candidates = [
    { rel: path.posix.join(roots.briefs, briefSlug), kind: "brief" },
    { rel: path.posix.join(roots.clones, briefSlug), kind: "clone" },
  ];
  let found = null;
  for (const c of candidates) {
    const absDir = path.join(repoPathVal, c.rel);
    if (!fs.existsSync(absDir)) continue;
    let docName = null;
    try {
      const files = fs.readdirSync(absDir);
      docName = files.find((f) => f === `${briefSlug}.${c.kind}.md`) || files.find((f) => f.endsWith(".md")) || null;
    } catch { /* unreadable — skip */ }
    const docRel = docName ? path.posix.join(c.rel, docName) : c.rel;
    found = { docRel, kind: c.kind };
    break;
  }
  if (!found) return;
  const projectMd = path.join(repoPathVal, "PROJECT.md");
  const pointerLine = `> **Founding ${found.kind}:** [\`${found.docRel}\`](${found.docRel}) — the brief this product was scaffolded from.`;
  try {
    let body = fs.existsSync(projectMd) ? fs.readFileSync(projectMd, "utf8") : "";
    if (!body.includes(found.docRel)) {
      const lines = body.split("\n");
      const h1Idx = lines.findIndex((l) => /^#\s+/.test(l));
      if (h1Idx !== -1) {
        lines.splice(h1Idx + 1, 0, "", pointerLine);
        body = lines.join("\n");
      } else {
        body = (body ? body.replace(/\n*$/, "\n\n") : "") + pointerLine + "\n";
      }
      fs.writeFileSync(projectMd, body, "utf8");
    }
  } catch { /* non-fatal */ }
  log(`Founding ${found.kind} → ${found.docRel} (also linked from PROJECT.md)`);
}

function _readInstalledVersion(repoPathVal) {
  try {
    const p = path.join(repoPathVal, ".claude", "framework-installed.json");
    if (fs.existsSync(p)) {
      const d = JSON.parse(fs.readFileSync(p, "utf8"));
      return d.installedVersion || null;
    }
  } catch { /* ignore */ }
  return null;
}

// install.ps1's own preflight (install.ps1:~47) refuses any SOURCE repo that
// lacks these three files — it derives $Source from its OWN location, so the
// dir we invoke install.ps1 from must satisfy this contract. paths.json +
// version.json + the framework-manifest are the engine's identity; a CONSUMER
// product install carries paths.json/version.json but NOT framework-manifest.json
// (framework-layer, intentionally not shipped) and so is not a valid source.
const _SOURCE_CONTRACT = [
  ".claude/framework-manifest.json",
  ".claude/paths.json",
  "version.json",
];

// A dir is a valid MC engine install SOURCE only if it satisfies install.ps1's
// source contract AND carries an actual installer (install.ps1 or the
// canonical-only warp-setup.js).
function _isValidInstallSource(root) {
  const hasContract = _SOURCE_CONTRACT.every((f) => fs.existsSync(path.join(root, f)));
  const hasInstaller =
    fs.existsSync(path.join(root, "install.ps1")) ||
    fs.existsSync(path.join(root, "scripts", "warp-setup.js"));
  return hasContract && hasInstaller;
}

// Resolve a dir that is a VALID MC engine install source. The running root is
// valid when MC is canonical (or a consumer that still ships the manifest),
// but a CONSUMER product driving the engine (e.g. a cockpit running a Create)
// has no framework-manifest.json and CANNOT be a source — install.ps1 correctly
// refuses it ("Source repo missing required file: .claude\framework-manifest.json",
// WI-50 round 3, 2026-06-07). Fall back to a sibling canonical clone, matching
// the existing capsule sibling-resolution precedent
// (scripts/checks/mc-capsule-resolvable.js: ../MC, ../mc). Returns an
// absolute root path, or null if no valid source exists.
function _installSourceCandidates(startRoot) {
  return [
    startRoot,
    path.resolve(startRoot, "..", "MC"),
    path.resolve(startRoot, "..", "mc"),
  ];
}
function _resolveInstallerRoot(startRoot = WARPOS_ROOT) {
  for (const c of _installSourceCandidates(startRoot)) {
    if (_isValidInstallSource(c)) return c;
  }
  return null;
}

// Install MC into a freshly-created product repo using the SHIPPED
// installer. Prefer install.ps1 (present in every release capsule AND the
// canonical clone); fall back to the canonical-only warp-setup.js when
// install.ps1 is absent. The installer is resolved against a VALID engine source
// (the running root if it qualifies, else a sibling canonical clone) — NOT blindly
// against WARPOS_ROOT, which is a consumer when a cockpit drives the engine
// (WI-50 round 3). The prior code existsSync-guarded warp-setup.js and SILENTLY
// skipped when absent — so a consumer install produced a project with app files
// but no MC engine (WI-50). This FAILS LOUDLY when no valid source/installer
// is available AND asserts the install actually produced a complete MC tree
// (.claude/framework-installed.json) — never a silent no-op. Returns
// {ok:true} | {ok:false, error}.
function _installMC(repoPath, { spawn = spawnSync, resolveRoot = _resolveInstallerRoot } = {}) {
  const installerRoot = resolveRoot(WARPOS_ROOT);
  if (!installerRoot) {
    return {
      ok: false,
      error:
        `No valid MC engine source found. The running MC root ` +
        `(${WARPOS_ROOT}) is a consumer install — it is missing ` +
        `.claude/framework-manifest.json, so install.ps1 refuses it as a source ` +
        `— and no sibling canonical engine was found. Tried: ` +
        `${_installSourceCandidates(WARPOS_ROOT).join(", ")}. A valid source must ` +
        `carry ${_SOURCE_CONTRACT.join(", ")} plus an installer. Clone the ` +
        `canonical MC engine as a sibling (../MC) to enable Create.`,
    };
  }
  const psInstaller = path.resolve(installerRoot, "install.ps1");
  const legacySetup = path.resolve(installerRoot, "scripts/warp-setup.js");
  let res;
  if (fs.existsSync(psInstaller)) {
    // install.ps1 resolves its source ($Source) from its OWN location, so
    // invoking the resolved installerRoot's install.ps1 installs THAT engine
    // (canonical, possibly a sibling of a consumer) into the target repo.
    res = spawn(
      "powershell",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", psInstaller,
        "-Target", repoPath, "-SkipPrompt"],
      { cwd: installerRoot, encoding: "utf8", timeout: 120_000 },
    );
  } else if (fs.existsSync(legacySetup)) {
    res = spawn(
      "node", [legacySetup, repoPath, "--yes", "--skip-backup"],
      { cwd: installerRoot, encoding: "utf8", timeout: 120_000 },
    );
  } else {
    // Unreachable in practice: _isValidInstallSource already requires one of
    // these installers, so a resolved installerRoot always has one. Kept as a
    // fail-loud backstop rather than a silent no-op (WI-50 discipline).
    return {
      ok: false,
      error:
        `No MC installer found at ${installerRoot} (neither install.ps1 nor ` +
        `scripts/warp-setup.js). The resolved MC source is incomplete — ` +
        `cannot install MC into ${repoPath}.`,
    };
  }
  if (res.status !== 0) {
    return {
      ok: false,
      error: `MC install into ${repoPath} failed:\n${(res.stderr || res.stdout || "").trim()}`,
    };
  }
  // Completeness gate — the install MUST produce a real MC tree, not a
  // silent no-op. install.ps1 writes .claude/framework-installed.json on
  // success; its absence means the engine was not installed.
  if (!fs.existsSync(path.join(repoPath, ".claude", "framework-installed.json"))) {
    return {
      ok: false,
      error:
        `MC install into ${repoPath} reported success but produced no engine ` +
        `(.claude/framework-installed.json is missing). The created project would ` +
        `be MC-less — refusing to continue (WI-50 silent-no-op guard).`,
    };
  }
  return { ok: true };
}

function _pathOffset(absPath) {
  const os = require("os");
  try { return path.relative(os.homedir(), absPath); } catch { return "<path>"; }
}

function _emit(type, payload) {
  try {
    const loggerPath = path.resolve(__dirname, "../hooks/lib/logger.js");
    const { log } = require(loggerPath);
    log("portfolio", { type, ...payload });
  } catch { /* fail-open */ }
}

module.exports = {
  createProductRepo,
  scaffoldProductApp,
  validateSlug,
  _installMC,
  _resolveInstallerRoot,
  _isValidInstallSource,
  SLUG_RE,
  RESERVED,
  WARPOS_ROOT,
  TEMPLATES_DIR,
};
