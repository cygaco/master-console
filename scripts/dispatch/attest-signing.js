"use strict";
const mcEnv = require("../hooks/lib/mc-env");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const SECRET_FILE =
  mcEnv.readEnv("ATTEST_SECRET_FILE") || path.join(ROOT, ".claude", "runtime", ".attest-session-secret");

const SIGNED_FIELDS = Object.freeze([
  "role",
  "shape",
  "provider",
  "tool_id",
  "panel_run_id",
  "code_sha",
  "output_digest",
  "evidence_sha",
  "cmdline_checksum",
  "completed_at",
  "verdict",
  "ok",
  "fallback",
  "sprint_id",
  "started_at",
  "auth_fallback",
  "workorder_digest",
  "dispatch_id",
]);

let _cachedSecret;
function sessionSecret() {
  if (_cachedSecret !== undefined) return _cachedSecret;
  try {
    if (fs.existsSync(SECRET_FILE)) {
      const hex = fs.readFileSync(SECRET_FILE, "utf8").trim();
      if (/^[0-9a-f]{64,}$/i.test(hex)) return (_cachedSecret = Buffer.from(hex, "hex"));
    }
    const secret = crypto.randomBytes(32);
    fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true });
    fs.writeFileSync(SECRET_FILE, secret.toString("hex"), { mode: 0o600 });
    return (_cachedSecret = secret);
  } catch (e) {
    _cachedSecret = null;
    return _cachedSecret;
  }
}

function canonicalIdentityString(record, fields = SIGNED_FIELDS) {
  return fields.map((f) => `${f}=${record && record[f] != null ? JSON.stringify(record[f]) : ""}`).join("\x1f");
}

function signRecord(record, secret = sessionSecret()) {
  if (!secret) return null;
  return crypto.createHmac("sha256", secret).update(canonicalIdentityString(record)).digest("hex");
}

function verifyRecord(record, secret = sessionSecret()) {
  if (!secret || !record) return false;
  const sig = record.attest_sig;
  if (typeof sig !== "string" || !/^[0-9a-f]{64}$/i.test(sig)) return false;
  const expected = signRecord(record, secret);
  if (!expected) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

module.exports = { sessionSecret, canonicalIdentityString, signRecord, verifyRecord, SIGNED_FIELDS, SECRET_FILE };
