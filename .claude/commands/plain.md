---
description: Show whether plain-language skill routing is on, what it adds to each session and each message, and how many skills it maps; /plain off and /plain on switch routing (the Skill-tool guard stays on).
user-invocable: true
argument-hint: "[on|off] [--json]"
reads: [paths.manifest, paths.settings, paths.plainState, paths.commands]
writes: [paths.manifest]
---

# /plain

One command for the plain-language layer: see it, and turn its routing on or off.

Plain language has three hooks. Two of them are **routing**: the skill map added once per
session (`scripts/hooks/plain-session.js`) and the one short line added to a message
(`scripts/hooks/plain-prompt.js`). The third is the **guard** (`scripts/hooks/plain-guard.js`),
which stops the model from starting a skill that deletes, deploys or spends. `/plain off`
turns off routing only. The guard stays on whatever this command does; it reads no switch.

## Input

```text
/plain            what is on, what it costs, how many skills
/plain off        routing off
/plain on         routing back on
/plain --json     the same status as JSON
```

## Output

```text
Plain language
  Routing: ON (the default: no switch is set)
  Guard: ON, always. It refuses the <D> deny-class skills when the model starts one, and stays on when routing is off.
  Skill map: <T> tokens, added once per session (ceiling 2,000)
  Per-message line: mean <a>, max <b> tokens over <k> logged lines (ceiling 90)
  Skills mapped: <N>; the user types <A> themselves, <D> are deny-class
  Switch: mc.plain.enabled in .claude/manifest.json. /plain off stops routing; /plain on brings it back. Neither touches the guard.
```

- **Routing** is ON when the switch is absent. It is OFF when `mc.plain.enabled` is `false` in
  `paths.manifest`, or when `MC_PLAIN_OFF=1` is set in the environment (the line says which).
- **Skill map**: the size of the map the session hook adds, from the stored index when it is
  current, otherwise from one built in memory (nothing is written).
- **Per-message line**: re-measured from the local miss log in `paths.plainState`; "nothing
  logged yet" on a fresh project.
- **Deny-class**: the skills the guard refuses when the model calls them, judged the way the
  guard judges a call.

## Steps

1. Run, passing the arguments through:

   ```bash
   node scripts/plain/status.js $ARGUMENTS
   ```

2. Show the output to the person as it is. Do not reword it.
3. Exit 1 means the switch could not be written (for example the manifest is not valid JSON);
   the first line says why and nothing changed. Tell the person that line. Exit 2 is a usage
   error: show the usage line.

## What it changes

- `/plain off` sets `"mc": { "plain": { "enabled": false } }` in `paths.manifest`.
- `/plain on` removes that key again (an absent switch means on), so off then on leaves the
  manifest as it was.
- Nothing else is written. The guard's registration in `paths.settings` is read, never edited.

## Related

- `scripts/hooks/lib/plain/where.js`: where the routing hooks read the switch.
- `scripts/hooks/plain-guard.js`: the guard, its threat model and why nothing turns it off.
