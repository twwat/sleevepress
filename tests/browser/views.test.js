"use strict";
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const { open, closeBrowser, skip } = require("./app");

after(closeBrowser);
const VIEWS = ["discover", "design", "print", "export", "library", "titles", "forge"];

test("every section opens without a script error", { skip }, async () => {
  const a = await open();
  for (const v of VIEWS) {
    await a.page.evaluate((v) => { location.hash = "#" + v; }, v);
    await a.page.waitForTimeout(600);
    assert.deepEqual(a.errors, [], `#${v}`);
  }
  await a.close();
});

test("first visit shows the start form; its example button closes it", { skip }, async () => {
  const a = await open({ welcome: true });
  const example = a.page.getByText("Just show me an example");
  assert.ok(await example.isVisible());
  await example.click();
  assert.equal(await example.isVisible(), false);
  await a.close();
});

test("phone width: no section scrolls sideways", { skip }, async () => {
  const a = await open({ viewport: { width: 390, height: 844 } });
  for (const v of VIEWS) {
    await a.page.evaluate((v) => { location.hash = "#" + v; }, v);
    await a.page.waitForTimeout(500);
    const w = await a.page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(w <= 391, `#${v} is ${w} px wide`);
  }
  await a.close();
});
