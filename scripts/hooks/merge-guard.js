#!/usr/bin/env node
/**
 * merge-guard.js — Pre/PostToolUse hook for Bash commands.
 *
 * Blocks dangerous Bash commands that bypass other hooks:
 * - git merge agent/* before gauntlet passes (cycleStep must be "review-complete")
 * - git reset --hard (destructive)
 * - git checkout agent/* (prevents branch switching to agent branches)
 * - rm on src/ or _docs/ files (destructive)
 *
 * Warns without blocking on node -e with an fs write (bypasses Edit hooks).
 *
 * Allowlist-first for performance — read-only commands exit
 * immediately.
 * Fail-closed: parse errors or missing store
 * → BLOCK.
 */

const fs = require("fs");
const path = require("path");
const { PROJECT } = require("./lib/paths");
const { logEvent } = require("./lib/logger");

const STORE_PATH = path.resolve(PROJECT, ".claude", "agents", "store.json");

// Read-only command prefixes — fast-path allow
const ALLOWLIST = [
  "git log",
  "git status",
  "git diff",
  "git branch",
  "git show",
  "git worktree",
  "git stash",
  "git tag",
  "git remote",
  "git rev-parse",
  "git config",
  "ls ",
  "ls\n",
  "cat ",
  "head ",
  "tail ",
  "grep ",
  "rg ",
  "find ",
  "wc ",
  "echo ",
  "printf ",
  "pwd",
  "which ",
  "node -c ",
  "node --check",
  "npx tsc",
  "npx kill-port",
  "npm run build",
  "npm run lint",
  "npm run test",
  "npm run dev",
  "npm install",
  "tasklist",
  "timeout ",
  "sleep ",
  "mkdir ",
  "touch ",
  "cp ",
  "mv ",
  "sort ",
  "uniq ",
  "tr ",
  "sed ",
  "awk ",
  "curl ",
  // Provider CLIs intentionally NOT in this allowlist — the
  // dispatch-route-guard hook is the authoritative gate.
];

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
  } catch {
    return null;
  }
}

function block(reason) {
  logEvent("block", "system", "merge-guard-blocked", "", reason);
  console.log(JSON.stringify({ decision: "block", reason }));
  process.exit(0);
}

// Allowed commands are not logged: the harness transcript already holds every
// command, and nothing reads an allow row. Blocks and advisories still log.
function allow() {
  process.exit(0);
}

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const toolName = event.tool_name || "";

    // Only process Bash tool calls
    if (toolName !== "Bash") {
      process.exit(0);
    }

    const command = (event.tool_input || {}).command || "";
    const cmd = command.trim();

    if (!cmd) {
      process.exit(0);
    }

    // PostToolUse mode: tool_response present → log and allow
    if (event.tool_response !== undefined) {
      // Post-merge verification: check if a merge just completed
      if (cmd.includes("git merge")) {
        // tool_response from Bash hooks is { stdout, stderr, error?, ... }
        // not a plain string. String(obj) → "[object Object]" — every
        // merge response would fail the .includes("Fast-forward") string match
        // and be mislogged as "merge-unknown" with detail "[object Object]".
        const tr = event.tool_response;
        const response =
          typeof tr === "string"
            ? tr
            : String(
                (tr && (tr.stdout || tr.stderr || tr.error)) ||
                  (tr ? JSON.stringify(tr).slice(0, 500) : ""),
              );
        const merged =
          response.includes("Fast-forward") || response.includes("Merge made");
        const failed =
          response.includes("CONFLICT") ||
          response.includes("error") ||
          response.includes("fatal");
        logEvent(
          "merge",
          "system",
          merged
            ? "merge-completed"
            : failed
              ? "merge-failed"
              : "merge-unknown",
          cmd.slice(0, 100),
          response.slice(0, 200),
        );
        // Remind to run build after successful merge
        if (merged) {
          process.stderr.write(
            "\x1b[33m[merge-guard] POST-MERGE: Run `npm run build` to verify integration.\x1b[0m\n",
          );
          logEvent(
            "warn",
            "system",
            "post-merge-build-reminder",
            "",
            "Merge succeeded — npm run build required next",
          );
        }
      }
      process.exit(0);
    }

    // === PreToolUse mode ===

    // Pre-allowlist critical blocks (must run before fast-path)
    // Backup branch deletion — "git branch" is in allowlist so this must come first
    if (/git\s+branch\s+-[dD]\s+backup-/.test(cmd)) {
      block(
        "Deleting backup branches blocked: backup branches are protected (CLAUDE.md).",
      );
    }

    // Pre-allowlist auto-strip: redundant `cd <projectDir> && <tail>` prefix.
    // Must fire here because the allowlist exits early for "cd ... && ...".
    // CLAUDE.md anti-pattern: never prepend `cd <current-directory>`;
    // tools operate on cwd.
    // Now mutates tool_input.command via
    // hookSpecificOutput.updatedInput and exits — the stripped command then
    // re-enters PreToolUse where the rest of merge-guard's rules apply.
    //
    // Any tail benefits from the strip when target === <projectDir>, because
    // every Bash tool call already runs in the project cwd.
    {
      const m = cmd.match(
        /^\s*cd\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s*&&\s*(.+)$/,
      );
      if (m) {
        const target = m[1] || m[2] || m[3];
        const tail = m[4];
        let resolved;
        try {
          resolved = path.resolve(process.cwd(), target);
        } catch {
          resolved = target;
        }
        const isProjectDir =
          target === "." ||
          target === "./" ||
          resolved === PROJECT ||
          resolved === path.resolve(PROJECT);
        if (isProjectDir) {
          const stripped = tail.trim();
          logEvent(
            "audit",
            "system",
            "cd-prefix-stripped",
            cmd.slice(0, 120),
            `stripped → ${stripped.slice(0, 80)}`,
          );
          process.stderr.write(
            "\x1b[33m[merge-guard] AUTO-STRIP: removed redundant `cd <projectDir> && ` prefix. " +
              "Bash tool already runs in cwd; the prefix re-confuses path-aware tools (CLAUDE.md).\x1b[0m\n",
          );
          // Emit PreToolUse mutation. Claude Code's PreToolUse hook contract
          // honors hookSpecificOutput.updatedInput.command — the tool re-runs
          // with the new command. If the harness ignores updatedInput, the
          // event log's `cd-prefix-stripped` count will not drop (the
          // measurable signal that tells us to escalate).
          const out = {
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              updatedInput: { command: stripped },
            },
          };
          console.log(JSON.stringify(out));
          process.exit(0);
        }
      }
    }

    // Fast-path: allowlist check — ALL sub-commands in a chain must be safe
    // to exit early. Avoids `git status && rm -rf src/` sneaking past because
    // the first token matches. Matches memory-guard's pattern.
    const subCmds = cmd
      .split(/\s*(?:&&|\|\||\||;)\s*/)
      .map((c) => c.trim())
      .filter(Boolean);
    const isSafeSub = (c) =>
      c.startsWith("cd ") ||
      c === "cd" ||
      ALLOWLIST.some((prefix) => c.startsWith(prefix));
    const allSafe = subCmds.length > 0 && subCmds.every(isSafeSub);
    if (allSafe) {
      allow(cmd);
    }

    // === Block rules ===

    // MECHANICAL doc-ref-integrity gate (report-only inside /scan:full is
    // theater; enforcements must be MECHANICAL).
    // Fires AUTOMATICALLY at commit + non-agent merge time — a broken canon ref
    // exits non-zero here, no human /scan:full invocation required. The allowlist
    // + per-line `<!-- doc-ref-ignore -->` remain the escape. Fail-closed: a
    // runner crash (exit 2) blocks too (a runner error is never a pass). Skipped
    // silently if the enforcer is absent (older install layout).
    if (
      /^\s*git\s+commit\b/.test(cmd) ||
      (/^\s*git\s+merge\b/.test(cmd) && !/git\s+merge\s+agent\//.test(cmd))
    ) {
      const docRef = path.join(PROJECT, "scripts", "checks", "doc-ref-integrity.js");
      if (require("fs").existsSync(docRef)) {
        const { spawnSync } = require("child_process");
        const dr = spawnSync(process.execPath, [docRef, "--enforce"], {
          cwd: PROJECT,
          encoding: "utf8",
        });
        // exit 0 = clean (allow); exit 1 = broken refs (block); exit 2 = runner
        // crash (fail-closed block). Any other non-zero is also fail-closed.
        if (dr.status === 1) {
          const tail = (dr.stderr || dr.stdout || "")
            .split("\n")
            .slice(-12)
            .join("\n");
          block(
            `merge-guard: doc-ref-integrity found broken canon reference(s) — blocked.\n${tail}\n\nFix: repoint the dead ref, or (if legitimately absent) add it to scripts/checks/doc-ref-integrity.allowlist.json or mark the line with <!-- doc-ref-ignore -->. Re-run: node scripts/checks/doc-ref-integrity.js --enforce`,
          );
        } else if (dr.status !== 0 && dr.status !== null) {
          const errTail = (dr.stderr || dr.stdout || "")
            .split("\n")
            .slice(-8)
            .join("\n");
          const sig = dr.signal ? ` signal=${dr.signal}` : "";
          block(
            `merge-guard: doc-ref-integrity runner crashed (exit=${dr.status}${sig}) — fail-closed.\n${errTail}\n\nFix: run it directly — node scripts/checks/doc-ref-integrity.js --enforce`,
          );
        }
      }
    }

    // Path coherence gate runs before ANY git merge. If the gate
    // fails, the merge is blocked — broken path identity must be fixed
    // first. `--tracked`: it judges only files git tracks, so untracked
    // leftovers in the checkout (not part of the repo) never block a merge.
    // Skipped for the agent/* check below (which has its own gauntlet contract).
    if (/^\s*git\s+merge\b/.test(cmd) && !/git\s+merge\s+agent\//.test(cmd)) {
      const { spawnSync } = require("child_process");
      const result = spawnSync(
        process.execPath,
        [path.join(PROJECT, "scripts", "paths", "gate.js"), "--tracked"],
        { cwd: PROJECT, encoding: "utf8" },
      );
      if (result.status !== 0) {
        const tail = (result.stdout || "").split("\n").slice(-10).join("\n");
        block(
          `merge-guard: path coherence gate failed before merge (tracked files only).\n${tail}\n\nFix: the findings above name the file; for stale artifacts run node scripts/paths/build.js. Re-run: node scripts/paths/gate.js --tracked`,
        );
      }

      // Generated-artifact Freshness Gate. A branch merge can land a
      // changed framework/paths.registry.json (or hooks.registry.json) WITHOUT
      // the regenerated artifacts (.claude/paths.json, paths.generated.js,
      // settings.json hooks block), so the sprint pipeline + hooks silently read
      // a stale paths.json post-merge. Both build.js scripts expose `--check`
      // (exit 1 when any artifact is stale vs its registry). Run them BEFORE the
      // merge; block if either reports stale. Skipped silently when a build
      // script is absent (older install layout). Fast — pure file hashing, no
      // network.
      for (const rel of [
        ["scripts", "paths", "build.js"],
        ["scripts", "hooks", "build.js"],
      ]) {
        const buildScript = path.join(PROJECT, ...rel);
        if (!require("fs").existsSync(buildScript)) continue;
        const fresh = spawnSync(process.execPath, [buildScript, "--check"], {
          cwd: PROJECT,
          encoding: "utf8",
        });
        // exit 0 = fresh; exit 1 = stale (the documented signal). Any other
        // exit (crash) → fail-closed, same posture as the requirements gate.
        if (fresh.status === 1) {
          const tail = (fresh.stdout || fresh.stderr || "")
            .split("\n")
            .slice(-10)
            .join("\n");
          const buildCmd = rel.join("/");
          block(
            `merge-guard: generated artifacts stale before merge (${buildCmd} --check failed).\n${tail}\n\nThis merge would leave generated paths/hook artifacts out of sync with their registry — the sprint pipeline + hooks read the stale copy. Fix: node ${buildCmd}  (then commit the regenerated artifacts), and re-run the merge.`,
          );
        } else if (fresh.status !== 0 && fresh.status !== null) {
          const errTail =
            (fresh.stderr || "").split("\n").slice(-8).join("\n") ||
            (fresh.stdout || "").split("\n").slice(-8).join("\n");
          const sig = fresh.signal ? ` signal=${fresh.signal}` : "";
          block(
            `merge-guard: freshness gate crashed before merge (${rel.join("/")} --check exit=${fresh.status}${sig}).\n${errTail}\n\nFix: run it directly to see why — do not bypass without a known-good reason.`,
          );
        }
      }

      // Requirements Freshness Gate — refuses merge when the spec
      // has drifted from code. Class C RCOs and missing graph fail closed.
      // Engine lives in scripts/requirements/. Skipped silently if engine
      // hasn't shipped yet (older installs).
      //
      // Fail-closed semantics:
      //   exit 0 → green, allow
      //   exit 1 → yellow (warnings), allow
      //   exit 2 → red, block
      //   any other exit (crash, signal, undefined behavior) → block, with
      //   the gate output surfaced. Falling open here would let any uncaught
      //   exception in the gate become a silent merge.
      const reqGate = path.join(PROJECT, "scripts", "requirements", "gate.js");
      if (require("fs").existsSync(reqGate)) {
        const reqResult = spawnSync(process.execPath, [reqGate], {
          cwd: PROJECT,
          encoding: "utf8",
        });
        const reqStatus = reqResult.status;
        if (reqStatus === 2) {
          const tail = (reqResult.stdout || "")
            .split("\n")
            .slice(-12)
            .join("\n");
          block(
            `merge-guard: requirements Freshness Gate failed before merge.\n${tail}\n\nFix: node scripts/requirements/graph-build.js && node scripts/requirements/apply-rco.js --auto-expire 30 — then resolve any open Class C RCOs.`,
          );
        } else if (reqStatus !== 0 && reqStatus !== 1) {
          // Crash / unexpected exit — fail closed.
          const errTail =
            (reqResult.stderr || "").split("\n").slice(-8).join("\n") ||
            (reqResult.stdout || "").split("\n").slice(-8).join("\n");
          const sig = reqResult.signal ? ` signal=${reqResult.signal}` : "";
          block(
            `merge-guard: requirements Freshness Gate crashed (exit=${reqStatus}${sig}).\n${errTail}\n\nFix: investigate scripts/requirements/gate.js — do not bypass the gate without a known-good reason.`,
          );
        }
        // status 1 (yellow) — surface but do not block
      }
    }

    // 1. git merge agent/* — block unless cycleStep is "review-complete"
    if (/git\s+merge\s+agent\//.test(cmd)) {
      // The agent/* merge path runs the Freshness Gate too — without it the
      // most common build merge
      // could ship with unresolved Class C drift. Run the gate (red blocks,
      // yellow allows). Path-coherence already runs above for non-agent
      // merges; agent merges trust gauntlet review for that side.
      const reqGate = path.join(PROJECT, "scripts", "requirements", "gate.js");
      if (require("fs").existsSync(reqGate)) {
        const { spawnSync } = require("child_process");
        const reqResult = spawnSync(process.execPath, [reqGate], {
          cwd: PROJECT,
          encoding: "utf8",
        });
        const reqStatus = reqResult.status;
        if (reqStatus === 2) {
          const tail = (reqResult.stdout || "")
            .split("\n")
            .slice(-12)
            .join("\n");
          block(
            `merge-guard: requirements Freshness Gate failed before agent/* merge.\n${tail}\n\nFix: resolve open Class C RCOs or rebuild graph (node scripts/requirements/graph-build.js).`,
          );
        } else if (reqStatus !== 0 && reqStatus !== 1) {
          const errTail =
            (reqResult.stderr || "").split("\n").slice(-8).join("\n") ||
            (reqResult.stdout || "").split("\n").slice(-8).join("\n");
          const sig = reqResult.signal ? ` signal=${reqResult.signal}` : "";
          block(
            `merge-guard: Freshness Gate crashed before agent/* merge (exit=${reqStatus}${sig}).\n${errTail}`,
          );
        }
      }

      const store = readStore();
      if (!store) {
        block(
          "Cannot read store.json — fail-closed. git merge agent/* blocked.",
        );
      }
      const cycleStep = (store.heartbeat || {}).cycleStep;
      if (cycleStep !== "review-complete") {
        block(
          `git merge agent/* blocked: cycleStep is "${cycleStep}", must be "review-complete". ` +
            "Run gauntlet (eval+security+compliance) first.",
        );
      }
      // cycleStep is review-complete — allow the merge
      logEvent(
        "merge",
        "boss",
        "merge-allowed",
        cmd.slice(0, 100),
        `cycleStep=${cycleStep}`,
      );
      process.exit(0);
    }

    // 2. git reset --hard — always block
    if (/git\s+reset\s+--hard/.test(cmd)) {
      block(
        "git reset --hard blocked: destructive operation. Use git revert instead.",
      );
    }

    // 3. git checkout agent/ — block switching to agent branches
    if (/git\s+checkout\s+agent\//.test(cmd)) {
      block(
        "git checkout agent/* blocked: Boss should not switch to agent branches directly.",
      );
    }

    if (/\bgit\s+checkout\s+--\s+(?:\.|src\/?|docs\/?)\s*$/.test(cmd)) {
      block(
        "wide git checkout blocked: use a path-specific restore for the exact files you intend to discard.",
      );
    }

    // 4. node -e with fs write operations — ADVISORY (warn, never block).
    // An inline write skips the Edit/Write hooks, but so does a standalone
    // `node scripts/foo.js`, which was always allowed; blocking only the
    // inline spelling forced a rewrite and protected nothing. memory-guard's
    // Bash rule covers the append-only stores only where the target is visible
    // in the command text: a shell overwrite redirect or tee, a cp/mv/rm/
    // truncate operand, or writeFileSync called with a literal path naming the
    // store. A write through a variable path, or from inside a script file,
    // is not caught by either hook. Falls through so the rules
    // below (rm on src/_docs, force-push) still apply to the same command.
    if (
      /node\s+-e\s/.test(cmd) &&
      // Match fs WRITE methods only — the write families (write/append/mkdir/rm/unlink/rename/
      // cp/truncate/createWriteStream) so read-only `node -e` passes through.
      /fs\.(writeFile|writeFileSync|appendFile|appendFileSync|mkdir|mkdirSync|rm|rmSync|rmdir|rmdirSync|unlink|unlinkSync|rename|renameSync|cp|cpSync|copyFile|copyFileSync|truncate|truncateSync|createWriteStream)\b/.test(
        cmd,
      )
    ) {
      // The warning names the preferred path for the two dominant cases (a
      // JSONL append and a full-file write), with a general hint otherwise.
      const isJsonl = /\.(jsonl|ndjson)['"]\s*[,)]/.test(cmd);
      const isAppend = /appendFileSync/.test(cmd);
      const isWrite = /writeFileSync/.test(cmd);
      let hint;
      if (isJsonl && isAppend) {
        hint =
          "JSONL append: Read the file, find a unique anchor on the last line, then use Edit to append a `\\n` + new entry. " +
          "Or write a one-shot scripts/append-<name>.js calling `require('./scripts/hooks/lib/logger').logLearning(...)` (or similar canonical helper).";
      } else if (isWrite) {
        hint =
          "Full-file write: use the Write tool (it overwrites). " +
          "For partial JSON updates, prefer Read + Edit. For larger transforms, put logic in scripts/<name>.js and run `node scripts/<name>.js`.";
      } else {
        hint =
          "Use Edit/Write tools, or move the logic into scripts/<name>.js and run `node scripts/<name>.js`. " +
          "Hooks enforce ownership on Edit/Write but allow standalone scripts.";
      }
      logEvent(
        "warn",
        "system",
        "node-e-fs-write-advisory",
        cmd.slice(0, 100),
        "node -e with fs write (advisory, not blocked)",
      );
      process.stderr.write(
        `\x1b[33m[merge-guard] WARNING: node -e with fs write (not blocked; Edit/Write hooks do not see this write). ${hint}\x1b[0m\n`,
      );
    }

    // 5. rm on src/ or _docs/ — block destructive deletes.
    // Scoped per-segment so `cd src/ && rm /tmp/x` doesn't false-positive
    // (merge-guard regex overmatch). `git rm` is
    // allowed because git tracks the deletion and it's recoverable.
    {
      const segments = cmd.split(/(?:&&|\|\||;|\|)/);
      for (const seg of segments) {
        const s = seg.trim();
        if (!/\brm\b/.test(s)) continue;
        if (/\bgit\s+rm\b/.test(s)) continue;
        // Only block when the rm command itself targets src/ or _docs/ —
        // a path token starting with src/ or _docs/ in the same segment.
        if (/\b(?:src|docs)\//.test(s)) {
          block(
            "rm on src/ or _docs/ blocked: use `git rm` to manage file lifecycle.",
          );
        }
      }
    }

    // 5b. ref-checker advisory on `git rm <path>` (CLAUDE.md §"Refactor & Rename Hygiene").
    // Soft warning only — surfaces broken cross-file refs that the deletion may leave behind.
    // Spawned async + detached so the Bash call isn't blocked by the ~1-2s scan.
    {
      const segments = cmd.split(/(?:&&|\|\||;|\|)/);
      const hasGitRm = segments.some((s) => /\bgit\s+rm\b/.test(s.trim()));
      if (hasGitRm) {
        try {
          const { spawn } = require("child_process");
          const refChecker = path.resolve(__dirname, "ref-checker.js");
          const child = spawn("node", [refChecker, "--summary"], {
            cwd: PROJECT,
            detached: true,
            stdio: "ignore",
          });
          child.unref();
          process.stderr.write(
            "\x1b[33m[merge-guard] ADVISORY: git rm detected — ref-checker scan dispatched in background. Run `node scripts/hooks/ref-checker.js --summary` to see broken refs left by this delete.\x1b[0m\n",
          );
          logEvent(
            "warn",
            "system",
            "ref-checker-dispatched",
            cmd.slice(0, 100),
            "git rm detected — ref-checker spawned async",
          );
        } catch {
          /* fail-open — ref-checker is advisory, never blocks the user */
        }
      }
    }

    // 6. git push force forms — block all three:
    //    (a) --force / --force-with-lease
    //    (b) -f short flag
    //    (c) +refspec form: git push origin +main  (equivalent to --force)
    //    old regex caught only (a) and (b); +main syntax bypassed the guard.
    if (
      /git\s+push\s+.*--force/.test(cmd) ||
      /git\s+push\s+-f\b/.test(cmd) ||
      /git\s+push\s+\S+\s+\+\S+/.test(cmd)
    ) {
      block(
        "git push force-push blocked: destructive operation. (matched: --force / -f / +refspec)",
      );
    }

    // 6b. karpathy-run/* branches — block any push (experiment branches, never publish)
    if (/git\s+push\b.*karpathy-run\//.test(cmd)) {
      block(
        "karpathy-run/* branches are experiment-only; never pushed to remote. Use /karpathy:integrate to land the winning variant onto a feature branch off main.",
      );
    }

    // 7. git push (non-force) — advisory warning, not a block
    if (
      /git\s+push\b/.test(cmd) &&
      !/--force|-f\b|--dry-run/.test(cmd) &&
      !/git\s+push\s+\S+\s+\+\S+/.test(cmd)
    ) {
      logEvent(
        "warn",
        "system",
        "push-advisory",
        cmd.slice(0, 100),
        "Convention: ask user before pushing (CLAUDE.md)",
      );
      process.stderr.write(
        "\x1b[33m[merge-guard] ADVISORY: git push detected. Convention says ask before pushing.\x1b[0m\n",
      );
      // Allow — this is advisory only
    }

    // (Rule 8 — cd <projectDir> advisory — runs above the fast-path allowlist
    // because `cd ... && git ...` chains exit early through allow().)

    // Default: allow
    allow(cmd);
  } catch (e) {
    // Fail-closed on parse error
    logEvent(
      "block",
      "system",
      "merge-guard-parse-error",
      "",
      String(e).slice(0, 200),
    );
    console.log(
      JSON.stringify({
        decision: "block",
        reason:
          "merge-guard: parse error (fail-closed) — " + String(e).slice(0, 100),
      }),
    );
    process.exit(0);
  }
});
