# Skills Map

Generated: 2026-06-28T02:37:50.334Z

Total: **229** skills across **47** namespaces. 98 user-invocable.

## By namespace

### admin (4)

| Name | Description | Calls | Called by |
|---|---|---|---|
| guides | Open the in-app founder admin panel's guides sub-route in a browser, against a PRODUCT's running Nex | 1 | 2 |
| preview | Open/preview a PRODUCT's in-app founder admin panel in the browser. Scaffolds (or reuses) a fixed th | 3 | 4 |
| readiness | Open the in-app founder admin panel's launch-readiness sub-route in a browser, against a PRODUCT's r | 1 | 2 |
| seed | Seed warm-start data (founder-allowlist session, sample events, FOUNDERS_CHECKLIST.md) into the live | 3 | 1 |

### agents (2)

| Name | Description | Calls | Called by |
|---|---|---|---|
| list | Enumerate every agent spec by mode and role. | 0 | 0 |
| test | Smoke-dispatch one agent role (or all non-claude roles) with a tiny ping prompt. | 1 | 0 |

### beta (2)

| Name | Description | Calls | Called by |
|---|---|---|---|
| integrate | Apply validated recommendations from beta mining into the judgment model | 2 | 3 |
| mine | Mine patterns from user behavior — prompts, decisions, skill chains, evolution cycles | 4 | 3 |

### bootstrap (3)

| Name | Description | Calls | Called by |
|---|---|---|---|
| lastmile | "Prototype → monetizable product. Drives the 'last mile': readiness audit → launch plan → roadmap/sp | 12 | 0 |
| ponder | Exploratory pondering of a project — surface tensions, patterns, JTBD drift, and one forcing questio | 5 | 0 |
| spinup | "From 'just MC' to something on screen — one in-project command: setup (deterministic create+sca | 5 | 2 |

### check (4)

| Name | Description | Calls | Called by |
|---|---|---|---|
| all | "[deprecated alias → /scan:full] Run every scan in parallel — a full system scan. Superseded by /sca | 1 | 0 |
| framework-purity | "[deprecated alias → /scan:framework-purity] Refuse product-content leaks in canonical. Superseded b | 1 | 0 |
| framework-views-fresh | "[deprecated alias → /scan:framework-views-fresh] Verify .claude views are byte-identical regenerati | 1 | 0 |
| install | "[deprecated alias → /scan:install] Verify a fresh MC install. Superseded by /scan:install in th | 1 | 0 |

### cockpit (1)

| Name | Description | Calls | Called by |
|---|---|---|---|
| readiness | The launch-readiness cockpit — show how close every registered product is to launch (composite %, bl | 2 | 1 |

### commit (4)

| Name | Description | Calls | Called by |
|---|---|---|---|
| both | "[deprecated alias → /commit:land] Commit locally then push — superseded by /commit:land, which also | 3 | 1 |
| land | Land the working branch — commit locally, push the branch, then merge it into the repo's default bra | 4 | 2 |
| local | Stage and commit changes locally — smart message, no push | 0 | 1 |
| remote | Push current branch to remote — with safety checks | 0 | 1 |

### content (2)

| Name | Description | Calls | Called by |
|---|---|---|---|
| contra | Create a Contra portfolio post with carousel images — write copy, design slides, render PNGs | 0 | 0 |
| linkedin | Create a LinkedIn post with carousel images — write copy, design slides, render PNGs | 0 | 0 |

### discover (2)

| Name | Description | Calls | Called by |
|---|---|---|---|
| orphaned | Discover orphaned work — find every deferred, forgotten, or abandoned task across NEXT.md, runtime n | 8 | 1 |
| systems | Multi-angle system discovery — find every system in a project by intersecting 6 discovery lenses, su | 5 | 3 |

### docs (1)

| Name | Description | Calls | Called by |
|---|---|---|---|
| catalog | Enumerate reference docs under _docs/ and paths.reference, with title/size/mtime. | 0 | 0 |

### enforcement (2)

| Name | Description | Calls | Called by |
|---|---|---|---|
| list | List open enforcement-debt entries — policies/conventions without an automated enforcer | 1 | 1 |
| log | Record a policy/convention that has no automated enforcer — appends to paths.enforcementDebt | 1 | 7 |

### epic (10)

| Name | Description | Calls | Called by |
|---|---|---|---|
| acceptance | Manage an epic's acceptance criteria — ensure all 20 AC categories are present, each names its proof | 1 | 0 |
| close | Close a completed epic — verify every DoD item is satisfied + evidenced, fill the Completion record, | 0 | 0 |
| fold | Fold new information, constraints, bugs, or scope into an EXISTING epic intelligently — classify the | 0 | 2 |
| link | Establish and verify an epic's linkages — its companion plan artifact, ROADMAP § Epics entry, TRACKE | 0 | 0 |
| plan | Turn a messy plain-language epic request into a durable, validate-shape epic tracker file plus a com | 3 | 5 |
| repair | Detect and repair a drifted or malformed epic file — missing §-sections, blank required sections, br | 1 | 0 |
| review | Run an independent, cross-provider review of an epic plan — feasibility, overclaims, missing enforce | 1 | 0 |
| split | Split an over-large epic into two or more coherent epics — partition scope/sprints/DoD/AC, preserve  | 1 | 0 |
| start | Transition a planned epic into active execution — mint its first wave of sprints, set state to Activ | 3 | 0 |
| status | Report an epic's true, evidence-based status — percent completion, sprint roll-up, DoD progress, blo | 0 | 0 |

### etc (2)

| Name | Description | Calls | Called by |
|---|---|---|---|
| author | Author or refine a skill/prompt in standard format, producing a sibling eval-pack for evaluation | 1 | 1 |
| eval | Evaluate a skill or prompt artifact against its eval-pack, emitting a validated decision_record | 0 | 2 |

### events (2)

| Name | Description | Calls | Called by |
|---|---|---|---|
| query | Query the events log by type, time range, or regex match. | 0 | 0 |
| tail | Tail the events log — last N events with timestamp, type, and message. | 0 | 0 |

### fav (2)

| Name | Description | Calls | Called by |
|---|---|---|---|
| list | Browse all saved favorite moments, grouped by category | 0 | 1 |
| search | Search saved favorite moments by keyword across category, title, and notes — find one specific momen | 1 | 0 |

### fix (2)

| Name | Description | Calls | Called by |
|---|---|---|---|
| deep | Deep fix — Full diagnostic with automatic framework selection, 5 solutions, root cause analysis, and | 0 | 8 |
| fast | Quick fix — Direct Investigation, no formal framework. Read error, find cause, fix it, verify. | 2 | 4 |

### growth (8)

| Name | Description | Calls | Called by |
|---|---|---|---|
| ad-images | Turn an angle into native-ad image prompts (scene-first, no text/logo/product, --ar) and render them | 0 | 0 |
| ad-video | Turn an angle into a video ad (swipe→script→storyboard→image-to-video) and generate it via Higgsfiel | 0 | 0 |
| advertorial | Write a long-form advertorial (pre-sell editorial) from a message brief — research → foundational do | 0 | 0 |
| angles | Mine untapped marketing angles from real customer voice (Amazon/Reddit/forums) — ≥3 evidence-backed  | 0 | 0 |
| iterate | Iterate a winning creative/message against a conversion/engagement scalar — thin wrapper over karpat | 0 | 0 |
| landing-page | Build a converting landing page from a conversion brief — conversion-hierarchy, scaffold component l | 0 | 0 |
| message-brief | Distill the single winning message (the spine artifact) from an audience dossier + angles — contrast | 0 | 0 |
| product-finder | Find validated high-margin products for paid traffic — EQ-scored (Product×Ads×Funnel×LTV), SCALE/TES | 0 | 0 |

### guides (4)

| Name | Description | Calls | Called by |
|---|---|---|---|
| coverage | Fail-closed enforcer for the _guides/ library — asserts every guide is anchored, the registry is fre | 6 | 4 |
| integrate | Wire each _guides/ guide into the bootstrap pipeline (spinup/lastmile) at its declared anchor in its | 2 | 6 |
| organize | Audit and restructure the _guides/ launch-guide library — backfill the guide-anchor contract onto ev | 3 | 3 |
| write | Author a launch guide into _guides/ — grounded in an external brand-building methodology (paid course, not redistributed) + the existing  | 5 | 2 |

### hooks (4)

| Name | Description | Calls | Called by |
|---|---|---|---|
| add | Design and create a new hook from a description | 0 | 0 |
| disable | Temporarily disable a hook by moving it from settings.json into a `_disabled_hooks` section, with a  | 0 | 0 |
| friction | Analyze friction points — find patterns that suggest missing hooks | 0 | 1 |
| test | Test all hooks with synthetic payloads and measure execution time | 0 | 2 |

### issues (3)

| Name | Description | Calls | Called by |
|---|---|---|---|
| list | List recurring system issues — bugs/regressions in the agent framework, hooks, skills, .claude/, scr | 5 | 5 |
| log | Record a new instance of a recurring system issue — appends to recurring-issues.jsonl, dedupes by ti | 2 | 9 |
| resolve | Mark a recurring system issue resolved with a permanent fix summary | 2 | 3 |

### karpathy (3)

| Name | Description | Calls | Called by |
|---|---|---|---|
| integrate | Review a completed /karpathy:run and merge its winning artifact(s) into main — only command that tou | 2 | 3 |
| run | Karpathy autoresearch loop — plan a closed-loop experiment, review, then run autonomously in an isol | 4 | 2 |
| status | Read-only status dashboard for an active or completed /karpathy:run. Shows score curve, flag counts, | 3 | 1 |

### knowledge (2)

| Name | Description | Calls | Called by |
|---|---|---|---|
| coverage | Fail-closed enforcer for the _knowledge/ layer (the company "brain", ADR-0007) — asserts the domain  | 5 | 2 |
| integrate | Wire each _knowledge/ domain into its consumers in its declared shape — LIBRARY domains via a knowle | 2 | 1 |

### learn (3)

| Name | Description | Calls | Called by |
|---|---|---|---|
| deep | Deep learning — extracts from conversation + event log + retro/report files (oneshot retros, sprint  | 8 | 7 |
| ingest | Ingest external knowledge from files, links, or YouTube videos and apply learnings to the system | 3 | 4 |
| integrate | Learning integrator — promote validated high-score learnings into actual system enforcement (hooks,  | 3 | 8 |

### linters (1)

| Name | Description | Calls | Called by |
|---|---|---|---|
| run | Run every project linter (path-lint, lint-*, npm lint:*) and aggregate pass/fail. | 0 | 0 |

### manifest (3)

| Name | Description | Calls | Called by |
|---|---|---|---|
| migrate | Migrate the manifest to a target MC version. Dry-run by default; --apply to write. | 0 | 0 |
| show | Print .claude/manifest.json (pretty by default, --json for compact). | 0 | 0 |
| validate | Validate the current .claude/manifest.json against the v1 manifest schema and report any drift, miss | 0 | 0 |

### maps (10)

| Name | Description | Calls | Called by |
|---|---|---|---|
| all | Registry of all maps — shows every map, its source, last updated, and staleness | 10 | 8 |
| architecture | App structure — routes, components, libs, how they connect | 0 | 2 |
| coverage | Maps-suite self-inventory — asserts every /maps:* skill is registered in /maps:all, no dangling regi | 3 | 3 |
| enforcements | Enforcement coverage — hooks, gates, gap analysis, open/closed gaps | 0 | 3 |
| hooks | Hook wiring diagram — events, matchers, scripts, execution order | 0 | 1 |
| memory | Memory store relationships — who reads/writes each store, entry counts | 0 | 1 |
| skills | Skill dependency graph — namespaces, cross-references, data flow | 2 | 2 |
| steps | Regenerate step tables in canonical docs from _requirements/00-canonical/STEPS.json — closes the las | 2 | 1 |
| systems | Render the systems manifest as a dependency graph — visualize which systems depend on which, their s | 0 | 3 |
| tools | Tool registry — skills, hooks, external CLIs, API services, npm scripts, platform tools | 1 | 1 |

### mode (4)

| Name | Description | Calls | Called by |
|---|---|---|---|
| adhoc | Enter adhoc team mode — Alpha + Beta + Gamma for collaborative feature development | 2 | 8 |
| oneshot | Initiate a oneshot build — launch Delta as standalone orchestrator for full skeleton runs | 1 | 7 |
| solo | Enter solo mode — just Alpha and the user, no agent team | 0 | 3 |
| sprint | Enter sprint mode — ε (Alex Epsilon) conducts the full sprint lifecycle (plan→design→build→gauntlet→ | 4 | 3 |

### models (4)

| Name | Description | Calls | Called by |
|---|---|---|---|
| check | Audit configured dispatch models against the latest vendor catalogs — flag drift, deprecations, and  | 3 | 3 |
| route | Route a specific command/role to a specific model — thin, validated wrapper over the Dispatch Consol | 2 | 3 |
| router | Open the model router panel — ensure the catalog carries all the latest model options, then launch t | 3 | 4 |
| update | Update the dispatch catalog to the latest models — re-ingest vendor docs, migrate deprecated/shut-do | 3 | 2 |

### oneshot (4)

| Name | Description | Calls | Called by |
|---|---|---|---|
| improve | Update preflight passes based on gaps discovered during runs. Modifies the check skills themselves. | 2 | 3 |
| preflight | Pre-run preflight — branch creation + skeleton gut + 7-pass verification audit. Default = full setup | 10 | 5 |
| retro | Post-run retrospective — context + git log + code diffs + cross-run analysis, all 9 categories. Defa | 9 | 8 |
| start | Lightweight kickoff — verify ready-state and hand off to Delta. Does NOT run setup or destructive wo | 6 | 2 |

### panel (5)

| Name | Description | Calls | Called by |
|---|---|---|---|
| admin | Open a product's in-app founder admin panel in the browser (run-in-product, never MC itself). A  | 2 | 1 |
| list | List every registered panel — the one discoverable entry for "show me a panel". Enumerates framework | 4 | 4 |
| models | Open the model router — the Dispatch Console GUI (role → provider → model → effort). A thin /panel:* | 2 | 1 |
| readiness | Open the cross-product launch-readiness board. A thin /panel:* forwarder to the canonical /cockpit:r | 2 | 1 |
| roadmap | Open the roadmap "what's next" panel in your BROWSER — an interactive visual board of active sprints | 1 | 1 |

### paths (6)

| Name | Description | Calls | Called by |
|---|---|---|---|
| add | Guided flow for adding a paths registry key. | 0 | 0 |
| convert | Guided flow for converting hardcoded literals to paths.* tokens. | 0 | 0 |
| coverage | Report on documentation coverage for the paths registry — which path keys are documented in PATH_KEY | 0 | 0 |
| doctor | Validate path registry, generated artifacts, and path lint rules. | 0 | 0 |
| explain | Explain one paths registry key — show its resolved on-disk path, owner, kind, deprecation status, an | 0 | 0 |
| rename | Guided flow for renaming a paths registry key. | 0 | 0 |

### permissions (1)

| Name | Description | Calls | Called by |
|---|---|---|---|
| authorized | Operator authorization — durably allow a blocked action by adding a scoped permissions.allow rule fr | 1 | 0 |

### playbook (1)

| Name | Description | Calls | Called by |
|---|---|---|---|
| add | Append a play to the Playbook (.claude/project/reference/playbook.md) — a named, example-anchored op | 1 | 0 |

### portfolio (8)

| Name | Description | Calls | Called by |
|---|---|---|---|
| list | List all registered portfolio products — slug, path, MC version, last commit, dirty count, curre | 0 | 6 |
| new | Scaffold a new product repo (sibling to MC) with the framework installed and committed, then reg | 4 | 6 |
| open | Open a registered portfolio product — print its path and a cd hint, or spawn a new terminal window w | 0 | 3 |
| register | Register an existing local repo as a portfolio product in ~/.mc/portfolio.json. | 0 | 2 |
| run | Run a skill against another portfolio product in a fresh Claude subprocess — never retargets the cur | 1 | 1 |
| spinup | "From MC, run the idea→on-screen on-ramp against a registered product: dispatches /bootstrap:spi | 4 | 2 |
| status | Portfolio dashboard — per-product MC version, last commit, dirty count, current sprint, GitHub r | 1 | 2 |
| sync | Run /mc:update across every registered portfolio product sequentially. No fail-fast — failures cap | 1 | 0 |

### qa (2)

| Name | Description | Calls | Called by |
|---|---|---|---|
| audit | Active full-codebase QA audit — systematically walks all 7 failure-mode personas | 0 | 3 |
| check | Passive QA scan on recent git diff changes — checks for 7 failure-mode signatures | 0 | 0 |

### reasoning (3)

| Name | Description | Calls | Called by |
|---|---|---|---|
| log | Log a reasoning episode — record what framework was used, why, and what happened | 3 | 2 |
| run | Reason through a problem or decision — auto-detects quick triage vs deep deliberation | 2 | 5 |
| score | Score fix quality (0-4) and retroactively reclassify old fixes when new evidence appears | 1 | 2 |

### redteam (2)

| Name | Description | Calls | Called by |
|---|---|---|---|
| full | Full red team audit — 11 personas across deterministic scanning + LLM reasoning. Finds auth bypasses | 1 | 2 |
| scan | Quick red team scan — deterministic tools only (deps, routes, CVEs, secrets, config). Fast, no LLM r | 0 | 1 |

### research (2)

| Name | Description | Calls | Called by |
|---|---|---|---|
| deep | Real deep research — Gemini Thinking writes the brief, then OpenAI Deep Research API + Gemini Deep R | 0 | 2 |
| simple | Deep research pipeline — queries Claude, ChatGPT (Codex), and Gemini in parallel, saves reports, syn | 0 | 1 |

### roadmap (6)

| Name | Description | Calls | Called by |
|---|---|---|---|
| add | Append a new entry to ROADMAP.md — picks section, formats consistently, preserves existing content | 1 | 8 |
| cleanup | Audit ROADMAP.md — detect completed items, stale entries, duplicates, hidden urgencies; propose a cl | 5 | 3 |
| create | "Bootstrap a product ROADMAP.md from the inputs a project actually has — prefers _requirements/00-ca | 5 | 1 |
| ideas | Predict candidate roadmap entries across four evidence lenses (3 each = 12 ideas) — whole-roadmap, l | 2 | 2 |
| next | The 1-idea alternative to /roadmap:ideas — the single highest-leverage next roadmap entry (the role- | 2 | 2 |
| prioritize | Role-aware roadmap prioritization — runs /roadmap:cleanup first, then consults the Product Lead (sin | 4 | 0 |

### scan (53)

| Name | Description | Calls | Called by |
|---|---|---|---|
| ac-coverage | Read-only audit of acceptance-criteria.md verified_by:- linkage across active sprints. | 3 | 3 |
| adhoc-fail-override | Reject an adhoc dispatcher that overrode a binding reviewer FAIL — verdict-content check (the blind  | 0 | 2 |
| adhoc-team-hygiene | Read-only probe for adhoc-team accretion — flags teams whose members carry a -N de-dup suffix or a s | 2 | 1 |
| admin-suite-coverage | Coverage + freshness enforcer for the admin:* dev-tooling suite — each admin skill resolves, every a | 3 | 2 |
| architecture | Architecture integrity — do the layers connect? agent system, cross-layer seams, documentation healt | 6 | 7 |
| coherence | Run the MC system coherence graph across 15 drift types. | 0 | 1 |
| cutover-completeness | ED-026 cutover gate — greps the IMPERATIVE layer + keystone registries for RAW deleted-old-tree lite | 2 | 1 |
| design-system | Design system compliance check - scans UI code for raw colors, raw primitives, missing design docs,  | 0 | 1 |
| dispatch-routing-parity | Assert the role→provider routing tables agree across providers.js, catalog.js, and the dispatch guid | 1 | 1 |
| docker-secrets | Dockerfile → .dockerignore secret-exposure check — flags secret files (.env, *.pem, credentials) tha | 2 | 1 |
| environment | Environment readiness and tooling quality — fast go/no-go or deep audit | 8 | 3 |
| etc-harness | Audit the /etc authoring+eval harness — fail-closed enforcer that rejects an invented authoring form | 2 | 1 |
| framework-purity | Refuse product-content leaks in canonical — scans for client slugs, maintainer abs paths, root-level | 2 | 4 |
| framework-views-fresh | Verify .claude/commands and .claude/agents are byte-identical regenerations of their _mc/ source | 2 | 3 |
| full | Run every scan in parallel — a full system scan across project health, governance, and MC distri | 59 | 27 |
| ingest-firewall | Audit the ingest stores (_docs/research, _docs/imports, _docs/briefs, _docs/clones) for un-firewalle | 0 | 1 |
| install | Verify a fresh MC install — manifest, paths, agents, hooks, version, settings. | 1 | 4 |
| issues | Pattern-mine events.jsonl for repeat audit-block signatures — surface candidates for /issues:log | 5 | 2 |
| model-chain | The named enforcer (ED-058) for the role-registry model/effort CHAIN — opus-4.8 is the shipped top,  | 2 | 1 |
| node-procs | Read-only diagnostic — list Node processes on the host with PID, start-time, working-set KB, and com | 1 | 2 |
| panel-registry-coverage | Coverage enforcer for the panel-registry (the /panel:* suite) — every `panels` row is well-shaped ({ | 4 | 1 |
| patterns | Cross-run intelligence and automation proposals — diagnose recurring patterns or propose prevention | 8 | 5 |
| planning-principles | Report-only plan-lint — flags any plan artifact under _planning/epics/** (optionally _planning/plans | 4 | 2 |
| privacy | Pre-publish scan for personal data — credentials, emails, homedir paths, runtime files tracked by gi | 0 | 2 |
| references | Cross-file reference integrity — broken links, orphans, stale SPEC_GRAPH edges | 4 | 9 |
| regressions | Run the regression-seed suite — the 26 recurring bug classes from the 0.17.0 spec, made runnable. Re | 2 | 1 |
| requirements | Specification consistency, coverage, and drift — static audit, change-driven propagation check, or p | 7 | 10 |
| roadmap-trace | "Assert every done/retrospected/released sprint has BOTH a Sprints-table ledger row AND a Shipped na | 2 | 3 |
| role-parity | The one check that owns role parity across the org map, the dispatch catalog, and team-guard — fail- | 0 | 3 |
| scaffold-coverage | Verify the MC app scaffold (Next+Tailwind v4+shadcn/ui+Radix+Lucide) is complete and coherent —  | 2 | 1 |
| scan-coverage | Scan-suite self-inventory — asserts every /scan:* skill is delegated by /scan:full or explicitly exc | 1 | 7 |
| skill-hook-coverage | Bidirectional coverage of the skill hook-point registry — REVERSE (registry coherent vs role-registr | 4 | 2 |
| sprint-beta-honesty | Audits Beta consultation honesty across post-cutoff /sprint:full runs (missing consults, placeholder | 1 | 2 |
| sprint-hook-coverage | Bidirectional coverage of the sprint hook-point registry — FORWARD (every matched block-row has a ma | 2 | 2 |
| sprint-manager-consult | Audits manager-consult coverage across post-cutoff /sprint:full runs — asserts the design-quality au | 3 | 2 |
| system | System inventory — enumerate every active MC system, diff against manifest, report drift and gap | 6 | 2 |
| timeline | Reconstruct a build timeline from transaction, event, and provider logs. | 0 | 1 |
| turbo-spend | Report the turbo session's REAL cross-provider API spend against the operator-set ceiling (framework | 1 | 0 |
| version-coherence | Verify version + schema-label coherence — product version agrees across ALL manifests (incl. the one | 2 | 1 |
| mc-applied-migrations | Detect already-applied MC migration scripts left on disk in consumer projects | 0 | 1 |
| mc-capsule-resolvable | Verify the capsule for /mc:update --to <v> is resolvable from REPO_ROOT, sibling clones, manifest. | 1 | 1 |
| mc-install-baseline | Verify a MC install baseline exists (.claude/framework-installed.json present, installedVersion  | 2 | 1 |
| mc-layer-diff | Read-only product-vs-dev-tooling layer diff — lists which framework-owned paths SHIP to consumer pro | 3 | 1 |
| mc-manifest-coverage | Verify every on-disk path is enumerated in _mc/MANIFEST.json — catches "added framework content, | 3 | 3 |
| mc-manifest-honesty | Verify framework-installed.json reflects actual disk state (no missing files, no hash drift) | 1 | 3 |
| mc-migration-coverage | Verify every breaking change in a MC release ships with a corresponding migration script under f | 1 | 1 |
| mc-migration-presence | Verify every migration listed in capsule release.json#migrations[] exists in the source tree before  | 1 | 1 |
| mc-path-resolution | Verify every paths.json key points to an existing path (skip generated/ephemeral keys) | 1 | 1 |
| mc-ship-coverage | Verify every framework-owned path under the consumer-essential roots is actually shipped (enumerated | 4 | 2 |
| mc-staleness | Detect drift between the installed MC version on disk and the latest canonical version, flagging | 1 | 2 |
| mc-structure-parity | Verify installed framework has the structural skeleton dirs canonical declares | 1 | 1 |
| mc-tracked-transients | Catch transient state accidentally committed (.mc/, qa-*.png, runtime/qa-*/, etc.) | 0 | 1 |
| mc-version-quorum | Verify version.json, .claude/framework-manifest.json, .claude/framework-installed.json, and install. | 0 | 2 |

### session (11)

| Name | Description | Calls | Called by |
|---|---|---|---|
| checkpoint | Force an immediate session checkpoint save — captures conversation context and tool activity that gi | 0 | 3 |
| dump | Write a prescriptive handoff to DUMP.md at project root — context, session progression (as fenced co | 7 | 2 |
| end | Full session wrap-up — cognitive maintenance (learn/mine/sleep → integrate learnings + β recs) → rec | 14 | 1 |
| handoff | Generate a rich AI-analyzed handoff document (replaces /handoff) | 1 | 4 |
| history | Browse past session handoff summaries from the handoffs directory — useful for tracking what happene | 1 | 1 |
| read | Read the cross-session inbox — see what other Alex sessions have been doing | 0 | 2 |
| recap | Catch up on the last N turns of this session — what you asked, what I did, what's still pending | 3 | 1 |
| resume | Pick up the previous session and KEEP GOING — load the handoff, re-establish mode + team + turbo, an | 8 | 4 |
| takenotes | Append a timestamped note to a per-topic file under runtime/notes/ | 0 | 0 |
| turbo | Session speed mode — pre-authorize a batch of high-impact actions (permissions.allow) AND switch the | 2 | 2 |
| write | Post a message to the cross-session inbox so other Alex sessions can see it. Default is fully automa | 0 | 3 |

### skills (4)

| Name | Description | Calls | Called by |
|---|---|---|---|
| cleanup | Audit all skills for dead weight, duplicates, broken references, and namespace issues — then clean u | 8 | 1 |
| create | Create a new skill from a description — supports simple, multi-phase, and parallel workflows | 5 | 1 |
| delete | Remove a skill from .claude/commands with a backup, so it can be restored if the deletion turns out  | 2 | 0 |
| edit | Edit the body or frontmatter of an existing skill under .claude/commands — guided flow that preserve | 2 | 0 |

### sleep (2)

| Name | Description | Calls | Called by |
|---|---|---|---|
| deep | "Full sleep cycle — all 6 phases: NREM consolidation, cleanup, replay, REM dreaming, repair, growth  | 8 | 14 |
| quick | Light nap — NREM consolidation + glymphatic cleanup only (~5 min) | 2 | 3 |

### sprint (8)

| Name | Description | Calls | Called by |
|---|---|---|---|
| cost-gate | Toggle the /sprint:full cost-estimate halt on or off — turn off the heuristic spend gate when an ope | 2 | 0 |
| design | Turn an approved Plan Contract into PRD, stories, COPY, INPUTS, TRACE, acceptance criteria, QA, red- | 3 | 4 |
| execute | Execute the sprint via Ralph-style plan/act/test/review/record/checkpoint loops per ticket, with cra | 4 | 5 |
| full | Single-invocation execution of the full sprint pipeline (plan→design→execute→release-prep→retro) und | 9 | 12 |
| plan | Turn a brief plain-language request into a structured sprint plan and durable Plan Contract. Evidenc | 6 | 9 |
| release | Prepare and execute a sprint release — final checks, approval, deploy gate, release notes, rollback  | 4 | 6 |
| retrospective | Synthesize a post-sprint retrospective from tracker artifacts — outcomes, friction, action items. Id | 3 | 3 |
| status | Read-only status view of every live sprint — shows id, lane, status, phase, last checkpoint, and the | 3 | 0 |

### trackers (2)

| Name | Description | Calls | Called by |
|---|---|---|---|
| init | Initialize the enforced tracker system in a repo — scaffold a validator-GREEN tracker structure. Cre | 1 | 0 |
| validate | Fail-closed validator for the enforced tracker system (agentic_os_tracker_system_improvements.md §28 | 0 | 3 |

### ui (1)

| Name | Description | Calls | Called by |
|---|---|---|---|
| review | Design system compliance audit — read-only check of components against the project's design-system d | 0 | 0 |

### warp (14)

| Name | Description | Calls | Called by |
|---|---|---|---|
| check | Compare your MC installation against the latest version — find stale, new, and missing items | 1 | 1 |
| deprecate | "Create a guarded MC deprecation proposal for an agent, skill, hook, path, requirement, pattern, | 0 | 0 |
| diff | Diff canonical MC against an installed product — version/staleness, framework-file drift (stale  | 6 | 0 |
| doctor | "Unified MC diagnostic — runs every health check in one place. Like /mc:health but full-covera | 9 | 2 |
| flag | Flag a MC framework/tooling gap from a downstream product — append a structured, canonical-consu | 3 | 1 |
| health | Verify MC installation — checks every system, reports green/yellow/red with plain-English fixes | 2 | 13 |
| md | "Tune CLAUDE.md with project-specific context — refresh the auto-generated project block from PROJEC | 2 | 0 |
| reconcile | Reconcile downstream-flagged MC gaps into canonical — discover every product's MC.md, verify | 10 | 1 |
| release | "Drive a full MC release of the canonical clone from this product repo — promote, bump, regen, b | 0 | 4 |
| setup | Set up MC end-to-end — clone, install, merge CLAUDE.md, restart, verify. Safe to re-run; auto-de | 5 | 6 |
| sync | "Legacy alias for /mc:update that forwards to the canonical update flow so older references and mu | 2 | 4 |
| tour | Guided introduction to MC — explains everything in simple language, no jargon | 15 | 1 |
| uninstall | Completely remove MC from a project — restores pre-install state from backup | 3 | 1 |
| update | "Update MC in this project to a target release. Default = latest. Default mode = dry-run; pass - | 5 | 14 |

## Cross-references

Top callers (skills that invoke the most others):

- `/scan:full` → /knowledge:coverage, /maps:all, /oneshot:preflight, /scan:ac-coverage, /scan:adhoc-fail-override, /scan:adhoc-team-hygiene, /scan:admin-suite-coverage, /scan:architecture, /scan:coherence, /scan:cutover-completeness, /scan:design-system, /scan:dispatch-routing-parity, /scan:docker-secrets, /scan:environment, /scan:etc-harness, /scan:framework-purity, /scan:framework-views-fresh, /scan:ingest-firewall, /scan:install, /scan:issues, /scan:model-chain, /scan:node-procs, /scan:panel-registry-coverage, /scan:patterns, /scan:planning-principles, /scan:privacy, /scan:references, /scan:regressions, /scan:requirements, /scan:roadmap-trace, /scan:role-parity, /scan:scaffold-coverage, /scan:scan-coverage, /scan:skill-hook-coverage, /scan:sprint-beta-honesty, /scan:sprint-hook-coverage, /scan:sprint-manager-consult, /scan:system, /scan:timeline, /scan:version-coherence, /scan:mc-applied-migrations, /scan:mc-capsule-resolvable, /scan:mc-install-baseline, /scan:mc-layer-diff, /scan:mc-manifest-coverage, /scan:mc-manifest-honesty, /scan:mc-migration-coverage, /scan:mc-migration-presence, /scan:mc-path-resolution, /scan:mc-ship-coverage, /scan:mc-staleness, /scan:mc-structure-parity, /scan:mc-tracked-transients, /scan:mc-version-quorum, /sleep:deep, /sprint:full, /trackers:validate, /mc:doctor, /mc:health
- `/mc:tour` → /fix:fast, /learn:deep, /maps:all, /maps:architecture, /mode:adhoc, /mode:oneshot, /mode:solo, /portfolio:list, /portfolio:open, /research:simple, /session:handoff, /session:read, /session:write, /sleep:quick, /mc:health
- `/session:end` → /beta:integrate, /beta:mine, /commit:land, /enforcement:log, /learn:deep, /learn:integrate, /mode:adhoc, /mode:sprint, /session:checkpoint, /session:dump, /session:handoff, /sleep:deep, /sleep:quick, /trackers:validate
- `/bootstrap:lastmile` → /guides:integrate, /learn:ingest, /learn:integrate, /qa:audit, /redteam:full, /research:deep, /roadmap:add, /scan:install, /scan:roadmap-trace, /sprint:design, /sprint:execute, /sprint:plan
- `/maps:all` → /maps:architecture, /maps:coverage, /maps:enforcements, /maps:hooks, /maps:memory, /maps:skills, /maps:steps, /maps:systems, /maps:tools, /scan:scan-coverage
- `/oneshot:preflight` → /mode:oneshot, /oneshot:improve, /oneshot:retro, /oneshot:start, /preflight:run, /preflight:setup, /run:sync, /scan:architecture, /scan:environment, /scan:requirements
- `/mc:reconcile` → /enforcement:log, /fix:deep, /issues:log, /portfolio:status, /roadmap:add, /scan:full, /scan:mc-staleness, /mc:flag, /mc:release, /mc:update
- `/oneshot:retro` → /issues:log, /oneshot:improve, /oneshot:preflight, /oneshot:start, /retro:code, /retro:context, /retro:full, /scan:patterns, /scan:requirements
- `/sprint:full` → /mode:oneshot, /mode:sprint, /scan:full, /scan:roadmap-trace, /sprint:design, /sprint:execute, /sprint:plan, /sprint:release, /sprint:retrospective
- `/mc:doctor` → /hooks:test, /paths:lint, /scan:architecture, /scan:full, /scan:references, /scan:requirements, /mc:health, /mc:release, /mc:update

Top called (skills others invoke the most):

- `/scan:full` ← /bootstrap:ponder, /check:all, /commit:land, /guides:coverage, /karpathy:run, /knowledge:coverage, /learn:integrate, /maps:coverage, /scan:ac-coverage, /scan:admin-suite-coverage, /scan:cutover-completeness, /scan:dispatch-routing-parity, /scan:model-chain, /scan:node-procs, /scan:panel-registry-coverage, /scan:planning-principles, /scan:regressions, /scan:roadmap-trace, /scan:scan-coverage, /scan:system, /scan:turbo-spend, /scan:version-coherence, /scan:mc-install-baseline, /scan:mc-ship-coverage, /sprint:full, /mc:doctor, /mc:reconcile
- `/sleep:deep` ← /beta:integrate, /beta:mine, /bootstrap:ponder, /learn:deep, /reasoning:score, /scan:architecture, /scan:environment, /scan:full, /scan:patterns, /scan:references, /scan:requirements, /scan:system, /session:end, /sleep:quick
- `/mc:update` ← /commit:both, /guides:write, /portfolio:sync, /scan:mc-capsule-resolvable, /scan:mc-install-baseline, /scan:mc-layer-diff, /scan:mc-manifest-coverage, /scan:mc-migration-presence, /scan:mc-staleness, /scan:mc-structure-parity, /mc:diff, /mc:doctor, /mc:reconcile, /mc:sync
- `/mc:health` ← /agents:test, /mode:adhoc, /mode:sprint, /scan:adhoc-team-hygiene, /scan:architecture, /scan:environment, /scan:full, /scan:system, /mc:doctor, /mc:setup, /mc:tour, /mc:uninstall, /mc:update
- `/sprint:full` ← /learn:deep, /mode:sprint, /roadmap:create, /scan:full, /scan:roadmap-trace, /scan:sprint-beta-honesty, /scan:sprint-hook-coverage, /scan:sprint-manager-consult, /session:turbo, /sprint:cost-gate, /sprint:design, /sprint:plan
- `/scan:requirements` ← /beta:mine, /discover:orphaned, /oneshot:preflight, /oneshot:retro, /scan:architecture, /scan:full, /session:handoff, /sleep:deep, /sleep:quick, /mc:doctor
- `/issues:log` ← /issues:list, /issues:resolve, /oneshot:retro, /scan:issues, /scan:patterns, /scan:regressions, /sleep:deep, /mc:flag, /mc:reconcile
- `/scan:references` ← /discover:systems, /maps:steps, /roadmap:cleanup, /scan:architecture, /scan:environment, /scan:full, /scan:requirements, /scan:system, /mc:doctor
- `/sprint:plan` ← /bootstrap:lastmile, /epic:plan, /epic:start, /scan:planning-principles, /session:dump, /sprint:design, /sprint:full, /sprint:release, /sprint:status
- `/fix:deep` ← /fix:fast, /issues:list, /issues:log, /reasoning:log, /reasoning:run, /scan:patterns, /sprint:execute, /mc:reconcile
