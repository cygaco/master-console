function h7() {
  try {
    doSomething();
  } catch (e) {
    throw e;
    process.exit(0);
  }
}
module.exports = { h7 };
