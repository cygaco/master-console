#!/usr/bin/env node
"use strict";

const { harness } = require("./lib/fixture-harness");
const { evaluate, scanText } = require("./provider-api-policy");

const h = harness("provider-api-policy");

const ALLOWLIST = [{ path: "scripts/research/openai-deep-research.js", reason: "deep-research no-CLI" }];

const RAW_API_SRC = [
  "const OpenAI = require('openai');",
  "const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });",
  "const r = await client.responses.create({ model: 'gpt-5', input });",
  "await fetch('https://api.openai.com/v1/responses', { method: 'POST' });",
].join("\n");

const CLEAN_SRC = [
  "const { exec } = require('child_process');",
  "exec('node scripts/dispatch-agent.js security-reviewer prompt.txt');",
  "const data = await fetch('https://example.com/data.json');",
].join("\n");

h.pass("a file that routes via the CLI wrapper (no provider host) passes", () =>
  evaluate({ files: [{ path: "scripts/dispatch/some-router.js", text: CLEAN_SRC }], allowlist: ALLOWLIST }));

h.violation("a raw api.openai.com call OUTSIDE the allowlist is flagged", () =>
  evaluate({ files: [{ path: "scripts/agents/rogue-reviewer.js", text: RAW_API_SRC }], allowlist: ALLOWLIST }));

h.pass("the same raw call inside an allowlisted file is suppressed", () =>
  evaluate({ files: [{ path: "scripts/research/openai-deep-research.js", text: RAW_API_SRC }], allowlist: ALLOWLIST }));

h.violation("a generativelanguage.googleapis.com host literal outside the allowlist is flagged", () =>
  evaluate({
    files: [{ path: "scripts/agents/rogue-gemini.js", text: "fetch('https://generativelanguage.googleapis.com/v1beta/models')" }],
    allowlist: ALLOWLIST,
  }));

h.pass("an ordinary fetch() to a non-provider URL is not a violation", () =>
  evaluate({ files: [{ path: "scripts/util/fetcher.js", text: "await fetch('https://example.com/x');" }], allowlist: ALLOWLIST }));

h.test("scanText flags a bare chat.completions SDK call shape", () => {
  const hits = scanText("await openai.chat.completions.create({});");
  if (hits.length !== 1 || !/chat\.completions/.test(hits[0].signature)) throw new Error(JSON.stringify(hits));
});

h.test("an allowlist entry that matched no hit is surfaced as stale", () => {
  const res = evaluate({
    files: [{ path: "scripts/clean.js", text: CLEAN_SRC }],
    allowlist: [{ path: "scripts/research/openai-deep-research.js", reason: "x" }],
  });
  if (!res.stale.includes("scripts/research/openai-deep-research.js")) throw new Error(JSON.stringify(res.stale));
});

h.failClosed("evaluate(null) fails closed (does not green a malformed call)", () => evaluate(null));

h.done();
