#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

function materialize(opts) {
  const result = { ok: false, bytes: 0, wrote: false, path: null };
  try {
    const { source, reducer, renderer, emptyRender, outPath, root } = opts || {};

    if (typeof source !== "function") {
      throw new Error("materialize: `source` must be a function () => events[]");
    }
    if (typeof renderer !== "function") {
      throw new Error("materialize: `renderer` must be a function (model) => string");
    }
    if (!outPath || typeof outPath !== "string") {
      throw new Error("materialize: `outPath` (string) is required");
    }

    const rootAbs = root ? path.resolve(root) : process.cwd();
    const target = path.isAbsolute(outPath) ? outPath : path.join(rootAbs, outPath);
    result.path = target;

    const events = source() || [];
    let content;
    if (!Array.isArray(events) || events.length === 0) {
      const er = typeof emptyRender === "function" ? emptyRender : () => "";
      content = String(er());
    } else {
      const model = typeof reducer === "function" ? reducer(events) : events;
      content = String(renderer(model));
    }

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf8");

    result.ok = true;
    result.wrote = true;
    result.bytes = Buffer.byteLength(content, "utf8");
    return result;
  } catch (e) {
    result.error = String(e && e.message ? e.message : e);
    return result;
  }
}

module.exports = { materialize };
