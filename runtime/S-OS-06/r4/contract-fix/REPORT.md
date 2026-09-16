# S-OS-06 r4 — contract-fix lane REPORT

**Status: STOPPED — PREMISE FALSE (proven). Enforcer NOT modified. Zero code diff vs sprint head 628d13f0.**
Branch `s-os-06/r4-contract-fix`. Evidence captures alongside this file (`red.txt`, `property-probe.txt`,
`contract-test.txt`, `shape-test.txt`, `v1..v4-*.txt`).

## 1. RED — unedited fixture (captured, byte-unchanged)

`node --test tests/regression/SP-20260627-001/negative-fixtures.test.js` → **exit 1**, 8/9:

    - AC-2.4 forbidden_shape: cross-provider reviewer (qa-reviewer) via in-process-agent is REFUSED (kills diversity):
      expected the enforcer to FAIL the planted violation, but it PASSED ({"ok":true,"violations":[],"contract":
      {"role":"qa-reviewer","class":"claude_pinned_reviewer","allowed_shapes":["in-process-agent"],"forbidden_shapes":["api"],
      "tool_id":"agent-tool", ...}) — FALSE-GREEN

The RED is real. The contract the enforcer resolved is in its own output: `class: claude_pinned_reviewer`.

## 2. The false premise: qa-reviewer is NOT a cross-provider reviewer

The brief assumes the fixture "routes a CROSS-PROVIDER reviewer through the in-process agent shape" and that
"nobody introduced this". Both are false:

| Fact | Evidence |
|---|---|
| When the fixture was written (f80acee9), qa-reviewer was `provider: openai` (gpt-5.5), so its class was `cross_provider_reviewer` and the plant was a real violation | `git show f80acee9:.claude/agents/_org/role-registry.json` → `{"provider":"openai","model":"gpt-5.5"}` |
| **An operator ruling on 2026-08-18 moved qa-, frontend- and backend-reviewer to claude-opus-5** | registry commit **826a80ac**; field `_operator_2026_08_18: "was openai/gpt-5.6-terra; operator ruling 2026-08-18 (codex credits exhausted + fable guardrails) → claude-opus-5"`. The commit body names the consequence: "corpus diversity is temporarily gone on those three lanes … security-reviewer … is now the gauntlet's only cross-family judgment" |
| So qa-reviewer now matches the derivation rule `{kind:reviewer, provider:claude} → claude_pinned_reviewer` (allowed_shapes `["in-process-agent"]`) | `dispatch-contract.json` class_derivation rule 7 |
| **The enforcer's own suite asserts the OPPOSITE of the plant on the exact same input** | `scripts/dispatch/dispatch-contract.test.js:99` `h.pass("claude-pinned reviewer (qa-reviewer) via in-process-agent is allowed (2026-08-18 re-pin)", …validateDispatch({role:"qa-reviewer", shape:"in-process-agent", toolId:"agent-tool"}))` → run: **exit 0, 22/22**. `scripts/dispatch/dispatch-shape.test.js:72` `qa-reviewer → in-process-agent (claude-pinned since the 2026-08-18 re-pin)` → run: **exit 0** |
| **This exact stale plant was already diagnosed and fixed in three sibling tests** | commit **07a20846** (2026-09-12): "tests hard-coded qa-reviewer + backend-reviewer as the cross-provider reviewer examples. The operator ruling of 2026-08-18 (registry commit 826a80ac) re-pinned … **the enforcer was RIGHT, the fixtures were stale.** Tests now derive the subject from the registry (any live cross_provider_reviewer)". It changed dispatch-claude/dispatch-contract/dispatch-shape tests but **missed `tests/regression/SP-20260627-001/negative-fixtures.test.js`**, because the committed runner never discovered that file (lane I's finding). |

**So the defect is a stale plant, not an enforcer false-green.** It is the missed-file rename/migration bug class
(CLAUDE.md "Refactor & Rename Hygiene"), and it stayed hidden because the runner didn't discover the file.

**Why I did not "fix" the enforcer.** The unedited fixture only turns green if `validateDispatch` refuses
`{qa-reviewer, in-process-agent}`. Every way to do that is wrong:
- Special-casing qa-reviewer is the enumeration failure the brief forbids.
- Refusing in-process-agent for every Claude reviewer that isn't `claude_pinned` would refuse the live, legal
  shape of qa-, frontend- and backend-reviewer. It would turn `dispatch-contract.test.js:99` and
  `dispatch-shape.test.js:72` red, and it would reverse an operator ruling (Class C) from a fixer lane.
- Refusing the shape doesn't restore diversity anyway. The diversity loss came from the **registry provider
  pin**, not from the dispatch shape. In-process and subprocess-claude are both Claude.

R-102 ("FIX, not quarantine") was ruled on the false premise, so it needs a fresh α ruling. The fixture is
evidence and I left it byte-unchanged. Once the plant is corrected, its violation should be re-derived from the
registry, as 07a20846 did. That edit is outside my scope.

## 3. The property actually holds on the live registry (plant + neighbour, β form)

The property: **a role whose registry provider is not Claude may not be dispatched in a shape that runs Claude
(`in-process-agent`, or `subprocess-claude` outside a registered lane).**

I ran all 36 registry roles through the live `validateDispatch`. Every role with provider openai/antigravity
(beta, director-of-product, product-lead, design-lead, security-reviewer, director-of-growth, research-lead,
copy-lead, conversion-lead, marketing-lead, ops-analyst, cabinet) resolves to cross_provider_reviewer,
cross_provider_consult_lead or tool_cross_provider, and **all REFUSE in-process-agent**.

`property-probe.txt`:
- PLANT `security-reviewer` (antigravity) in-process-agent → **ok:false** "FORBIDDEN … (class cross_provider_reviewer)"
- PLANT `product-lead` (openai) in-process-agent → **ok:false**
- PLANT `security-reviewer` subprocess-claude (no lane) → **ok:false**
- NEIGHBOUR `security-reviewer` subprocess-cross-provider/agy → **ok:true** (legit shape not over-refused)
- NEIGHBOUR `qa-reviewer` (claude, operator re-pin) in-process-agent → **ok:true**
- NEIGHBOUR `design-quality` (claude_pinned) in-process-agent → **ok:true**
- LANE `sanctionedLane(security-reviewer, in-process-agent, security_claude_hunter)` → **sanctioned:true** (ADR-0016 carve-out intact)

## 4. FINDING (not fixed, needs a ruling): the property is contingent, not structural

The property holds today only because every live non-Claude role happens to match a specific derivation rule.
Nothing guarantees it. I evaluated the contract's own first-match rules against **synthetic** attributes (the
registry path can't be overridden, by design):
- `{tier:worker, kind:consult, provider:openai}` → **fallback `manager`** → allowed `["in-process-agent"]`
- `{tier:worker, kind:reviewer, provider:xai}` → **fallback `manager`** → allowed `["in-process-agent"]`
- `{kind:reviewer, provider:openai, claude_pinned:true}` → `claude_pinned_reviewer` (rule 4 comes before the provider rules) → allowed `["in-process-agent"]`

A new non-Claude role with an unexpected kind or provider would silently resolve to a Claude in-process shape.
Proposed structural rule: in `validateDispatch`, add a runtime backstop next to the build_chain hard invariant.
If `registryAttrs.provider !== "claude"` and the shape is `in-process-agent` or `subprocess-claude`, refuse
unless `sanctionedLane` matches. Add a `validateContractFile` integrity check that no non-Claude-provider role
derives to a class allowing a Claude shape. I didn't implement this because:
(a) it doesn't turn the fixture green, so it isn't R-102's defect;
(b) it's a security-relevant change to the dispatch keystone, and the brief said STOP on a false premise;
(c) sanctioned-lane callers (review_fallback, security_claude_hunter) would need to be threaded through first.

## 5. Verification — each as its own command, real exit codes (no code changed)

| Command | Exit | Numbers |
|---|---|---|
| `node --test tests/regression/SP-20260627-001/negative-fixtures.test.js` | **1** | 8/9 passed; 1 FAILED = the stale AC-2.4 plant (§2) |
| `node --test tests/regression/SP-20260611-002/wrapper-mode-binding.test.js` | **1** | 2/3 pass; FAIL `report-only-ramp-preserved-not-blocking` — **ALREADY FAILING at 628d13f0, not caused by me** (see below) |
| `node scripts/checks/framework-purity.js` | **0** | result: OK |
| `node scripts/checks/leak-gate.js` | **0** | GREEN |
| (extra) `node scripts/dispatch/dispatch-contract.test.js` | 0 | 22/22 (11 planted-violation) |
| (extra) `node --test scripts/dispatch/dispatch-shape.test.js` | 0 | 1/1 |

**Second stale neighbour (FINDING).** In `wrapper-mode-binding.test.js`, the `enforce:false` path (`baseEnv`,
line 126) sets **no** env var and relies on report-only being the default. SP-20260627-001 changed the default
to enforce (`contractEnforceMode` → `return true; // DEFAULT = enforce`), so the wrapper exits 1:
`dispatch-agent report-only should proceed; … VIOLATION: … NARROWED OUT by mode 'sprint' … 1 !== 0`.
This is the same class: a test that went stale when the regime changed and was probably never discovered.
The likely fix is to set `MC_DISPATCH_CONTRACT_ENFORCE=report` explicitly on the enforce:false path. That is a
test-file edit outside my scope, so I didn't make it.

## Refused / not done
- Did not edit the fixture (evidence, byte-unchanged; `git diff 628d13f0 --stat` shows only this REPORT + captures).
- Did not special-case qa-reviewer or refuse Claude-reviewer in-process shapes (that would over-refuse and reverse the 2026-08-18 operator ruling).
- Did not implement the §4 structural backstop (needs a ruling; STOP on false premise).
- Did not touch the runner, workflows, manifests, settings or partition-loader.
