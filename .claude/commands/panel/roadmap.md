---
description: Open the roadmap "what's next" panel in your BROWSER — an interactive visual board of active sprints, the prioritized roadmap, epics (with progress), and per-sprint ticket breakdown. A thin /panel:* forwarder to the canonical roadmap-gui server — ZERO duplicated logic. (--text for the read-only terminal board.)
user-invocable: true
namespace: panel
reads: [framework/panel-registry.json, scripts/panel/roadmap-gui.js, scripts/panel/roadmap.js]
says:
  - show me the roadmap
  - open the roadmap panel
  - roadmap board
  - the what's next panel
says-flags:
  text: --text
---

# /panel:roadmap — open the visual roadmap panel (browser)

Thin forwarder. The panel registry (`framework/panel-registry.json`) row `roadmap` names the
canonical opener; this skill carries **zero** board-generation logic — it delegates by shelling the
GUI server, which serves a polished interactive panel on a loopback + token-guarded local port and
opens it in your browser:

```bash
node scripts/panel/roadmap-gui.js
```

The panel is **read-only** and **interactive** — a NEXT-ACTION hero, the prioritized roadmap, active
sprints, epics with progress bars, and per-sprint ticket breakdown; filter / expand-collapse / drill
into a sprint or epic for detail. It is sourced live from ROADMAP / TRACKER / `active-sprints.yaml` /
`trackers/epics/` / the sprint records, and is **never edited from here** (no write endpoints — local
loopback only). All server + render logic lives in `scripts/panel/roadmap-gui.js` (which uses
`scripts/panel/roadmap.js#generate` as its data layer); `/panel:roadmap` is only the unified `panel:`
entry verb.

**Text fallback** (flag: `--text`)**:** `/panel:roadmap --text` shells the v1 read-only terminal board
(`node scripts/panel/roadmap.js`) for a no-browser, at-a-glance view (it is also the shared data layer).

See `/panel:list` for every panel.
