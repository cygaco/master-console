# ADR 0042 — Repository role: explicit declarations first, the install record marks an install

**Status:** accepted
**Class:** B (architectural impact)

---

## Decision

Without an override, a tree is the framework repository only when it declares so explicitly, or when it carries a structural framework signal and no install record; otherwise a tree whose `.claude/framework-installed.json` names the framework it came from is a consumer install, and rewriting that record keeps the name.

## Context

Several mechanisms act differently in the framework repository and in a product that installed the framework. The framework-purity guard scans commits only in the framework repository. The admin preview and seed tools refuse to run against the framework repository.

`scripts/mc/repo-role.js` is the single place that decides the role (`scripts/checks/repo-role-single-source.js` fails when another script derives it inline). An installed product carries two files that also exist in the framework repository: its own ownership manifest `_mc/MANIFEST.json`, which every installer writes, and the shipped `version.json`, whose name is `mc`. Those two files cannot tell an install from the framework repository. What does tell them apart is the install record: every installer writes `.claude/framework-installed.json` with a `source` that names the framework it came from (a path or a URL), while the framework repository's own snapshot, written by `scripts/mc/snapshot-installed.js`, records `source` "self".

## Options considered

1. **Drop the structural signals:** decide only from explicit declarations. A framework tree that lacks a declaration would read as a consumer through its own snapshot (or as unknown without one), and the admin guards would refuse it only when it is the root they run from.
2. **Order the signals and gate the structural ones on the install record:** explicit declarations first, structural signals only when there is no install record, then the install record makes the tree a consumer.
3. **Stop installers from writing the shared files:** an install would lose the ownership manifest that `scripts/mc/views/regenerate.js` and `/mc:update` read.

## Decision criteria

| Criterion | Option 1 | Option 2 | Option 3 |
|---|---|---|---|
| Product fit | medium | high | low |
| Simplicity | high | medium | low |
| Reliability | medium | high | medium |
| Reversibility | high | high | low |

## Why this option won

Option 2 keeps every existing framework tree recognised, keeps the admin safety floor closed for a framework tree with no declaration, and makes every installed product that does not declare itself the framework resolve as a consumer, without removing anything the product needs.

## The rule

`resolveRepoRole()` applies these in order; the first that matches wins.

1. An explicit override argument whose value is a valid role.
2. The `MC_REPO_ROLE` environment variable, when its value is a valid role.
3. Explicit declarations, each meaning "canonical": a `.mc-canonical` file at the root; or `.claude/manifest.json` with `repoRole` or `mc.repoRole` set to `canonical` or `framework`, `mc.source` set to `self`, or `project.slug` set to `mc`.
4. Structural signals, counted only when the tree has no install record: `_mc/MANIFEST.json` present, then `version.json` with name `mc`. Either means "canonical".
5. `.claude/framework-installed.json` present: "consumer".
6. Otherwise: "unknown".

An install record is `.claude/framework-installed.json` with a `$schema` beginning `mc/framework-installed/` and a non-empty `source` that is not "self". "self" is compared after trimming whitespace and lowercasing.

`isCanonicalDir(dir)` applies steps 3 and 4 only, without the override and the environment variable, so that a misconfigured environment cannot make the framework tree look like an install to a safety guard.

## The reconcile-baseline rule

`/mc:update --reconcile-baseline`, when it applies (`--apply`), runs the product's own `scripts/mc/snapshot-installed.js`, which rewrites `.claude/framework-installed.json`. Without a `.claude/framework-manifest.json` it re-hashes the existing record in place and leaves its `source` as it is. With one it rebuilds the record: an existing non-empty `source` that is not "self" is kept; otherwise (no record, a record whose `source` is missing or blank, or a "self" record) the rebuilt record has `source` "self".

## Consequences

- Every installed product that does not declare itself the framework resolves as a consumer, through `install.ps1`, `/mc:setup` and `/portfolio:new` alike: the purity guard does not scan its commits, and the admin tools run against it.
- The framework repository resolves through what it declares. A forged install record cannot make it read as a consumer, because explicit declarations are checked first.
- A product whose `.claude/manifest.json` declares `project.slug` `mc` reads as the framework repository. This errs toward refusing, which is the safe direction for the admin guards.
- A product that deletes its install record, or edits its `source` to "self", falls back to the structural signals and reads as the framework repository.
- `scripts/mc/test-repo-role.js` pins the precedence: each explicit declaration resolves canonical next to a forged install record. It also checks that the tree it runs in resolves through an explicit declaration. `scripts/mc/test-scaffold-all-ways.js` checks that the tree from each install path resolves as a consumer, and `scripts/mc/snapshot-installed.test.js` checks the reconcile-baseline rule.

## Risks

- A future installer that writes the record without a `source`, or with `source` "self", would produce an install that reads as the framework repository.
- A framework tree that loses its explicit declaration and also carries an install record would read as a consumer.

## Mitigations

- `scripts/mc/test-scaffold-all-ways.js` runs each install path for real and fails when the tree does not resolve as a consumer.
- The tripwire in `scripts/mc/test-repo-role.js` fails when the framework tree it runs in resolves without an explicit declaration.

## Reversal plan

Remove the install-record gate in `detectCanonicalSignal` and restore the structural signals to their unconditional form. Installs would then resolve as the framework repository again. The trigger for reversal would be a framework layout in which the explicit declarations cannot be kept.

## References

- `scripts/mc/repo-role.js` (`resolveRepoRole`, `isCanonicalDir`, `isSelfInstallSource`)
- `scripts/mc/snapshot-installed.js`
- `scripts/checks/repo-role-single-source.js`
