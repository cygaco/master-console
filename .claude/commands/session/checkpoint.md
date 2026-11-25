---
description: Save a checkpoint of this session now — captures conversation context and tool activity that git alone cannot recover, so the session can be resumed after a crash or restart.
user-invocable: true
tags: [session, checkpoint, crash-recovery]
---

# /session:checkpoint — Force Checkpoint

Save an immediate checkpoint of current session state. Captures what git can't recover: conversation context and tool activity.

## What Gets Saved

Writes `.claude/runtime/.session-checkpoint.json` (the file session start and `/session:resume` read) with:
- Timestamp + reason: "manual"
- The last 30 prompt rows and the last 10 tool rows from `paths.eventsFile` (categories `prompt` and `tool`), read through the shared logger — the same source the periodic checkpoint in the session-tracker hook uses.

## Procedure

Run once from the project root:

```bash
node -e "const fs=require('fs'),p=require('path'),{query}=require('./scripts/hooks/lib/logger');const t=(e)=>new Date(e.ts).toISOString().slice(0,19);const prompts=query({cat:'prompt',limit:30}).map((e)=>'['+t(e)+'] '+String((e.data&&e.data.stripped)||'').slice(0,200));const tools=query({cat:'tool',limit:10}).map((e)=>(t(e)+' '+((e.data&&e.data.tool)||'?')+' '+(e.data&&e.data.success?'ok':'ERR')+' '+((e.data&&e.data.file)||'')).trim());const rt=p.join('.claude','runtime');fs.mkdirSync(rt,{recursive:true});const ts=new Date().toISOString();fs.writeFileSync(p.join(rt,'.session-checkpoint.json'),JSON.stringify({timestamp:ts,reason:'manual',promptLog:prompts.join('\n'),recentTools:tools},null,2));fs.writeFileSync(p.join('.claude','.last-checkpoint'),String(Date.now()));console.log('Checkpoint saved at '+ts+' | prompts '+prompts.length+' | tool calls '+tools.length)"
```

It also resets `.claude/.last-checkpoint`, the timer the periodic checkpoint reads.

One line output, done.
