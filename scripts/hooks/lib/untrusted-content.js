"use strict";

const { INJECTION_CLASSES, BUSINESS_VERBS } = require("./injection-patterns");

function findInjection(text) {
  const hits = [];
  if (typeof text !== "string") return hits;
  for (const cls of INJECTION_CLASSES) {
    for (const re of cls.patterns) {
      const m = text.match(re);
      if (m) {
        hits.push({ class: cls.name, match: m[0].slice(0, 80) });
        break;
      }
    }
  }
  return hits;
}

function findBusinessVerbs(text) {
  if (typeof text !== "string") return [];
  const hits = new Set();
  for (const re of BUSINESS_VERBS) {
    const m = text.match(new RegExp(re.source, "gi"));
    if (m) m.forEach((x) => hits.add(x.toLowerCase()));
  }
  return [...hits];
}

function classify(text) {
  const injection = findInjection(text);
  if (injection.length > 0) {
    return { verdict: "reject", injection, stripped_directives: [] };
  }
  const verbs = findBusinessVerbs(text);
  if (verbs.length > 0) {
    return { verdict: "neutralize", injection: [], stripped_directives: verbs };
  }
  return { verdict: "pass", injection: [], stripped_directives: [] };
}

module.exports = { findInjection, findBusinessVerbs, classify };
