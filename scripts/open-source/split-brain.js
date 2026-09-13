#!/usr/bin/env node
"use strict";

/**
 * scripts/open-source/split-brain.js — deterministic dual-state diagnosis CLI for the one-release compat window
 * (S-OS-06 COMPAT CONTRACT, AC-3.2).
 *
 * The DECISION CORE lives in scripts/hooks/lib/split-brain-core.js (moved there in T3 part 4a so the shipped
 * read-both helper, scripts/hooks/lib/mc-env.js, routes through the SAME rule). This file is the CLI over that
 * core and re-exports it unchanged, so the precedence rule still lives in exactly one place:
 *
 *   absent            neither name is set                         ok, resolved=null
 *   new-only          only the CURRENT name is set                ok, resolved=current
 *   legacy-only       only the LEGACY name is set                 ok, resolved=legacy, deprecated
 *   dual-identical    both set, same value/content                ok, resolved=current, deprecated
 *   dual-conflicting  both set, DIFFERENT value/content           ok=FALSE, explicit divergence
 *
 * A dual-conflicting state is never silently resolved: canonical precedence names the CURRENT side, but the
 * diagnosis carries ok=false plus the divergence, and the CLI exits 1.
 *
 * Names are parameters — this module carries no legacy literal.
 *
 * CLI:
 *   node scripts/open-source/split-brain.js --env <CURRENT_NAME> <LEGACY_NAME> [--json]
 *   node scripts/open-source/split-brain.js --dir <current-dir> <legacy-dir> [--json]
 * Exit: 0 absent/new-only/legacy-only/dual-identical · 1 dual-conflicting · 2 usage error
 */

const path = require("path");

const core = require("../hooks/lib/split-brain-core");

function main(argv) {
  const args = argv.slice(2);
  const json = args.includes("--json");
  const rest = args.filter((a) => a !== "--json");
  let diagnosis;
  try {
    if (rest[0] === "--env" && rest.length === 3) diagnosis = core.diagnoseEnv(process.env, rest[1], rest[2]);
    else if (rest[0] === "--dir" && rest.length === 3) diagnosis = core.diagnoseDir(path.resolve(rest[1]), path.resolve(rest[2]));
    else {
      process.stderr.write("usage: split-brain.js --env <CURRENT_NAME> <LEGACY_NAME> | --dir <current-dir> <legacy-dir> [--json]\n");
      return 2;
    }
  } catch (e) {
    process.stderr.write(`split-brain: ${e.message}\n`);
    return 2;
  }
  if (diagnosis.deprecated) process.stderr.write(`DEPRECATION: ${diagnosis.message}\n`);
  if (json) process.stdout.write(JSON.stringify(diagnosis, null, 2) + "\n");
  else {
    process.stdout.write(`split-brain: ${diagnosis.state} (ok=${diagnosis.ok}) — ${diagnosis.message}\n`);
    if (diagnosis.divergence) process.stdout.write(`DIVERGENCE ${JSON.stringify(diagnosis.divergence)}\n`);
  }
  return core.exitCodeFor(diagnosis);
}

if (require.main === module) process.exit(main(process.argv));

module.exports = {
  STATES: core.STATES,
  diagnose: core.diagnose,
  diagnoseEnv: core.diagnoseEnv,
  diagnoseDir: core.diagnoseDir,
  diagnosePath: core.diagnosePath,
  dirManifest: core.dirManifest,
  exitCodeFor: core.exitCodeFor,
  main,
};
