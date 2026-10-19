#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const REGISTRY = path.join(
  REPO_ROOT,
  ".claude",
  "agents",
  "_principles",
  "registry.json",
);

function scan(reg) {
  const errors = [];
  const base = reg.base || {};
  const baseCarrier = base.carrier || "manager-principles-base";
  const baseSet = base.principles || [];
  const agents = reg.agents || {};
  const defined = new Set(Object.keys(reg.principles || {}));

  const owners = new Map();
  const addOwner = (slug, owner) => {
    if (!owners.has(slug)) owners.set(slug, []);
    owners.get(slug).push(owner);
  };
  baseSet.forEach((s) => addOwner(s, baseCarrier));
  for (const [name, a] of Object.entries(agents)) {
    (a.owned_principles || []).forEach((s) => addOwner(s, name));
  }

  for (const [slug, os] of owners) {
    if (os.length > 1) {
      errors.push(`duplicate-owned: '${slug}' owned by ${os.join(", ")}`);
    }
  }

  const referenced = new Set(baseSet);
  for (const a of Object.values(agents)) {
    (a.owned_principles || []).forEach((s) => referenced.add(s));
    (a.inherited_principles || []).forEach((s) => referenced.add(s));
  }
  for (const s of referenced) {
    if (!defined.has(s)) {
      errors.push(`dangling: '${s}' referenced but not defined in principles{}`);
    }
  }

  for (const [slug, def] of Object.entries(reg.principles || {})) {
    const actual = owners.get(slug) || [];
    if (actual.length === 0) {
      errors.push(`orphan-definition: '${slug}' defined but owned by nobody`);
    } else if (actual.length === 1 && def.rooted_in && actual[0] !== def.rooted_in) {
      errors.push(
        `rooted-mismatch: '${slug}' rooted_in=${def.rooted_in} but owned by ${actual[0]}`,
      );
    }
  }

  const baseSorted = [...baseSet].sort().join(",");
  for (const [name, a] of Object.entries(agents)) {
    if (a.inherits_from === baseCarrier) {
      const inh = [...(a.inherited_principles || [])].sort().join(",");
      if (inh !== baseSorted) {
        errors.push(
          `missing-inherited: ${name} inherits ${baseCarrier} but inherited_principles [${a.inherited_principles || []}] != base [${baseSet}]`,
        );
      }
    }
  }

  return errors;
}

function main(argv) {
  const json = argv.includes("--json");
  let reg;
  try {
    reg = JSON.parse(fs.readFileSync(REGISTRY, "utf8"));
  } catch (e) {
    process.stderr.write(`manager-principles-scan error: ${e.message}\n`);
    return 2;
  }
  let errors;
  try {
    errors = scan(reg);
  } catch (e) {
    process.stderr.write(`manager-principles-scan error: ${e.message}\n`);
    return 2;
  }
  if (json) {
    process.stdout.write(
      JSON.stringify({ ok: errors.length === 0, errors }, null, 2) + "\n",
    );
    return errors.length ? 1 : 0;
  }
  if (errors.length === 0) {
    process.stdout.write(
      "OK manager-principles: ownership + inheritance consistent\n",
    );
    return 0;
  }
  process.stderr.write(
    `FAIL manager-principles (${errors.length}):\n${errors.map((e) => "  - " + e).join("\n")}\n`,
  );
  return 1;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = { scan, REGISTRY };
