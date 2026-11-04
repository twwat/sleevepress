/* Opens the app in headless Chromium for a test. Google Fonts requests are answered locally (an empty stylesheet by
   default) so the tests run offline and don't depend on network timing. Each `open()` is a fresh browser profile. */
"use strict";
const path = require("node:path");
const { pathToFileURL } = require("node:url");

let playwright = null;
try { playwright = require("playwright"); } catch (e) { /* reported by `skip` below */ }
const skip = playwright ? false : "playwright isn't installed (npm install)";
const URL_ = pathToFileURL(path.join(__dirname, "..", "..", "index.html")).href;

let browser = null;
async function getBrowser() {
  if (!browser) browser = await playwright.chromium.launch();
  return browser;
}
async function closeBrowser() { if (browser) { await browser.close(); browser = null; } }

/* opts.fontsCSS(route) / opts.fontFile(route): answer the Google Fonts requests yourself. opts.init (with opts.initArg): a
   function run in the page before any of the app's scripts. opts.welcome: leave the first-run dialog open. */
async function open(opts = {}) {
  const ctx = await (await getBrowser()).newContext({ viewport: opts.viewport || { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  if (opts.init) await page.addInitScript(opts.init, opts.initArg);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(/fonts\.googleapis\.com/, (r) => (opts.fontsCSS ? opts.fontsCSS(r) : r.fulfill({ contentType: "text/css", body: "" })));
  await page.route(/fonts\.gstatic\.com/, (r) => (opts.fontFile ? opts.fontFile(r) : r.abort()));
  await page.goto(URL_);
  await page.waitForFunction(() => window.App && window.SP);
  if (!opts.welcome) {
    const example = page.getByText("Just show me an example");
    if (await example.isVisible().catch(() => false)) await example.click();
  }
  return { page, ctx, errors, close: () => ctx.close() };
}

module.exports = { open, closeBrowser, skip };
