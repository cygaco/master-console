#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { PATHS } = require("../hooks/lib/paths");
const skillHookPoints = require("../skills/skill-hook-points");

const GENERIC_ROLES = new Set([
  "alpha", "beta", "gamma", "delta", "epsilon",
  "general-purpose", "builder", "fixer",
  "skeleton-builder", "stub-scaffold",
]);

const MIGRATION_PENDING = [];
const ALLOWLIST_REASON = "persona allowlist";

const SUBAGENT_TYPE_RE = /subagent_type["'\s:=]+([a-z][a-z0-9-]+)/g;

const BOLD_BACKTICK_ROLE_RE = /\*\*`([a-z][a-z0-9-]+)`\*\*/g;

const DISPATCH_KEYWORD_RE = /\b(subagent|dispatch|resolve|consult)/i;

const STALE_OK_MARKER = "stale-ok";

const JSON_OUT = process.argv.includes("--json");

function derivePersonaStaleNames(aliasMap = require("../hooks/lib/role-aliases").ROLE_ALIASES) {
  const out = new Set();
  for (const [legacy, canonical] of Object.entries(aliasMap || {})) {
    if (typeof canonical !== "string" || (!/^director-/.test(canonical) && !/-lead$/.test(canonical))) continue;
    if (typeof legacy === "string" && legacy.trim()) out.add(legacy.trim());
  }
  return out;
}

function loadCommandFiles(commandsDir = PATHS.commands) {
  const out = [];
  if (!commandsDir || !fs.existsSync(commandsDir)) return out;
  const walk = (dir, ns) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full, ns ? `${ns}/${ent.name}` : ent.name);
      } else if (ent.isFile() && ent.name.endsWith(".md")) {
        const name = ent.name.slice(0, -3);
        const skill = ns ? `${ns}:${name}` : name;
        let body = "";
        try { body = fs.readFileSync(full, "utf8"); } catch { }
        out.push({ skill, path: full, body });
      }
    }
  };
  walk(commandsDir, "");
  return out;
}

function skillToCommandPath(skillId, commandsDir = PATHS.commands) {
  const rel = String(skillId).replace(/:/g, path.sep) + ".md";
  return path.join(commandsDir, rel);
}

function evaluate({
  registry,
  roleIds,
  commandFiles = [],
  personaStaleNames = new Set(),
  personaRoles: personaRolesArg,
  allowlist = new Set(),
}) {
  const findings = [];
  const info = [];

  const rev = skillHookPoints.validate(registry, roleIds);
  if (!rev.ok) {
    for (const e of rev.errors) findings.push({ finding_type: "registry_incoherent", evidence: e });
  }

  const roleIdSet = new Set(roleIds);
  const personaRoles =
    personaRolesArg ||
    new Set(skillHookPoints.hookRows(registry).map((r) => r.role).filter((r) => roleIdSet.has(r)));

  const filePaths = new Set(commandFiles.map((c) => c.path));
  for (const skill of skillHookPoints.skillIds(registry)) {
    const expected = skillToCommandPath(skill);
    if (!fs.existsSync(expected) && !filePaths.has(expected)) {
      findings.push({
        finding_type: "phantom_skill_entry",
        skill,
        evidence: `registered skill '${skill}' has no command file at ${expected}`,
      });
    }
  }

  const registeredSkills = new Set(skillHookPoints.skillIds(registry));

  const allowlistHit = new Set();
  const push = (skillAllowed, finding) => {
    if (skillAllowed) { allowlistHit.add(finding.skill); info.push(finding); }
    else findings.push(finding);
  };

  for (const cf of commandFiles) {
    const allowed = allowlist.has(cf.skill);
    const lines = String(cf.body).split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const suppressed = line.includes(STALE_OK_MARKER);
      if (!suppressed) {
        for (const stale of personaStaleNames) {
          const re = new RegExp(`(?<![A-Za-z0-9-])${escapeRe(stale)}(?![A-Za-z0-9-])`);
          if (re.test(line)) {
            push(allowed, {
              finding_type: "hardcoded_stale_role",
              skill: cf.skill,
              role: stale,
              severity: "high",
              path: cf.path,
              line: i + 1,
              evidence: `${cf.skill} names persona '${stale}' (line ${i + 1}) — a role the registry renamed away (stale; would fail to dispatch)`,
            });
          }
        }
      }

      SUBAGENT_TYPE_RE.lastIndex = 0;
      let m;
      while ((m = SUBAGENT_TYPE_RE.exec(line)) !== null) {
        flagCurrentPersona(m[1]);
      }
      if (DISPATCH_KEYWORD_RE.test(line)) {
        BOLD_BACKTICK_ROLE_RE.lastIndex = 0;
        let b;
        while ((b = BOLD_BACKTICK_ROLE_RE.exec(line)) !== null) {
          flagCurrentPersona(b[1]);
        }
      }

      // eslint-disable-next-line no-inner-declarations
      function flagCurrentPersona(name) {
        if (personaStaleNames.has(name)) return;
        if (GENERIC_ROLES.has(name)) return;
        if (!personaRoles.has(name)) return;
        const type = registeredSkills.has(cf.skill) ? "hardcoded_role" : "unregistered_persona_skill";
        const why =
          type === "hardcoded_role"
            ? `should resolve via skill-hook-points at call time`
            : `dispatches a persona but is not registered in skill-hook-points`;
        push(allowed, {
          finding_type: type,
          skill: cf.skill,
          role: name,
          path: cf.path,
          line: i + 1,
          evidence: `${cf.skill} dispatches persona '${name}' (line ${i + 1}) — ${why}`,
        });
      }
    }
  }

  for (const skill of allowlist) {
    if (!allowlistHit.has(skill)) {
      findings.push({
        finding_type: "stale_allowlist_entry",
        skill,
        evidence: `allowlisted skill '${skill}' (${ALLOWLIST_REASON}) no longer hardcodes a persona role — remove it from the allowlist`,
      });
    }
  }

  return { findings, info };
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function main() {
  let registry, roleIds, roles;
  try {
    registry = skillHookPoints.load();
    roleIds = skillHookPoints.loadRoleIds();
    roles = skillHookPoints.loadRoles();
  } catch (e) {
    process.stderr.write(`ERROR [skill-hook-coverage] cannot read registry/roster: ${e.message}\n`);
    return 2;
  }

  const rev = skillHookPoints.validate(registry, roleIds);
  if (!rev.ok) {
    process.stderr.write(
      `FAIL [skill-hook-coverage] registry incoherent (${rev.errors.length}):\n${rev.errors.map((e) => "  - " + e).join("\n")}\n`,
    );
    return 2;
  }

  const personaStaleNames = derivePersonaStaleNames();
  const commandFiles = loadCommandFiles();
  const allowlist = new Set(MIGRATION_PENDING);

  const { findings, info } = evaluate({ registry, roleIds, commandFiles, personaStaleNames, allowlist });

  const skillsN = skillHookPoints.skillIds(registry).length;
  const filesN = commandFiles.length;
  const tracked = info.length;
  const ok = findings.length === 0;

  if (JSON_OUT) {
    console.log(JSON.stringify({
      ok,
      skills: skillsN,
      command_files: filesN,
      persona_stale_names: [...personaStaleNames].sort(),
      findings: findings.slice(0, 50),
      totalFindings: findings.length,
      info: tracked,
    }));
  } else if (ok) {
    console.log(`OK   [skill-hook-coverage] ${skillsN} skills registered, ${filesN} command files scanned, 0 gaps (${tracked} hardcodes tracked pending migration)`);
  } else {
    process.stderr.write(`FAIL [skill-hook-coverage] ${findings.length} coverage gap(s) (${skillsN} skills, ${filesN} command files):\n`);
    for (const f of findings.slice(0, 15)) process.stderr.write(`  - [${f.finding_type}] ${f.evidence}\n`);
    if (findings.length > 15) process.stderr.write(`  ... and ${findings.length - 15} more\n`);
  }
  return ok ? 0 : 1;
}

if (require.main === module) process.exit(main());

module.exports = { evaluate, derivePersonaStaleNames };
