---
description: Temporarily disable a hook by moving it from settings.json into a `_disabled_hooks` section, with a one-step path to re-enable later.
user-invocable: true
tags: [hooks, disable]
---

# /hooks:disable — Disable a Hook

Temporarily disable a hook by commenting it out in settings.json (move to a `_disabled_hooks` key). Report what was disabled.

## Usage

`/hooks:disable cycle-enforcer` → moves cycle-enforcer hook to disabled section
