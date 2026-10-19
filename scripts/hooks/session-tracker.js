#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { logEvent, log, query } = require("./lib/logger");

const PROJECT = process.env.CLAUDE_PROJECT_DIR || ".";

try {
  if (process.stdin.isTTY) process.exit(0);

  const chunks = [];
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => chunks.push(chunk));
  process.stdin.on("end", () => {
    let event;
    try {
      event = JSON.parse(chunks.join(""));
    } catch {
      process.exit(0);
    }

    const toolName = event?.tool_name || "";
    const toolInput = event?.tool_input || {};
    const toolResponse = event?.tool_response || {};

    let success = true;
    let errorMsg = "";

    if (typeof toolResponse === "string") {
      if (
        toolResponse.includes("error") ||
        toolResponse.includes("Error") ||
        toolResponse.includes("ENOENT") ||
        toolResponse.includes("failed")
      ) {
        success = false;
        errorMsg = toolResponse.slice(0, 200);
      }
    } else if (toolResponse?.error) {
      success = false;
      errorMsg =
        typeof toolResponse.error === "string"
          ? toolResponse.error.slice(0, 200)
          : "error object";
    }

    const filePath = toolInput.file_path || toolInput.command || "";
    const relFile = filePath
      .replace(PROJECT, "")
      .replace(/^[/\\]+/, "")
      .replace(/\\/g, "/")
      .slice(0, 100);

    const keywords = extractKeywords(relFile, toolInput);

    const entry = {
      ts: new Date().toISOString().slice(0, 19),
      tool: toolName,
      success,
      error: errorMsg || undefined,
      file: relFile || undefined,
      keywords,
      terminal: process.env.CLAUDE_SESSION_ID || "unknown",
    };

    log(
      "tool",
      {
        tool: toolName,
        success,
        error: errorMsg || undefined,
        file: relFile || undefined,
        keywords,
      },
      { actor: "alex" },
    );

    if ((toolName === "Write" || toolName === "Edit") && toolInput.file_path) {
      const rel = relFile || "";
      if (
        rel.includes(".claude/runtime/plans/") &&
        !rel.includes("/archive/") &&
        rel.endsWith(".md")
      ) {
        try {
          const content =
            toolName === "Write"
              ? (toolInput.content || "").slice(0, 5000)
              : (toolInput.new_string || "").slice(0, 5000);
          if (content.length > 0) {
            log(
              "plan",
              {
                tool: toolName,
                file: rel,
                content,
                old_content:
                  toolName === "Edit"
                    ? (toolInput.old_string || "").slice(0, 2000)
                    : undefined,
              },
              { actor: "alex" },
            );

            const archiveDir = path.join(
              PROJECT,
              ".claude",
              "plans",
              "archive",
            );
            fs.mkdirSync(archiveDir, { recursive: true });
            const ts = new Date().toISOString().slice(0, 19).replace(/:/g, "");
            const basename = path.basename(toolInput.file_path, ".md");
            const fullContent =
              toolName === "Write"
                ? toolInput.content || ""
                : `[Edit delta]\n\n--- OLD ---\n${toolInput.old_string || ""}\n\n--- NEW ---\n${toolInput.new_string || ""}`;
            fs.writeFileSync(
              path.join(archiveDir, `${ts}-${basename}.md`),
              fullContent.slice(0, 10000),
            );
          }
        } catch {
        }
      }
    }

    if (toolName === "Agent" && toolResponse) {
      try {
        const crypto = require("crypto");
        const responseText =
          typeof toolResponse === "string"
            ? toolResponse
            : JSON.stringify(toolResponse);
        const hash = crypto
          .createHash("sha256")
          .update(responseText.slice(0, 5000))
          .digest("hex")
          .slice(0, 16);

        const prompt = (toolInput.prompt || "").slice(0, 500).toLowerCase();
        let role = "unknown";
        if (/\b(evaluator|reviewer)\b/.test(prompt)) role = "reviewer";
        else if (/security/.test(prompt) && /scan|review|audit/.test(prompt))
          role = "security";
        else if (/compliance/.test(prompt)) role = "compliance";
        else if (/feature:\s*\S+/.test(toolInput.prompt || ""))
          role = "builder";

        const featureMatch = (toolInput.prompt || "").match(
          /feature:\s*(\S+)/i,
        );
        const feature = featureMatch ? featureMatch[1] : "unknown";

        const hashFile = path.join(
          PROJECT,
          ".claude",
          ".agent-result-hashes.json",
        );
        let hashes = {};
        try {
          hashes = JSON.parse(fs.readFileSync(hashFile, "utf8"));
        } catch {
        }
        const key = `${role}-${feature}-${Date.now()}`;
        hashes[key] = {
          hash,
          role,
          feature,
          ts: new Date().toISOString(),
          success,
        };
        const entries = Object.entries(hashes);
        if (entries.length > 50) {
          hashes = Object.fromEntries(entries.slice(-50));
        }
        fs.writeFileSync(hashFile, JSON.stringify(hashes, null, 2), "utf8");

        logEvent(
          "decision",
          "system",
          "agent-result-hashed",
          feature,
          `${role} result hash=${hash} success=${success}`,
        );
      } catch {
      }
    }

    try {
      const claudeDir = path.join(PROJECT, ".claude");
      const checkpointTimePath = path.join(claudeDir, ".last-checkpoint");
      const CHECKPOINT_INTERVAL = 30 * 60 * 1000;

      let lastCheckpoint = 0;
      try {
        if (fs.existsSync(checkpointTimePath)) {
          lastCheckpoint = parseInt(
            fs.readFileSync(checkpointTimePath, "utf8"),
          );
        }
      } catch {
      }

      if (Date.now() - lastCheckpoint > CHECKPOINT_INTERVAL) {
        const checkpoint = {
          timestamp: new Date().toISOString(),
          reason: "periodic",
        };

        const recentPrompts = query({ cat: "prompt", limit: 20 });
        if (recentPrompts.length > 0) {
          checkpoint.promptLog = recentPrompts
            .map((e) => {
              const ts = new Date(e.ts).toISOString().slice(11, 19);
              return `[${ts}] ${(e.data?.stripped || "").slice(0, 200)}`;
            })
            .join("\n");
        }

        const recentTools = query({ cat: "tool", limit: 10 });
        if (recentTools.length > 0) {
          checkpoint.recentTools = recentTools.map((e) => {
            const ts = new Date(e.ts).toISOString().slice(0, 19);
            return `${ts} ${e.data?.tool || "?"} ${e.data?.success ? "ok" : "ERR"} ${e.data?.file || ""}`.trim();
          });
        }

        fs.writeFileSync(
          path.join(claudeDir, ".session-checkpoint.json"),
          JSON.stringify(checkpoint, null, 2),
        );
        fs.writeFileSync(checkpointTimePath, String(Date.now()));
      }
    } catch {
    }

    process.exit(0);
  });
} catch {
  process.exit(0);
}

function extractKeywords(file, input) {
  const words = new Set();

  if (file) {
    const parts = file.split(/[/\\._-]/);
    parts.forEach((p) => {
      if (p.length > 2 && !/^(src|docs|lib|js|ts|tsx|md|json)$/.test(p)) {
        words.add(p.toLowerCase());
      }
    });
  }

  const text = [
    input.old_string || "",
    input.new_string || "",
    input.prompt || "",
    input.command || "",
    input.pattern || "",
  ].join(" ");

  const techTerms =
    text.match(
      /\b(auth|onboarding|profile|extension|skill|step\d+|deploy|security|stripe|redis|claude)\b/gi,
    ) || [];
  techTerms.forEach((t) => words.add(t.toLowerCase()));

  return [...words].slice(0, 10);
}
