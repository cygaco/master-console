function h5() {
  try {
    doSomething();
  } catch (e) {
    logError("saw pattern: process.exit(0) in legacy code, not calling it");
    return { ok: false };
  }
}
module.exports = { h5 };
