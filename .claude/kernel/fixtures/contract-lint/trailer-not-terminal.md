# Trailer-Not-Terminal Fixture

## §1 — A block whose (single) trailer is not its terminal line

#### P1.1 — A block with content trailing its trailer

This block has exactly one well-formed trailer line, but it is not the LAST non-empty line of the
block — more non-trailer prose follows it, inside the same block (no closing "## "/"### " heading or
"---" thematic break comes between the trailer and this sentence). That trailing content is the
negative case: a block whose trailer is not its terminal line must NOT green-pass just because it
carries exactly one syntactically-valid trailer line.

Core: non-waivable

This sentence is trailing content AFTER the trailer line above — contract-lint must catch this as
malformed (structural, exit 2), never a silent pass.
