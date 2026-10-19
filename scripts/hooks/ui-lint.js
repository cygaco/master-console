#!/usr/bin/env node

const CHECKED_ELEMENTS = ["button", "input", "select"];
const DEFAULT_UI_KIT = Object.freeze({
  button: Object.freeze({ component: "Button", path: "src/components/ui/button" }),
  input: Object.freeze({ component: "Input", path: "src/components/ui/input" }),
  select: Object.freeze({
    component: "Select",
    path: "src/components/ui/select",
    note: "not in the scaffold baseline; add it with `npx shadcn@latest add select`",
  }),
});
const COMPONENT_NAME = /^[A-Z][A-Za-z0-9_]*(?:\.[A-Z][A-Za-z0-9_]*)*$/;

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function entryProblem(entry) {
  if (!isPlainObject(entry)) return "not an object";
  if (typeof entry.component !== "string" || !COMPONENT_NAME.test(entry.component)) {
    return "component must be a capitalized JSX name";
  }
  if (entry.path !== undefined && (typeof entry.path !== "string" || !entry.path.trim())) {
    return "path must be a non-empty string";
  }
  if (entry.note !== undefined && typeof entry.note !== "string") return "note must be a string";
  return null;
}

function resolveUiKit(block) {
  const kit = { ...DEFAULT_UI_KIT };
  const problems = [];
  if (block === undefined || block === null) return { kit, problems };
  if (!isPlainObject(block)) {
    problems.push("mc.uiKit: not an object");
    return { kit, problems };
  }
  for (const [key, entry] of Object.entries(block)) {
    if (!CHECKED_ELEMENTS.includes(key)) {
      problems.push(`mc.uiKit.${key}: not a checked element (${CHECKED_ELEMENTS.join(", ")})`);
      continue;
    }
    const problem = entryProblem(entry);
    if (problem) problems.push(`mc.uiKit.${key}: ${problem}`);
    else kit[key] = entry;
  }
  return { kit, problems };
}

function loadUiKit() {
  let block;
  try {
    const cfg = require("./lib/project-config").loadConfig();
    block = cfg && cfg.mc ? cfg.mc.uiKit : undefined;
  } catch {
    block = undefined;
  }
  return resolveUiKit(block);
}

function advice(element, entry) {
  let text = `<${element}> — use <${entry.component}>`;
  if (entry.path) text += ` from ${entry.path}`;
  if (entry.note) text += ` (${entry.note})`;
  return text;
}

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const filePath = event.tool_input?.file_path || "";

    if (!filePath.endsWith(".tsx") || !filePath.includes("src/")) {
      process.exit(0);
    }

    const content =
      event.tool_input?.content || event.tool_input?.new_string || "";
    if (!content) {
      process.exit(0);
    }

    const warnings = [];

    const hexPattern =
      /(?:color|background|border|fill|stroke|shadow)\s*[:=]\s*['"`]#[0-9a-fA-F]{3,8}['"`]/gi;
    const hexMatches = content.match(hexPattern);
    if (hexMatches) {
      warnings.push(
        `HARDCODED COLOR: Found ${hexMatches.length} hardcoded hex color(s). Use CSS custom properties (var(--primary), var(--error), etc.) instead. Matches: ${hexMatches.slice(0, 3).join(", ")}`,
      );
    }

    const { kit, problems } = loadUiKit();
    if (problems.length > 0) {
      process.stderr.write(
        `ui-lint: ignoring malformed config in paths.manifest (${problems.join("; ")}); a checked element with no valid entry uses the scaffold default.\n`,
      );
    }
    const rawElements = [];
    if (/<button[\s>]/.test(content)) {
      rawElements.push(advice("button", kit.button));
    }
    if (/<input[\s/>]/.test(content)) {
      rawElements.push(advice("input", kit.input));
    }
    if (/<select[\s>]/.test(content)) {
      rawElements.push(advice("select", kit.select));
    }
    if (rawElements.length > 0) {
      warnings.push(
        `RAW HTML ELEMENTS: ${rawElements.join("; ")}. Use the UI-kit components for consistent styling and accessibility.`,
      );
    }

    if (/onMouseEnter|onMouseLeave/.test(content)) {
      if (!filePath.includes("src/components/ui/")) {
        warnings.push(
          "JS HOVER: Using onMouseEnter/onMouseLeave for hover effects. Prefer CSS :hover for better performance and accessibility. See COMPONENT_LIBRARY.md known issues.",
        );
      }
    }

    const twColorPattern =
      /(?:text|bg|border|ring|fill|stroke)-(?:red|blue|green|yellow|purple|pink|indigo|gray|slate|zinc|neutral|stone|orange|amber|emerald|teal|cyan|sky|violet|fuchsia|rose|lime)-\d{2,3}/g;
    const twMatches = content.match(twColorPattern);
    if (twMatches) {
      warnings.push(
        `TAILWIND COLOR: Found Tailwind color utilities: ${twMatches.slice(0, 3).join(", ")}. Use CSS custom properties (var(--primary), etc.) instead.`,
      );
    }

    if (warnings.length > 0) {
      process.stderr.write(
        `\n⚠️  UI LINT (${filePath.split("/").pop()}):\n${warnings.map((w) => `  • ${w}`).join("\n")}\n`,
      );
    }

    process.exit(0);
  } catch (e) {
    process.exit(0);
  }
});
