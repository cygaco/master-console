---
description: Quick red team scan — deterministic tools only (deps, routes, CVEs, secrets, config). Fast, no LLM reasoning.
---

# /redteam:scan — Quick Security Scan

Run the Red Team Orchestrator in **quick mode** — deterministic scanning only (personas 1-6). No LLM reasoning, no business logic analysis. Fast pass for CI or pre-commit checks.

## What it does

Dispatches the `redteam` agent with `scan_type: "quick"`, which runs RT-Scan sub-agent only:

1. **Dependency Auditor** — `npm audit`, known CVEs, supply chain risks
2. **Route Scanner** — OWASP Top 10 on all API routes (auth, validation, injection, CSRF)
3. **Next.js CVE Checker** — CVE-2025-29927, React2Shell, middleware bypass
4. **Extension Analyzer** — manifest permissions, content script injection, CSP
5. **Secret Scanner** — exposed API keys, tokens, credentials in source
6. **Config Auditor** — security headers, CORS, CSP, cookie flags

## Execution

1. Discover all relevant files:

```bash
# Build file list for scanning
API_ROUTES=$(find src/app/api -name "route.ts" -o -name "route.js" 2>/dev/null | tr '\n' ', ')
EXTENSION_FILES=$(find extension/ src/extension/ -name "*.ts" -o -name "*.js" -o -name "*.json" 2>/dev/null | tr '\n' ', ')
CONFIG_FILES="next.config.js,next.config.mjs,next.config.ts,package.json,.env,.env.local,.env.production"
echo "API routes: $API_ROUTES"
echo "Extension files: $EXTENSION_FILES"
```

2. Read `.claude/agents/engineering/security/reviewer.md` (the security-reviewer) for the RT Orchestrator Template
3. Fill in the template:
   - `{{SCAN_TYPE}}` = `quick`
   - `{{TARGET_SCOPE}}` = `full-stack`
   - `{{FILE_LIST}}` = discovered files from step 1
4. Dispatch the `redteam` agent (if in adhoc mode via Gamma, or directly if in solo mode)
5. Parse the `RedTeamResult` JSON
6. Report findings grouped by severity:
   - **CRITICAL/HIGH** = items requiring immediate attention
   - **MEDIUM** = warnings to address
   - **LOW/INFO** = informational

## Output

Print a summary table:

```
RED TEAM SCAN (quick)
═══════════════════════
Personas: 6 deterministic
Findings: X critical, Y high, Z medium
Gate: PASS / FAIL

CRITICAL:
  RT-001: [description] — [file:line]
  ...

HIGH:
  RT-009: [description] — [file:line]
  ...
```

If CRITICAL or HIGH findings exist, the gate FAILS.
