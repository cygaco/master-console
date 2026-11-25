#!/usr/bin/env node
"use strict";
const HELP = [
  "models find [--json] [--provider <p>]      what each lab serves now, and what is gone",
  "models swap <old> <new> [--role <r>]       replace one configured model (shipped defaults unless --role)",
  "     flags: --dry-run  --no-ping  --no-regen",
  "models undo [<backup-id>] [--no-regen]     put back the last swap (or the named one)",
];

const SWAP_FLAGS = new Set(["role", "dry-run", "no-ping", "no-regen"]);
const UNDO_FLAGS = new Set(["no-regen"]);

function parse(argv) {
  const o = { pos: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--role") o.flags.role = argv[++i];
    else if (a.startsWith("--")) o.flags[a.slice(2)] = true;
    else o.pos.push(a);
  }
  return o;
}

function main(argv, deps) {
  const d = deps || {};
  const out = d.out || ((s) => process.stdout.write(s + "\n"));
  const [verb, ...rest] = argv || [];
  if (!verb || verb === "help" || verb === "--help" || verb === "-h") {
    HELP.forEach((l) => out(l));
    return verb ? 0 : 2;
  }
  if (verb === "find") {
    let find;
    try {
      find = d.find || require("./find");
    } catch (_) {
      out("find is not installed");
      return 1;
    }
    return find.main(rest);
  }
  const swapLib = d.swapLib || require("./swap");
  const p = parse(rest);
  if (verb === "swap" || verb === "undo") {
    const allowed = verb === "swap" ? SWAP_FLAGS : UNDO_FLAGS;
    const bad = Object.keys(p.flags).find((f) => !allowed.has(f));
    if (bad) {
      out(`unknown flag --${bad}; allowed: ${[...allowed].map((f) => "--" + f).join(" ")}`);
      return 2;
    }
  }
  if (verb === "swap") {
    if (p.pos.length !== 2 || p.flags.role === undefined && rest.includes("--role")) {
      out("usage: models swap <old> <new> [--role <r>] [--dry-run] [--no-ping] [--no-regen]");
      return 2;
    }
    const r = swapLib.swap({
      ...(d.swapOpts || {}),
      root: d.root,
      old: p.pos[0],
      new: p.pos[1],
      role: p.flags.role,
      dryRun: !!p.flags["dry-run"],
      noPing: !!p.flags["no-ping"],
      noRegen: !!p.flags["no-regen"],
    });
    r.lines.slice(0, 5).forEach((l) => out(l));
    return r.ok ? 0 : 1;
  }
  if (verb === "undo") {
    const r = swapLib.undo({ ...(d.swapOpts || {}), root: d.root, id: p.pos[0], noRegen: !!p.flags["no-regen"] });
    r.lines.slice(0, 5).forEach((l) => out(l));
    return r.ok ? 0 : 1;
  }
  out(`unknown command: ${verb}`);
  HELP.forEach((l) => out(l));
  return 2;
}

module.exports = { main };

if (require.main === module) {
  const code = main(process.argv.slice(2));
  Promise.resolve(code).then((c) => {
    process.exitCode = c;
  });
}
