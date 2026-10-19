"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const pcb = require("../../pinned-checker-bundle");
const lease = require("../../conductor-lease");
const { installHook, rmrf } = require("./git-scratch");

function sh(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
}
function headOf(dir, ref) {
  return sh(["rev-parse", "--verify", ref || "HEAD"], dir).toLowerCase();
}

function makeTransportFixture(tag, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `transport-fixture-${tag}-`));
  sh(["init", "-q", "-b", "main"], dir);
  sh(["config", "user.email", "scratch@example.com"], dir);
  sh(["config", "user.name", "Scratch"], dir);

  fs.writeFileSync(path.join(dir, "README.md"), "seed\n");
  sh(["add", "."], dir);
  sh(["commit", "-q", "-m", "c0 seed"], dir);
  const c0 = headOf(dir);

  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "scripts", "base.js"), "// base\n");
  sh(["add", "."], dir);
  sh(["commit", "-q", "-m", "c1 on main"], dir);
  const c1 = headOf(dir);

  sh(["checkout", "-q", "-b", "candidate"], dir);
  fs.writeFileSync(path.join(dir, "scripts", "feature.js"), "// clean feature work\n");
  sh(["add", "."], dir);
  sh(["commit", "-q", "-m", "candidate work"], dir);
  const candidate = headOf(dir);
  sh(["checkout", "-q", "main"], dir);

  if (opts.skipHookInstall !== true) installHook(dir);

  const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), `transport-fixture-bundle-${tag}-`));
  const { manifestPath, bundleRoot } = pcb.buildBundle({ outRoot, promotedBy: `transport-fixture-${tag}` });

  const spId = `SP-TFIXTURE-${tag.toUpperCase()}`;
  const leaseRootDir = fs.mkdtempSync(path.join(os.tmpdir(), `transport-fixture-lease-${tag}-`));
  let leaseToken = null;
  if (opts.acquireLease !== false) leaseToken = lease.acquire(spId, { root: leaseRootDir, sessionId: tag }).token;

  return {
    dir,
    c0,
    c1,
    candidate,
    spId,
    leaseRoot: leaseRootDir,
    leaseToken,
    manifestPath,
    bundleRoot,
    targetRef: "refs/heads/main",
    head: (ref) => headOf(dir, ref),

    commitTree(treeish, parents, msg) {
      const tree = sh(["rev-parse", `${treeish}^{tree}`], dir);
      const args = ["commit-tree", tree];
      for (const p of parents) args.push("-p", p);
      args.push("-m", msg);
      return sh(args, dir).toLowerCase();
    },

    poisonedBranch(name) {
      sh(["checkout", "-q", "-b", name, "candidate"], dir);
      fs.mkdirSync(path.join(dir, "scripts", "checks"), { recursive: true });
      fs.writeFileSync(path.join(dir, "scripts", "checks", "poison.js"), Buffer.from([0x2f, 0x2f, 0x00, 0x0a]));
      sh(["add", "."], dir);
      sh(["commit", "-q", "-m", "poisoned"], dir);
      const tip = headOf(dir);
      sh(["checkout", "-q", "main"], dir);
      return tip;
    },

    releaseCommit(parent, name) {
      sh(["checkout", "-q", "-b", name, parent], dir);
      fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
      fs.writeFileSync(path.join(dir, "scripts", "regen.js"), `// bookkeeping regen ${name}\n`);
      sh(["add", "."], dir);
      sh(["commit", "-q", "-m", `release bookkeeping ${name}`], dir);
      const tip = headOf(dir);
      sh(["checkout", "-q", "main"], dir);
      return tip;
    },

    opts(overrides = {}) {
      return { bundleManifestPath: manifestPath, bundleRoot, gitRoot: dir, spId, leaseRoot: leaseRootDir, ...overrides };
    },

    cleanup() {
      for (const d of [dir, outRoot, leaseRootDir]) rmrf(d);
    },
  };
}

module.exports = { makeTransportFixture, sh, headOf };
