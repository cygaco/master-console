#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const mcEnv = require("../hooks/lib/mc-env");

const CHANGE_VALUES = ["bugfix", "update", "release"];
const BLAST_VALUES = ["minor", "major"];
const CHANGE_RANK = { bugfix: 1, update: 2, release: 3 };
const BLAST_RANK = { minor: 1, major: 2 };
const RISK_VOCAB = [
  "security",
  "auth",
  "secrets",
  "dispatch",
  "leak-gate",
  "ci",
  "data-model",
  "paths-registry",
  "hooks",
  "release-pipeline",
  "none",
];
const RISK_TOKEN_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/;
const TRAILER_LINE_RE = /^([A-Za-z][A-Za-z0-9-]*)[\t ]*:[\t ]*(.*?)[\t ]*$/;
const TERMINAL_SPRINT_STATUSES = ["closed", "done", "retrospected", "abandoned", "superseded"];
const HOOK_BLOCK_EXIT = 3;
const DEFAULT_REGISTRY_REL = ".claude/project/sprint/active-sprints.yaml";
const DEFAULT_CURRENT_REL = ".claude/project/sprint/current-sprint.yaml";

const FIX_LINES = [
  "Change: <bugfix|update|release>",
  "Blast: <minor|major>",
  "Risks: <comma-separated tokens, or none>",
];

function splitRisks(raw) {
  return String(raw)
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function capital(k) {
  return k.charAt(0).toUpperCase() + k.slice(1);
}

function parse(message) {
  const out = { change: null, blast: null, risks: null, errors: [] };
  const text = String(message === undefined || message === null ? "" : message).replace(/\r\n?/g, "\n");
  const lines = text.split("\n").filter((l) => !/^#/.test(l));
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  const paragraphs = [];
  let cur = [];
  for (const l of lines) {
    if (l.trim() === "") {
      if (cur.length) paragraphs.push(cur);
      cur = [];
    } else cur.push(l);
  }
  if (cur.length) paragraphs.push(cur);

  const trailerLines = [];
  for (let i = paragraphs.length - 1; i >= 0; i--) {
    const p = paragraphs[i];
    if (!p.every((l) => TRAILER_LINE_RE.test(l))) break;
    trailerLines.unshift(...p);
  }

  const seen = { change: [], blast: [], risks: [] };
  for (const l of trailerLines) {
    const m = TRAILER_LINE_RE.exec(l);
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (key in seen) seen[key].push(m[2].trim().toLowerCase());
  }
  for (const key of ["change", "blast", "risks"]) {
    const vals = seen[key];
    if (vals.length === 0) continue;
    const uniq = [...new Set(vals)];
    if (uniq.length > 1) {
      out.errors.push(`conflicting duplicate "${capital(key)}" trailers (${vals.join(" vs ")})`);
      continue;
    }
    if (key === "risks") out.risks = splitRisks(uniq[0]);
    else out[key] = uniq[0];
  }
  return out;
}

function checkFields({ change, blast, risks }, label) {
  const errors = [];
  const tag = (s) => (label ? `${label}: ${s}` : s);
  if (change === null || change === undefined || change === "") errors.push(tag('missing "Change"'));
  else if (!CHANGE_VALUES.includes(String(change).toLowerCase()))
    errors.push(tag(`invalid Change "${change}" (expected ${CHANGE_VALUES.join("|")})`));
  if (blast === null || blast === undefined || blast === "") errors.push(tag('missing "Blast"'));
  else if (!BLAST_VALUES.includes(String(blast).toLowerCase()))
    errors.push(tag(`invalid Blast "${blast}" (expected ${BLAST_VALUES.join("|")})`));
  if (risks === null || risks === undefined) errors.push(tag('missing "Risks"'));
  else if (!Array.isArray(risks) || risks.length === 0) errors.push(tag('empty "Risks" (use "none" when there are none)'));
  else {
    const bad = risks.filter((r) => typeof r !== "string" || !RISK_TOKEN_RE.test(r));
    if (bad.length) errors.push(tag(`invalid Risks token(s): ${bad.map((b) => JSON.stringify(b)).join(", ")} (lower-case a-z 0-9 . _ -)`));
    const unknown = risks.filter((r) => typeof r === "string" && RISK_TOKEN_RE.test(r) && !RISK_VOCAB.includes(r));
    if (unknown.length) errors.push(tag(`Risks token(s) outside the controlled vocabulary: ${unknown.map((b) => JSON.stringify(b)).join(", ")} (expected one of ${RISK_VOCAB.join(", ")})`));
    if (risks.includes("none") && risks.length > 1) errors.push(tag('"none" cannot be combined with other Risks tokens'));
  }
  return errors;
}

function validate(input) {
  const parsed = typeof input === "string" || input === null || input === undefined ? parse(input) : input;
  const errors = [...(parsed.errors || []), ...checkFields(parsed)];
  const ok = errors.length === 0;
  return {
    ok,
    errors,
    value: ok ? { change: parsed.change, blast: parsed.blast, risks: parsed.risks } : null,
  };
}

function validateClassification(obj, label) {
  if (!obj || typeof obj !== "object") return { ok: false, errors: [`${label || "classification"}: not an object`], value: null };
  const risks =
    typeof obj.risks === "string" ? splitRisks(obj.risks) : Array.isArray(obj.risks) ? obj.risks.map((r) => String(r).toLowerCase()) : obj.risks;
  const change = typeof obj.change === "string" ? obj.change.toLowerCase() : obj.change;
  const blast = typeof obj.blast === "string" ? obj.blast.toLowerCase() : obj.blast;
  const errors = checkFields({ change, blast, risks }, label);
  return { ok: errors.length === 0, errors, value: errors.length === 0 ? { change, blast, risks } : null };
}

function validatePartial(obj) {
  const value = {};
  const errors = [];
  const o = obj || {};
  if (o.change !== undefined && o.change !== null) {
    const c = String(o.change).toLowerCase();
    if (!CHANGE_VALUES.includes(c)) errors.push(`invalid Change "${o.change}" (expected ${CHANGE_VALUES.join("|")})`);
    else value.change = c;
  }
  if (o.blast !== undefined && o.blast !== null) {
    const b = String(o.blast).toLowerCase();
    if (!BLAST_VALUES.includes(b)) errors.push(`invalid Blast "${o.blast}" (expected ${BLAST_VALUES.join("|")})`);
    else value.blast = b;
  }
  if (o.risks !== undefined && o.risks !== null) {
    const r = typeof o.risks === "string" ? splitRisks(o.risks) : Array.isArray(o.risks) ? o.risks.map((x) => String(x).toLowerCase()) : null;
    if (!r || r.length === 0) errors.push('empty "Risks" (use "none" when there are none)');
    else {
      const bad = r.filter((x) => !RISK_TOKEN_RE.test(x));
      if (bad.length) errors.push(`invalid Risks token(s): ${bad.map((b) => JSON.stringify(b)).join(", ")}`);
      else if (r.includes("none") && r.length > 1) errors.push('"none" cannot be combined with other Risks tokens');
      else value.risks = r;
    }
  }
  return { ok: errors.length === 0, errors, value };
}

function aggregateClassification(tickets) {
  let change = null;
  let blast = null;
  const risks = new Set();
  let any = false;
  for (const t of tickets || []) {
    if (!t || typeof t !== "object") continue;
    const c = typeof t.change === "string" ? t.change.toLowerCase() : null;
    const b = typeof t.blast === "string" ? t.blast.toLowerCase() : null;
    const r = Array.isArray(t.risks) ? t.risks : typeof t.risks === "string" ? splitRisks(t.risks) : [];
    if (!c && !b && r.length === 0) continue;
    any = true;
    if (c && CHANGE_RANK[c] && (!change || CHANGE_RANK[c] > CHANGE_RANK[change])) change = c;
    if (b && BLAST_RANK[b] && (!blast || BLAST_RANK[b] > BLAST_RANK[blast])) blast = b;
    for (const x of r) risks.add(String(x).toLowerCase());
  }
  if (!any) return null;
  const list = [...risks];
  const real = list.filter((x) => x !== "none");
  return { change, blast, risks: real.length ? real : list.length ? ["none"] : [] };
}

function compareClassification(ticket, commit) {
  const downgrades = [];
  const upgrades = [];
  if (CHANGE_RANK[commit.change] < CHANGE_RANK[ticket.change]) downgrades.push(`change ${ticket.change} -> ${commit.change}`);
  else if (CHANGE_RANK[commit.change] > CHANGE_RANK[ticket.change]) upgrades.push(`change ${ticket.change} -> ${commit.change}`);
  if (BLAST_RANK[commit.blast] < BLAST_RANK[ticket.blast]) downgrades.push(`blast ${ticket.blast} -> ${commit.blast}`);
  else if (BLAST_RANK[commit.blast] > BLAST_RANK[ticket.blast]) upgrades.push(`blast ${ticket.blast} -> ${commit.blast}`);
  const tr = (ticket.risks || []).filter((x) => x !== "none");
  const cr = new Set(commit.risks || []);
  const risks_dropped = tr.filter((x) => !cr.has(x));
  return { downgrades, upgrades, risks_dropped, blocked: downgrades.length > 0 };
}

function widenClassification(a, b) {
  const change = CHANGE_RANK[b && b.change] > CHANGE_RANK[a && a.change] ? b.change : a.change;
  const blast = BLAST_RANK[b && b.blast] > BLAST_RANK[a && a.blast] ? b.blast : a.blast;
  const ar = ((a && a.risks) || []).filter((r) => r !== "none");
  const br = ((b && b.risks) || []).filter((r) => r !== "none");
  const union = [...new Set([...ar, ...br])];
  return { change, blast, risks: union.length ? union : ["none"] };
}

function blockMessage(errors, who) {
  return [
    `${who || "change-trailer"}: commit refused: the change-classification trailer is missing or invalid.`,
    ...errors.map((e) => `  - ${e}`),
    "",
    "Add these three lines to the final trailer block of the commit message (just above Co-Authored-By):",
    ...FIX_LINES.map((l) => `  ${l}`),
    "",
    "Example:",
    "  Change: update",
    "  Blast: minor",
    "  Risks: hooks",
    `Risks vocabulary (closed — pick from this list; "none" stands alone): ${RISK_VOCAB.join(", ")}.`,
    "Bypass (logged): MC_CHANGE_TRAILER=report for report-only, MC_CHANGE_TRAILER=off to disable.",
    "",
  ].join("\n");
}

function enforcementMode() {
  let v;
  try {
    v = mcEnv.readEnv("CHANGE_TRAILER");
  } catch {
    v = undefined;
  }
  v = String(v || "")
    .trim()
    .toLowerCase();
  if (v === "off") return "off";
  if (v === "report") return "report";
  return "enforce";
}

function relFromPathsJson(root, key, fallback) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, ".claude", "paths.json"), "utf8"));
    if (raw && typeof raw[key] === "string") return raw[key];
  } catch {
  }
  return fallback;
}

function unquote(s) {
  return String(s)
    .trim()
    .replace(/^["']|["']$/g, "");
}

function parseActiveSprintText(text, curPresent) {
  if (text === null) {
    if (curPresent) return { active: true, id: null, status: null, reason: "current-sprint file present, no registry" };
    return { active: false, id: null, status: null, reason: "no sprint registry" };
  }
  const pm = /^primary:[\t ]*(\S+)[\t ]*$/m.exec(text);
  if (!pm) return { active: false, id: null, status: null, reason: "registry names no primary sprint" };
  const id = unquote(pm[1]);
  if (!id || id === "null" || id === "~") return { active: false, id: null, status: null, reason: "registry primary is null" };
  const lines = text.split(/\r?\n/);
  let status = null;
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*-\s+id:[\t ]*(\S+)[\t ]*$/.exec(lines[i]);
    if (!m || unquote(m[1]) !== id) continue;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\s*-\s+id:/.test(lines[j])) break;
      const sm = /^\s+status:[\t ]*(\S+)[\t ]*$/.exec(lines[j]);
      if (sm) {
        status = unquote(sm[1]);
        break;
      }
    }
    break;
  }
  if (status === null) return { active: false, id, status: null, reason: "primary has no readable status entry" };
  if (TERMINAL_SPRINT_STATUSES.includes(status)) return { active: false, id, status, reason: `primary sprint is ${status}` };
  return { active: true, id, status, reason: "primary sprint is live" };
}

function activeSprint(root) {
  const base = root || process.cwd();
  const regRel = relFromPathsJson(base, "sprintActiveRegistry", DEFAULT_REGISTRY_REL);
  const curRel = relFromPathsJson(base, "sprintCurrent", DEFAULT_CURRENT_REL);
  let text = null;
  try {
    text = fs.readFileSync(path.join(base, regRel), "utf8");
  } catch {
    text = null;
  }
  return parseActiveSprintText(text, fs.existsSync(path.join(base, curRel)));
}

function gitShowAtRef(root, ref, relPath) {
  if (typeof ref !== "string" || !ref || ref.startsWith("-")) return null;
  const r = spawnSync("git", ["-C", root, "show", "--end-of-options", `${ref}:${relPath.replace(/\\/g, "/")}`], { encoding: "utf8", windowsHide: true });
  if (r.status !== 0) return null;
  return r.stdout;
}

function activeSprintAtRef(root, { base, head, readFn } = {}) {
  const regRel = relFromPathsJson(root, "sprintActiveRegistry", DEFAULT_REGISTRY_REL);
  const curRel = relFromPathsJson(root, "sprintCurrent", DEFAULT_CURRENT_REL);
  const read = readFn || ((ref, rel) => gitShowAtRef(root, ref, rel));
  const ref = base;
  if (!ref) return { ok: false, active: false, id: null, status: null, reason: "no resolved base to read the active-sprint registry from (the candidate HEAD is never trusted in its place)" };
  const text = read(ref, regRel);
  if (text === null) {
    const curText = read(ref, curRel);
    if (curText !== null) return { ok: true, active: true, id: null, status: null, reason: "current-sprint file present at ref, no registry" };
    return { ok: false, active: false, id: null, status: null, reason: `active-sprint registry unreadable at ref ${ref}` };
  }
  return { ok: true, ...parseActiveSprintText(text, false) };
}

function emit(kind, data, opts) {
  try {
    if (opts && typeof opts.log === "function") return opts.log(kind, data);
    const { log } = require("../hooks/lib/logger");
    log("audit", { kind, ...data }, { actor: "system", source: "change-trailer" });
  } catch {
  }
}

function ticketsDir(root) {
  return path.join(root, relFromPathsJson(root, "sprintTickets", ".claude/project/sprint/tickets"));
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function loadSprintTickets(root, sprintId) {
  const dir = ticketsDir(root);
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
  } catch {
    return [];
  }
  const { readYamlMaybe } = require("../sprint/fs");
  const re = new RegExp(`^sprint:[\\t ]*["']?${escapeRe(sprintId)}["']?[\\t ]*$`, "m");
  const out = [];
  for (const f of files) {
    const file = path.join(dir, f);
    let text = "";
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (!re.test(text)) continue;
    const t = readYamlMaybe(file);
    if (t && typeof t === "object") out.push(t);
  }
  return out;
}

function headMessage(root, ref) {
  const r = spawnSync("git", ["-C", root, "log", "-1", "--format=%B", ref], { encoding: "utf8", windowsHide: true });
  if (r.status !== 0) return null;
  return r.stdout;
}

function mergeHeadMessage(root, opts = {}) {
  if (opts && typeof opts.readMergeHead === "function") return opts.readMergeHead(root);
  const rev = spawnSync("git", ["-C", root, "rev-parse", "--verify", "-q", "MERGE_HEAD"], { encoding: "utf8", windowsHide: true });
  if (rev.status !== 0) return null;
  const sha = String(rev.stdout || "").trim();
  if (!sha) return null;
  const msg = spawnSync("git", ["-C", root, "log", "-1", "--format=%B", sha], { encoding: "utf8", windowsHide: true });
  if (msg.status !== 0) return null;
  return msg.stdout;
}

function validateMergeGenerated(root, opts = {}) {
  const merged = mergeHeadMessage(root, opts);
  if (merged === null) return { ok: true, inherited: false };
  const mv = validate(merged);
  return { ok: mv.ok, inherited: true, errors: mv.errors, value: mv.value };
}

function reconcile({ sprint, root, ref, log, headMessageFn }) {
  const base = root || process.cwd();
  const rev = ref || "HEAD";
  const tickets = loadSprintTickets(base, sprint);
  const ticket = aggregateClassification(tickets);
  const msg = (headMessageFn || headMessage)(base, rev);
  if (msg === null) return { exit: 2, status: "git-error", lines: [`reconcile: cannot read commit message at ${rev}`] };
  const v = validate(msg);
  if (!ticket) {
    return {
      exit: 0,
      status: "skipped-no-ticket-classification",
      lines: [`reconcile: sprint ${sprint} has no ticket carrying a classification (${tickets.length} ticket(s)); nothing to compare`],
    };
  }
  const tv = validateClassification(ticket, "ticket-derived");
  if (!tv.ok) return { exit: 1, status: "ticket-classification-invalid", lines: [`reconcile: ${tv.errors.join("; ")}`], ticket };
  if (!v.ok) return { exit: 1, status: "commit-trailer-invalid", lines: [`reconcile: HEAD trailer invalid: ${v.errors.join("; ")}`], ticket };
  const cmp = compareClassification(tv.value, v.value);
  const lines = [];
  if (cmp.blocked) {
    lines.push(`reconcile: BLOCK downgrade (${cmp.downgrades.join(", ")}): the commit trailer is lower than the sprint's tickets declared`);
    emit("change-trailer-downgrade-blocked", { sprint, ref: rev, ticket: tv.value, commit: v.value, downgrades: cmp.downgrades }, { log });
    return { exit: 1, status: "downgrade-blocked", lines, ticket: tv.value, commit: v.value, comparison: cmp };
  }
  if (cmp.upgrades.length) {
    lines.push(`reconcile: upgrade allowed (${cmp.upgrades.join(", ")}); logged`);
    emit("change-trailer-upgrade", { sprint, ref: rev, ticket: tv.value, commit: v.value, upgrades: cmp.upgrades }, { log });
  } else lines.push("reconcile: commit trailer matches the ticket-derived classification");
  if (cmp.risks_dropped.length) lines.push(`reconcile: note, ticket risks not named in the commit: ${cmp.risks_dropped.join(", ")}`);
  return { exit: 0, status: cmp.upgrades.length ? "upgrade-allowed" : "match", lines, ticket: tv.value, commit: v.value, comparison: cmp };
}

function parseFlags(argv) {
  const f = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      f._.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    if (eq > 0) {
      f[a.slice(2, eq)] = a.slice(eq + 1);
      continue;
    }
    const k = a.slice(2);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) f[k] = true;
    else {
      f[k] = v;
      i++;
    }
  }
  return f;
}

function readMessageArg(f) {
  if (typeof f.file === "string") return fs.readFileSync(f.file, "utf8");
  if (typeof f.message === "string") return f.message;
  throw new Error("need --file <path> or --message <text>");
}

function isGitGenerated(msg) {
  return /^Merge (branch|remote-tracking branch|pull request|commit|tag)\b/.test(String(msg).replace(/^\s+/, ""));
}

function cli(argv, io) {
  const out = (io && io.out) || ((s) => process.stdout.write(s));
  const err = (io && io.err) || ((s) => process.stderr.write(s));
  const f = parseFlags(argv);
  const cmd = f._[0];
  const root = typeof f.root === "string" ? path.resolve(f.root) : process.cwd();
  try {
    if (cmd === "parse") {
      const msg = readMessageArg(f);
      const p = parse(msg);
      const v = validate(p);
      out(JSON.stringify({ change: p.change, blast: p.blast, risks: p.risks, ok: v.ok, errors: v.errors }) + "\n");
      return v.ok ? 0 : 1;
    }
    if (cmd === "validate") {
      const mode = enforcementMode();
      if (mode === "off") {
        emit("change-trailer-bypass", { mode: "off", root });
        return 0;
      }
      const msg = readMessageArg(f);
      if (f["git-generated-ok"]) {
        const mg = validateMergeGenerated(root);
        if (mg.inherited) {
          if (mg.ok) {
            emit("change-trailer-merge-inherited", { root, change: mg.value.change, blast: mg.value.blast });
            return 0;
          }
          err(blockMessage(mg.errors, "change-trailer (merge tip)"));
          emit("change-trailer-merge-blocked", { root, errors: mg.errors });
          return f.hook ? HOOK_BLOCK_EXIT : 1;
        }
      }
      let sprint = null;
      if (f["if-sprint-active"]) {
        sprint = activeSprint(root);
        if (!sprint.active) return 0;
      }
      const v = validate(msg);
      if (v.ok) return 0;
      if (mode === "report") {
        err(blockMessage(v.errors, "change-trailer (report-only)"));
        emit("change-trailer-report-only", { errors: v.errors, sprint: sprint && sprint.id });
        return 0;
      }
      err(blockMessage(v.errors));
      return f.hook ? HOOK_BLOCK_EXIT : 1;
    }
    if (cmd === "reconcile") {
      if (typeof f.sprint !== "string") {
        err("reconcile requires --sprint <id>\n");
        return 2;
      }
      const r = reconcile({ sprint: f.sprint, root, ref: typeof f.ref === "string" ? f.ref : "HEAD" });
      if (f.json) out(JSON.stringify({ status: r.status, ticket: r.ticket || null, commit: r.commit || null, comparison: r.comparison || null }) + "\n");
      else out(r.lines.join("\n") + "\n");
      return r.exit;
    }
    err("usage: change-trailer.js parse|validate|reconcile (see file header)\n");
    return 2;
  } catch (e) {
    err(`change-trailer: ${e && e.message ? e.message : e}\n`);
    return 2;
  }
}

if (require.main === module) {
  process.exitCode = cli(process.argv.slice(2));
}

module.exports = {
  gitShowAtRef,
  CHANGE_VALUES,
  BLAST_VALUES,
  RISK_VOCAB,
  FIX_LINES,
  TERMINAL_SPRINT_STATUSES,
  HOOK_BLOCK_EXIT,
  parse,
  validate,
  validateClassification,
  validatePartial,
  aggregateClassification,
  compareClassification,
  widenClassification,
  blockMessage,
  enforcementMode,
  activeSprint,
  activeSprintAtRef,
  parseActiveSprintText,
  reconcile,
  isGitGenerated,
  mergeHeadMessage,
  validateMergeGenerated,
  cli,
};
