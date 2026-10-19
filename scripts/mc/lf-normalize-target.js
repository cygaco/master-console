#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function parseArgs(argv) {
  const get = (flag) => {
    const i = argv.indexOf(flag);
    return i === -1 ? null : argv[i + 1];
  };
  return {
    target: get("--target") || process.cwd(),
    dryRun: argv.includes("--dry-run"),
  };
}

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function stripCR(buf) {
  const out = Buffer.alloc(buf.length);
  let j = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0d && i + 1 < buf.length && buf[i + 1] === 0x0a) continue;
    out[j++] = buf[i];
  }
  return out.slice(0, j);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const target = path.resolve(opts.target);
  const fi = path.join(target, ".claude", "framework-installed.json");
  if (!fs.existsSync(fi)) {
    console.error(`framework-installed.json missing at ${fi}`);
    process.exit(2);
  }
  const installed = JSON.parse(fs.readFileSync(fi, "utf8"));
  const assets = installed.assets || [];

  const counts = { already_lf: 0, normalized: 0, modified: 0, missing: 0 };
  const modifiedFiles = [];

  for (const a of assets) {
    if (!a.dest || !a.installedHash) continue;
    const abs = path.join(target, a.dest);
    if (!fs.existsSync(abs)) {
      counts.missing++;
      continue;
    }
    const buf = fs.readFileSync(abs);
    if (sha256(buf) === a.installedHash) {
      counts.already_lf++;
      continue;
    }
    const lfBuf = stripCR(buf);
    if (sha256(lfBuf) === a.installedHash) {
      if (!opts.dryRun) fs.writeFileSync(abs, lfBuf);
      counts.normalized++;
      continue;
    }
    counts.modified++;
    modifiedFiles.push(a.dest);
  }

  console.log(
    JSON.stringify(
      {
        target,
        dryRun: opts.dryRun,
        counts,
        modifiedFiles: modifiedFiles.slice(0, 50),
        modifiedTotal: modifiedFiles.length,
      },
      null,
      2,
    ),
  );
}

main();
