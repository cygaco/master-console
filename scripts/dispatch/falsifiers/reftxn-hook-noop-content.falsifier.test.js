"use strict";
// FALSIFIER: reftxn-hook-noop-content — record-trust gate. The hook-liveness precondition must prove the ACTIVE hook genuinely
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const NOOP_SHAPES = [
  ["a name-bearing NO-OP (the exact case)", "#!/usr/bin/env bash\n# protected-ref-transaction.js\nexit 0\n"],
  ["a TRUNCATED installer output (shebang + name comment only)", "#!/usr/bin/env bash\n# installs protected-ref-transaction\n"],
  ["a name in a comment above an unrelated command", "#!/usr/bin/env bash\n# exec node protected-ref-transaction.js \"$@\"\ntrue\n"],
  ["an echo of the name (mentions, never executes)", '#!/usr/bin/env bash\necho "protected-ref-transaction.js"\nexit 0\n'],
];

test("reftxn-hook-noop-content — verifyActiveHookInstalled REFUSES every name-bearing NON-INVOKING hook shape", (t) => {
  const ctl = require("../trusted-controller");
  const { makeScratchRepo, installNoopHook, installHook, rmrf } = require("./_lib/git-scratch");

  for (const [label, body] of NOOP_SHAPES) {
    const dir = makeScratchRepo("noop-hook");
    t.after(() => rmrf(dir));
    installNoopHook(dir, body);

    const res = ctl.verifyActiveHookInstalled({ gitRoot: dir });
    assert.strictEqual(res.ok, false, `MUST-BLOCK: ${label} provides NO enforcement and must never verify as pinned`);
    assert.ok(
      ["active-hook-not-pinned", "active-hook-not-pinned-module"].includes(res.reason),
      `${label}: expected a not-pinned refusal, got ${res.reason}`,
    );
  }

  const good = makeScratchRepo("noop-hook-control");
  t.after(() => rmrf(good));
  installHook(good);
  const ok = ctl.verifyActiveHookInstalled({ gitRoot: good });
  assert.strictEqual(ok.ok, true, `CONTROL: the canonical wrapper must verify: ${JSON.stringify(ok)}`);
});

test("reftxn-hook-noop-content — a hook that invokes a DIFFERENT (non-pinned) file of the same name is REFUSED", (t) => {
  const ctl = require("../trusted-controller");
  const { makeScratchRepo, installNoopHook, hooksDirOf, rmrf } = require("./_lib/git-scratch");

  const dir = makeScratchRepo("wrong-module-hook");
  t.after(() => rmrf(dir));

  const decoy = path.join(hooksDirOf(dir), "protected-ref-transaction.js");
  fs.mkdirSync(path.dirname(decoy), { recursive: true });
  fs.writeFileSync(decoy, '"use strict";\nprocess.exit(0);\n');
  installNoopHook(dir, `#!/usr/bin/env bash\nexec node "${decoy.replace(/\\/g, "/")}" "$@"\n`);

  const res = ctl.verifyActiveHookInstalled({ gitRoot: dir });
  assert.strictEqual(res.ok, false, "MUST-BLOCK: invoking a look-alike module is not invoking the PINNED module");
  assert.strictEqual(res.reason, "active-hook-not-pinned-module");

  installNoopHook(dir, '#!/usr/bin/env bash\nexec node "/nowhere/at/all/protected-ref-transaction.js" "$@"\n');
  const res2 = ctl.verifyActiveHookInstalled({ gitRoot: dir });
  assert.strictEqual(res2.ok, false, "MUST-BLOCK: an unresolvable invocation target is not proof of enforcement");
  assert.strictEqual(res2.reason, "active-hook-not-pinned-module");
});

test("reftxn-hook-noop-content — END-TO-END: a no-op hook REFUSES integration at the precondition (the ref never advances)", (t) => {
  const { makeControllerFixture, standardInput, standardOpts } = require("./_lib/controller-fixtures");
  const { headSha, installNoopHook } = require("./_lib/git-scratch");
  const ctl = require("../trusted-controller");

  const fx = makeControllerFixture("noop-hook-e2e", { skipHookInstall: true });
  t.after(() => fx.cleanup());
  installNoopHook(fx.dir);

  const result = ctl.integrate(standardInput(fx), standardOpts(fx));
  assert.strictEqual(result.ok, false, "MUST-BLOCK: a repo fenced only by a no-op hook is NOT fenced");
  assert.strictEqual(result.decision, "BLOCKED");
  assert.ok(["active-hook-not-pinned", "active-hook-not-pinned-module"].includes(result.reason), `got ${result.reason}`);
  assert.strictEqual(headSha(fx.dir, fx.targetRef), fx.base, "the ref must never have advanced");
});

test("reftxn-hook-noop-content — the invocation extractor itself: comments never count, real invocations do", () => {
  const ctl = require("../trusted-controller");

  for (const [, body] of NOOP_SHAPES) {
    assert.strictEqual(ctl.extractPinnedHookInvocation(body), null, `a non-invoking shape must extract nothing: ${JSON.stringify(body)}`);
  }
  for (const body of [
    '#!/usr/bin/env bash\nexec node "/abs/path/protected-ref-transaction.js" "$@"\n',
    "#!/bin/sh\nnode /abs/path/protected-ref-transaction.js \"$@\"\n",
    '#!/usr/bin/env node\nrequire("/abs/path/protected-ref-transaction.js");\n',
  ]) {
    const got = ctl.extractPinnedHookInvocation(body);
    assert.ok(got && /protected-ref-transaction\.js$/.test(got.rawPath), `a real invocation must be extracted: ${JSON.stringify(body)}`);
  }
});
