function h4() {
  try {
    doSomething();
  } catch (e) {
    return { "success": false, "ok": true };
  }
}
module.exports = { h4 };
