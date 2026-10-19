"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const HOOK = path.join(__dirname, "ui-lint.js");
const TSX = "C:/proj/src/components/Form.tsx";
const RAW_ALL = [
  "export function Form() {",
  "  return (",
  "    <form>",
  '      <input type="text" />',
  '      <select name="size"></select>',
  "      <button onClick={save}>Save</button>",
  "    </form>",
  "  );",
  "}",
].join("\n");

const dirs = [];
test.after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

function makeProject(manifest) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ui-lint-"));
  dirs.push(dir);
  if (manifest !== undefined) {
    fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
    const text = typeof manifest === "string" ? manifest : JSON.stringify(manifest, null, 2);
    fs.writeFileSync(path.join(dir, ".claude", "manifest.json"), text);
  }
  return dir;
}

function runHook(projectDir, { filePath = TSX, content = RAW_ALL, stdin } = {}) {
  const input =
    stdin !== undefined ? stdin : JSON.stringify({ tool_name: "Write", tool_input: { file_path: filePath, content } });
  return spawnSync(process.execPath, [HOOK], {
    cwd: projectDir,
    input,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    timeout: 15000,
    windowsHide: true,
  });
}

function advisedComponents(stderr) {
  return [...String(stderr).matchAll(/<(button|input|select)> — use <([^>]+)>/g)].map((m) => `${m[1]}=${m[2]}`);
}

const SCAFFOLD_KIT = ["button=Button", "input=Input", "select=Select"];

test("(a) no manifest: the advice names the scaffold's components, with their scaffold paths", () => {
  const r = runHook(makeProject(undefined));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(advisedComponents(r.stderr), SCAFFOLD_KIT, r.stderr);
  assert.ok(r.stderr.includes("<button> — use <Button> from src/components/ui/button"), r.stderr);
  assert.ok(r.stderr.includes("<input> — use <Input> from src/components/ui/input"), r.stderr);
  assert.ok(r.stderr.includes("<select> — use <Select> from src/components/ui/select"), r.stderr);
  assert.ok(r.stderr.includes("npx shadcn@latest add select"), "the scaffold ships no select primitive; the advice says how to add one");
});

test("(a) a manifest with an `mc` block but no `mc.uiKit`: still the scaffold's kit, and no config note", () => {
  const r = runHook(makeProject({ project: { name: "demo" }, mc: { operatorContract: { strictness: "strict" } } }));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(advisedComponents(r.stderr), SCAFFOLD_KIT, r.stderr);
  assert.ok(!r.stderr.includes("mc.uiKit"), r.stderr);
});

test("(b) mc.uiKit declares the kit: the advice names those components and paths", () => {
  const r = runHook(
    makeProject({
      mc: {
        uiKit: {
          button: { component: "PrimaryAction", path: "src/kit/PrimaryAction" },
          input: { component: "TextField", path: "src/kit/TextField" },
          select: { component: "Picker" },
        },
      },
    }),
  );
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(advisedComponents(r.stderr), ["button=PrimaryAction", "input=TextField", "select=Picker"], r.stderr);
  assert.ok(r.stderr.includes("<button> — use <PrimaryAction> from src/kit/PrimaryAction"), r.stderr);
  assert.ok(r.stderr.includes("<input> — use <TextField> from src/kit/TextField"), r.stderr);
  assert.ok(/<select> — use <Picker>(?! from)/.test(r.stderr), "an entry without a path names the component only");
  assert.ok(!r.stderr.includes("shadcn"), "a declared select entry replaces the scaffold default and its note");
  assert.ok(!r.stderr.includes("mc.uiKit"), "a well-formed block draws no config note");
});

test("(b) a partial mc.uiKit: declared elements use the product's names, the rest keep the scaffold's", () => {
  const r = runHook(makeProject({ mc: { uiKit: { button: { component: "Ui.Button", path: "src/ui" } } } }));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(advisedComponents(r.stderr), ["button=Ui.Button", "input=Input", "select=Select"], r.stderr);
});

test("(c) a manifest that is not JSON: exit 0 and the scaffold's kit (the project-config loader fails open)", () => {
  const r = runHook(makeProject("{ this is not json"));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(advisedComponents(r.stderr), SCAFFOLD_KIT, r.stderr);
});

test("(c) mc.uiKit that is not an object: exit 0, the scaffold's kit, and a stderr note naming mc.uiKit", () => {
  const r = runHook(makeProject({ mc: { uiKit: "PrimaryAction" } }));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(advisedComponents(r.stderr), SCAFFOLD_KIT, r.stderr);
  assert.ok(/mc\.uiKit.*not an object/.test(r.stderr), r.stderr);
});

test("(c) malformed entries fall back one element at a time, each named in the note", () => {
  const r = runHook(
    makeProject({
      mc: {
        uiKit: {
          button: { component: "primary-action" },
          input: "TextField",
          select: { component: "Picker", path: 42 },
          textarea: { component: "Area" },
        },
      },
    }),
  );
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(advisedComponents(r.stderr), SCAFFOLD_KIT, r.stderr);
  for (const key of ["mc.uiKit.button", "mc.uiKit.input", "mc.uiKit.select", "mc.uiKit.textarea"]) {
    assert.ok(r.stderr.includes(key), `note names ${key}: ${r.stderr}`);
  }
});

test("a non-.tsx file, or a .tsx outside src/, is skipped silently", () => {
  const dir = makeProject(undefined);
  for (const filePath of ["C:/proj/src/components/Form.ts", "C:/proj/app/Form.tsx"]) {
    const r = runHook(dir, { filePath });
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stderr, "", `${filePath}: ${r.stderr}`);
  }
});

test("malformed or empty stdin exits 0 with no output", () => {
  const dir = makeProject(undefined);
  for (const stdin of ["{not json", ""]) {
    const r = runHook(dir, { stdin });
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stderr, "");
  }
});

test("component tags (capitalized) are not raw elements; clean content draws no warning", () => {
  const r = runHook(makeProject(undefined), { content: '<Button onClick={go}>Go</Button>\n<Input name="q" />' });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stderr, "", r.stderr);
});

test("hardcoded hex colors and Tailwind color utilities still warn", () => {
  const r = runHook(makeProject(undefined), {
    content: 'const s = { color: "#ff0000" };\nexport const X = () => <div className="text-red-500" style={s} />;',
  });
  assert.strictEqual(r.status, 0);
  assert.ok(r.stderr.includes("HARDCODED COLOR: Found 1 hardcoded hex color(s)"), r.stderr);
  assert.ok(r.stderr.includes("TAILWIND COLOR: Found Tailwind color utilities: text-red-500"), r.stderr);
  assert.ok(!r.stderr.includes("RAW HTML ELEMENTS"), r.stderr);
});

test("JS hover warns outside src/components/ui/ and not inside it", () => {
  const dir = makeProject(undefined);
  const content = "export const X = () => <div onMouseEnter={a} onMouseLeave={b} />;";
  const outside = runHook(dir, { content });
  assert.ok(outside.stderr.includes("JS HOVER"), outside.stderr);
  const inside = runHook(dir, { content, filePath: "C:/proj/src/components/ui/thing.tsx" });
  assert.strictEqual(inside.stderr, "", inside.stderr);
});
