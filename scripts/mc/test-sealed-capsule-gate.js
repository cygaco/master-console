#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const cHash = require("./lib/content-hash");
const { resolveRepoRole, ROLES } = require("./repo-role");
const gauntletVerify = require("../dispatch/gauntlet-verify");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RELEASES_DIR = path.join(REPO_ROOT, "framework", "releases");

function assetHash(absPath, destPath) {
  return cHash.isTextAsset(destPath)
    ? cHash.contentHash(absPath, { text: true })
    : cHash.rawHash(absPath);
}

function isWithin(root, abs) {
  const r = path.resolve(root);
  const a = path.resolve(abs);
  return a === r || a.startsWith(r + path.sep);
}

function listCapsuleVersions() {
  let names;
  try {
    names = fs.readdirSync(RELEASES_DIR);
  } catch {
    return [];
  }
  return names
    .filter((n) => /^\d+\.\d+\.\d+$/.test(n))
    .filter((n) => {
      try {
        return fs.statSync(path.join(RELEASES_DIR, n)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort(cmpSemver);
}

function cmpSemver(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

function latestCapsuleVersion() {
  const v = listCapsuleVersions();
  return v.length ? v[v.length - 1] : null;
}

function manifestIsCurrent(runner) {
  const run =
    runner ||
    (() =>
      spawnSync(
        process.execPath,
        [path.join(REPO_ROOT, "scripts", "generate-framework-manifest.js"), "--check"],
        { cwd: REPO_ROOT, encoding: "utf8", timeout: 120000 },
      ));
  const r = run();
  return { ok: r.status === 0, status: r.status, detail: tail(r.stderr || r.stdout) };
}

function seal(o) {
  const { manifest, srcRoot, payloadDir } = o;
  const verify = o.verify !== false;
  if (!manifest || typeof manifest !== "object" || !manifest.assets || typeof manifest.assets !== "object") {
    throw new Error("seal: manifest missing or has no #assets object (fail-closed)");
  }
  const missing = [];
  const mismatched = [];
  let assetCount = 0;
  let copied = 0;

  for (const category of Object.keys(manifest.assets)) {
    const entries = manifest.assets[category];
    if (!Array.isArray(entries)) continue;
    for (const a of entries) {
      if (a.removedIn) continue;
      assetCount++;
      const src = a.src || a.dest;
      const dest = a.dest || a.src;
      if (!src || !dest) {
        missing.push({ asset: a.id || "(unnamed)", reason: "no src/dest" });
        continue;
      }
      const absSrc = path.resolve(srcRoot, src);
      const absDest = path.resolve(payloadDir, dest);
      if (!isWithin(srcRoot, absSrc) || !isWithin(payloadDir, absDest)) {
        mismatched.push({ asset: a.id || src, src, reason: "path escapes sealing boundary (../ traversal)" });
        continue;
      }
      if (!fs.existsSync(absSrc)) {
        missing.push({ asset: a.id || src, src, reason: "src not found in source tree" });
        continue;
      }
      if (verify && a.sha256) {
        const got = assetHash(absSrc, dest);
        if (!cHash.hashMatches(got, a.sha256)) {
          mismatched.push({ asset: a.id || src, src, expected: a.sha256, got });
          continue;
        }
      }
      fs.mkdirSync(path.dirname(absDest), { recursive: true });
      fs.copyFileSync(absSrc, absDest);
      copied++;
    }
  }

  let generatedCopied = 0;
  const generated = Array.isArray(manifest.generated_files) ? manifest.generated_files : [];
  for (const g of generated) {
    const dest = g.dest;
    if (!dest) continue;
    const absSrc = path.resolve(srcRoot, dest);
    const absDest = path.resolve(payloadDir, dest);
    if (!isWithin(srcRoot, absSrc) || !isWithin(payloadDir, absDest)) {
      mismatched.push({ asset: dest, reason: "generated_file path escapes sealing boundary (../ traversal)" });
      continue;
    }
    if (fs.existsSync(absSrc)) {
      fs.mkdirSync(path.dirname(absDest), { recursive: true });
      fs.copyFileSync(absSrc, absDest);
      generatedCopied++;
    } else if (g.builder === "empty-file") {
      fs.mkdirSync(path.dirname(absDest), { recursive: true });
      fs.writeFileSync(absDest, "");
      generatedCopied++;
    }
  }

  {
    const fmRel = path.join(".claude", "framework-manifest.json");
    const absSrc = path.join(srcRoot, fmRel);
    if (fs.existsSync(absSrc)) {
      const absDest = path.join(payloadDir, fmRel);
      fs.mkdirSync(path.dirname(absDest), { recursive: true });
      fs.copyFileSync(absSrc, absDest);
      generatedCopied++;
    }
  }

  return {
    ok: missing.length === 0 && mismatched.length === 0,
    assetCount,
    copied,
    generatedCopied,
    missing,
    mismatched,
  };
}

function isolate(o) {
  const { payloadDir } = o;
  const tmpBase = o.tmpBase || os.tmpdir();
  const repoDir = fs.mkdtempSync(path.join(tmpBase, "mc-sealed-"));
  const rel = path.relative(REPO_ROOT, repoDir);
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
    try { fs.rmSync(repoDir, { recursive: true, force: true }); } catch { }
    throw new Error(`isolate: temp repo ${repoDir} is inside canonical ${REPO_ROOT} — isolation impossible (fail-closed)`);
  }
  if (o.gitInit !== false) {
    const gi = spawnSync("git", ["init", "-q"], { cwd: repoDir, encoding: "utf8" });
    if (gi.status !== 0 || !fs.existsSync(path.join(repoDir, ".git"))) {
      try { fs.rmSync(repoDir, { recursive: true, force: true }); } catch { }
      throw new Error(`isolate: git init failed (status=${gi.status}) or .git absent — fail-closed`);
    }
  }
  copyTree(payloadDir, repoDir);
  return { repoDir };
}

function copyTree(srcDir, dstDir) {
  for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, ent.name);
    const d = path.join(dstDir, ent.name);
    if (ent.isDirectory()) {
      fs.mkdirSync(d, { recursive: true });
      copyTree(s, d);
    } else if (ent.isFile()) {
      fs.mkdirSync(path.dirname(d), { recursive: true });
      fs.copyFileSync(s, d);
    }
  }
}

function assertCanonicalUnreachable(o) {
  const { repoDir } = o;
  const canonicalRoot = o.canonicalRoot || REPO_ROOT;
  const needles = [canonicalRoot, canonicalRoot.replace(/\\/g, "/")];
  const offenders = [];
  const SCAN_EXT = new Set([".md", ".js", ".cjs", ".mjs", ".json", ".yaml", ".yml", ".ts", ".toml", ".txt", ".sh", ".ps1", ".bat", ".cmd", ".env"]);
  const scannable = (p) => SCAN_EXT.has(path.extname(p).toLowerCase()) || path.basename(p).startsWith(".");
  const walk = (dir) => {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of ents) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === ".git") continue;
        walk(p);
      } else if (ent.isFile() && scannable(p)) {
        let txt;
        try { txt = fs.readFileSync(p, "utf8"); } catch {
          offenders.push({ file: path.relative(repoDir, p), needle: "(unreadable — cannot clear)" });
          continue;
        }
        for (const n of needles) {
          if (n && txt.includes(n)) {
            offenders.push({ file: path.relative(repoDir, p), needle: n });
            break;
          }
        }
      }
    }
  };
  walk(repoDir);
  return { ok: offenders.length === 0, offenders };
}

function scrubbedEnv(role, repoDir) {
  const env = { ...process.env };
  const needlesLc = [REPO_ROOT, REPO_ROOT.replace(/\\/g, "/")].map((s) => s.toLowerCase());
  const includesCanonical = (v) => typeof v === "string" && needlesLc.some((n) => n && v.toLowerCase().includes(n));
  const PRESERVE = /^(PATH|PATHEXT|HOME|USERPROFILE|SYSTEMROOT|WINDIR|TEMP|TMP|COMSPEC|.*_API_KEY|.*_TOKEN|GEMINI_.*|OPENAI_.*|ANTHROPIC_.*)$/i;
  const DROP = /^(NODE_PATH|INIT_CWD|OLDPWD|CLAUDE_PROJECT_DIR|npm_config_.*)$/i;
  for (const k of Object.keys(env)) {
    if (/^MC_/i.test(k)) { delete env[k]; continue; }
    if (PRESERVE.test(k)) {
      if (/^(PATH|PATHEXT)$/i.test(k) && typeof env[k] === "string" && env[k].includes(path.delimiter)) {
        env[k] = env[k].split(path.delimiter).filter((seg) => !includesCanonical(seg)).join(path.delimiter);
      }
      continue;
    }
    if (DROP.test(k)) { delete env[k]; continue; }
    if (includesCanonical(env[k])) { delete env[k]; continue; }
  }
  if (repoDir) { env.PWD = repoDir; }
  if (role) env.MC_REPO_ROLE = role;
  return env;
}

function lifecycle(o) {
  const { repoDir, role } = o;
  const mode = o.mode || "cold";
  const stepNames =
    mode === "warm"
      ? ["update", "scan:install", "sprint", "telemetry"]
      : ["setup", "scan:install", "sprint", "telemetry", "update"];
  const runStep = o.runStep || defaultRunStep;
  const since = o.now ? o.now() : Date.now();
  const steps = [];
  let failedStep = null;
  for (const name of stepNames) {
    let exit;
    try {
      exit = runStep(name, { repoDir, role, mode });
    } catch (e) {
      exit = { status: 2, detail: e && e.message };
    }
    const code = typeof exit === "number" ? exit : exit && exit.status;
    steps.push({ name, exit: code, detail: exit && exit.detail });
    if (code !== 0) {
      failedStep = name;
      break;
    }
  }
  const until = o.now ? o.now() : Date.now();
  return {
    ok: failedStep === null,
    role,
    mode,
    steps,
    failedStep,
    window: { since, until },
  };
}

const TELEMETRY_PROBE_ROLE = "qa";

function defaultRunStep(name, ctx) {
  const { repoDir, role } = ctx;
  const env = scrubbedEnv(role, repoDir);
  const node = (relArgs, timeout = 120000) =>
    spawnSync(process.execPath, relArgs, { cwd: repoDir, env, encoding: "utf8", timeout });
  const requireEngine = (rel) => {
    const p = path.join(repoDir, rel);
    return fs.existsSync(p) ? p : null;
  };
  switch (name) {
    case "setup": {
      const ij = requireEngine(path.join("scripts", "check", "install.js"));
      return { status: ij ? 0 : 1, detail: ij ? "" : "install verifier missing from sealed payload (incomplete BOM)" };
    }
    case "scan:install": {
      const ij = requireEngine(path.join("scripts", "check", "install.js"));
      if (!ij) return { status: 1, detail: "install verifier missing (incomplete BOM)" };
      const r = node([ij]);
      return { status: r.status === null ? 2 : r.status, detail: tail(r.stdout || r.stderr) };
    }
    case "sprint": {
      const sp = requireEngine(path.join("scripts", "sprint", "status.js"));
      if (!sp) return { status: 1, detail: "sprint engine missing from sealed payload (incomplete BOM)" };
      const r = node([sp]);
      return { status: r.status === null ? 2 : r.status, detail: tail(r.stdout || r.stderr) };
    }
    case "telemetry": {
      const dp = requireEngine("scripts/dispatch-agent.js");
      if (!dp) return { status: 1, detail: "dispatch wrapper missing from sealed payload (incomplete BOM)" };
      const promptFile = path.join(repoDir, ".telemetry-probe.txt");
      try { fs.writeFileSync(promptFile, "Reply with exactly: OK"); } catch { }
      const r = node([dp, TELEMETRY_PROBE_ROLE, promptFile], 180000);
      return { status: r.status === null ? 2 : r.status, detail: `exit=${r.status} ${tail(r.stdout || r.stderr)}`, telemetryRole: TELEMETRY_PROBE_ROLE };
    }
    case "update": {
      const up = requireEngine(path.join("scripts", "mc", "update.js"));
      if (!up) return { status: 1, detail: "update engine missing from sealed payload (incomplete BOM)" };
      const r = node([up, "--status"]);
      return { status: r.status === null ? 2 : r.status, detail: tail(r.stdout || r.stderr) };
    }
    default:
      return { status: 2, detail: `unknown step ${name}` };
  }
}

function verifyTyped(o) {
  return gauntletVerify.verifyGauntlet({
    runId: o.runId || "sealed-capsule-gate",
    roles: o.roles || [],
    since: o.window && o.window.since,
    until: o.window && o.window.until,
    completionsFile: o.ledgerPath,
    records: o.records,
    requireSignature: o.requireSignature === true,
  });
}

function matrix(o) {
  const roles = o.roles || ["canonical", "consumer"];
  const modes = o.modes || ["cold", "warm"];
  const runCell = o.runCell || defaultRunCell(o);
  const cells = [];
  const failed = [];
  for (const role of roles) {
    for (const mode of modes) {
      let res;
      try {
        res = runCell(role, mode);
      } catch (e) {
        res = { ok: false, role, mode, error: e && e.message };
      }
      cells.push(res);
      if (!res || !res.ok) failed.push(`${role}/${mode}`);
    }
  }
  return { ok: failed.length === 0, cells, failed };
}

function defaultRunCell(outer) {
  return (role, mode) => {
    const resolved = resolveRepoRole({ override: role });
    const iso = isolate({ payloadDir: outer.payloadDir });
    try {
      const lc = lifecycle({ repoDir: iso.repoDir, role: resolved.role, mode });
      if (!lc.ok) return { ok: false, role, mode, failedStep: lc.failedStep, steps: lc.steps };

      const rr = spawnSync(
        process.execPath,
        [path.join(iso.repoDir, "scripts", "mc", "repo-role.js"), "--json"],
        { cwd: iso.repoDir, env: scrubbedEnv(role, iso.repoDir), encoding: "utf8", timeout: 30000 },
      );
      let childRole = null;
      try { childRole = JSON.parse(rr.stdout || "{}").role; } catch { }
      if (childRole !== role) {
        return { ok: false, role, mode, failedStep: "role-assert", detail: `child resolver reported '${childRole}', expected '${role}'`, steps: lc.steps };
      }

      const ledger = path.join(iso.repoDir, ".claude", "runtime", "dispatch-completions.jsonl");
      const vt = verifyTyped({ window: lc.window, roles: [TELEMETRY_PROBE_ROLE], ledgerPath: ledger });
      if (!vt.ok) {
        return { ok: false, role, mode, failedStep: "verifyTyped", detail: `typed-success failed: missing=${(vt.missingRoles || []).join(",")} malformedTainted=${vt.malformedTainted}`, steps: lc.steps };
      }

      return { ok: true, role, mode, failedStep: null, steps: lc.steps, typed: true };
    } finally {
      try { fs.rmSync(iso.repoDir, { recursive: true, force: true }); } catch { }
    }
  };
}

function tail(s, n = 200) {
  return (s || "").split(/\r?\n/).filter(Boolean).slice(-2).join(" | ").slice(-n);
}

function loadCapsuleManifest(version) {
  const p = path.join(RELEASES_DIR, version, "framework-manifest.json");
  return JSON.parse(fs.readFileSync(p, "utf8").replace(/^﻿/, ""));
}

function verifyCapsuleIntegrity(version) {
  const dir = path.join(RELEASES_DIR, version);
  const csPath = path.join(dir, "checksums.json");
  if (!fs.existsSync(csPath)) return { ok: false, detail: `checksums.json missing for capsule ${version}` };
  let cs;
  try { cs = JSON.parse(fs.readFileSync(csPath, "utf8").replace(/^﻿/, "")); }
  catch (e) { return { ok: false, detail: `checksums.json unparseable: ${e.message}` }; }
  const entries = (cs && cs.entries) || {};
  if (!Object.keys(entries).length) return { ok: false, detail: "checksums.json has no entries" };
  const bad = [];
  for (const [file, expected] of Object.entries(entries)) {
    const fp = path.join(dir, file);
    if (!fs.existsSync(fp)) { bad.push(`${file}: missing`); continue; }
    const got = cHash.rawHash(fp);
    if (!cHash.hashMatches(got, expected)) bad.push(`${file}: hash mismatch`);
  }
  return { ok: bad.length === 0, detail: bad.join("; ") };
}

function runSelfTests() {
  const results = [];
  const t = (name, fn) => {
    try {
      fn();
      results.push({ name, ok: true });
    } catch (e) {
      results.push({ name, ok: false, detail: e && e.message });
    }
  };

  const mkFixtureCapsule = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-fixcap-"));
    const srcRoot = path.join(dir, "src");
    fs.mkdirSync(path.join(srcRoot, "a"), { recursive: true });
    fs.writeFileSync(path.join(srcRoot, "a", "x.md"), "hello\n");
    fs.writeFileSync(path.join(srcRoot, "a", "y.json"), '{"k":1}\n');
    const assets = {
      docs: [
        { id: "x", src: "a/x.md", dest: "a/x.md", sha256: assetHash(path.join(srcRoot, "a", "x.md"), "a/x.md"), owner: "framework" },
      ],
      cfg: [
        { id: "y", src: "a/y.json", dest: "a/y.json", sha256: assetHash(path.join(srcRoot, "a", "y.json"), "a/y.json"), owner: "framework" },
      ],
    };
    return { dir, srcRoot, manifest: { assets, generated_files: [] } };
  };
  const cleanup = (d) => { try { fs.rmSync(d, { recursive: true, force: true }); } catch { } };
  const assert = (c, m) => { if (!c) throw new Error(m || "assertion failed"); };

  t("seal-materializes-all-manifest-entries", () => {
    const fx = mkFixtureCapsule();
    const payloadDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-payload-"));
    try {
      const r = seal({ manifest: fx.manifest, srcRoot: fx.srcRoot, payloadDir });
      assert(r.ok, "seal not ok: " + JSON.stringify(r));
      assert(r.copied === 2, "expected 2 copied, got " + r.copied);
      assert(fs.existsSync(path.join(payloadDir, "a", "x.md")), "x.md not materialized");
      assert(fs.existsSync(path.join(payloadDir, "a", "y.json")), "y.json not materialized");
    } finally { cleanup(fx.dir); cleanup(payloadDir); }
  });

  t("seal-verifies-against-checksums", () => {
    const fx = mkFixtureCapsule();
    const payloadDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-payload-"));
    try {
      fx.manifest.assets.docs[0].sha256 = "0".repeat(64);
      const r = seal({ manifest: fx.manifest, srcRoot: fx.srcRoot, payloadDir });
      assert(!r.ok, "seal should fail on hash mismatch");
      assert(r.mismatched.length === 1, "expected 1 mismatch, got " + r.mismatched.length);
    } finally { cleanup(fx.dir); cleanup(payloadDir); }
  });

  t("seal-fail-closed-on-stale-or-missing-manifest", () => {
    let threw = false;
    try { seal({ manifest: {}, srcRoot: os.tmpdir(), payloadDir: os.tmpdir() }); } catch { threw = true; }
    assert(threw, "seal should throw on manifest without #assets");
    const fx = mkFixtureCapsule();
    const payloadDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-payload-"));
    try {
      fx.manifest.assets.docs.push({ id: "ghost", src: "a/nope.md", dest: "a/nope.md", sha256: "x", owner: "framework" });
      const r = seal({ manifest: fx.manifest, srcRoot: fx.srcRoot, payloadDir });
      assert(!r.ok && r.missing.length === 1, "seal should record the missing src (got " + JSON.stringify(r.missing) + ")");
      const stale = manifestIsCurrent(() => ({ status: 1, stdout: "drift" }));
      assert(!stale.ok, "manifestIsCurrent should be !ok on non-zero checker");
    } finally { cleanup(fx.dir); cleanup(payloadDir); }
  });

  t("seal-fail-closed-on-generated-file-traversal", () => {
    const fx = mkFixtureCapsule();
    const payloadDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-payload-"));
    try {
      fx.manifest.generated_files = [{ dest: path.join("..", "..", "escape.json"), builder: "empty-file" }];
      const r = seal({ manifest: fx.manifest, srcRoot: fx.srcRoot, payloadDir });
      assert(!r.ok, "seal must fail on generated_file path traversal");
      assert((r.mismatched || []).some((m) => /traversal/.test(m.reason || "")), "traversal must be recorded: " + JSON.stringify(r.mismatched));
    } finally { cleanup(fx.dir); cleanup(payloadDir); }
  });

  t("isolate-creates-out-of-tree-repo", () => {
    const fx = mkFixtureCapsule();
    const payloadDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-payload-"));
    let repoDir;
    try {
      seal({ manifest: fx.manifest, srcRoot: fx.srcRoot, payloadDir });
      const r = isolate({ payloadDir, gitInit: false });
      repoDir = r.repoDir;
      const rel = path.relative(REPO_ROOT, repoDir);
      assert(rel.startsWith("..") || path.isAbsolute(rel), "repo must be outside canonical");
      assert(fs.existsSync(path.join(repoDir, "a", "x.md")), "payload not installed into repo");
    } finally { cleanup(fx.dir); cleanup(payloadDir); if (repoDir) cleanup(repoDir); }
  });

  t("isolate-asserts-canonical-unreachable", () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-clean-"));
    try {
      fs.writeFileSync(path.join(repoDir, "ok.md"), "no canonical paths here\n");
      const r = assertCanonicalUnreachable({ repoDir });
      assert(r.ok, "clean repo should pass: " + JSON.stringify(r.offenders));
    } finally { cleanup(repoDir); }
  });

  t("isolate-catches-planted-reachback", () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-reachback-"));
    try {
      fs.writeFileSync(path.join(repoDir, "evil.js"), `const x = require("${REPO_ROOT.replace(/\\/g, "/")}/scripts/x");\n`);
      const r = assertCanonicalUnreachable({ repoDir });
      assert(!r.ok, "planted reach-back must be caught");
      assert(r.offenders.length >= 1, "offender must be reported");
    } finally { cleanup(repoDir); }
  });

  t("lifecycle-runs-full-contract-in-order", () => {
    const seen = [];
    const r = lifecycle({
      repoDir: "/fake",
      role: "consumer",
      mode: "cold",
      runStep: (name) => { seen.push(name); return { status: 0 }; },
    });
    assert(r.ok, "lifecycle should be ok when all steps pass");
    assert(seen.join(",") === "setup,scan:install,sprint,telemetry,update", "wrong order: " + seen.join(","));
  });

  t("lifecycle-fail-closed-on-step-failure", () => {
    const seen = [];
    const r = lifecycle({
      repoDir: "/fake",
      role: "consumer",
      mode: "cold",
      runStep: (name) => { seen.push(name); return { status: name === "sprint" ? 1 : 0 }; },
    });
    assert(!r.ok, "lifecycle should fail when a step fails");
    assert(r.failedStep === "sprint", "should name failed step sprint, got " + r.failedStep);
    assert(!seen.includes("telemetry"), "must stop after failed step (no telemetry)");
  });

  t("verifytyped-requires-action-and-record", () => {
    const now = Date.now();
    const records = [
      { role: "reviewer", ok: true, provider: "openai", completed_at: new Date(now).toISOString() },
    ];
    const r = verifyTyped({ window: { since: now - 1000, until: now + 1000 }, roles: ["reviewer"], records, requireSignature: false });
    assert(r.ok, "well-formed record should satisfy: " + JSON.stringify(r.missingRoles));
    const r2 = verifyTyped({ window: { since: now - 1000, until: now + 1000 }, roles: ["reviewer", "qa"], records, requireSignature: false });
    assert(!r2.ok, "missing qa record should fail");
  });

  t("verifytyped-fail-closed-on-malformed-norecord-runnererror", () => {
    const now = Date.now();
    const illTyped = [{ role: "reviewer", ok: true, completed_at: new Date(now).toISOString() }];
    const r = verifyTyped({ window: { since: now - 1000, until: now + 1000 }, roles: ["reviewer"], records: illTyped });
    assert(!r.ok, "ill-typed record must fail-closed");
    const r2 = verifyTyped({ window: { since: now - 1000, until: now + 1000 }, roles: ["reviewer"], records: [] });
    assert(!r2.ok, "no-record must fail-closed");
  });

  t("verifytyped-resolves-canonical-anchored-ledger", () => {
    const def = gauntletVerify.defaultCompletionsFile();
    assert(def && def.includes(".claude"), "default ledger should be canonical .claude runtime, got " + def);
    const r = verifyTyped({ window: { since: Date.now() - 1000, until: Date.now() + 1000 }, roles: ["reviewer"] });
    assert(typeof r.ok === "boolean", "verify should resolve against canonical ledger without error");
  });

  t("matrix-runs-both-roles-cold-and-warm", () => {
    const seen = [];
    const r = matrix({ runCell: (role, mode) => { seen.push(`${role}/${mode}`); return { ok: true, role, mode }; } });
    assert(r.ok, "matrix should be ok when all cells pass");
    assert(seen.sort().join(",") === "canonical/cold,canonical/warm,consumer/cold,consumer/warm", "cells: " + seen.join(","));
  });

  t("matrix-aggregates-fail-closed", () => {
    const r = matrix({ runCell: (role, mode) => ({ ok: !(role === "consumer" && mode === "warm"), role, mode }) });
    assert(!r.ok, "matrix should fail when a cell fails");
    assert(r.failed.includes("consumer/warm"), "failed cell must be named: " + r.failed.join(","));
  });

  t("rungate-fails-closed-on-bad-capsule", () => {
    const res = runGate({ version: "0.0.0-does-not-exist" });
    assert(res.failures > 0, "runGate must report failure for a non-existent/integrity-failing capsule");
  });

  t("manifests-current-after-build", () => {
    const r = manifestIsCurrent();
    assert(r.ok, "shipped manifest must be current (run regen): " + r.detail);
  });

  t("registered-in-testsuite", () => {
    const registry = path.join(REPO_ROOT, "_requirements", "07-testing", "recurring-bug-classes.json");
    const releaseGates = path.join(REPO_ROOT, "scripts", "mc", "release-gates.js");
    const inRegistry = (() => { try { return fs.readFileSync(registry, "utf8").includes("test-sealed-capsule-gate"); } catch { return false; } })();
    const inReleaseGates = (() => { try { return fs.readFileSync(releaseGates, "utf8").includes("test-sealed-capsule-gate"); } catch { return false; } })();
    assert(inRegistry, "gate not registered in recurring-bug-classes.json (testsuite)");
    assert(inReleaseGates, "gate not registered in release-gates.js (promotion)");
  });

  return results;
}

function runGate(opts) {
  const out = [];
  const log = (s) => out.push(s);
  let failures = 0;
  const fail = (m) => { failures++; log("  FAIL  " + m); };
  const okmsg = (m) => log("  ok    " + m);

  const version = opts.version || null;
  const manifestLabel = version ? `release capsule ${version}` : "current canonical manifest";
  log(`sealed-capsule-contract-gate — ${manifestLabel}${opts.full ? " (--full)" : " (bounded)"}`);

  const stale = manifestIsCurrent();
  if (!stale.ok) { fail(`shipped manifest stale: ${stale.detail}`); return { failures, out }; }
  okmsg("shipped manifest current");

  if (version) {
    const ci = verifyCapsuleIntegrity(version);
    if (!ci.ok) { fail(`capsule ${version} integrity check failed: ${ci.detail}`); return { failures, out }; }
    okmsg(`capsule ${version} checksums verified`);
  }

  let manifest;
  try {
    manifest = version
      ? loadCapsuleManifest(version)
      : JSON.parse(fs.readFileSync(path.join(REPO_ROOT, ".claude", "framework-manifest.json"), "utf8").replace(/^﻿/, ""));
  } catch (e) { fail(`cannot read manifest: ${e.message}`); return { failures, out }; }
  const payloadDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-seal-"));
  let repoDir = null;
  try {
    const sres = seal({ manifest, srcRoot: REPO_ROOT, payloadDir });
    if (!sres.ok) {
      fail(`seal incomplete — missing:${sres.missing.length} mismatched:${sres.mismatched.length} (downstream-missing/reach-back class)`);
      if (sres.missing.length) log("        missing e.g. " + JSON.stringify(sres.missing.slice(0, 3)));
      if (sres.mismatched.length) log("        mismatch e.g. " + JSON.stringify(sres.mismatched.slice(0, 3)));
    } else {
      okmsg(`sealed ${sres.copied}/${sres.assetCount} assets, all hashes verified`);
    }

    const iso = isolate({ payloadDir });
    repoDir = iso.repoDir;
    okmsg(`isolated out-of-tree repo ${path.relative(REPO_ROOT, repoDir).startsWith("..") ? "(outside canonical)" : "(?)"} `);
    const reach = assertCanonicalUnreachable({ repoDir });
    if (!reach.ok) {
      fail(`canonical REACHABLE from sealed install — ${reach.offenders.length} file(s) embed the canonical path`);
      log("        e.g. " + JSON.stringify(reach.offenders.slice(0, 3)));
    } else {
      okmsg("canonical unreachable from sealed install (no reach-back)");
    }

    const installJs = path.join(repoDir, "scripts", "check", "install.js");
    if (fs.existsSync(installJs)) {
      const r = spawnSync(process.execPath, [installJs], { cwd: repoDir, env: scrubbedEnv("consumer"), encoding: "utf8", timeout: 120000 });
      if (r.status === 0) okmsg("scan:install certifies the sealed install");
      else fail(`scan:install failed in sealed repo (exit ${r.status}): ${tail(r.stdout || r.stderr)}`);
    } else {
      fail("sealed install missing scripts/check/install.js (incomplete BOM)");
    }

    if (opts.full) {
      const mres = matrix({ payloadDir });
      if (mres.ok) okmsg(`matrix: all ${mres.cells.length} cells (role×mode) passed`);
      else fail(`matrix cells failed: ${mres.failed.join(", ")}`);
    } else {
      log("  ..    (skipping heavy real-matrix lifecycle; run --full for the complete contract)");
    }
  } catch (e) {
    fail(`gate internal error (fail-closed): ${e && e.message}`);
  } finally {
    try { fs.rmSync(payloadDir, { recursive: true, force: true }); } catch { }
    if (repoDir) { try { fs.rmSync(repoDir, { recursive: true, force: true }); } catch { } }
  }
  return { failures, out };
}

if (require.main === module) {
  try {
    const argv = process.argv.slice(2);
    const getFlag = (n) => {
      const i = argv.indexOf(`--${n}`);
      if (i === -1) return undefined;
      const v = argv[i + 1];
      return v === undefined || v.startsWith("--") ? true : v;
    };

    if (argv.includes("--help") || argv.includes("-h")) {
      process.stdout.write(
        [
          "sealed-capsule-contract-gate — executable consumer-contract gate (ADR-0006).",
          "",
          "Usage:",
          "  node scripts/mc/test-sealed-capsule-gate.js [--version <v>] [--full]",
          "  node scripts/mc/test-sealed-capsule-gate.js --self-test",
          "",
          "  (default)    bounded gate: seal + isolate + canonical-unreachable + scan:install",
          "  --full       + real lifecycle matrix (both roles × cold+warm) + typed telemetry",
          "  --self-test  fixture-based named sub-tests (fast; the per-commit testsuite signal)",
          "",
          "Exit: 0 pass · 1 real failure · 2 usage/internal error (fail-closed).",
        ].join("\n") + "\n",
      );
      process.exit(0);
    }

    if (argv.includes("--self-test")) {
      const results = runSelfTests();
      const pass = results.filter((r) => r.ok).length;
      const fail = results.length - pass;
      for (const r of results) {
        process.stdout.write(`  ${r.ok ? "ok  " : "FAIL"}  ${r.name}${r.ok ? "" : " — " + (r.detail || "")}\n`);
      }
      process.stdout.write(`\nsealed-capsule-gate self-test: ${pass} passed / ${fail} failed\n`);
      process.exit(fail === 0 ? 0 : 1);
    }

    const ver = getFlag("version");
    const { failures, out } = runGate({
      version: ver && ver !== true ? ver : undefined,
      full: argv.includes("--full"),
    });
    process.stdout.write(out.join("\n") + "\n");
    process.stdout.write(`\n${failures === 0 ? "PASS" : "FAIL"} — sealed-capsule-contract-gate (${failures} failure${failures === 1 ? "" : "s"})\n`);
    process.exit(failures === 0 ? 0 : 1);
  } catch (err) {
    process.stderr.write(`[sealed-capsule-gate] internal error: ${err && err.message ? err.message : String(err)}\n`);
    process.exit(2);
  }
}

module.exports = {
  seal,
  isolate,
  assertCanonicalUnreachable,
  scrubbedEnv,
  lifecycle,
  verifyTyped,
  matrix,
  manifestIsCurrent,
  latestCapsuleVersion,
  listCapsuleVersions,
  loadCapsuleManifest,
  assetHash,
  runSelfTests,
  runGate,
};
