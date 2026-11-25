'use strict';
const fs = require('fs');
const path = require('path');

class UnsafePath extends Error {}

function lstatOrNull(p) {
  try { return fs.lstatSync(p); } catch { return null; }
}

function assertInside(root, rel, kind = 'file') {
  const rootReal = fs.realpathSync(root);
  const parts = rel.split(/[\\/]+/).filter(Boolean);
  let cur = root;
  for (let i = 0; i < parts.length; i++) {
    cur = path.join(cur, parts[i]);
    const st = lstatOrNull(cur);
    if (!st) continue;
    if (st.isSymbolicLink()) throw new UnsafePath(`${path.relative(root, cur)} is a link; not writing through it`);
    const last = i === parts.length - 1;
    if (!last && !st.isDirectory()) throw new UnsafePath(`${path.relative(root, cur)} is not a folder`);
    if (last && kind === 'file' && !st.isFile()) throw new UnsafePath(`${path.relative(root, cur)} is not a regular file`);
    if (last && kind === 'dir' && !st.isDirectory()) throw new UnsafePath(`${path.relative(root, cur)} is not a folder`);
  }
  const parent = path.dirname(path.join(root, rel));
  if (fs.existsSync(parent)) {
    const real = fs.realpathSync(parent);
    const rel2 = path.relative(rootReal, real);
    if (rel2.startsWith('..') || path.isAbsolute(rel2)) throw new UnsafePath(`${path.relative(root, parent)} resolves outside the project`);
  }
  return path.join(root, rel);
}

function ensureDir(root, rel) {
  const parts = rel.split(/[\\/]+/).filter(Boolean);
  for (let i = 1; i <= parts.length; i++) {
    const sub = parts.slice(0, i).join('/');
    const p = assertInside(root, sub, 'dir');
    if (!lstatOrNull(p)) fs.mkdirSync(p);
  }
  return path.join(root, rel);
}

const same = (a, b) => a && b && a.dev === b.dev && a.ino === b.ino;

function writeAtomic(root, rel, data) {
  const target = assertInside(root, rel, 'file');
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  const fd = fs.openSync(tmp, 'wx');
  let made;
  try {
    fs.writeSync(fd, typeof data === 'string' ? data : Buffer.from(data));
    made = fs.fstatSync(fd);
  } finally { fs.closeSync(fd); }
  try {
    assertInside(root, rel, 'file');
    if (!same(lstatOrNull(tmp), made)) throw new UnsafePath('the temporary file changed during the write');
    fs.renameSync(tmp, target);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { }
    throw e;
  }
  return target;
}

function appendSafe(root, rel, data) {
  const target = assertInside(root, rel, 'file');
  const before = lstatOrNull(target);
  const fd = fs.openSync(target, 'a');
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || (before && !same(before, st))) throw new UnsafePath(`${rel} changed while opening it`);
    assertInside(root, rel, 'file');
    fs.writeSync(fd, data);
  } finally { fs.closeSync(fd); }
  return target;
}

function readTail(file, max) {
  const st = lstatOrNull(file);
  if (!st || !st.isFile()) return null;
  const start = Math.max(0, st.size - max);
  const buf = Buffer.alloc(st.size - start);
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, buf, 0, buf.length, start); } finally { fs.closeSync(fd); }
  return buf.toString('utf8');
}

function readCapped(file, max) {
  const st = lstatOrNull(file);
  if (!st || !st.isFile() || st.size > max) return null;
  return fs.readFileSync(file, 'utf8');
}

function removeSafe(root, rel) {
  const parent = path.dirname(rel);
  if (parent && parent !== '.') {
    const pAbs = path.join(root, parent);
    if (!lstatOrNull(pAbs)) return false;
    assertInside(root, parent, 'dir');
  }
  const target = path.join(root, rel);
  const st = lstatOrNull(target);
  if (!st) return false;
  if (!st.isFile() && !st.isSymbolicLink()) throw new UnsafePath(`${rel} is not a file`);
  fs.unlinkSync(target);
  return true;
}

module.exports = { assertInside, ensureDir, writeAtomic, appendSafe, removeSafe, readTail, readCapped, UnsafePath };
