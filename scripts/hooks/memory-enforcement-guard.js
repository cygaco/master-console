#!/usr/bin/env node
/**
 * memory-enforcement-guard.js — PostToolUse Edit|Write hook.
 *
 * Operator rule (2026-05-25): "Any time you commit something to memory, make
 * an actual enforcement. Memory is unreliable."
 *
 * A memory entry is background context — easily missed, reflects only what was
 * true when written, and has no teeth on its own. This hook fires whenever a
 * *memory commit* lands (an auto-memory `.md` file, or a `learnings.jsonl`
 * append) and reminds the agent to pair it with a REAL enforcer (hook /
 * check / test / gate / schema / non-zero-exit script) or to log the gap via
 * `/enforcement:log`. It is the enforcer FOR the rule that every memory needs
 * an enforcer — the "every policy needs a named enforcer" discipline
 * (CLAUDE.md § Policy & Enforcement Hygiene) turned on memory itself.
 *
 * Mechanism: PostToolUse `additionalContext` (model-visible) + stderr
 * (user-visible). ALWAYS exits 0 — never blocks, never disrupts automated
 * /learn or /sleep flows. Fail-open on any error.
 *
 * Scope — deliberate memory commits only (high-frequency logs excluded):
 *   - <…>/.claude/projects/<…>/memory/*.md   (Claude Code auto-memory; MEMORY.md index excluded)
 *   - <…>/learnings.jsonl                      (MC semantic memory)
 * Excluded: events.jsonl, traces.jsonl, enforcement-debt.jsonl (logs / the
 * debt ledger itself).
 *
 * Delete-to-disable: remove this file (and its settings.json entry) to turn off.
 */
"use strict";

let input = "";
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input || "{}");
    const toolName = event.tool_name || "";
    if (toolName !== "Edit" && toolName !== "Write") return done();

    const fp = (event.tool_input && event.tool_input.file_path) || "";
    if (!fp) return done();

    const norm = fp.replace(/\\/g, "/");
    const base = norm.split("/").pop() || "";

    const isAutoMemoryMd =
      /\/\.claude\/projects\/[^/]+\/memory\/.+\.md$/i.test(norm) &&
      base.toLowerCase() !== "memory.md";
    const isLearnings = /\/learnings\.jsonl$/i.test(norm);

    if (!isAutoMemoryMd && !isLearnings) return done();

    const kind = isLearnings ? "learning" : "auto-memory entry";
    const msg =
      `[memory-enforcement-guard] You just committed a ${kind} (${base}). ` +
      `Memory is UNRELIABLE — background context that can be missed and reflects only what was true when written. ` +
      `Per operator rule (2026-05-25): pair this with an ACTUAL enforcer that makes a violation self-detecting — ` +
      `a hook, a /check:* skill, a test, a release gate, a schema, or a script that exits non-zero. ` +
      `If you truly cannot enforce it now, log the gap with /enforcement:log so it surfaces at /enforcement:list and /scan:full. ` +
      `Ask: "what makes a violation of this memory self-detecting?" — do not rely on the entry alone.`;

    // Model-visible reminder (additionalContext) + user-visible (stderr).
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: msg,
        },
      }),
    );
    process.stderr.write("\n" + msg + "\n\n");
    return done();
  } catch {
    return done();
  }
});

function done() {
  process.exit(0);
}
