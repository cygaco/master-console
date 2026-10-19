#!/usr/bin/env node

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  b3: "\x1b[38;5;19m",
  b5: "\x1b[38;5;32m",
  b6: "\x1b[38;5;38m",
  b7: "\x1b[38;5;44m",
  b8: "\x1b[38;5;50m",
  b9: "\x1b[38;5;51m",
  w: "\x1b[38;5;15m",
  g: "\x1b[38;5;240m",
  gg: "\x1b[38;5;245m",
  acc: "\x1b[38;5;213m",
  gold: "\x1b[38;5;220m",
  grn: "\x1b[38;5;48m",
};

function renderBanner(info = {}) {
  const {
    branch = "?",
    uncommitted = 0,
    sessionId = "?",
    mode = "adhoc",
  } = info;

  const lines = [
    ``,
    `${c.b3}    ╔══════════════════════════════════════════════════════════════╗${c.reset}`,
    `${c.b3}    ║${c.b5}                                                              ${c.b3}║${c.reset}`,
    `${c.b3}    ║${c.b6}      █████╗ ${c.b7} ██╗     ${c.b8} ███████╗${c.b9} ██╗  ██╗${c.w}                      ${c.b3}║${c.reset}`,
    `${c.b3}    ║${c.b6}     ██╔══██╗${c.b7} ██║     ${c.b8} ██╔════╝${c.b9} ╚██╗██╔╝${c.w}                      ${c.b3}║${c.reset}`,
    `${c.b3}    ║${c.b6}     ███████║${c.b7} ██║     ${c.b8} █████╗  ${c.b9}  ╚███╔╝ ${c.w}                      ${c.b3}║${c.reset}`,
    `${c.b3}    ║${c.b6}     ██╔══██║${c.b7} ██║     ${c.b8} ██╔══╝  ${c.b9}  ██╔██╗ ${c.w}                      ${c.b3}║${c.reset}`,
    `${c.b3}    ║${c.b6}     ██║  ██║${c.b7} ███████╗${c.b8} ███████╗${c.b9} ██╔╝ ██╗${c.w}                      ${c.b3}║${c.reset}`,
    `${c.b3}    ║${c.b6}     ╚═╝  ╚═╝${c.b7} ╚══════╝${c.b8} ╚══════╝${c.b9} ╚═╝  ╚═╝${c.w}                      ${c.b3}║${c.reset}`,
    `${c.b3}    ║${c.b5}                                                              ${c.b3}║${c.reset}`,
    `${c.b3}    ║${c.g}             ─── ${c.acc}${c.bold}Autonomous Learning Engine X${c.reset}${c.g} ───             ${c.b3}║${c.reset}`,
    `${c.b3}    ║${c.b5}                                                              ${c.b3}║${c.reset}`,
    `${c.b3}    ║${c.g}  ┌────────────────────────────────────────────────────────┐  ${c.b3}║${c.reset}`,
    `${c.b3}    ║${c.g}  │${c.gg}  Session ${c.w}${c.bold}${sessionId.padEnd(12)}${c.reset}${c.g}  │${c.gg}  Branch ${c.grn}${c.bold}${branch.padEnd(22)}${c.reset}${c.g}│  ${c.b3}║${c.reset}`,
    `${c.b3}    ║${c.g}  │${c.gg}  Mode    ${c.gold}${c.bold}${mode.padEnd(12)}${c.reset}${c.g}  │${c.gg}  Files  ${c.w}${c.bold}${String(uncommitted).padEnd(22)}${c.reset}${c.g}│  ${c.b3}║${c.reset}`,
    `${c.b3}    ║${c.g}  └────────────────────────────────────────────────────────┘  ${c.b3}║${c.reset}`,
    `${c.b3}    ║${c.b5}                                                              ${c.b3}║${c.reset}`,
    `${c.b3}    ║${c.dim}${c.gg}       α architect · β judgement · γ builder · δ runner       ${c.reset}${c.b3}║${c.reset}`,
    `${c.b3}    ║${c.b5}                                                              ${c.b3}║${c.reset}`,
    `${c.b3}    ╚══════════════════════════════════════════════════════════════╝${c.reset}`,
    ``,
  ];

  return lines.join("\n");
}

module.exports = { renderBanner };

if (require.main === module) {
  process.stderr.write(
    renderBanner({
      branch: "feature/example",
      uncommitted: 25,
      sessionId: "s-demo01",
      mode: "adhoc",
    }),
  );
}
