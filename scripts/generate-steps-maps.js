#!/usr/bin/env node

const mcEnv = require("./hooks/lib/mc-env");
const fs = require("fs");
const path = require("path");

const PROJECT = mcEnv.readEnv("STEPS_ROOT")
  ? path.resolve(mcEnv.readEnv("STEPS_ROOT"))
  : path.resolve(__dirname, "..");
const STEPS_PATH = path.join(PROJECT, "_requirements/00-canonical/STEPS.json");

const CHECK = process.argv.includes("--check");
const VERBOSE = process.argv.includes("--verbose");

function loadRegistry() {
  const raw = fs.readFileSync(STEPS_PATH, "utf8");
  const r = JSON.parse(raw);
  if (!r.phases || !r.steps) {
    throw new Error("STEPS.json missing phases/steps");
  }
  return r;
}

function phaseSlug(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function phaseLabel(name, def) {
  if (typeof def.label === "string" && def.label.trim()) {
    return def.label.trim();
  }
  const words = String(name).replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function stepList(r) {
  if (Array.isArray(r.steps)) {
    return r.steps
      .filter((s) => s && typeof s === "object")
      .map((s) => ({ ...s, id: s.id ?? s.key ?? s.name }))
      .filter((s) => s.id != null);
  }
  return Object.entries(r.steps).map(([id, s]) => ({
    ...(s && typeof s === "object" ? s : {}),
    id,
  }));
}

function declaredPhases(r) {
  const entries = Array.isArray(r.phases)
    ? r.phases
        .map((p) =>
          typeof p === "string"
            ? [p, {}]
            : p && typeof p === "object"
              ? [p.id ?? p.name ?? p.key ?? p.label, p]
              : [null, {}],
        )
        .filter(([name]) => name != null && String(name).trim())
    : Object.entries(r.phases).map(([name, def]) => [
        name,
        def && typeof def === "object" ? def : {},
      ]);
  const all = stepList(r);
  return entries.map(([name, def]) => {
    const steps = Array.isArray(def.steps)
      ? def.steps.map((id) => all.find((s) => s.id === id) || { id })
      : all.filter((s) => String(s.phase) === String(name));
    steps.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    return {
      slug: phaseSlug(name),
      label: phaseLabel(name, def),
      def,
      steps,
    };
  });
}

function replaceRegion(body, regionName, newContent) {
  const start = `<!-- maps:steps:START (region=${regionName}) --- auto-generated from _requirements/00-canonical/STEPS.json; do not edit manually. Regenerate: /maps:steps or node scripts/generate-steps-maps.js -->`;
  const end = `<!-- maps:steps:END (region=${regionName}) -->`;
  const startRe = new RegExp(
    `<!-- maps:steps:START \\(region=${regionName}\\)[^>]*-->[\\s\\S]*?<!-- maps:steps:END \\(region=${regionName}\\) -->`,
    "m",
  );
  const block = `${start}\n\n${newContent.trim()}\n\n${end}`;
  if (startRe.test(body)) {
    return body.replace(startRe, () => block);
  }
  return null;
}

function phaseFlags(def) {
  const flags = [];
  if (def.required === true) flags.push("required");
  if (def.required === false) flags.push("optional");
  if (def.ordered === true) flags.push("ordered");
  if (def.ordered === false) flags.push("unordered");
  return flags.length ? ` (${flags.join(", ")})` : "";
}

function phaseHeading(p) {
  return `**${p.label} phase${phaseFlags(p.def)}:**`;
}

function cell(v) {
  return v == null || v === "" ? "—" : String(v);
}

function productModelPhaseTable(p) {
  const rows = p.steps.map(
    (s, i) =>
      `| ${i + 1} | ${s.id} | ${cell(s.component)} | ${cell(s.requires_data)} | ${cell(s.produces_data)} |`,
  );
  const description =
    typeof p.def.description === "string" && p.def.description.trim()
      ? [p.def.description.trim(), ""]
      : [];
  const order =
    p.def.ordered === true
      ? ["", "STEPS.json declares this phase ordered: its steps run in the order listed."]
      : p.def.ordered === false
        ? ["", "STEPS.json declares this phase unordered: the Requires column gives the dependency edges between its steps, and no fixed order is declared."]
        : [];
  return [
    phaseHeading(p),
    "",
    ...description,
    "| # | Step ID | Component | Requires | Produces |",
    "| - | ------- | --------- | -------- | -------- |",
    ...rows,
    ...order,
  ].join("\n");
}

function glossaryPhaseTable(p) {
  const rows = p.steps.map(
    (s) =>
      `| ${cell(s.position)} | ${s.id} | ${cell(s.component)} | ${cell(s.component_file)} | ${cell(s.feature)} |`,
  );
  return [
    phaseHeading(p),
    "",
    "| Position | Step ID | Component | File | Feature |",
    "| -------- | ------- | --------- | ---- | ------- |",
    ...rows,
  ].join("\n");
}

function goldenPathsFlow(phases) {
  const lines = [];
  for (const p of phases) {
    const ids = p.steps.map((s) => s.id);
    const flow =
      p.def.ordered === false ? `{${ids.join(", ")}}` : ids.join(" → ");
    lines.push(phaseHeading(p), "", "```", flow || "(no steps)", "```", "");
  }
  const summary = phases
    .map(
      (p) =>
        `${p.label} (${p.steps.length} step${p.steps.length === 1 ? "" : "s"})`,
    )
    .join(" → ");
  lines.push(
    `STEPS.json declares ${phases.length} phase${phases.length === 1 ? "" : "s"}, in this order: ${summary}.`,
  );
  return lines.join("\n");
}

function buildTargets(phases) {
  return [
    {
      file: "_requirements/00-canonical/PRODUCT_MODEL.md",
      regions: phases.map((p) => ({
        name: `product-model-${p.slug}`,
        build: () => productModelPhaseTable(p),
      })),
    },
    {
      file: "_requirements/00-canonical/GLOSSARY.md",
      regions: phases.map((p) => ({
        name: `glossary-${p.slug}`,
        build: () => glossaryPhaseTable(p),
      })),
    },
    {
      file: "_requirements/00-canonical/GOLDEN_PATHS.md",
      regions: [
        { name: "golden-paths-flow", build: () => goldenPathsFlow(phases) },
      ],
    },
  ];
}

function main() {
  if (!fs.existsSync(STEPS_PATH)) {
    console.log(
      "OK: no product canon (STEPS.json absent) — nothing to regenerate.",
    );
    return;
  }

  const registry = loadRegistry();
  const phases = declaredPhases(registry);
  if (phases.length === 0) {
    console.log("OK: STEPS.json declares no phases — nothing to regenerate.");
    return;
  }

  let wouldChange = false;
  const missing = [];
  const changed = [];

  for (const t of buildTargets(phases)) {
    const filePath = path.join(PROJECT, t.file);
    if (!fs.existsSync(filePath)) {
      missing.push(`${t.file} (does not exist)`);
      continue;
    }
    let body = fs.readFileSync(filePath, "utf8");
    let fileChanged = false;
    for (const region of t.regions) {
      const content = region.build();
      const next = replaceRegion(body, region.name, content);
      if (next == null) {
        missing.push(
          `${t.file}::${region.name} (markers not found — add maps:steps:START/END)`,
        );
        continue;
      }
      if (next !== body) {
        body = next;
        fileChanged = true;
        if (VERBOSE) console.log(`  ✓ updated ${t.file}::${region.name}`);
      }
    }
    if (fileChanged) {
      wouldChange = true;
      changed.push(t.file);
      if (!CHECK) fs.writeFileSync(filePath, body);
    }
  }

  if (missing.length) {
    console.error("MISSING MARKERS:");
    for (const m of missing) console.error(`  - ${m}`);
  }

  if (CHECK) {
    if (wouldChange) {
      console.error(
        `CHECK FAILED: ${changed.length} file(s) would change on regen:`,
      );
      for (const f of changed) console.error(`  - ${f}`);
      process.exit(1);
    }
    if (missing.length) {
      console.error(`CHECK FAILED: ${missing.length} missing marker(s)`);
      process.exit(1);
    }
    console.log("CHECK OK: all auto-generated regions match STEPS.json");
    return;
  }

  if (changed.length === 0 && missing.length === 0) {
    console.log("OK: no changes — all regions already match STEPS.json");
  } else if (changed.length) {
    console.log(`Regenerated ${changed.length} file(s):`);
    for (const f of changed) console.log(`  - ${f}`);
  }
  if (missing.length) process.exit(1);
}

main();
