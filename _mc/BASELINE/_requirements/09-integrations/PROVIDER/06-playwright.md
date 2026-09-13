# Playwright — E2E Tests + MCP Server (Visual Browser)

**Sources** (re-fetch on major Playwright versions):
- https://playwright.dev/docs/intro
- https://github.com/microsoft/playwright-mcp
- https://playwright.dev/docs/getting-started-mcp

Last verified: 2026-04-28.

## Packages

| Package | Version | Purpose |
|---|---|---|
| `@playwright/test` | `^1.58.2` | Test runner + Chromium/WebKit/Firefox drivers |
| `@playwright/mcp` | latest (MCP server, npx) | Browser automation as MCP tools — drives Chromium from Claude Code session |

## Where wired

| Site | File | Purpose |
|---|---|---|
| Test config | `playwright.config.ts` | testDir `./requirements`, testMatch `**/tests/**/*.spec.ts`. Projects: chromium + mobile (375x812). webServer: `npm run dev`. baseURL: localhost:3000. trace on-first-retry, screenshot on failure. |
| E2E specs | `_requirements/<feature>/tests/*.spec.ts` | One folder per feature, mirroring `_requirements/04-features/`. Existing: `_requirements/onboarding/tests/{smoke,step-walk}.spec.ts`, `_requirements/backend/tests/gate-dodger.spec.ts`. |
| Shared fixtures | `_requirements/_shared/fixtures/dummy-session.json` | Family Planner persona pre-built session |
| Shared helpers | `_requirements/_shared/helpers/{dummy-plug,assertions,upload}.ts` | DM-mode jump, no-flash assertion, file-upload patterns |
| MCP runs | `runtime/qa/runs/<timestamp>.json` | Output of MCP-driven flows (gitignored) |

## Scripts

```bash
npm run test            # all projects
npm run test:ui         # Playwright UI mode
npm run test:headed     # visible browser
npm run test:chrome     # chromium only
npm run test:mobile     # 375x812 viewport
```

## Playwright MCP — visual browser for Claude Code

The MCP server exposes 34 browser-automation tools to Claude Code (and any MCP-compatible client). Two interaction modes:

| Mode | Tool | When |
|---|---|---|
| Snapshot (default) | `browser_snapshot` | Returns page accessibility tree as YAML. Fast, deterministic, no images. Best for clicking through flows + verifying state. |
| Vision (`--vision auto`, 2026) | `browser_take_screenshot` + `browser_move_mouse` | Returns PNGs. Read tool consumes them visually (Claude Code is multimodal). Best for visual regression, layout sanity. |

Both modes can run **headed** (visible window you can watch the agent drive) or **headless**.

### Install

```bash
claude mcp add playwright npx @playwright/mcp@latest --scope project
```

Project-scope registration creates `.mcp.json` (or settings entry) in the repo so the team shares the same MCP setup.

### Recommended config

Launch with `--vision auto --headed` for Pantry Pilot work — accessibility tree by default + screenshots when the layout matters + visible browser for the user to watch.

### Tool surface (selected)

- `browser_navigate(url)`
- `browser_click(ref)` — ref is the accessibility-tree node id from a prior snapshot
- `browser_type(ref, text)`
- `browser_take_screenshot()`
- `browser_snapshot()`
- `browser_evaluate(script)` — for reading localStorage / sessionStorage state
- `browser_wait_for(condition)`
- `browser_close()`

### Run-log format

```json
{
  "ts": "2026-04-28T20:00:00Z",
  "spec": "onboarding-mcp-pilot",
  "steps": [
    { "action": "navigate", "url": "http://localhost:3000", "ok": true },
    { "action": "snapshot", "tree": { "headings": [...], "buttons": [...] } },
    { "action": "screenshot", "path": "runtime/qa/runs/2026-04-28T20-00-00/step-1.png" },
    { "action": "click", "ref": "Import Recipe", "ok": true }
  ],
  "result": "pass",
  "notes": "Step 1 → 5 walked clean; recipe parse triggered Turnstile; Family Planner household populated"
}
```

## Project conventions

- **Use the Family Planner persona** (household of four, shared list) dummy data from `src/lib/dummy-data.ts` for any walking-test. Persona is calibrated for fixture grounding rules.
- **Pair Phase B shadcn migration with MCP visual diff:** snapshot before swapping bespoke component → swap → snapshot after → compare. Catches layout regressions during the shadcn rollout.
- **Don't commit screenshots.** `runtime/qa/runs/` is gitignored.

## Known issues

- `webServer` config in `playwright.config.ts` boots `npm run dev` if not already running — first run is slow (~10s).
- Mobile project at 375x812 has occasional layout shift on Step 4/5 transitions; tracked in retro logs.
- Headed mode + CAPTCHAs: when Cloudflare Turnstile fires (first call per browser), the user has to solve manually if it's not invisible. Use a clean profile per run.

## Failure modes

| Failure | Behavior |
|---|---|
| Dev server not running | webServer config boots it; if port in use, test fails fast. |
| MCP server unreachable | `claude mcp list` shows status; reconfigure via `claude mcp add ...` |
| Stale screenshots in `runtime/qa/runs/` | Wipe the directory and re-run; not consumed by anything but the human review |
