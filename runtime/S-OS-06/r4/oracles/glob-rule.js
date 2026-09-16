"use strict";

/**
 * S-OS-06 r4 lane G — resolver for the ONE computed version-listing-glob implementation (β 8e5f3a02: globs are
 * COMPUTED against the lab's real tag list, satisfied iff >= 1 member). Lane G writes NO second implementation.
 *
 *   1. LANDED: this tree's scripts/open-source/partition-loader.js exports computeTagGlob + readTagList -> use it.
 *   2. NOT LANDED: load lane J's implementation from its COMMITTED blob (s-os-06/s2b-codemod @ LANE_J_COMMIT), pinned by
 *      blob id, materialised to a temp file (never lane J's live worktree bytes, which move under concurrent work).
 *   Neither available -> REFUSE (a glob that cannot be computed is never satisfied, and never silently re-implemented).
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const L = require("./lib");

const LANE_J_COMMIT = "92865fee0f6777e9f0f2416d209146e31f8f8a7f";
const LANE_J_PATH = "scripts/open-source/partition-loader.js";
const LANE_J_BLOB = "5e5dbcdcaad6513a4d776142f0ebbf414107b5fd";

function resolveGlobRule(root = L.REPO_ROOT) {
  const own = path.join(root, LANE_J_PATH);
  try {
    const m = require(own);
    if (typeof m.computeTagGlob === "function" && typeof m.readTagList === "function") {
      return { impl: m, source: `landed: ${LANE_J_PATH} of this tree (HEAD ${L.git(root, ["rev-parse", "HEAD"]).stdout.trim().slice(0, 8)})`, landed: true };
    }
  } catch (e) {
    throw new L.OracleRefusal(`this tree's ${LANE_J_PATH} failed to load: ${e.message}`);
  }
  const blob = L.git(root, ["rev-parse", `${LANE_J_COMMIT}:${LANE_J_PATH}`]);
  if (blob.status !== 0 || blob.stdout.trim() !== LANE_J_BLOB) {
    throw new L.OracleRefusal(`computed-glob rule not landed here, and lane J's committed blob ${LANE_J_COMMIT.slice(0, 8)}:${LANE_J_PATH} is ${blob.status !== 0 ? "unreachable" : `a different blob (${blob.stdout.trim().slice(0, 8)})`} — refusing to re-implement it`);
  }
  const bytes = L.git(root, ["cat-file", "blob", LANE_J_BLOB]);
  if (bytes.status !== 0) throw new L.OracleRefusal(`git cat-file ${LANE_J_BLOB.slice(0, 8)} failed`);
  const dir = path.join(os.tmpdir(), `s-os-06-laneJ-${LANE_J_BLOB.slice(0, 12)}`, "scripts", "open-source");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "partition-loader.js");
  if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== bytes.stdout) fs.writeFileSync(file, bytes.stdout, "utf8");
  const m = require(file);
  if (typeof m.computeTagGlob !== "function" || typeof m.readTagList !== "function") throw new L.OracleRefusal(`lane J blob ${LANE_J_BLOB.slice(0, 8)} does not export computeTagGlob/readTagList`);
  return { impl: m, source: `NOT landed on this tree: lane J's committed implementation s-os-06/s2b-codemod@${LANE_J_COMMIT.slice(0, 8)} ${LANE_J_PATH} (blob ${LANE_J_BLOB.slice(0, 8)}), called unchanged`, landed: false };
}

module.exports = { resolveGlobRule, LANE_J_COMMIT, LANE_J_BLOB };
