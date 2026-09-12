# Security policy

## Reporting a vulnerability

Please report vulnerabilities **privately through GitHub**: open the repository's **Security** tab and choose **Report a vulnerability** (GitHub private vulnerability reporting). That creates a private advisory only the maintainer can see. Do not open a public issue, and do not e-mail — there is no e-mail channel for this project.

Repository: `https://github.com/cygaco/WarpOS` (it will be renamed to Master Console; GitHub redirects the old URL, and the Security tab moves with it).

Include what you can: the affected file or skill, the version (`version.json` or `package.json`), reproduction steps, and the impact you see. A proof-of-concept is welcome; a working exploit against a third party's system is not.

## What to expect

This is a single-maintainer project. You will get an acknowledgement in the advisory, a fix or a documented mitigation as quickly as the maintainer can produce one, and credit in the changelog if you want it. Please allow a reasonable disclosure window before publishing details; the maintainer will agree a date with you in the advisory thread.

## Supported versions

Only the **latest release** receives security fixes. Releases are cut from `main` as capsules under `framework/releases/<version>/`; the current version is in `version.json` and `package.json`. Downstream installs upgrade with `/warp:update`.

## What is in scope

Master Console is an agent framework that runs shell commands, edits files and dispatches to provider CLIs on your machine. Reports are especially welcome for:

- **Hooks** (`scripts/hooks/`) — command execution, path or scope guards that can be bypassed, guards that fail open.
- **Dispatch** (`scripts/dispatch/`, `scripts/dispatch-*.js`) — routes that let raw provider calls or API-when-CLI slip through, prompt injection through dispatched content.
- **Installer and updater** (`install.ps1`, `scripts/warp-setup.js`, `scripts/warpos/update.js`) — writes outside the target directory, overwriting operator customizations, unsafe handling of manifests.
- **Scaffold templates** (`_warpos/templates/`) — anything a scaffolded product would ship insecurely (auth, session cookies, admin routes).
- **Ingested content** — the framework treats external documents as data, never instructions (`/scan:ingest-firewall`); a way to make it do otherwise is a vulnerability.

Out of scope: vulnerabilities in the provider CLIs themselves (report those to the vendor), and findings that require an attacker who already controls the operator's machine and account.

## Practical notes for users

- Install the framework only into repositories you trust; hooks run on every prompt and edit.
- Keep provider credentials in the CLIs' own stores; never put keys in tracked files. `/scan:privacy` and `/scan:docker-secrets` exist for exactly this.
- The auto-mode classifier and the guards are the safety floor; if a guard denies an action, the right response is to stop and surface it, not to reshape the command.
