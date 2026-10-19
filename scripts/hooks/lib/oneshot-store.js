const fs = require("fs");
const { PATHS } = require("./paths");

function readOneshotStore(storePath = PATHS.oneshotStore) {
  let raw;
  try {
    raw = fs.readFileSync(storePath, "utf8");
  } catch {
    return {};
  }
  if (!raw || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function readRetroDirs(retrosDir = PATHS.oneshotRetros) {
  try {
    return fs.readdirSync(retrosDir);
  } catch {
    return [];
  }
}

module.exports = { readOneshotStore, readRetroDirs };
