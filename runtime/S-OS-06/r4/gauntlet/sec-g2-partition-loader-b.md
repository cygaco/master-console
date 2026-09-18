SECURITY REVIEW — S-OS-06 r4 close. Lane g2-partition-loader-b.

HEAD under review: b3daec9ea110b2e243d878371e4b07f28cfec973
Diff base:         f666c702 (the head the previous security review ran on)

THE POPULATION YOU RECEIVED — read this carefully and do not exceed it:
scripts/open-source/partition-loader.js — SECOND HALF of its diff. The first half is reviewed by a separate lane.

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
+   * -> { kind: "compat", window, occurrence } | { kind: "pinned", pin } | { kind: "pinned", rule } | null for the needle
+   * match at matchIndex. A satisfied tag glob -> { kind: "pinned", rule: "tag-glob", glob } (members emitted); an
+   * unsatisfied glob is closed only by compat/pin (tagGlobAt reports its residue treatment separately).
+   */
+  function dispositionAt(file, lineText, matchIndex) {
+    if (typeof lineText !== "string" || !Number.isInteger(matchIndex)) {
+      throw new TypeError("partition-loader: dispositionAt(file, lineText, matchIndex) — pass the LINE TEXT and the match's character index");
+    }
+    const p = _toPosix(file);
+    // COMPUTED first (S-OS-06 r4 lane J): a version-listing glob is closed ONLY by expanding to >= 1 real tag. One that
+    // matches nothing (or cannot be computed) is never closed by the form RULE below — only a registered per-occurrence
+    // warrant can close that residue, and the tally emits every such residue by name (tagGlobAt), never buried.
+    const glob = tagGlobAt(lineText, matchIndex);
+    if (glob && glob.satisfied) return { kind: "pinned", rule: "tag-glob", glob };
+    // RULE (S-OS-06 r3): warpos@<semver> evidence tags + "formerly WarpOS" are pinned-by-rule
+    // everywhere, no per-file pin needed — self-dispositioned, never rewritten. Never consulted for a glob token.
+    const ruleKind = glob ? null : _ruleSpanAt(lineText, matchIndex);
+    if (ruleKind) return { kind: "pinned", rule: ruleKind };
+    // compat is checked BEFORE pins (existing precedence; the loader refuses a line claimed by both).
+    for (const { window, occ } of compatOccurrences) {
+      if (_toPosix(occ.file) !== p) continue;
+      if (!_pinMatchesLine(occ, lineText)) continue; // matchText present + anchor gate
+      if (_indexInMatchText(lineText, occ.matchText, matchIndex)) return { kind: "compat", window, occurrence: occ };
+    }
+    for (const pin of occurrencePins) {
+      if (!_pinFileCandidates(pin.file).includes(p)) continue;
+      if (!_pinMatchesLine(pin, lineText)) continue;
+      if (_indexInMatchText(lineText, pin.matchText, matchIndex)) return { kind: "pinned", pin };
+    }
+    return null;
+  }
+
   function isGeneratedView(file) {
     return generatedViewByPath.has(_toPosix(file));
   }
@@ -421,9 +695,15 @@ function buildPartition(denylist) {
       pendingSamples: {},
       pinnedTotal: 0,
       pinnedByPin: {},
+      pinnedEvidenceTag: 0,
+      pinnedBrandHistory: 0,
+      // S-OS-06 r4 lane J: COMPUTED version-listing globs. Satisfied ones are a pinned sub-kind with their MEMBERS
+      // emitted per (lab, pattern); a glob matching nothing is emitted by name whether a warrant closes it or not.
+      pinnedTagGlob: 0,
+      tagGlobSatisfied: {},
+      tagGlobResidue: [],
       derivedTotal: 0,
       derivedByView: {},
-      changelogHistoricalTotal: 0,
       suppressedTotal: 0,
       suppressedByEntry: {},
       suppressedByClass: {},
@@ -503,29 +783,51 @@ function buildPartition(denylist) {
       add(tally.suppressedByClass, cls.class, n);
       return;
     }
-    const hist = p === CHANGELOG_REL ? historicalChangelogLines(content) : null;
     content.split(/\r?\n/).forEach((lineText, idx) => {
-      const n = count(lineText);
-      if (!n) return;
+      // Security fix-cycle r2 F1: one disposition per needle OCCURRENCE (dispositionAt), never one per line — a
+      // compat/pin match on the line no longer credits every hit on that line.
       // compat is checked BEFORE pins; validateEntries/checkStale refuse a line claimed by both (no occurrence holds two).
-      const comp = findCompatOccurrence(p, lineText);
-      if (comp) {
-        addCompat(comp.window, n, idx + 1, lineText);
-        return;
-      }
-      const pin = findOccurrencePin(p, lineText);
-      if (pin) {
-        tally.pinnedTotal += n;
-        add(tally.pinnedByPin, _pinLabel(pin), n);
-        return;
-      }
-      if (hist && hist.has(idx + 1)) {
-        tally.changelogHistoricalTotal += n;
-        return;
+      // S-OS-06 r4 B1: NO section-based absolution — a CHANGELOG < 2.0.0 line is closed only by a registered
+      // disposition like every other line; an unregistered occurrence there is live-unallowed (RED), never a pass.
+      reAll.lastIndex = 0;
+      let m;
+      while ((m = reAll.exec(lineText)) !== null) {
+        const at = dispositionAt(p, lineText, m.index);
+        const glob = at && at.rule === "tag-glob" ? at.glob : tagGlobAt(lineText, m.index);
+        if (glob && !glob.satisfied) {
+          // the zero-matching / uncomputable glob residue: emitted by name, closed or not (never buried under a count)
+          tally.tagGlobResidue.push({
+            file: p,
+            line: idx + 1,
+            lab: glob.lab,
+            pattern: glob.pattern,
+            treatment: glob.treatment,
+            reason: glob.reason,
+            closedBy: at && at.kind === "compat" ? `compat ${compatLabel(at.window)}` : at && at.kind === "pinned" ? _pinLabel(at.pin) : null,
+          });
+        }
+        if (at && at.kind === "compat") {
+          addCompat(at.window, 1, idx + 1, lineText);
+        } else if (at && at.kind === "pinned") {
+          tally.pinnedTotal += 1;
+          if (at.rule === "tag-glob") {
+            tally.pinnedTagGlob += 1;
+            const k = `lab ${at.glob.lab} pattern ${at.glob.pattern}`;
+            const row = tally.tagGlobSatisfied[k] || (tally.tagGlobSatisfied[k] = { occurrences: 0, members: at.glob.members.slice() });
+            row.occurrences += 1;
+          } else if (at.rule === "evidence-tag") tally.pinnedEvidenceTag += 1;
+          else if (at.rule === "brand-history") tally.pinnedBrandHistory += 1;
+          else add(tally.pinnedByPin, _pinLabel(at.pin), 1);
+        } else {
+          tally.pendingTotal += 1;
+          add(tally.pendingByFile, p, 1);
+          if (!tally.pendingSamples[p]) {
+            tally.pendingSamples[p] = glob
+              ? `${idx + 1}: version-listing glob ${glob.treatment.toUpperCase()} — ${glob.reason}`
+              : `${idx + 1}: ${lineText.trim().slice(0, 160)}`;
+          }
+        }
       }
-      tally.pendingTotal += n;
-      add(tally.pendingByFile, p, n);
-      if (!tally.pendingSamples[p]) tally.pendingSamples[p] = `${idx + 1}: ${lineText.trim().slice(0, 160)}`;
     });
   }
 
@@ -540,11 +842,23 @@ function buildPartition(denylist) {
       ...sortDesc(tally.compatBySurface || {}).map(([k, v]) => [`compat ${k}`, v]),
       ...sortDesc(tally.compatExpiredBySurface || {}).map(([k, v]) => [`compat-EXPIRED ${k} (counted live-unallowed)`, v]),
     ];
-    if (tally.changelogHistoricalTotal) rows.push([`changelog-historical ${CHANGELOG_REL} (< 2.0.0 sections)`, tally.changelogHistoricalTotal]);
+    if (tally.pinnedEvidenceTag) rows.push([`pinned:evidence-tag (warpos@<semver> — kept forever, by RULE)`, tally.pinnedEvidenceTag]);
+    if (tally.pinnedBrandHistory) rows.push([`pinned:brand-history ("formerly WarpOS" — by RULE)`, tally.pinnedBrandHistory]);
+    if (tally.pinnedTagGlob) rows.push([`pinned:tag-glob (version-listing glob COMPUTED against the real tag list — satisfied iff >= 1 member, members below)`, tally.pinnedTagGlob]);
     if (rows.length === 0) lines.push(`${indent}  (none)`);
     for (const [k, v] of rows) lines.push(`${indent}  ${String(v).padStart(7)}  ${k}`);
+    for (const [k, row] of Object.entries(tally.tagGlobSatisfied || {}).sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
+      lines.push(`${indent}    tag-glob ${k}: ${row.occurrences} occurrence(s) -> ${row.members.length} member(s): ${row.members.join(" ")}`);
+    }
+    const residue = tally.tagGlobResidue || [];
     lines.push(
-      `${indent}totals: suppressed=${tally.suppressedTotal} pinned=${tally.pinnedTotal} derived=${tally.derivedTotal} changelog-historical=${tally.changelogHistoricalTotal} live-unallowed=${tally.pendingTotal}`
+      `${indent}  tag-glob residue (matches NO real tag or uncomputable — a violation unless a registered warrant closes it): ${residue.length}${residue.length ? "" : " (none)"}`
+    );
+    for (const r of residue) {
+      lines.push(`${indent}    ${r.file}:${r.line} lab ${r.lab} pattern ${r.pattern} -> ${r.treatment.toUpperCase()}${r.closedBy ? ` · closed by ${r.closedBy}` : " · UNCLOSED (live-unallowed)"}`);
+    }
+    lines.push(
+      `${indent}totals: suppressed=${tally.suppressedTotal} pinned=${tally.pinnedTotal} derived=${tally.derivedTotal} live-unallowed=${tally.pendingTotal}`
     );
     const d = dispositionSummary(tally);
     lines.push(
@@ -897,6 +1211,10 @@ function buildPartition(denylist) {
       const f = dl && dl.$freeze;
       return new Set(((f && f.amendments) || []).map((a) => a && a.key).filter((k) => typeof k === "string"));
     };
+    const removalKeysOf = (dl) => {
+      const f = dl && dl.$freeze;
+      return new Set(((f && f.amendments) || []).filter((a) => a && a.removed === true).map((a) => a.key).filter((k) => typeof k === "string"));
+    };
     for (const a of freeze.amendments || []) {
       if (!a || typeof a.key !== "string" || !a.key) {
         problems.push({ id: "F8", key: "$freeze.amendments", message: "an amendment record has no key" });
@@ -906,14 +1224,23 @@ function buildPartition(denylist) {
     }
     const baseSet = new Set(baseline || []);
     const amendSet = amendmentKeysOf(denylist);
-    for (const k of entryKeys(denylist)) {
+    const removalSet = removalKeysOf(denylist);
+    const nowKeys = new Set(entryKeys(denylist));
+    // β R4 — the freeze is key-set EQUALITY, not "no additions": an ADDITION and a REMOVAL both need a
+    // warranted amendment. An unamended removal could silently retire a pin/entry that still guards a live leak.
+    for (const k of nowKeys) {
       if (!baseSet.has(k) && !amendSet.has(k)) {
         problems.push({ id: "F8", key: k, message: `post-freeze silent addition '${k}' — not in the frozen baseline and no warranted amendment record` });
       }
     }
+    for (const k of baseSet) {
+      if (!nowKeys.has(k) && !removalSet.has(k)) {
+        problems.push({ id: "F8", key: k, message: `post-freeze silent removal '${k}' — a frozen baseline entry is gone with no warranted amendment record (a removal must be amended too)` });
+      }
+    }
 
-    // git layer: every post-freeze commit that ADDS an entry must be a separate,
-    // partition-only, marked amendment; the baseline itself is immutable after freeze.
+    // git layer: every post-freeze commit that ADDS or REMOVES an entry key must be a separate,
+    // partition-only, marked amendment with a record per key; the baseline itself is immutable after freeze.
     const inside = _gitRun(root, ["rev-parse", "--is-inside-work-tree"]);
     if (inside.status !== 0 || inside.stdout.trim() !== "true") {
       throw new PartitionLoadError(`partition-loader: F8 needs git history but ${root} is not a git work tree — failing CLOSED`);
@@ -923,7 +1250,9 @@ function buildPartition(denylist) {
     }
     const rel = _toPosix(path.relative(root, DENYLIST_PATH));
     const ledgerRel = _toPosix(path.relative(root, COMMITTED_LEDGER_PATH));
-    const log = _gitRun(root, ["log", "--no-merges", "--reverse", "--format=%H", "--", rel]);
+    // Security fix-cycle r2 F2: merge commits ARE inspected (no --no-merges) — an entry introduced by a merge commit
+    // (evil merge / conflict resolution) is judged exactly like any other post-freeze addition.
+    const log = _gitRun(root, ["log", "--reverse", "--format=%H", "--", rel]);
     if (log.status !== 0) {
       // A repo with no commits yet has no history to judge — the worktree layer above still ran.
       if (/does not have any commits|bad default revision/i.test(log.stderr || "")) {
@@ -935,6 +1264,12 @@ function buildPartition(denylist) {
     const commits = log.stdout.split(/\r?\n/).filter(Boolean);
     let freezeCommit = null;
     let frozenBaseline = null;
+    // The swept history population, emitted beside the result (a zero over no inspected commits is not a clean zero).
+    let historyInspected = 0;
+    let historyAdding = 0;
+    let historyRemoving = 0;
+    let historyKeysAdded = 0;
+    let historyKeysRemoved = 0;
     for (const c of commits) {
       let at;
       try {
@@ -962,10 +1297,33 @@ function buildPartition(denylist) {
       } catch {
         parent = null;
       }
+      historyInspected += 1;
       const before = new Set(parent ? entryKeys(parent) : []);
-      const added = entryKeys(at).filter((k) => !before.has(k));
-      if (added.length === 0) continue;
-      const files = _gitRun(root, ["diff-tree", "--no-commit-id", "--name-only", "-r", c]).stdout.split(/\r?\n/).filter(Boolean).map(_toPosix);
+      const nowAt = entryKeys(at);
+      const nowAtSet = new Set(nowAt);
+      const added = nowAt.filter((k) => !before.has(k));
+      // S-OS-06 r4 B2: the REMOVED set (parent minus this commit) gets the same history teeth as additions. Before r4
+      // this loop continued whenever nothing was ADDED, so a removal-amendment could ride a live-code commit unseen.
+      const removed = [...before].filter((k) => !nowAtSet.has(k)).sort();
+      if (added.length === 0 && removed.length === 0) continue;
+      if (added.length) {
+        historyAdding += 1;
+        historyKeysAdded += added.length;
+      }
+      if (removed.length) {
+        historyRemoving += 1;
+        historyKeysRemoved += removed.length;
+      }
+      const change = [added.length ? `adds [${added.join(", ")}]` : null, removed.length ? `removes [${removed.join(", ")}]` : null]
+        .filter(Boolean)
+        .join(" and ");
+      // First-parent diff (F2): identical to the single-parent set for a normal commit; for a merge it is everything the
+      // merge introduced relative to its first parent (diff-tree prints nothing for a merge). Fails CLOSED on a git error.
+      const diff = _gitRun(root, ["diff", "--name-only", `${c}^`, c]);
+      if (diff.status !== 0) {
+        throw new PartitionLoadError(`partition-loader: F8 git diff ${short}^ ${short} failed: ${(diff.stderr || "").trim()} — failing CLOSED`);
+      }
+      const files = diff.stdout.split(/\r?\n/).filter(Boolean).map(_toPosix);
       const foreign = files.filter((f) => f !== rel && f !== ledgerRel);
       const message = _gitRun(root, ["log", "-1", "--format=%B", c]).stdout;
       const amendedHere = amendmentKeysOf(at);
@@ -973,18 +1331,35 @@ function buildPartition(denylist) {
         problems.push({
           id: "F8",
           key: short,
-          message: `commit ${short} adds allow-list entr${added.length === 1 ? "y" : "ies"} [${added.join(", ")}] inside a commit that also changes ${foreign.slice(0, 5).join(", ")} — a post-freeze addition must be its OWN warranted amendment commit, never folded into a gate-fixing commit`,
+          message: `commit ${short} ${change} inside a commit that also changes ${foreign.slice(0, 5).join(", ")} — a post-freeze addition or removal must be its OWN warranted amendment commit, never folded into a gate-fixing commit`,
         });
       }
       if (!message.includes(AMENDMENT_MARKER)) {
-        problems.push({ id: "F8", key: short, message: `commit ${short} adds [${added.join(", ")}] without the '${AMENDMENT_MARKER}' marker in its message` });
+        problems.push({ id: "F8", key: short, message: `commit ${short} ${change} without the '${AMENDMENT_MARKER}' marker in its message` });
       }
       for (const k of added) {
         if (!amendedHere.has(k)) problems.push({ id: "F8", key: k, message: `commit ${short} adds '${k}' without an amendment record in $freeze.amendments` });
       }
+      // A removal is warranted only by an explicit REMOVAL record ({key, removed: true, warrant}) — an entry's own ADDITION
+      // record does not warrant retiring it. The record may sit at the removing commit or on the current artifact
+      // (a later, still-registered removal record; the β R4 precedent of 8f1bfd87), but it must exist somewhere.
+      const removalRecordsHere = removalKeysOf(at);
+      for (const k of removed) {
+        if (!removalRecordsHere.has(k) && !removalSet.has(k)) {
+          problems.push({
+            id: "F8",
+            key: k,
+            message: `commit ${short} removes '${k}' without a removal amendment record ({key, removed: true, warrant}) in $freeze.amendments — neither at that commit nor on the current artifact`,
+          });
+        }
+      }
     }
     if (!freezeCommit) notes.push("F8: the freeze is not committed yet — the working-tree baseline is authoritative until it is");
-    else notes.push(`F8: frozen at ${freezeCommit.slice(0, 12)}; ${amendSet.size} amendment(s) on record`);
+    else {
+      notes.push(
+        `F8: frozen at ${freezeCommit.slice(0, 12)}; ${amendSet.size} amendment(s) on record; history swept: ${historyInspected} post-freeze partition commit(s) — ${historyAdding} adding ${historyKeysAdded} key(s), ${historyRemoving} removing ${historyKeysRemoved} key(s), every one judged for marker + partition-only + amendment record`
+      );
+    }
     return { problems, notes };
   }
 
@@ -993,6 +1368,11 @@ function buildPartition(denylist) {
     classifyPath,
     findOccurrencePin,
     findCompatOccurrence,
+    dispositionAt,
+    /** S-OS-06 r4 lane J: the COMPUTED treatment of the legacy-lab glob token at a needle occurrence (null if none). */
+    tagGlobAt,
+    /** The tag list this partition's glob computation expands against (lazily read; readTagList shape). */
+    tagList,
     compatWindows,
     isCompatMember: (file) => compatMemberByPath.has(_toPosix(file)),
     isGeneratedView,
@@ -1069,6 +1449,13 @@ module.exports = {
   AMENDMENT_MARKER,
   VALID_CLASSES,
   ALLOW_CLASSES,
+  // S-OS-06 r4 lane J — the ONE computed version-listing-glob implementation (lane G's join + glob resolutions call these)
+  LEGACY_LAB,
+  isTagGlobVersion,
+  tagGlobToRegExp,
+  parseTagNames,
+  readTagList,
+  computeTagGlob,
 };
 
 if (require.main === module) {


[END OF SLICE — this is the complete diff for the files named above.]
