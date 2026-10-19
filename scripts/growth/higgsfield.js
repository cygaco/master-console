#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");

const BASE_URL = process.env.HIGGSFIELD_BASE_URL || "https://platform.higgsfield.ai";
const USER_AGENT = "higgsfield-server-js/2.0";
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_MS = 300000;
const CREDITS_PER_USD = 16;

const TERMINAL_OK = "completed";
const TERMINAL_FAIL = new Set(["failed", "nsfw"]);

const CREDIT_TABLE = {
  nano_banana_2: { endpoint: "nano-banana/v2/text-to-image", credits: 8, kind: "image" },
  nano_banana_pro: { endpoint: "nano-banana/pro/text-to-image", credits: 12, kind: "image" },
  soul: { endpoint: "v1/text2image/soul", credits: 8, kind: "image" },
  "flux_pro_kontext_max": { endpoint: "flux-pro/kontext/max/text-to-image", credits: 16, kind: "image" },
  seedance_2_0: { endpoint: "seedance/v2/image-to-video", credits: 80, kind: "video" },
  kling_3: { endpoint: "kling/v3/image-to-video", credits: 120, kind: "video" },
  veo_3_1: { endpoint: "veo/v3.1/image-to-video", credits: 160, kind: "video" },
  dop: { endpoint: "v1/image2video/dop", credits: 100, kind: "video" },
};

function loadCreds() {
  const envPair = parseCredentialString(process.env.HF_CREDENTIALS);
  if (envPair) return envPair;
  if (process.env.HF_API_KEY && process.env.HF_API_SECRET) {
    return { id: process.env.HF_API_KEY.trim(), secret: process.env.HF_API_SECRET.trim() };
  }

  const candidates = [
    path.join(os.homedir(), ".higgsfield", ".env"),
    path.join(process.env.CLAUDE_PROJECT_DIR || ".", ".higgsfield", ".env"),
  ];
  for (const f of candidates) {
    let txt;
    try {
      txt = fs.readFileSync(f, "utf8");
    } catch {
      continue;
    }
    const creds = readCredentialString("HF_CREDENTIALS", txt);
    if (creds) {
      const pair = parseCredentialString(creds);
      if (pair) return pair;
    }
    const id = readCredentialString("HF_API_KEY", txt);
    const secret = readCredentialString("HF_API_SECRET", txt);
    if (id && secret) return { id, secret };
  }
  return null;
}

function readCredentialString(key, txt) {
  const m = txt.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`, "m"));
  if (!m) return null;
  return m[1].trim().replace(/^["']|["']$/g, "");
}

function parseCredentialString(raw) {
  if (!raw || typeof raw !== "string") return null;
  const cleaned = raw.trim().replace(/^["']|["']$/g, "");
  const idx = cleaned.indexOf(":");
  if (idx <= 0 || idx === cleaned.length - 1) return null;
  return { id: cleaned.slice(0, idx).trim(), secret: cleaned.slice(idx + 1).trim() };
}

function credsAvailable() {
  return loadCreds() !== null;
}

function countUnits(input) {
  const i = input || {};
  for (const k of ["batch_size", "num_images", "n", "count", "num_outputs", "num_clips"]) {
    if (typeof i[k] === "number" && Number.isFinite(i[k]) && i[k] > 0) {
      return Math.floor(i[k]);
    }
  }
  return 1;
}

function cost({ jst, input } = {}) {
  const entry = CREDIT_TABLE[jst];
  if (!entry) {
    throw new Error(
      `higgsfield.cost: unknown job_set_type "${jst}". Add it to CREDIT_TABLE with its credit cost (16 credits = $1) before use — refusing to assume a cost (fail-closed). Known: ${Object.keys(CREDIT_TABLE).join(", ")}`,
    );
  }
  const units = countUnits(input);
  const credits = entry.credits * units;
  const usd = credits / CREDITS_PER_USD;
  return {
    jst,
    kind: entry.kind,
    units,
    perUnitCredits: entry.credits,
    credits,
    usd: Math.round(usd * 100) / 100,
  };
}

function endpointFor(jst) {
  const entry = CREDIT_TABLE[jst];
  if (!entry) throw new Error(`higgsfield: unknown job_set_type "${jst}"`);
  return entry.endpoint;
}

function request(method, urlPath, { creds, body, timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(urlPath, BASE_URL);
    } catch (e) {
      return reject(new Error(`higgsfield: bad URL "${urlPath}": ${e.message}`));
    }
    const payload = body != null ? JSON.stringify(body) : null;
    const headers = {
      Authorization: `Key ${creds.id}:${creds.secret}`,
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    };
    if (payload) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }
    const req = https.request(
      {
        method,
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode || 0;
          let json = null;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch {
          }
          if (status < 200 || status >= 300) {
            return reject(
              Object.assign(
                new Error(`higgsfield ${method} ${u.pathname} → HTTP ${status}: ${raw.slice(0, 300)}`),
                { status, body: json || raw },
              ),
            );
          }
          resolve({ status, json, raw });
        });
      },
    );
    req.on("error", (e) => reject(new Error(`higgsfield ${method} ${u.pathname} transport error: ${e.message}`)));
    if (timeoutMs) {
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error(`higgsfield ${method} ${u.pathname} timed out after ${timeoutMs}ms`));
      });
    }
    if (payload) req.write(payload);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function extractUrl(statusJson) {
  if (!statusJson || typeof statusJson !== "object") return null;
  if (Array.isArray(statusJson.images) && statusJson.images[0] && statusJson.images[0].url) {
    return statusJson.images[0].url;
  }
  if (statusJson.video && statusJson.video.url) return statusJson.video.url;
  if (statusJson.results && statusJson.results.raw && statusJson.results.raw.url) {
    return statusJson.results.raw.url;
  }
  return null;
}

async function generate({ jst, input, wait = true, webhook, _deps } = {}) {
  const deps = _deps || {};
  const _loadCreds = deps.loadCreds || loadCreds;
  const _request = deps.request || request;
  const _sleep = deps.sleep || sleep;

  if (!jst) throw new Error("higgsfield.generate: `jst` (job_set_type) is required");
  const endpoint = endpointFor(jst);

  const creds = _loadCreds();
  if (!creds) {
    throw new Error(
      "higgsfield.generate: no credential found. Place HF_CREDENTIALS=\"ID:SECRET\" (or HF_API_KEY+HF_API_SECRET) in ~/.higgsfield/.env. The credential is never logged or committed.",
    );
  }

  const submitPath = webhook
    ? `${endpoint}?hf_webhook=${encodeURIComponent(webhook)}`
    : endpoint;
  const submitRes = await _request("POST", submitPath, {
    creds,
    body: { ...(input || {}) },
    timeoutMs: 60000,
  });
  const submitJson = submitRes.json || {};
  const requestId = submitJson.request_id || submitJson.requestId || submitJson.id;
  if (!requestId) {
    throw new Error(`higgsfield.generate: submit returned no request_id (got: ${submitRes.raw.slice(0, 200)})`);
  }

  if (!wait) {
    return { url: null, status: submitJson.status || "queued", request_id: requestId, jst };
  }

  const start = Date.now();
  if (extractUrl(submitJson)) {
    return { url: extractUrl(submitJson), status: submitJson.status || TERMINAL_OK, request_id: requestId, jst };
  }
  for (;;) {
    if (Date.now() - start > MAX_POLL_MS) {
      throw new Error(`higgsfield.generate: timed out polling request ${requestId} after ${MAX_POLL_MS}ms`);
    }
    await _sleep(POLL_INTERVAL_MS);
    const pollRes = await _request("GET", `requests/${encodeURIComponent(requestId)}/status`, {
      creds,
      timeoutMs: 30000,
    });
    const statusJson = pollRes.json || {};
    const status = String(statusJson.status || "").toLowerCase();
    if (status === TERMINAL_OK) {
      const url = extractUrl(statusJson);
      if (!url) {
        throw new Error(`higgsfield.generate: request ${requestId} completed but no asset URL in response`);
      }
      return { url, status, request_id: requestId, jst };
    }
    if (TERMINAL_FAIL.has(status)) {
      throw new Error(`higgsfield.generate: request ${requestId} terminated with status "${status}"`);
    }
  }
}

module.exports = {
  loadCreds,
  credsAvailable,
  cost,
  generate,
  endpointFor,
  CREDIT_TABLE,
  CREDITS_PER_USD,
  BASE_URL,
  parseCredentialString,
  countUnits,
  extractUrl,
};

if (require.main === module) {
  const [, , sub, jstArg, inputArg] = process.argv;
  if (sub === "cost") {
    let input = {};
    if (inputArg) {
      try {
        input = JSON.parse(inputArg);
      } catch (e) {
        process.stderr.write(`higgsfield: bad input JSON: ${e.message}\n`);
        process.exit(1);
      }
    }
    try {
      const c = cost({ jst: jstArg, input });
      process.stdout.write(JSON.stringify(c, null, 2) + "\n");
      process.exit(0);
    } catch (e) {
      process.stderr.write(String(e.message || e) + "\n");
      process.exit(1);
    }
  } else {
    process.stderr.write(
      "Usage: node scripts/growth/higgsfield.js cost <job_set_type> '<input-json>'\n" +
        "(generate() is library-only — invoke it through the spend gate, not the CLI.)\n",
    );
    process.exit(1);
  }
}
