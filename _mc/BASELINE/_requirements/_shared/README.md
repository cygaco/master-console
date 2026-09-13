# _shared — Shared requirement fragments

Cross-cutting requirement fragments referenced by multiple spec docs (shared
enums, shared acceptance-criteria snippets, shared glossary fragments). Kept
separate so a fragment changes in one place and every referencing doc inherits
it.

This directory is part of the structure-parity skeleton (`/scan:mc-structure-parity`
REQUIRED_DIRS) and is scaffolded into every product by `scripts/mc/scaffold-core.js`
on both fresh install and `/mc:update`.
