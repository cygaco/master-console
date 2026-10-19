#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env");

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const {
  assertSandboxTargetSafe,
  snapshotCanonicalState,
  noDeltaCheck,
  findPowershellReal,
  runLeg3,
} = require("./test-scaffold-all-ways");
const { parityDiff } = require("./test-install-matrix");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_TIMEOUT_MS = 240_000;
const SCAN_INSTALL_TIMEOUT_MS = 60_000;
const ORACLE_TIMEOUT_MS = 180_000;

function semverParts(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v || ""));
  return m ? [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)] : null;
}

function semverLt(a, b) {
  const pa = semverParts(a);
  const pb = semverParts(b);
  if (!pa || !pb) return false;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i];
  }
  return false;
}

function semverCompare(a, b) {
  const pa = semverParts(a);
  const pb = semverParts(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

function tagExists(version, spawnFn = spawnSync) {
  const r = spawnFn("git", ["tag", "-l", `mc@${version}`], { cwd: REPO_ROOT, encoding: "utf8", timeout: 15_000 });
  if (r && r.error) {
    throw new Error(`tagExists(${version}): git spawn error: ${r.error.message}`);
  }
  if (r && r.signal) {
    throw new Error(`tagExists(${version}): git tag -l TIMEOUT/KILLED (signal=${r.signal})`);
  }
  if (!r || r.status !== 0) {
    throw new Error(
      `tagExists(${version}): git tag -l exited non-zero (status=${r && r.status}): ${((r && (r.stderr || r.stdout)) || "").slice(0, 300)}`,
    );
  }
  return (r.stdout || "").trim() === `mc@${version}`;
}

function readCurrentVersion() {
  const versionPath = path.join(REPO_ROOT, "version.json");
  const raw = fs.readFileSync(versionPath, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed.version !== "string" || !parsed.version) {
    throw new Error(`version.json at ${versionPath} has no usable .version field`);
  }
  return parsed.version;
}

function checkUnreleasedCutIdentity(unreleasedCut, currentVersion) {
  if (unreleasedCut !== currentVersion) {
    throw new Error(
      `identity mismatch: selected unreleased-cut N=${unreleasedCut} does not equal version.json's version=${currentVersion} — refusing to select a phantom N (fail-closed)`,
    );
  }
  return true;
}

function resolveVersions({ tagExistsFn = tagExists } = {}) {
  const releasesDir = path.join(REPO_ROOT, "framework", "releases");
  const capsules = fs
    .readdirSync(releasesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && semverParts(d.name))
    .filter((d) => fs.existsSync(path.join(releasesDir, d.name, "release.json")))
    .map((d) => d.name)
    .sort(semverCompare);
  if (!capsules.length) {
    return { incomplete: true, reason: "no release capsules under framework/releases/ — nothing to resolve" };
  }
  const tagged = capsules.filter((v) => tagExistsFn(v));
  const newestTagged = tagged.length ? tagged[tagged.length - 1] : null;
  const unreleased = capsules.filter(
    (v) => !tagExistsFn(v) && v !== newestTagged && (!newestTagged || !semverLt(v, newestTagged)),
  );
  const unreleasedCut = unreleased.length ? unreleased[unreleased.length - 1] : null;
  if (unreleasedCut && newestTagged) {
    checkUnreleasedCutIdentity(unreleasedCut, readCurrentVersion());
    return { incomplete: false, n: unreleasedCut, n1: newestTagged };
  }
  return {
    incomplete: true,
    reason: `no unreleased capsule cut (newest shipped/tagged=${newestTagged || "none"}); the full upgrade->conformance path runs at the ceremony when a fresh capsule is cut from the current tree. Mid-dev, a frozen shipped capsule skews by post-cut drift and proves nothing about the release being cut.`,
  };
}

function describeSpawnFailure(r) {
  if (!r) return "no result (spawn never returned)";
  if (r.error) return `spawn error: ${r.error.message}`;
  if (r.signal) return `TIMEOUT/KILLED (signal=${r.signal}) — fail-closed`;
  const raw = `${r.stdout || ""}\n${r.stderr || ""}`;
  const failing = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^(FAIL|MISSING|ERROR)\b/i.test(l));
  if (failing.length) {
    const shown = failing.slice(0, 8);
    const extra = failing.length > shown.length ? ` (+${failing.length - shown.length} more)` : "";
    return `code=${r.status} FAILING: ${shown.join(" | ")}${extra}`;
  }
  return `code=${r.status} ${(r.stderr || r.stdout || "").slice(-400)}`;
}

function check3aVersionSanity(installedVersion, expectedVersion) {
  const ok = installedVersion === expectedVersion;
  return {
    ok,
    detail: `installedVersion=${installedVersion} expected=${expectedVersion} (non-load-bearing settable-label check; defeated by 3c/3b, not absent here)`,
  };
}

function check3bScanInstall(scanResult) {
  const ok = !!scanResult && scanResult.status === 0;
  return {
    ok,
    detail: ok ? "" : `scan:install exited non-zero: ${describeSpawnFailure(scanResult)}`,
  };
}

function replaceAllLiteral(haystack, needle, replacement) {
  if (!needle) return haystack;
  return haystack.split(needle).join(replacement);
}

const NORMALIZE_3C = [
  {
    name: "absolute_sandbox_path",
    why: "the upgraded tree and the fresh-N oracle tree live under two DIFFERENT os.tmpdir() sandbox roots minted once per engine run; a path pointing back at either root is sandbox-identity, never install content",
    apply: (text, ctx) => {
      let out = text;
      for (const root of (ctx && ctx.sandboxRoots) || []) {
        if (!root) continue;
        out = replaceAllLiteral(out, root, "<NORMALIZED-SANDBOX-PATH>");
        out = replaceAllLiteral(out, root.split(path.sep).join("/"), "<NORMALIZED-SANDBOX-PATH>");
        out = replaceAllLiteral(out, JSON.stringify(root).slice(1, -1), "<NORMALIZED-SANDBOX-PATH>");
      }
      return out;
    },
  },
  {
    name: "per_run_nonce",
    why: "this engine mints a per-run nonce for tmp-dir naming; if the EXACT minted literal leaks into an installed artifact it is run-identity, not upgrade content — normalized as a literal (ctx.nonces), never a shape-based pattern",
    apply: (text, ctx) => {
      let out = text;
      for (const n of (ctx && ctx.nonces) || []) {
        if (!n) continue;
        out = replaceAllLiteral(out, n, "<NORMALIZED-NONCE>");
      }
      return out;
    },
  },
  {
    name: "iso_timestamp",
    why: "install/apply/regen stamp real wall-clock ISO-8601 timestamps (installedAt, generatedAt, ...); two independent runs never share a clock reading by construction, not by upgrade defect",
    apply: (text) => text.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?/g, "<NORMALIZED-TS>"),
  },
  {
    name: "transaction_id",
    why: "update.js's transaction system stamps a fresh transaction id into per-run bookkeeping on every --apply; two independent runs never share one by design",
    apply: (text) => text.replace(/("(?:transactionId|transaction_id|txnId|txn_id)"\s*:\s*")[^"]*(")/g, "$1<NORMALIZED-TXN>$2"),
  },
];

function normalizeContent3c(text, ctx) {
  let out = text;
  for (const rule of NORMALIZE_3C) out = rule.apply(out, ctx);
  return out;
}

const NORMALIZE_ALLOWED_RELPATHS = new Map([
  [
    ".claude/manifest.json",
    "regenerated by install.ps1/update.js at install time; carries the run's mc.source provenance, repointed independently on each leg (Step 1.5)",
  ],
  [
    ".claude/paths.json",
    "regenerated by scripts/paths/build.js at install/regen time from the paths registry, independently per leg",
  ],
  [
    ".claude/framework-manifest.json",
    "regenerated by scripts/generate-framework-manifest.js at install/regen time, independently per leg",
  ],
  [
    ".claude/settings.json",
    "recompiled by scripts/hooks/build.js at install/regen time; carries a _compiledAt ISO timestamp stamped fresh per run — two independent runs never share the clock reading",
  ],
]);

const ACCEPT_ONLY_IN_UPGRADED_3C = [
  { re: /^\.claude\/\.last-checkpoint$/, why: "per-session runtime file; an older release tag can contain it, a fresh install never ships it" },
  { re: /^\.claude\/\.session-checkpoint\.json$/, why: "per-session runtime file; an older release tag can contain it, a fresh install never ships it" },
  { re: /^\.claude\/project\/builds\/builder-fixture-[0-9a-f]+\/transaction\.json$/, why: "per-fixture runtime record (nonce in the path); an older release tag can contain it, a fresh install never ships it" },
  { re: /^_mc\/agents\/president\/_system\/policy\/decision-policy\.md$/, why: "a _mc source-mirror policy copy committed into the frozen N-1 tag; not in the fresh-N install set" },
];
function isFrozenAcceptedOnlyInUpgraded(rel) {
  return ACCEPT_ONLY_IN_UPGRADED_3C.some((e) => e.re.test(rel));
}

const CONTENT_PRESERVE_DIVERGENCE_3C = new Map([
  [
    ".claude/agents/store.json",
    "RUNTIME BUILD-STATE (features/tasks/cycle/circuitBreaker/heartbeat/runLog; no version field). update PRESERVES it by design (regenerating would WIPE live state); fresh-N gets defaults, so the two legitimately differ.",
  ],
  [
    ".claude/manifest.json",
    "PROJECT-OWNED identity card. Its FRAMEWORK-owned field mc.version is verified elsewhere (3b scan:install version-match, and restamped by the update); its PROJECT-owned config (providers/agentProviders/features) is PRESERVED across upgrade (same principle as the restamp touching ONLY mc.version) while fresh-N gets 1.0.0 defaults; project.name/slug is the install-dir basename. NOTE: a FUTURE framework-owned manifest field would need separate coverage (it is not caught here).",
  ],
  [
    "PROJECT.md",
    "PROJECT-OWNED scaffolded doc; its only divergence is the project name in the H1 title (= install-dir basename, sandbox-identity). No framework content.",
  ],
]);

function compareTreeContents(treeA, treeB, commonRelPaths, ctx) {
  const mismatches = [];
  for (const rel of commonRelPaths) {
    if (rel === "_mc/MANIFEST.json") {
      const r = compareMcManifestInventory(treeA, treeB, rel);
      if (!r.equal) mismatches.push({ rel, reason: r.reason });
      continue;
    }
    if (rel === ".claude/framework-installed.json") {
      const r = compareFrameworkInstalledRecord(treeA, treeB, rel);
      if (!r.equal) mismatches.push({ rel, reason: r.reason });
      continue;
    }
    if (CONTENT_PRESERVE_DIVERGENCE_3C.has(rel)) continue;
    let bufA;
    let bufB;
    try {
      bufA = fs.readFileSync(path.join(treeA, rel));
    } catch (e) {
      mismatches.push({ rel, reason: `unreadable in upgraded tree: ${e.message}` });
      continue;
    }
    try {
      bufB = fs.readFileSync(path.join(treeB, rel));
    } catch (e) {
      mismatches.push({ rel, reason: `unreadable in fresh-N tree: ${e.message}` });
      continue;
    }
    if (bufA.equals(bufB)) continue;
    if (!NORMALIZE_ALLOWED_RELPATHS.has(rel)) {
      mismatches.push({ rel, reason: "byte-exact content differs (not in the named normalization allowlist)" });
      continue;
    }
    const normA = normalizeContent3c(bufA.toString("utf8"), ctx);
    const normB = normalizeContent3c(bufB.toString("utf8"), ctx);
    if (normA !== normB) {
      mismatches.push({ rel, reason: `content differs outside NORMALIZE_3C (named allowlisted file: ${rel})` });
    }
  }
  return { equal: mismatches.length === 0, mismatches };
}

function readJsonRecord(root, rel) {
  let s = fs.readFileSync(path.join(root, rel), "utf8");
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  return JSON.parse(s);
}

function isDispositionedInventoryKey(key) {
  return (
    key === "_mc/MANIFEST.json" ||
    isFrozenAcceptedOnlyInUpgraded(key) ||
    CONTENT_PRESERVE_DIVERGENCE_3C.has(key) ||
    isFullTreeExcluded(key)
  );
}
function compareMcManifestInventory(treeA, treeB, rel) {
  let a, b;
  try { a = readJsonRecord(treeA, rel); } catch (e) { return { equal: false, reason: `_mc/MANIFEST.json unparseable in upgraded tree: ${e.message}` }; }
  try { b = readJsonRecord(treeB, rel); } catch (e) { return { equal: false, reason: `_mc/MANIFEST.json unparseable in fresh-N tree: ${e.message}` }; }
  const topA = { ...a }; const topB = { ...b };
  delete topA.generatedAt; delete topB.generatedAt; delete topA.paths; delete topB.paths;
  if (JSON.stringify(topA) !== JSON.stringify(topB)) {
    return { equal: false, reason: "_mc/MANIFEST.json top-level fields diverge (mcVersion/schema/version/…)" };
  }
  const pa = (a && a.paths) || {};
  const pb = (b && b.paths) || {};
  const bad = [];
  for (const k of new Set([...Object.keys(pa), ...Object.keys(pb)])) {
    if (isDispositionedInventoryKey(k)) continue;
    if (JSON.stringify(pa[k]) !== JSON.stringify(pb[k])) bad.push(k);
  }
  if (bad.length) {
    return { equal: false, reason: `_mc/MANIFEST.json framework-owned inventory entries diverge (${bad.length}): ${bad.slice(0, 5).join(", ")}` };
  }
  return { equal: true, reason: "" };
}

const FRAMEWORK_INSTALLED_OWNED_FIELDS = [
  "$schema",
  "installedVersion",
  "pathRegistryVersion",
  "manifestSchema",
  "generated",
];
function compareFrameworkInstalledRecord(treeA, treeB, rel) {
  let a, b;
  try { a = readJsonRecord(treeA, rel); } catch (e) { return { equal: false, reason: `framework-installed.json unparseable in upgraded tree: ${e.message}` }; }
  try { b = readJsonRecord(treeB, rel); } catch (e) { return { equal: false, reason: `framework-installed.json unparseable in fresh-N tree: ${e.message}` }; }
  const bad = [];
  for (const f of FRAMEWORK_INSTALLED_OWNED_FIELDS) {
    if (JSON.stringify(a[f]) !== JSON.stringify(b[f])) bad.push(f);
  }
  if (bad.length) {
    return { equal: false, reason: `framework-installed.json framework-owned fields diverge: ${bad.join(", ")}` };
  }
  return { equal: true, reason: "" };
}

const FULL_TREE_EXCLUDES = [
  {
    re: /^\.git(\/|$)/,
    why: "git metadata — not a manifest asset, never install content",
  },
  {
    re: /^\.mc(\/|$)/,
    why: "update.js's own per-run transaction bookkeeping (.mc/transactions/<txId>/backup, plan, etc.) written by the Step-2 apply; the fresh-N oracle never runs an update, so this subtree has no counterpart to diff against",
  },
  {
    re: /^\.claude\/runtime(\/|$)/,
    why: "runtime state (events, dispatch, checkpoints) written at RUN time by whichever process subsequently touches the tree (scan:install, update.js) — not by install/apply content itself; same class test-install-matrix.js's PARITY_ALLOWLIST already vets",
  },
  {
    re: /^\.claude\/project\/events(\/|$)/,
    why: "event logs — per-run, not install content",
  },
  {
    re: /^\.claude\/project\/memory(\/|$)/,
    why: "memory stores — per-run, not install content",
  },
  {
    re: /(^|\/)node_modules(\/|$)/,
    why: "dependency tree — never a manifest asset or install content",
  },
  {
    re: /(^|\/)\.DS_Store$/,
    why: "macOS filesystem noise",
  },
];

function isFullTreeExcluded(rel) {
  return FULL_TREE_EXCLUDES.some((e) => e.re.test(rel));
}

function fullTreeFileList(rootDir) {
  const out = [];
  function walk(absDir, relDir) {
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch (e) {
      throw new Error(`fullTreeFileList: cannot read ${relDir || "."} (${e.code || e.message}) — full-tree parity uncertifiable, fail-closed`);
    }
    for (const ent of entries) {
      const relPath = relDir ? `${relDir}/${ent.name}` : ent.name;
      if (ent.isSymbolicLink()) {
        if (isFullTreeExcluded(relPath)) continue;
        let target;
        try {
          target = fs.readlinkSync(path.join(absDir, ent.name));
        } catch (e) {
          throw new Error(`fullTreeFileList: cannot readlink ${relPath} (${e.code || e.message}) — full-tree parity uncertifiable, fail-closed`);
        }
        out.push({ rel: relPath, type: "symlink", target });
      } else if (ent.isDirectory()) {
        if (isFullTreeExcluded(`${relPath}/`)) continue;
        walk(path.join(absDir, ent.name), relPath);
      } else if (ent.isFile()) {
        if (!isFullTreeExcluded(relPath)) out.push({ rel: relPath, type: "file" });
      }
    }
  }
  walk(rootDir, "");
  out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return out;
}

function compareTypedEntries(mapA, mapB) {
  const typeMismatches = [];
  const symlinkTargetMismatches = [];
  const commonFileRels = [];
  for (const rel of mapA.keys()) {
    if (!mapB.has(rel)) continue;
    const a = mapA.get(rel);
    const b = mapB.get(rel);
    if (a.type !== b.type) {
      typeMismatches.push(`${rel} (a=${a.type} b=${b.type})`);
      continue;
    }
    if (a.type === "symlink") {
      if (a.target !== b.target) {
        symlinkTargetMismatches.push(`${rel} (a->${a.target} b->${b.target})`);
      }
      continue;
    }
    commonFileRels.push(rel);
  }
  return { typeMismatches, symlinkTargetMismatches, commonFileRels };
}

function listDirtyFiles() {
  const r = spawnSync("git", ["status", "--porcelain", "-z", "--untracked-files=all"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new Error(`listDirtyFiles: git status failed (status=${r.status}${r.error ? `, ${r.error.code || r.error.message}` : ""}): ${(r.stderr || r.stdout || "").slice(0, 300)}`);
  }
  const parts = (r.stdout || "").split("\0");
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i];
    if (!rec) continue;
    const status = rec.slice(0, 2);
    files.push(rec.slice(3));
    if (status[0] === "R" || status[0] === "C") i++;
  }
  return files;
}

function hashDirtyFileSet(rootDir, relFiles) {
  const hashes = {};
  for (const rel of relFiles) {
    try {
      const buf = fs.readFileSync(path.join(rootDir, rel));
      hashes[rel] = crypto.createHash("sha256").update(buf).digest("hex");
    } catch (e) {
      hashes[rel] = `UNREADABLE:${e.code || e.message}`;
    }
  }
  return hashes;
}

function dirtySetUnchanged(beforeHashes, afterHashes) {
  const changed = [];
  const keys = new Set([...Object.keys(beforeHashes || {}), ...Object.keys(afterHashes || {})]);
  for (const k of keys) {
    if ((beforeHashes || {})[k] !== (afterHashes || {})[k]) changed.push(k);
  }
  return { equal: changed.length === 0, changed };
}

async function runEngine({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const asserts = [];
  const assert = (name, ok, detail, opts) => {
    const loadBearing = !opts || opts.loadBearing !== false;
    asserts.push({ name, ok: !!ok, detail: detail || "", loadBearing });
    return !!ok;
  };

  let from_version = null;
  let to_version = null;
  let ran = false;
  let ps_available = null;
  let incomplete = false;
  let incompleteReason = null;

  const beforeSnapshot = snapshotCanonicalState();
  const dirtyFilesBefore = listDirtyFiles();
  const dirtyHashesBefore = hashDirtyFileSet(REPO_ROOT, dirtyFilesBefore);
  const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const tmpBase = path.join(os.tmpdir(), `mc-gateb-${nonce}`);
  const n1Src = path.join(tmpBase, "n1-src");
  const n1Install = path.join(tmpBase, "n1-install");

  try {
    let proceed = true;

    let versions = null;
    try {
      versions = resolveVersions();
    } catch (e) {
      assert("n1_resolved", false, `version resolution threw: ${e.message}`);
      proceed = false;
    }
    if (proceed) {
      if (versions.incomplete) {
        incomplete = true;
        incompleteReason = versions.reason;
        assert("upgrade_target_available", false, `INCOMPLETE (skip-loud): ${versions.reason}`, { loadBearing: false });
        proceed = false;
      } else {
        to_version = versions.n;
        from_version = versions.n1;
        assert("n1_resolved", true, `N=${to_version} (unreleased cut) N-1=${from_version} (newest shipped)`);
      }
    }

    if (proceed) {
      try {
        assertSandboxTargetSafe(n1Src, { label: "n1-src worktree target" });
        assertSandboxTargetSafe(n1Install, { label: "n1-install sandbox target" });
        assert("sandbox_targets_safe", true, "");
      } catch (e) {
        assert("sandbox_targets_safe", false, e.message);
        proceed = false;
      }
    }

    if (proceed) {
      fs.mkdirSync(tmpBase, { recursive: true });
      const tag = `mc@${from_version}`;
      const wtAdd = spawnSync("git", ["worktree", "add", "--detach", n1Src, tag], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        timeout: 60_000,
      });
      if (wtAdd.status !== 0) {
        assert("n1_worktree_materialized", false, `git worktree add ${n1Src} ${tag} failed: ${describeSpawnFailure(wtAdd)}`);
        proceed = false;
      } else {
        assert("n1_worktree_materialized", true, "");
      }
    }

    let ps = null;
    if (proceed) {
      ps = findPowershellReal();
      ps_available = !!ps;
      if (!ps) {
        assert("ps_available", false, "no PowerShell found on this host — engine INCOMPLETE (skip-loud), not a pass");
        proceed = false;
      }
    }

    if (proceed) {
      const n1InstallPs1 = path.join(n1Src, "install.ps1");
      if (!fs.existsSync(n1InstallPs1)) {
        assert("n1_install_ps1_present", false, `expected ${n1InstallPs1} in the materialized N-1 worktree`);
        proceed = false;
      }
    }

    if (proceed) {
      fs.mkdirSync(n1Install, { recursive: true });
      const installRun = spawnSync(
        ps,
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(n1Src, "install.ps1"), "-Target", n1Install, "-SkipPrompt"],
        { cwd: n1Src, encoding: "utf8", timeout: timeoutMs },
      );
      const n1Installed = fs.existsSync(path.join(n1Install, ".claude", "framework-installed.json"));
      const installOk = installRun.status === 0 && n1Installed;
      assert(
        "n1_install_materialized",
        installOk,
        installOk
          ? ""
          : installRun.status !== 0
            ? `install.ps1 -Target ${n1Install} failed: ${describeSpawnFailure(installRun)}`
            : `install.ps1 exited 0 but no .claude/framework-installed.json under ${n1Install} — silent-downgrade class, not a real install`,
      );
      if (!installOk) proceed = false;
    }

    if (proceed) {
      try {
        const installedJsonPath = path.join(n1Install, ".claude", "framework-installed.json");
        const installedJson = JSON.parse(fs.readFileSync(installedJsonPath, "utf8"));
        installedJson.source = REPO_ROOT;
        fs.writeFileSync(installedJsonPath, JSON.stringify(installedJson, null, 2));
        const manifestPath = path.join(n1Install, ".claude", "manifest.json");
        if (fs.existsSync(manifestPath)) {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
          if (manifest && manifest.mc) {
            manifest.mc.source = REPO_ROOT;
            fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
          }
        }
        assert("n1_source_repointed_to_N", true, "");
      } catch (e) {
        assert("n1_source_repointed_to_N", false, `could not repoint N-1 install source to N: ${e.message}`);
        proceed = false;
      }
    }

    if (proceed) {
      ran = true;
      let r = null;
      try {
        // eslint-disable-next-line global-require
        const { run } = require("./update");
        r = await Promise.race([
          run({ to: to_version, source: REPO_ROOT, target: n1Install, apply: true, allRed: true }),
          new Promise((_, reject) => setTimeout(() => reject(new Error("apply TIMEOUT (fail-closed backstop)")), timeoutMs)),
        ]);
      } catch (e) {
        assert("apply_committed", false, `run() threw or timed out: ${e.message}`);
        proceed = false;
      }
      if (proceed) {
        const pf = (r && r.postflight && (r.postflight.gates || r.postflight.checks)) || [];
        const pfFails = pf
          .filter((x) => x.status && x.status !== "green" && x.status !== "pass")
          .map((x) => `${x.name}:${x.status}(${(x.reason || "").slice(0, 80)})`);
        if (r && r.committed === true) {
          assert(
            "apply_committed",
            true,
            r.ok === true
              ? ""
              : `apply COMMITTED with postflight warnings (self-report — NOT gated; 3b/3c judge conformance): ${pfFails.join("; ") || "(no postflight detail)"}`,
          );
          const smoke = pf.find((x) => x.name === "provider-smoke");
          if (smoke && smoke.status !== "green" && smoke.status !== "pass") {
            assert(
              "provider_smoke_ENVIRONMENTAL_OBSERVATION",
              true,
              `OUT OF UPGRADE-GATE SCOPE: provider-smoke ${smoke.status} (${(smoke.reason || "").slice(0, 80)}). Sandbox has no provider auth by design; runtime connectivity is not upgrade conformance.`,
              { loadBearing: false },
            );
          }
        } else {
          const preReds = ((r && r.preflight && r.preflight.gates) || [])
            .filter((x) => x.status === "red")
            .map((x) => `${x.name}:${(x.reason || "").slice(0, 80)}`);
          const detail =
            (r && r.error) ||
            (preReds.length ? `PREFLIGHT: ${preReds.join("; ")}` : "") ||
            (pfFails.length ? `POSTFLIGHT (uncommitted): ${pfFails.join("; ")}` : "") ||
            (r && r.outcome ? `outcome=${r.outcome}` : "") ||
            "run() returned committed:false with no error/preflight/postflight detail (update.js loud-fail gap)";
          assert("apply_committed", false, detail);
          proceed = false;
        }
      }
    }

    if (proceed) {
      let installedVersion = null;
      try {
        const fi = JSON.parse(fs.readFileSync(path.join(n1Install, ".claude", "framework-installed.json"), "utf8"));
        installedVersion = fi.installedVersion;
      } catch (e) {
        assert(
          "version_sanity_NON_LOAD_BEARING",
          false,
          `could not read upgraded framework-installed.json: ${e.message}`,
          { loadBearing: false },
        );
      }
      if (installedVersion !== null) {
        const r3a = check3aVersionSanity(installedVersion, to_version);
        assert("version_sanity_NON_LOAD_BEARING", r3a.ok, r3a.detail, { loadBearing: false });
      }
    }

    if (proceed) {
      const scan = spawnSync(process.execPath, [path.join(REPO_ROOT, "scripts", "check", "install.js")], {
        cwd: n1Install,
        encoding: "utf8",
        timeout: SCAN_INSTALL_TIMEOUT_MS,
      });
      const r3b = check3bScanInstall(scan);
      assert("scan_install_green_3b", r3b.ok, r3b.detail);
    }

    if (proceed) {
      const oracleRoot = path.join(tmpBase, "freshN");
      try {
        assertSandboxTargetSafe(oracleRoot, { label: "freshN oracle sandbox target" });
        const leg = runLeg3({ sandboxRoot: oracleRoot, timeoutMs: ORACLE_TIMEOUT_MS });
        const freshNTree = path.join(oracleRoot, "leg3-installps1");

        const legAsserts = (leg && Array.isArray(leg.asserts)) ? leg.asserts : [];
        const oracleCore = legAsserts.filter((a) => !/both_path_parity/.test(a.name));
        const oracleReady =
          !!leg &&
          leg.ran === true &&
          oracleCore.length > 0 &&
          oracleCore.every((a) => a.status === "pass") &&
          fs.existsSync(path.join(freshNTree, ".claude", "framework-installed.json"));

        if (!oracleReady) {
          const failed = oracleCore.filter((a) => a.status !== "pass").map((a) => a.name);
          assert(
            "fresh_n_oracle_ready_3c",
            false,
            `fresh-N oracle install INCOMPLETE (ps_available=${leg && leg.ps_available} ran=${leg && leg.ran}) — 3c skip-loud, NOT a pass: ${failed.join("; ") || "no oracle asserts produced"}`,
          );
        } else {
          const upgradedList = fullTreeFileList(n1Install);
          const freshList = fullTreeFileList(freshNTree);
          const upgradedMap = new Map(upgradedList.map((e) => [e.rel, e]));
          const freshMap = new Map(freshList.map((e) => [e.rel, e]));

          const pathParity = parityDiff([...upgradedMap.keys()], [...freshMap.keys()]);
          const unacceptedOnlyInA = pathParity.onlyInA.filter((p) => !isFrozenAcceptedOnlyInUpgraded(p));
          assert(
            "fresh_n_parity_pathset_3c",
            unacceptedOnlyInA.length === 0 && pathParity.onlyInB.length === 0,
            `onlyInUpgraded(unaccepted ${unacceptedOnlyInA.length})=${unacceptedOnlyInA.slice(0, 8).join(", ")} | onlyInFreshN(${pathParity.onlyInB.length})=${pathParity.onlyInB.slice(0, 8).join(", ")} | accepted=${pathParity.onlyInA.length - unacceptedOnlyInA.length}`,
          );

          const typed = compareTypedEntries(upgradedMap, freshMap);
          assert(
            "fresh_n_parity_type_3c",
            typed.typeMismatches.length === 0,
            typed.typeMismatches.length
              ? `${typed.typeMismatches.length} path(s) diverge in entry type (file vs symlink): ${typed.typeMismatches.slice(0, 5).join(", ")}`
              : "",
          );
          assert(
            "fresh_n_parity_symlink_target_3c",
            typed.symlinkTargetMismatches.length === 0,
            typed.symlinkTargetMismatches.length
              ? `${typed.symlinkTargetMismatches.length} symlink(s) diverge in TARGET: ${typed.symlinkTargetMismatches.slice(0, 5).join(", ")}`
              : "",
          );

          const ctx = { sandboxRoots: [n1Install, freshNTree, oracleRoot], nonces: [nonce] };
          const contentResult = compareTreeContents(n1Install, freshNTree, typed.commonFileRels, ctx);
          assert(
            "fresh_n_parity_content_3c",
            contentResult.equal,
            contentResult.equal
              ? ""
              : `content diverges outside NORMALIZE_3C in ${contentResult.mismatches.length} file(s): ${contentResult.mismatches
                  .slice(0, 5)
                  .map((m) => `${m.rel} (${m.reason})`)
                  .join(", ")}`,
          );
        }
      } catch (e) {
        assert("fresh_n_oracle_ready_3c", false, `runLeg3/3c threw: ${e.message}`);
      }
    }
  } catch (e) {
    assert("engine_uncaught_exception", false, e.message);
  } finally {
    try {
      spawnSync("git", ["worktree", "remove", "--force", n1Src], { cwd: REPO_ROOT, encoding: "utf8", timeout: 60_000 });
    } catch {
    }
    try {
      spawnSync("git", ["worktree", "prune"], { cwd: REPO_ROOT, encoding: "utf8", timeout: 30_000 });
    } catch {
    }
    try {
      if (!mcEnv.readEnv("GATEB_KEEP")) fs.rmSync(tmpBase, { recursive: true, force: true });
      else process.stderr.write(`[MC_GATEB_KEEP] preserved sandbox: ${tmpBase}\n`);
    } catch {
    }
  }

  const afterSnapshot = snapshotCanonicalState();
  const delta = noDeltaCheck(beforeSnapshot, afterSnapshot);
  const dirtyHashesAfter = hashDirtyFileSet(REPO_ROOT, dirtyFilesBefore);
  const dirtyContentCheck = dirtySetUnchanged(dirtyHashesBefore, dirtyHashesAfter);
  assert(
    "dirty_set_content_unchanged",
    dirtyContentCheck.equal,
    dirtyContentCheck.equal
      ? ""
      : `already-dirty file(s) changed CONTENT during the run even though a porcelain status-line diff would not catch it: ${dirtyContentCheck.changed.slice(0, 8).join(", ")}`,
  );

  const loadBearingAsserts = asserts.filter((a) => a.loadBearing !== false);
  const assertsOk = loadBearingAsserts.length > 0 && loadBearingAsserts.every((a) => a.ok);
  const REQUIRED_NAMED_LOAD_BEARING_ASSERTS = [
    "scan_install_green_3b",
    "fresh_n_parity_pathset_3c",
    "fresh_n_parity_type_3c",
    "fresh_n_parity_symlink_target_3c",
    "fresh_n_parity_content_3c",
  ];
  const requiredNamedEvidencePresent = REQUIRED_NAMED_LOAD_BEARING_ASSERTS.every((name) => {
    const a = asserts.find((x) => x.name === name);
    return !!a && a.ok === true;
  });
  const ok = incomplete ? null : delta.equal && dirtyContentCheck.equal && assertsOk && requiredNamedEvidencePresent;

  return {
    ok,
    incomplete,
    incomplete_reason: incompleteReason,
    from_version,
    to_version,
    ran,
    ps_available,
    asserts,
    sandbox_isolation: {
      no_delta: delta.equal,
      onlyBefore: delta.onlyBefore,
      onlyAfter: delta.onlyAfter,
      dirty_set_content_unchanged: dirtyContentCheck.equal,
      dirty_set_changed_files: dirtyContentCheck.changed,
    },
  };
}

function selfTest() {
  const results = [];
  const t = (name, fn) => {
    try {
      const r = fn();
      results.push({ name, status: r === false ? "fail" : "pass", detail: r === false ? "" : undefined });
    } catch (e) {
      results.push({ name, status: "fail", detail: e.message });
    }
  };

  t("tagExists THROWS on a git ERROR (non-zero exit) — never silently folded into tag-absence", () => {
    let threw = false;
    try {
      tagExists("0.17.0", () => ({ status: 128, stdout: "", stderr: "fatal: synthetic git error", error: null, signal: null }));
    } catch (e) {
      threw = /git tag -l exited non-zero/.test(e.message);
    }
    return threw === true;
  });
  t("tagExists THROWS on a spawn error (e.g. git binary missing)", () => {
    let threw = false;
    try {
      tagExists("0.17.0", () => ({ error: new Error("ENOENT: spawn git"), status: null, stdout: "", stderr: "" }));
    } catch (e) {
      threw = /spawn error/.test(e.message);
    }
    return threw === true;
  });
  t("tagExists positive control — a CLEAN exit-0 no-match result returns false (real tag-absence, not an error)", () => {
    return tagExists("0.17.0", () => ({ status: 0, stdout: "", stderr: "", error: null, signal: null })) === false;
  });
  t("tagExists positive control — a CLEAN exit-0 matching result returns true", () => {
    return tagExists("0.17.0", () => ({ status: 0, stdout: "mc@0.17.0\n", stderr: "", error: null, signal: null })) === true;
  });
  t("resolveVersions PROPAGATES a mocked git-tag error as a THROW (NOT folded into ordinary incomplete:true)", () => {
    let threw = false;
    let becameIncomplete = false;
    try {
      const r = resolveVersions({
        tagExistsFn: () => {
          throw new Error("SYNTHETIC git-tag ERROR (mocked)");
        },
      });
      becameIncomplete = !!(r && r.incomplete === true);
    } catch (e) {
      threw = /SYNTHETIC git-tag ERROR/.test(e.message);
    }
    return threw === true && becameIncomplete === false;
  });
  t("identity bind — an untagged capsule whose version != version.json is REJECTED (fail-closed, never a phantom N)", () => {
    let threw = false;
    try {
      checkUnreleasedCutIdentity("0.16.0", "0.17.0");
    } catch (e) {
      threw = /identity mismatch/.test(e.message) && /phantom N/.test(e.message);
    }
    return threw === true;
  });
  t("identity bind positive control — unreleasedCut === version.json's version is ACCEPTED", () => {
    return checkUnreleasedCutIdentity("0.17.0", "0.17.0") === true;
  });

  t("3a REDs on a synthetic upgraded install whose framework-installed.json still says N-1 (non-advancing version, NOT a correctness proof)", () => {
    return check3aVersionSanity("0.16.0", "0.17.0").ok === false;
  });
  t("3a positive control: installedVersion === N GREENs", () => {
    return check3aVersionSanity("0.17.0", "0.17.0").ok === true;
  });

  t("3b REDs when scan:install exits non-zero (synthetic failing status)", () => {
    return check3bScanInstall({ status: 1, stdout: "", stderr: "synthetic scan:install failure" }).ok === false;
  });
  t("3b positive control: scan:install status 0 GREENs", () => {
    return check3bScanInstall({ status: 0, stdout: "", stderr: "" }).ok === true;
  });

  t("REGRESSION-DETECTING: a scan failure whose FAIL line sits >400 chars from the END is still NAMED (the old slice(-400) tail-truncation MASKED it as an adjacent OK line)", () => {
    const failLine = "FAIL  manifest.mc.version matches version.json  (manifest=0.17.0 version.json=1.0.0)";
    const trailingOk = Array.from({ length: 12 }, (_, i) => `OK    trailing check ${i} padding padding padding padding`).join("\n");
    const stdout = `${failLine}\n${trailingOk}\n# 17/18 passed`;
    if (stdout.slice(-400).includes(failLine)) return false;
    const desc = describeSpawnFailure({ status: 1, stdout, stderr: "" });
    return desc.includes("manifest.mc.version matches version.json") && desc.startsWith("code=1 FAILING:");
  });
  t("positive control: a non-check spawn failure (no FAIL marker) still falls back to the byte-tail", () => {
    const desc = describeSpawnFailure({ status: 128, stdout: "", stderr: "fatal: not a git repository" });
    return desc.includes("not a git repository") && desc.startsWith("code=128 ");
  });

  t("3c content-parity REDs on divergence in a NORMALIZATION-EXCLUDED content region (not a timestamp/nonce/path/txn-id) — inside a NAMED allowlisted file", () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-3c-red-a-"));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-3c-red-b-"));
    try {
      fs.mkdirSync(path.join(dirA, ".claude"), { recursive: true });
      fs.mkdirSync(path.join(dirB, ".claude"), { recursive: true });
      fs.writeFileSync(
        path.join(dirA, ".claude", "paths.json"),
        '{"generatedAt":"2026-07-21T00:00:00.000Z","transactionId":"txn-aaa111","featureFlag":"on"}',
      );
      fs.writeFileSync(
        path.join(dirB, ".claude", "paths.json"),
        '{"generatedAt":"2026-07-21T00:00:01.000Z","transactionId":"txn-bbb222","featureFlag":"off"}',
      );
      const ctx = { sandboxRoots: [dirA, dirB] };
      const result = compareTreeContents(dirA, dirB, [".claude/paths.json"], ctx);
      return result.equal === false;
    } finally {
      fs.rmSync(dirA, { recursive: true, force: true });
      fs.rmSync(dirB, { recursive: true, force: true });
    }
  });
  t("3c positive control: two trees differing ONLY in normalized volatile fields (timestamp + txn id) parity EQUAL (normalization works and isn't too narrow) — inside a NAMED allowlisted file", () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-3c-green-a-"));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-3c-green-b-"));
    try {
      fs.mkdirSync(path.join(dirA, ".claude"), { recursive: true });
      fs.mkdirSync(path.join(dirB, ".claude"), { recursive: true });
      fs.writeFileSync(
        path.join(dirA, ".claude", "paths.json"),
        '{"generatedAt":"2026-07-21T00:00:00.000Z","transactionId":"txn-aaa111","featureFlag":"on"}',
      );
      fs.writeFileSync(
        path.join(dirB, ".claude", "paths.json"),
        '{"generatedAt":"2026-07-21T00:05:32.114Z","transactionId":"txn-bbb222","featureFlag":"on"}',
      );
      const ctx = { sandboxRoots: [dirA, dirB] };
      const result = compareTreeContents(dirA, dirB, [".claude/paths.json"], ctx);
      return result.equal === true;
    } finally {
      fs.rmSync(dirA, { recursive: true, force: true });
      fs.rmSync(dirB, { recursive: true, force: true });
    }
  });
  t("3c positive control: absolute sandbox-root paths embedded in content are normalized away (sandbox identity, not upgrade content) — inside a NAMED allowlisted file", () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-3c-path-a-"));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-3c-path-b-"));
    try {
      fs.mkdirSync(path.join(dirA, ".claude"), { recursive: true });
      fs.mkdirSync(path.join(dirB, ".claude"), { recursive: true });
      fs.writeFileSync(path.join(dirA, ".claude", "paths.json"), JSON.stringify({ installedFrom: dirA }));
      fs.writeFileSync(path.join(dirB, ".claude", "paths.json"), JSON.stringify({ installedFrom: dirB }));
      const ctx = { sandboxRoots: [dirA, dirB] };
      const result = compareTreeContents(dirA, dirB, [".claude/paths.json"], ctx);
      return result.equal === true;
    } finally {
      fs.rmSync(dirA, { recursive: true, force: true });
      fs.rmSync(dirB, { recursive: true, force: true });
    }
  });

  t("two binary files differing ONLY in an invalid-UTF-8 byte (0xFF vs 0xFE) RED byte-exact (not in the named normalization allowlist)", () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-bin-a-"));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-bin-b-"));
    try {
      fs.writeFileSync(path.join(dirA, "blob.bin"), Buffer.from([0x00, 0xff, 0x01]));
      fs.writeFileSync(path.join(dirB, "blob.bin"), Buffer.from([0x00, 0xfe, 0x01]));
      const result = compareTreeContents(dirA, dirB, ["blob.bin"], { sandboxRoots: [dirA, dirB] });
      return result.equal === false;
    } finally {
      fs.rmSync(dirA, { recursive: true, force: true });
      fs.rmSync(dirB, { recursive: true, force: true });
    }
  });

  t("(REGRESSION-DETECTING): a NON-named file whose ONLY difference is a NORMALIZE_3C-matching TIMESTAMP value REDs byte-exact: only files in the named normalization allowlist are normalized, so its two timestamps never normalize to EQUAL (false-green)", () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-namedset-red-a-"));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-namedset-red-b-"));
    try {
      fs.writeFileSync(path.join(dirA, "not-named.bin"), "payload-2020-01-01T00:00:00.000Z-end");
      fs.writeFileSync(path.join(dirB, "not-named.bin"), "payload-2099-12-31T23:59:59.999Z-end");
      const result = compareTreeContents(dirA, dirB, ["not-named.bin"], { sandboxRoots: [dirA, dirB] });
      return result.equal === false;
    } finally {
      fs.rmSync(dirA, { recursive: true, force: true });
      fs.rmSync(dirB, { recursive: true, force: true });
    }
  });
  t("positive control: a REAL timestamp divergence IN a NAMED allowlisted file (.claude/paths.json) still normalizes to EQUAL", () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-namedset-green-a-"));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-namedset-green-b-"));
    try {
      fs.mkdirSync(path.join(dirA, ".claude"), { recursive: true });
      fs.mkdirSync(path.join(dirB, ".claude"), { recursive: true });
      fs.writeFileSync(
        path.join(dirA, ".claude", "paths.json"),
        JSON.stringify({ installedVersion: "0.17.0", installedAt: "2026-07-21T00:00:00.000Z" }),
      );
      fs.writeFileSync(
        path.join(dirB, ".claude", "paths.json"),
        JSON.stringify({ installedVersion: "0.17.0", installedAt: "2026-07-21T00:09:12.500Z" }),
      );
      const ctx = { sandboxRoots: [dirA, dirB], nonces: [] };
      const result = compareTreeContents(dirA, dirB, [".claude/paths.json"], ctx);
      return result.equal === true;
    } finally {
      fs.rmSync(dirA, { recursive: true, force: true });
      fs.rmSync(dirB, { recursive: true, force: true });
    }
  });

  t("a synthetic upgraded tree whose framework-installed.json installedVersion != the oracle's REDs 3c (defeats the 3a-only settable-label case)", () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-instver-red-a-"));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-instver-red-b-"));
    try {
      fs.mkdirSync(path.join(dirA, ".claude"), { recursive: true });
      fs.mkdirSync(path.join(dirB, ".claude"), { recursive: true });
      fs.writeFileSync(
        path.join(dirA, ".claude", "framework-installed.json"),
        JSON.stringify({ installedVersion: "0.16.0", installedAt: "2026-07-21T00:00:00.000Z", source: "/repo" }),
      );
      fs.writeFileSync(
        path.join(dirB, ".claude", "framework-installed.json"),
        JSON.stringify({ installedVersion: "0.17.0", installedAt: "2026-07-21T00:05:00.000Z", source: "/repo" }),
      );
      const ctx = { sandboxRoots: [dirA, dirB], nonces: [] };
      const result = compareTreeContents(dirA, dirB, [".claude/framework-installed.json"], ctx);
      return result.equal === false;
    } finally {
      fs.rmSync(dirA, { recursive: true, force: true });
      fs.rmSync(dirB, { recursive: true, force: true });
    }
  });
  t("positive control: two framework-installed.json trees differing ONLY in installedAt timestamp (same installedVersion) parity EQUAL", () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-instver-green-a-"));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-instver-green-b-"));
    try {
      fs.mkdirSync(path.join(dirA, ".claude"), { recursive: true });
      fs.mkdirSync(path.join(dirB, ".claude"), { recursive: true });
      fs.writeFileSync(
        path.join(dirA, ".claude", "framework-installed.json"),
        JSON.stringify({ installedVersion: "0.17.0", installedAt: "2026-07-21T00:00:00.000Z", source: "/repo" }),
      );
      fs.writeFileSync(
        path.join(dirB, ".claude", "framework-installed.json"),
        JSON.stringify({ installedVersion: "0.17.0", installedAt: "2026-07-21T00:09:12.500Z", source: "/repo" }),
      );
      const ctx = { sandboxRoots: [dirA, dirB], nonces: [] };
      const result = compareTreeContents(dirA, dirB, [".claude/framework-installed.json"], ctx);
      return result.equal === true;
    } finally {
      fs.rmSync(dirA, { recursive: true, force: true });
      fs.rmSync(dirB, { recursive: true, force: true });
    }
  });

  t("fullTreeFileList walks a path the scoped test-install-matrix treeFileList excludes (e.g. scripts/…), so a divergence there is visible to 3c", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-fulltree-"));
    try {
      fs.mkdirSync(path.join(dir, "scripts", "mc"), { recursive: true });
      fs.writeFileSync(path.join(dir, "scripts", "mc", "update.js"), "// out-of-scope-for-the-old-scoped-list\n");
      fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
      fs.writeFileSync(path.join(dir, ".claude", "framework-installed.json"), "{}");
      const list = fullTreeFileList(dir);
      const rels = list.map((e) => e.rel);
      return (
        rels.includes("scripts/mc/update.js") &&
        rels.includes(".claude/framework-installed.json") &&
        list.every((e) => e.type === "file")
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  t("fullTreeFileList still excludes the short enumerated volatile set (.git, .mc, .claude/runtime, .claude/project/events, .claude/project/memory)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-fulltree-excl-"));
    try {
      for (const rel of [
        ".git/HEAD",
        ".mc/transactions/tx-1/backup.json",
        ".claude/runtime/events.log",
        ".claude/project/events/e.jsonl",
        ".claude/project/memory/MEMORY.md",
      ]) {
        fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
        fs.writeFileSync(path.join(dir, rel), "x");
      }
      fs.writeFileSync(path.join(dir, "ROADMAP.md"), "x");
      const list = fullTreeFileList(dir);
      return list.length === 1 && list[0].rel === "ROADMAP.md" && list[0].type === "file";
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  t("two symlink entries at the SAME rel path but DIFFERENT targets is a MISMATCH (not silently skipped by presence-only parity)", () => {
    const mapA = new Map([["link", { rel: "link", type: "symlink", target: "../a-target" }]]);
    const mapB = new Map([["link", { rel: "link", type: "symlink", target: "../b-target" }]]);
    const r = compareTypedEntries(mapA, mapB);
    return r.symlinkTargetMismatches.length === 1 && r.typeMismatches.length === 0 && r.commonFileRels.length === 0;
  });
  t("positive control: two symlink entries pointing at the SAME target are NOT a mismatch", () => {
    const mapA = new Map([["link", { rel: "link", type: "symlink", target: "../same-target" }]]);
    const mapB = new Map([["link", { rel: "link", type: "symlink", target: "../same-target" }]]);
    const r = compareTypedEntries(mapA, mapB);
    return r.symlinkTargetMismatches.length === 0 && r.typeMismatches.length === 0;
  });
  t("(integration): fullTreeFileList records a REAL symlink's readlinkSync TARGET, never follows it — skips gracefully (not a fail) if the platform disallows symlink creation (Windows Developer Mode/admin)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-symlink-"));
    try {
      fs.writeFileSync(path.join(dir, "real-target.txt"), "x");
      try {
        fs.symlinkSync("real-target.txt", path.join(dir, "the-link"));
      } catch {
        return true;
      }
      const list = fullTreeFileList(dir);
      const linkEntry = list.find((e) => e.rel === "the-link");
      return !!linkEntry && linkEntry.type === "symlink" && linkEntry.target === "real-target.txt";
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  t("TERMINAL: a readlinkSync FAILURE makes fullTreeFileList THROW (full-tree uncertifiable) — never a comparable <UNREADABLE> sentinel that two unreadable links could match on to false-green", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-readlink-throw-"));
    const realReadlink = fs.readlinkSync;
    try {
      fs.writeFileSync(path.join(dir, "real-target.txt"), "x");
      try {
        fs.symlinkSync("real-target.txt", path.join(dir, "the-link"));
      } catch {
        return true;
      }
      fs.readlinkSync = () => {
        const e = new Error("simulated readlink EACCES");
        e.code = "EACCES";
        throw e;
      };
      let threw = false;
      try {
        fullTreeFileList(dir);
      } catch {
        threw = true;
      }
      return threw === true;
    } finally {
      fs.readlinkSync = realReadlink;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  t("a rel path CONTAINING the OLD string-marker literal ('\\t<SYMLINK>') is judged SOLELY by its typed `type` field — a FILE entry at such a path is treated as a normal file, NOT silently skipped the way the old `rel.includes(\"\\t<SYMLINK>\")` check would", () => {
    const trickyRel = "some/real/path.txt\t<SYMLINK>";
    const mapA = new Map([[trickyRel, { rel: trickyRel, type: "file" }]]);
    const mapB = new Map([[trickyRel, { rel: trickyRel, type: "file" }]]);
    const r = compareTypedEntries(mapA, mapB);
    return r.commonFileRels.includes(trickyRel) && r.typeMismatches.length === 0;
  });
  t("positive control: a rel path present as a FILE in one tree and a SYMLINK in the other (same rel) is a TYPE mismatch, never silently merged/skipped", () => {
    const mapA = new Map([["path/x", { rel: "path/x", type: "file" }]]);
    const mapB = new Map([["path/x", { rel: "path/x", type: "symlink", target: "somewhere" }]]);
    const r = compareTypedEntries(mapA, mapB);
    return r.typeMismatches.length === 1 && r.commonFileRels.length === 0 && r.symlinkTargetMismatches.length === 0;
  });

  t("nonce-SHAPED real content drift ('release-alpha' vs 'release-bravo') is NOT swallowed by normalization — REDs", () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-nonce-red-a-"));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-nonce-red-b-"));
    try {
      fs.mkdirSync(path.join(dirA, ".claude"), { recursive: true });
      fs.mkdirSync(path.join(dirB, ".claude"), { recursive: true });
      const mintedNonce = "abc123x-yz98";
      fs.writeFileSync(path.join(dirA, ".claude", "paths.json"), `tmpdir-id=${mintedNonce} releaseTag=release-alpha`);
      fs.writeFileSync(path.join(dirB, ".claude", "paths.json"), `tmpdir-id=${mintedNonce} releaseTag=release-bravo`);
      const ctx = { sandboxRoots: [], nonces: [mintedNonce] };
      const result = compareTreeContents(dirA, dirB, [".claude/paths.json"], ctx);
      return result.equal === false;
    } finally {
      fs.rmSync(dirA, { recursive: true, force: true });
      fs.rmSync(dirB, { recursive: true, force: true });
    }
  });
  t("positive control: two trees differing ONLY in their own actual minted nonce literals (passed via ctx.nonces) parity EQUAL", () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-nonce-green-a-"));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-nonce-green-b-"));
    try {
      fs.mkdirSync(path.join(dirA, ".claude"), { recursive: true });
      fs.mkdirSync(path.join(dirB, ".claude"), { recursive: true });
      const nonceA = "abc123x-yz98";
      const nonceB = "def456y-wq12";
      fs.writeFileSync(path.join(dirA, ".claude", "paths.json"), `tmpdir-id=${nonceA} featureFlag=on`);
      fs.writeFileSync(path.join(dirB, ".claude", "paths.json"), `tmpdir-id=${nonceB} featureFlag=on`);
      const ctx = { sandboxRoots: [], nonces: [nonceA, nonceB] };
      const result = compareTreeContents(dirA, dirB, [".claude/paths.json"], ctx);
      return result.equal === true;
    } finally {
      fs.rmSync(dirA, { recursive: true, force: true });
      fs.rmSync(dirB, { recursive: true, force: true });
    }
  });

  t("framework-installed structured: an UNDISPOSITIONED framework field (pathRegistryVersion) divergence REDs", () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-fi-owned-red-a-"));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-fi-owned-red-b-"));
    try {
      fs.mkdirSync(path.join(dirA, ".claude"), { recursive: true });
      fs.mkdirSync(path.join(dirB, ".claude"), { recursive: true });
      fs.writeFileSync(path.join(dirA, ".claude", "framework-installed.json"), JSON.stringify({ installedVersion: "1.0.0", pathRegistryVersion: "v5", installedAt: "2026-07-21T00:00:00.000Z" }));
      fs.writeFileSync(path.join(dirB, ".claude", "framework-installed.json"), JSON.stringify({ installedVersion: "1.0.0", pathRegistryVersion: "v4", installedAt: "2026-07-21T00:09:00.000Z" }));
      const ctx = { sandboxRoots: [dirA, dirB], nonces: [] };
      return compareTreeContents(dirA, dirB, [".claude/framework-installed.json"], ctx).equal === false;
    } finally {
      fs.rmSync(dirA, { recursive: true, force: true });
      fs.rmSync(dirB, { recursive: true, force: true });
    }
  });
  t("framework-installed structured: per-install fields (source/installedCommit/assets) differ but framework-owned fields match → EQUAL (filtered, NOT an escape of a framework field)", () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-fi-perinstall-a-"));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-fi-perinstall-b-"));
    try {
      fs.mkdirSync(path.join(dirA, ".claude"), { recursive: true });
      fs.mkdirSync(path.join(dirB, ".claude"), { recursive: true });
      const owned = { $schema: "mc/framework-installed/v2", installedVersion: "1.0.0", pathRegistryVersion: "v5", manifestSchema: "mc/framework-manifest/v2", generated: [".claude/paths.json"] };
      fs.writeFileSync(path.join(dirA, ".claude", "framework-installed.json"), JSON.stringify({ ...owned, source: "/repoA", installedCommit: "aaa", assets: [{ id: "x", installedHash: "h1" }] }));
      fs.writeFileSync(path.join(dirB, ".claude", "framework-installed.json"), JSON.stringify({ ...owned, source: "/repoB", installedCommit: "bbb", assets: [{ id: "x", installedHash: "h2" }] }));
      const ctx = { sandboxRoots: [dirA, dirB], nonces: [] };
      return compareTreeContents(dirA, dirB, [".claude/framework-installed.json"], ctx).equal === true;
    } finally {
      fs.rmSync(dirA, { recursive: true, force: true });
      fs.rmSync(dirB, { recursive: true, force: true });
    }
  });
  t("_mc/MANIFEST inventory structured: an UNDISPOSITIONED framework inventory entry (scripts/foo.js) with a divergent sha REDs", () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-wm-red-a-"));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-wm-red-b-"));
    try {
      fs.mkdirSync(path.join(dirA, "_mc"), { recursive: true });
      fs.mkdirSync(path.join(dirB, "_mc"), { recursive: true });
      const base = { $schema: "mc/manifest/v1", mcVersion: "1.0.0" };
      fs.writeFileSync(path.join(dirA, "_mc", "MANIFEST.json"), JSON.stringify({ ...base, generatedAt: "2026-07-21T00:00:00.000Z", paths: { "scripts/foo.js": { owner: "framework", sha256: "AAA" } } }));
      fs.writeFileSync(path.join(dirB, "_mc", "MANIFEST.json"), JSON.stringify({ ...base, generatedAt: "2026-07-21T00:09:00.000Z", paths: { "scripts/foo.js": { owner: "framework", sha256: "BBB" } } }));
      const ctx = { sandboxRoots: [dirA, dirB], nonces: [] };
      return compareTreeContents(dirA, dirB, ["_mc/MANIFEST.json"], ctx).equal === false;
    } finally {
      fs.rmSync(dirA, { recursive: true, force: true });
      fs.rmSync(dirB, { recursive: true, force: true });
    }
  });
  t("_mc/MANIFEST inventory structured: DISPOSITIONED entries (a frozen-accept key + a runtime events key) diverge but are FILTERED → EQUAL (generatedAt dropped)", () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-wm-green-a-"));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-wm-green-b-"));
    try {
      fs.mkdirSync(path.join(dirA, "_mc"), { recursive: true });
      fs.mkdirSync(path.join(dirB, "_mc"), { recursive: true });
      const base = { $schema: "mc/manifest/v1", mcVersion: "1.0.0" };
      const pa = { ".claude/.last-checkpoint": { owner: "runtime", sha256: "AAA" }, ".claude/project/events/events.jsonl": { owner: "runtime", sha256: "AAA" } };
      const pb = { ".claude/.last-checkpoint": { owner: "runtime", sha256: "ZZZ" }, ".claude/project/events/events.jsonl": { owner: "runtime", sha256: "ZZZ" } };
      fs.writeFileSync(path.join(dirA, "_mc", "MANIFEST.json"), JSON.stringify({ ...base, generatedAt: "2026-07-21T00:00:00.000Z", paths: pa }));
      fs.writeFileSync(path.join(dirB, "_mc", "MANIFEST.json"), JSON.stringify({ ...base, generatedAt: "2026-07-21T00:09:00.000Z", paths: pb }));
      const ctx = { sandboxRoots: [dirA, dirB], nonces: [] };
      return compareTreeContents(dirA, dirB, ["_mc/MANIFEST.json"], ctx).equal === true;
    } finally {
      fs.rmSync(dirA, { recursive: true, force: true });
      fs.rmSync(dirB, { recursive: true, force: true });
    }
  });
  t("_mc/MANIFEST inventory structured: a top-level framework field (mcVersion) divergence REDs (not filtered)", () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-wm-top-a-"));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-wm-top-b-"));
    try {
      fs.mkdirSync(path.join(dirA, "_mc"), { recursive: true });
      fs.mkdirSync(path.join(dirB, "_mc"), { recursive: true });
      fs.writeFileSync(path.join(dirA, "_mc", "MANIFEST.json"), JSON.stringify({ $schema: "mc/manifest/v1", mcVersion: "1.0.0", generatedAt: "2026-07-21T00:00:00.000Z", paths: {} }));
      fs.writeFileSync(path.join(dirB, "_mc", "MANIFEST.json"), JSON.stringify({ $schema: "mc/manifest/v1", mcVersion: "0.17.0", generatedAt: "2026-07-21T00:09:00.000Z", paths: {} }));
      const ctx = { sandboxRoots: [dirA, dirB], nonces: [] };
      return compareTreeContents(dirA, dirB, ["_mc/MANIFEST.json"], ctx).equal === false;
    } finally {
      fs.rmSync(dirA, { recursive: true, force: true });
      fs.rmSync(dirB, { recursive: true, force: true });
    }
  });

  t("isolation tooth: noDeltaCheck REDs on a simulated delta (mirrors the fresh-scaffold gate's proven vector)", () => {
    const before = "a\nb\nc";
    const after = "a\nb\nc\nSIMULATED-DELTA-LINE";
    return noDeltaCheck(before, after).equal === false;
  });
  t("isolation tooth positive control: identical snapshots are equal", () => {
    const snap = "a\nb\nc";
    return noDeltaCheck(snap, snap).equal === true;
  });

  t("a simulated content change to an already-dirty file (SAME porcelain status line before/after) is CAUGHT by the content-hash control", () => {
    const before = { "scripts/foo.js": "sha256-AAA" };
    const after = { "scripts/foo.js": "sha256-BBB" };
    return dirtySetUnchanged(before, after).equal === false;
  });
  t("positive control: identical hashes across the dirty set are equal", () => {
    const same = { "scripts/foo.js": "sha256-AAA", "framework/releases/0.17.0/release.json": "sha256-CCC" };
    return dirtySetUnchanged(same, same).equal === true;
  });
  t("(integration): hashDirtyFileSet re-hash of a MUTATED file differs, even though the mutation would leave its git porcelain status line identical", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-dirtyset-"));
    try {
      const rel = "already-dirty.txt";
      fs.writeFileSync(path.join(dir, rel), "original content (already dirty before the run)");
      const before = hashDirtyFileSet(dir, [rel]);
      fs.writeFileSync(path.join(dir, rel), "MUTATED content — porcelain status line for this path is unchanged (still just 'M'), only bytes changed");
      const after = hashDirtyFileSet(dir, [rel]);
      return dirtySetUnchanged(before, after).equal === false;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  t("(integration) positive control: an UNCHANGED already-dirty file re-hashes identically", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-dirtyset-unchanged-"));
    try {
      const rel = "already-dirty.txt";
      fs.writeFileSync(path.join(dir, rel), "content that never changes during the run");
      const before = hashDirtyFileSet(dir, [rel]);
      const after = hashDirtyFileSet(dir, [rel]);
      return dirtySetUnchanged(before, after).equal === true;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  const pass = results.filter((r) => r.status === "pass").length;
  const fail = results.length - pass;
  return { ok: fail === 0, pass, fail, results };
}

function parseArgs(argv) {
  const out = { help: false, json: false, selfTest: false, timeoutMs: DEFAULT_TIMEOUT_MS };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--json") out.json = true;
    else if (a === "--selftest" || a === "--self-test") out.selfTest = true;
    else if (a === "--timeout-ms") out.timeoutMs = parseInt(argv[++i], 10) || DEFAULT_TIMEOUT_MS;
    else {
      process.stderr.write(`unknown argument: ${a}\n`);
      process.exit(2);
    }
  }
  return out;
}

function printHelp() {
  process.stdout.write(
    `Usage: node scripts/mc/test-upgrade-current-to-new.js [--json] [--timeout-ms <n>] [--selftest] [--help]\n\n` +
      `Runs the upgrade_current_to_new engine: materializes a real N-1\n` +
      `install (git-tag worktree + its own install.ps1), runs the real\n` +
      `update.js --apply against it, and proves canonical was never touched.\n\n` +
      `--selftest   run the SYNTHETIC negative-tooth reachability suite (fast,\n` +
      `             no real installs) instead of the real 2-install engine.\n`,
  );
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    printHelp();
    return 0;
  }

  if (opts.selfTest) {
    const st = selfTest();
    for (const r of st.results) {
      process.stdout.write(`[${r.status === "pass" ? "ok  " : "FAIL"}] ${r.name}${r.detail ? ` — ${r.detail}` : ""}\n`);
    }
    process.stdout.write(`selftest: pass=${st.pass} fail=${st.fail} overall=${st.ok ? "PASS" : "FAIL"}\n`);
    return st.ok ? 0 : 1;
  }

  let result;
  if (opts.json) {
    const realWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (...args) => process.stderr.write(...args);
    try {
      result = await runEngine({ timeoutMs: opts.timeoutMs });
    } finally {
      process.stdout.write = realWrite;
    }
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    result = await runEngine({ timeoutMs: opts.timeoutMs });
    process.stdout.write(`from_version=${result.from_version} to_version=${result.to_version} ran=${result.ran} ps_available=${result.ps_available}\n`);
    for (const a of result.asserts) {
      process.stdout.write(`[${a.ok ? "ok  " : "FAIL"}] ${a.name}${a.detail ? ` — ${a.detail}` : ""}\n`);
    }
    process.stdout.write(
      `sandbox-isolation no-delta: ${result.sandbox_isolation.no_delta ? "HELD" : "VIOLATED"}\n` +
        `overall=${result.incomplete ? "INCOMPLETE (skip-loud): " + result.incomplete_reason : result.ok ? "PASS" : "FAIL"}\n`,
    );
  }
  return result.incomplete ? 0 : result.ok ? 0 : 1;
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      process.stderr.write(`FATAL: ${(e && e.stack) || e}\n`);
      process.exit(2);
    });
}

module.exports = {
  REPO_ROOT,
  resolveVersions,
  runEngine,
  selfTest,
  check3aVersionSanity,
  check3bScanInstall,
  compareTreeContents,
  normalizeContent3c,
  NORMALIZE_3C,
  tagExists,
  readCurrentVersion,
  checkUnreleasedCutIdentity,
  fullTreeFileList,
  compareTypedEntries,
  NORMALIZE_ALLOWED_RELPATHS,
  listDirtyFiles,
  hashDirtyFileSet,
  dirtySetUnchanged,
};
