#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const POLL_INITIAL = 15;
const POLL_MAX = 60;
const MAX_TOTAL_SECONDS = 45 * 60;

const args = process.argv.slice(2);
const positional = [];
const opts = { model: "gpt-5.5-pro", effort: "xhigh", maxOutput: 32000 };
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--model") opts.model = args[++i];
  else if (args[i] === "--effort") opts.effort = args[++i];
  else if (args[i] === "--max-output") opts.maxOutput = parseInt(args[++i], 10);
  else positional.push(args[i]);
}
const [promptFile, outFile] = positional;
if (!promptFile || !outFile) {
  console.error(
    "Usage: node scripts/research/gpt-pro-consult.js <prompt-file> <out-file> [--model m] [--effort e] [--max-output n]",
  );
  process.exit(2);
}

function loadApiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const envFile = path.join(REPO_ROOT, ".env.local");
  if (!fs.existsSync(envFile)) return null;
  const raw = fs.readFileSync(envFile, "utf8").replace(/^﻿/, "");
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*OPENAI_API_KEY\s*=\s*(.+?)\s*$/);
    if (m) return m[1].replace(/^["']|["']$/g, "");
  }
  return null;
}

const apiKey = loadApiKey();
if (!apiKey) {
  console.error("OPENAI_API_KEY not set (env or .env.local)");
  process.exit(2);
}

const prompt = fs.readFileSync(promptFile, "utf8").replace(/^﻿/, "");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function logLine(s) {
  const t = new Date().toISOString().slice(11, 19);
  process.stderr.write("[" + t + "] " + s + "\n");
}

async function submit(effort) {
  const payload = {
    model: opts.model,
    input: prompt,
    background: true,
    reasoning: { effort },
    max_output_tokens: opts.maxOutput,
  };
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { error: "Invalid JSON: " + text.slice(0, 200) };
  }
  if (data.error)
    return {
      error: data.error.message || data.error.code,
      param: data.error.param,
    };
  if (!data.id) return { error: "No response ID" };
  return { id: data.id };
}

async function poll(responseId) {
  const startTime = Date.now();
  let pollInterval = POLL_INITIAL;
  while (true) {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    if (elapsed > MAX_TOTAL_SECONDS)
      return { error: "Polling timeout after " + MAX_TOTAL_SECONDS + "s" };

    const res = await fetch(
      "https://api.openai.com/v1/responses/" + responseId,
      { headers: { Authorization: "Bearer " + apiKey } },
    );
    if (res.status === 429) {
      logLine("rate limited — backing off 60s");
      await sleep(60000);
      continue;
    } else if (res.status !== 200) {
      logLine("HTTP " + res.status + " — retry in " + pollInterval + "s");
      await sleep(pollInterval * 1000);
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
      return { text, usage: data.usage, elapsed };
    } else if (["failed", "expired", "cancelled"].includes(status)) {
      const err =
        (data.error && (data.error.message || data.error.code)) || status;
      return { error: status + ": " + err };
    }
    logLine(status + " (" + elapsed + "s)");
    await sleep(pollInterval * 1000);
    if (pollInterval < POLL_MAX)
      pollInterval = Math.min(POLL_MAX, pollInterval * 2);
  }
}

(async () => {
  const start = Date.now();
  let effort = opts.effort;
  logLine("submit " + opts.model + " effort=" + effort);
  let sub = await submit(effort);
  if (sub.error && /effort|reasoning/i.test(sub.error + " " + (sub.param || "")) && effort !== "high") {
    logLine("effort '" + effort + "' rejected (" + sub.error + ") — retrying with 'high'");
    effort = "high";
    sub = await submit(effort);
  }
  if (sub.error) {
    console.log(JSON.stringify({ ok: false, model: opts.model, error: sub.error }));
    process.exit(1);
  }
  logLine("started " + sub.id);
  await sleep(15000);
  const result = await poll(sub.id);
  if (result.error) {
    console.log(JSON.stringify({ ok: false, model: opts.model, id: sub.id, error: result.error }));
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
  fs.writeFileSync(outFile, result.text);
  console.log(
    JSON.stringify({
      ok: true,
      model: opts.model,
      effort,
      chars: result.text.length,
      outFile,
      elapsedSeconds: Math.floor((Date.now() - start) / 1000),
      usage: result.usage
        ? {
            input: result.usage.input_tokens,
            output: result.usage.output_tokens,
            reasoning:
              result.usage.output_tokens_details &&
              result.usage.output_tokens_details.reasoning_tokens,
          }
        : undefined,
    }),
  );
})().catch((e) => {
  console.log(JSON.stringify({ ok: false, model: opts.model, error: e.message }));
  process.exit(1);
});
