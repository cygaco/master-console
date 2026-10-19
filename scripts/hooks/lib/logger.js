
const mcEnv = require("./mc-env");
const fs = require("fs");
const path = require("path");
const { PROJECT, PATHS } = require("./paths");
const { rotateIfNeeded, rotateSink, SINK_CAPS } = require("./rotate");

const EVENTS_DIR =
  PATHS.events || path.join(PROJECT, ".claude", "project", "events");
const MEMORY_DIR =
  PATHS.memory || path.join(PROJECT, ".claude", "project", "memory");
const RUNTIME_DIR = PATHS.runtime || path.join(PROJECT, ".claude", "runtime");
const LOG_FILE = path.join(EVENTS_DIR, "events.jsonl");
const LEARNINGS_FILE =
  PATHS.learningsFile || path.join(MEMORY_DIR, "learnings.jsonl");
const LOCK_FILE = path.join(PROJECT, ".claude", ".store-lock");
const SESSION_ID_FILE = path.join(RUNTIME_DIR, ".session-id");

const EVENTS_FILE = LOG_FILE;

let WORKSPACE = "";
let WORKSPACE_EVENTS = "";
try {
  const candidates = [];
  if (PATHS.agentSystem) candidates.push(PATHS.agentSystem);
  try {
    const { getAgentName } = require("./project-config");
    const agentName = getAgentName();
    candidates.push(
      path.join(PROJECT, ".claude", "agents", `00-${agentName}`, ".system"),
      path.join(PROJECT, ".claude", "agents", agentName, ".workspace"),
    );
  } catch {
  }
  const dir = candidates.find((d) => d && fs.existsSync(d)) || "";
  if (dir) {
    WORKSPACE = dir;
    WORKSPACE_EVENTS = path.join(dir, "events.jsonl");
  }
} catch {
}

const CATEGORY_FILES = {
  tool: [path.join(EVENTS_DIR, "tools.jsonl")],
  spec: [path.join(EVENTS_DIR, "requirements.jsonl")],
  code: [path.join(EVENTS_DIR, "code.jsonl")],
  plan: [path.join(EVENTS_DIR, "plans.jsonl")],
  requirement_staged: [path.join(EVENTS_DIR, "requirements-staged.jsonl")],
  manager_consult: [path.join(EVENTS_DIR, "manager-consult.jsonl")],
};

if (WORKSPACE) {
  CATEGORY_FILES.alpha = [
    path.join(WORKSPACE, "alpha", "events.jsonl"),
    WORKSPACE_EVENTS,
  ];
  CATEGORY_FILES.beta = [
    path.join(WORKSPACE, "beta", "events.jsonl"),
    WORKSPACE_EVENTS,
  ];
  CATEGORY_FILES.gamma = [
    path.join(WORKSPACE, "gamma", "events.jsonl"),
    WORKSPACE_EVENTS,
  ];
}

let _sessionId = null;
function getSessionId() {
  if (_sessionId) return _sessionId;
  try {
    if (fs.existsSync(SESSION_ID_FILE)) {
      _sessionId = fs.readFileSync(SESSION_ID_FILE, "utf8").trim();
    }
  } catch {
  }
  return _sessionId || "unknown";
}

let _counter = 0;
function nextId() {
  const session = getSessionId();
  const ts = Date.now().toString(36);
  _counter++;
  return `EVT-${session}-${ts}-${_counter}`;
}

let _dirChecked = false;
function ensureDir() {
  if (_dirChecked) return;
  try {
    if (!fs.existsSync(EVENTS_DIR)) {
      fs.mkdirSync(EVENTS_DIR, { recursive: true });
    }
    if (!fs.existsSync(RUNTIME_DIR)) {
      fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    }
    if (!fs.existsSync(MEMORY_DIR)) {
      fs.mkdirSync(MEMORY_DIR, { recursive: true });
    }
    _dirChecked = true;
  } catch {
  }
}

function resolveSprintId(opts) {
  if (opts && typeof opts.sprint_id === "string" && opts.sprint_id.length > 0) {
    return opts.sprint_id;
  }
  if (opts && opts.sprint_id === null) return null;
  if (mcEnv.readEnv("SPRINT_ID")) return mcEnv.readEnv("SPRINT_ID");
  return null;
}

function log(cat, data, opts) {
  try {
    ensureDir();
    const event = {
      id: (opts && opts.id) || nextId(),
      ts: new Date().toISOString(),
      cat: cat || "audit",
      actor: (opts && opts.actor) || "system",
      session: (opts && opts.session) || getSessionId(),
      data: data || {},
    };
    const sid = resolveSprintId(opts);
    if (sid) event.sprint_id = sid;
    rotateSink(LOG_FILE);
    fs.appendFileSync(LOG_FILE, JSON.stringify(event) + "\n", "utf8");

    const catFiles = CATEGORY_FILES[cat];
    if (catFiles) {
      const line = JSON.stringify(event) + "\n";
      for (const f of catFiles) {
        try {
          rotateSink(f);
          fs.appendFileSync(f, line, "utf8");
        } catch {
        }
      }
    }
  } catch {
  }
}

function logEvent(type, actor, action, target, detail, meta) {
  const data = {
    type: type || "unknown",
    action: action || "unknown",
    target: target || "",
    detail: String(detail || "").slice(0, 200),
  };
  if (meta && typeof meta === "object" && Object.keys(meta).length > 0) {
    data.meta = meta;
  }
  const opts = { actor: actor || "unknown" };
  if (meta && typeof meta.sprint_id === "string") {
    opts.sprint_id = meta.sprint_id;
  }
  log("audit", data, opts);
}

function logLearning(entry, opts) {
  try {
    ensureDir();
    if (!entry || typeof entry !== "object") {
      log("audit", {
        type: "warn",
        action: "learning-drop",
        detail: "logLearning called with non-object entry",
      });
      return false;
    }
    if (!entry.tip || !entry.source) {
      log("audit", {
        type: "warn",
        action: "learning-drop",
        detail: `logLearning missing required field: ${!entry.tip ? "tip" : "source"}`,
      });
      return false;
    }

    const normalized = {
      ts: entry.ts || new Date().toISOString().slice(0, 10),
      ...entry,
    };
    if (normalized.status === undefined) normalized.status = "logged";
    if (normalized.score === undefined) normalized.score = 0;

    fs.appendFileSync(
      LEARNINGS_FILE,
      JSON.stringify(normalized) + "\n",
      "utf8",
    );

    log(
      "learning",
      {
        action: "appended",
        source: normalized.source,
        intent: normalized.intent || null,
        tip_preview: String(normalized.tip).slice(0, 120),
      },
      opts,
    );

    return true;
  } catch (e) {
    try {
      log("audit", {
        type: "error",
        action: "logLearning-failed",
        detail: String(e).slice(0, 200),
      });
    } catch {
    }
    return false;
  }
}

function queryFile(file, filters) {
  try {
    if (!fs.existsSync(file)) return [];
    const raw = fs.readFileSync(file, "utf8").trim();
    if (!raw) return [];

    const lines = raw.split("\n");
    const catFilter = filters && filters.cat ? `"cat":"${filters.cat}"` : null;
    const sessionFilter =
      filters && filters.session ? `"session":"${filters.session}"` : null;
    const since = filters && filters.since ? filters.since : null;
    const search =
      filters && filters.search ? filters.search.toLowerCase() : null;
    const limit = filters && filters.limit ? filters.limit : null;

    const results = [];
    const startIdx = 0;

    for (let i = lines.length - 1; i >= startIdx; i--) {
      const line = lines[i];
      if (!line) continue;

      if (catFilter && !line.includes(catFilter)) continue;
      if (sessionFilter && !line.includes(sessionFilter)) continue;
      if (search && !line.toLowerCase().includes(search)) continue;

      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }

      if (since && new Date(entry.ts).getTime() < since) continue;

      results.push(entry);
      if (limit && results.length >= limit) break;
    }

    results.reverse();
    return results;
  } catch {
    return [];
  }
}

function query(filters) {
  return queryFile(LOG_FILE, filters);
}

function queryCategory(cat, filters) {
  const catFiles = CATEGORY_FILES[cat];
  if (catFiles && catFiles[0] && fs.existsSync(catFiles[0])) {
    return queryFile(catFiles[0], { ...filters, cat });
  }
  return query({ ...filters, cat });
}

function acquireStoreLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const stat = fs.statSync(LOCK_FILE);
      const age = Date.now() - stat.mtimeMs;
      if (age < 10000) return false;
    }
    fs.writeFileSync(LOCK_FILE, String(process.pid), "utf8");
    return true;
  } catch {
    return false;
  }
}

function releaseStoreLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE);
  } catch {
  }
}

module.exports = {
  log,
  query,
  queryCategory,
  logEvent,
  logLearning,
  getSessionId,
  acquireStoreLock,
  releaseStoreLock,
  EVENTS_FILE,
  LOG_FILE,
  EVENTS_DIR,
  RUNTIME_DIR,
  MEMORY_DIR,
  LEARNINGS_FILE,
  CATEGORY_FILES,
  rotateIfNeeded,
  SINK_CAPS,
};
