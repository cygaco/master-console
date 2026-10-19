# Not A Contract

This document contains prose, a heading, and nothing that looks like a numbered policy block. There
is no `#### P<n>.<m>` heading anywhere below, so contract-lint cannot find a single policy block to
parse. This is the "malformed" negative case: the input is unparseable AS A CONTRACT (zero policy
blocks found), which must fail CLOSED (exit 2), never a clean pass.

Some text that might look policy-ish but is not a block:

Enforcer without a heading above it does not count.
