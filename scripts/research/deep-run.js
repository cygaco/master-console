#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");

let authResolver;
try {
  authResolver = require("../dispatch/auth-resolver");
} catch {
  authResolver = {
    resolveKey(keyName, opts = {}) {
      const v = process.env[keyName];
      if (v && v.trim()) {
        const r = { key: keyName, found: true, source: "process.env", length: v.trim().length, oauth: false };
        if (opts.withValue) r.value = v.trim();
        return r;
      }
      return { key: keyName, found: false, source: null, length: 0, oauth: false };
    },
    unavailableMessage(res) {
      return `${res.key} not found — set in .env.local or as env var.`;
    },
    PROJECT_ROOT: path.resolve(__dirname, "..", ".."),
  };
}

const PROJECT_ROOT = authResolver.PROJECT_ROOT || path.resolve(__dirname, "..", "..");

function getResearchBase() {
  try {
    const pathsFile = path.join(PROJECT_ROOT, ".claude", "paths.json");
    const p = JSON.parse(fs.readFileSync(pathsFile, "utf8"));
    return path.isAbsolute(p.research)
      ? p.research
      : path.join(PROJECT_ROOT, p.research);
  } catch {
    return path.join(PROJECT_ROOT, "_docs", "research");
  }
}

function generateSlug(question) {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 40)
    .replace(/-+$/, "") || "research-" + Date.now();
}

function parseArgs(argv) {
  const args = {
    question: null,
    providers: ["openai", "gemini"],
    out: null,
    skipPhase0: false,
    help: false,
  };
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      args.help = true;
    } else if (a === "--providers" && argv[i + 1]) {
      args.providers = argv[++i].split(",").map((p) => p.trim()).filter(Boolean);
    } else if (a === "--out" && argv[i + 1]) {
      args.out = argv[++i];
    } else if (a === "--skip-phase0") {
      args.skipPhase0 = true;
    } else if (!a.startsWith("-") && args.question === null) {
      args.question = a;
    }
    i++;
  }
  return args;
}

function printHelp() {
  process.stdout.write(`
deep-run.js — Standalone OpenAI + Gemini deep research runner

USAGE
  node scripts/research/deep-run.js "<question>" [options]

OPTIONS
  --providers <list>  Comma-separated providers to run (default: openai,gemini)
                      Valid values: openai, gemini
  --out <dir>         Output directory (default: <paths.research>/<slug>)
  --skip-phase0       Skip quota probe — use when keys are pre-verified
                      (saves ~2 sub-cent probe calls)
  --help, -h          Show this help and exit 0

PHASE 0 PROBE
  Before starting any deep research job, makes a max_tokens=1 call to the
  cheapest model for each provider:
    OpenAI: gpt-4o-mini  — cost ~$0.0000002 per probe
    Gemini: gemini-1.5-flash — cost ~$0.000001 per probe
  A provider that fails with insufficient_quota or auth_failed is SKIPPED
  immediately with an actionable message, preventing a 30+ min async failure.

KEY LOADING
  Keys are resolved via auth-resolver.js full source-chain precedence:
    override key-file → process.env → .env.local → .env → ~/.gemini/.env → OAuth

OUTPUTS
  <outdir>/brief.json        Research brief (Gemini CLI or inline fallback)
  <outdir>/BRIEF.md          Human-readable research brief
  <outdir>/openai-report.md  OpenAI 4-phase assembled report
  <outdir>/gemini-report.md  Gemini deep research report
  <outdir>/manifest.json     Machine-readable run manifest (consumed by skill)

EXIT CODES
  0  At least one provider completed successfully
  1  Total failure — all providers failed or skipped, zero reports produced
`);
}

async function defaultFetch(url, opts) {
  return globalThis.fetch(url, opts);
}

function defaultSleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function defaultSpawnSync(cmd, args, opts) {
  return cp.spawnSync(cmd, args, opts);
}

function resolveOpenAIKey() {
  const r = authResolver.resolveKey("OPENAI_API_KEY", { withValue: true });
  if (!r.found || r.oauth) return null;
  return r.value || null;
}

function resolveGeminiAuth() {
  for (const keyName of ["GEMINI_API_KEY", "GOOGLE_API_KEY"]) {
    const r = authResolver.resolveKey(keyName, { withValue: true });
    if (r.found && !r.oauth && r.value) {
      return { type: "apikey", header: "x-goog-api-key", value: r.value };
    }
  }
  for (const credsPath of [
    path.join(os.homedir(), ".gemini", "oauth_creds.json"),
    path.join(os.homedir(), ".config", "gemini", "oauth_creds.json"),
  ]) {
    try {
      const creds = JSON.parse(fs.readFileSync(credsPath, "utf8"));
      if (creds.access_token && creds.expiry_date && Date.now() < creds.expiry_date) {
        return { type: "oauth", header: "Authorization", value: "Bearer " + creds.access_token };
      }
    } catch { }
  }
  return null;
}

function classifyError(status, body) {
  let parsed = null;
  try { parsed = JSON.parse(body); } catch { }
  const msg = (
    (parsed && parsed.error && (parsed.error.message || parsed.error.code || "")) ||
    (parsed && parsed.error && typeof parsed.error === "string" && parsed.error) ||
    body || ""
  ).toLowerCase();

  if (status === 200) return "ok";
  if (status === 404) return "model_unavailable";
  if (status === 401) return "auth_failed";
  if (status === 403) {
    if (msg.includes("quota") || msg.includes("resource_exhausted")) return "insufficient_quota";
    return "auth_failed";
  }
  if (status === 429) {
    const code = (parsed && parsed.error && (parsed.error.code || "")) || "";
    if (
      code === "insufficient_quota" ||
      msg.includes("insufficient_quota") ||
      msg.includes("exceeded your current quota") ||
      (msg.includes("quota") && !code.startsWith("rate_"))
    ) {
      return "insufficient_quota";
    }
    return "rate_limited";
  }
  return "unknown_error";
}

async function probeOpenAI(apiKey, fetchImpl) {
  const payload = {
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: "hi" }],
    max_tokens: 1,
  };
  try {
    const res = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const body = await res.text();
    return classifyError(res.status, body);
  } catch (e) {
    return "unknown_error";
  }
}

async function probeGemini(auth, fetchImpl) {
  const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";
  const payload = {
    contents: [{ parts: [{ text: "hi" }] }],
    generationConfig: { maxOutputTokens: 1 },
  };
  const headers = {
    "Content-Type": "application/json",
    [auth.header]: auth.value,
  };
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const body = await res.text();
    return classifyError(res.status, body);
  } catch (e) {
    return "unknown_error";
  }
}

const BRIEF_PROMPT_TEMPLATE = `You are a Research Director planning a multi-team investigation. Three autonomous research agents will execute your brief in parallel — each with different strengths:

- OpenAI o3: Deep logical chains, fault-tree analysis, mathematical reasoning.
- Gemini Deep Research: Massive context ingestion, web grounding, broad data synthesis.
- Claude: Nuanced qualitative analysis, iterative web searching, source verification.

USER'S TOPIC: {QUESTION}

Produce a research brief as a JSON object with these exact fields:
{
  "research_question": "A precise, well-scoped question",
  "phases": [
    {"name":"Landscape","objective":"Survey current state","sub_questions":["..."],"evidence_priorities":"...","stop_condition":"3+ approaches identified"},
    {"name":"Mechanics","objective":"How it works — implementation details","sub_questions":["..."],"evidence_priorities":"...","stop_condition":"2+ real implementations found"},
    {"name":"Failure Modes","objective":"What breaks — post-mortems, edge cases","sub_questions":["..."],"evidence_priorities":"...","stop_condition":"5+ failure modes documented"},
    {"name":"Contrarian","objective":"Why the premise might be wrong","sub_questions":["..."],"evidence_priorities":"...","stop_condition":"2+ counter-arguments found"}
  ],
  "search_strategy": ["8-12 search queries"],
  "exclusion_criteria": ["what NOT to research"],
  "required_output_schema": {"sections":["Executive Summary","Phase 1: Landscape","Phase 2: Mechanics","Phase 3: Failure Modes","Phase 4: Contrarian","Source Registry","Confidence Matrix"]},
  "openai_instructions": "Analytical constraints for o3 — focus on logical deduction and fault-tree analysis",
  "gemini_instructions": "Data-gathering instructions — broad search, documentation synthesis, code examples",
  "claude_instructions": "Verification instructions — contrarian angle, cross-source validation, qualitative trade-offs"
}

Write ONLY the JSON — no preamble, no markdown fences, no commentary.`;

function defaultBrief(question) {
  const slug = generateSlug(question);
  return {
    research_question: question,
    phases: [
      { name: "Landscape", objective: "Survey the current state — what exists, who are the key players, what approaches are in use", sub_questions: [question + " current state"], evidence_priorities: "Authoritative sources, surveys, comparisons", stop_condition: "3+ distinct approaches identified" },
      { name: "Mechanics", objective: "How does it actually work — implementation details, code patterns", sub_questions: [question + " implementation"], evidence_priorities: "Code examples, technical docs, engineering blogs", stop_condition: "2+ real implementations found" },
      { name: "Failure Modes", objective: "What breaks — post-mortems, edge cases, limitations", sub_questions: [question + " failure modes limitations"], evidence_priorities: "Post-mortems, incident reports, known issues", stop_condition: "5+ failure modes documented" },
      { name: "Contrarian", objective: "Why the premise might be wrong — alternatives and criticisms", sub_questions: ["Arguments against " + question], evidence_priorities: "Critical analyses, alternative approaches", stop_condition: "2+ counter-arguments found" },
    ],
    search_strategy: [question, question + " implementation", question + " failure modes", question + " alternatives", question + " best practices", question + " limitations", question + " 2024 2025"],
    exclusion_criteria: [],
    required_output_schema: { sections: ["Executive Summary", "Phase 1: Landscape", "Phase 2: Mechanics", "Phase 3: Failure Modes", "Phase 4: Contrarian", "Source Registry", "Confidence Matrix"] },
    openai_instructions: "Focus on analytical depth, logical deduction, and fault-tree analysis for: " + question,
    gemini_instructions: "Focus on broad data gathering, documentation synthesis, and code examples for: " + question,
    claude_instructions: "Focus on source verification, contrarian analysis, and cross-source validation for: " + question,
  };
}

function generateBriefWithCLI(question, tmpDir, spawnSyncImpl) {
  const promptFile = path.join(tmpDir, "brief-prompt.txt");
  const promptText = BRIEF_PROMPT_TEMPLATE.replace("{QUESTION}", question);
  fs.writeFileSync(promptFile, promptText);

  const result = spawnSyncImpl("gemini", ["-m", "gemini-2.5-flash", "-p", "Generate the research brief JSON from the instructions provided on stdin", "-o", "text"], {
    input: promptText,
    encoding: "utf8",
    timeout: 120000,
    env: process.env,
  });

  if (!result || result.error || result.status !== 0 || !result.stdout) return null;

  const stdout = result.stdout.trim();
  const jsonText = stdout.replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "").trim();
  try {
    const parsed = JSON.parse(jsonText);
    if (parsed && parsed.research_question && Array.isArray(parsed.phases)) return parsed;
  } catch { }
  return null;
}

const OAI_MODELS = ["o3-deep-research", "o4-mini-deep-research"];
const OAI_MAX_PHASE_MS = 15 * 60 * 1000;
const OAI_COOLDOWN_MS = 90 * 1000;
const OAI_FIRST_POLL_MS = 15 * 1000;
const OAI_POLL_INITIAL_MS = 15 * 1000;
const OAI_POLL_MAX_MS = 60 * 1000;
const PHASE_NAMES = ["Landscape", "Mechanics", "Failure-Modes", "Contrarian"];

function buildPhaseInput(brief, phaseIdx) {
  const p = brief.phases[phaseIdx];
  const prevPhases = brief.phases
    .slice(0, phaseIdx)
    .map((x) => "(Already researched) " + x.name + ": " + x.objective)
    .join("\n");
  return (
    brief.research_question +
    "\n\n" + brief.openai_instructions +
    "\n\nFocus on this specific research phase:\n" +
    p.name + ": " + p.objective +
    "\n  Questions: " + p.sub_questions.join("; ") +
    "\n  Evidence priorities: " + p.evidence_priorities +
    "\n  Stop when: " + p.stop_condition +
    (prevPhases ? "\n\nContext from prior phases:\n" + prevPhases : "") +
    "\n\nWrite a structured markdown report for this phase only. Include findings with claims, evidence, confidence levels, and source URLs."
  );
}

async function submitOAIPhase(model, brief, phaseIdx, apiKey, fetchImpl) {
  const input = buildPhaseInput(brief, phaseIdx);
  const payload = { model, input, background: true, max_tool_calls: 12, tools: [{ type: "web_search_preview" }] };
  const res = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { return { error: "invalid JSON: " + text.slice(0, 200) }; }
  if (data.error) return { error: data.error.message || data.error.code };
  if (!data.id) return { error: "no response ID" };
  return { id: data.id };
}

async function pollOAIPhase(responseId, phaseName, apiKey, fetchImpl, sleepImpl, log) {
  const deadline = Date.now() + OAI_MAX_PHASE_MS;
  let interval = OAI_POLL_INITIAL_MS;

  await sleepImpl(OAI_FIRST_POLL_MS);

  while (true) {
    if (Date.now() > deadline) return { error: "timeout after " + (OAI_MAX_PHASE_MS / 1000) + "s" };

    const res = await fetchImpl("https://api.openai.com/v1/responses/" + responseId, {
      headers: { Authorization: "Bearer " + apiKey },
    });

    if (res.status === 429) {
      log("[openai] rate limited — backing off 60s");
      await sleepImpl(60000);
      continue;
    } else if (res.status !== 200) {
      await sleepImpl(interval);
      continue;
    }

    const data = await res.json();
    const status = data.status || "unknown";

    if (status === "completed") {
      let text = "";
      for (const item of data.output || []) {
        if (item.type === "message") {
          for (const c of item.content || []) {
            if (c.type === "output_text") text += c.text + "\n";
          }
        }
      }
      return { text };
    } else if (status === "failed" || status === "expired" || status === "cancelled") {
      const err = (data.error && (data.error.message || data.error.code)) || status;
      return { error: status + ": " + err };
    }

    log("[openai] " + phaseName + ": " + status + " (" + Math.floor((OAI_MAX_PHASE_MS - (deadline - Date.now())) / 1000) + "s)");
    await sleepImpl(interval);
    if (interval < OAI_POLL_MAX_MS) interval = Math.min(OAI_POLL_MAX_MS, interval * 2);
  }
}

async function runOpenAI(brief, outdir, apiKey, fetchImpl, sleepImpl, log) {
  const tmpDir = path.join(outdir, ".tmp");
  fs.mkdirSync(tmpDir, { recursive: true });

  for (const model of OAI_MODELS) {
    log("[openai] starting 4-phase run with " + model);
    let modelOk = true;

    for (let i = 0; i < 4; i++) {
      const phaseName = PHASE_NAMES[i];
      log("[openai] phase " + (i + 1) + "/4: " + phaseName + "...");

      const sub = await submitOAIPhase(model, brief, i, apiKey, fetchImpl);
      if (sub.error) {
        log("[openai] " + phaseName + " submit failed: " + sub.error);
        modelOk = false;
        break;
      }
      log("[openai] " + phaseName + " started: " + sub.id);

      const result = await pollOAIPhase(sub.id, phaseName, apiKey, fetchImpl, sleepImpl, log);
      if (result.error) {
        log("[openai] " + phaseName + " failed: " + result.error);
        modelOk = false;
        break;
      }

      fs.writeFileSync(path.join(tmpDir, "openai-phase-" + i + ".md"), result.text);
      log("[openai] " + phaseName + " complete (" + result.text.length + " chars)");

      if (i < 3) {
        log("[openai] waiting 90s TPM cooldown...");
        await sleepImpl(OAI_COOLDOWN_MS);
      }
    }

    if (!modelOk) continue;

    const phases = [];
    for (let i = 0; i < 4; i++) {
      const f = path.join(tmpDir, "openai-phase-" + i + ".md");
      if (fs.existsSync(f)) {
        const content = fs.readFileSync(f, "utf8").trim();
        if (content) phases.push(content);
      }
    }
    fs.writeFileSync(path.join(outdir, "openai-report.md"), phases.join("\n\n---\n\n"));
    log("[openai] report assembled from " + phases.length + " phases");
    return { status: "completed", model, phases_completed: phases.length };
  }

  return { status: "failed", error: "both models failed" };
}

const GEMINI_MAX_MS = 45 * 60 * 1000;
const GEMINI_FIRST_POLL_MS = 15 * 1000;
const GEMINI_POLL_INITIAL_MS = 15 * 1000;
const GEMINI_POLL_MAX_MS = 60 * 1000;

async function runGemini(brief, outdir, auth, fetchImpl, sleepImpl, log) {
  const tmpDir = path.join(outdir, ".tmp");
  fs.mkdirSync(tmpDir, { recursive: true });

  const phasesText = brief.phases
    .map((p) => p.name + ": " + p.objective + "\n  Questions: " + p.sub_questions.join("; ") + "\n  Evidence: " + p.evidence_priorities + "\n  Stop when: " + p.stop_condition)
    .join("\n\n");

  const payload = {
    input: brief.research_question + "\n\n" + brief.gemini_instructions + "\n\nResearch Phases:\n" + phasesText + "\n\nOutput format: " + JSON.stringify(brief.required_output_schema),
    agent: "deep-research-pro-preview-12-2025",
    background: true,
    store: true,
  };

  const authHeaderKey = auth.header;
  const authHeaderVal = auth.value;

  log("[gemini] submitting interaction...");
  const submitRes = await fetchImpl("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { [authHeaderKey]: authHeaderVal, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const submitText = await submitRes.text();
  let submitData;
  try { submitData = JSON.parse(submitText); } catch {
    log("[gemini] invalid submit response: " + submitText.slice(0, 300));
    return { status: "failed", error: "invalid submit response" };
  }

  if (!submitData.id) {
    log("[gemini] failed to create interaction: " + submitText.slice(0, 500));
    return { status: "failed", error: "no interaction ID" };
  }

  const interactionId = submitData.id;
  log("[gemini] started: " + interactionId);

  const sessionPath = path.join(outdir, ".session.json");
  let session = {};
  try { session = JSON.parse(fs.readFileSync(sessionPath, "utf8")); } catch { }
  session.gemini_id = interactionId;
  fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2));

  const deadline = Date.now() + GEMINI_MAX_MS;
  let interval = GEMINI_POLL_INITIAL_MS;

  await sleepImpl(GEMINI_FIRST_POLL_MS);

  while (true) {
    if (Date.now() > deadline) {
      log("[gemini] polling timeout after " + (GEMINI_MAX_MS / 1000 / 60) + " min");
      return { status: "failed", error: "polling timeout" };
    }

    const res = await fetchImpl("https://generativelanguage.googleapis.com/v1beta/interactions/" + interactionId, {
      headers: { [authHeaderKey]: authHeaderVal },
    });

    if (res.status === 429) {
      log("[gemini] rate limited — backing off 60s");
      await sleepImpl(60000);
      continue;
    } else if (res.status !== 200) {
      await sleepImpl(interval);
      continue;
    }

    const data = await res.json();
    const status = data.status || "unknown";

    if (status === "completed") {
      const outputs = data.outputs || [];
      const last = outputs[outputs.length - 1];
      const text = (last && last.text) || "";
      fs.writeFileSync(path.join(outdir, "gemini-report.md"), text);
      log("[gemini] complete (" + text.length + " chars)");
      return { status: "completed" };
    } else if (status === "failed" || status === "cancelled") {
      log("[gemini] failed: " + status);
      return { status: "failed", error: status };
    }

    const elapsed = Math.floor((GEMINI_MAX_MS - (deadline - Date.now())) / 1000);
    log("[gemini] " + status + " (" + elapsed + "s)");
    await sleepImpl(interval);
    if (interval < GEMINI_POLL_MAX_MS) interval = Math.min(GEMINI_POLL_MAX_MS, interval * 2);
  }
}

function writeManifest(outdir, slug, data) {
  const manifest = {
    schema: "deep-research-manifest/1",
    slug,
    outdir,
    brief: path.join(outdir, "brief.json"),
    BRIEF: path.join(outdir, "BRIEF.md"),
    openai: data.openai || { status: "skipped" },
    gemini: data.gemini || { status: "skipped" },
    providers_used: data.providers_used || [],
    providers_skipped: data.providers_skipped || [],
    timestamp: data.timestamp || new Date().toISOString(),
  };
  if (data.openai && data.openai.status === "completed") {
    manifest.openai.report = path.join(outdir, "openai-report.md");
  }
  if (data.gemini && data.gemini.status === "completed") {
    manifest.gemini.report = path.join(outdir, "gemini-report.md");
  }
  fs.writeFileSync(path.join(outdir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}

function createRunner(opts = {}) {
  const fetchImpl = opts.fetch || defaultFetch;
  const sleepImpl = opts.sleep || defaultSleep;
  const spawnSyncImpl = opts.spawnSync || defaultSpawnSync;

  function log(msg) {
    const t = new Date().toISOString().slice(11, 19);
    process.stdout.write("[" + t + "] " + msg + "\n");
  }

  async function run(question, runArgs = {}) {
    const providers = runArgs.providers || ["openai", "gemini"];
    const skipPhase0 = runArgs.skipPhase0 || false;
    const slug = generateSlug(question);
    const timestamp = new Date().toISOString();

    const outdir = runArgs.out
      ? path.resolve(runArgs.out)
      : path.join(getResearchBase(), slug);
    fs.mkdirSync(path.join(outdir, ".tmp"), { recursive: true });

    log("[deep-run] question: " + question);
    log("[deep-run] slug: " + slug);
    log("[deep-run] outdir: " + outdir);
    log("[deep-run] providers: " + providers.join(", "));

    const openaiKey = providers.includes("openai") ? resolveOpenAIKey() : null;
    const geminiAuth = providers.includes("gemini") ? resolveGeminiAuth() : null;

    const providersSkipped = [];
    const providersOk = [];

    if (providers.includes("openai")) {
      if (!openaiKey) {
        log("[phase0] openai: SKIPPED — OPENAI_API_KEY not found");
        providersSkipped.push({ provider: "openai", reason: "OPENAI_API_KEY not found — set in .env.local or pass --providers gemini" });
      } else {
        providersOk.push("openai");
      }
    }
    if (providers.includes("gemini")) {
      if (!geminiAuth) {
        log("[phase0] gemini: SKIPPED — no Gemini auth (set GEMINI_API_KEY in .env.local, or run gemini auth login)");
        providersSkipped.push({ provider: "gemini", reason: "no Gemini auth — set GEMINI_API_KEY in .env.local or run 'gemini auth login'" });
      } else {
        providersOk.push("gemini");
      }
    }

    if (!skipPhase0) {
      log("[phase0] probing providers: " + providersOk.join(", "));

      const finalOk = [];
      for (const provider of providersOk) {
        if (provider === "openai") {
          const result = await probeOpenAI(openaiKey, fetchImpl);
          if (result === "ok" || result === "rate_limited") {
            log("[phase0] openai: " + result + " — proceeding");
            finalOk.push("openai");
          } else {
            const msg = result === "insufficient_quota"
              ? "openai: insufficient_quota — top up credits at platform.openai.com/account/billing or pass --providers gemini"
              : result === "auth_failed"
                ? "openai: auth_failed — check OPENAI_API_KEY at platform.openai.com/api-keys"
                : "openai: " + result + " — skipping";
            log("[phase0] " + msg);
            providersSkipped.push({ provider: "openai", reason: msg });
          }
        } else if (provider === "gemini") {
          const result = await probeGemini(geminiAuth, fetchImpl);
          if (result === "ok" || result === "rate_limited") {
            log("[phase0] gemini: " + result + " — proceeding");
            finalOk.push("gemini");
          } else {
            const msg = result === "insufficient_quota"
              ? "gemini: insufficient_quota — check quota at console.cloud.google.com or pass --providers openai"
              : result === "auth_failed"
                ? "gemini: auth_failed — check GEMINI_API_KEY or run 'gemini auth login'"
                : "gemini: " + result + " — skipping";
            log("[phase0] " + msg);
            providersSkipped.push({ provider: "gemini", reason: msg });
          }
        }
      }

      providersOk.length = 0;
      providersOk.push(...finalOk);
    }

    if (providersOk.length === 0) {
      const messages = providersSkipped.map((s) => "  • " + s.reason).join("\n");
      throw new Error("All providers skipped — nothing to run.\n" + messages);
    }

    log("[phase1] generating research brief...");
    let brief = generateBriefWithCLI(question, path.join(outdir, ".tmp"), spawnSyncImpl);
    if (!brief) {
      log("[phase1] Gemini CLI unavailable — using inline brief fallback");
      brief = defaultBrief(question);
    } else {
      log("[phase1] brief generated via Gemini CLI");
    }

    fs.writeFileSync(path.join(outdir, "brief.json"), JSON.stringify(brief, null, 2));
    const briefMd = [
      "# Research Brief: " + (brief.research_question || question),
      "",
      "**Date:** " + timestamp.slice(0, 10),
      "**Original query:** " + question,
      "",
      "## Research Question",
      brief.research_question || question,
      "",
      "## Research Phases",
      ...(brief.phases || []).map((p) => "### " + p.name + "\n" + p.objective + "\n\n**Stop when:** " + p.stop_condition),
      "",
      "## Search Strategy",
      (brief.search_strategy || []).map((q) => "- " + q).join("\n"),
    ].join("\n");
    fs.writeFileSync(path.join(outdir, "BRIEF.md"), briefMd);
    log("[phase1] brief saved to " + path.join(outdir, "brief.json"));

    const oaiResult = { status: "skipped" };
    const gemResult = { status: "skipped" };

    if (providersOk.includes("openai")) {
      try {
        const r = await runOpenAI(brief, outdir, openaiKey, fetchImpl, sleepImpl, log);
        Object.assign(oaiResult, r);
      } catch (e) {
        oaiResult.status = "failed";
        oaiResult.error = e.message;
        log("[openai] fatal: " + e.message);
      }
    }

    if (providersOk.includes("gemini")) {
      try {
        const r = await runGemini(brief, outdir, geminiAuth, fetchImpl, sleepImpl, log);
        Object.assign(gemResult, r);
      } catch (e) {
        gemResult.status = "failed";
        gemResult.error = e.message;
        log("[gemini] fatal: " + e.message);
      }
    }

    const providersUsed = [];
    if (oaiResult.status === "completed") providersUsed.push("openai");
    if (gemResult.status === "completed") providersUsed.push("gemini");

    const manifest = writeManifest(outdir, slug, {
      openai: oaiResult,
      gemini: gemResult,
      providers_used: providersUsed,
      providers_skipped: providersSkipped,
      timestamp,
    });

    log("[deep-run] manifest written: " + path.join(outdir, "manifest.json"));
    log("[deep-run] providers_used: " + (providersUsed.join(", ") || "none"));

    const reportsCount = providersUsed.length;
    if (reportsCount === 0) {
      throw new Error(
        "All providers failed — zero reports produced.\n" +
        [oaiResult.error && "  openai: " + oaiResult.error, gemResult.error && "  gemini: " + gemResult.error]
          .filter(Boolean).join("\n")
      );
    }

    log("[deep-run] COMPLETE — " + reportsCount + " report(s) in " + outdir);
    return { manifest, providers_used: providersUsed, providers_skipped: providersSkipped };
  }

  return { run };
}

module.exports = { createRunner, generateSlug, classifyError, defaultBrief };

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (!args.question) {
    process.stderr.write("error: question is required.\n\nRun with --help for usage.\n");
    process.exit(1);
  }

  createRunner()
    .run(args.question, args)
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      process.stderr.write("fatal: " + err.message + "\n");
      process.exit(1);
    });
}
