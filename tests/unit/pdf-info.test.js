"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load");

const { PDF } = load("pdf.js");
const text = async (d) => Buffer.from(await d.blob().arrayBuffer()).toString("latin1");
const utf16 = (s) => "<FEFF" + Buffer.from(s, "utf16le").swap16().toString("hex").toUpperCase() + ">";

test("PDF info: title, author, subject and keywords land in the Info dictionary the trailer points at", async () => {
  const d = PDF.doc({ title: "Björk — Homogénic, print sheet", author: "Björk", subject: "CD front insert · A4", keywords: "TPLP71" });
  d.page(210, 297);
  const s = await text(d);
  const ref = /trailer\n<< .*\/Info (\d+) 0 R/.exec(s);
  assert.ok(ref, "trailer has /Info");
  const info = new RegExp(`\\n${ref[1]} 0 obj\\n(<<.*?>>)\\nendobj`).exec(s)[1];
  assert.ok(info.includes("/Title " + utf16("Björk — Homogénic, print sheet")), info);
  assert.ok(info.includes("/Author " + utf16("Björk")));
  assert.ok(info.includes("/Subject " + utf16("CD front insert · A4")));
  assert.ok(info.includes("/Keywords " + utf16("TPLP71")));
  assert.ok(info.includes("/Producer " + utf16("Sleeve Press")));
  assert.match(info, /\/CreationDate \(D:\d{14}(Z|[+-]\d\d'\d\d')\)/);
});

test("PDF info: empty fields are left out, and the xref still lines up", async () => {
  const d = PDF.doc({ title: "  ", author: "" });
  d.page(100, 100).text("x", 5, 5);
  const s = await text(d);
  assert.doesNotMatch(s, /\/Title|\/Author/);
  const xref = +/startxref\n(\d+)/.exec(s)[1];
  const rows = s.slice(xref).split("\n").slice(3).filter(r => / 00000 n $/.test(r));
  assert.ok(rows.length >= 5);
  rows.forEach((r, i) => { const off = +r.slice(0, 10); assert.equal(s.slice(off, off + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`); });
});
