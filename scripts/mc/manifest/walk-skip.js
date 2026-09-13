"use strict";

/**
 * Shared filesystem-walk exclusions for the MC manifest tools.
 *
 * build.js (writes _mc/MANIFEST.json) and validate.js (checks that manifest
 * against disk) MUST agree on what is *not shipped*, or they drift: build skips a
 * path, validate then reports the same path "unmanifested", and BC-02
 * (Manifest coverage/honesty drift) reds.
 *
 * Historically each file kept its own copy of these sets and they diverged
 * (`MC-Update`, then `_planning` — added to the builder, missing from the
 * validator). One source makes divergence impossible: the two tools can't
 * disagree about the skip set if there is only one skip set. This is the
 * named enforcer for the duplication-drift bug class (CLAUDE.md § Refactor &
 * Rename Hygiene) — the constant is the source of truth; both tools read it.
 */

// Directories (matched by basename, at any depth) never enumerated in the
// shipping manifest: package/build caches, VCS, IDE config, agent/operator
// scratch, and transient runtime state.
// ADDENDUM C (SP-20260717-001): rotation/archive artifacts are a DECLARED
// manifest-ignore class. The archive tier (.claude/runtime/archive/), the
// rotation locks (.claude/runtime/rotate-locks/), and the retention lock all
// live UNDER .claude/runtime/ — covered by the "runtime" dir skip below (and
// gitignored via `.claude/runtime/`). Rotation MOVES over-cap logs into that
// archive tier rather than leaving `.1` generations next to a manifest-tracked
// sink dir, so rotation can never trip BC-02 (manifest coverage/honesty drift).
// This comment is the explicit declaration; the "runtime" entry is the mechanism.
const WALK_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".warpos",
  ".warpos-backup",
  "WarpOS-Update", // gitignored operator scratch (parallels .warpos); not framework
  ".vscode",
  ".idea",
  ".codex", // Codex local project config/handoff state; not shipped framework content
  "runtime",
  "worktrees", // .claude/worktrees/ — agent scratch clones; not framework
  ".worktrees", // repo-root builder isolation worktrees (.worktrees/wt-*) — agent scratch; never framework, must never enter the shipping manifest nor break its build
  "_planning", // operator planning scratch for in-flight system updates; not framework, not shipped
  "_private", // operator-private material withheld from the public tree (E-OPEN-SOURCE-001 S-OS-02); gitignored, local only, never framework
  "_archive", // tracked archive tier for retired root docs (archive-never-delete); kept in the repo + pushed, but never shipped framework content. Added 2026-07-26 root-cleanup.
  "MC-v1", // operator's v1-rebuild charter corpus (root, in-flight planning scratch, same class as _planning / MC-Update); kept local + gitignored, never shipped. Clears the 24-file --strict unmanifested delta (crud-sweep 2026-07-16).
  "_reports", // per-project report OUTPUT (sprint/milestone/session/checkpoint reports via /report); created on use like runtime/ — NOT framework content. The /report skill (.claude/commands/) + framework/templates/report/ ship and seed it; the emitted reports themselves never ship. (SP-20260531-001)
  "agent-memory", // .claude/agent-memory/<teammate>/ — per-agent teammate memory store (e.g. Beta's accumulated judgment); runtime/local like the home memory dir + gitignored, NOT framework content. Without this skip the builder can't classify it and the build fails (session-end 2026-06-05).
  // .claude/agents/.system/dispatch-backups/ — the dispatch backup ring (last 50), written
  // per-dispatch by scripts/dispatch/backup.js with timestamped subdirs plus an index.jsonl.
  // Transient runtime state, never shipped framework content. This exclusion already existed in
  // FIVE sibling tools — generate-framework-manifest.js, hooks/path-guard.js, hooks/ref-checker.js,
  // hooks/version-bump-guard.js, path-lint.js — and was missing HERE, which is precisely the
  // duplication-drift bug class this file's header names. Observed 2026-08-18: a live ring left
  // `index.jsonl` unclassified and the manifest build exited 1, blocking commit. (The timestamped
  // subdirs' own contents happened to classify; the index file at the ring root did not.)
  "dispatch-backups",
]);

// Individual files never enumerated in the shipping manifest.
const WALK_SKIP_FILES = new Set([
  ".env",
  ".env.local",
  "DUMP.md",
  "CODEX-LOG.md",
  // (HOW2CLEANMEMORY.md moved to _docs/ in E-OPEN-SOURCE-001 S-OS-05 — classified by the
  // project-docs rule now, no skip needed.)
  // Transient/local root docs — operator input specs + per-repo registers, NOT
  // shipped framework (same class as DUMP.md). MC.md is a per-repo gap register
  // (products generate their own via /warp:flag; canonical's is local, never shipped);
  // MC-ISSUES.md is a session issue log; the *-PROMPT.md files are operator input.
  "MC.md",
  "MC-ISSUES.md",
  // NOTAGAIN.md — operator-facing dispatch-failure diagnostic (2026-06-10), same
  // per-repo-operator-doc class as DUMP.md/MC.md; never framework content.
  "NOTAGAIN.md",
  // DISPATCH-ERRORS.md — operator-directed dispatch-failure census + redesigns
  // (2026-06-11), companion to NOTAGAIN.md; same per-repo-operator-doc class.
  "DISPATCH-ERRORS.md",
  // REPORT-JULY-18.md — operator-requested export (2026-06-19, W4/teams-migration
  // situation write-up); gitignored transient OUTPUT, same per-repo-operator-doc
  // class as DUMP.md/DISPATCH-ERRORS.md. Without this skip the build chokes
  // "unclassified path" and the 29-file managed-drift can't be reconciled.
  "REPORT-JULY-18.md",
  "MC-PROMPT.md",
  "MASTERCONSOLE-PROMPT.md",
  ".DS_Store",
  "Thumbs.db",
  // Transient per-session markers hooks write under .claude/ (gitignored). They
  // are NOT framework content; both build.js and validate.js read this one set,
  // so listing them here keeps the two in agreement and stops the "session marker
  // flaps the validate gate → BC-02 reds the release" class (hit during 0.13.1).
  ".session-start-commit",
  ".session-checkpoint.json",
  // Harness scheduled-wakeup lock (.claude/scheduled_tasks.lock) — transient
  // per-session state written by the Claude Code scheduler (first seen 2026-06-10
  // when a session used ScheduleWakeup). Same class as the session markers above.
  "scheduled_tasks.lock",
  // Coherence graph — regenerated by scripts/system/coherence.js on every run
  // (content-stable; generatedAt preserved when unchanged). Untracked and not
  // gitignored, so without this skip it appears "unmanifested" the moment
  // coherence runs and flaps validate --strict (same class as the session
  // markers above). build.js + validate.js read this one set, so they stay
  // in agreement.
  "system-coherence.graph.json",
]);

module.exports = { WALK_SKIP_DIRS, WALK_SKIP_FILES };
