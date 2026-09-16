# Why `occurrence-k5.out.json` is present on disk but NOT tracked

`framework-purity` refused it with `promote_relic=1`: the file quotes a legacy-slug-prefixed ledger
identifier verbatim (5 occurrences), which this note deliberately does not reproduce.

That is the self-reference problem STOP-CONDITION section 7b names, biting for real. The round's own
measurement artifacts stay INSIDE the swept population, so an artifact that QUOTES the tokens it measures
GROWS the population it is measuring and reddens the purity gate. Committing it turned
`framework-purity` and `leak-gate` red at `16bf0369` on a pristine tree.

**The precedent is already set inside this sprint.** Lane C hit the identical wall and solved it at
`f490592e`: *"oracle (iv) never quotes line text in committed output (purity gate); --with-text is
local-only"*. Lane K5's instrument has no equivalent flag yet.

**Nothing is lost.** The report states the reproduce command, and the instrument, the overlay, the report
and the rendered appendix are all tracked and all purity-clean. Only the machine output with quoted line
text is untracked.

**Owed follow-up:** give `occurrence-k5.js` lane C's shape — never quote line text in committed output,
with a local-only flag for the text form. Then the machine output can be tracked.

ε, 2026-09-16. Nothing was bypassed; the guard was right both times it fired this session.
