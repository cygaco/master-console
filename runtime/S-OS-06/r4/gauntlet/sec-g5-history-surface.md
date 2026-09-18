SECURITY REVIEW — S-OS-06 r4 close. Lane g5-history-surface.

HEAD under review: b3daec9ea110b2e243d878371e4b07f28cfec973
Diff base:         f666c702 (the head the previous security review ran on)

THE POPULATION YOU RECEIVED — read this carefully and do not exceed it:
scripts/open-source/history-surface.js — complete file diff.

This is a SLICE of the change set, not the whole sprint. Your verdict is scoped to the bytes
below. If a concern depends on code you were NOT given, say so explicitly and name what you
would need — do NOT infer it, and do NOT assume another lane covered it.

SCOPE OF REVIEW: security only — OWASP classes, authn/authz, injection, secrets handling,
input validation, path traversal, command construction, unsafe deserialization, TOCTOU,
fail-open logic, and any control whose failure mode is SILENT.

This code is a source-rewriting codemod and its enforcement gates. Pay particular attention
to: predicates that decide whether an occurrence is "protected" or "live"; anything that
could cause a real finding to be counted as already-handled; and any check that can pass
vacuously (matching nothing and reporting success).

OUTPUT — return ONE JSON object and nothing else:
{"verdict":"pass"|"fail","findings":[{"severity":"high"|"medium"|"low","title":"...","file":"...","line":<n>,"why":"...","fix":"..."}],"population_reviewed":"<restate the slice you actually read>","not_assessable":["<anything you could not judge from this slice>"]}

A finding must cite a line present in the diff below. Do not report a finding you cannot site.

===== DIFF =====
diff --git a/scripts/open-source/history-surface.js b/scripts/open-source/history-surface.js
new file mode 100644
index 00000000..4e209230
--- /dev/null
+++ b/scripts/open-source/history-surface.js
@@ -0,0 +1,390 @@
+#!/usr/bin/env node
+"use strict";
+/**
+ * history-surface.js — the population a "history is clean" claim is measured over
+ * (E-OPEN-SOURCE-001 · S-OS-06 r4 · lane D). Library for scripts/open-source/assert-evidence.js step 4.
+ *
+ * WHY THIS EXISTS. The S-OS-03 proof swept history with `git log --all -S<literal> -i`. The pickaxe
+ * searches DIFF content only. It is blind, by construction, to:
+ *   - commit messages (subject + body), author name/email, committer name/email;
+ *   - annotated tag objects (message, tagger, tag name) and ref names;
+ *   - content introduced by a merge commit (`git log` generates no diff for merges without -m).
+ * The history rewrite it certified used blob-only `--replace-text`, so the fix and its proof shared a
+ * blind spot and a purged literal survived in a commit message under a green "0 hits". A naive widening
+ * (`git log --all --format=%B`) would still be defeated by a replace ref, which substitutes the object
+ * git shows; every git call here therefore runs with GIT_NO_REPLACE_OBJECTS=1.
+ *
+ * WHAT IT DOES. Enumerates what a clone of the repository exposes through its refs, applies a
+ * caller-supplied literal set to every surface, and returns SEPARATE per-surface tallies plus the exact
+ * population searched (ref classes + ref-set digest, reachable object counts by type, surfaces searched,
+ * surfaces NOT searched). The matcher is the pickaxe's, unchanged: each literal as a fixed byte string,
+ * ASCII-case-insensitive (`-S<literal> -i`). Only WHERE it is applied widens.
+ *
+ * WHEN IT REFUSES (and returns no tallies at all — never a clean zero over a subset):
+ *   - not a readable repository; shallow history; a grafts file;
+ *   - any reachable object missing (partial clone, corruption) — measured with rev-list --missing=print;
+ *   - a ref (or HEAD) that is missing or peels to a tree/blob (its content is in no commit diff);
+ *   - commit count disagreeing with `rev-list --all --count`; an unreadable object;
+ *   - a declared commit/tag `encoding` this runtime cannot decode;
+ *   - zero literals, or an empty literal (a vacuous sweep never reads green);
+ *   - any git error during the sweep.
+ *
+ * Dependency-free (node + git only). Enforcer of its own contract:
+ * tests/regression/S-OS-06/history-proof-message-surface.test.js (planted-message fixture red → green,
+ * identity/tag/replace/merge mirrors, refusal cases, and the assert-evidence consumer exit codes).
+ */
+const { spawnSync } = require("child_process");
+const crypto = require("crypto");
+const fs = require("fs");
+const path = require("path");
+
+const MAX_BUFFER = 1024 * 1024 * 1024;
+// Env that would silently re-point or narrow what `git -C <repo>` reads (a namespace narrows --all).
+const LOCATOR_ENV = [
+  "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_PREFIX", "GIT_OBJECT_DIRECTORY",
+  "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_NAMESPACE", "GIT_GRAFT_FILE", "GIT_REPLACE_REF_BASE", "GIT_SHALLOW_FILE",
+];
+
+/** Ordered surface list: key → label. Tallies are reported per key, never aggregated. */
+const SURFACES = [
+  ["diffs", "diffs (pickaxe -S -i over --all, merge commits included via -m)"],
+  ["commit.message", "commit message (subject + body)"],
+  ["commit.author.name", "author name"],
+  ["commit.author.email", "author email"],
+  ["commit.committer.name", "committer name"],
+  ["commit.committer.email", "committer email"],
+  ["commit.headers", "other commit headers (encoding, mergetag, gpgsig, unknown)"],
+  ["tag.message", "annotated tag message"],
+  ["tag.tagger.name", "tagger name"],
+  ["tag.tagger.email", "tagger email"],
+  ["tag.name", "annotated tag name header"],
+  ["tag.headers", "other tag headers"],
+  ["refname", "ref names"],
+];
+const NOT_SEARCHED = [
+  "tree entry names (file paths)",
+  "reflogs",
+  "unreachable / dangling objects",
+  "refs and objects not in this repository (other clones, the host's PR/unreachable-object store)",
+];
+const REF_CLASSES = [
+  ["heads", "refs/heads/"],
+  ["tags", "refs/tags/"],
+  ["remotes", "refs/remotes/"],
+  ["notes", "refs/notes/"],
+  ["stash", "refs/stash"],
+  ["replace", "refs/replace/"],
+  ["pull", "refs/pull/"],
+];
+
+class Refusal extends Error {}
+
+function gitEnv() {
+  const env = { ...process.env, GIT_NO_REPLACE_OBJECTS: "1", GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0" };
+  for (const k of LOCATOR_ENV) delete env[k];
+  return env;
+}
+
+/** Run git; non-zero exit or spawn error throws a Refusal. Returns a latin1 byte-string (or Buffer with raw). */
+function git(repo, args, { input, raw = false, allowFail = false } = {}) {
+  const r = spawnSync("git", ["-C", repo, ...args], {
+    env: gitEnv(), input: input === undefined ? undefined : Buffer.from(input, "utf8"), maxBuffer: MAX_BUFFER, windowsHide: true,
+  });
+  if (r.error) throw new Refusal(`git ${args[0]} could not run: ${r.error.message}`);
+  if (r.status !== 0) {
+    if (allowFail) return null;
+    const err = r.stderr ? r.stderr.toString("utf8").trim().split("\n")[0].slice(0, 200) : "";
+    throw new Refusal(`git ${args[0]} exited ${r.status}${err ? `: ${err}` : ""}`);
+  }
+  return raw ? r.stdout : r.stdout.toString("latin1");
+}
+
+const lines = (s) => s.split("\n").map((l) => l.replace(/\r$/, "")).filter(Boolean);
+/** ASCII-only case fold on a byte string — git's `-i` table, so matching never exceeds or falls short of it. */
+const foldAscii = (s) => s.replace(/[A-Z]+/g, (m) => m.toLowerCase());
+/** A JS (UTF-16) string as the byte string git compares. */
+const toBytes = (s) => Buffer.from(String(s), "utf8").toString("latin1");
+const sha256 = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
+
+// ── population ───────────────────────────────────────────────────────────────
+
+function classifyRef(name) {
+  for (const [cls, prefix] of REF_CLASSES) if (name === prefix || name.startsWith(prefix)) return cls;
+  return "other";
+}
+
+function preflight(repo) {
+  const why = [];
+  if (!fs.existsSync(repo)) return [`repository path does not exist: ${repo}`];
+  try {
+    git(repo, ["rev-parse", "--git-dir"]);
+  } catch (e) {
+    return [`not a readable git repository (${e.message})`];
+  }
+  if (git(repo, ["rev-parse", "--is-shallow-repository"]).trim() !== "false") {
+    why.push("shallow repository — history is truncated at the shallow boundary (re-clone without --depth)");
+  }
+  const grafts = git(repo, ["rev-parse", "--git-path", "info/grafts"]).trim();
+  if (grafts && fs.existsSync(path.resolve(repo, grafts))) {
+    why.push("a grafts file is present (info/grafts) — commit ancestry is overridden, the walk is not the object graph");
+  }
+  return why;
+}
+
+/** Everything reachable from --all, by type, plus ref classes. Throws Refusal on any incompleteness. */
+function measurePopulation(repo) {
+  const refusals = preflight(repo);
+  if (refusals.length) throw new Refusal(refusals.join("; "));
+
+  const refs = lines(git(repo, ["for-each-ref", "--format=%(objectname) %(refname)"])).map((l) => {
+    const i = l.indexOf(" ");
+    return { oid: l.slice(0, i), name: l.slice(i + 1) };
+  });
+  const headOid = (git(repo, ["rev-parse", "--verify", "-q", "HEAD"], { allowFail: true }) || "").trim();
+  const tips = headOid ? [...refs, { oid: headOid, name: "HEAD" }] : refs;
+
+  // Every tip must peel to a commit: a tree/blob tip's content is in no commit diff.
+  if (tips.length) {
+    const peeled = lines(git(repo, ["cat-file", "--batch-check=%(objecttype)"], {
+      input: tips.map((t) => `${t.oid}^{}`).join("\n") + "\n",
+    }));
+    if (peeled.length !== tips.length) throw new Refusal(`peeling ${tips.length} ref tip(s) returned ${peeled.length} answer(s)`);
+    const bad = tips.map((t, i) => [t, peeled[i]]).filter(([, type]) => type !== "commit");
+    if (bad.length) {
+      throw new Refusal(`${bad.length} ref(s) do not peel to a commit (${bad.slice(0, 5).map(([t, type]) => `${t.name} → ${type}`).join(", ")}) — their content is not covered by any commit diff`);
+    }
+  }
+
+  const byClass = Object.fromEntries([...REF_CLASSES.map(([c]) => [c, 0]), ["other", 0]]);
+  for (const r of refs) byClass[classifyRef(r.name)]++;
+  const refDigest = sha256(refs.map((r) => `${r.oid} ${r.name}`).sort().join("\n"));
+
+  const listed = lines(git(repo, ["rev-list", "--objects", "--all", "--no-object-names", "--missing=print"]));
+  const missing = listed.filter((l) => l.startsWith("?"));
+  if (missing.length) {
+    throw new Refusal(`${missing.length} reachable object(s) are missing (partial clone or corruption) — e.g. ${missing[0].slice(1, 13)}`);
+  }
+  const types = listed.length
+    ? lines(git(repo, ["cat-file", "--batch-check=%(objectname) %(objecttype)"], { input: listed.join("\n") + "\n" }))
+    : [];
+  if (types.length !== listed.length) throw new Refusal(`typing ${listed.length} object(s) returned ${types.length} answer(s)`);
+  const objects = { total: listed.length, commit: 0, tag: 0, tree: 0, blob: 0 };
+  const commitOids = [];
+  const tagOids = [];
+  for (const t of types) {
+    const [oid, type] = t.split(" ");
+    if (!(type in objects) || type === "total") throw new Refusal(`object ${oid.slice(0, 12)} has unexpected type "${type}"`);
+    objects[type]++;
+    if (type === "commit") commitOids.push(oid);
+    else if (type === "tag") tagOids.push(oid);
+  }
+  const counted = Number(git(repo, ["rev-list", "--all", "--count"]).trim() || "0");
+  if (counted !== objects.commit) {
+    throw new Refusal(`commit count disagreement: rev-list --all --count = ${counted}, typed reachable commits = ${objects.commit}`);
+  }
+
+  return {
+    refs: { total: refs.length, byClass, head: Boolean(headOid), digest: refDigest, names: refs.map((r) => r.name) },
+    objects,
+    commitOids,
+    tagOids,
+  };
+}
+
+// ── object reading + field extraction ────────────────────────────────────────
+
+function readObjects(repo, oids) {
+  const out = new Map();
+  if (!oids.length) return out;
+  const buf = git(repo, ["cat-file", "--batch"], { input: oids.join("\n") + "\n", raw: true });
+  let pos = 0;
+  for (const want of oids) {
+    const nl = buf.indexOf(0x0a, pos);
+    if (nl < 0) throw new Refusal(`cat-file --batch output truncated before ${want.slice(0, 12)}`);
+    const m = /^([0-9a-f]{40,64}) (\S+) (\d+)$/.exec(buf.subarray(pos, nl).toString("latin1"));
+    if (!m || m[1] !== want) throw new Refusal(`object ${want.slice(0, 12)} unreadable via cat-file --batch`);
+    const size = Number(m[3]);
+    const body = buf.subarray(nl + 1, nl + 1 + size);
+    if (body.length !== size) throw new Refusal(`object ${want.slice(0, 12)} truncated (${body.length}/${size} bytes)`);
+    out.set(want, { type: m[2], body });
+    pos = nl + 1 + size + 1;
+  }
+  return out;
+}
+
+function splitObject(text) {
+  const sep = text.indexOf("\n\n");
+  const head = sep < 0 ? text : text.slice(0, sep);
+  const message = sep < 0 ? "" : text.slice(sep + 2);
+  const headers = [];
+  for (const line of head.split("\n")) {
+    if (line.startsWith(" ") && headers.length) headers[headers.length - 1].value += "\n" + line.slice(1);
+    else {
+      const i = line.indexOf(" ");
+      headers.push({ key: i < 0 ? line : line.slice(0, i), value: i < 0 ? "" : line.slice(i + 1) });
+    }
+  }
+  return { headers, message };
+}
+
+/** `Name <email> <ts> <tz>` → { raw, name, email }. A malformed ident keeps its whole value as the name. */
+function parseIdent(value) {
+  const lt = value.indexOf("<");
+  const gt = lt < 0 ? -1 : value.indexOf(">", lt);
+  if (lt < 0 || gt < 0) return { raw: value, name: value, email: "" };
+  return { raw: value, name: value.slice(0, lt).replace(/ +$/, ""), email: value.slice(lt + 1, gt) };
+}
+
+/**
+ * The byte views of one object a literal is matched against: its raw bytes, plus — when it declares a
+ * non-UTF-8 `encoding` — the same object transcoded to UTF-8 (what `git log --format=%B` would show).
+ */
+function objectViews(body, oid) {
+  const raw = body.toString("latin1");
+  const views = [raw];
+  const enc = splitObject(raw).headers.find((h) => h.key === "encoding");
+  const label = enc ? enc.value.trim() : "";
+  if (label && !/^utf-?8$/i.test(label)) {
+    let decoded;
+    try {
+      decoded = new TextDecoder(label).decode(body);
+    } catch {
+      throw new Refusal(`object ${oid.slice(0, 12)} declares encoding "${label}" which this runtime cannot decode`);
+    }
+    views.push(toBytes(decoded));
+  }
+  return views;
+}
+
+/** Field text per surface key for one commit/tag view. Identity surfaces also carry the raw ident line. */
+function fieldsOf(type, text) {
+  const { headers, message } = splitObject(text);
+  const f = {};
+  const add = (k, v) => { (f[k] = f[k] || []).push(v); };
+  if (type === "commit") {
+    add("commit.message", message);
+    for (const h of headers) {
+      if (h.key === "tree" || h.key === "parent") continue;
+      if (h.key === "author" || h.key === "committer") {
+        const id = parseIdent(h.value);
+        add(`commit.${h.key}.name`, id.name);
+        add(`commit.${h.key}.email`, id.email);
+        add(`commit.${h.key}.raw`, id.raw);
+      } else add("commit.headers", `${h.key} ${h.value}`);
+    }
+  } else {
+    add("tag.message", message);
+    for (const h of headers) {
+      if (h.key === "object" || h.key === "type") continue;
+      if (h.key === "tagger") {
+        const id = parseIdent(h.value);
+        add("tag.tagger.name", id.name);
+        add("tag.tagger.email", id.email);
+        add("tag.tagger.raw", id.raw);
+      } else if (h.key === "tag") add("tag.name", h.value);
+      else add("tag.headers", `${h.key} ${h.value}`);
+    }
+  }
+  for (const k of Object.keys(f)) f[k] = f[k].map(foldAscii);
+  return f;
+}
+
+// ── sweep ────────────────────────────────────────────────────────────────────
+
+/**
+ * sweepHistory(repo, literals) →
+ *   { refused: null | string, population, results: [{ digest, length, hits: { <surface>: [id...] }, clean }] }
+ * On refusal `results` is EMPTY — no tally is ever computed over an incomplete population.
+ */
+function sweepHistory(repo, literals) {
+  const absRepo = path.resolve(repo);
+  const empty = (why, population = null) => ({ refused: why, population, results: [] });
+  if (!Array.isArray(literals) || literals.length === 0) return empty("zero literals supplied — a vacuous sweep never reads green");
+  if (literals.some((l) => typeof l !== "string" || l.length === 0)) return empty("an empty literal was supplied — the rules file is malformed");
+
+  let population;
+  try {
+    population = measurePopulation(absRepo);
+  } catch (e) {
+    return empty(e instanceof Refusal ? e.message : `internal error measuring the population (fail-closed): ${e.message}`);
+  }
+
+  try {
+    const needles = literals.map((l) => foldAscii(toBytes(l)));
+    const hits = literals.map(() => Object.fromEntries(SURFACES.map(([k]) => [k, new Set()])));
+
+    const scanObjects = (oids) => {
+      const objs = readObjects(absRepo, oids);
+      for (const oid of oids) {
+        const { type, body } = objs.get(oid);
+        for (const view of objectViews(body, oid)) {
+          const fields = fieldsOf(type, view);
+          needles.forEach((needle, i) => {
+            const has = (key) => (fields[key] || []).some((v) => v.includes(needle));
+            for (const key of Object.keys(fields)) {
+              if (!has(key)) continue;
+              if (key.endsWith(".raw")) {
+                // A literal spanning `name <email>` hits ONLY the raw ident line: count it under the name surface.
+                const base = key.slice(0, -".raw".length);
+                if (!has(`${base}.name`) && !has(`${base}.email`)) hits[i][`${base}.name`].add(oid);
+                continue;
+              }
+              hits[i][key].add(oid);
+            }
+          });
+        }
+      }
+    };
+    // Bounded batches keep a single cat-file --batch stdout well inside MAX_BUFFER on large histories.
+    const all = [...population.commitOids, ...population.tagOids];
+    for (let i = 0; i < all.length; i += 2000) scanObjects(all.slice(i, i + 2000));
+
+    const refBytes = population.refs.names.map((n) => foldAscii(n));
+    needles.forEach((needle, i) => {
+      refBytes.forEach((n, j) => { if (n.includes(needle)) hits[i].refname.add(`ref#${j + 1}`); });
+      const diffOids = lines(git(absRepo, ["log", "--all", "-m", "--format=%H", `-S${literals[i]}`, "-i"]));
+      for (const oid of diffOids) hits[i].diffs.add(oid);
+    });
+
+    const results = literals.map((l, i) => {
+      const h = Object.fromEntries(Object.entries(hits[i]).map(([k, s]) => [k, [...s]]));
+      return { digest: sha256(l), length: l.length, hits: h, clean: Object.values(h).every((a) => a.length === 0) };
+    });
+    return { refused: null, population, results };
+  } catch (e) {
+    return empty(e instanceof Refusal ? e.message : `internal error during the sweep (fail-closed): ${e.message}`, population);
+  }
+}
+
+// ── reporting ────────────────────────────────────────────────────────────────
+
+/** The declared population, as printable lines. Every claim built on a sweep prints these. */
+function formatPopulation(pop) {
+  const c = pop.refs.byClass;
+  const classes = [...REF_CLASSES.map(([k]) => k), "other"].map((k) => `${k} ${c[k]}`).join(" · ");
+  return [
+    "population (GIT_NO_REPLACE_OBJECTS=1; selection = rev-list --all: every ref under refs/ plus HEAD):",
+    `  refs      ${pop.refs.total} — ${classes} · HEAD ${pop.refs.head ? "yes" : "unborn"} · ref-set sha256 ${pop.refs.digest.slice(0, 16)}…`,
+    `  objects   ${pop.objects.total} reachable — commits ${pop.objects.commit} · tags ${pop.objects.tag} · trees ${pop.objects.tree} · blobs ${pop.objects.blob} · missing 0`,
+    `  searched  ${SURFACES.map(([, label]) => label).join(" · ")}`,
+    `  NOT searched (declared, outside this claim): ${NOT_SEARCHED.join(" · ")}`,
+  ];
+}
+
+const SHORT = {
+  diffs: "diffs", "commit.message": "msg", "commit.author.name": "author-name", "commit.author.email": "author-email",
+  "commit.committer.name": "committer-name", "commit.committer.email": "committer-email", "commit.headers": "commit-hdr",
+  "tag.message": "tag-msg", "tag.tagger.name": "tagger-name", "tag.tagger.email": "tagger-email", "tag.name": "tag-name",
+  "tag.headers": "tag-hdr", refname: "refname",
+};
+
+/** One line of separate tallies for a result; hit object ids are printed (never the matched text). */
+function formatTallies(result) {
+  return SURFACES.map(([k]) => {
+    const ids = result.hits[k];
+    const shown = ids.length && k !== "refname" ? ` [${ids.slice(0, 5).map((o) => o.slice(0, 8)).join(",")}${ids.length > 5 ? ",…" : ""}]` : "";
+    return `${SHORT[k]} ${ids.length}${shown}`;
+  }).join(" · ");
+}
+
+module.exports = { SURFACES, NOT_SEARCHED, REF_CLASSES, sweepHistory, measurePopulation, formatPopulation, formatTallies, foldAscii, parseIdent, splitObject };


[END OF SLICE — this is the complete diff for the files named above.]
