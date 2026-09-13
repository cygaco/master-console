# Karpathy Autoresearch — What It Is and What It Isn't

> Disambiguation reference. Karpathy's "autoresearch" pattern shows up in skill discussions and external comparisons; the term is often misunderstood.

## Source learning

LRN `2026-04-18` (line 117 of `paths.learningsFile`): "Karpathy autoresearch is NOT recursive self-improvement — verified primary source (Fortune 2026-03-17): 'The AI agent at the heart of autoresearch set up isn't refining its own training set up, it's a closed-loop optimisation over editable artifacts.'"

## The clarification

**Autoresearch is:**
- A closed-loop experiment runner: propose variant → evaluate → keep winner → propose variant
- The optimised "artifact" is editable text (e.g. an agent spec, a `program.md`, a skill prompt)
- The LLM is the **mutation operator** — it generates variants from the current best
- The LLM is **also** the evaluator (or a separate LLM is) — it scores variants
- Cost is bounded by the loop's wall-clock + budget cap, not by step count

**Autoresearch is NOT:**
- Recursive self-improvement (RSI). The LLM does not refine its own weights, training set, or architecture.
- A super-intelligent agent that gets smarter over time. It gets a better *artifact* over time; the LLM stays the same.
- Free of cost — every variant evaluation is an LLM call, and budget can blow up if not capped (BabyAGI's $80 overnight charge from `max_iterations` unset is the canonical example).
- A magic black box — the genuinely novel contribution is treating natural-language specs as load-bearing program-like artifacts that an LLM can edit and an LLM can evaluate.

## Primary source

Fortune, 2026-03-17 (Andrej Karpathy interview): "The AI agent at the heart of autoresearch isn't refining its own training set up, it's a closed-loop optimisation over editable artifacts. The mutation is LLM-driven; the evaluation is LLM-driven; the artifact is text."

## Why this matters for MC

The `/karpathy:run` skill in this project implements autoresearch:
- Editable artifact: an agent spec, skill, hook policy, or other markdown/code file
- Optimiser: an LLM proposes variants
- Evaluator: a scalar metric (defined per run) computed by an LLM or a deterministic test
- Termination: wall-clock cap, score-plateau detection, or budget cap

Don't oversell what `/karpathy:run` does:
- ✓ "It optimises agent prompts against a measurable score"
- ✗ "It's recursive self-improvement"
- ✗ "It makes Alex smarter"

The artifact gets better. Alex stays the same. That's still useful.

## See also

- `/karpathy:run` skill — the implementation
- LRN-2026-04-18 line 117 — the validated clarification
- LRN-2026-04-18 line 113 — wall-clock budget rule (applies to autoresearch loops)
- LRN-2026-04-18 line 114 — entropy/stddev monitoring (early-warning for mode collapse in long-running autoresearch)
