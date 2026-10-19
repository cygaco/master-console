#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

function get(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1];
}

const target = path.resolve(get("--target"));
const to = get("--to");
const wantCategory = get("--category");
const source = path.resolve(
  get("--source") || path.resolve(__dirname, "..", ".."),
);

const update = require(path.join(__dirname, "update.js"));

const stripBom = (s) => s.replace(/^﻿/, "");
const installedFile = path.join(target, ".claude", "framework-installed.json");
const installed = fs.existsSync(installedFile)
  ? JSON.parse(stripBom(fs.readFileSync(installedFile, "utf8")))
  : null;

const capsuleDir = path.join(source, "framework", "releases", to);
const release = JSON.parse(
  stripBom(fs.readFileSync(path.join(capsuleDir, "release.json"), "utf8")),
);
const manifest = JSON.parse(
  stripBom(
    fs.readFileSync(path.join(capsuleDir, "framework-manifest.json"), "utf8"),
  ),
);
const capsule = { release, manifest };

const decisions = update.classify(installed, capsule, target);

const filtered =
  wantCategory === "C" ? update.planClass(decisions).C : decisions;
for (const d of filtered) console.log(`${d.category}\t${d.dest}`);
console.log(`# total: ${filtered.length}`);
