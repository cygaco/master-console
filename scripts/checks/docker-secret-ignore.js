#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");

const START = Date.now();
const NAME = "docker-secret-ignore";

function arg(flag) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return null;
  return process.argv[i + 1] || null;
}
const JSON_OUT = process.argv.includes("--json");
const ROOT = path.resolve(
  arg("--target") || process.env.CLAUDE_PROJECT_DIR || process.cwd(),
);

const SECRET_PATTERNS = [
  /(^|\/)\.env$/,
  /(^|\/)\.env\.[^/]+$/,
  /(^|\/)id_rsa$/,
  /(^|\/)id_dsa$/,
  /(^|\/)id_ecdsa$/,
  /(^|\/)id_ed25519$/,
  /(^|\/).*\.pem$/,
  /(^|\/).*\.key$/,
  /(^|\/).*\.pfx$/,
  /(^|\/).*\.p12$/,
  /(^|\/)credentials$/,
  /(^|\/)credentials\.json$/,
  /(^|\/)\.npmrc$/,
  /(^|\/)\.netrc$/,
  /(^|\/)secrets?\.(json|ya?ml|toml)$/i,
  /(^|\/)service-account.*\.json$/i,
];

const WALK_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  "coverage",
  "vendor",
  "worktrees",
]);

function emit(result) {
  const out = {
    name: NAME,
    status: result.status,
    reason: result.reason,
    findings: result.findings || [],
    remediation: result.remediation || null,
    durationMs: Date.now() - START,
    evidence: result.evidence || {},
  };
  if (JSON_OUT) {
    console.log(JSON.stringify(out));
  } else if (result.status === "green") {
    console.log(`OK   [${NAME}] ${result.reason}`);
  } else if (result.status === "skipped") {
    console.log(`SKIP [${NAME}] ${result.reason}`);
  } else {
    console.error(`FAIL [${NAME}] ${result.reason}`);
    for (const f of out.findings) console.error(`     - ${f}`);
    if (result.remediation) console.error(`     fix: ${result.remediation}`);
  }
  process.exit(result.status === "red" ? 1 : 0);
}

function findDockerfiles(root) {
  const out = [];
  const isDockerfile = (name) =>
    name === "Dockerfile" ||
    /^Dockerfile\./.test(name) ||
    /\.Dockerfile$/.test(name);
  const scanDir = (dir, relPrefix) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.isFile() && isDockerfile(ent.name)) {
        out.push(relPrefix ? `${relPrefix}/${ent.name}` : ent.name);
      }
    }
  };
  scanDir(root, "");
  let top;
  try {
    top = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    top = [];
  }
  for (const ent of top) {
    if (!ent.isDirectory()) continue;
    if (WALK_SKIP_DIRS.has(ent.name) || ent.name.startsWith(".")) continue;
    scanDir(path.join(root, ent.name), ent.name);
  }
  return out;
}

function hasBroadCopy(dockerfileText) {
  const lines = dockerfileText.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (/^#/.test(line)) continue;
    const m = /^(COPY|ADD)\s+(.*)$/i.exec(line);
    if (!m) continue;
    let rest = m[2].replace(/--\S+=\S+/g, "").trim();
    const toks = rest.split(/\s+/).filter(Boolean);
    if (toks.length < 2) continue;
    const sources = toks.slice(0, -1);
    if (sources.some((s) => s === "." || s === "./")) return true;
  }
  return false;
}

function parseDockerignore(text) {
  const patterns = [];
  const negations = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("!")) {
      negations.push(line.slice(1).trim());
    } else {
      patterns.push(line);
    }
  }
  return { patterns, negations };
}

function ignoreCovers(relPath, ig) {
  const base = relPath.split("/").pop();
  const matchOne = (pat) => {
    if (pat === relPath) return true;
    if (pat === base) return true;
    if (/^\*\./.test(pat) && base.endsWith(pat.slice(1))) return true;
    if (pat.startsWith("**/")) {
      const tail = pat.slice(3);
      if (tail === base) return true;
      if (/^\*\./.test(tail) && base.endsWith(tail.slice(1))) return true;
    }
    const dir = pat.replace(/\/+$/, "");
    if (relPath === dir || relPath.startsWith(dir + "/")) return true;
    if (pat.includes("*")) {
      const re = new RegExp(
        "^" +
          pat
            .replace(/[.+^${}()|[\]\\]/g, "\\$&")
            .replace(/\*\*/g, "::DS::")
            .replace(/\*/g, "[^/]*")
            .replace(/::DS::/g, ".*") +
          "$",
      );
      if (re.test(relPath) || re.test(base)) return true;
    }
    return false;
  };
  const covered = ig.patterns.some(matchOne);
  if (!covered) return false;
  const reincluded = ig.negations.some(matchOne);
  return !reincluded;
}

function findSecretsInContext(root) {
  const found = [];
  const stack = [{ dir: root, rel: "" }];
  let visited = 0;
  while (stack.length) {
    const { dir, rel } = stack.pop();
    if (visited++ > 20000) break;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const childRel = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (WALK_SKIP_DIRS.has(ent.name)) continue;
        stack.push({ dir: path.join(dir, ent.name), rel: childRel });
        continue;
      }
      if (!ent.isFile()) continue;
      if (SECRET_PATTERNS.some((re) => re.test(childRel))) {
        found.push(childRel);
      }
    }
  }
  return found;
}

function main() {
  let dockerfiles, dockerignoreText, hasIgnore, broad, secrets;
  try {
    dockerfiles = findDockerfiles(ROOT);
    if (dockerfiles.length === 0) {
      emit({
        status: "skipped",
        reason: "no Dockerfile found — containerization check N/A for this repo",
        evidence: { root: ROOT },
      });
      return;
    }
    const ignorePath = path.join(ROOT, ".dockerignore");
    hasIgnore = fs.existsSync(ignorePath);
    dockerignoreText = hasIgnore ? fs.readFileSync(ignorePath, "utf8") : "";

    broad = false;
    const broadFiles = [];
    for (const df of dockerfiles) {
      const text = fs.readFileSync(path.join(ROOT, df), "utf8");
      if (hasBroadCopy(text)) {
        broad = true;
        broadFiles.push(df);
      }
    }

    if (!broad) {
      emit({
        status: "green",
        reason: `Dockerfile(s) present (${dockerfiles.join(", ")}) but no broad COPY . / ADD . — secrets not swept into the context`,
        evidence: { dockerfiles, hasDockerignore: hasIgnore },
      });
      return;
    }

    secrets = findSecretsInContext(ROOT);
    const ig = parseDockerignore(dockerignoreText);
    const exposed = secrets.filter((s) => !ignoreCovers(s, ig));

    if (exposed.length > 0) {
      emit({
        status: "red",
        reason: `${exposed.length} secret file(s) in the build context are NOT excluded by .dockerignore while a broad COPY . / ADD . would bake them into an image layer`,
        findings: exposed,
        remediation:
          (hasIgnore
            ? "Add the listed paths (or broad globs like `*.env`, `*.pem`, `**/credentials*`) to .dockerignore"
            : "Create a .dockerignore at the repo root and exclude `.env`, `*.pem`, `*.key`, `credentials*`, `id_rsa*`, etc.") +
          `; Dockerfile(s) with broad copy: ${broadFiles.join(", ")}`,
        evidence: {
          dockerfiles,
          broadFiles,
          hasDockerignore: hasIgnore,
          secretsInContext: secrets,
          exposed,
        },
      });
      return;
    }

    emit({
      status: "green",
      reason: hasIgnore
        ? `broad COPY/ADD present but all ${secrets.length} secret file(s) are excluded by .dockerignore`
        : "broad COPY/ADD present, no secret files currently in the build context (note: add a .dockerignore proactively)",
      evidence: {
        dockerfiles,
        broadFiles,
        hasDockerignore: hasIgnore,
        secretsInContext: secrets,
      },
    });
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (JSON_OUT) {
      console.log(JSON.stringify({ name: NAME, status: "error", error: msg }));
    } else {
      console.error(`ERROR [${NAME}] ${msg}`);
    }
    process.exit(2);
  }
}

if (require.main === module) main();

module.exports = {
  hasBroadCopy,
  parseDockerignore,
  ignoreCovers,
  findSecretsInContext,
  findDockerfiles,
  SECRET_PATTERNS,
};
