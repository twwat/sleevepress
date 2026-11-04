"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load");

const fresh = () => load("press.js").SP;
const plain = (o) => JSON.parse(JSON.stringify(o));   // vm objects come from another realm

test("parseTracks: numbering, separators, feat., bpm, key and time in any order", () => {
  const SP = fresh();
  const t = plain(SP.parseTracks("01. Candle at the Gate | 72 | Dm | 3:41\n2) Yard Morning (feat. Mama Bright) | 4:05 | 74 | Gm\n99 Problems"));
  assert.equal(t.length, 3);
  assert.deepEqual(t[0], { title: "Candle at the Gate", feat: "", bpm: "72", key: "Dm", length: "3:41", side: "A" });
  assert.deepEqual(t[1], { title: "Yard Morning", feat: "Mama Bright", bpm: "74", key: "Gm", length: "4:05", side: "A" });
  assert.equal(t[2].title, "99 Problems", "a bare leading number is part of the title");
});

test("parseTracks: side markers and key spelling", () => {
  const SP = fresh();
  const t = plain(SP.parseTracks("One | F#m\n--\nTwo | Bb\n--- D\nThree"));
  assert.deepEqual(t.map(x => x.side), ["A", "B", "D"]);
  assert.equal(t[0].key, "F♯m"); assert.equal(t[1].key, "B♭");
});

test("tracksToText round-trips through parseTracks", () => {
  const SP = fresh();
  const src = "Candle at the Gate | 72 | Dm | 3:41\nYard Morning (feat. Mama Bright) | 74 | Gm | 4:05\n--- B\nWake Dub | 70 | Dm | 6:02";
  const once = SP.parseTracks(src), again = SP.parseTracks(SP.tracksToText(once));
  assert.deepEqual(plain(again), plain(once));
  assert.equal(SP.fmtTime(SP.runtime(once)), "13:48");
});

test("records: damaged fields fall back to defaults instead of breaking views", () => {
  const SP = fresh();
  SP.replace({ release: { artist: null, title: 7, catalog: "X-1" }, tracks: [null, { title: "Ok", bpm: 120 }, "junk"], looks: [null, 5, { id: "a", look: {} }], palette: "red" });
  const d = plain(SP.get());
  assert.equal(typeof d.release.artist, "string");
  assert.equal(typeof d.release.title, "string");
  assert.equal(d.release.catalog, "X-1");
  assert.deepEqual(d.tracks.map(t => [t.title, t.bpm, t.side]), [["Ok", "120", "A"]]);
  assert.deepEqual(d.looks.map(l => [l.id, l.name]), [["a", "Look"]]);
  assert.equal(typeof d.palette.bg, "string");
});

test("records: unknown keys inside sections pass through (newer files still open)", () => {
  const SP = fresh();
  SP.replace({ release: { artist: "A", isrc: "GB-123" }, sleeve: { someNewSetting: 3 } });
  const d = plain(SP.get());
  assert.equal(d.release.isrc, "GB-123");
  assert.equal(d.sleeve.someNewSetting, 3);
});

test("importObject refuses a file that isn't a release, changing nothing", async () => {
  const SP = fresh();
  SP.patch("release", { artist: "KEEP ME" });
  await assert.rejects(SP.importObject({ schema: "something.else/1", release: { artist: "NO" } }));
  await assert.rejects(SP.importObject(null));
  assert.equal(SP.get().release.artist, "KEEP ME");
});

test("edits to the user's work call the undo hook; flags and opt-outs don't", () => {
  const SP = fresh(); let n = 0; SP.onBeforeEdit(() => n++);
  SP.set("tracks", []); SP.patch("print", { paper: "a4" }); SP.patch("release", { cta: "OUT NOW" });
  assert.equal(n, 3);
  SP.set("looks", []); SP.patch("names", { seed: 2 }); SP.patch("promo", { picked: [] }, { undo: false });
  assert.equal(n, 3);
});

test("safeName and hashStr are stable", () => {
  const SP = fresh();
  assert.equal(SP.safeName("HPR-001 / Night Shift: Live!"), "HPR-001_Night_Shift_Live");
  assert.equal(SP.hashStr("sleeve"), SP.hashStr("sleeve"));
  assert.notEqual(SP.hashStr("sleeve"), SP.hashStr("sleevf"));
});
