#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const NAME = "log-sink-caps";

function evaluate(input) {
  const sinks = (input && input.sinks) || [];
  const offenders = [];
  for (const s of sinks) {
    const malformed =
      !s ||
      typeof s !== "object" ||
      typeof s.path !== "string" ||
      !s.path ||
      typeof s.cap !== "number" ||
      !(s.cap > 0) ||
      (s.kind !== "lines" && s.kind !== "bytes");
    if (malformed) {
      offenders.push({
        path: (s && s.path) || "(unknown)",
        reason: "malformed-sink-descriptor",
      });
      continue;
    }
    if (s.unreadable) {
      offenders.push({ path: s.path, kind: s.kind, cap: s.cap, reason: "unreadable" });
      continue;
    }
    if (s.actual !== undefined && s.actual !== null) {
      if (!Number.isFinite(s.actual)) {
        offenders.push({
          path: s.path,
          kind: s.kind,
          cap: s.cap,
          actual: s.actual,
          reason: "non-finite-actual",
        });
        continue;
      }
      const threshold = 2 * s.cap;
      if (s.actual > threshold) {
        offenders.push({
          path: s.path,
          kind: s.kind,
          cap: s.cap,
          actual: s.actual,
          threshold,
          reason: "over-2x-cap",
        });
      }
    }
  }
  return { ok: offenders.length === 0, offenders };
}

function run() {
  // eslint-disable-next-line global-require
  const { SINK_CAPS } = require("../hooks/lib/rotate");
  const sinks = [];
  let existing = 0;
  for (const [absPath, capEntry] of Object.entries(SINK_CAPS || {})) {
    const rel = path.relative(ROOT, absPath).replace(/\\/g, "/");
    const kind = capEntry && capEntry.kind;
    const cap = capEntry && capEntry.cap;

    let st = null;
    let statErr = null;
    try {
      st = fs.statSync(absPath);
    } catch (e) {
      statErr = e;
    }
    if (statErr) {
      if (statErr.code === "ENOENT") {
        sinks.push({ path: rel, kind, cap });
      } else {
        sinks.push({ path: rel, kind, cap, unreadable: true });
      }
      continue;
    }

    existing++;
    let actual;
    let unreadable = false;
    try {
      if (kind === "bytes") {
        actual = st.size;
      } else {
        const content = fs.readFileSync(absPath, "utf8");
        actual = content.length === 0 ? 0 : content.split("\n").filter(Boolean).length;
      }
    } catch {
      unreadable = true;
    }
    sinks.push({ path: rel, kind, cap, actual, unreadable });
  }
  return { ...evaluate({ sinks }), scanned: existing, inventory: sinks.length };
}

module.exports = { evaluate, run };

if (require.main === module) {
  const JSON_OUT = process.argv.includes("--json");
  const ENFORCE = process.argv.includes("--enforce");
  let res;
  try {
    res = run();
  } catch (e) {
    const msg = e && e.message ? e.message : e;
    if (JSON_OUT) console.log(JSON.stringify({ ok: false, error: String(msg) }));
    else console.error(`[${NAME}] runner error (fail-closed): ${msg}`);
    process.exit(2);
  }
  if (JSON_OUT) {
    console.log(JSON.stringify({ check: NAME, enforce: ENFORCE, ...res }));
  } else if (res.ok) {
    console.log(
      `OK   [${NAME}] inventory ${res.inventory} sink(s) well-formed; ${res.scanned} existing within 2x cap`,
    );
  } else {
    const verb = ENFORCE ? "FAIL" : "REPORT";
    console.error(
      `${verb} [${NAME}] ${res.offenders.length} sink(s) exceed 2x cap (or are unreadable/malformed):`,
    );
    for (const o of res.offenders) {
      console.error(
        `  - ${o.path}: ${o.reason}` +
          (o.actual !== undefined ? ` (actual=${o.actual}, threshold=${o.threshold})` : ""),
      );
    }
    if (!ENFORCE) {
      console.error(`[${NAME}] report-only — re-run with --enforce to make this a blocking gate.`);
    }
  }
  process.exit(ENFORCE ? (res.ok ? 0 : 1) : 0);
}
