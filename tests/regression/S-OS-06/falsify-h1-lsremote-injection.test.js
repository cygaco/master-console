#!/usr/bin/env node
"use strict";
/**
 * H1 falsify-lsremote-injection (S-OS-06 r4 gauntlet r5 fix brief, finding H1).
 *
 * readTagList()'s remote-fallback path ran:
 *   spawnSync("git", ["ls-remote", "--tags", remote], ...)
 * `remote` comes from `git remote` — a name the repo's OWN .git/config controls — with no
 * `--` delimiter before it. A remote named like a git OPTION (e.g.
 * `--upload-pack=<arbitrary command>`) is parsed by git as an OPTION, not a positional
 * remote name, and `--upload-pack` is executed as a subprocess when git believes it is
 * talking to a remote. This is a REAL, reproducible local command execution — not a
 * theoretical parse difference — demonstrated below with a harmless `touch` marker file
 * (never a destructive command).
 *
 * RED (pre-fix): calling the shipped `readTagList()` against a repo whose only remote is
 *   named `--upload-pack=touch <marker>` creates the marker file — the remote name was
 *   executed as a git option's command.
 * GREEN (post-fix): the identical repo/remote leaves the marker file absent — the `--`
 *   delimiter forces git to treat the name as a literal (nonexistent) remote and fail
 *   cleanly instead.
 *
 * The severity is honestly LOW in this repo (planting a malicious remote name already
 * implies local write access to .git/config), but the class is HIGH and the fix is one
 * token — this test proves the token, not the threat model.
 *
 *   node --test tests/regression/S-OS-06/falsify-h1-lsremote-injection.test.js
 */
const FALSIFIER_ID = "H1";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REAL_ROOT = path.resolve(__dirname, "..", "..", "..");
const LOADER_FILE = path.join(REAL_ROOT, "scripts", "open-source", "partition-loader.js");
const LOADER = require(LOADER_FILE);

function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (k.startsWith("GIT_")) delete env[k];
  }
  return env;
}

/** A bare, tag-less repo with ONE remote whose name is an `--upload-pack=` injection payload. */
function makeInjectionRepo(markerName) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sos06-h1-"));
  const git = (args) => spawnSync("git", args, { cwd: dir, encoding: "utf8", env: cleanEnv() });
  git(["init", "-q"]);
  git(["config", "user.email", "fixture@example.com"]);
  git(["config", "user.name", "S-OS-06 H1 falsifier"]);
  const remoteName = `--upload-pack=touch ${markerName}`;
  // `git remote add` itself rejects an option-shaped name at the CLI; the config section is
  // written directly — exactly how a real repo's committed-then-fetched .git/config can
  // already carry such a name (no `git remote add` gate to pass through).
  git(["config", "--add", `remote.${remoteName}.url`, "fake"]);
  return { dir, remoteName, marker: path.join(dir, markerName) };
}

test(`${FALSIFIER_ID}: readTagList() must never let a remote name be parsed as a git option (RED before the -- fix, GREEN after)`, () => {
  const { dir, marker } = makeInjectionRepo("H1_INJECTED_marker");
  try {
    const res = LOADER.readTagList({ root: dir });
    assert.ok(res && typeof res === "object", "readTagList must return a result object, not throw");
    assert.ok(
      !fs.existsSync(marker),
      "the option-shaped remote name executed `touch` — readTagList's git ls-remote call is missing the `--` delimiter before `remote`"
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});
