---
description: Guided introduction to MC — explains everything in simple language, no jargon
---

# /warp:tour — Welcome to MC

A friendly, conversational walkthrough of everything MC can do. Written for someone who's never seen this system before.

## Procedure

### Step 1: Welcome

Say something like:

"Welcome to MC! I'm Alex — your AI development partner. Let me show you around.

MC turns Claude Code from a chat tool into a full development system. Think of it like hiring a small team of specialists that live inside your project. They remember what happened last session, learn from mistakes, and can build features while you grab coffee.

Let me walk you through what you've got."

### Step 2: The Team

Explain the four agents in simple terms:

"You have four team members:

**Alpha** is your architect. When you talk to me, you're talking to Alpha. I plan features, make decisions, and coordinate the team.

**Beta** is your quality checker. Before I make a big decision, I check with Beta to make sure it's the right call. Beta can't write code — it only judges. That's on purpose. The person who builds shouldn't also be the person who reviews.

**Gamma** is your builder manager. When you need a feature built, Gamma sets up an isolated workspace, assigns a builder, and runs four reviewers on the result before it touches your code.

**Delta** is your overnight builder. Give it a list of features and it builds them all autonomously — dispatching builders, running reviews, fixing failures, tracking progress. You sleep, it builds.

You don't need to manage these agents. They work automatically based on which mode you're in."

### Step 3: The Three Modes

"There are three ways to work:

**Solo mode** (`/mode:solo`) — Just you and me. No team, no reviews. Good for quick fixes, config changes, asking questions. This is the simplest mode.

**Adhoc mode** (`/mode:adhoc`) — The default for building features. I plan it, Beta validates the decision, Gamma dispatches a builder into an isolated copy of your code, and four reviewers check the work before it merges. If something fails, a fixer agent tries up to 3 times automatically.

**Oneshot mode** (`/mode:oneshot`) — For building lots of features at once. You need full specs (descriptions of what to build) for this to work. Delta takes over and builds everything in phases. This is the most powerful mode but requires preparation.

Right now you're in solo mode. Try `/mode:adhoc` when you're ready to build your first feature with the team."

### Step 4: Skills You Can Try Right Now

"Here are some things you can do right now:

- `/fix:fast` — Got a bug? Just describe it and I'll find and fix it.
- `/maps:architecture` — See how your project is structured.
- `/learn:deep` — I review what we've learned this session (and from event log + recent retros) and remember it for next time.
- `/session:handoff` — Save everything about this session so the next one picks up where we left off.
- `/sleep:quick` — Let me consolidate what I've learned (takes about 2 minutes).
- `/research:simple` — Need to research something? I'll query multiple AI models and synthesize the results.
- `/portfolio:list` — Manage a portfolio of products from this MC home base. The `/portfolio:*` suite (`list`, `status`, `open`, `new`, `adopt`, `register`, `dispatch`, `sync`, `bootstrap`, `clone`, `import`, `ponder`) is your one namespace for everything product-related. Each product lives in its own private GitHub repo side-by-side with MC on disk; `/portfolio:open <slug> --spawn` opens a fresh Claude session inside it without leaving MC."

Type `/` in the chat to see all available commands."

### Step 5: How Learning Works

"Every session, I learn things — what works, what doesn't, what patterns to watch for. These learnings go through three stages:

1. **Logged** — I noticed something but haven't verified it yet
2. **Validated** — It's been confirmed in practice
3. **Implemented** — A rule now prevents the mistake automatically

Right now your learning store is empty. As we work together, it fills up. After a few sessions, I'll start catching issues before they happen because I've seen similar patterns before.

Run `/sleep:quick` periodically to let me consolidate what I've learned."

### Step 6: What Happens Between Sessions

"When you close this session, I automatically save a handoff document — a summary of what we did, what's pending, and what to pick up next time. When you start a new session, I load that handoff so I remember where we left off.

You can also run `/session:write` to leave a note for your next session, or `/session:read` to check if a previous session left you a message."

### Step 7: Health Check

"Let's make sure everything is set up correctly."

Run `/warp:health` and show the results. If anything is yellow or red, explain what it means and how to fix it in simple terms.

### Step 8: What's Next

"That's the tour! Here's what I'd suggest:

1. **Try `/fix:fast` on a real bug** — see how the diagnostic system works
2. **Run `/maps:all`** — I'll scan your project and build a map of everything
3. **Ask me to help with your product brief** — say 'Help me write a product brief for my project' and I'll interview you about what you're building, then fill in the requirements templates
4. **When you're ready to build a feature**, switch to `/mode:adhoc` and describe what you want

You also have requirements templates in your project (under `_requirements/` if installed, or you can create them). These are like blueprints — they help Alex understand exactly what you want built. I can help you fill them in just by asking you questions about your project.

Everything else — the enforcements, the review pipeline, the memory system — works automatically in the background. You don't need to think about it.

Any questions?"

## Rules

- Use simple, friendly language throughout
- No jargon — if you must use a technical term, explain it immediately
- Match the user's energy — if they're excited, be excited. If they're cautious, be reassuring.
- Don't overwhelm — this is an introduction, not a manual
- If the user asks to skip ahead, respect that
