# INTERESTING.md

A reference archive of notable operator prompts, for later reuse.

---

## The big autonomous `/session:turbo` directive — 2026-05-30

> `/mode:adhoc` Find the WARPOS.md files from other projects, verify which items have been escalated (don't trust the lists), verify what has already been fixed or implimented, `/roadmap:add` to the top of the roadmap those items, then use `/sprint:full` to work your way through the items, using paralell sprints where safe. Also, verify the agents being used in the gauntlet; when we first used claude on this computer, codex wasn't yet installed. It is now, so codex/chatgpt model dispatch should work. Additionally, if Gemini doesn't work, make sure security is still ran. #29 - agreed; #30 - yes, reliability is important in this case, so `/roadmap:add` a torture-level reliability sprint; #31 - I'll trust you to pick the right routing rule. Then, `/roadmap:add` a session to bust the other open decision policy gaps. Then, do a full system scan, then do a seperate pass using `/scan:full` -- compare, and if `scan:full` shows gaps, fill them. Fix everything you find. Run the `discover:` skill suite, and, since it has been a long time, create an execut[e a] plan to assess its effectiveness, and improve it. Then, `/learn:deep`, `/learn:integrate`, `/beta:mine`, `/beta:integrate`, and finally `/commit:land`. Then, mint a new version I can upload my other projects to, and `/commit:land` again. Commit as you go. Save this prompt to INTERESTING.md at project root, so I can reference it later.

**Standing authorization given mid-run:** `APPROVED` — use as permission for any human approval gate encountered (NOT to bypass Beta; β `ESCALATE` still hard-halts).

### Decoded plan (phases)
1. **Gauntlet/dispatch verification** — codex now installed (0.135.0) + gemini (0.44.1); confirm both actually dispatch; verify gauntlet agent routing; if Gemini fails, security MUST still run.
2. **WARPOS.md reconcile** — read each product's `WARPOS.md`, verify each item against canonical@current (don't trust the lists: which are already fixed vs genuinely open), `/roadmap:add` the genuinely-open ones to the TOP, then `/sprint:full` through them (parallel where safe). *(The `/warp:reconcile` skill is the canonical engine for this.)*
3. **Decision-policy rulings** — #29 (state-conditional Class C) = apply; #30 = `/roadmap:add` a **torture-level reliability sprint**; #31 = pick + apply the β-vs-Director routing rule; then `/roadmap:add` a session to bust the remaining open DP gaps (#26/#27, #19–22, #11–13).
4. **Scans** — full system scan, then a separate `/scan:full` pass; compare; fill + fix any gaps `scan:full` shows.
5. **`discover:` suite** — run discover:orphaned + discover:systems; assess the suite's effectiveness (long unused) and improve it.
6. **Consolidation** — `/learn:deep` → `/learn:integrate` → `/beta:mine` → `/beta:integrate` → `/commit:land`.
7. **Release** — mint a new version (others can `/warp:update` to it) → `/commit:land`.
- **Throughout:** commit as I go; periodic grounded status; turbo `--scope all` + `APPROVED` for human gates.

### Findings at kickoff
- codex `0.135.0` + gemini `0.44.1` both installed on this machine.
- 4 products carry a `WARPOS.md` (four of the portfolio products); forerunner does not.
