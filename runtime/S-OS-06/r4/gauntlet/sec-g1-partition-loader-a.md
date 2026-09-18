SECURITY REVIEW — S-OS-06 r4 close. Lane g1-partition-loader-a.

HEAD under review: b3daec9ea110b2e243d878371e4b07f28cfec973
Diff base:         f666c702 (the head the previous security review ran on)

THE POPULATION YOU RECEIVED — read this carefully and do not exceed it:
scripts/open-source/partition-loader.js — FIRST HALF of its diff (hunks 1..~mid). The second half is reviewed by a separate lane.

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
diff --git a/scripts/open-source/partition-loader.js b/scripts/open-source/partition-loader.js
index 7625bf21..8d6fa774 100644
--- a/scripts/open-source/partition-loader.js
+++ b/scripts/open-source/partition-loader.js
@@ -24,7 +24,9 @@
  *   - findOccurrencePin(file, text)    R4: pins key on (file, matchText [, anchor]) — never
  *                                      a bare line number, so an edit above a pinned line
  *                                      cannot silently break the pin
- *   - historicalChangelogLines(text)   CHANGELOG sections < 2.0.0 are historical record
+ *   - historicalChangelogLines(text)   CHANGELOG sections < 2.0.0 (a SECTION MAP only: it is NOT a legacy-slug
+ *                                      disposition — S-OS-06 r4 B1 retired the inline boolean that absolved
+ *                                      those lines; each such occurrence is closed by its own occurrence pin)
  *   - tallyLegacySlug(...)             per-file disposition tally (pending / pinned /
  *                                      derived / suppressed-per-entry) — the NUMBERS both
  *                                      gates emit
@@ -39,8 +41,8 @@
  *                                      "no occurrence holds two" (a compat member / occurrence
  *                                      that is also a view, glob, future entry or pin)
  *   - checkStale({ trackedFiles })     F7: an entry that matches nothing is a NON-ZERO exit
- *   - checkFreeze()                    F8: post-freeze additions must be separate, warranted
- *                                      `partition-amendment:` commits
+ *   - checkFreeze()                    F8: post-freeze additions AND removals must be separate, warranted
+ *                                      `partition-amendment:` commits (a removal needs a removed:true record)
  *   - findUnroutedReaders()            Req1 guard
  *
  * Fail-closed (F3): a missing, empty, unparseable, or header-less artifact THROWS
@@ -65,7 +67,209 @@ const ROUTED_ENTRY_POINT = "scripts/open-source/partition-loader.js#loadPartitio
 const AMENDMENT_MARKER = "partition-amendment:";
 const VALID_CLASSES = [1, 2, 3, 4];
 const ALLOW_CLASSES = [3, 4];
-const CHANGELOG_REL = "CHANGELOG.md";
+
+// ── evidence-tag + brand-history RULE (S-OS-06 fix-cycle r3, F5-widening / α msg 8f31cee3) ──
+// A prior-art release/evidence tag name `warpos@<semver>` and the sanctioned brand-history phrase
+// `formerly WarpOS` are NEVER a rename candidate and NEVER live-unallowed — dispositioned pinned by
+// RULE (not per-file pins), each under its own emitted sub-count. Every git release tag is `warpos@*`
+// (`git tag -l 'mc@*'` is empty), so a `warpos@<semver>` literal is always a real evidence tag and is
+// kept forever. This is the invariant the 7021ff55 apply violated (it rewrote warpos@0.1.4 -> mc@0.1.4).
+// An actual tag `warpos@0.1.4`, or an evidence-tag REFERENCE used to describe the rule itself
+// (the `warpos@<semver>` placeholder, or this module's own regex source): all are references to the
+// prior-art evidence tag, never a live identifier — the `@`-prefixed slug form is only ever a tag/version
+// spec, so this never masks a real leak. The regex-source occurrence just below is pinned as the loader's
+// own tooling self-reference (like LEGACY_SLUG_NEEDLE).
+// S-OS-06 r4 lane J (β verdict id 8e5f3a02, ledger row 474; α Class B): the RULE does NOT subsume a version-LISTING
+// GLOB — neither the numeric-prefix listing glob the 43f9e007 widening absorbed (`<lab>@0.14*`) nor the bare `<lab>@*`
+// the r3 rule carried. A glob is CHECKABLE, so warranting it by its form would bury the globs that match nothing: it
+// is COMPUTED instead (computeTagGlob below — expanded against the named lab's real tag list, satisfied iff it matches
+// at least one real tag, members emitted). dispositionAt consults the computation BEFORE this RULE and never lets the
+// RULE close a glob token.
+const EVIDENCE_TAG_RE = /warpos@(?:\d+\.\d+\.\d+|<semver>|\\d)/gi;
+const BRAND_HISTORY_RE = /formerly WarpOS/gi;
+/** The rule ("evidence-tag" | "brand-history") covering the needle occurrence at `matchIndex`, or null. */
+function _ruleSpanAt(lineText, matchIndex) {
+  for (const [rule, re] of [["evidence-tag", EVIDENCE_TAG_RE], ["brand-history", BRAND_HISTORY_RE]]) {
+    re.lastIndex = 0;
+    let m;
+    while ((m = re.exec(lineText)) !== null) {
+      if (matchIndex >= m.index && matchIndex < m.index + m[0].length) return rule;
+    }
+  }
+  return null;
+}
+
+// ── COMPUTED version-listing glob (S-OS-06 r4 lane J; β verdict id 8e5f3a02 row 474 "Globs: NOT warranted — COMPUTED") ──
+// THE ONE IMPLEMENTATION. The codemod, both gates (tallyLegacySlug) and the r4 oracles (lane G's cross-lab join and
+// glob resolutions) all call computeTagGlob / readTagList / isTagGlobVersion exported from this module; nothing else
+// expands a tag glob.
+//
+//   A glob token `<lab>@<pattern>` is SATISFIED IFF the pattern expands to at least one REAL tag of the lab it names;
+//   the matched members are EMITTED. A glob that matches nothing is a VIOLATION, presumptively a falsified lab: a
+//   current-lab glob that matches nothing while the legacy-lab equivalent expands gets treatment RESTORE (exactly like
+//   the single-version case, STOP-CONDITION Amendment 2). A tag list that cannot be read on BOTH the local and the
+//   remote method makes every glob UNCOMPUTABLE — never satisfied (fail closed, β R5).
+//
+// Pattern grammar (a version with at least one wildcard): `*`, `x`, or numeric parts where a part may be `x`/`*` and the
+// last part may end in `*` (`0.14*`, `0.*`, `1.2.*`, `1.x`). Expansion: `*` matches any run of characters (git
+// `tag --list` semantics); an `x` part matches one numeric part; the pattern may be followed by further `.`/`-`/`+`
+// segments (a release-line prefix, the r4 oracle (i) convention). Boundary forms stay OUTSIDE the grammar: `@0.14` (no
+// wildcard), `@v0.14*`, `@foo*`, `@x.*`, `@.14*`.
+//
+// The legacy lab is read from the evidence-tag RULE's own (pinned) literal, so this module carries ONE legacy literal.
+const LEGACY_LAB = EVIDENCE_TAG_RE.source.slice(0, EVIDENCE_TAG_RE.source.indexOf("@")).toLowerCase();
+const TAG_GLOB_VERSION_STICKY = /(\*|[xX]|\d+(?:\.(?:\d+|[xX*]))*\.?\*?)(?![A-Za-z0-9_*]|[.-][A-Za-z0-9_*])/y;
+
+/** True iff `version` (the text after `<lab>@`) is a version-listing glob: the grammar above AND at least one wildcard. */
+function isTagGlobVersion(version) {
+  const v = String(version === undefined || version === null ? "" : version);
+  if (v === "*" || /^[xX]$/.test(v)) return true;
+  if (!/^\d+(?:\.(?:\d+|[xX*]))*\.?\*?$/.test(v)) return false;
+  return /[*xX]/.test(v);
+}
+
+/** The anchored RegExp a glob pattern expands through (see the grammar above). Throws on a non-glob. */
+function tagGlobToRegExp(pattern) {
+  if (!isTagGlobVersion(pattern)) throw new TypeError(`partition-loader: ${JSON.stringify(pattern)} is not a version-listing glob`);
+  const src = String(pattern)
+    .split(".")
+    .map((part) => (/^[xX]$/.test(part) ? "\\d+" : part.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")))
+    .join("\\.");
+  return new RegExp(`^${src}(?:[.+-].*)?$`);
+}
+
+function _cmpTagVersion(a, b) {
+  const pa = parseSemver(a);
+  const pb = parseSemver(b);
+  if (pa && pb) return _cmpSemver(pa, pb) || (a < b ? -1 : a > b ? 1 : 0);
+  if (pa || pb) return pa ? -1 : 1;
+  return a < b ? -1 : a > b ? 1 : 0;
+}
+
+/** Tag names -> { byLab: { <lab lower-case>: [versions, sorted] }, nonLab: [names outside the lab@version form] }. */
+function parseTagNames(names) {
+  const byLab = {};
+  const nonLab = [];
+  for (const n of names || []) {
+    const m = /^([A-Za-z][A-Za-z0-9_-]*)@(.+)$/.exec(String(n).trim());
+    if (!m) {
+      if (String(n).trim()) nonLab.push(String(n).trim());
+      continue;
+    }
+    const lab = m[1].toLowerCase();
+    (byLab[lab] = byLab[lab] || []).push(m[2]);
+  }
+  for (const lab of Object.keys(byLab)) byLab[lab] = [...new Set(byLab[lab])].sort(_cmpTagVersion);
+  return { byLab, nonLab };
+}
+
+/**
+ * The repository's REAL tag list, fail-closed (β R5). Method 1: local `git tag -l`. When it holds no legacy-lab tag
+ * (a tag-less worktree / shallow checkout), method 2: `git ls-remote --tags` per remote (origin first). -> { ok: true,
+ * method, names, byLab, nonLab, attempts, legacyLab } — or { ok: false, reason, attempts, legacyLab } when BOTH
+ * methods show no legacy-lab tag. Never throws for an absent list: the caller decides refuse (an oracle) or
+ * uncomputable-never-satisfied (the gates). `remoteFn(remote)` is an injectable spawn result for fixtures.
+ */
+function readTagList({ root = PARTITION_ROOT, remoteFn } = {}) {
+  const attempts = [];
+  const local = _gitRun(root, ["tag", "-l"]);
+  if (local.status === 0) {
+    const names = local.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
+    const parsed = parseTagNames(names);
+    const n = (parsed.byLab[LEGACY_LAB] || []).length;
+    attempts.push(`local git tag -l: ${names.length} tag(s), legacy-lab tags=${n}`);
+    if (n > 0) return { ok: true, method: "local", names, ...parsed, attempts, legacyLab: LEGACY_LAB };
+  } else {
+    attempts.push(`local git tag -l: FAILED (status ${local.status}: ${String(local.stderr || "").trim().slice(0, 120)})`);
+  }
+  const remotesRes = _gitRun(root, ["remote"]);
+  const remotes = remotesRes.status === 0 ? remotesRes.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : [];
+  remotes.sort((a, b) => (a === "origin" ? -1 : b === "origin" ? 1 : a < b ? -1 : 1));
+  for (const remote of remotes) {
+    const r = remoteFn
+      ? remoteFn(remote)
+      : spawnSync("git", ["ls-remote", "--tags", "--", remote], { cwd: root, encoding: "utf8", timeout: 30000, maxBuffer: 64 * 1024 * 1024 });
+    if (!r || r.status !== 0) {
+      attempts.push(`git ls-remote --tags ${remote}: FAILED (${String((r && (r.stderr || (r.error && r.error.message))) || "").trim().slice(0, 120)})`);
+      continue;
+    }
+    const names = [
+      ...new Set(
+        String(r.stdout)
+          .split(/\r?\n/)
+          .map((l) => (/refs\/tags\/(\S+?)(?:\^\{\})?$/.exec(l.trim()) || [])[1])
+          .filter(Boolean)
+      ),
+    ];
+    const parsed = parseTagNames(names);
+    const n = (parsed.byLab[LEGACY_LAB] || []).length;
+    attempts.push(`git ls-remote --tags ${remote}: ${names.length} tag(s), legacy-lab tags=${n}`);
+    if (n > 0) return { ok: true, method: `remote:${remote}`, names, ...parsed, attempts, legacyLab: LEGACY_LAB };
+  }
+  if (!remotes.length) attempts.push("remote listing: no git remote configured");
+  return {
+    ok: false,
+    reason: `the legacy-lab release tags are absent locally AND by remote listing [${attempts.join("; ")}] — a tag list that cannot be read makes every version-listing glob UNCOMPUTABLE (never satisfied)`,
+    attempts,
+    legacyLab: LEGACY_LAB,
+  };
+}
+
+/**
+ * computeTagGlob({ lab, pattern, tags, currentLab, legacyLab }) -> the COMPUTED treatment of ONE glob token.
+ *   tags        readTagList() result, or a bare { byLab } / byLab map. `ok: false` -> uncomputable.
+ *   currentLab  the tree's own release-tag lab (package.json#name); when given, RESTORE is considered only for it.
+ * -> { lab, pattern, satisfied, treatment, members, reason [, restoreTo, legacyMembers] } where treatment is
+ *    "computed-satisfied" (members >= 1) | "restore" (current lab matches nothing, the legacy equivalent expands)
+ *    | "violation" (matches nothing) | "uncomputable" (no readable tag list — never satisfied).
+ * Members are VERSIONS of `lab` (lab and version stored apart — a printout never re-joins them into a new token).
+ */
+function computeTagGlob({ lab, pattern, tags, currentLab = null, legacyLab = LEGACY_LAB } = {}) {
+  const l = String(lab || "").toLowerCase();
+  const leg = String(legacyLab || "").toLowerCase();
+  const re = tagGlobToRegExp(pattern);
+  const base = { lab: l, pattern: String(pattern), members: [] };
+  if (!tags || tags.ok === false) {
+    return {
+      ...base,
+      satisfied: false,
+      treatment: "uncomputable",
+      reason: `tag list unavailable (${(tags && tags.reason) || "none supplied"}) — a glob that cannot be expanded is never satisfied`,
+    };
+  }
+  const byLab = tags.byLab || tags;
+  const expand = (lb) => (Array.isArray(byLab[lb]) ? byLab[lb] : []).filter((v) => re.test(v)).sort(_cmpTagVersion);
+  const members = expand(l);
+  if (members.length) {
+    return { ...base, members, satisfied: true, treatment: "computed-satisfied", reason: `expands to ${members.length} real tag(s) of lab ${l}` };
+  }
+  const cur = currentLab ? String(currentLab).toLowerCase() : null;
+  if (l !== leg && (cur === null || l === cur)) {
+    const legacyMembers = expand(leg);
+    if (legacyMembers.length) {
+      return {
+        ...base,
+        satisfied: false,
+        treatment: "restore",
+        restoreTo: { lab: leg, pattern: String(pattern) },
+        legacyMembers,
+        reason: `matches NO tag of lab ${l} while the legacy-lab equivalent expands to ${legacyMembers.length} real tag(s) — a falsified lab: RESTORE`,
+      };
+    }
+  }
+  return { ...base, satisfied: false, treatment: "violation", reason: `matches NO real tag of lab ${l} — a VIOLATION (presumptively a falsified lab)` };
+}
+
+/** The legacy-lab glob pattern whose token starts at the needle occurrence `matchIndex`, or null (not a glob token). */
+function _legacyGlobPatternAt(lineText, matchIndex) {
+  if (typeof lineText !== "string" || !Number.isInteger(matchIndex) || matchIndex < 0) return null;
+  const at = matchIndex + LEGACY_LAB.length;
+  if (lineText.slice(matchIndex, at).toLowerCase() !== LEGACY_LAB || lineText[at] !== "@") return null;
+  TAG_GLOB_VERSION_STICKY.lastIndex = at + 1;
+  const m = TAG_GLOB_VERSION_STICKY.exec(lineText);
+  return m && isTagGlobVersion(m[1]) ? m[1] : null;
+}
+
 const PLACEHOLDER_WARRANT = /^(todo|tbd|fixme|n\/a|na|none|null|undefined|-+|\.+|\?+|x+)$/i;
 const CODE_EXTENSIONS = new Set([".js", ".cjs", ".mjs", ".ts", ".cts", ".mts", ".ps1", ".sh", ".py"]);
 
@@ -201,8 +405,10 @@ function compatLabel(w) {
 /**
  * The FIVE-disposition view of a legacy-slug tally (β r3b re-ratification). `rewritten` occurrences no longer exist
  * in the tree, so what a gate sees is: pinned (occurrence pins + Class-3 path entries), derived (generated views),
- * compat (unexpired registered windows), historical-allow-listed (Class-4 path entries + CHANGELOG < 2.0.0 sections
- * + the Class-2 operator-gated tree) — and the un-dispositioned residue (live-unallowed, incl. expired compat).
+ * compat (unexpired registered windows), historical-allow-listed (Class-4 path entries + the Class-2 operator-gated
+ * tree) — and the un-dispositioned residue (live-unallowed, incl. expired compat). Every term is closed by a
+ * registered artifact: CHANGELOG < 2.0.0 section lines are NOT a term (S-OS-06 r4 B1 — that inline boolean absolved
+ * occurrences with no register entry behind them; each is now its own occurrence pin, counted under pinned).
  */
 function dispositionSummary(tally) {
   const byClass = (tally && tally.suppressedByClass) || {};
@@ -211,9 +417,11 @@ function dispositionSummary(tally) {
     pinned: (tally.pinnedTotal || 0) + cls(3),
     derived: tally.derivedTotal || 0,
     compat: tally.compatTotal || 0,
-    historicalAllowListed: cls(4) + cls(2) + (tally.changelogHistoricalTotal || 0),
-    historicalAllowListedBreakdown: { class4: cls(4), class2Gated: cls(2), changelogHistorical: tally.changelogHistoricalTotal || 0 },
-    pinnedBreakdown: { occurrencePins: tally.pinnedTotal || 0, class3Paths: cls(3) },
+    historicalAllowListed: cls(4) + cls(2),
+    historicalAllowListedBreakdown: { class4: cls(4), class2Gated: cls(2) },
+    pinnedBreakdown: { occurrencePins: tally.pinnedTotal || 0, class3Paths: cls(3), tagGlobComputed: tally.pinnedTagGlob || 0 },
+    tagGlobSatisfied: { ...(tally.tagGlobSatisfied || {}) },
+    tagGlobResidue: (tally.tagGlobResidue || []).slice(),
     liveUnallowed: tally.pendingTotal || 0,
     compatExpired: tally.compatExpiredTotal || 0,
     compatBySurface: { ...(tally.compatBySurface || {}) },
@@ -313,8 +521,17 @@ function loadPartition({ forceReload = false } = {}) {
   return _cache;
 }
 
-/** Pure: build the partition API from an already-parsed artifact object. */
-function buildPartition(denylist) {
+/**
+ * Build the partition API from an already-parsed artifact object. `tags` (optional) injects the tag list the COMPUTED
+ * glob treatment expands against (a readTagList() result or a bare byLab map); omitted, it is read LAZILY at
+ * PARTITION_ROOT on the first glob token dispositionAt meets (a tree with no glob token never runs git for it).
+ */
+function buildPartition(denylist, { tags } = {}) {
+  let _tagList = tags;
+  const tagList = () => {
+    if (_tagList === undefined) _tagList = readTagList({ root: PARTITION_ROOT });
+    return _tagList;
+  };
   const generatedViews = denylist.generatedViews || [];
   const withRe = (entry) => ({
     ...entry,
@@ -386,6 +603,63 @@ function buildPartition(denylist) {
     return hit ? { window: hit.window, occurrence: hit.occ } : null;
   }
 
+  // Security fix-cycle r2 F1 — the ONE occurrence-scoped disposition choke-point (loader tally + codemod ledger).
+  // A pin/compat covers a needle occurrence ONLY when the occurrence's character index lies inside a span of the
+  // pin/compat matchText on the line (occurrence-scoped, not line-scoped): an extra live slug beside a registered
+  // occurrence on the same line is never absorbed by it.
+  function _indexInMatchText(line, matchText, idx) {
+    if (!matchText) return false;
+    let from = 0;
+    let i;
+    while ((i = line.indexOf(matchText, from)) !== -1) {
+      if (idx >= i && idx < i + matchText.length) return true;
+      from = i + matchText.length;
+    }
+    return false;
+  }
+
+  /**
+   * The COMPUTED treatment of the legacy-lab version-listing glob token starting at this needle occurrence, or null
+   * when the occurrence is not a glob token (computeTagGlob against the partition's tag list).
+   */
+  function tagGlobAt(lineText, matchIndex) {
+    const pattern = _legacyGlobPatternAt(lineText, matchIndex);
+    return pattern === null ? null : computeTagGlob({ lab: LEGACY_LAB, pattern, tags: tagList() });
+  }
+
+  /**

[END OF SLICE — this is the complete diff for the files named above.]
