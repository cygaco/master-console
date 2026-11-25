#!/usr/bin/env node

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const TRUSTED_REPO_LABEL = "**Trusted repo**";
const ACCOUNT_RE = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+\/[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const REPO_RE = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+\/[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
const TARGET_TOKEN_RE = /[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+\/[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*(?:\/[A-Za-z0-9_][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*)?/g;
const PUSH_LINE_PREFIX = "Non-force `git push`";
const PUBLISH_LINE_PREFIX = "Publishing the user's own releases";

function parseRemote(url) {
  const u = String(url || "").trim();
  let m = u.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/([^/]+)\/([^/]+?)\/?$/i);
  if (!m) m = u.match(/^(?:[^@/]+@)?([^/:]+):([^/]+)\/([^/]+?)\/?$/);
  if (!m) return null;
  const account = `${m[1].toLowerCase()}/${m[2]}`;
  const repo = `${account}/${m[3].replace(/\.git$/i, "")}`;
  if (!ACCOUNT_RE.test(account)) return null;
  return { account, repo: REPO_RE.test(repo) ? repo : null };
}

function accountFromRemote(url) {
  const p = parseRemote(url);
  return p ? p.account : null;
}

function repoFromRemote(url) {
  const p = parseRemote(url);
  return p ? p.repo : null;
}

function originUrl(cwd) {
  try {
    const r = spawnSync("git", ["-C", cwd, "remote", "get-url", "origin"], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return r.status === 0 ? r.stdout : null;
  } catch {
    return null;
  }
}

function accountFromOrigin(cwd = process.cwd()) {
  return accountFromRemote(originUrl(cwd));
}

function repoFromOrigin(cwd = process.cwd()) {
  return repoFromRemote(originUrl(cwd));
}

function isValidAccount(account) {
  return typeof account === "string" && ACCOUNT_RE.test(account);
}

function isValidRepo(repo) {
  return typeof repo === "string" && REPO_RE.test(repo);
}

function isValidTarget(target) {
  return isValidAccount(target) || isValidRepo(target);
}

function accountOf(repo) {
  return repo.split("/").slice(0, 2).join("/");
}

function environmentLines(target) {
  if (isValidRepo(target)) {
    return {
      "**Source control**": `**Source control**: ${target} — the user's own repository, the origin of this project.`,
      "**Repository visibility**": `**Repository visibility**: ${target} may be private or public; if public, it is the user's own publishing target.`,
      "**Default / protected branches**": "**Default / protected branches**: A non-force push or a fast-forward merge to the trusted repository's default branch is routine landing work. A force push to a default branch, or deleting a backup branch, still requires confirmation.",
      [TRUSTED_REPO_LABEL]: `${TRUSTED_REPO_LABEL}: the git repository ${target} — the working directory and its worktrees — together with that remote. Confidential project material is fine to commit and push to it if it is private. Secrets, credentials and personal data are never cleared into any repo, public or private, by this entry.`,
    };
  }
  return {
    "**Source control**": `**Source control**: ${target} and all repos under it — the user's own account. This covers every project the user works on from this machine that lives under that account.`,
    "**Repository visibility**": `**Repository visibility**: Mixed. Repos under ${target} may be private or public; the public ones are the user's own publishing targets.`,
    "**Default / protected branches**": "**Default / protected branches**: A non-force push or a fast-forward merge to a repo's default branch is routine landing work in these repos. A force push to a default branch, or deleting a backup branch, still requires confirmation.",
    [TRUSTED_REPO_LABEL]: `${TRUSTED_REPO_LABEL}: every git repository under ${target} — the working directory, its worktrees, and the user's other project folders on this machine when the user's task involves them — together with their configured remotes. Confidential project material is fine to commit and push to the private ones. Pushing release content to the user's own public repos is expected work. Secrets, credentials and personal data are never cleared into any repo, public or private, by this entry.`,
  };
}

function pushAllowLine(target) {
  if (isValidRepo(target)) {
    return `${PUSH_LINE_PREFIX} (branches and the default branch) and fast-forward merges to the repository ${target}, from the current working repository or its worktrees — the user has given standing approval for landing their own work there. This does not cover force pushes, pushing secrets or personal data, or any other repository.`;
  }
  return `${PUSH_LINE_PREFIX} (branches and the default branch) and fast-forward merges to any repository under ${target}, private or public, from the current working repository or its worktrees — the user has given standing approval for landing and publishing their own work. This does not cover force pushes, pushing secrets or personal data, or repositories outside that account.`;
}

function publishAllowLine(target) {
  if (isValidRepo(target)) {
    return `${PUBLISH_LINE_PREFIX} to the repository ${target} — pushing release content there and creating a release or tag on it — is routine release work the user has standing-approved, when it is done through the project's own release or publish command after that command's content checks have passed. This does not cover creating a new public repository, changing a repository's visibility, publishing to package registries, or publishing secrets or personal data.`;
  }
  return `${PUBLISH_LINE_PREFIX} to the user's own public repositories under ${target} — pushing release content there and creating a release or tag on them — is routine release work the user has standing-approved, when it is done through the project's own release or publish command after that command's content checks have passed. This does not cover creating a new public repository, changing a repository's visibility, publishing to package registries, or publishing secrets or personal data.`;
}

function blockFor(settings, target) {
  const auto = settings && typeof settings === "object" ? settings.autoMode : null;
  if (!auto || typeof auto !== "object") return false;
  const env = Array.isArray(auto.environment) ? auto.environment : [];
  const allow = Array.isArray(auto.allow) ? auto.allow : [];
  const envOk = env.some((e) => typeof e === "string" && e.startsWith(`${TRUSTED_REPO_LABEL}:`) && namesTarget(e, target));
  const allowOk = allow.some((a) => typeof a === "string" && a.includes("git push") && namesTarget(a, target));
  return envOk && allowOk;
}

function hasTrustBlock(settings, target) {
  if (isValidRepo(target)) return blockFor(settings, target) || blockFor(settings, accountOf(target));
  if (isValidAccount(target)) return blockFor(settings, target);
  return false;
}

function namesTarget(text, target) {
  const t = text.toLowerCase();
  const a = target.toLowerCase();
  for (let i = t.indexOf(a); i !== -1; i = t.indexOf(a, i + 1)) {
    const before = i === 0 ? "" : t[i - 1];
    const after = t[i + a.length] || "";
    if (!/[a-z0-9_.\/-]/.test(before) && !/[a-z0-9_\/-]/.test(after) && !(after === "." && /[a-z0-9]/.test(t[i + a.length + 1] || ""))) return true;
  }
  return false;
}

function otherTarget(text, target) {
  const tokens = String(text).match(TARGET_TOKEN_RE) || [];
  const a = target.toLowerCase();
  return tokens.find((t) => isValidTarget(t) && t.toLowerCase() !== a) || null;
}

function applyTrust(settings, target, opts = {}) {
  if (!isValidTarget(target)) throw new Error(`refused: "${target}" is not a plain host/owner/repo or host/owner`);
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new Error("refused: settings is not a JSON object");
  const next = JSON.parse(JSON.stringify(settings));
  if (next.autoMode === undefined) next.autoMode = {};
  const auto = next.autoMode;
  if (!auto || typeof auto !== "object" || Array.isArray(auto)) throw new Error("refused: autoMode is not an object");
  for (const k of ["environment", "allow"]) {
    if (auto[k] !== undefined && !Array.isArray(auto[k])) throw new Error(`refused: autoMode.${k} is not an array`);
  }
  const report = [];
  const changes = [];
  const kept = [];

  const env = (auto.environment || []).slice();
  for (const [label, text] of Object.entries(environmentLines(target))) {
    const i = env.findIndex((e) => typeof e === "string" && e.startsWith(`${label}:`));
    const other = i === -1 ? null : otherTarget(env[i], target);
    if (other && !opts.replace) {
      throw new Error(`refused: the existing ${label} line names a different repository or account (${other}); pass --replace to replace it`);
    }
    if (i === -1) {
      env.push(text);
      report.push(`added       ${label}`);
      changes.push({ action: "add", where: "environment", line: text });
    } else if (env[i] === text) {
      report.push(`unchanged   ${label}`);
    } else {
      changes.push({ action: "replace", where: "environment", old: env[i], line: text });
      env[i] = text;
      report.push(`replaced    ${label}`);
    }
  }
  auto.environment = env;

  let allow = (auto.allow || []).slice();
  if (opts.replace) {
    const keep = [];
    for (const a of allow) {
      const ours = typeof a === "string" && (a.startsWith(PUSH_LINE_PREFIX) || a.startsWith(PUBLISH_LINE_PREFIX));
      const other = typeof a === "string" && !namesTarget(a, target) ? otherTarget(a, target) : null;
      if (ours && other) {
        report.push(`removed     allow: line for ${other}`);
        changes.push({ action: "remove", where: "allow", line: a });
      } else {
        if (!ours && other && a.includes("git push")) kept.push(a);
        keep.push(a);
      }
    }
    allow = keep;
  }
  if (!allow.includes("$defaults")) {
    allow.unshift("$defaults");
    changes.push({ action: "add", where: "allow", line: "$defaults" });
  }
  const lines = [["push", pushAllowLine(target)]];
  if (opts.publish) lines.push(["publish", publishAllowLine(target)]);
  for (const [name, line] of lines) {
    if (allow.includes(line)) report.push(`unchanged   allow: ${name} line`);
    else {
      allow.push(line);
      report.push(`added       allow: ${name} line`);
      changes.push({ action: "add", where: "allow", line });
    }
  }
  auto.allow = allow;
  return { settings: next, report, changes, kept };
}

function parseArgs(argv) {
  const out = { account: null, repo: null, file: null, publish: false, replace: false, wholeAccount: false, write: false, unknown: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--account") out.account = argv[++i] || "";
    else if (a === "--repo") out.repo = argv[++i] || "";
    else if (a === "--file") {
      const v = argv[i + 1];
      out.file = v === undefined || v.startsWith("--") ? "" : argv[++i];
    }
    else if (a === "--publish") out.publish = true;
    else if (a === "--replace") out.replace = true;
    else if (a === "--whole-account") out.wholeAccount = true;
    else if (a === "--write") out.write = true;
    else out.unknown.push(a);
  }
  return out;
}

const KNOWN_FLAGS = "--write, --repo, --whole-account, --account, --file, --publish, --replace";

function resolveTarget(args, cwd) {
  if (args.wholeAccount) {
    if (args.repo != null) return { error: "refused: --repo names one repository; it cannot be combined with --whole-account" };
    if (args.account != null) {
      if (!isValidAccount(args.account)) return { error: `refused: --account "${args.account}" is not a plain host/owner (for example github.com/<owner>)` };
      return { target: args.account, inferred: false };
    }
    const account = accountFromOrigin(cwd);
    if (!account) return { error: "refused: could not read an account from `git remote get-url origin`. Pass --account <host>/<owner>" };
    return { target: account, inferred: true };
  }
  if (args.account != null) {
    return { error: "refused: --account trusts a whole account and needs --whole-account; to trust one repository use --repo <host>/<owner>/<repo>" };
  }
  if (args.repo != null) {
    if (!isValidRepo(args.repo)) return { error: `refused: --repo "${args.repo}" is not a plain host/owner/repo (for example github.com/<owner>/<repo>)` };
    return { target: args.repo, inferred: false };
  }
  const repo = repoFromOrigin(cwd);
  if (!repo) return { error: "refused: could not read a repository from `git remote get-url origin`. Pass --repo <host>/<owner>/<repo>" };
  return { target: repo, inferred: true };
}

function main(argv = process.argv.slice(2), io = {}) {
  const out = io.out || ((s) => process.stdout.write(s));
  const err = io.err || ((s) => process.stderr.write(s));
  const now = io.now || new Date();
  const args = parseArgs(argv);
  if (args.unknown.length) {
    err(`refused: unknown argument ${JSON.stringify(args.unknown[0])} (known: ${KNOWN_FLAGS}). Nothing written.\n`);
    return 2;
  }
  if (args.file !== null && !args.file.trim()) {
    err("refused: --file needs a path (it never falls back to the user settings file). Nothing written.\n");
    return 2;
  }
  const resolved = resolveTarget(args, io.cwd || process.cwd());
  if (resolved.error) {
    err(`${resolved.error}. Nothing written.\n`);
    return 2;
  }
  const { target, inferred } = resolved;
  const file = args.file !== null ? path.resolve(args.file) : path.join(os.homedir(), ".claude", "settings.json");

  let rawBytes;
  let mode = 0o600;
  try {
    rawBytes = fs.readFileSync(file);
    mode = fs.statSync(file).mode & 0o777;
  } catch (e) {
    err(`refused: cannot read ${file} (${e.code || e.message}). Nothing written.\n`);
    return 2;
  }
  let result;
  try {
    const settings = JSON.parse(rawBytes.toString("utf8").replace(/^\uFEFF/, ""));
    if (isValidRepo(target) && !args.replace && !args.publish && blockFor(settings, accountOf(target))) {
      out(`repository    : ${target} is already covered by the whole-account lines for ${accountOf(target)} in ${file}. Nothing to change. Nothing written.\n`);
      return 0;
    }
    result = applyTrust(settings, target, { publish: args.publish, replace: args.replace });
  } catch (e) {
    err(`${/^refused:/.test(e.message) ? e.message : `refused: ${file} is not valid JSON (${e.message})`}. Nothing written.\n`);
    return 2;
  }

  const scope = isValidRepo(target) ? "one repository" : "WHOLE ACCOUNT (every repository under it)";
  out(`${isValidRepo(target) ? "repository" : "account   "}    : ${target}${inferred ? " (read from this repo's origin remote)" : ""}\n`);
  out(`scope         : ${scope}\n`);
  out(`settings file : ${file}\n`);
  for (const c of result.changes) {
    if (c.action === "replace") {
      out(`  replace in autoMode.${c.where}:\n    - ${c.old}\n    + ${c.line}\n`);
    } else if (c.action === "remove") {
      out(`  remove from autoMode.${c.where}:\n    - ${c.line}\n`);
    } else {
      out(`  add to autoMode.${c.where}:\n    + ${c.line}\n`);
    }
  }
  for (const k of result.kept) out(`  kept (not written by this script; remove by hand if no longer wanted):\n      ${k}\n`);

  if (!result.changes.length) {
    out("Nothing to change. Nothing written.\n");
    return 0;
  }
  if (!args.write) {
    out("Dry run: nothing written. Re-run with --write to apply these changes.\n");
    return 0;
  }

  const backup = `${file}.bak-${now.toISOString().replace(/[:.]/g, "-")}`;
  if (fs.existsSync(backup)) {
    err(`refused: backup path ${backup} already exists. Nothing written.\n`);
    return 2;
  }
  try {
    fs.writeFileSync(backup, rawBytes, { flag: "wx", mode });
  } catch (e) {
    err(`refused: could not write backup ${backup} (${e.code || e.message}). Nothing written.\n`);
    return 2;
  }
  const tmp = `${file}.trust-${process.pid}-${now.getTime()}.tmp`;
  let created = false;
  try {
    const fd = fs.openSync(tmp, "wx", mode);
    created = true;
    try {
      fs.writeFileSync(fd, `${JSON.stringify(result.settings, null, 2)}\n`);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
  } catch (e) {
    if (created) {
      try {
        fs.unlinkSync(tmp);
      } catch {
      }
    }
    err(`refused: could not write ${file} (${e.code || e.message}). The original is unchanged; backup: ${backup}\n`);
    return 2;
  }

  out(`backup        : ${backup}\n`);
  out("Done. New sessions read this at start; restart the current session if a push is still refused.\n");
  return 0;
}

module.exports = {
  TRUSTED_REPO_LABEL,
  accountFromRemote,
  repoFromRemote,
  accountFromOrigin,
  repoFromOrigin,
  isValidAccount,
  isValidRepo,
  hasTrustBlock,
  applyTrust,
  parseArgs,
  resolveTarget,
  main,
};

if (require.main === module) {
  process.exitCode = main();
}
