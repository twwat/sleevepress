/* Get files: the store check, the release kit zip (folders, README, manifest), release info text and the print PDF's
   document properties, all built in the real app. */
"use strict";
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const { open, closeBrowser, skip } = require("./app");

after(closeBrowser);

const TRACKS = "Harbour Lights | | 122 | Am | 3:41\nSalt Line | feat. Ojo | 118 | Dm | 4:05\nUndertow | | 124 | | 5:12";
async function release(a, words = {}) {
  await a.page.evaluate(({ words, tracks }) => {
    SP.patch("release", { artist: "Mara Quell", title: "Low Tide\nSignals", catalog: "MQ-003", year: "2026", label: "Driftwood Tapes",
      footer: "MQ-003 · 2026", date: "FRI 14 NOV", cta: "OUT NOW", links: "maraquell.bandcamp.com", format: "EP", ...words });
    SP.set("tracks", SP.parseTracks(tracks));
  }, { words, tracks: TRACKS });
}
/* Runs fn in the page; it returns a Blob, which comes back as a Buffer. */
async function blobOf(page, fn, arg) {
  const b64 = await page.evaluate(async ({ src, arg }) => {
    const blob = await (0, eval)(src)(arg);
    return await new Promise(res => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.readAsDataURL(blob); });
  }, { src: fn.toString(), arg });
  return Buffer.from(b64, "base64");
}
function readZip(buf) {
  const out = []; let i = 0;
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const crc = buf.readUInt32LE(i + 14), size = buf.readUInt32LE(i + 18), n = buf.readUInt16LE(i + 26), x = buf.readUInt16LE(i + 28);
    const name = buf.slice(i + 30, i + 30 + n).toString("utf8"), data = buf.slice(i + 30 + n + x, i + 30 + n + x + size);
    assert.equal(zlib.crc32(data), crc, name);
    out.push({ name, data }); i += 30 + n + x + size;
  }
  return out;
}

test("store check: flags web addresses, dates, promo words, handles and store names on the cover", { skip }, async () => {
  const a = await open();
  await release(a, { footer: "Out Fri 14 Nov · maraquell.bandcamp.com" });
  const issues = await a.page.evaluate(() => ExportKit.storeIssues());
  const whats = issues.filter(i => i.name === "Footer").map(i => i.what);
  assert.ok(whats.includes("a web address"), JSON.stringify(issues));
  assert.ok(whats.includes("a release date"));

  await a.page.evaluate(() => SP.patch("release", { footer: "NEW SINGLE · @maraquell · £7.99" }));
  const w2 = (await a.page.evaluate(() => ExportKit.storeIssues())).map(i => i.what);
  for (const w of ["promo words", "a social handle", "a price"]) assert.ok(w2.includes(w), `${w}: ${w2}`);

  // the label mark counts only when it's printed as words
  await a.page.evaluate(() => { SP.patch("release", { footer: "MQ-003 · 2026", label: "Spotify Sessions" }); App.commit({ ...App.state(), labelMark: "none" }); });
  assert.deepEqual(await a.page.evaluate(() => ExportKit.storeIssues()), []);
  await a.page.evaluate(() => App.commit({ ...App.state(), labelMark: "text" }));
  assert.deepEqual((await a.page.evaluate(() => ExportKit.storeIssues())).map(i => [i.name, i.what]), [["Label mark", "a store name"]]);

  // titles and artist names are only checked for addresses and handles: a song can be called "Tidal" or "Friday 13"
  await a.page.evaluate(() => { App.commit({ ...App.state(), labelMark: "none" }); SP.patch("release", { title: "Tidal\nFriday 13", artist: "Out Now" }); });
  assert.deepEqual(await a.page.evaluate(() => ExportKit.storeIssues()), []);
  await a.page.evaluate(() => SP.patch("release", { title: "visit mara.com" }));
  assert.deepEqual((await a.page.evaluate(() => ExportKit.storeIssues())).map(i => [i.name, i.what]), [["Title", "a web address"]]);
  assert.deepEqual(a.errors, []);
  await a.close();
});

test("store check: shows on the Export page, with a small picture called out", { skip }, async () => {
  const a = await open();
  await release(a, { footer: "maraquell.bandcamp.com" });
  await a.page.evaluate(async () => {
    const c = document.createElement("canvas"); c.width = 700; c.height = 700; const x = c.getContext("2d"); x.fillStyle = "#468"; x.fillRect(0, 0, 700, 700);
    await SP.cover.setSource(c.toDataURL("image/jpeg", 0.9), "small.jpg");
    location.hash = "#export";
  });
  const box = a.page.locator("#ex-store");
  await a.page.waitForFunction(() => document.querySelectorAll("#ex-store li").length === 2);
  assert.match(await box.getAttribute("class"), /warn/);
  const items = await a.page.locator("#ex-store li").allTextContents();
  assert.match(items[0], /^Footer has a web address and a store name/);
  assert.match(items[1], /^Picture is 700 × 700 px, stretched/);
  assert.match(await a.page.locator("#ex-checks").textContent(), /Store check: 2 to fix/);

  await a.page.evaluate(async () => { SP.patch("release", { footer: "MQ-003 · 2026" }); await SP.cover.clear(); });
  await a.page.waitForFunction(() => document.querySelector("#ex-store").classList.contains("ok"));
  assert.match(await box.textContent(), /Nothing on the cover that stores usually turn down/);
  assert.deepEqual(a.errors, []);
  await a.close();
});

test("release kit zip: one top folder, a folder per group, README first, manifest last", { skip }, async () => {
  const a = await open();
  await release(a, { footer: "Out Fri 14 Nov" });
  const buf = await blobOf(a.page, async (ids) => (await ExportKit.zip(ids)).blob, ["cover1400", "cover3000jpg", "promo-teaser", "info", "youtube", "tracklist-txt"]);
  const files = readZip(buf), names = files.map(f => f.name);
  assert.ok(names.every(n => n.startsWith("MQ-003_release-kit/")), names.join("\n"));
  const rel = names.map(n => n.slice("MQ-003_release-kit/".length));
  assert.equal(rel[0], "README.txt");
  assert.equal(rel[rel.length - 1], "manifest.json");
  // in the order the page shows them, whatever order they were asked for in
  assert.deepEqual(rel.slice(1, -1), [
    "Streaming/MQ-003_Mara_Quell_-_Low_Tide_Signals_3000.jpg",
    "Streaming/MQ-003_Mara_Quell_-_Low_Tide_Signals_1400.png",
    "Promo/MQ-003_Mara_Quell_-_Low_Tide_Signals_teaser_1080x1080.png",
    "Text/MQ-003_release_info.txt",
    "Text/MQ-003_tracklist.txt",
    "Text/MQ-003_youtube_description.txt",
  ]);
  const byName = (n) => files.find(f => f.name.endsWith(n)).data;
  assert.deepEqual([...byName(".png").slice(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.deepEqual([...byName(".jpg").slice(0, 2)], [0xff, 0xd8]);

  const readme = byName("README.txt").toString("utf8");
  assert.match(readme, /^Mara Quell — Low Tide Signals \(EP\)\nMQ-003 · Driftwood Tapes · made with Sleeve Press/);
  for (const folder of ["Streaming/", "Promo/", "Text/"]) assert.ok(readme.includes("\n" + folder + "\n"), folder);
  assert.ok(readme.includes("MQ-003_release_info.txt"));
  assert.match(readme, /Before you upload\n {2}! Footer has a release date/);

  const man = JSON.parse(byName("manifest.json").toString("utf8"));
  assert.equal(man.schema, "sleevepress.kit/3");
  assert.deepEqual(man.files.map(f => f.name), rel.slice(1, -1));
  for (const f of man.files) assert.equal(f.bytes, byName(f.name).length, f.name);

  const info = byName("release_info.txt").toString("utf8");
  assert.match(info, /^Artist: +Mara Quell$/m);
  assert.match(info, /^℗ line: +℗ 2026 Driftwood Tapes$/m);
  assert.match(info, /^Tracks: +3 · 12:58 total$/m);
  assert.match(info, /^02 {2}Salt Line {2}· {2}feat\. Ojo {2}· {2}4:05 {2}· {2}118 BPM {2}· {2}Dm$/m);
  assert.deepEqual(a.errors, []);
  await a.close();
});

test("print PDF: document properties name the release, and the xref still lines up", { skip }, async () => {
  const a = await open();
  await release(a);
  const buf = await blobOf(a.page, async () => (await PrintSheet.buildPdf({ pieces: { booklet: { on: true, n: 1 }, disc: { on: true, n: 1 } } })).blob);
  const s = buf.toString("latin1");
  const utf16 = (t) => "<FEFF" + Buffer.from(t, "utf16le").swap16().toString("hex").toUpperCase() + ">";
  const n = /trailer\n<< .*\/Info (\d+) 0 R/.exec(s)[1];
  const info = new RegExp(`\\n${n} 0 obj\\n(<<.*?>>)\\nendobj`).exec(s)[1];
  assert.ok(info.includes("/Title " + utf16("Mara Quell — Low Tide Signals, print sheet")));
  assert.ok(info.includes("/Author " + utf16("Mara Quell")));
  assert.ok(info.includes("/Subject " + utf16("CD front insert, CD disc label · A4 · print at 100% / actual size")));
  assert.ok(info.includes("/Keywords " + utf16("MQ-003, Mara Quell, Low Tide Signals, Driftwood Tapes")));
  const xref = +/startxref\n(\d+)/.exec(s)[1];
  s.slice(xref).split("\n").slice(3).filter(r => / 00000 n $/.test(r))
    .forEach((r, i) => { const off = +r.slice(0, 10); assert.equal(s.slice(off, off + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`); });
  assert.deepEqual(a.errors, []);
  await a.close();
});
