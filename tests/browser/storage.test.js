"use strict";
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const { open, closeBrowser, skip } = require("./app");

after(closeBrowser);

test("save → reload → open brings the release and its picture back", { skip }, async () => {
  const a = await open();
  const pic = await a.page.evaluate(async () => {
    const c = document.createElement("canvas"); c.width = 800; c.height = 600; const x = c.getContext("2d"); x.fillStyle = "#c33"; x.fillRect(0, 0, 800, 600);
    const u = c.toDataURL("image/jpeg", 0.9);
    SP.patch("release", { artist: "SAVED ARTIST" }); await SP.cover.setSource(u, "pic.jpg");
    const id = await App.saveToLibrary(); return { id, u };
  });
  assert.ok(pic.id);
  await a.page.evaluate(() => SP.reset({ artist: "SOMEONE ELSE" }));
  await a.page.reload(); await a.page.waitForFunction(() => window.App && window.SP);
  const back = await a.page.evaluate(async (id) => { const r = await SP.library.open(id); return { r, artist: SP.get().release.artist, pic: await SP.cover.data() }; }, pic.id);
  assert.equal(back.r, true);
  assert.equal(back.artist, "SAVED ARTIST");
  assert.equal(back.pic, pic.u, "picture bytes kept exactly (no re-compression)");
  assert.deepEqual(a.errors, []);
  await a.close();
});

test("two saves at once make one library entry", { skip }, async () => {
  const a = await open();
  const r = await a.page.evaluate(async () => {
    const [x, y] = await Promise.all([App.saveToLibrary(), App.saveToLibrary()]);
    return { same: x === y, n: (await SP.library.list()).length };
  });
  assert.deepEqual(r, { same: true, n: 1 });
  await a.close();
});

test("a refused storage write is reported, not claimed as saved", { skip }, async () => {
  const a = await open();
  const r = await a.page.evaluate(async () => {
    const real = SP.vault.set; SP.vault.set = async () => false;
    const id = await App.saveToLibrary();
    SP.vault.set = real;
    return { id, n: (await SP.library.list()).length, toast: document.getElementById("toast").textContent };
  });
  assert.equal(r.id, null);
  assert.equal(r.n, 0);
  assert.match(r.toast, /Couldn't save/);
  await a.close();
});

test("a damaged release file loads safely and says its picture was left out", { skip }, async () => {
  const a = await open();
  const r = await a.page.evaluate(async () => {
    const res = await SP.importObject({ schema: "sleevepress.release/1", libId: "rStale", release: { artist: null, title: "IMPORTED" },
      image: { dataUrl: "data:image/jpeg;base64,AAAA" }, looks: [null, { id: "x" }] });
    return { res, title: SP.get().release.title, artist: typeof SP.get().release.artist, libId: SP.get().libId || null };
  });
  assert.deepEqual(r, { res: { badPicture: true }, title: "IMPORTED", artist: "string", libId: null });
  await a.page.evaluate(() => { location.hash = "#export"; });
  await a.page.waitForTimeout(500);
  assert.deepEqual(a.errors, [], "Export renders after the import");
  await a.close();
});

test("back up → restore into an empty browser", { skip }, async () => {
  const a = await open();
  const backup = await a.page.evaluate(async () => {
    SP.patch("release", { artist: "BACKED UP", label: "MY LABEL" }); await App.saveToLibrary();
    App.flag({ ...App.state() });
    let blob; // capture the backup file instead of downloading it
    const orig = URL.createObjectURL; URL.createObjectURL = (b) => { blob = b; return orig.call(URL, b); };
    await SP.library.backup(); URL.createObjectURL = orig;
    return await blob.text();
  });
  await a.close();
  const b = await open();
  const r = await b.page.evaluate(async (text) => {
    const o = JSON.parse(text); SP.patch("release", { label: "" });
    const n = await SP.library.restore(o);
    const list = await SP.library.list();
    return { n, names: list.map(e => e.name), flags: SP.get().looks.length, label: SP.get().release.label };
  }, backup);
  assert.equal(r.n, 1);
  assert.match(r.names[0], /BACKED UP/);
  assert.equal(r.flags, 1);
  assert.equal(r.label, "MY LABEL");
  await b.close();
});

test("restore skips broken entries and never keeps remote thumbnails", { skip }, async () => {
  const a = await open();
  const r = await a.page.evaluate(async () => {
    const n = await SP.library.restore({ schema: "sleevepress.library/1", looks: [null, 5],
      releases: [null, { entry: { id: "rX", thumb: "https://example.com/x.png" }, record: { release: { artist: "A", title: "T" } } }, { entry: {}, record: {} }] });
    const e = (await SP.library.list()).find(x => x.id === "rX");
    return { n, thumb: e.thumb, name: e.name };
  });
  assert.deepEqual(r, { n: 1, thumb: null, name: "T" });
  await a.close();
});

test("undo steps back through a tracklist edit, then a colour change", { skip }, async () => {
  const a = await open();
  const r = await a.page.evaluate(async () => {
    const start = SP.get().palette.accent;
    App.commit({ ...App.state(), accent: "#00ff00" }, { force: true });
    await new Promise(z => setTimeout(z, 800));
    SP.set("tracks", SP.parseTracks("One | 3:00\nTwo | 4:00"));
    App.undo(); const tracks = SP.get().tracks.length, accent = SP.get().palette.accent;
    App.undo(); const accent2 = SP.get().palette.accent;
    App.redo(); App.redo();
    return { tracks, accent, back: accent2 === start, redoTracks: SP.get().tracks.length };
  });
  assert.deepEqual(r, { tracks: 0, accent: "#00ff00", back: true, redoTracks: 2 });
  await a.close();
});
