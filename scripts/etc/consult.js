#!/usr/bin/env node
"use strict";

const path = require("path");
const { spawnSync } = require("child_process");
const { classify } = require("../hooks/lib/untrusted-content");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function defaultDispatch(promptText) {
  const r = spawnSync(
    process.execPath,
    [
      "scripts/dispatch-agent.js",
      "consult",
      "-",
      "--provider",
      "openai",
      "--model",
      "gpt-6.1-sol",
    ],
    {
      cwd: REPO_ROOT,
      input: promptText,
      encoding: "utf8",
      windowsHide: true,
    }
  );
  if (r.error) throw new Error(`dispatch spawn error: ${r.error.message}`);
  const stdout = (r.stdout || "").trim();
  if (!stdout) {
    throw new Error(
      `dispatch returned empty output (status ${r.status}): ${r.stderr || ""}`
    );
  }
  return JSON.parse(stdout);
}

function consult({ promptText, dispatch } = {}) {
  const _dispatch = dispatch || defaultDispatch;

  let envelope;
  try {
    envelope = _dispatch(promptText);
  } catch (e) {
    return { ok: false, critique: "", flagged: [], error: e.message };
  }

  if (!envelope || !envelope.ok) {
    const err = (envelope && envelope.error) || "dispatch failed or returned ok:false";
    return { ok: false, critique: "", flagged: [], error: err };
  }

  const output = typeof envelope.output === "string" ? envelope.output : "";
  const fw = classify(output);

  let flagged;
  let critique;

  if (fw.verdict === "reject") {
    flagged = fw.injection.map((i) => i.class);
    critique = "";
  } else if (fw.verdict === "neutralize") {
    flagged = fw.stripped_directives;
    critique = output;
  } else {
    flagged = [];
    critique = output;
  }

  return { ok: true, critique, flagged };
}

module.exports = { consult };

if (require.main === module) {
  const fs = require("fs");
  const argv = process.argv.slice(2);
  const promptArg = argv[0];

  if (!promptArg) {
    process.stderr.write("usage: consult.js <prompt-file|->\n");
    process.exit(1);
  }

  let promptText;
  try {
    promptText =
      promptArg === "-"
        ? fs.readFileSync(0, "utf8")
        : fs.readFileSync(path.resolve(promptArg), "utf8");
  } catch (e) {
    process.stderr.write(`consult.js: cannot read prompt: ${e.message}\n`);
    process.exit(1);
  }

  const result = consult({ promptText });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exit(result.ok ? 0 : 1);
}
