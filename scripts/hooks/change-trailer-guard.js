#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const SEGMENT_OPS = new Set(["&&", "||", ";", "|", "&", "(", ")"]);

function tokenize(cmd) {
  const s = String(cmd);
  const toks = [];
  let i = 0;
  const n = s.length;
  const pendingHeredocs = [];

  const readHeredocBodies = () => {
    while (pendingHeredocs.length) {
      const h = pendingHeredocs.shift();
      const bodyLines = [];
      let found = false;
      while (i < n) {
        let j = s.indexOf("\n", i);
        if (j === -1) j = n;
        const line = s.slice(i, j);
        i = Math.min(j + 1, n);
        const cmp = h.strip ? line.replace(/^\t+/, "") : line;
        if (cmp.replace(/\r$/, "") === h.tag) {
          found = true;
          break;
        }
        bodyLines.push(line.replace(/\r$/, ""));
      }
      toks[h.tokIndex].body = bodyLines.join("\n");
      toks[h.tokIndex].closed = found;
    }
  };

  const readDouble = () => {
    let text = "";
    let dynamic = false;
    while (i < n && s[i] !== '"') {
      const c = s[i];
      if (c === "\\" && i + 1 < n) {
        const nx = s[i + 1];
        if (nx === '"' || nx === "\\" || nx === "$" || nx === "`") text += nx;
        else if (nx === "\n") {
        } else text += c + nx;
        i += 2;
        continue;
      }
      if (c === "$" && s[i + 1] === "(") {
        const hd = /^\$\(\s*cat\s+<<(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2[ \t]*\r?\n/.exec(s.slice(i));
        if (hd) {
          const strip = hd[1] === "-";
          const tag = hd[3];
          let p = i + hd[0].length;
          const bodyLines = [];
          let closed = false;
          while (p < n) {
            let j = s.indexOf("\n", p);
            if (j === -1) j = n;
            const line = s.slice(p, j).replace(/\r$/, "");
            p = Math.min(j + 1, n);
            const cmp = strip ? line.replace(/^\t+/, "") : line;
            if (cmp === tag) {
              closed = true;
              break;
            }
            bodyLines.push(line);
          }
          const rest = /^\s*\)/.exec(s.slice(p));
          if (closed && rest) {
            text += bodyLines.join("\n").replace(/\n+$/, "");
            i = p + rest[0].length;
            continue;
          }
        }
        let depth = 0;
        let p = i + 1;
        for (; p < n; p++) {
          if (s[p] === "(") depth++;
          else if (s[p] === ")") {
            depth--;
            if (depth === 0) break;
          }
        }
        dynamic = true;
        i = Math.min(p + 1, n);
        continue;
      }
      if (c === "`") {
        const e = s.indexOf("`", i + 1);
        dynamic = true;
        i = e === -1 ? n : e + 1;
        continue;
      }
      if (c === "$" && /[A-Za-z_{]/.test(s[i + 1] || "")) {
        dynamic = true;
        text += c;
        i++;
        continue;
      }
      text += c;
      i++;
    }
    i++;
    return { text, dynamic };
  };

  while (i < n) {
    const c = s[i];
    if (c === "\n") {
      toks.push({ type: "op", value: ";" });
      i++;
      readHeredocBodies();
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      i++;
      continue;
    }
    if (c === "#") {
      while (i < n && s[i] !== "\n") i++;
      continue;
    }
    if (c === "&" || c === "|" || c === ";" || c === "(" || c === ")") {
      const two = s.slice(i, i + 2);
      if (two === "&&" || two === "||") {
        toks.push({ type: "op", value: two });
        i += 2;
      } else {
        toks.push({ type: "op", value: c });
        i++;
      }
      continue;
    }
    if (c === "<" && s[i + 1] === "<" && s[i + 2] !== "<") {
      let p = i + 2;
      let strip = false;
      if (s[p] === "-") {
        strip = true;
        p++;
      }
      while (s[p] === " " || s[p] === "\t") p++;
      const m = /^(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(s.slice(p));
      if (m) {
        toks.push({ type: "heredoc", tag: m[2], body: "", closed: false });
        pendingHeredocs.push({ tag: m[2], strip, tokIndex: toks.length - 1 });
        i = p + m[0].length;
        continue;
      }
    }
    let word = "";
    let dynamic = false;
    let any = false;
    while (i < n) {
      const ch = s[i];
      if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") break;
      if (ch === "&" || ch === "|" || ch === ";" || ch === ")") break;
      if (ch === "(" && word === "") break;
      if (ch === "'") {
        const e = s.indexOf("'", i + 1);
        word += s.slice(i + 1, e === -1 ? n : e);
        i = e === -1 ? n : e + 1;
        any = true;
        continue;
      }
      if (ch === '"') {
        i++;
        const r = readDouble();
        word += r.text;
        if (r.dynamic) dynamic = true;
        any = true;
        continue;
      }
      if (ch === "$" && s[i + 1] === "'") {
        i += 2;
        let t = "";
        while (i < n && s[i] !== "'") {
          if (s[i] === "\\" && i + 1 < n) {
            const nx = s[i + 1];
            t += nx === "n" ? "\n" : nx === "t" ? "\t" : nx;
            i += 2;
          } else t += s[i++];
        }
        i++;
        word += t;
        any = true;
        continue;
      }
      if (ch === "\\" && i + 1 < n) {
        if (s[i + 1] !== "\n") word += s[i + 1];
        i += 2;
        any = true;
        continue;
      }
      if (ch === "$" && s[i + 1] === "(") {
        let depth = 0;
        let p = i + 1;
        for (; p < n; p++) {
          if (s[p] === "(") depth++;
          else if (s[p] === ")") {
            depth--;
            if (depth === 0) break;
          }
        }
        dynamic = true;
        i = Math.min(p + 1, n);
        any = true;
        continue;
      }
      if (ch === "`") {
        const e = s.indexOf("`", i + 1);
        dynamic = true;
        i = e === -1 ? n : e + 1;
        any = true;
        continue;
      }
      if (ch === "$" && /[A-Za-z_{]/.test(s[i + 1] || "")) dynamic = true;
      word += ch;
      i++;
      any = true;
    }
    if (any) toks.push({ type: "word", value: word, dynamic });
  }
  return toks;
}

const GIT_GLOBAL_FLAG_WITH_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--super-prefix", "--config-env"]);
const COMMIT_LONG_WITH_VALUE = new Set([
  "author",
  "date",
  "cleanup",
  "trailer",
  "template",
  "reuse-message",
  "reedit-message",
  "fixup",
  "squash",
  "pathspec-from-file",
]);
const SHORT_WITH_VALUE = new Set(["m", "F", "C", "c", "t"]);
const SHORT_OPTIONAL_VALUE = new Set(["u", "S"]);

function splitSegments(toks) {
  const segs = [];
  let cur = [];
  for (const t of toks) {
    if (t.type === "op" && (SEGMENT_OPS.has(t.value) || t.value === ";")) {
      segs.push(cur);
      cur = [];
    } else cur.push(t);
  }
  segs.push(cur);
  return segs.filter((s) => s.length);
}

function toNativePath(p) {
  if (process.platform === "win32") {
    const m = /^\/([a-zA-Z])\/(.*)$/.exec(p);
    if (m) return `${m[1].toUpperCase()}:/${m[2]}`;
  }
  return p;
}

function analyzeCommand(cmd, ctx) {
  const cwd = (ctx && ctx.cwd) || process.cwd();
  const readFile = (ctx && ctx.readFile) || ((p) => fs.readFileSync(p, "utf8"));
  const commits = [];
  if (!/\bcommit\b/.test(String(cmd))) return { commits };
  const toks = tokenize(cmd);
  for (const seg of splitSegments(toks)) {
    let k = 0;
    while (k < seg.length) {
      const t = seg[k];
      if (t.type !== "word") break;
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t.value) || t.value === "env" || t.value === "command" || t.value === "exec" || t.value === "time") k++;
      else break;
    }
    if (k >= seg.length || seg[k].type !== "word" || !/(^|[\\/])git(\.exe)?$/.test(seg[k].value)) continue;
    k++;
    let dir = cwd;
    let sub = null;
    while (k < seg.length) {
      const t = seg[k];
      if (t.type !== "word") {
        k++;
        continue;
      }
      const v = t.value;
      if (v === "-C" && seg[k + 1] && seg[k + 1].type === "word") {
        dir = path.resolve(dir, toNativePath(seg[k + 1].value));
        k += 2;
        continue;
      }
      if (GIT_GLOBAL_FLAG_WITH_VALUE.has(v)) {
        k += 2;
        continue;
      }
      if (v.startsWith("-")) {
        k++;
        continue;
      }
      sub = v;
      k++;
      break;
    }
    if (sub !== "commit") continue;

    const rest = seg.slice(k);
    const heredoc = rest.find((t) => t.type === "heredoc" && t.closed !== false);
    const words = rest.filter((t) => t.type === "word");
    const messages = [];
    const trailers = [];
    let dynamic = false;
    let fileArg = null;
    let amend = false;
    let noEdit = false;
    let reuse = false;
    let fixup = false;
    for (let w = 0; w < words.length; w++) {
      const v = words[w].value;
      if (v === "--") break;
      const takeNext = () => {
        const nx = words[w + 1];
        if (nx) {
          w++;
          if (nx.dynamic) dynamic = true;
          return nx.value;
        }
        return null;
      };
      if (v.startsWith("--")) {
        const eq = v.indexOf("=");
        const name = eq === -1 ? v.slice(2) : v.slice(2, eq);
        const inline = eq === -1 ? null : v.slice(eq + 1);
        if (name === "message") {
          const val = inline !== null ? inline : takeNext();
          if (val !== null) messages.push(val);
          if (words[w].dynamic) dynamic = true;
        } else if (name === "file") {
          fileArg = inline !== null ? inline : takeNext();
        } else if (name === "trailer") {
          const val = inline !== null ? inline : takeNext();
          if (val !== null) trailers.push(val);
        } else if (name === "amend") amend = true;
        else if (name === "no-edit") noEdit = true;
        else if (name === "reuse-message" || name === "reedit-message") {
          reuse = true;
          if (inline === null) takeNext();
        } else if (name === "fixup" || name === "squash") {
          fixup = true;
          if (inline === null) takeNext();
        } else if (COMMIT_LONG_WITH_VALUE.has(name) && inline === null) takeNext();
        continue;
      }
      if (v.startsWith("-") && v.length > 1) {
        for (let ci = 1; ci < v.length; ci++) {
          const ch = v[ci];
          if (SHORT_WITH_VALUE.has(ch)) {
            const attached = v.slice(ci + 1);
            const val = attached !== "" ? attached : takeNext();
            if (attached !== "" && words[w].dynamic) dynamic = true;
            if (ch === "m") {
              if (val !== null) messages.push(val);
            } else if (ch === "F") fileArg = val;
            else if (ch === "C" || ch === "c") reuse = true;
            break;
          }
          if (SHORT_OPTIONAL_VALUE.has(ch)) break;
        }
        continue;
      }
    }

    const base = { dir };
    if (reuse || fixup) {
      commits.push({ ...base, kind: "inherit", why: reuse ? "reuses an existing message (-C/-c)" : "fixup/squash commit" });
      continue;
    }
    let message = null;
    if (messages.length) message = messages.join("\n\n");
    else if (fileArg !== null) {
      if (fileArg === "-") {
        if (heredoc) message = heredoc.body;
        else {
          commits.push({ ...base, kind: "unparseable", why: "-F - with stdin the guard cannot see" });
          continue;
        }
      } else {
        const candidates = [path.resolve(dir, toNativePath(fileArg)), path.resolve(cwd, toNativePath(fileArg))];
        let text = null;
        for (const c of candidates) {
          try {
            text = readFile(c);
            break;
          } catch {
          }
        }
        if (text === null) {
          commits.push({ ...base, kind: "unparseable", why: `-F file not readable: ${fileArg}` });
          continue;
        }
        message = text;
      }
    } else if (amend && noEdit) {
      commits.push({ ...base, kind: "inherit", why: "--amend --no-edit inherits the existing message" });
      continue;
    }
    if (message === null) {
      commits.push({ ...base, kind: "unparseable", why: "no -m / -F (editor message), the commit-msg git hook validates it" });
      continue;
    }
    if (trailers.length) message = `${message.replace(/\s+$/, "")}\n\n${trailers.join("\n")}`;
    commits.push({ ...base, kind: "message", message, dynamic });
  }
  return { commits };
}

function repoRoot(dir) {
  const r = spawnSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8", windowsHide: true, timeout: 5000 });
  if (r.status !== 0) return null;
  const top = String(r.stdout || "").trim();
  return top ? path.resolve(top) : null;
}

const TRACKED_SURFACE_RE = /^(?:scripts|\.claude|framework|tests)\//;

function stagedTrackedSurfacePaths(dir) {
  const r = spawnSync("git", ["-C", dir, "diff", "--cached", "--name-only"], { encoding: "utf8", windowsHide: true, timeout: 5000 });
  if (r.status !== 0) return [];
  return String(r.stdout || "")
    .split(/\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => TRACKED_SURFACE_RE.test(p));
}

function emit(kind, data) {
  try {
    const { log } = require("./lib/logger");
    log("audit", { kind, ...data }, { actor: "system", source: "change-trailer-guard" });
  } catch {
  }
}

function modeFromEnv() {
  try {
    const mcEnv = require("./lib/mc-env");
    const v = String(mcEnv.readEnv("CHANGE_TRAILER") || "")
      .trim()
      .toLowerCase();
    if (v === "off") return "off";
    if (v === "report") return "report";
  } catch {
  }
  return "enforce";
}

function decide(payload) {
  const cmd = payload && payload.tool_input && typeof payload.tool_input.command === "string" ? payload.tool_input.command : "";
  if (!cmd || !/\bcommit\b/.test(cmd)) return { exit: 0 };
  if (payload.tool_name && payload.tool_name !== "Bash") return { exit: 0 };

  const mode = modeFromEnv();
  if (mode === "off") {
    if (/\bgit\b[^\n]*\bcommit\b/.test(cmd)) emit("change-trailer-bypass", { mode: "off" });
    return { exit: 0 };
  }

  const cwd = path.resolve(payload.cwd && payload.cwd !== "." ? payload.cwd : process.cwd());
  const { commits } = analyzeCommand(cmd, { cwd });
  if (!commits.length) return { exit: 0 };

  const CT = require("../checks/change-trailer");
  const problems = [];
  for (const c of commits) {
    if (c.kind !== "message") continue;
    const root = repoRoot(c.dir) || null;
    if (!root) continue;
    const sprint = CT.activeSprint(root);
    let trackedPaths = [];
    if (!sprint.active) {
      trackedPaths = stagedTrackedSurfacePaths(c.dir);
      if (!trackedPaths.length) continue;
    }
    const v = CT.validate(c.message);
    if (v.ok) continue;
    if (c.dynamic) continue;
    problems.push({
      errors: v.errors,
      sprint: sprint.active ? sprint.id : null,
      trigger: sprint.active ? "active_sprint" : "tracked_path",
      trackedPaths: sprint.active ? [] : trackedPaths,
    });
  }
  if (!problems.length) return { exit: 0 };

  const errors = [...new Set(problems.flatMap((p) => p.errors))];
  if (mode === "report") {
    emit("change-trailer-report-only", { errors, sprint: problems[0].sprint, trigger: problems[0].trigger, trackedPaths: problems[0].trackedPaths });
    return { exit: 0, stderr: CT.blockMessage(errors, "change-trailer-guard (report-only)") };
  }
  emit("change-trailer-guard-blocked", { errors, sprint: problems[0].sprint, trigger: problems[0].trigger, trackedPaths: problems[0].trackedPaths });
  return { exit: 2, stderr: CT.blockMessage(errors, "change-trailer-guard") };
}

function main() {
  let raw = "";
  try {
    raw = fs.readFileSync(0, "utf8");
  } catch (e) {
    emit("change-trailer-guard-unreadable-stdin", { error: String((e && e.message) || e).slice(0, 200) });
    process.exit(0);
  }
  let payload;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch (e) {
    emit("change-trailer-guard-bad-input", { error: String((e && e.message) || e).slice(0, 200) });
    process.exit(0);
  }
  let result;
  try {
    result = decide(payload);
  } catch (e) {
    emit("change-trailer-guard-crash", { error: String((e && e.message) || e).slice(0, 200) });
    process.exit(0);
  }
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.exit);
}

process.on("uncaughtException", (e) => {
  emit("change-trailer-guard-crash", { error: String((e && e.message) || e).slice(0, 200) });
  process.exit(0);
});

if (require.main === module) main();

module.exports = { tokenize, analyzeCommand, decide };
