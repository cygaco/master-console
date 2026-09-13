"use strict";
const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)
/**
 * broker-release-commit.js — #6, REGEN / BOOKKEEPING COMMIT ROUTING
 * (SP-20260721-001, D-4 INC-1, unit MIG).
 *
 * The routine local main-commits — manifest regen (BC-02/BC-05), ledger hygiene, sprint-close bookkeeping,
 * version bumps — are the OTHER main-write shape besides a branch merge, and they are the ones that will
 * hit the Seam E fence most often once it is armed. This is their brokered path:
 *
 *   node scripts/dispatch/broker-release-commit.js -m "chore(...): manifest regen" [options]
 *
 * ── WHAT IT DOES ─────────────────────────────────────────────────────────────────────────────────────
 *   1. Name the explicit pathspecs to commit (`--add <pathspec>`, repeatable; REQUIRED on the build path).
 *      NEVER `git add -A`: a bookkeeping helper that sweeps the whole worktree is how unrelated in-flight
 *      work (and other agents' temp files) ends up inside a "routine regen" commit. The ambient real index
 *      is NOT read — only the named pathspecs are staged (see step 2).
 *   2. Build a SINGLE-PARENT commit in an ISOLATED index SEEDED FROM the target head (GF-2): read-tree the
 *      target head, `git add` ONLY the named pathspecs (each path's working-tree content on top of head),
 *      then `write-tree` + `commit-tree` (parent = the live tip of the target ref). The tree is therefore
 *      head + only the named paths — a run from the wrong branch cannot smuggle a foreign snapshot onto the
 *      commit. NO REF IS WRITTEN: the object is built, the broker judges it, only the broker's CAS moves the
 *      ref. A refusal leaves the repo untouched.
 *   3. Hold the conductor lease, then call `integrateReleaseCommit({release_commit, target_ref}, opts)`.
 *   4. LANDED → receipt. BLOCKED → classify; security/usage surface and stop, operational MAY fall back
 *      with the full LOGGED + COUNTED + SURFACED treatment (broker-dogfood.js `attemptFallback`).
 *
 * ── WIRING NOTE (how a regen flow adopts this) ───────────────────────────────────────────────────────
 * A regen/bookkeeping flow migrates by replacing its `git commit` with either this CLI or the exported
 * `brokerReleaseCommit()`. The exported form is the one existing scripts should call, because it returns
 * the receipt (suite version + bundle digest + previous/committed head) that the release ledger wants
 * anyway. Pre-flip the fallback keeps such a flow working when no promoted bundle is configured — loudly,
 * and at the cost of an entry in the dogfood ledger, which is exactly the pressure that gets bundles
 * promoted before the flip rather than after it.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ─────────────────────────────────────────────────────────────────
 *   • No push. No tag. No `git add -A`. No working-tree reset after the ref moves (it REPORTS
 *     `worktree_refresh_required` instead — see broker-merge.js for the same reasoning).
 *   • No fallback on a security refusal, ever.
 *
 * EXIT 0 = landed (brokered OR logged fallback) · 1 = refused/failed · 2 = usage error.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const dog = require("./broker-dogfood");

const TARGET_DEFAULT = "refs/heads/main";

/**
 * buildReleaseCommit({gitRoot, head, message, add}) -> {ok, sha, tree} | {ok:false, reason, detail}.
 *
 * A single-parent commit built in an ISOLATED temp index SEEDED FROM `head` (GF-2). The commit tree is
 * therefore `head`'s tree + ONLY the explicitly-added pathspecs' working-tree content — NEVER the ambient
 * branch/index snapshot. Without this seed, `git write-tree` over the caller's current index could produce
 * a foreign tree (e.g. a whole feature-branch snapshot when run off a feature branch) that STILL parents
 * cleanly to live main and could pass the pinned suite — silently replacing main's tree. Seeding from the
 * target head makes "only the named paths can differ from main" a property of construction, not of caller
 * discipline. Writes no ref, and never touches the caller's real index.
 */
function buildReleaseCommit(args = {}) {
  const { gitRoot, head, message, add } = args;
  const tmpIndex = path.join(os.tmpdir(), `mc-release-index-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const env = { GIT_INDEX_FILE: tmpIndex };
  try {
    // Seed the temp index from the TARGET head's tree — the only legitimate baseline for a main-forward commit.
    const seed = dog.git(["read-tree", head], gitRoot, env);
    if (!seed.ok) {
      return { ok: false, reason: "result-tree-materialize-failed", detail: `read-tree ${head.slice(0, 8)}: ${seed.stderr}` };
    }
    // Stage ONLY the explicit pathspecs, into the temp index (each path's working-tree content over head's tree).
    for (const spec of Array.isArray(add) ? add : []) {
      const a = dog.git(["add", "--", spec], gitRoot, env);
      if (!a.ok) {
        return { ok: false, reason: "nothing-to-commit", detail: `git add ${spec}: ${a.stderr}` };
      }
    }
    const wt = dog.git(["write-tree"], gitRoot, env);
    if (!wt.ok || !/^[0-9a-f]{40}$/i.test(wt.stdout)) {
      return { ok: false, reason: "nothing-to-commit", detail: wt.stderr || `write-tree gave: ${wt.stdout.slice(0, 200)}` };
    }
    const tree = wt.stdout.toLowerCase();
    const headTree = dog.gitRead(["rev-parse", `${head}^{tree}`], gitRoot);
    if (headTree && headTree.toLowerCase() === tree) {
      // An empty commit is not "bookkeeping", it is noise the broker would then have to judge.
      return { ok: false, reason: "nothing-to-commit", detail: `staged tree is identical to ${head.slice(0, 8)} — stage something first (--add <pathspec>)` };
    }
    const ct = dog.git(["commit-tree", tree, "-p", head, "-m", message], gitRoot, env);
    if (!ct.ok || !/^[0-9a-f]{40}$/i.test(ct.stdout)) {
      return { ok: false, reason: "nothing-to-commit", detail: ct.stderr || ct.stdout };
    }
    return { ok: true, sha: ct.stdout.toLowerCase(), tree };
  } finally {
    try {
      fs.rmSync(tmpIndex, { force: true });
    } catch {
      /* temp index cleanup is best-effort */
    }
  }
}

/** brokerReleaseCommit(input, opts, seams) -> result. `seams` = the sanctioned test-producer seam. */
function brokerReleaseCommit(input = {}, opts = {}, seams = {}) {
  const gitRoot = opts.gitRoot || dog.ROOT;
  const targetRef = input.target_ref || TARGET_DEFAULT;
  const emit = opts.emit !== false;

  const head = dog.resolveRef(targetRef, gitRoot);
  if (!head) return { ok: false, route: "none", decision: "BLOCKED", reason: "target-ref-unresolvable", detail: targetRef, classification: "usage" };

  // ── (1) build the commit object — NO ref is written ────────────────────────────────────────────────
  // Explicit staging happens INSIDE buildReleaseCommit, into an isolated index seeded from the target head
  // (GF-2): the caller's real index is never touched, and only the named pathspecs can differ from main —
  // so a run from the wrong branch can no longer smuggle a foreign snapshot onto the release commit.
  let releaseCommit = input.release_commit || null;
  if (!releaseCommit) {
    const message = input.message;
    if (!message) return { ok: false, route: "none", decision: "BLOCKED", reason: "nothing-to-commit", detail: "a commit message is required (-m)", classification: "usage" };
    // R2-F3: the isolated head-seeded index commits ONLY the named pathspecs — the ambient real index is
    // deliberately NOT swept (that is the GF-2 foreign-snapshot vector). So a build-path invocation MUST
    // name at least one --add pathspec; there is otherwise provably nothing for this helper to commit.
    const addSpecs = Array.isArray(input.add) ? input.add.filter(Boolean) : [];
    if (addSpecs.length === 0) {
      return { ok: false, route: "none", decision: "BLOCKED", reason: "nothing-to-commit", detail: "name the pathspec(s) to commit with --add — the brokered release-commit builds ONLY the named paths on top of the target head; the ambient index is NOT swept (GF-2)", classification: "usage" };
    }
    const built = buildReleaseCommit({ gitRoot, head, message, add: addSpecs });
    if (!built.ok) {
      // finish() derives the class from the reason: nothing-to-commit -> usage, result-tree-materialize-failed
      // -> security (GF-1) — both no-fallback, so a base-mismatch/build failure never reaches the ordinary route.
      return finish({ ok: false, decision: "BLOCKED", reason: built.reason, detail: built.detail }, { gitRoot, targetRef, head, newHead: null, opts, seams, emit });
    }
    releaseCommit = built.sha;
  }

  // ── (3) the conductor lease ────────────────────────────────────────────────────────────────────────
  const spId = opts.spId || mcEnv.readEnv("SP_ID") || null;
  const held = dog.ensureLease(spId, opts.leaseRoot, seams.lease);
  if (!held.ok) {
    return finish({ ok: false, decision: "BLOCKED", reason: "lease-not-held", detail: `conductor lease unavailable for ${spId || "(no --sp-id)"}: ${held.state}` }, { gitRoot, targetRef, head, newHead: releaseCommit, opts, seams, emit });
  }

  try {
    const bundle = dog.resolveBundleConfig(opts);
    if (!bundle.ok) {
      return finish({ ok: false, decision: "BLOCKED", reason: bundle.reason, detail: bundle.detail }, { gitRoot, targetRef, head, newHead: releaseCommit, opts, seams, emit });
    }
    const loaded = dog.loadBroker(seams.broker);
    if (!loaded.ok) {
      return finish({ ok: false, decision: "BLOCKED", reason: loaded.reason, detail: loaded.detail }, { gitRoot, targetRef, head, newHead: releaseCommit, opts, seams, emit });
    }

    if (opts.dryRun === true) {
      return { ok: true, route: "dry-run", decision: "DRY-RUN", release_commit: releaseCommit, target_ref: targetRef, previous_head: head, lease: held.state, would_call: "integrateReleaseCommit" };
    }

    let res;
    try {
      res = loaded.broker.integrateReleaseCommit(
        { release_commit: releaseCommit, target_ref: targetRef },
        { bundleManifestPath: bundle.bundleManifestPath, bundleRoot: bundle.bundleRoot, spId, leaseRoot: opts.leaseRoot, gitRoot },
      );
    } catch (e) {
      res = { ok: false, decision: "BLOCKED", reason: "broker-threw", detail: e.message };
    }

    if (res && res.ok === true) {
      const onTarget = dog.currentBranchRef(gitRoot) === targetRef;
      if (emit) {
        process.stdout.write(`✔ BROKERED RELEASE COMMIT — ${targetRef} ${head.slice(0, 8)} → ${releaseCommit.slice(0, 8)} (suite ${res.receipt.suite_version}, bundle ${String(res.receipt.bundle_digest).slice(0, 12)}, hook_active=${res.receipt.hook_active})\n`);
        if (onTarget) process.stdout.write(`  ⓘ ${targetRef} is checked out: the ref moved, the index/worktree did not. Refresh deliberately.\n`);
      }
      // GF-3b: the release commit has ALREADY landed — read the informational count SAFELY so an unreadable
      // ledger cannot cause a false failure + unsafe retry pressure (nor substitute a false zero).
      const fbCount = dog.fallbackCountSafe(seams.logPath || dog.defaultLogPath(opts.root));
      return {
        ok: true,
        route: "brokered",
        decision: res.decision,
        transport: "release-commit",
        release_commit: releaseCommit,
        target_ref: targetRef,
        receipt: res.receipt,
        lease: held.state,
        fallback_count: fbCount.count,
        fallback_count_unreadable: fbCount.unreadable,
        worktree_refresh_required: onTarget,
      };
    }

    return finish(res || { ok: false, reason: "broker-threw", detail: "no result" }, { gitRoot, targetRef, head, newHead: releaseCommit, opts, seams, emit });
  } finally {
    // GF-4: inspect the release outcome. release() self-surfaces a loud orphan banner on failure, so a
    // discarded lease can never be silent; this captures it rather than dropping it on the floor.
    const rel = held.release();
    if (rel && rel.ok === false && emit) {
      process.stderr.write(`  ⓘ lease cleanup did not confirm for ${spId || "(sprint)"} — see the orphan warning above.\n`);
    }
  }
}

/** finish(refusal, ctx) — the ONE exit path for every non-LANDED outcome (see broker-merge.js#finish). */
function finish(refusal, ctx) {
  const reason = refusal.reason || "broker-threw";
  const classification = dog.classifyRefusal(reason);

  const fb = dog.attemptFallback({
    reason,
    detail: refusal.detail || refusal.offending || null,
    transport: "release-commit",
    targetRef: ctx.targetRef,
    gitRoot: ctx.gitRoot,
    newHead: ctx.newHead,
    expectedHead: ctx.head,
    branch: null,
    logPath: ctx.seams.logPath,
    eventsPath: ctx.seams.eventsPath !== undefined ? ctx.seams.eventsPath : dog.resolveEventsPath(),
    now: ctx.seams.now,
    root: ctx.opts.root,
    allowFallback: ctx.opts.allowFallback,
    dryRun: ctx.opts.dryRun === true,
    emit: ctx.emit,
    actor: ctx.opts.actor || "regen-bookkeeping",
  });

  if (fb.refused) {
    if (ctx.emit) process.stderr.write(`${dog.refusalBanner("release-commit", reason, fb.classification || classification, refusal.detail || refusal.offending)}\n`);
    return {
      ok: false,
      route: "none",
      decision: "BLOCKED",
      transport: "release-commit",
      reason,
      classification: fb.classification || classification,
      detail: refusal.detail || refusal.offending || null,
      fallback_refused: fb.reason || null,
      fallback_count: dog.fallbackCountSafe(ctx.seams.logPath || dog.defaultLogPath(ctx.opts.root)).count, // GF-3b: never throw on an already-decided refusal
    };
  }

  return {
    ok: fb.ok,
    route: fb.route,
    decision: fb.route === "dry-run" ? "DRY-RUN-WOULD-FALL-BACK" : fb.ok ? "LANDED-BY-FALLBACK" : "FALLBACK-FAILED",
    transport: "release-commit",
    broker_reason: reason,
    classification,
    fallback_record: fb.record,
    fallback_count: fb.count,
    reason: fb.reason,
    detail: fb.detail,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────

const USAGE = [
  'usage: node scripts/dispatch/broker-release-commit.js -m "<message>" [options]',
  "",
  "  Lands a routine regen/bookkeeping commit onto the target ref THROUGH the INC-1 brokered transport",
  "  (integrateReleaseCommit). Commits ONLY the pathspecs named with --add, built on top of the target",
  "  head in an isolated index — the ambient working index is NOT swept (GF-2). --add is REQUIRED unless",
  "  --release-commit is given.",
  "",
  "  -m, --message <msg>      commit message (required unless --release-commit)",
  "  --add <pathspec>         stage a pathspec first (repeatable; never `git add -A`)",
  "  --release-commit <sha>   land an already-built single-parent commit",
  "  --target-ref <ref>       default refs/heads/main",
  "  --sp-id <id>             sprint id for the conductor lease (default $MC_SP_ID)",
  "  --lease-root <dir>       lease store root",
  "  --git-root <dir>         repository root",
  "  --bundle-manifest <p>    promoted pinned-bundle manifest (or $MC_PINNED_BUNDLE_MANIFEST)",
  "  --bundle-root <dir>      promoted bundle root (or $MC_PINNED_BUNDLE_ROOT)",
  "  --no-fallback            refuse the ordinary route even for an operational miss (strict dogfood)",
  "  --dry-run                resolve + build + report, perform no write",
  "  --json                   machine-readable result on stdout",
  "",
  "  fallback ledger: node scripts/dispatch/broker-dogfood.js --report",
].join("\n");

function parseArgs(argv) {
  const o = { _: [], add: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const take = () => argv[++i];
    if (a === "--message" || a === "-m") o.message = take();
    else if (a === "--add") o.add.push(take());
    else if (a === "--release-commit") o.releaseCommit = take();
    else if (a === "--target-ref") o.targetRef = take();
    else if (a === "--sp-id") o.spId = take();
    else if (a === "--lease-root") o.leaseRoot = take();
    else if (a === "--git-root") o.gitRoot = take();
    else if (a === "--bundle-manifest") o.bundleManifestPath = take();
    else if (a === "--bundle-root") o.bundleRoot = take();
    else if (a === "--no-fallback") o.allowFallback = false;
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--json") o.json = true;
    else if (a === "--help" || a === "-h") o.help = true;
    else if (a.startsWith("-")) o.unknown = a;
    else o._.push(a);
  }
  return o;
}

function main(argv) {
  const a = parseArgs(argv);
  if (a.help) {
    console.log(USAGE);
    return 0;
  }
  if (a.unknown) {
    console.error(`broker-release-commit: unknown option ${a.unknown} (--help)`);
    return 2;
  }
  if (!a.message && !a.releaseCommit) {
    console.error(USAGE);
    return 2;
  }

  const res = brokerReleaseCommit(
    { message: a.message, add: a.add, release_commit: a.releaseCommit, target_ref: a.targetRef || TARGET_DEFAULT },
    {
      gitRoot: a.gitRoot,
      spId: a.spId,
      leaseRoot: a.leaseRoot,
      bundleManifestPath: a.bundleManifestPath,
      bundleRoot: a.bundleRoot,
      allowFallback: a.allowFallback,
      dryRun: a.dryRun,
      actor: "regen-bookkeeping",
    },
    {},
  );

  if (a.json) console.log(JSON.stringify(res, null, 2));
  return res.ok ? 0 : 1;
}

module.exports = { brokerReleaseCommit, buildReleaseCommit, parseArgs, main, TARGET_DEFAULT };

if (require.main === module) process.exit(main(process.argv.slice(2)));
