"use strict";
/* Keyboard use and screen-reader basics: menus, dialogs, the Design tabs and cover, names on controls, text contrast. */
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const { open, closeBrowser, skip } = require("./app");

after(closeBrowser);

/* A short description of whatever has focus, for comparisons. */
const focused = (page) => page.evaluate(() => {
  const e = document.activeElement;
  return { tag: e.tagName, id: e.id, role: e.getAttribute("role"), text: e.textContent.trim(), inMenu: !!e.closest(".menu"), inDialog: !!e.closest(".dlg") };
});
const go = async (page, v) => { await page.evaluate((v) => { location.hash = "#" + v; }, v); await page.waitForTimeout(400); };

test("the first Tab offers Skip to content, and each section names the page", { skip }, async () => {
  const a = await open(), p = a.page;
  await p.evaluate(() => document.activeElement.blur());
  await p.keyboard.press("Tab");
  assert.equal((await focused(p)).text, "Skip to content");
  assert.ok(await p.evaluate(() => document.activeElement.getBoundingClientRect().top >= 0), "and it is on screen while focused");
  await p.keyboard.press("Enter");
  assert.equal(await p.evaluate(() => document.activeElement.classList.contains("view-discover")), true, "it lands on the section");
  assert.equal(await p.title(), "Discover · Sleeve Press");
  await go(p, "design");
  assert.equal(await p.title(), "Design · Sleeve Press");
  await a.close();
});

test("top-bar menus work from the keyboard: arrows, letters, Esc and Tab", { skip }, async () => {
  const a = await open(), p = a.page;
  const more = p.locator("[data-go=more]");
  await more.focus();
  await p.keyboard.press("ArrowDown");
  let f = await focused(p);
  assert.ok(f.inMenu && f.role === "menuitem", "↓ opens the menu on its first item");
  assert.equal(await more.getAttribute("aria-expanded"), "true");
  const items = await p.locator(".menu [role=menuitem]").allTextContents();
  assert.ok(items.length >= 2);
  assert.equal(f.text, items[0]);
  await p.keyboard.press("ArrowDown"); assert.equal((await focused(p)).text, items[1]);
  await p.keyboard.press("ArrowDown"); assert.equal((await focused(p)).text, items[(2) % items.length], "wraps round");
  await p.keyboard.press("End"); assert.equal((await focused(p)).text, items[items.length - 1]);
  await p.keyboard.press("Home"); assert.equal((await focused(p)).text, items[0]);
  // menu items are reached with the arrows, not Tab
  assert.deepEqual(await p.locator(".menu [role=menuitem]").evaluateAll(l => l.map(b => b.tabIndex)), items.map(() => -1));

  await p.keyboard.press("Escape");
  assert.equal(await p.locator(".menu").count(), 0, "Esc closes it");
  f = await focused(p); assert.equal(f.text.replace(/\W/g, ""), "More", "and focus goes back to the button");
  assert.equal(await more.getAttribute("aria-expanded"), "false");

  await p.keyboard.press("ArrowUp");
  assert.equal((await focused(p)).text, items[items.length - 1], "↑ opens it on the last item");
  await p.keyboard.press("Tab");
  assert.equal(await p.locator(".menu").count(), 0, "Tab closes it");
  f = await focused(p);
  assert.equal(f.inMenu, false); assert.equal(f.id, "relchip", "and moves on from the button, not to the end of the page");

  // a letter jumps to the item starting with it; Enter runs it
  await p.locator("#gearBtn").focus(); await p.keyboard.press("Enter");
  await p.keyboard.press("r");
  assert.match((await focused(p)).text, /^Restore/);
  await p.keyboard.press("Escape");
  await more.focus(); await p.keyboard.press("Enter");
  await p.keyboard.press("Enter");
  await p.waitForTimeout(200);
  assert.equal(await p.evaluate(() => App.current()), "titles", "Enter on Titles opens it");
  assert.deepEqual(a.errors, []);
  await a.close();
});

test("dialogs keep focus inside, close on Esc and give focus back", { skip }, async () => {
  const a = await open(), p = a.page;
  await p.locator("#newBtn").focus(); await p.keyboard.press("Enter");
  await p.waitForSelector(".dlg");
  assert.equal((await focused(p)).inDialog, true, "focus starts in the dialog");
  assert.equal(await p.locator(".dlg").getAttribute("aria-labelledby").then(id => p.locator("#" + id).textContent()), "New release", "named by its heading");
  assert.deepEqual(await p.evaluate(() => [document.getElementById("bar").inert, document.getElementById("views").inert]), [true, true], "the page behind is inert");
  await p.keyboard.press("Shift+Tab");
  assert.equal((await focused(p)).text, "Start", "Shift+Tab from the first field wraps to the last button");
  for (let i = 0; i < 12; i++) { await p.keyboard.press("Tab"); assert.equal((await focused(p)).inDialog, true, `Tab ${i + 1} stays in the dialog`); }
  await p.keyboard.press("Escape");
  assert.equal(await p.locator(".dlg").count(), 0);
  assert.equal((await focused(p)).id, "newBtn", "focus goes back to New");
  assert.deepEqual(await p.evaluate(() => [document.getElementById("bar").inert, document.getElementById("views").inert]), [false, false]);

  // one dialog on top of another: Esc closes only the top one
  await p.evaluate(() => { App.modal({ title: "One", body: App.h("p", {}, "first"), actions: [{ label: "OK" }] }); App.modal({ title: "Two", body: App.h("p", {}, "second"), actions: [{ label: "OK" }] }); });
  await p.keyboard.press("Escape");
  assert.deepEqual(await p.locator(".dlg h2").allTextContents(), ["One"]);
  assert.equal(await p.evaluate(() => document.querySelector(".dlg-wrap").inert), false, "the one underneath works again");
  await p.keyboard.press("Escape");
  assert.equal(await p.locator(".dlg").count(), 0);
  assert.deepEqual(a.errors, []);
  await a.close();
});

test("picture drop zones can be reached with Tab", { skip }, async () => {
  const a = await open({ welcome: true }), p = a.page;
  await p.waitForSelector(".dlg .file-drop");
  let reached = false;
  for (let i = 0; i < 20 && !reached; i++) { await p.keyboard.press("Tab"); reached = await p.evaluate(() => document.activeElement.type === "file" && !!document.activeElement.closest(".file-drop")); }
  assert.ok(reached, "the picture field in the start dialog is in the Tab order");
  assert.equal(await p.evaluate(() => getComputedStyle(document.activeElement.closest(".file-drop")).outlineStyle), "solid", "and its zone shows the focus ring");
  await a.close();
});

test("Design style tabs: arrow keys, Home and End, one tab stop", { skip }, async () => {
  const a = await open(), p = a.page;
  await go(p, "design");
  const tabs = p.locator(".dz-tabs [role=tab]");
  const n = await tabs.count();
  assert.ok(n >= 5);
  await p.locator(".dz-tabs [aria-selected=true]").focus();
  const start = await p.locator(".dz-tabs [aria-selected=true]").getAttribute("data-tab");
  await p.keyboard.press("ArrowRight");
  const next = await focused(p);
  assert.equal(next.role, "tab"); assert.notEqual(next.id, "dz-tab-" + start);
  assert.equal(await p.locator(".dz-tabs [aria-selected=true]").getAttribute("id"), next.id, "→ opens the tab it moves to");
  assert.equal(await p.locator(".dz-panel").getAttribute("aria-labelledby"), next.id, "the panel is labelled by the open tab");
  await p.keyboard.press("End"); assert.equal((await focused(p)).id, await tabs.last().getAttribute("id"));
  await p.keyboard.press("ArrowRight"); assert.equal((await focused(p)).id, await tabs.first().getAttribute("id"), "wraps round");
  await p.keyboard.press("ArrowLeft"); assert.equal((await focused(p)).id, await tabs.last().getAttribute("id"));
  await p.keyboard.press("Home"); assert.equal((await focused(p)).id, "dz-tab-title");
  assert.deepEqual(await tabs.evaluateAll(l => l.map(b => b.tabIndex).filter(t => t === 0).length), 1, "only the open tab is a Tab stop");
  assert.deepEqual(await tabs.evaluateAll(l => [...new Set(l.map(b => b.getAttribute("aria-controls")))]), ["dz-panel"]);
  assert.deepEqual(a.errors, []);
  await a.close();
});

test("Design cover: described in words, parts picked and moved from the keyboard", { skip }, async () => {
  const a = await open(), p = a.page;
  await go(p, "design");
  await p.evaluate(() => SP.patch("release", { title: "LOW\nTIDE", artist: "HARBOUR" }));
  await p.waitForTimeout(400);
  const desc = await p.evaluate(() => { const c = document.querySelector(".dz-sleeve canvas"); return { role: c.getAttribute("role"), text: document.getElementById(c.getAttribute("aria-labelledby")).textContent }; });
  assert.equal(desc.role, "img");
  assert.match(desc.text, /“LOW TIDE” by HARBOUR/, "the cover's label says what's on it");

  await p.locator(".dz-tabs [data-tab=colour]").click();
  const overlay = p.locator(".dz-overlay");
  await overlay.focus();
  const selected = () => p.locator(".dz-tabs [aria-selected=true]").getAttribute("data-tab");
  await p.keyboard.press("]"); assert.equal(await selected(), "title", "] picks the first part");
  assert.equal(await overlay.getAttribute("aria-label"), "Cover editor: Title selected");
  await p.keyboard.press("]"); assert.equal(await selected(), "artist");
  await p.keyboard.press("["); assert.equal(await selected(), "title");
  await p.keyboard.press("["); assert.notEqual(await selected(), "title", "[ wraps round to the last part");
  assert.equal((await focused(p)).id, "", "focus stays on the cover");
  assert.equal(await p.evaluate(() => document.activeElement.classList.contains("dz-overlay")), true);

  await p.keyboard.press("]"); assert.equal(await selected(), "title");
  const y0 = await p.evaluate(() => App.state().titleDy);
  await p.keyboard.press("ArrowDown"); await p.keyboard.press("Shift+ArrowDown");
  assert.equal(await p.evaluate(() => App.state().titleDy), y0 + 2.5, "arrows nudge it (Shift for bigger steps)");

  await p.keyboard.press("Enter");
  assert.equal(await p.evaluate(() => document.activeElement.classList.contains("dz-inline")), true, "Enter retypes the words in place");
  await p.keyboard.press("Escape");
  assert.equal(await p.evaluate(() => document.activeElement.classList.contains("dz-overlay")), true, "Esc goes back to the cover");
  assert.deepEqual(a.errors, []);
  await a.close();
});

test("Design variations: the ♥ is its own button", { skip }, async () => {
  const a = await open(), p = a.page;
  await go(p, "design");
  await p.locator(".dz-varbtn").click();
  await p.waitForSelector(".dz-varflag");
  const nested = await p.evaluate(() => document.querySelectorAll(".dz-vargrid button button, .dz-vargrid button [role=button]").length);
  assert.equal(nested, 0, "no buttons inside buttons");
  const heart = p.locator(".dz-varflag").first();
  assert.equal(await heart.evaluate(b => b.tagName), "BUTTON");
  assert.match(await heart.getAttribute("aria-label"), /Flag variation 1/);
  const before = await p.evaluate(() => App.flagged().length);
  await heart.focus(); await p.keyboard.press("Space");
  assert.equal(await heart.getAttribute("aria-pressed"), "true");
  assert.equal(await p.evaluate(() => App.flagged().length), before + 1, "Space flags it");
  await p.getByRole("button", { name: "Close" }).click();
  assert.equal(await p.evaluate(() => document.activeElement.classList.contains("dz-varbtn")), true, "closing the strip goes back to Variations");
  assert.deepEqual(a.errors, []);
  await a.close();
});

test("every control in the bar and in each Design tab has a name", { skip }, async () => {
  const a = await open(), p = a.page;
  await go(p, "design");
  const unnamed = () => p.evaluate(() => {
    const text = (id) => { const n = document.getElementById(id); return n ? n.textContent : ""; };
    const nameOf = (el) => (el.getAttribute("aria-label") || (el.getAttribute("aria-labelledby") || "").split(/\s+/).map(text).join(" ")
      || (el.labels && [...el.labels].map(l => l.textContent).join(" ")) || (el.tagName === "BUTTON" || el.tagName === "A" ? el.textContent : "") || el.title || "").trim();
    const els = [...document.querySelectorAll("#bar button, #bar a, .view-design button, .view-design input, .view-design select, .view-design textarea, .view-design [tabindex]")]
      .filter(el => el.getClientRects().length && !el.closest("[hidden]"));
    return els.filter(el => !nameOf(el)).map(el => el.outerHTML.slice(0, 120));
  });
  assert.deepEqual(await unnamed(), [], "Design, first tab");
  for (const t of ["artist", "footer", "colour", "picture", "label", "marks", "surface", "layout"]) {
    await p.locator(`.dz-tabs [data-tab=${t}]`).click(); await p.waitForTimeout(150);
    assert.deepEqual(await unnamed(), [], `Design, ${t} tab`);
  }
  // sliders are named by their label alone, with the shown number as their value
  await p.locator(".dz-tabs [data-tab=title]").click();
  const size = p.locator(".dz-panel input[type=range]").first();
  assert.equal(await size.getAttribute("aria-label"), "Size");
  assert.match(await size.getAttribute("aria-valuetext"), /%$/);
  await a.close();
});

test("hints, field labels and the More tab are readable on the dark theme", { skip }, async () => {
  const a = await open(), p = a.page;
  await go(p, "design");
  const ratios = await p.evaluate(() => {
    const rgba = (s) => { const m = s.match(/[\d.]+/g).map(Number); return [m[0], m[1], m[2], m.length > 3 ? m[3] : 1]; };
    const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    // the colour behind an element: its backgrounds and its parents', blended from the page up
    const behind = (el) => {
      const layers = []; for (let n = el; n; n = n.parentElement) { const c = rgba(getComputedStyle(n).backgroundColor); if (c[3] > 0) { layers.push(c); if (c[3] >= 1) break; } }
      let out = rgba(getComputedStyle(document.body).backgroundColor);
      for (const c of layers.reverse()) out = [0, 1, 2].map(i => c[i] * c[3] + out[i] * (1 - c[3])).concat(1);
      return out;
    };
    const ratio = (el) => { const fg = lum(rgba(getComputedStyle(el).color)), bg = lum(behind(el)); return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05); };
    const pick = { hint: ".dz-foot .hint", more: "[data-go=more]", label: ".dz-words label.f > span", legend: ".dz-panel .legend", output: ".dz-panel label.f > span output", file: ".dz-file", status: "#status", sub: "#relchip span" };
    return Object.fromEntries(Object.entries(pick).map(([k, s]) => { const el = document.querySelector(s); return [k, el ? +ratio(el).toFixed(2) : null]; }));
  });
  for (const [k, r] of Object.entries(ratios)) { assert.notEqual(r, null, `${k} found`); assert.ok(r >= 4.5, `${k}: ${r}:1 should be at least 4.5:1`); }
  await a.close();
});
