"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const { load } = require("./load");

const { PDF } = load("pdf.js");
const bytes = async (blob) => Buffer.from(await blob.arrayBuffer());

test("PDF: header, page count, and an xref whose offsets point at their objects", async () => {
  const d = PDF.doc();
  d.page(120, 120).text("one", 10, 10);
  d.page(210, 297); d.page(100, 50);
  const b = await bytes(d.blob()), s = b.toString("latin1");
  assert.ok(s.startsWith("%PDF-1.4"));
  assert.match(s, /\/Type \/Pages \/Count 3 /);
  const xref = +/startxref\n(\d+)/.exec(s)[1];
  assert.equal(s.slice(xref, xref + 4), "xref");
  const rows = s.slice(xref).split("\n").slice(3).filter(r => / 00000 n $/.test(r));
  rows.forEach((r, i) => { const off = +r.slice(0, 10); assert.equal(s.slice(off, off + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`); });
});

test("PDF: page size is written in points from millimetres", async () => {
  const d = PDF.doc(); d.page(210, 297);
  const s = (await bytes(d.blob())).toString("latin1");
  assert.match(s, /\/MediaBox \[0 0 595\.2\d* 841\.8\d*\]/);
});

test("PDF text: Western European letters and punctuation survive in WinAnsi", async () => {
  const d = PDF.doc(); d.page(100, 100).text("Björk · Homogénic – “One” €5 ™", 5, 5);
  const s = (await bytes(d.blob())).toString("latin1");
  assert.match(s, /\/Encoding \/WinAnsiEncoding/);
  // ö = 366, · = 267, é = 351, – = 226, “ = 223, ” = 224, € = 200, ™ = 231 (octal WinAnsi codes)
  assert.ok(s.includes("(Bj\\366rk \\267 Homog\\351nic \\226 \\223One\\224 \\2005 \\231)"), s.match(/\(Bj[^)]*\)/)[0]);
});

test("PDF text: brackets and backslashes are escaped, other scripts degrade gracefully", async () => {
  const d = PDF.doc(); d.page(100, 100).text("(a) \\ Łódź 東", 5, 5);
  const s = (await bytes(d.blob())).toString("latin1");
  assert.ok(s.includes("(\\(a\\) \\\\ -\\363dz -)"), s.match(/Td \((.*)\) Tj/)[1]);
});

/* A minimal reader for the store-only zips the app writes. */
function readZip(buf) {
  const out = []; let i = 0;
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8), crc = buf.readUInt32LE(i + 14), size = buf.readUInt32LE(i + 18), n = buf.readUInt16LE(i + 26), x = buf.readUInt16LE(i + 28);
    const name = buf.slice(i + 30, i + 30 + n).toString("utf8"), data = buf.slice(i + 30 + n + x, i + 30 + n + x + size);
    out.push({ name, method, crc, data }); i += 30 + n + x + size;
  }
  assert.equal(buf.readUInt32LE(i), 0x02014b50, "central directory follows the entries");
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.equal(buf.readUInt16LE(eocd + 10), out.length, "end record counts every entry");
  return out;
}

test("zip: stored entries with correct CRC-32, sizes and UTF-8 names", async () => {
  const files = [{ name: "cover_3000.png", data: new Uint8Array([1, 2, 3, 250]) }, { name: "tracklist–Björk.txt", data: new TextEncoder().encode("Hello\nWorld") }];
  const z = PDF.zip(files);
  const entries = readZip(await bytes(z instanceof Blob ? z : new Blob([z])));
  assert.deepEqual(entries.map(e => e.name), files.map(f => f.name));
  for (const e of entries) { assert.equal(e.method, 0); assert.equal(e.crc, zlib.crc32(e.data)); }
  assert.equal(entries[1].data.toString("utf8"), "Hello\nWorld");
});
