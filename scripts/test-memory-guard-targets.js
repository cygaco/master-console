#!/usr/bin/env node

const { spawnSync } = require("child_process");
const path = require("path");

const guard = path.join(__dirname, "hooks", "memory-guard.js");
const EVENTS = ".claude/project/events/events.jsonl";
const LEARN = ".claude/project/memory/learnings.jsonl";

function run(cmd) {
  const event = JSON.stringify({
    tool_name: "Bash",
    tool_input: { command: cmd },
  });
  const r = spawnSync(process.execPath, [guard], {
    input: event,
    encoding: "utf8",
    env: { ...process.env, DISABLE_SMART_CONTEXT: "1" },
  });
  let decision = "allow";
  try {
    for (const line of (r.stdout || "").split(/\r?\n/)) {
      if (!line.trim()) continue;
      const parsed = JSON.parse(line);
      if (parsed.decision === "block") {
        decision = "block";
        break;
      }
    }
  } catch {
  }
  return { decision, stderr: r.stderr || "" };
}

const cases = [
  {
    cmd: `git commit -m "restored ${EVENTS.split("/").pop()}"`,
    expect: "allow",
    name: "commit -m message mentions events.jsonl",
  },
  {
    cmd: `git commit --message="prune ${LEARN.split("/").pop()} entries"`,
    expect: "allow",
    name: "commit --message= mentions learnings.jsonl",
  },
  {
    cmd: `git commit -F - <<'EOF'\nrestored events.jsonl from backup\nEOF`,
    expect: "allow",
    name: "heredoc commit body mentions events.jsonl",
  },
  {
    cmd: `rm /tmp/scratch.txt # cleaning up after events.jsonl restore`,
    expect: "allow",
    name: "rm /tmp + events.jsonl only in a comment",
  },
  {
    cmd: `printf "restored events.jsonl\\n" > .git/COMMIT_EDITMSG`,
    expect: "allow",
    name: "printf content names events.jsonl, target is COMMIT_EDITMSG",
  },
  {
    cmd: `git add -A && git commit -m wip # touched ${EVENTS}`,
    expect: "allow",
    name: "git chain, events.jsonl only in trailing comment",
  },

  {
    cmd: `echo x >> ${EVENTS}`,
    expect: "allow",
    name: "append redirect (>>) to events.jsonl",
  },
  {
    cmd: `node -e "require('fs').appendFileSync('${EVENTS}','x')"`,
    expect: "allow",
    name: "appendFileSync to events.jsonl",
  },
  { cmd: `cat ${EVENTS}`, expect: "allow", name: "cat (read) events.jsonl" },

  {
    cmd: `git rm --cached ${EVENTS}`,
    expect: "allow",
    name: "git rm --cached events.jsonl (index-only)",
  },
  {
    cmd: `git rm --cached ${EVENTS} && echo done`,
    expect: "allow",
    name: "git rm --cached events.jsonl chained with && echo (past allSafe)",
  },
  {
    cmd: `node foo.js; git rm --cached ${LEARN}`,
    expect: "allow",
    name: "git rm --cached learnings.jsonl after a ;-chained non-safe cmd",
  },
  {
    cmd: `git rm ${LEARN}`,
    expect: "allow",
    name: "git rm learnings.jsonl (tracked, recoverable delete)",
  },

  {
    cmd: `echo x > ${EVENTS}`,
    expect: "block",
    name: "overwrite redirect (>) to events.jsonl",
  },
  {
    cmd: `echo "" > ${LEARN}`,
    expect: "block",
    name: "overwrite redirect (>) to learnings.jsonl",
  },
  { cmd: `rm ${EVENTS}`, expect: "block", name: "rm of real events.jsonl" },
  {
    cmd: `rm -f ${EVENTS}`,
    expect: "block",
    name: "rm -f of real events.jsonl",
  },
  {
    cmd: `rm ${EVENTS} # oops`,
    expect: "block",
    name: "rm real events.jsonl with trailing comment",
  },
  {
    cmd: `truncate -s 0 ${EVENTS}`,
    expect: "block",
    name: "truncate of events.jsonl",
  },
  {
    cmd: `node -e "require('fs').writeFileSync('${EVENTS}','x')"`,
    expect: "block",
    name: "writeFileSync to events.jsonl",
  },
];

let pass = 0;
let fail = 0;
for (const c of cases) {
  const r = run(c.cmd);
  const ok = r.decision === c.expect;
  if (ok) {
    pass++;
    console.log(`  PASS  ${c.name}  (${r.decision})`);
  } else {
    fail++;
    console.error(
      `  FAIL  ${c.name}  expected=${c.expect} actual=${r.decision}`,
    );
  }
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
