# Operator Message Contract — `paths.operatorContract`

Canonical source for the "Talking to the Operator" doctrine.
Shipped to every Master Console install (`owner: framework, managed: true` — refreshed by every
`/mc:update`, independent of whether the install's `CLAUDE.md` is locally customized and therefore
HELD). The two other homes that carry this text are `CLAUDE.md` § "Talking to the Operator" and
`.claude/agents/president/alpha.md` § Doctrine; all three must stay in parity (enforced by
`/scan:operator-contract`, §4 below) — never edit one without the other two.

## 1. The contract — doctrine block (verbatim text shipped elsewhere)

```markdown
## Talking to the Operator

The operator is the founder. Report like a chief of staff: **bottom line first, at most 5 short lines,
plain words.** Detail goes in a file the operator can open; name the file in one line. Never put internal
ids, commit hashes, ticket/ruling numbers or agent jargon in operator-facing prose unless the operator
asks for detail.

Anything the operator must SEE or ACT ON carries exactly one of four headers, written exactly like this
(emoji, ONE space, caps):

| Header | Use it when | Body |
|---|---|---|
| `▶️ RUN THIS` | a command is coming | ONE fenced command (consolidate), what it does, what to expect, what to tell Alex after |
| `⚠️ DECISION NEEDED` | the operator must choose | one recommendation, never a menu; the question is the last line |
| `⛔ BLOCKED` | work cannot proceed | what, why, who can clear it |
| `📌 FYI` | nothing to do | one or two lines |

Everything else is narrative and may be skipped. No shell command outside a `▶️ RUN THIS` block; no
question to the operator outside `⚠️ DECISION NEEDED`. Glyphs must be unambiguous in a terminal
(the emoji presentation `▶️`, not `▶`; one space after it).

Enforcer: `scripts/hooks/operator-contract-lint.js` (Stop hook, on by default) — see
`paths.operatorContract`. Opt-out / strictness: `mc.operatorContract` in `paths.manifest`.
```

## 2. The lint rule table (authoritative — parity-checked against the hook lib's constants)

Enforcer: `scripts/hooks/operator-contract-lint.js` (Stop hook), pure core in
`scripts/hooks/lib/operator-contract.js` (`lint(text, options) → { findings, verdict }`).

| Code | Finding | Class |
|---|---|---|
| `CMD-OUTSIDE-RUN` | a fenced block with lang `bash/sh/powershell/ps1/cmd/console`, OR any fenced/inline line starting `! `, `node `, `npm `, `git `, `powershell `, `pwsh `, whose enclosing section (text since the nearest contract header or markdown heading) is not `▶️ RUN THIS` | structural |
| `QUESTION-OUTSIDE-DECISION` | a line ending in `?` outside fences/blockquotes/`▶️ RUN THIS`, not under `⚠️ DECISION NEEDED` | structural |
| `MULTI-COMMAND` | > 1 fenced block inside one `▶️ RUN THIS` section | structural |
| `HEADER-GLYPH` | a header written with the wrong glyph form (`▶ RUN THIS` without U+FE0F, `⚠ `, two spaces, lowercase) | structural |
| `PREAMBLE-TOO-LONG` | > N non-blank lines before the first contract header (N = `maxLinesBeforeHeader`, default 5), when the message contains ≥ 1 header | register |
| `REGISTER-OVERRUN` | no header at all AND > N non-blank lines (pure narrative dump) | register |
| `RAW-IDENTIFIER` | outside fences and outside `▶️ RUN THIS`: 7–40-hex SHAs, UUIDs, `ED-\d+`, `R-\d+`, `RI-\d+`, `SP-\d{8}-\d+`, `S-[A-Z]+-\d+`, `L-\d{4}-`, `msg_id`, `PC-\d+` | register |

**Detail-requested override (register rules only):** suppressed when the operator's last prompt (from
the transcript) matches `/\b(detail|details|explain|verbose|full report|walk me through|show me
everything)\b/i`, or the message carries `📌 FYI (detail requested)`.

## 3. Strictness (settable per install)

| strictness | structural findings | register findings | exit |
|---|---|---|---|
| `off` | ignored | ignored | 0, telemetry only |
| `advisory` | stderr `[operator-contract] ...` | stderr | 0 |
| `strict` (DEFAULT on fresh installs) | **block**: stderr reason listing codes + the one-line fix, exit 2 (the model rewrites once, `stop_hook_active` guarantees no loop) | stderr | 2 on structural, 0 on register-only |
| `pedantic` | block | block | 2 |

Ship `strict` for the four STRUCTURAL rules (`CMD-OUTSIDE-RUN`,
`QUESTION-OUTSIDE-DECISION`, `MULTI-COMMAND`, `HEADER-GLYPH`) and `advisory` for the two REGISTER rules
(`PREAMBLE-TOO-LONG`/`REGISTER-OVERRUN`, `RAW-IDENTIFIER`) on fresh installs. Rationale: the structural
rules are unambiguous and are exactly the rules that must not be missable; the register rules
have a real false-positive surface and should earn `strict` from a week of telemetry. Reversible in one
manifest line per install (`mc.operatorContract.strictness`, or finer-grained per-class override — see
`.claude/manifest.json` and `scripts/hooks/lib/project-config.js#getOperatorContract`).

Precedence: env `MC_OPERATOR_CONTRACT=off|advisory|strict|pedantic` (read via `mc-env.readEnv`, the
read-both contract) > manifest block > built-in defaults. Absent manifest block = ON
(structural strict / register advisory).

## 4. Parity enforcement

`/scan:operator-contract` (`scripts/checks/operator-contract-scan.js`) asserts the header table in this
file equals the `CODE_META` constants in `scripts/hooks/lib/operator-contract.js` equals the block in
`CLAUDE.md` § "Talking to the Operator" (by table-row hash), so the three doctrine homes cannot drift
silently. It also asserts the hook is registered + enabled in `framework/hooks.registry.json` and present
in the compiled `.claude/settings.json` Stop block.

## 5. Scope note — why this lives in a framework-managed home

`CLAUDE.md` is the file the President actually reads each session, but a locally-customized install's
`CLAUDE.md` is HELD on `/mc:update` (`scripts/mc/update.js`, "local_customized") — it is never silently
overwritten. This file plus the `alpha.md` bullet are the durable carriers: every `/mc:update` refreshes
them regardless of whether the install touched its own `CLAUDE.md`.
