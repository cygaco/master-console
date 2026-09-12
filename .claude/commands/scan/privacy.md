---
description: Pre-publish scan for personal data — credentials, emails, homedir paths, runtime files tracked by git.
user-invocable: true
namespace: check
reads: []
writes: []
---

# /scan:privacy

Run before pushing/publishing (also one of the five `/scan:leak-gate` gates; CI runs it on every push). **Fail-closed since S-OS-04 (ED-417): any HIGH or MED finding exits 1** — placeholder emails (`example.com`, `*.local`, bot addresses …) are dropped via `scripts/check/privacy.allowlist.json`; LOW homedir paths are report-only because the operator is a public figure and old paths in docs/logs are fine (hardcoded paths in executables are `/scan:framework-purity`'s hard finding). Enforcer: `scripts/check/privacy.test.js`. Scans tracked files for the enumerated patterns defined in `scripts/check/privacy.js`. Each pattern carries a severity:

| Pattern id | Severity | What it catches |
|---|---|---|
| credential-sk | HIGH | API token prefixes — OpenAI `sk-`, GitHub `ghp_`, GitLab `glpat-`, AWS `AKIA` |
| credential-pem | HIGH | PEM private-key BEGIN markers (RSA / EC / DSA / OPENSSH / generic) |
| email | MED | RFC-5322 simplified email addresses |
| known-name | MED | Names listed in `.claude/project/memory/known-names.json` (project-specific allowlist) |
| homedir-mac-linux | LOW | Absolute paths `/Users/<name>/...`, `/home/<name>/...` |
| homedir-windows | LOW | Absolute paths `C:\Users\<name>\...` |
| runtime-tracked | HIGH | Any file under `paths.runtime`, `paths.events`, `paths.memory` that is git-tracked (session data should not be committed) |

This is a **closed category set**. The five regex-based categories (credential-sk, credential-pem, email, homedir-mac-linux, homedir-windows) are defined in the `PATTERNS` array in `scripts/check/privacy.js`. The two non-regex categories — `known-name` (project-specific name list) and `runtime-tracked` (git-tracked file under runtime stores) — are implemented as separate code paths in the same script. To add a regex pattern: append to `PATTERNS`. To add a non-regex check: add a code branch and document it here. The skill body intentionally does not embed live credential strings — see the script for the actual regex source.

## Input

```
$ARGUMENTS  →  forwarded to: node scripts/check/privacy.js
  --files <a,b,c>       comma-separated file list (default: all tracked)
  --json                JSON output
  --strict              exit 1 on ANY finding (LOW included)
  --advisory            pre-S-OS-04 behaviour: exit 1 only on HIGH
```

## Output

```
# scanned <N> file(s); <M> finding(s) (<K> HIGH, <J> MED); mode=<default|strict|advisory>
  <SEVERITY>  <file>:<line>  <pattern>  <match>
# result: OK|FAIL (exit 0|1)
```

## Exit codes

- `0` no HIGH or MED findings (default) · no findings at all (`--strict`) · no HIGH findings (`--advisory`)
- `1` any HIGH or MED finding (default, fail-closed since S-OS-04 / ED-417) · any finding under `--strict` · any HIGH under `--advisory`
- `2` usage error

## Empty-state behavior

If no files match the explicit `--files` list (or `git ls-files` is empty), prints `# scanned 0 file(s); 0 finding(s) (0 HIGH)` and exits 0. Empty repo is not a privacy violation.

## Example

```bash
$ node scripts/check/privacy.js --files .claude/manifest.json
# scanned 1 file(s); 0 finding(s) (0 HIGH)
```

## Implementation

```bash
node scripts/check/privacy.js $ARGUMENTS
```

See: `tests/transcripts/check-privacy.md`.
