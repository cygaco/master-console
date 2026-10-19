---
description: Full red team audit — 11 personas across deterministic scanning + LLM reasoning. Finds auth bypasses, prompt injection, business logic abuse, attack chains.
says:
  - red team it
  - full red team
  - attack the system
  - security audit
  - redteam full
---

# /redteam:full — Full Red Team Audit

Run the Red Team Orchestrator in **full mode** — both deterministic scanning (personas 1-6) AND LLM-powered analysis (personas 7-11). Deep security audit with creative attack reasoning.

## What it does

Dispatches the `redteam` agent with `scan_type: "full"`, which runs both sub-agents in parallel:

### RT-Scan (deterministic, personas 1-6)
1. **Dependency Auditor** — `npm audit`, known CVEs, supply chain risks
2. **Route Scanner** — OWASP Top 10 on all API routes
3. **Next.js CVE Checker** — known Next.js CVEs
4. **Extension Analyzer** — manifest permissions, content script security
5. **Secret Scanner** — exposed credentials in source
6. **Config Auditor** — security headers, CORS, CSP, cookies

### RT-Analyze (LLM reasoning, personas 7-11)
7. **Auth Flow Tracer** — traces full auth flows, finds bypass paths, session fixation, token leakage
8. **Prompt Injection Prober** — maps all LLM-facing inputs, tests injection vectors, tool abuse
9. **Business Logic Attacker** — reasons about multi-step abuse (IDOR, rate abuse, payment bypass)
10. **Attack Chain Correlator** — connects findings into compound exploit chains
11. **Extension-Web Bridge** — tests the interaction boundaries between an external tool and the web app

## Execution

1. Discover all relevant files:

```bash
# Build comprehensive file list
ALL_SRC=$(find src/ -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" 2>/dev/null | head -200 | tr '\n' ', ')
EXTENSION_FILES=$(find extension/ src/extension/ -name "*.ts" -o -name "*.js" -o -name "*.json" 2>/dev/null | tr '\n' ', ')
CONFIG_FILES="next.config.js,next.config.mjs,next.config.ts,package.json,middleware.ts,middleware.js,.env,.env.local"
PROMPT_FILES=$(find src/ -path "*prompt*" -o -path "*ai*" -o -path "*llm*" 2>/dev/null | tr '\n' ', ')
echo "Source files: $(echo "$ALL_SRC" | tr ',' '\n' | wc -l) files"
echo "Extension files: $EXTENSION_FILES"
echo "Prompt/AI files: $PROMPT_FILES"
```

2. Read `.claude/agents/engineering/security/reviewer.md` (the security-reviewer) for the RT Orchestrator Template
3. Fill in the template:
   - `{{SCAN_TYPE}}` = `full`
   - `{{TARGET_SCOPE}}` = `full-stack`
   - `{{FILE_LIST}}` = discovered files from step 1
4. Dispatch the `redteam` agent
5. Parse the merged `RedTeamResult` JSON (scan + analyze findings combined)
6. Report findings with full context

## Output

Print a comprehensive report:

```
RED TEAM AUDIT (full)
═══════════════════════════════
Personas: 11 (6 deterministic + 5 reasoning)
Findings: X critical, Y high, Z medium, W low
Gate: PASS / FAIL

ATTACK CHAINS:
  Chain 1: [name] — RT-500 -> RT-501 -> RT-003
    [narrative of how the chain works]
  ...

CRITICAL:
  RT-001: [description] — [file:line]
    Impact: [what an attacker could do]
    Mitigation: [how to fix]
  ...

HIGH:
  ...

AUTH TRACES:
  Login flow: [step1 -> step2 -> ...] — [gaps found]
  ...

PROMPT INJECTION VECTORS:
  [input_source] -> [prompt_location] — sanitization: [none/partial/adequate]
  ...
```

If CRITICAL or HIGH findings exist, the gate FAILS. Attack chains may elevate compound severity.

## When to run

- Before any release or deploy
- After significant auth/API/extension changes
- When adding new LLM-facing features
- Periodic full-codebase audit (weekly recommended)
- After `/qa:audit` passes (red team catches what QA doesn't)
