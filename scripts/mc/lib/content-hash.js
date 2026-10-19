#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const TEXT_EXTENSIONS = new Set([
  ".md",
  ".js",
  ".json",
  ".yaml",
  ".yml",
  ".ts",
  ".toml",
  ".txt",
]);

function isTextAsset(destPath) {
  if (typeof destPath !== "string") return false;
  const ext = path.extname(destPath).toLowerCase();
  return TEXT_EXTENSIONS.has(ext);
}

function toBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (typeof input === "string") return fs.readFileSync(input);
  throw new TypeError("content-hash: input must be Buffer or path string");
}

function normalizeText(buf) {
  const s = buf.toString("utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return Buffer.from(s, "utf8");
}

function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function contentHash(input, opts) {
  const optsText =
    opts && typeof opts === "object" && opts.text != null
      ? !!opts.text
      : typeof input === "string"
        ? isTextAsset(input)
        : false;
  const buf = toBuffer(input);
  return sha256Hex(optsText ? normalizeText(buf) : buf);
}

function rawHash(input) {
  return sha256Hex(toBuffer(input));
}

function hashMatches(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (!a || !b) return false;
  if (a === b) return true;
  let long = a;
  let short = b;
  if (long.length < short.length) {
    long = b;
    short = a;
  }
  if (long.length === short.length) return false;
  if (short.length < 12) return false;
  if (!/^[0-9a-f]+$/i.test(short)) return false;
  if (!/^[0-9a-f]+$/i.test(long)) return false;
  return long.toLowerCase().startsWith(short.toLowerCase());
}

module.exports = { contentHash, rawHash, hashMatches, isTextAsset };

if (require.main === module) {
  const arg = process.argv[2];
  if (arg !== "--selftest") {
    process.stderr.write("usage: content-hash.js --selftest\n");
    process.exit(2);
  }
  let pass = 0;
  let fail = 0;
  function check(name, cond) {
    if (cond) {
      pass++;
      process.stdout.write(`  ok   ${name}\n`);
    } else {
      fail++;
      process.stdout.write(`  FAIL ${name}\n`);
    }
  }

  const os = require("os");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ch-"));

  const crlfPath = path.join(tmpDir, "a.md");
  const lfPath = path.join(tmpDir, "b.md");
  fs.writeFileSync(crlfPath, Buffer.from("a\r\nb\r\nc\r\n", "utf8"));
  fs.writeFileSync(lfPath, Buffer.from("a\nb\nc\n", "utf8"));
  check(
    "contentHash(CRLF .md) === contentHash(LF .md)",
    contentHash(crlfPath) === contentHash(lfPath),
  );
  check(
    "contentHash(CRLF buf, text=true) === contentHash(LF buf, text=true)",
    contentHash(Buffer.from("x\r\ny\r\n", "utf8"), { text: true }) ===
      contentHash(Buffer.from("x\ny\n", "utf8"), { text: true }),
  );

  const binPath = path.join(tmpDir, "c.bin");
  const binBytes = Buffer.from([0x00, 0x01, 0x0d, 0x0a, 0xff, 0xfe]);
  fs.writeFileSync(binPath, binBytes);
  check(
    "rawHash(binary path) preserves raw bytes",
    rawHash(binPath) === sha256Hex(binBytes),
  );
  check("isTextAsset('.bin') === false", isTextAsset("c.bin") === false);
  check(
    "contentHash(.bin path) === raw sha256",
    contentHash(binPath) === sha256Hex(binBytes),
  );

  const full =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const prefix12 = full.slice(0, 12);
  check("hashMatches(full, prefix12) true", hashMatches(full, prefix12));
  check(
    "hashMatches(prefix12, full) true (symmetric)",
    hashMatches(prefix12, full),
  );
  check("hashMatches(full, full) true (exact)", hashMatches(full, full));
  check(
    "hashMatches(full, bad-prefix) false",
    !hashMatches(full, "ffffffffffff"),
  );
  check(
    "hashMatches(short10, full) false (below 12-char floor)",
    !hashMatches(full, full.slice(0, 10)),
  );
  check(
    "hashMatches('', '') false (empties rejected)",
    !hashMatches("", ""),
  );
  check(
    "hashMatches(non-hex, prefix) false",
    !hashMatches("zzzzzzzzzzzzz", prefix12),
  );

  check("isTextAsset .md", isTextAsset("a.md"));
  check("isTextAsset .js", isTextAsset("a.js"));
  check("isTextAsset .json", isTextAsset("a.json"));
  check("isTextAsset .yaml", isTextAsset("a.yaml"));
  check("isTextAsset .yml", isTextAsset("a.yml"));
  check("isTextAsset .ts", isTextAsset("a.ts"));
  check("isTextAsset .toml", isTextAsset("a.toml"));
  check("isTextAsset .txt", isTextAsset("a.txt"));
  check("isTextAsset rejects .png", !isTextAsset("a.png"));
  check("isTextAsset rejects extensionless", !isTextAsset("Makefile"));

  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}

  process.stdout.write(`selftest: ${pass} ok, ${fail} fail\n`);
  process.exit(fail === 0 ? 0 : 1);
}
