---
description: Validate the current .claude/manifest.json against the v1 manifest schema and report any drift, missing fields, or schema violations.
user-invocable: true
namespace: manifest
tags: [manifest, validate, schema]
reads: [paths.manifest]
writes: []
---

# /manifest:validate

Run static checks on the manifest:
- Required top-level keys (`$schema`, `project`, `mc`, `agents`)
- Required project keys (`name`, `slug`)
- Required mc keys (`version`, `installed`)
- `mc.version` is semver
- `agentProviders[*]` is one of `claude|openai|gemini`

## Input

```
$ARGUMENTS  →  none
```

## Output

```
W <warning>
E <error>
OK manifest valid (<n> warnings)
FAIL manifest invalid (<n> errors)
```

## Exit codes

- `0` valid (warnings allowed)
- `1` invalid (errors present) OR manifest missing
- `2` usage error

## Example

```bash
$ node scripts/manifest/cli.js validate
OK manifest valid (0 warnings)
```

## Implementation

```bash
node scripts/manifest/cli.js validate
```

See: `tests/transcripts/manifest-validate.md`.
