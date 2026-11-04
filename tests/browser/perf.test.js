"use strict";
/* Rendering memory and responsiveness: big renders reuse and free their scratch canvases, keep the caches within
   budget, pause between steps, and none of that changes a pixel. */
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const { open, closeBrowser, skip } = require("./app");

after(closeBrowser);

/* Looks that use every big scratch canvas: plates (words layer), a pattern inside a shape (mask), stencil / stripe /
   knockout titles (title layer), rotated and clipped patterns (pattern layer) and plain tiled ones (no layer). */
const HEAVY = {
  multicamPlates: { pattern: "multicam", patternAmt: 80, patternArea: "full", plates: "all", titleStyle: "stencil" },
  snakeInShape: { pattern: "snakeskin", patternAmt: 70, patternArea: "shape", shape: "circle", shapeAmt: 85, shapeSize: 70, plates: "title", titleStyle: "stripe", imgMode: "panel" },
  topoKnockout: { pattern: "topo", patternAmt: 60, patternArea: "full", plates: "all", titleStyle: "knockout", titleRotate: "up" },
  woodlandEdge: { pattern: "woodland", patternAmt: 70, patternArea: "edge", patternAngle: 30, shape: "wave", shapeAmt: 60, plates: "all", titleStyle: "stencil" },
  leopardBand: { pattern: "leopard", patternAmt: 75, patternArea: "band", plates: "none", titleStyle: "solid", titleRotate: "down" },
};

/* Counts canvas pixels: every canvas created, or resized, while window.__track is on. */
function trackCanvases() {
  const seen = new Set(), proto = HTMLCanvasElement.prototype;
  for (const k of ["width", "height"]) {
    const d = Object.getOwnPropertyDescriptor(proto, k);
    Object.defineProperty(proto, k, { get() { return d.get.call(this); }, set(v) { d.set.call(this, v); if (window.__track) seen.add(this); }, configurable: true });
  }
  const make = Document.prototype.createElement;
  Document.prototype.createElement = function (t, ...a) { const el = make.call(this, t, ...a); if (window.__track && String(t).toLowerCase() === "canvas") seen.add(el); return el; };
  window.__heldPixels = () => { let px = 0, big = 0; const sizes = []; for (const c of seen) { px += c.width * c.height; if (c.width * c.height >= 2e6) { big++; sizes.push(c.width + "x" + c.height); } } return { px, big, sizes }; };
}

/* Puts a render helper on the page: __render(over, size, { cold }) -> pixel hash; the canvas is freed afterwards. */
async function withHelpers(page) {
  await page.evaluate((HEAVY) => {
    window.HEAVY = HEAVY;
    window.__render = async (over, size, o = {}) => {
      if (o.cold) Patterns.clearCache();
      const c = document.createElement("canvas"); c.width = c.height = size;
      await SleeveRender.render(c, { ...App.state(), title: "NIGHT SHIFT\nSESSIONS", artist: "SLEEVE PRESS", ...over }, null, null);
      const hash = SP.hashStr(c.toDataURL());
      c.width = c.height = 0;
      return hash;
    };
  }, HEAVY);
}

test("heavy renders give the same pixels whatever ran before, and side by side", { skip }, async () => {
  const a = await open();
  await withHelpers(a.page);
  const r = await a.page.evaluate(async () => {
    const names = Object.keys(HEAVY), first = {}, again = {}, together = {};
    for (const n of names) first[n] = await __render(HEAVY[n], 1600, { cold: true });
    for (const n of [...names].reverse()) again[n] = await __render(HEAVY[n], 1600);   // caches warm, scratch canvases reused
    // big renders pause between steps, so two at once interleave: each must still get its own scratch canvases
    const hs = await Promise.all(names.map(n => __render(HEAVY[n], 1600)));
    names.forEach((n, i) => { together[n] = hs[i]; });
    return { first, again, together };
  });
  assert.deepEqual(r.again, r.first, "re-rendered with warm caches");
  assert.deepEqual(r.together, r.first, "rendered all at once");
  assert.deepEqual(a.errors, []);
  await a.close();
});

test("a plain tiled pattern drawn without its layer matches the layer to the pixel", { skip }, async () => {
  const a = await open();
  const r = await a.page.evaluate(() => {
    const out = [];
    const ground = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d"); g.fillStyle = "#2b2233"; g.fillRect(0, 0, w, h); return g; };
    const same = (g1, g2) => { const p = g1.getImageData(0, 0, g1.canvas.width, g1.canvas.height).data, q = g2.getImageData(0, 0, g2.canvas.width, g2.canvas.height).data; let n = 0; for (let i = 0; i < p.length; i++) if (p[i] !== q[i]) n++; return n; };
    for (const id of ["multicam", "snakeskin", "leopard", "buffalo", "tartan", "zebra", "cowhide"]) {
      const o = { S: 900, scale: 85, angle: 0, fg: [236, 220, 190], fg2: [200, 60, 40], bg: [43, 34, 51], alpha: 0.7, seed: 11 };
      Patterns.clearCache();
      // straight onto the sleeve
      const d = ground(900, 700); Patterns.draw(d, 900, 700, id, { ...o, unclipped: true });
      const directLayers = Patterns.cached().layers;
      const l = ground(900, 700); Patterns.draw(l, 900, 700, id, o);
      // inside a bigger canvas, moved by whole pixels (the pattern must stay within its own area)
      const d2 = ground(1000, 800); d2.translate(40, 30); Patterns.draw(d2, 900, 700, id, { ...o, unclipped: true });
      const l2 = ground(1000, 800); l2.translate(40, 30); Patterns.draw(l2, 900, 700, id, o);
      // masked into a shape
      const mask = () => { const g = document.createElement("canvas").getContext("2d"); g.canvas.width = 900; g.canvas.height = 700; g.beginPath(); g.arc(430, 360, 300, 0, 7); g.fill(); g.globalCompositeOperation = "source-in"; return g; };
      const d3 = mask(); Patterns.draw(d3, 900, 700, id, { ...o, unclipped: true });
      const l3 = mask(); Patterns.draw(l3, 900, 700, id, o);
      // built ahead in steps (as a big render does, pausing between them), rotated too: the same as built in one go
      const rot = { ...o, angle: 30 }, one = ground(900, 700); Patterns.draw(one, 900, 700, id, rot);
      Patterns.clearCache(); let n = 0; for (const _ of Patterns.steps(900, 700, id, rot)) n++;
      const stepped = ground(900, 700); Patterns.draw(stepped, 900, 700, id, rot);
      out.push({ id, directLayers, plain: same(d, l), moved: same(d2, l2), masked: same(d3, l3), stepped: same(one, stepped), n });
    }
    return out;
  });
  for (const x of r) {
    assert.equal(x.directLayers, 0, `${x.id} was laid without a sleeve-sized layer`);
    assert.deepEqual([x.plain, x.moved, x.masked, x.stepped], [0, 0, 0, 0], `${x.id}: differing values (plain, moved, masked, stepped)`);
  }
  // the field-noise camos build a field or a contour layer per step
  assert.ok(r.find(x => x.id === "multicam").n > 10, "multicam is built in steps");
  await a.close();
});

test("scratch canvases and caches stay within budget after many big renders", { skip }, async () => {
  const a = await open({ init: trackCanvases });
  await withHelpers(a.page);
  const r = await a.page.evaluate(async () => {
    window.__track = true;
    const names = Object.keys(HEAVY);
    for (let i = 0; i < 3; i++) for (const n of names) for (const size of [3000, 1200, 420]) await __render({ ...HEAVY[n], patternSeed: i + 1 }, size);
    window.__track = false;
    return { held: __heldPixels(), scratch: SleeveRender.scratchPixels(), cached: Patterns.cached(), low: Patterns.LOW_MEMORY };
  });
  assert.equal(r.low, false);
  // what the renderer leaves at full size: the pattern caches (16 + 8 Mpx budgets), a couple of idle preview-sized
  // scratch canvases and the glyph scratch. Before pooling, every plates render left a new 9 Mpx words layer behind.
  assert.ok(r.scratch <= 3.2e6, `idle scratch canvases hold ${r.scratch} px`);
  assert.ok(r.cached.layers <= 16e6 && r.cached.tiles <= 8e6, `pattern caches hold ${JSON.stringify(r.cached)}`);
  assert.ok(r.held.px <= 34e6, `canvases left at full size hold ${(r.held.px / 1e6).toFixed(1)} Mpx`);
  assert.ok(r.held.big <= 3, `${r.held.big} canvases of 2 Mpx or more are still allocated`);
  assert.deepEqual(a.errors, []);
  await a.close();
});

test("on a low-memory device a big export leaves almost nothing allocated", { skip }, async () => {
  const a = await open({ init: () => { Object.defineProperty(Navigator.prototype, "deviceMemory", { get: () => 2, configurable: true }); } });
  await a.page.evaluate(trackCanvases);
  await withHelpers(a.page);
  const r = await a.page.evaluate(async () => {
    window.__track = true;
    for (const n of Object.keys(HEAVY)) await __render(HEAVY[n], 3000);
    window.__track = false;
    return { held: __heldPixels(), scratch: SleeveRender.scratchPixels(), cached: Patterns.cached(), low: Patterns.LOW_MEMORY };
  });
  assert.equal(r.low, true);
  assert.ok(r.scratch <= 1.5e6, `idle scratch canvases hold ${r.scratch} px`);
  assert.ok(r.cached.layers <= 4e6 && r.cached.tiles <= 2e6, `pattern caches hold ${JSON.stringify(r.cached)}`);
  assert.ok(r.held.px <= 10e6, `canvases left at full size hold ${(r.held.px / 1e6).toFixed(1)} Mpx`);
  assert.equal(r.held.big, 0, `canvases of 2 Mpx or more left allocated: ${r.held.sizes}`);
  await a.close();
});

test("a big render lets other work run between its steps", { skip }, async () => {
  const a = await open();
  await withHelpers(a.page);
  const ticks = await a.page.evaluate(async () => {
    let n = 0, on = true; const ch = new MessageChannel();
    ch.port1.onmessage = () => { n++; if (on) ch.port2.postMessage(0); };
    ch.port2.postMessage(0);
    await __render(HEAVY.multicamPlates, 3000, { cold: true });
    on = false; return n;
  });
  // one tick could slip in before the render starts; the pauses between picture, backdrop, words and grain give more
  assert.ok(ticks >= 4, `other work ran ${ticks} times during a 3000 px render`);
  await a.close();
});
