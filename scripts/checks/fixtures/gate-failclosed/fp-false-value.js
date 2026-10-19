function h8() {
  try {
    doSomething();
  } catch (e) {
    return { ok: true && false };
  }
}
module.exports = { h8 };
