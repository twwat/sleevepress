/* Loads the app's browser scripts into a Node vm with just enough of a browser around them for the pure parts
   (track parser, record checks, PDF and zip writers). No DOM, no IndexedDB: storage falls back to memory. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "..");

function browserish() {
  const store = new Map();
  const el = () => ({ style: {}, setAttribute() {}, appendChild() {}, append() {}, remove() {}, addEventListener() {}, click() {} });
  const win = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      key: (i) => [...store.keys()][i] ?? null,
      get length() { return store.size; },
    },
    document: { getElementById: () => null, createElement: el, body: el(), head: el(), querySelector: () => null },
    addEventListener() {},
    setTimeout, clearTimeout, console, TextEncoder, Blob, atob, btoa, URL, Intl,
  };
  win.window = win;
  return win;
}

/* Runs the given files from shared/ in one fresh context and returns its global (window). */
function load(...files) {
  const ctx = vm.createContext(browserish());
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(ROOT, "shared", f), "utf8"), ctx, { filename: f });
  return ctx;
}

module.exports = { load, ROOT };
