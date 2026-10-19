# Reasoning Frameworks — Master Reference

This is the routing table for Alex's reasoning engine. When facing a problem, classify it first, then select a framework from this table.

## Framework Router

| Problem Signal | Framework | Redirect | Domain |
|---------------|-----------|----------|--------|
| Clear error + file:line, no history | Direct Investigation | `/fix:fast` | Bug |
| "It used to work" / regression | Binary Search (git bisect) | `/fix:deep` | Bug |
| HTTP/API error, timeout | Trace Analysis | `/fix:deep` | Bug |
| Intermittent / race condition | Fault Tree Analysis | `/fix:deep` | Bug |
| Recurring (found in memory) | Root Cause Analysis | `/fix:deep` | Bug |
| "Works on my machine" / env-specific | Differential Diagnosis | `/fix:deep` | Bug |
| Agent hang / orphan / infinite loop | Agentic System Protocol | `/fix:deep` | Bug |
| Wrong behavior (not error) | 5 Whys | `/fix:deep` | Bug |
| Vague / "something is wrong" | Differential Diagnosis | `/fix:deep` | Bug |
| Feature design / "what to build" | JTBD + Second-Order Thinking | `/reasoning:run` | Product |
| Screen bloat / confusing flow | Mental Model Preservation | `/reasoning:run` | UX |
| Priority decision / "what first" | Eisenhower Matrix | `/reasoning:run` | Decision |
| Strategic assessment / tradeoffs | SWOT | `/reasoning:run` | Strategy |
| Code architecture / structure | Design Patterns + SOLID | `/reasoning:run` | Code |
| Performance concern / scaling | Big O + benchmarks | `/reasoning:run` | Code |
| Communication / report structure | Pyramid Principle | `/reasoning:run` | Output |
| Fix attempt failed (quality 0-1) | Reflexion (reflect → retry) | `/fix:deep` | Bug |
| Predictable multi-tool pipeline | ReWOO (plan-all-then-execute) | — | Efficiency |
| Complex coding, algorithm design | LATS (tree search + backtrack) | `/fix:deep` | Bug |
| Multi-step task (5+ steps) | Plan-and-Execute | — | Orchestration |
| Continuous system monitoring | OODA Loop (Observe-Orient-Decide-Act) | — | Operations |
| Need to verify/improve output | Self-Consistency (vote across N paths) | — | Quality |
| Stuck / can't see the problem | Rubber Duck (narrate logic) | — | Meta |

---

## Framework Definitions

### Bug Diagnosis Frameworks

**Direct Investigation**
- Purpose: Trace a clear error to its source
- When: Error with file path and line number, no prior occurrences
- Key question: Where does the data/logic first go wrong?
- Failure mode: Patching the symptom location instead of tracing to root cause

**Binary Search (git bisect)**
- Purpose: Find the exact commit that introduced a regression
- When: "It used to work" or "broke after update"
- Key question: Which change introduced the failure?
- Failure mode: Testing too many commits manually instead of bisecting

**Trace Analysis**
- Purpose: Follow a request through system layers to find where it breaks
- When: HTTP errors, API failures, timeouts, build/deploy pipeline failures
- Key question: At which layer does the data first go wrong?
- Failure mode: Blaming the last layer (API response) instead of tracing from the first (request formation)

**Fault Tree Analysis**
- Purpose: Map all possible causes with AND/OR gates to identify the minimal cut set
- When: Intermittent bugs, race conditions, "sometimes works"
- Key question: What combination of conditions produces this failure?
- Failure mode: Testing one cause at a time instead of mapping the full tree

**Root Cause Analysis (RCA)**
- Purpose: Find the deepest cause that, if fixed, prevents all symptoms
- When: Recurring bugs, issues found in learnings or bug registry
- Key question: Why does this keep happening?
- Failure mode: Fixing a contributing factor instead of the root cause

**Differential Diagnosis**
- Purpose: Systematically eliminate possible causes by comparing environments
- When: "Works on my machine", environment-specific bugs, vague symptoms
- Key question: What differs between the working and broken environments?
- Failure mode: Guessing instead of systematically comparing variables

**5 Whys**
- Purpose: Drill from visible symptom to underlying cause through repeated questioning
- When: Wrong behavior (not crash), spec mismatch, feature does wrong thing
- Key question: Why does [X] happen? (asked 5 times)
- Failure mode: Stopping at the first or second "why" — surface-level answer

**Agentic System Protocol**
- Purpose: Diagnose agent-specific failures (hangs, orphans, loops)
- When: Agent produces no output, hangs indefinitely, or creates orphan processes
- Key question: Is this a process issue (PID/lock), a resource issue (rate limit/timeout), or a logic issue (infinite loop)?
- Failure mode: Restarting the agent without diagnosing why it failed

### Advanced Reasoning Frameworks

**Reflexion (Reflect → Retry)**
- Purpose: When a fix attempt fails, generate a verbal reflection on WHY before retrying — store lessons, not raw attempts
- When: Fix quality scored 0-1, test still failing after first attempt, agent made wrong diagnosis
- Key question: Why did my last attempt fail, and what should I do differently?
- Process: Act → Evaluate → Reflect (verbal critique) → Store reflection in memory → Retry with reflection context
- Evidence: Doubles coding success rates (48%→95% on GPT-3.5 benchmarks). ICML-adjacent research.
- Failure mode: Reflecting on symptoms instead of root cause; over-reflecting without acting
- Constraint: Max 3 reflection cycles — diminishing returns after that

**ReWOO (Reasoning Without Observation)**
- Purpose: For predictable multi-tool chains, plan ALL tool calls upfront with placeholder variables, execute sequentially, synthesize once at end
- When: Research pipeline (polled API → analysis), document generation, any flow where tool sequence is known in advance
- Key question: Can I predict the full tool chain before starting?
- Process: Plan with placeholders (#E1, #E2) → Execute all tools → Single LLM synthesis pass
- Evidence: Most token-efficient agentic pattern — saves 50%+ tokens vs ReAct by eliminating mid-chain LLM calls
- Failure mode: Unexpected tool output breaks downstream placeholders; only works for predictable chains
- Constraint: NOT suitable for exploratory/debugging tasks where next step depends on previous result

**LATS (Language Agent Tree Search)**
- Purpose: MCTS + ReAct with backtracking — explore multiple solution paths, use code execution as environment feedback, backtrack on failure
- When: Complex algorithm design, hard debugging where simpler frameworks failed, competitive-level coding problems
- Key question: Are there multiple viable approaches worth exploring in parallel?
- Process: Generate candidate actions → Simulate (execute code) → Evaluate with UCB1 → Expand best node OR backtrack
- Evidence: 92.7% pass@1 on HumanEval (ICML 2024). Strictly dominates ToT for coding tasks.
- Failure mode: Combinatorial explosion if branching factor too high; 5-10x token cost
- Constraint: Gate behind failure of simpler methods. Only deploy when Direct Investigation and Reflexion have already failed.

**Plan-and-Execute**
- Purpose: Separate planning from execution — powerful model plans, cheaper model executes each step
- When: Multi-step tasks (5+ steps), long workflows, tasks that benefit from upfront structure
- Key question: Can I decompose this into numbered steps before starting?
- Process: Planning LLM creates step list → Executor LLM handles each step → Replan if step fails
- Evidence: 92% accuracy vs 85% for ReAct on complex tasks. Model heterogeneity saves 60-80% cost.
- Failure mode: Initial plan is wrong and executor follows it blindly; replanning is expensive
- Constraint: Use powerful model (Opus/Sonnet) for planning, cheap model (Haiku) for execution

**OODA Loop (Observe-Orient-Decide-Act)**
- Purpose: Structured continuous feedback cycle for ongoing operations and monitoring
- When: Iterative development cycles, continuous system monitoring, agent orchestration loops
- Key question: Has my understanding of the situation changed since my last action?
- Process: Observe (gather data) → Orient (update mental model, check assumptions) → Decide (select action) → Act (execute) → repeat
- Evidence: Military-origin framework.
- Failure mode: Analysis paralysis in Orient phase; acting without sufficient observation
- Constraint: Already implicit in our operational loop (CLAUDE.md) — use explicitly when the implicit version isn't working

**Self-Consistency (Majority Voting)**
- Purpose: Generate N independent reasoning paths, take the majority answer — reduces variance and catches hallucinations
- When: High-stakes decisions where confidence matters, verifying a surprising result, reducing hallucination risk
- Key question: Do multiple independent approaches converge on the same answer?
- Process: Generate N (typically 3-5) independent solutions → Compare → Take majority or flag disagreement
- Evidence: Significantly reduces variance (ReasonBench). Catches single-path hallucinations. 3x cost for substantial reliability gain.
- Failure mode: All N paths share the same blind spot (systematic bias); cost scales linearly with N
- Constraint: Use for verification, not as default — 3x cost is only justified for high-stakes decisions

### Operational Constraints (Apply to ALL Frameworks)

**Lusser's Law** — 85% per-step accuracy = 20% success over 10 steps (0.85^10 = 0.197). Every added step must demonstrably improve outcomes. Prefer parallel/voting over deep sequential chains.

**Hard Caps** — Non-negotiable for all agent tasks: max iterations (25), token budget (100K), cost circuit breaker ($5), loop detection (repeated action = halt).

**Context Engineering** — Matters more than framework choice. Full history (<5 steps), sliding window (5-15 steps), summarization (15+ steps). Critical info at start AND end of context.

**Accretion against a global bound** — the failure class where EACH ADDITION IS LOCALLY CORRECT, THE CONSTRAINT IS GLOBAL, and nothing ever re-evaluates the whole against the ceiling: briefs vs a size floor, context windows, dependency lists, acceptance criteria. The fix is an explicit **allocation step at every append** — "what does the *whole* now cost against the bound?" — not a review at the end. **Humility corollary:** a blunt prohibition written to prevent a defect can be WORSE than the defect-aware design a builder finds. When that happens, re-narrow the rule to match reality instead of holding the prohibition.

**Confirmation is not coverage** — the verification discipline for any control you build (a fix often closes a class and re-opens it one layer out). Watching a control fire tells you what it CATCHES. It tells you nothing about what it SILENTLY SKIPS, and the fix-quality score of a control verified only by a positive demonstration is capped at 2 — a working instance, not a closed class. Five clauses:

1. **Enumerate the near-misses before claiming the class.** After observing a catch, the next step is a battery of inputs that *resemble* the protected shape and fail the exact predicate — variant dashes, colons, indentation, spacing, casing, alternate scripts. A claim-bind verified only by watching it catch a real unannounced edit can still skip en-dash, hyphen, colon and indented lead-ins. A sample proves a class OPEN, never CLOSED.
2. **Skip is fail-open; refuse is fail-closed.** Any derivation over authored text must REFUSE what it cannot classify, never continue past it — a near-miss is a violation until proven benign. A skip silently narrows the population and the gate then reports success over the narrowed set.
3. **Match the claim's grain to the mechanism's grain.** A coverage claim stated one granularity coarser than the mechanism actually has is its own recurring defect: a claim that a fix covers whole scripts, backed by a letter-level sample, asserts a script-level closure the sample never tested. State the unit actually enumerated — letters, prefix shapes, paragraph keys — never "scripts" / "all" / "the class", and never a COUNT, which is a property of the day it was read.
4. **Binding a claim byte-for-byte makes it un-editable, not true.** A byte-bind is an integrity control, not a truth control: if the bound text is false, the bind now ENFORCES the falsehood and an honest correction turns the gate red. Corollary for the author: treat the claim text and its canonical copy as ONE atomic edit owned by ONE bundle, so correcting a bound claim never needs a second commit to make the gate green.
5. **A comment stating an invariant is not an enforcer of it.** A code comment saying two comparison sites "must share one transform" does not stop the transform being applied to one site while the missing fold is implemented BESIDE the other; nothing detects the divergence. If the invariant matters, the divergence must be self-detecting (a shared call site, a test that fails on the fork, a lint), not narrated.

**Text matchers cannot tell a violation from a description of one** — the companion trap when clause 2's enforcer is a text scan. Any prose written ABOUT a banned pattern trips the ban: a bundle can refuse the very document it is editing by quoting the adjacency it documents, or turn the tree RED by naming the banned primitive in prose. Document the trap **in the scanner's own header** so the next author writing about the ban rediscovers it from the code rather than from a red gate, and prefer a structural anchor over a bare literal where one exists.

### Product & UX Frameworks

**Jobs-to-Be-Done (JTBD)**
- Purpose: Determine what job the user hires a feature/screen to do
- When: Designing features, simplifying screens, deciding what's necessary vs clutter
- Key question: What must this help the user accomplish?
- Failure mode: Designing for "what can this contain?" instead of "what must this do?"

**Mental Model Preservation**
- Purpose: Keep the user's internal understanding of how the system works intact
- When: Designing flows, changing navigation, transitioning between states
- Key question: What does the user think is happening here?
- Failure mode: Technically correct UX that breaks the user's intuitive model

### Decision Frameworks

**Second-Order Thinking**
- Purpose: Consider downstream consequences beyond the immediate effect
- When: Making product decisions, shipping quick fixes, choosing shortcuts
- Key question: What happens next because of this?
- Failure mode: Optimizing for now at the cost of the future

**Eisenhower Matrix**
- Purpose: Sort work by urgency and importance
- When: Triaging issues, planning work, multiple competing priorities
- Quadrants: Urgent+Important, Important+Not Urgent, Urgent+Not Important, Neither
- Failure mode: Reacting only to urgency, ignoring non-urgent important work

### Strategy Frameworks

**SWOT Analysis**
- Purpose: Evaluate strengths, weaknesses, opportunities, threats
- When: Planning product direction, choosing between approaches, assessing initiatives
- Key question: What are the internal positives/negatives and external opportunities/threats?
- Failure mode: Conflating internal weaknesses with external threats

### Code Quality Frameworks

**Design Patterns (Factory, Observer, etc.)**
- Purpose: Apply proven structural solutions to recurring software problems
- When: Code structure decisions, plugin systems, event-driven architecture
- Key question: Is this a creation problem, a communication problem, or a composition problem?
- Failure mode: Forcing a pattern where none is needed (premature abstraction)

**SOLID Principles**
- Purpose: Guide maintainable, extensible code structure
- When: Assessing architecture, refactoring, planning extensible code
- Key question: Can each piece change independently without breaking others?
- Failure mode: Over-engineering for hypothetical future requirements

**Big O Notation**
- Purpose: Evaluate algorithmic efficiency and scaling behavior
- When: Performance concerns, comparing implementations, scaling risk
- Key question: How does this behave as input grows?
- Failure mode: Premature optimization of code that runs once

### Communication Frameworks

**Pyramid Principle**
- Purpose: Structure communication top-down — answer first, support second
- When: Writing summaries, reports, architecture decisions, explanations
- Structure: Main conclusion → Supporting points → Evidence/details
- Failure mode: Burying the answer in the middle of a long explanation

### Meta Framework

**Rubber Duck Debugging**
- Purpose: Surface hidden assumptions by explaining logic step by step
- When: Stuck, code "seems fine" but isn't, need to slow down
- Key question: Can I explain each step in plain terms?
- Failure mode: Glossing over the step where the bug actually lives
