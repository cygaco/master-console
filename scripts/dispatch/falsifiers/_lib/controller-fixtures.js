"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const pcb = require("../../pinned-checker-bundle");
const lease = require("../../conductor-lease");
const { installHook } = require("./git-scratch");

function sh(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", windowsHide: true }).trim();
}

function makeControllerFixture(tag, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `mc-ctl-${tag}-`));
  sh("git", ["init", "-q", "-b", "trunk"], dir);
  sh("git", ["config", "user.email", "scratch@example.com"], dir);
  sh("git", ["config", "user.name", "Scratch"], dir);
  if (opts.skipHookInstall !== true) installHook(dir);
  fs.writeFileSync(path.join(dir, "f.txt"), "base\n");
  sh("git", ["add", "."], dir);
  sh("git", ["commit", "-q", "-m", "base"], dir);
  const base = sh("git", ["rev-parse", "HEAD"], dir);
  fs.writeFileSync(path.join(dir, "f.txt"), "result\n");
  sh("git", ["add", "."], dir);
  sh("git", ["commit", "-q", "-m", "result"], dir);
  const result = sh("git", ["rev-parse", "HEAD"], dir);
  const targetRef = "refs/heads/integ";
  sh("git", ["branch", "integ", base], dir);

  const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), `mc-bundle-${tag}-`));
  const { manifestPath, bundleRoot } = pcb.buildBundle({ outRoot, promotedBy: `falsifier-${tag}` });

  const spId = `SP-FALSIFIER-${tag.toUpperCase()}`;
  const leaseRoot = fs.mkdtempSync(path.join(os.tmpdir(), `mc-lease-${tag}-`));
  const acquired = lease.acquire(spId, { root: leaseRoot, sessionId: tag });

  return {
    dir,
    outRoot,
    base,
    result,
    targetRef,
    manifestPath,
    bundleRoot,
    spId,
    leaseRoot,
    leaseToken: acquired.token,
    poisonResultCommit(poisonOpts = {}) {
      const rel = poisonOpts.relPath || "scripts/checks/poison.js";
      const bytes = poisonOpts.bytes || Buffer.from([0x2f, 0x2f, 0x00, 0x0a]);
      const abs = path.join(dir, ...rel.split("/"));
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, bytes);
      sh("git", ["add", "."], dir);
      sh("git", ["commit", "-q", "-m", "poison"], dir);
      return sh("git", ["rev-parse", "HEAD"], dir);
    },
    cleanup() {
      for (const d of [dir, outRoot, leaseRoot]) {
        try {
          fs.rmSync(d, { recursive: true, force: true });
        } catch {
        }
      }
    },
  };
}

function standardInput(fx, overrides = {}) {
  return {
    workorder: {
      schema_version: "workorder-min/v1",
      correlation_id: `corr-${fx.spId}`,
      role: "backend-builder",
      provider: "claude",
      model: "opus",
      base_commit: fx.base,
      result_tree_hash: "unused-superseded-by-controller-recompute",
      allowed_capabilities: ["build"],
      allowed_paths: ["scripts/"],
      retry_lineage: [],
      evidence_refs: ["ev-1"],
      terminal_state: "success",
      evidence: { "ev-1": "falsifier-evidence-blob" },
    },
    base_commit: fx.base,
    result_commit: fx.result,
    target_ref: fx.targetRef,
    result_envelope: { success: true, verdict: "accept" },
    ...overrides,
  };
}

function standardOpts(fx, overrides = {}) {
  return {
    bundleManifestPath: fx.manifestPath,
    bundleRoot: fx.bundleRoot,
    candidateRoot: fx.dir,
    gitRoot: fx.dir,
    performRefUpdate: true,
    spId: fx.spId,
    leaseRoot: fx.leaseRoot,
    ...overrides,
  };
}

module.exports = { makeControllerFixture, standardInput, standardOpts };
