# Cross-Provider Dispatch — Operational Rules

How Alpha and sub-agents must call non-Anthropic providers (codex, gemini) from this repo on Windows.

## Rule 1 — Always route through the canonical dispatcher

**Never:** `cat file | codex exec --model X -` from Bash.
**Always:** `node scripts/dispatch-agent.js ...` or `require('./scripts/hooks/lib/providers.js').runProvider(role, prompt)`.

**Why:** On Windows, cmd.exe's pipe doesn't reliably deliver stdin to codex's Node subprocess. The fix (`execSync(cmd, { input: promptContent })`) lives only inside `runProvider` (`scripts/hooks/lib/providers.js`). Raw `cat | codex` from Bash re-introduces the bug — codex idles on empty input, Bash kills it at 5 min, "0 bytes output."

## Rule 2 — Pre-flight ping before every heavy dispatch

Before committing to a multi-minute review, send a ≤200-byte prompt through the same dispatch path with a 30-second budget. If ping doesn't return: skip that provider for the phase, fall back to single-provider review.

```bash
node scripts/dispatch-agent.js --role smoke --provider openai --model gpt-5.5 --prompt "ping" --timeout 30
```

## Rule 3 — Parallel dispatch with first-finisher-wins for cross-model review

Launch gemini + codex simultaneously as background tasks. The first to return satisfies the cross-model review requirement. Cancel the loser.

**Why:** Serial dispatch means a hung codex blocks gemini for 5 min. Parallel dispatch turns one-broken-provider into a graceful single-provider fallback with no phase delay. Reviews are independent; no value in serializing them.

## Rule 4 — Strict model assertion (no silent fallback)

If the requested model isn't available on the account, fail closed. Don't silently degrade to the CLI default. `runProvider` enforces this via `strict: true` (default ON) — keep it on.

**Why:** A smoke test that uses the CLI default while dispatch passes an explicit `-m` model the installed CLI rejects yields a false positive. Policy: a fallback is explicit opt-in, otherwise fail closed.

## Caveat — Binding gap

A documented fix that lives only inside `lib/` does **not** protect against agents that bypass the lib helper and call the CLI raw. The same bug class returns whenever any caller goes around the canonical entrypoint.

If you find a transport-level fix worth keeping, **also** add a guard hook (e.g., a `pre-bash-guard` that flags raw `cat .* | codex` patterns on Windows) and a dispatch-contract rule (this doc). The lib fix is necessary but not sufficient.

## Operational checklist (per phase)

- [ ] Route check: every codex/gemini invocation goes through `dispatch-agent.js` or `runProvider`. Grep the dispatch source code for raw `cat ... | codex` or `cat ... | gemini`. Fix or refuse to dispatch if found.
- [ ] Ping check: 200B / 30s ping returns successfully through the same dispatch path you'll use for the heavy review.
- [ ] Parallel launch: gemini and codex dispatched simultaneously as background tasks; first finisher satisfies cross-model requirement.
- [ ] Fallback: if ping or transport fails for one provider, proceed with single-provider review and log the failure to `.claude/runtime/notes/<phase>-review-results.md`.

## Related references

- `scripts/hooks/lib/providers.js` — `runProvider` (Windows-stdin fix, 900s timeout, strict-model assertion)
- `scripts/dispatch-agent.js` — canonical dispatch entry point
