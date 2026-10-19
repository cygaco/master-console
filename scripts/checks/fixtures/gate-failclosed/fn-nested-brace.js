function h1() {
  try {
    doSomething();
  } catch (e) {
    if (isRecoverable(e)) {
      logWarn(e);
    }
    process.exit(0);
  }
}
module.exports = { h1 };
