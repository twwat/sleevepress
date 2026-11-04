"use strict";
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { open, closeBrowser, skip } = require("./app");

after(closeBrowser);

/* Any TrueType font on this machine, to stand in for a Google font in the font-loading test. */
const FONT = ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/crosextra/Carlito-Regular.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf", "/System/Library/Fonts/Supplemental/Arial.ttf",
  "/Library/Fonts/Arial.ttf", "C:\\Windows\\Fonts\\arial.ttf"].find(f => { try { return fs.statSync(f).isFile(); } catch (e) { return false; } });

/* Renders a sleeve at `size` for a state built from the current one plus `over`; returns { hash, boxes }. */
const render = (page, over, size = 500) => page.evaluate(async ([over, size]) => {
  const c = document.createElement("canvas"); c.width = c.height = size;
  const boxes = await SleeveRender.render(c, { ...App.state(), ...over }, null, null);
  return { hash: SP.hashStr(c.toDataURL()), boxes: JSON.parse(JSON.stringify(boxes || {})) };
}, [over, size]);

test("the same settings give the same picture", { skip }, async () => {
  const a = await open();
  const seeds = [3, 41, 977];
  for (const seed of seeds) {
    const st = await a.page.evaluate((seed) => Looks.randomize(App.state(), seed), seed);
    const one = await render(a.page, st), two = await render(a.page, st);
    assert.equal(one.hash, two.hash, `seed ${seed}`);
  }
  assert.deepEqual(a.errors, []);
  await a.close();
});

test("a slow font stylesheet doesn't leave a face on the fallback", { skip: skip || (!FONT && "no local .ttf to stand in for a web font") }, async () => {
  const font = fs.readFileSync(FONT), FACE = "Sleeve Test Face";
  const a = await open({
    // the renderers' stylesheet (the one naming every face) arrives late and declares a face nothing else uses
    fontsCSS: async (r) => {
      if (!/Italiana/.test(r.request().url())) return r.fulfill({ contentType: "text/css", body: "" });
      await new Promise(z => setTimeout(z, 1200));
      r.fulfill({ contentType: "text/css", body: `@font-face { font-family: "${FACE}"; font-weight: 100 900; src: url(https://fonts.gstatic.com/test.ttf) format("truetype"); }` });
    },
    fontFile: (r) => r.fulfill({ contentType: "font/ttf", body: font }),
    // asked for the moment the renderer exists, while the stylesheet is still on its way (as Discover does)
    init: (face) => document.addEventListener("DOMContentLoaded", () => { window.__early = SleeveRender.loadFont(face); }),
    initArg: FACE,
  });
  await a.page.evaluate(() => window.__early);
  await a.page.waitForFunction((face) => [...document.fonts].some(f => f.family.replace(/"/g, "") === face), FACE);
  const ok = await a.page.evaluate(async (face) => { await SleeveRender.loadFont(face); return document.fonts.check(`600 100px "${face}"`); }, FACE);
  assert.equal(ok, true, "the renderer still waits for the face once its stylesheet has arrived");
  await a.close();
});

test("a long one-line title is set on balanced lines, not shrunk to a sliver", { skip }, async () => {
  const a = await open();
  const long = "THE EXTRAORDINARILY LONG TITLE OF A RECORD THAT NOBODY WILL REMEMBER";
  const { boxes } = await render(a.page, { title: long, titleBleed: false, titleRotate: "none", titleStyle: "solid" }, 600);
  assert.ok(boxes.title.h > 600 * 0.08, `title block is ${boxes.title.h.toFixed(1)} px tall`);
  // the disc label asks for one line (stacked lines would run into the hub)
  const oneLine = await render(a.page, { title: long, titleBleed: false, titleRotate: "none", titleStyle: "solid", titleWrap: false }, 600);
  assert.ok(oneLine.boxes.title.h < boxes.title.h / 2, "titleWrap: false keeps it on one line");
  // a short title stays on one line at full size
  const short = await render(a.page, { title: "WAVE", titleBleed: false, titleRotate: "none", titleStyle: "solid" }, 600);
  assert.ok(short.boxes.title.h < boxes.title.h * 1.5);
  await a.close();
});

test("tracking leaves multi-part emoji and joined scripts whole", { skip }, async () => {
  const a = await open();
  const r = await a.page.evaluate(() => {
    const x = document.createElement("canvas").getContext("2d"); x.font = "100px sans-serif";
    const whole = (t) => x.measureText(t).width;
    return ["👨‍👩‍👧", "🇯🇵", "مرحبا"].map(t => ({ t, tracked: SleeveRender.measureTracked(x, t, 0, 100), whole: whole(t) }));
  });
  for (const m of r) assert.ok(Math.abs(m.tracked - m.whole) < 1, `${m.t}: ${m.tracked} vs ${m.whole}`);
  await a.close();
});

test("generated footers read at 3:1 or better against the ground", { skip }, async () => {
  const a = await open();
  const r = await a.page.evaluate(() => {
    let low = 0, worst = 99; const st = App.state();
    for (let seed = 1; seed <= 1500; seed++) {
      const s = Looks.randomize(st, seed), bg = SP.hexToRgb(s.bg), c = SP.hexToRgb(s.footerColor === "accent" ? s.accent : s.ink), op = s.footerOpacity / 100;
      const k = SP.contrast(c.map((v, i) => v * op + bg[i] * (1 - op)), bg); if (k < 3) low++; worst = Math.min(worst, k);
    }
    return { low, worst };
  });
  assert.equal(r.low, 0, `worst footer ${r.worst.toFixed(2)}:1`);
  await a.close();
});

test("Discover fills the cards on screen soon after a fast scroll", { skip }, async () => {
  const a = await open();
  await a.page.waitForTimeout(1000);
  for (let i = 0; i < 12; i++) { await a.page.mouse.wheel(0, 3000); await a.page.waitForTimeout(60); }
  await a.page.waitForFunction(() => {
    const vis = [...document.querySelectorAll(".dc-grid > .dc-card")].filter(c => { const r = c.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; });
    return vis.length > 0 && vis.every(c => !c.classList.contains("loading"));
  }, null, { timeout: 6000 });
  assert.deepEqual(a.errors, []);
  await a.close();
});
