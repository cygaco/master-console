#!/usr/bin/env node
"use strict";

const { harness, sealedDir } = require("./lib/fixture-harness");
const { trace } = require("./file-usage-trace");

const h = harness("file-usage-trace");

const TARGET = ".claude/project/reference/agent-dispatch-guide.md";

function corpus() {
  return [
    {
      file: "_requirements/03-architecture/SPEC_GRAPH.md",
      body: `See [the guide](${TARGET}) for the dispatch contract.`,
    },
    {
      file: "scripts/dispatch/dispatch-agent.js",
      body: `// loads agent-dispatch-guide.md at runtime\nconst g = "agent-dispatch-guide.md";`,
    },
    {
      file: "framework/releases/0.15.4/.claude/project/reference/agent-dispatch-guide.md",
      body: `frozen historical copy referencing ${TARGET}`,
    },
    {
      file: "scripts/checks/unrelated.js",
      body: `// mentions my-agent-dispatch-guide.markdown and dispatch-guide.md but not the target\nconst x = "agent-dispatch-guideXmd";`,
    },
    { file: TARGET, body: "# Agent Dispatch Guide\nbody references agent-dispatch-guide.md self" },
  ];
}

function findConsumer(res, file) {
  return res.consumers.find((c) => c.file === file);
}

h.pass("finds exactly the 2 live consumers (path + basename), target/non-consumer excluded", () => {
  const res = trace({ target: TARGET, corpus: corpus() });
  return (
    res.totalConsumers === 2 &&
    !!findConsumer(res, "_requirements/03-architecture/SPEC_GRAPH.md") &&
    !!findConsumer(res, "scripts/dispatch/dispatch-agent.js") &&
    !findConsumer(res, "scripts/checks/unrelated.js") &&
    !findConsumer(res, TARGET)
  );
});

h.pass("framework/releases/** match is counted, never listed", () => {
  const res = trace({ target: TARGET, corpus: corpus() });
  return (
    res.snapshotCount === 1 &&
    !res.consumers.some((c) => c.file.startsWith("framework/releases/"))
  );
});

h.pass("both live consumers reference via hardcoded LITERAL (rot risk), tagged accordingly", () => {
  const res = trace({ target: TARGET, corpus: corpus() });
  const doc = findConsumer(res, "_requirements/03-architecture/SPEC_GRAPH.md");
  const script = findConsumer(res, "scripts/dispatch/dispatch-agent.js");
  return (
    res.literalConsumerCount === 2 &&
    doc && doc.reference === "literal" && doc.bucket === "docs" &&
    script && script.reference === "literal" && script.bucket === "scripts/hooks"
  );
});

h.pass("a paths.* token referencing the target is detected and tagged 'token'", () => {
  const registry = { keysForPath: () => [{ key: "agentDispatchGuide" }] };
  const c = corpus().concat([
    { file: "scripts/hooks/lib/some-hook.js", body: 'const g = PATHS.agentDispatchGuide;' },
  ]);
  const res = trace({ target: TARGET, corpus: c, registry });
  const tok = findConsumer(res, "scripts/hooks/lib/some-hook.js");
  return res.resolvedKeys.includes("agentDispatchGuide") && tok && tok.reference === "token";
});

h.pass("a planted path-literal consumer is NEVER missed (a false 'safe to delete' would be the bug)", () => {
  const c = [
    { file: "docs/USES_IT.md", body: `references ${TARGET} explicitly` },
    { file: TARGET, body: "# target" },
  ];
  const res = trace({ target: TARGET, corpus: c });
  return !!findConsumer(res, "docs/USES_IT.md") && res.totalConsumers >= 1;
});

h.violation("a confusable non-consumer (substring/boundary trap) is NEVER reported as a consumer", () => {
  const c = [
    {
      file: "scripts/checks/confusable.js",
      body: 'mentions my-agent-dispatch-guide.markdown, dispatch-guide.md, and "agent-dispatch-guideXmd" — none are the target',
    },
    { file: TARGET, body: "# target" },
  ];
  const res = trace({ target: TARGET, corpus: c });
  const falsePositive = !!findConsumer(res, "scripts/checks/confusable.js");
  return { ok: falsePositive, falsePositive, total: res.totalConsumers };
});

h.failClosed("malformed corpus (null) fails closed rather than reporting 'no consumers'", () => {
  return trace({ target: TARGET, corpus: null });
});

h.done();
