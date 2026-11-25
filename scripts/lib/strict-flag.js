"use strict";
function parseRequiredFlag(argv, name) {
  const bare = `--${name}`;
  const prefix = `${bare}=`;
  const values = [];
  let present = false;
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (typeof tok !== "string") continue;
    if (tok === bare) {
      present = true;
      values.push(i + 1 < argv.length ? argv[i + 1] : undefined);
      i++;
    } else if (tok.startsWith(prefix)) {
      present = true;
      values.push(tok.slice(prefix.length));
    }
  }
  if (!present) return { present: false, value: undefined, error: null };
  for (const v of values) {
    if (typeof v !== "string" || v.trim() === "") {
      return { present: true, value: undefined, error: `${bare} requires a non-empty value` };
    }
    if (v.startsWith("--")) {
      return { present: true, value: undefined, error: `${bare} value "${v}" looks like another flag` };
    }
  }
  if (new Set(values).size > 1) {
    return { present: true, value: undefined, error: `${bare} given twice with different values` };
  }
  return { present: true, value: values[0], error: null };
}

module.exports = { parseRequiredFlag };
