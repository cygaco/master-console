"use strict";
const assert = require("assert");
const { evaluate, verdictMsgIds, isVerdictRow, historyMask, gatherDocs, DISCLAIMER } = require("./beta-verdict-citation-receipt");

let pass = 0, fail = 0;
function t(desc, fn) {
  try { fn(); console.log("  PASS  " + desc); pass++; }
  catch (e) { console.error("  FAIL  " + desc + "\n        " + e.message); fail++; }
}
const ev = (o) => JSON.stringify(o);
const beta = (rows) => rows.map(ev).join("\n");
const vrow = (msg_id, extra = {}) => ({ type: "beta-verdict", decision: "DECIDE", msg_id, ...extra });

t("citation citing a msg_id on a qualified verdict row -> no finding", () => {
  const docs = [{ path: "adr/1.md", text: "We proceed. β DECIDE B/0.92 (design->build, msg_id abc123def) SHIP." }];
  const r = evaluate({ docs, betaEventsText: beta([vrow("abc123def")]) });
  assert.strictEqual(r.hard.length, 0);
  assert.strictEqual(r.soft.length, 0);
  assert.strictEqual(r.scannedCitations, 1);
});

t("citation citing a msg_id NOT in betaEvents -> hard finding", () => {
  const docs = [{ path: "adr/2.md", text: "β DIRECTIVE (msg_id ghost999) do X." }];
  const r = evaluate({ docs, betaEventsText: beta([vrow("real000", { decision: "DIRECTIVE" })]) });
  assert.strictEqual(r.hard.length, 1, "unresolved receipt must be hard");
  assert.strictEqual(r.hard[0].msg_id, "ghost999");
});

t("load-bearing citation with no msg_id -> soft advisory only", () => {
  const docs = [{ path: "adr/3.md", text: "β ruled we ship it." }];
  const r = evaluate({ docs, betaEventsText: beta([vrow("x1abc")]) });
  assert.strictEqual(r.hard.length, 0);
  assert.strictEqual(r.soft.length, 1);
});

t("citation in a Session log section (at doc end) -> not scanned", () => {
  const docs = [{ path: "tr.md", text: "# Epic\n\n## Session log\n- 2026-01-01 β DECIDE B/0.9 (msg_id gone111) done." }];
  const r = evaluate({ docs, betaEventsText: beta([vrow("other0")]) });
  assert.strictEqual(r.hard.length, 0, "history citation must not be a hard finding");
  assert.strictEqual(r.scannedCitations, 0);
});

t("null betaEventsText -> skip (gitignored ledger absent)", () => {
  const r = evaluate({ docs: [{ path: "a.md", text: "β DECIDE B/0.9 (msg_id zzz111) x." }], betaEventsText: null });
  assert.strictEqual(r.skip, true);
  assert.strictEqual(r.hard.length, 0);
});

t("malformed betaEvents line -> skipped, resolution still works", () => {
  const docs = [{ path: "a.md", text: "β DECIDE (msg_id good111) x." }];
  const r = evaluate({ docs, betaEventsText: "{bad json\n" + ev(vrow("good111")) });
  assert.strictEqual(r.hard.length, 0, "good row should resolve despite a malformed sibling");
});

t("a line mentioning beta without a verdict token -> not a citation", () => {
  const docs = [{ path: "a.md", text: "The beta teammate is persistent. Nothing decided here." }];
  const r = evaluate({ docs, betaEventsText: beta([vrow("q12345")]) });
  assert.strictEqual(r.scannedCitations, 0);
  assert.strictEqual(r.hard.length + r.soft.length, 0);
});

t("forged GENERIC (typeless) betaEvents row sharing the cited id does NOT resolve -> HARD", () => {
  const docs = [{ path: "a.md", text: "β DECIDE B/0.88 (msg_id forged1) ship." }];
  const r = evaluate({ docs, betaEventsText: beta([{ id: "e1", cat: "log", msg_id: "forged1", data: {} }]) });
  assert.strictEqual(r.hard.length, 1, "a generic row must not satisfy a verdict-row receipt");
  assert.strictEqual(r.hard[0].msg_id, "forged1");
});

t("request-shaped beta-consult (no decision) does not resolve -> HARD", () => {
  const docs = [{ path: "a.md", text: "β DIRECTIVE (msg_id req0001) x." }];
  const r = evaluate({ docs, betaEventsText: beta([{ type: "beta-consult", msg_id: "req0001" }]) });
  assert.strictEqual(r.hard.length, 1, "a consult request (no verdict payload) is not a verdict row");
});

t("isVerdictRow — type+decision OR type+verdict qualifies; type-only / generic / pending does not", () => {
  assert.ok(isVerdictRow({ type: "beta-consult", decision: "DECIDE" }));
  assert.ok(isVerdictRow({ type: "beta-verdict", verdict: "fail" }));
  assert.ok(!isVerdictRow({ type: "beta-verdict" }), "type without a decision/verdict is not qualified");
  assert.ok(!isVerdictRow({ type: "design-boundary-consult", verdict: "pending" }), "pending verdict is not a rendered verdict");
  assert.ok(!isVerdictRow({ id: "e", cat: "log" }), "generic logger row is not a verdict");
});

t("short msg_id (<6 chars) that does not resolve -> HARD (not SOFT)", () => {
  const docs = [{ path: "a.md", text: "β DECIDE (msg_id ab1) x." }];
  const r = evaluate({ docs, betaEventsText: beta([vrow("zzzzzz")]) });
  assert.strictEqual(r.hard.length, 1, "a short unresolved receipt must be HARD");
  assert.strictEqual(r.soft.length, 0);
  assert.strictEqual(r.hard[0].msg_id, "ab1");
});
t("short msg_id that DOES resolve on a qualified row -> clean", () => {
  const docs = [{ path: "a.md", text: "β DECIDE (msg_id ab1) x." }];
  const r = evaluate({ docs, betaEventsText: beta([vrow("ab1")]) });
  assert.strictEqual(r.hard.length + r.soft.length, 0);
});

t("backticked `msg_id` token unresolved -> HARD (not misread as no-receipt SOFT)", () => {
  const docs = [{ path: "a.md", text: "β DECIDE (msg_id `bt12345`) x." }];
  const r = evaluate({ docs, betaEventsText: beta([vrow("other0")]) });
  assert.strictEqual(r.hard.length, 1, "backticked receipt must be parsed as a receipt -> HARD when unresolved");
  assert.strictEqual(r.hard[0].msg_id, "bt12345");
});

t("`β: DECIDE` punctuation-separated citation is scanned", () => {
  const docs = [{ path: "a.md", text: "β: DECIDE (msg_id punc111) x." }];
  const r = evaluate({ docs, betaEventsText: beta([vrow("resolved0")]) });
  assert.strictEqual(r.scannedCitations, 1, "punctuation separator must not bypass the scanner");
  assert.strictEqual(r.hard.length, 1);
});

t("active section after a mid-doc Session log heading IS scanned (section-bounded skip)", () => {
  const text = [
    "# Epic", "",
    "## Session log", "- 2026-01-01 β DECIDE (msg_id hist111) done.", "",
    "## Current status", "β DECIDE (msg_id active99) needs a receipt.",
  ].join("\n");
  const r = evaluate({ docs: [{ path: "tr.md", text }], betaEventsText: beta([vrow("resolved0")]) });
  assert.strictEqual(r.hard.length, 1, "the active section after the history section must be scanned");
  assert.strictEqual(r.hard[0].msg_id, "active99");
});
t("historyMask bounds the section to its own heading level", () => {
  const lines = ["# A", "## Session log", "- x", "## Peer", "y"];
  assert.deepStrictEqual(historyMask(lines), [false, true, true, false, false]);
});

t("gatherDocs on an absent dir -> no error (ENOENT ok), returns {docs, errors} shape", () => {
  const g = gatherDocs([require("path").join(__dirname, "__no_such_dir__")], []);
  assert.ok(Array.isArray(g.docs) && Array.isArray(g.errors));
  assert.strictEqual(g.errors.length, 0, "an absent (ENOENT) dir is not a fail-closed error");
});

t("regression: generic row (no type) does not resolve a citation receipt", () => {
  const docs = [{ path: "a.md", text: "β DECIDE B/0.88 (msg_id g5xxxx) ship." }];
  const r = evaluate({ docs, betaEventsText: beta([{ msg_id: "g5xxxx", data: {} }]) });
  assert.strictEqual(r.hard.length, 1, "a type-less generic row must NOT provide a receipt");
});

t("verdictMsgIds indexes a msg_ids array from a qualified verdict row; ignores an unqualified one", () => {
  const q = verdictMsgIds(beta([{ type: "beta-verdict", decision: "DECIDE", msg_ids: ["aa11", "bb22"] }]));
  assert.ok(q.has("aa11") && q.has("bb22"));
  const uq = verdictMsgIds(beta([{ type: "beta-verdict", msg_ids: ["cc33"] }]));
  assert.ok(!uq.has("cc33"), "an unqualified row's msg_ids must not be indexed");
});

t("DISCLAIMER discloses receipt-present-not-authenticated", () => {
  assert.ok(typeof DISCLAIMER === "string" && /not authenticated/i.test(DISCLAIMER) && /authentic/i.test(DISCLAIMER));
});

t("CONTROL: live docs+betaEvents — no HARD finding whose msg_id is actually present", () => {
  const fs = require("fs"), path = require("path");
  const root = path.join(__dirname, "..", "..");
  const be = path.join(root, ".claude", "agents", "president", "_system", "beta", "events.jsonl");
  let betaEventsText; try { betaEventsText = fs.readFileSync(be, "utf8"); } catch { console.log("        (betaEvents absent — skipped)"); return; }
  const known = verdictMsgIds(betaEventsText);
  const docs = [];
  const adrDir = path.join(root, ".claude", "agents", "president", "_system", "policy", "adr");
  try { for (const n of fs.readdirSync(adrDir)) if (/\.md$/.test(n)) docs.push({ path: n, text: fs.readFileSync(path.join(adrDir, n), "utf8") }); } catch {}
  try { docs.push({ path: "ROADMAP.md", text: fs.readFileSync(path.join(root, "ROADMAP.md"), "utf8") }); } catch {}
  const r = evaluate({ docs, betaEventsText });
  for (const f of r.hard) assert.ok(!known.has(f.msg_id), `HARD finding msg_id ${f.msg_id} is actually present — false positive`);
  assert.ok(Array.isArray(r.hard) && Array.isArray(r.soft));
});

t("resolving citation #1 does NOT launder an unreceipted citation #2 on the same line", () => {
  const docs = [{ path: "a.md", text: "β DECIDE (msg_id good111) then β DIRECTIVE with no receipt here" }];
  const r = evaluate({ docs, betaEventsText: beta([vrow("good111")]) });
  assert.strictEqual(r.scannedCitations, 2, "two citations scanned per-citation, not per-line");
  assert.strictEqual(r.hard.length, 0, "the first resolves");
  assert.strictEqual(r.soft.length, 1, "the second (no receipt) is SOFT — not laundered by the first");
});
t("an unrelated msg_id EARLIER on the line does not satisfy a later receiptless citation", () => {
  const docs = [{ path: "a.md", text: "aside msg_id good111 mentioned; β DIRECTIVE needs its own receipt" }];
  const r = evaluate({ docs, betaEventsText: beta([vrow("good111")]) });
  assert.strictEqual(r.hard.length, 0);
  assert.strictEqual(r.soft.length, 1, "the citation's own clause has no msg_id -> SOFT");
});
t("two UNRESOLVED citations on one line -> both HARD (each scanned)", () => {
  const docs = [{ path: "a.md", text: "β DECIDE (msg_id ghost1) and β DIRECTIVE (msg_id ghost2)" }];
  const r = evaluate({ docs, betaEventsText: beta([vrow("real000")]) });
  assert.strictEqual(r.hard.length, 2, "both unresolved citations are HARD");
});

t("a present-but-UNREADABLE explicit file (EACCES) -> fail-closed gather error", () => {
  const io = {
    readFileSync: () => { const e = new Error("EACCES"); e.code = "EACCES"; throw e; },
    readdirSync: () => { const e = new Error("ENOENT"); e.code = "ENOENT"; throw e; },
  };
  const g = gatherDocs([], ["/x/ROADMAP.md"], io);
  assert.strictEqual(g.errors.length, 1, "an unreadable explicit file must be a fail-closed error, not silently omitted");
});
t("an ABSENT explicit file (ENOENT) -> NOT an error (skipped)", () => {
  const io = { readFileSync: () => { const e = new Error("ENOENT"); e.code = "ENOENT"; throw e; }, readdirSync: () => [] };
  const g = gatherDocs([], ["/x/ROADMAP.md"], io);
  assert.strictEqual(g.errors.length, 0, "ENOENT (absent) is fine, not fail-closed");
});

t("a clause with a resolving-first AND an unresolved-second msg_id -> HARD (not laundered)", () => {
  const docs = [{ path: "a.md", text: "β DECIDE (msg_id good111) (msg_id ghost222) ship" }];
  const r = evaluate({ docs, betaEventsText: beta([vrow("good111")]) });
  assert.strictEqual(r.hard.length, 1, "the unresolved second receipt in the same clause must be HARD");
  assert.strictEqual(r.hard[0].msg_id, "ghost222");
});
t("a clause where ALL msg_ids resolve -> clean", () => {
  const docs = [{ path: "a.md", text: "β DECIDE (msg_id good111) (msg_id good222) ship" }];
  const r = evaluate({ docs, betaEventsText: beta([vrow("good111"), vrow("good222")]) });
  assert.strictEqual(r.hard.length + r.soft.length, 0);
});

t("'**β** **DECIDE**' (emphasis on each token) with an unresolved receipt -> HARD", () => {
  const docs = [{ path: "a.md", text: "**β** **DECIDE** (msg_id ghost1) shipped" }];
  const r = evaluate({ docs, betaEventsText: beta([vrow("real000")]) });
  assert.strictEqual(r.hard.length, 1, "markdown emphasis between tokens must not bypass detection");
});
t("a backticked citation '`β DECIDE`' with an unresolved receipt -> HARD", () => {
  const docs = [{ path: "a.md", text: "`β DECIDE` (msg_id ghost2) x" }];
  const r = evaluate({ docs, betaEventsText: beta([vrow("real000")]) });
  assert.strictEqual(r.hard.length, 1, "a backticked citation must be detected");
});
t("an underscore-bearing msg_id is NOT corrupted (we do not strip '_')", () => {
  const docs = [{ path: "a.md", text: "β DECIDE (msg_id ab_cd_ef) x" }];
  const r = evaluate({ docs, betaEventsText: beta([vrow("ab_cd_ef")]) });
  assert.strictEqual(r.hard.length + r.soft.length, 0, "'_' preserved so an underscore msg_id still resolves");
});

for (const [label, text] of [
  ["_β_ _DECIDE_", "We ship because _β_ _DECIDE_ (msg_id ghosthit) approved it"],
  ["_β DECIDE_", "note: _β DECIDE_ (msg_id ghosthit) here"],
  ["__β__ __DECIDE__", "__β__ __DECIDE__ (msg_id ghosthit) x"],
  ["mixed *_β_* *_DECIDE_*", "*_β_* *_DECIDE_* (msg_id ghosthit) y"],
  ["zero-width bypass", String.fromCharCode(0x200b) + "β" + String.fromCharCode(0x200b) + "DECIDE (msg_id ghosthit) z"],
]) {
  t(`'${label}' with an UNRESOLVED receipt -> HARD (emphasis/zero-width cannot hide a citation)`, () => {
    const r = evaluate({ docs: [{ path: "a.md", text }], betaEventsText: beta([vrow("real000")]) });
    assert.strictEqual(r.hard.length, 1, `'${label}' must be detected + HARD, not evaded`);
    assert.strictEqual(r.hard[0].msg_id, "ghosthit");
  });
}
t("underscore-italic citation with a RESOLVING underscore msg_id -> clean (id not corrupted)", () => {
  const r = evaluate({ docs: [{ path: "a.md", text: "_β_ _DECIDE_ (msg_id ab_cd_ef) ok" }], betaEventsText: beta([vrow("ab_cd_ef")]) });
  assert.strictEqual(r.hard.length + r.soft.length, 0, "detection strips '_' but extraction preserves it");
});

t("novel: strikethrough '~~β~~ ~~DECIDE~~' with an unresolved receipt -> HARD (structural class closes ~)", () => {
  const r = evaluate({ docs: [{ path: "a.md", text: "~~β~~ ~~DECIDE~~ (msg_id ghosthit) x" }], betaEventsText: beta([vrow("real000")]) });
  assert.strictEqual(r.hard.length, 1, "strikethrough emphasis must not hide a citation");
  assert.strictEqual(r.hard[0].msg_id, "ghosthit");
});
t("homoglyph: a mathematical β (U+1D6FD) is folded to β -> detected -> HARD", () => {
  const mathBeta = String.fromCodePoint(0x1D6FD);
  const r = evaluate({ docs: [{ path: "a.md", text: mathBeta + " DECIDE (msg_id ghosthit) x" }], betaEventsText: beta([vrow("real000")]) });
  assert.strictEqual(r.hard.length, 1, "a β-homoglyph must be folded to β and detected");
});
t("homoglyph: the Greek beta symbol (ϐ U+03D0) is folded -> HARD", () => {
  const r = evaluate({ docs: [{ path: "a.md", text: String.fromCharCode(0x03D0) + " DIRECTIVE (msg_id ghosthit) y" }], betaEventsText: beta([vrow("real000")]) });
  assert.strictEqual(r.hard.length, 1);
});
t("benign-adjacent GREEN: emphasis-heavy prose with NO verdict token is not a citation", () => {
  const r = evaluate({ docs: [{ path: "a.md", text: "The *beta* release is _ready_ and ~~stable~~; nothing decided." }], betaEventsText: beta([vrow("real000")]) });
  assert.strictEqual(r.scannedCitations, 0, "emphasis around 'beta' with no verdict token is not a citation");
  assert.strictEqual(r.hard.length + r.soft.length, 0);
});

const cgj = String.fromCodePoint(0x034F);
const acute = String.fromCodePoint(0x0301);
const eAcute = String.fromCodePoint(0x00C9);
const braille = String.fromCodePoint(0x2800);
const hangulFiller = String.fromCodePoint(0x3164);
const fwDECIDE = [0xFF24, 0xFF25, 0xFF23, 0xFF29, 0xFF24, 0xFF25].map((c) => String.fromCodePoint(c)).join("");
const emoji = String.fromCodePoint(0x1F600);

t("INVISIBLE U+034F CGJ inside the decision token ('β D<CGJ>ECIDE') -> HARD (not evaded)", () => {
  const docs = [{ path: "a.md", text: "β D" + cgj + "ECIDE (msg_id ghostcgj) shipped" }];
  const r = evaluate({ docs, betaEventsText: beta([vrow("real000")]) });
  assert.strictEqual(r.hard.length, 1, "an invisible combining mark (\\p{M}) inside DECIDE must not hide the citation");
  assert.strictEqual(r.hard[0].msg_id, "ghostcgj");
});
t("INVISIBLE U+034F CGJ as the β<->DECIDE separator -> HARD", () => {
  const docs = [{ path: "a.md", text: "β" + cgj + "DECIDE (msg_id ghostcgj2) x" }];
  const r = evaluate({ docs, betaEventsText: beta([vrow("real000")]) });
  assert.strictEqual(r.hard.length, 1, "an invisible \\p{M} separator (optional-separator regex) must not evade");
  assert.strictEqual(r.hard[0].msg_id, "ghostcgj2");
});
t("VISIBLE combining mark on the decision token ('β DE<U+0301>CIDE') -> HARD", () => {
  const docs = [{ path: "a.md", text: "β DE" + acute + "CIDE (msg_id ghostacc) x" }];
  const r = evaluate({ docs, betaEventsText: beta([vrow("real000")]) });
  assert.strictEqual(r.hard.length, 1, "a combining accent on the decision token must be stripped, not evaded");
  assert.strictEqual(r.hard[0].msg_id, "ghostacc");
});
t("PRECOMPOSED accent on the decision token ('β DÉCIDE' U+00C9) -> HARD (NFKD decomposes then strips)", () => {
  const docs = [{ path: "a.md", text: "β D" + eAcute + "CIDE (msg_id ghostpre) x" }];
  const r = evaluate({ docs, betaEventsText: beta([vrow("real000")]) });
  assert.strictEqual(r.hard.length, 1, "a precomposed accent must NFKD-decompose then mark-strip, not evade");
});
t("BOTH HALVES — homoglyph DECISION token (fullwidth ＤＥＣＩＤＥ) -> HARD", () => {
  const docs = [{ path: "a.md", text: "β " + fwDECIDE + " (msg_id ghostfw) x" }];
  const r = evaluate({ docs, betaEventsText: beta([vrow("real000")]) });
  assert.strictEqual(r.hard.length, 1, "the DECISION-token half must be homoglyph-folded too (single NFKD pass, both halves)");
  assert.strictEqual(r.hard[0].msg_id, "ghostfw");
});
t("non-\\s BLANK separator U+2800 BRAILLE BLANK ('β<U+2800>DECIDE') -> HARD", () => {
  const docs = [{ path: "a.md", text: "β" + braille + "DECIDE (msg_id ghostbrl) x" }];
  const r = evaluate({ docs, betaEventsText: beta([vrow("real000")]) });
  assert.strictEqual(r.hard.length, 1, "a blank-rendering non-\\s separator must not evade the separator class");
  assert.strictEqual(r.hard[0].msg_id, "ghostbrl");
});
t("non-\\s BLANK separator U+3164 HANGUL FILLER -> HARD", () => {
  const docs = [{ path: "a.md", text: "β" + hangulFiller + "DIRECTIVE (msg_id ghosthan) x" }];
  const r = evaluate({ docs, betaEventsText: beta([vrow("real000")]) });
  assert.strictEqual(r.hard.length, 1);
  assert.strictEqual(r.hard[0].msg_id, "ghosthan");
});
t("UTF-16 index-map — ASTRAL char(s) BEFORE an unresolved-receipt citation stay HARD (no desync)", () => {
  const docs = [{ path: "a.md", text: emoji + " and " + emoji + " β DECIDE (msg_id ghostast) ship" }];
  const r = evaluate({ docs, betaEventsText: beta([vrow("real000")]) });
  assert.strictEqual(r.hard.length, 1, "an astral char must not desync the raw-clause map");
  assert.strictEqual(r.hard[0].msg_id, "ghostast", "the correct msg_id must be sliced from the raw clause after an astral char");
});
t("UTF-16 index-map — astral char before a RESOLVING citation stays clean (map slices right id)", () => {
  const docs = [{ path: "a.md", text: emoji + " β DECIDE (msg_id good_astral) ship" }];
  const r = evaluate({ docs, betaEventsText: beta([vrow("good_astral")]) });
  assert.strictEqual(r.hard.length + r.soft.length, 0, "the astral-aligned map must slice the resolving id correctly");
});
t("astral char INSIDE the clause between citation and its receipt -> id still extracted (HARD)", () => {
  const docs = [{ path: "a.md", text: "β DECIDE " + emoji + " (msg_id ghostmid) x" }];
  const r = evaluate({ docs, betaEventsText: beta([vrow("real000")]) });
  assert.strictEqual(r.hard.length, 1);
  assert.strictEqual(r.hard[0].msg_id, "ghostmid");
});
t("ceiling (a): a CROSS-SCRIPT (Cyrillic) confusable is the DISCLOSED, un-closed residual (documented)", () => {
  const cyrDIRECTIVE = "DIR" + String.fromCodePoint(0x0415) + "CTIV" + String.fromCodePoint(0x0415);
  const docs = [{ path: "a.md", text: "β " + cyrDIRECTIVE + " (msg_id wouldbeghost) x" }];
  const r = evaluate({ docs, betaEventsText: beta([vrow("real000")]) });
  assert.strictEqual(r.hard.length, 0, "cross-script confusables are the DISCLOSED ceiling (needs TR39) — NORMALIZATION CEILING (a)");
  assert.strictEqual(r.scannedCitations, 0, "the spoofed decision token is not NFKD-folded to ASCII, so no citation matches");
});
t("benign astral-heavy prose with NO verdict token is still not a citation (no over-match)", () => {
  const docs = [{ path: "a.md", text: emoji + " the beta build " + emoji + " is ready; nothing decided." }];
  const r = evaluate({ docs, betaEventsText: beta([vrow("real000")]) });
  assert.strictEqual(r.scannedCitations, 0);
  assert.strictEqual(r.hard.length + r.soft.length, 0);
});

const hfiller = String.fromCodePoint(0x1160);
const cfiller = String.fromCodePoint(0x115F);
const hwfiller = String.fromCodePoint(0xFFA0);
const zwsp = String.fromCodePoint(0x200B);
for (const [label, sep] of [
  ["U+2800 BRAILLE BLANK", braille],
  ["U+3164 HANGUL FILLER", hangulFiller],
  ["U+1160 JUNGSEONG FILLER", hfiller],
  ["U+115F CHOSEONG FILLER", cfiller],
  ["U+FFA0 HALFWIDTH FILLER", hwfiller],
  ["U+200B ZWSP (invisible)", zwsp],
  ["U+034F CGJ (invisible)", cgj],
]) {
  t(`'${label}' as the msg_id->id separator with a FORGED id -> HARD (no HARD->SOFT downgrade)`, () => {
    const docs = [{ path: "a.md", text: "β DECIDE (msg_id" + sep + "ghost999) shipped" }];
    const r = evaluate({ docs, betaEventsText: beta([vrow("real000")]) });
    assert.strictEqual(r.hard.length, 1, `'${label}' separator must not downgrade a forged receipt to SOFT`);
    assert.strictEqual(r.hard[0].msg_id, "ghost999");
  });
}
t("a blank-separated RESOLVING receipt stays clean (fix does not corrupt resolution)", () => {
  const docs = [{ path: "a.md", text: "β DECIDE (msg_id" + braille + "abc123def) ship" }];
  const r = evaluate({ docs, betaEventsText: beta([vrow("abc123def")]) });
  assert.strictEqual(r.hard.length + r.soft.length, 0, "a blank-separated id that resolves must be clean");
});
t("an invisible INSIDE the msg_id label (single obfuscation) -> HARD (repaired by strip)", () => {
  const docs = [{ path: "a.md", text: "β DECIDE (msg" + zwsp + "_id ghost999) x" }];
  const r = evaluate({ docs, betaEventsText: beta([vrow("real000")]) });
  assert.strictEqual(r.hard.length, 1, "an invisible inside the label must be stripped, not evade");
  assert.strictEqual(r.hard[0].msg_id, "ghost999");
});
t("a legit `msg_ids` array mention is NOT a false-positive HARD (label boundary is precise)", () => {
  const docs = [{ path: "a.md", text: "β DECIDE about msg_ids: [aa11, bb22] here" }];
  const r = evaluate({ docs, betaEventsText: beta([vrow("real000")]) });
  assert.strictEqual(r.hard.length, 0, "`msg_ids` (ASCII s after the label) must not extract a spurious receipt");
});
t("ceiling (e): DOUBLE-obfuscated receipt (invisible-in-label + invisible-sep) is the DISCLOSED residual (SOFT)", () => {
  const docs = [{ path: "a.md", text: "β DECIDE (msg" + zwsp + "_id" + zwsp + "ghost999) x" }];
  const r = evaluate({ docs, betaEventsText: beta([vrow("real000")]) });
  assert.strictEqual(r.hard.length, 0, "the double-obfuscation compound is the disclosed ceiling (e) — abuts to msg_idghost");
  assert.strictEqual(r.soft.length, 1, "it is a receiptless SOFT (renders as no-space, not a convincing receipt)");
});
t("ceiling (a)/label: a CROSS-SCRIPT confusable in the msg_id LABEL is the DISCLOSED TR39 residual (SOFT)", () => {
  const cyrI = String.fromCodePoint(0x0456);
  const docs = [{ path: "a.md", text: "β DECIDE (msg_" + cyrI + "d ghost999) x" }];
  const r = evaluate({ docs, betaEventsText: beta([vrow("real000")]) });
  assert.strictEqual(r.hard.length, 0, "a confusable in the label is the disclosed TR39 ceiling (a) — not folded by NFKD");
  assert.strictEqual(r.soft.length, 1, "the citation is detected (ASCII DECIDE) but the confusable label yields no receipt -> SOFT");
});
t("a combining mark after `msg_id` with no following id -> no synthesized false receipt", () => {
  const acuteMark = String.fromCodePoint(0x0301);
  const docs = [{ path: "a.md", text: "β DECIDE — the msg_id" + acuteMark + ". field is set later" }];
  const r = evaluate({ docs, betaEventsText: beta([vrow("real000")]) });
  assert.strictEqual(r.hard.length, 0, "a mark with no following id must not synthesize a separator (lookahead)");
});

for (const [label, text] of [
  ["'beta version' (adjacent non-token word)", "the beta version ships Friday; nothing decided"],
  ["'beta-tested' (hyphen sep + non-token)", "the decision was beta-tested by users"],
  ["'betaVerdict' identifier (case-sensitive: capital V != verdict)", "const betaVerdict = getVerdict();"],
  ["'β' then a NON-adjacent verdict word", "the β release was, eventually, approved by ops much later"],
]) {
  t(`false-positive GREEN: ${label} is NOT a citation (optional-separator acceptance is bounded)`, () => {
    const r = evaluate({ docs: [{ path: "a.md", text }], betaEventsText: beta([vrow("real000")]) });
    assert.strictEqual(r.scannedCitations, 0, `${label} must not accidentally match as a citation`);
    assert.strictEqual(r.hard.length + r.soft.length, 0);
  });
}
t("positive control: a GENUINE concatenated 'βDECIDE' (invisible-removed origin) IS scanned", () => {
  const r = evaluate({ docs: [{ path: "a.md", text: "the βDECIDE (msg_id ghostcat) was final" }], betaEventsText: beta([vrow("real000")]) });
  assert.strictEqual(r.hard.length, 1, "a genuine adjacent citation with an unresolved receipt must still be HARD");
  assert.strictEqual(r.hard[0].msg_id, "ghostcat");
});
t("astral chars BOTH before the citation AND after the msg_id -> HARD, correct id", () => {
  const docs = [{ path: "a.md", text: emoji + " note " + emoji + " β DECIDE (msg_id ghostb07) " + emoji + " " + emoji + " ship" }];
  const r = evaluate({ docs, betaEventsText: beta([vrow("real000")]) });
  assert.strictEqual(r.hard.length, 1, "astral chars around the clause must not desync the raw-clause map");
  assert.strictEqual(r.hard[0].msg_id, "ghostb07", "the id must slice correctly with astral chars on both sides");
});

const NUL = String.fromCodePoint(0x0000), BEL = String.fromCodePoint(0x0007), DEL = String.fromCodePoint(0x007F);
const di2065 = String.fromCodePoint(0x2065), diFFF0 = String.fromCodePoint(0xFFF0), diE0000 = String.fromCodePoint(0xE0000);
const TAB = String.fromCodePoint(0x0009);
for (const [label, ch] of [
  ["NUL U+0000", NUL], ["BEL U+0007", BEL], ["DEL U+007F", DEL],
  ["default-ignorable U+2065", di2065], ["default-ignorable U+FFF0", diFFF0], ["default-ignorable U+E0000", diE0000],
]) {
  t(`'${label}' INSIDE the decision token ('β D<x>ECIDE') -> HARD (citation not hidden)`, () => {
    const docs = [{ path: "a.md", text: "β D" + ch + "ECIDE (msg_id ghostctl) shipped" }];
    const r = evaluate({ docs, betaEventsText: beta([vrow("real000")]) });
    assert.strictEqual(r.hard.length, 1, `'${label}' in the token must be stripped so the citation is still detected`);
    assert.strictEqual(r.hard[0].msg_id, "ghostctl");
  });
  t(`'${label}' as the msg_id->id SEPARATOR -> HARD (receipt not downgraded)`, () => {
    const docs = [{ path: "a.md", text: "β DECIDE (msg_id" + ch + "ghostctls)" }];
    const r = evaluate({ docs, betaEventsText: beta([vrow("real000")]) });
    assert.strictEqual(r.hard.length, 1, `'${label}' as the receipt separator must not downgrade HARD->SOFT`);
    assert.strictEqual(r.hard[0].msg_id, "ghostctls");
  });
}
t("a whitespace CONTROL (TAB U+0009) as a separator maps to a space (both halves)", () => {
  const docs = [{ path: "a.md", text: "β" + TAB + "DECIDE (msg_id" + TAB + "ghosttab)" }];
  const r = evaluate({ docs, betaEventsText: beta([vrow("real000")]) });
  assert.strictEqual(r.hard.length, 1, "TAB (\\p{Cc} whitespace) must map to a space separator on both the citation and receipt");
  assert.strictEqual(r.hard[0].msg_id, "ghosttab");
});
t("a control/default-ignorable-obfuscated FORGED id de-obfuscates and stays HARD", () => {
  const docs = [{ path: "a.md", text: "β DECIDE (msg_id gh" + NUL + "ost" + di2065 + "ctl) x" }];
  const r = evaluate({ docs, betaEventsText: beta([vrow("real000")]) });
  assert.strictEqual(r.hard.length, 1, "invisible chars inside the id strip so the (unresolved) id is still extracted -> HARD");
});
t("GREEN: a control-obfuscated RESOLVING id de-obfuscates to the real id -> clean", () => {
  const docs = [{ path: "a.md", text: "β DECIDE (msg_id ab" + NUL + "cd) ok" }];
  const r = evaluate({ docs, betaEventsText: beta([vrow("abcd")]) });
  assert.strictEqual(r.hard.length + r.soft.length, 0, "'ab<NUL>cd' must de-obfuscate to the resolving 'abcd'");
});

const RLO = String.fromCodePoint(0x202E), PDF = String.fromCodePoint(0x202C), RLI = String.fromCodePoint(0x2067), PDI = String.fromCodePoint(0x2069);
const LS = String.fromCodePoint(0x2028), PS = String.fromCodePoint(0x2029), CR = String.fromCodePoint(0x000D);
const fwReal000 = [0xFF52, 0xFF45, 0xFF41, 0xFF4C, 0xFF10, 0xFF10, 0xFF10].map((c) => String.fromCodePoint(c)).join("");

t("a BIDI override masking a citation ('β <RLO>EDICED<PDF>') -> HARD (dangerous syntax)", () => {
  const docs = [{ path: "a.md", text: "β " + RLO + "EDICED" + PDF + " (msg_id ghost999) shipped" }];
  const r = evaluate({ docs, betaEventsText: beta([vrow("real000")]) });
  assert.strictEqual(r.hard.length >= 1, true, "a bidi override on a scanned line must be a HARD finding (a citation may be masked)");
  assert.ok(r.hard.some((h) => h.msg_id === null), "the bidi finding carries no msg_id (it is a dangerous-syntax flag, not a receipt finding)");
});
t("a BIDI isolate (RLI/PDI) present on a scanned line -> HARD", () => {
  const docs = [{ path: "a.md", text: "note " + RLI + "some text" + PDI + " here" }];
  const r = evaluate({ docs, betaEventsText: beta([vrow("real000")]) });
  assert.strictEqual(r.hard.length, 1, "bidi isolates are dangerous syntax too");
});
t("GREEN: a normal RTL-free prose line has NO bidi finding (no over-flag)", () => {
  const docs = [{ path: "a.md", text: "The beta build is stable; nothing decided here." }];
  const r = evaluate({ docs, betaEventsText: beta([vrow("real000")]) });
  assert.strictEqual(r.hard.length + r.soft.length, 0, "a line with no bidi control must not be flagged");
});

t("a FULLWIDTH id (ｒｅａｌ０００) that NFKD-folds into the ledger id 'real000' -> HARD (laundered, not clean)", () => {
  const docs = [{ path: "a.md", text: "β DECIDE (msg_id " + fwReal000 + ") ship" }];
  const r = evaluate({ docs, betaEventsText: beta([vrow("real000")]) });
  assert.strictEqual(r.hard.length, 1, "normalization must NOT mint a valid receipt from a fullwidth payload");
  assert.strictEqual(r.hard[0].msg_id, "real000");
});
t("an ACCENTED id (ŕeal000, r+combining acute) that mark-strips into 'real000' -> HARD (laundered)", () => {
  const docs = [{ path: "a.md", text: "β DECIDE (msg_id " + "r" + String.fromCodePoint(0x0301) + "eal000) x" }];
  const r = evaluate({ docs, betaEventsText: beta([vrow("real000")]) });
  assert.strictEqual(r.hard.length, 1, "a mark-decorated id that folds to a ledger id must not resolve");
});
t("GREEN: a genuine raw-ASCII id that resolves is NOT falsely laundered", () => {
  const docs = [{ path: "a.md", text: "β DECIDE (msg_id real000) ok" }];
  const r = evaluate({ docs, betaEventsText: beta([vrow("real000")]) });
  assert.strictEqual(r.hard.length + r.soft.length, 0, "a raw-ASCII id present verbatim must resolve clean");
});

const VT = String.fromCodePoint(0x000B), FF = String.fromCodePoint(0x000C), NEL = String.fromCodePoint(0x0085);
t("a lone-CR-hidden peer heading (CommonMark line-ending) -> the active citation IS scanned", () => {
  const text = "# Epic\n## Session log\n- 2026-01-01 β DECIDE (msg_id hist1) done." + CR + "## Current status\nβ DECIDE (msg_id active99) needs a receipt.";
  const r = evaluate({ docs: [{ path: "tr.md", text }], betaEventsText: beta([vrow("real000")]) });
  assert.ok(r.hard.some((h) => h.msg_id === "active99"), "a CR-hidden heading splits and closes the section -> active99 scanned");
  assert.ok(!r.hard.some((h) => h.msg_id === "hist1"), "the genuine history citation stays masked");
});
for (const [label, sep] of [["VT U+000B", VT], ["FF U+000C", FF], ["NEL U+0085", NEL], ["LS U+2028", LS], ["PS U+2029", PS]]) {
  t(`a '${label}'-hidden peer heading is flagged HARD (dangerous break), not a clean-green mask`, () => {
    const text = "# Epic\n## Session log\n- 2026-01-01 β DECIDE (msg_id hist1) done." + sep + "## Current status\nβ DECIDE (msg_id active99) needs a receipt.";
    const r = evaluate({ docs: [{ path: "tr.md", text }], betaEventsText: beta([vrow("real000")]) });
    assert.ok(r.hard.some((h) => h.msg_id === null), `a ${label} break must be flagged HARD (dangerous syntax) so a break-masked citation can't ship clean-green`);
  });
}
for (const [label, sep] of [["FF U+000C", FF], ["VT U+000B", VT], ["LS U+2028", LS], ["PS U+2029", PS], ["NEL U+0085", NEL]]) {
  t(`'β<${label}>DECIDE' (break as a citation separator) is DETECTED, not split-hidden -> HARD`, () => {
    const r = evaluate({ docs: [{ path: "a.md", text: "β" + sep + "DECIDE (msg_id ghostsplit)" }], betaEventsText: beta([vrow("real000")]) });
    assert.ok(r.hard.some((h) => h.msg_id === "ghostsplit"), `'β<${label}>DECIDE' must be detected (SPACE_MAP folds the break) -> HARD on the forged receipt`);
    assert.ok(r.hard.some((h) => h.msg_id === null), "the break presence is also flagged HARD");
  });
}
t("a fullwidth cited id + a raw twin ELSEWHERE in the clause -> HARD (laundering not rescued by the twin)", () => {
  const docs = [{ path: "a.md", text: "β DECIDE (msg_id " + fwReal000 + ") also real000 mentioned here" }];
  const r = evaluate({ docs, betaEventsText: beta([vrow("real000")]) });
  assert.strictEqual(r.hard.length, 1, "the fullwidth cited receipt is laundered; a raw twin elsewhere must not launder it");
  assert.strictEqual(r.hard[0].msg_id, "real000");
});

for (const [label, ref] of [["numeric &#946;", "&#946;"], ["hex &#x3B2;", "&#x3B2;"], ["named &beta;", "&beta;"]]) {
  t(`a ${label}-encoded β with a forged receipt renders "β DECIDE" -> HARD (char-ref decoded)`, () => {
    const r = evaluate({ docs: [{ path: "a.md", text: ref + " DECIDE (msg_id ghostref)" }], betaEventsText: beta([vrow("real000")]) });
    assert.ok(r.hard.some((h) => h.msg_id === "ghostref"), `${label} must decode to β on the render surface and be scanned`);
  });
}
t("a numeric ref to a compat homoglyph (&#xFF24; = fullwidth D) composes decode->NFKD -> HARD", () => {
  const r = evaluate({ docs: [{ path: "a.md", text: "β &#xFF24;ECIDE (msg_id ghostfw)" }], betaEventsText: beta([vrow("real000")]) });
  assert.ok(r.hard.some((h) => h.msg_id === "ghostfw"), "&#xFF24;ECIDE must decode to ＤECIDE then NFKD-fold to DECIDE");
});
t("a numeric ref to a bidi control (&#x202E;) decodes then is flagged HARD", () => {
  const r = evaluate({ docs: [{ path: "a.md", text: "&#x202E;text&#x202C; (msg_id x)" }], betaEventsText: beta([vrow("real000")]) });
  assert.ok(r.hard.length >= 1, "an entity-encoded bidi control must decode then hit the dangerous-syntax flag");
});
for (const [label, ref] of [["&alpha;", "&alpha;"], ["&gamma;", "&gamma;"], ["&Beta; (uppercase Greek)", "&Beta;"]]) {
  t(`the named entity ${label} does NOT resolve to a β citation token (scanned=0)`, () => {
    const r = evaluate({ docs: [{ path: "a.md", text: ref + " DECIDE (msg_id x); " + ref + " ruled" }], betaEventsText: beta([vrow("real000")]) });
    assert.strictEqual(r.scannedCitations, 0, `${label} is not the β token — not a citation (the &beta;-only cut is sufficient, not a category-strip)`);
  });
}
t("Setext: `Current status`\\n`---` closes the history section -> active citation scanned", () => {
  const text = "# Epic\n## Session log\n- 2026-01-01 β DECIDE (msg_id histS) done.\nCurrent status\n---\nβ DECIDE (msg_id activeS) needs a receipt.";
  const r = evaluate({ docs: [{ path: "tr.md", text }], betaEventsText: beta([vrow("real000")]) });
  assert.ok(r.hard.some((h) => h.msg_id === "activeS"), "a Setext-closed heading must un-mask the active citation");
  assert.ok(!r.hard.some((h) => h.msg_id === "histS"), "the genuine history citation stays masked");
});
t("indented-ATX (0-3 leading spaces) closes the history section -> active citation scanned", () => {
  const text = "# Epic\n## Session log\n- 2026-01-01 β DECIDE (msg_id histA) done.\n   ## Current status\nβ DECIDE (msg_id activeA) needs a receipt.";
  const r = evaluate({ docs: [{ path: "tr.md", text }], betaEventsText: beta([vrow("real000")]) });
  assert.ok(r.hard.some((h) => h.msg_id === "activeA"), "a 3-space-indented ATX heading (valid CommonMark) must close the section");
});
t("GREEN: a legit resolving char-ref-free citation stays clean (char-ref decode is a no-op on plain text)", () => {
  const r = evaluate({ docs: [{ path: "a.md", text: "β DECIDE (msg_id real000) ok" }], betaEventsText: beta([vrow("real000")]) });
  assert.strictEqual(r.hard.length + r.soft.length, 0);
});
t("an UPPERCASE-X hex char-ref (&#X3B2; = β) with a forged receipt -> HARD (not left undecoded)", () => {
  const r = evaluate({ docs: [{ path: "a.md", text: "&#X3B2; DECIDE (msg_id ghostUX)" }], betaEventsText: beta([vrow("real000")]) });
  assert.ok(r.hard.some((h) => h.msg_id === "ghostUX"), "&#X3B2; must decode to β on the render surface (uppercase-X hex ref)");
});
t("an UPPERCASE-X hex char-ref bidi (&#X202E;) decodes then is flagged HARD", () => {
  const r = evaluate({ docs: [{ path: "a.md", text: "&#X202E;text&#X202C; (msg_id x)" }], betaEventsText: beta([vrow("real000")]) });
  assert.ok(r.hard.length >= 1, "an uppercase-X entity-encoded bidi control must decode then hit the dangerous-syntax flag");
});
t("GREEN: lowercase &#x3B2; still decodes (case-complete, not a regression)", () => {
  const r = evaluate({ docs: [{ path: "a.md", text: "&#x3B2; DECIDE (msg_id ghostlx)" }], betaEventsText: beta([vrow("real000")]) });
  assert.ok(r.hard.some((h) => h.msg_id === "ghostlx"));
});

const idHexLower = ["72", "65", "61", "6c", "30", "30", "30"].map((h) => "&#x" + h + ";").join("");
const idHexUpper = ["72", "65", "61", "6C", "30", "30", "30"].map((h) => "&#X" + h + ";").join("");
const idDecimal = [114, 101, 97, 108, 48, 48, 48].map((d) => "&#" + d + ";").join("");
for (const [label, encId] of [["DECIMAL", idDecimal], ["lowercase-hex", idHexLower], ["UPPERCASE-X hex", idHexUpper]]) {
  t(`a receipt id spelled as ${label} character refs decoding to a REAL ledger id -> HARD (decode must not mint a credential)`, () => {
    const r = evaluate({ docs: [{ path: "a.md", text: "&#x3B2; DECIDE (msg_id " + encId + ")" }], betaEventsText: beta([vrow("real000")]) });
    assert.strictEqual(r.scannedCitations, 1, "the char-ref-encoded β citation must still be DETECTED");
    assert.strictEqual(r.hard.length, 1, `a ${label} char-ref id that decodes into the ledger id must NOT resolve clean`);
    assert.strictEqual(r.hard[0].msg_id, "real000");
    assert.ok(/never mint a credential/.test(r.hard[0].reason), "must be reported as a laundered (minted) receipt, not merely unresolved");
  });
}
t("GREEN: a char-ref-encoded β with a RAW-ASCII forged receipt is still HARD-as-unresolved (not misreported as laundered)", () => {
  const r = evaluate({ docs: [{ path: "a.md", text: "&#x3B2; DECIDE (msg_id ghostraw)" }], betaEventsText: beta([vrow("real000")]) });
  assert.strictEqual(r.hard.length, 1);
  assert.strictEqual(r.hard[0].msg_id, "ghostraw");
  assert.ok(/does NOT resolve/.test(r.hard[0].reason), "a genuinely raw id must be reported as unresolved, NOT as laundered — the two diagnoses must stay distinct");
});

t("a FULLWIDTH cited id + a LABELLED raw twin later in the clause -> HARD (the twin must not rescue it)", () => {
  const text = "β DECIDE (msg_id " + fwReal000 + "); unrelated prose says not msg_id real000";
  const r = evaluate({ docs: [{ path: "a.md", text }], betaEventsText: beta([vrow("real000")]) });
  assert.strictEqual(r.scannedCitations, 1);
  assert.strictEqual(r.hard.length, 1, "a raw twin ELSEWHERE in the clause must not launder a compat-folded occurrence");
  assert.strictEqual(r.hard[0].msg_id, "real000");
  assert.ok(/never mint a credential/.test(r.hard[0].reason));
});
t("a MARK-DECORATED cited id + a LABELLED raw twin later in the clause -> HARD", () => {
  const text = "β DECIDE (msg_id r" + String.fromCodePoint(0x0301) + "eal000); see also msg_id real000";
  const r = evaluate({ docs: [{ path: "a.md", text }], betaEventsText: beta([vrow("real000")]) });
  assert.strictEqual(r.hard.length, 1, "a mark-stripped occurrence must not be rescued by a labelled raw twin");
});
t("CONTROL: the same fullwidth payload WITHOUT the twin stays HARD", () => {
  const r = evaluate({ docs: [{ path: "a.md", text: "β DECIDE (msg_id " + fwReal000 + ")" }], betaEventsText: beta([vrow("real000")]) });
  assert.strictEqual(r.hard.length, 1);
  assert.strictEqual(r.hard[0].msg_id, "real000");
});
t("the twin's OWN occurrence resolves on its own merits (span-anchoring is not a blanket condemnation)", () => {
  const text = "β DECIDE (msg_id " + fwReal000 + ") first. β DECIDE (msg_id real000) second.";
  const r = evaluate({ docs: [{ path: "a.md", text }], betaEventsText: beta([vrow("real000")]) });
  assert.strictEqual(r.scannedCitations, 2, "two citations, two clauses");
  assert.strictEqual(r.hard.length, 1, "only the MINTED occurrence is HARD; the genuine raw one resolves clean");
  assert.ok(/never mint a credential/.test(r.hard[0].reason));
});

t("GREEN: a legitimate raw citation with a real receipt stays clean (no false positive)", () => {
  const r = evaluate({ docs: [{ path: "a.md", text: "We proceed. β DECIDE B/0.92 (design->build, msg_id real000) SHIP." }], betaEventsText: beta([vrow("real000")]) });
  assert.strictEqual(r.hard.length + r.soft.length, 0, "a genuine raw-ASCII receipt must not be flagged by span-anchored pairing");
  assert.strictEqual(r.scannedCitations, 1);
});
t("GREEN: a legit receipt whose separator is a BLANK/invisible still pairs at its own span (both channels normalize identically)", () => {
  const zwsp = String.fromCodePoint(0x200B);
  const r = evaluate({ docs: [{ path: "a.md", text: "β DECIDE (msg_id" + zwsp + "real000) ok" }], betaEventsText: beta([vrow("real000")]) });
  assert.strictEqual(r.hard.length + r.soft.length, 0, "an invisible label->id separator must not desync the two channels into a false laundering verdict");
});
t("an ASTRAL char BEFORE the citation keeps the COMPOSED (decode∘normalize) index map aligned -> laundering still detected", () => {
  const text = emoji + emoji + " note: β DECIDE (msg_id " + fwReal000 + ") x";
  const r = evaluate({ docs: [{ path: "a.md", text }], betaEventsText: beta([vrow("real000")]) });
  assert.strictEqual(r.hard.length, 1, "astral chars must not desync the composed map (a desync would mis-slice the raw clause into a false-green)");
  assert.strictEqual(r.hard[0].msg_id, "real000");
});
t("GREEN: an ASTRAL char before a RESOLVING char-ref-encoded citation stays clean (composed map, both directions)", () => {
  const r = evaluate({ docs: [{ path: "a.md", text: emoji + " &#x3B2; DECIDE (msg_id real000) ok" }], betaEventsText: beta([vrow("real000")]) });
  assert.strictEqual(r.hard.length + r.soft.length, 0, "the composed map must land the raw slice correctly after an astral char AND a char-ref decode");
});
t("an astral char INSIDE the clause between the label and a fullwidth id -> still HARD (no map drift mid-clause)", () => {
  const text = "β DECIDE " + emoji + " (msg_id " + fwReal000 + ") x";
  const r = evaluate({ docs: [{ path: "a.md", text }], betaEventsText: beta([vrow("real000")]) });
  assert.strictEqual(r.hard.length, 1);
  assert.strictEqual(r.hard[0].msg_id, "real000");
});

console.log("");
console.log(pass + "/" + (pass + fail) + " passed" + (fail ? " (" + fail + " FAILED)" : ""));
process.exit(fail ? 1 : 0);
