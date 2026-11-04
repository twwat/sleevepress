"use strict";
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const { open, closeBrowser, skip } = require("./app");

after(closeBrowser);

const BANDED = ["flow", "opmelt", "bloom"];

test("banded patterns: repeatable, seeded, two inks on a clear ground with smooth edges", { skip }, async () => {
  const a = await open();
  const r = await a.page.evaluate((ids) => {
    const fg = [250, 182, 79], fg2 = [44, 60, 156], bg = [219, 113, 193], S = 400;
    const px = (id, o) => {
      const c = document.createElement("canvas"); c.width = c.height = S;
      Patterns.clearCache(); Patterns.draw(c.getContext("2d"), S, S, id, { fg, fg2, bg, S, scale: 100, ...o });
      return c.getContext("2d").getImageData(0, 0, S, S).data;
    };
    const differing = (p, q) => { let n = 0; for (let i = 0; i < p.length; i++) if (p[i] !== q[i]) n++; return n; };
    return ids.map(id => {
      const one = px(id, { seed: 3 }), again = px(id, { seed: 3 }), other = px(id, { seed: 4 });
      let clear = 0, solidFg = 0, solidFg2 = 0, soft = 0;
      for (let i = 0; i < one.length; i += 4) {
        const al = one[i + 3];
        if (al === 0) clear++;
        else if (al === 255 && one[i] === fg[0] && one[i + 1] === fg[1] && one[i + 2] === fg[2]) solidFg++;
        else if (al === 255 && one[i] === fg2[0] && one[i + 1] === fg2[1] && one[i + 2] === fg2[2]) solidFg2++;
        else soft++;
      }
      // in duo, flow and bloom deal a two-ink sett for most seeds (op melt is one ink by design)
      let duoSeeds = 0;
      for (let seed = 1; seed <= 6; seed++) { const q = px(id, { seed }); for (let i = 0; i < q.length; i += 4) if (q[i + 3] === 255 && q[i] === fg2[0] && q[i + 1] === fg2[1] && q[i + 2] === fg2[2]) { duoSeeds++; break; } }
      return { id, repeat: differing(one, again), seeded: differing(one, other), clear, solidFg, solidFg2, soft, duoSeeds, total: S * S };
    });
  }, BANDED);
  for (const x of r) {
    assert.equal(x.repeat, 0, `${x.id}: same seed, same pixels`);
    assert.ok(x.seeded > x.total, `${x.id}: another seed gives another design`);
    assert.ok(x.clear > x.total * 0.15, `${x.id}: the ground shows through`);
    assert.ok(x.solidFg > x.total * 0.05, `${x.id}: first ink used`);
    if (x.id !== "opmelt") assert.ok(x.duoSeeds >= 3, `${x.id}: second ink in duo (${x.duoSeeds} of 6 seeds)`);
    // edges are blended, but only at edges: a few percent of pixels, not a blur
    assert.ok(x.soft > x.total * 0.005 && x.soft < x.total * 0.25, `${x.id}: anti-aliased edges (${x.soft} soft of ${x.total})`);
  }
  assert.deepEqual(a.errors, []);
  await a.close();
});

test("banded patterns build in small steps and match a build in one go, rotated too", { skip }, async () => {
  const a = await open();
  const r = await a.page.evaluate((ids) => {
    const S = 1600, out = [];
    const mk = () => { const c = document.createElement("canvas"); c.width = c.height = S; return c; };
    const same = (a, b) => { const p = a.getContext("2d").getImageData(0, 0, S, S).data, q = b.getContext("2d").getImageData(0, 0, S, S).data; let n = 0; for (let i = 0; i < p.length; i++) if (p[i] !== q[i]) n++; return n; };
    for (const id of ids) for (const angle of [0, 30]) {
      const o = { fg: [236, 220, 190], fg2: [200, 60, 40], bg: [43, 34, 51], S, scale: 85, seed: 7, angle };
      Patterns.clearCache(); const one = mk(); Patterns.draw(one.getContext("2d"), S, S, id, o);
      Patterns.clearCache(); let n = 0; for (const _ of Patterns.steps(S, S, id, o)) n++;
      const layers = Patterns.cached().layers, st = mk(); Patterns.draw(st.getContext("2d"), S, S, id, o);
      out.push({ id, angle, n, layers, differing: same(one, st) });
    }
    return out;
  }, BANDED);
  for (const x of r) {
    assert.ok(x.n > 8, `${x.id} at ${x.angle}°: built in ${x.n} steps`);
    assert.ok(x.layers > 0, `${x.id} at ${x.angle}°: the stepped build left its layer ready`);
    assert.equal(x.differing, 0, `${x.id} at ${x.angle}°: stepped and one-go builds match`);
  }
  await a.close();
});

test("the randomizer deals banded patterns into real sleeves", { skip }, async () => {
  const a = await open();
  const r = await a.page.evaluate(async (ids) => {
    const keep = Patterns.LIST; Patterns.LIST = keep.filter(p => ids.includes(p.id));
    const seen = new Set(), base = App.state();
    for (let seed = 1; seed < 120 && seen.size < ids.length; seed++) {
      const s = Looks.randomize(base, seed, {}, { deal: { i: seed, base: 1 } });
      if (s.pattern === "none") continue;
      const c = document.createElement("canvas"); c.width = c.height = 240;
      await SleeveRender.render(c, s, null, null);
      seen.add(s.pattern);
    }
    Patterns.LIST = keep;
    return [...seen].sort();
  }, BANDED);
  assert.deepEqual(r, [...BANDED].sort());
  assert.deepEqual(a.errors, []);
  await a.close();
});
