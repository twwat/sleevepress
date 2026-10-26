/* Sleeve Press: Export view. Every digital file for release day, grouped by where it goes,
   each with a real preview, one line on where it's used, its own download, and a tick for the zip. */
(function () {
"use strict";
const SR = SleeveRender, TR = TracklistRender, h = App.h;

const cat = () => SP.safeName(SP.get().release.catalog || "release");
const st = () => App.state();
const enc = (t) => new TextEncoder().encode(t);
const textBlob = (t, mime = "text/plain") => new Blob([t], { type: mime + ";charset=utf-8" });

/* ---------- text outputs ---------- */
function styleText() {
  const s = SP.get().style || {}, r = SP.get().release;
  if (!s.prompt) return "";
  const out = [`STYLE\n${s.prompt}`, `EXCLUDE\n${s.exclude || "—"}`];
  if (s.structure) out.push(`STRUCTURE\n${s.structure}`);
  if ((s.batch || []).length) out.push("PER TRACK\n" + s.batch.map(b => `${String(b.n).padStart(2, "0")} ${b.title}\n${b.prompt}`).join("\n\n"));
  return `${SP.titleLine(r)} — ${r.artist}\n\n` + out.join("\n\n") + "\n";
}
function cssText() {
  const p = SP.get().palette;
  return `:root {\n  --ground: ${p.bg};\n  --ink: ${p.ink};\n  --spot: ${p.accent};\n}\n/* ${p.words || p.name || ""} */\n`;
}
function youtubeText() {
  const d = SP.get(), r = d.release;
  const head = [r.artist, SP.titleLine(r)].filter(Boolean).join(" — ") + (r.format ? ` (${r.format})` : "");
  const top = [head, r.date ? `Out ${r.date}` : "", r.links ? `Listen: ${r.links}` : ""].filter(Boolean);
  const ch = Makers.chaptersText(d).split("\n").slice(2);   // drop its own heading, keep "Tracklist" + rows
  const foot = [r.year ? `℗ ${r.year} ${r.label || r.artist}` : r.label, r.catalog].filter(x => x && String(x).trim()).join(" · ");
  return [...top, ...(ch.length ? ["", ...ch] : []), ...(foot ? ["", foot] : [])].join("\n") + "\n";
}
const timed = () => { const t = SP.get().tracks; return t.length > 0 && t.every(x => SP.secs(x.length)); };

/* ---------- the outputs ---------- */
async function env(preview) {
  return Makers.env(SP.get(), preview ? await App.smallImage() : await SP.cover.image(), await SP.logo.image());
}
const png = async (c) => SP.canvasBlob(c);
const sq = (n) => `${n} × ${n} px PNG`;
const backDims = (n) => { const [w, hh] = TR.dims(TR.settings(SP.get()).layout, n); return `${w} × ${hh} px PNG`; };

const OUTS = [
  { id: "cover3000", group: "stream", label: "Cover, 3000 px", use: "The main artwork for your distributor (DistroKid, TuneCore, CD Baby…).", dims: () => sq(3000),
    preview: async (e, c) => Makers.cover(e, 520), files: async () => [[SR.filename(st(), 3000), await png(await Makers.cover(await env(), 3000))]] },
  { id: "cover1400", group: "stream", label: "Cover, 1400 px", use: "For distributors, stores or podcast hosts that cap artwork size.", dims: () => sq(1400),
    preview: async (e) => Makers.cover(e, 520), files: async () => [[SR.filename(st(), 1400), await png(await Makers.cover(await env(), 1400))]] },
  { id: "back3000", group: "stream", label: "Back cover", use: "Extra image on Bandcamp, or the back of a physical release.", dims: () => backDims(3000),
    preview: async (e) => Makers.back(e, 520), files: async () => [[SR.filename(st(), 3000, "back"), await png(await Makers.back(await env(), 3000))]] },

  ...Makers.PROMO.map(p => ({
    id: "promo-" + p.id, group: "promo", label: p.label, use: p.use, dims: () => `${p.w} × ${p.h} px PNG`, ratio: p.w / p.h,
    preview: async (e) => Makers.promo(e, p.id, 560 / Math.max(p.w, p.h)),
    files: async () => [[SR.filename(st(), `${p.w}x${p.h}`, p.id), await png(await Makers.promo(await env(), p.id))]],
  })),

  { id: "tracklist-txt", group: "text", label: "Tracklist (.txt)", use: "Paste into Bandcamp, SoundCloud or a press email.", dims: () => "Plain text",
    text: () => TR.toText(SP.get(), "plain"), name: () => `${cat()}_tracklist.txt`, needs: "tracks" },
  { id: "tracklist-md", group: "text", label: "Tracklist (.md)", use: "A table for a README, Notion page or blog post.", dims: () => "Markdown",
    text: () => TR.toText(SP.get(), "md"), name: () => `${cat()}_tracklist.md`, mime: "text/markdown", needs: "tracks" },
  { id: "tracklist-csv", group: "text", label: "Tracklist (.csv)", use: "Opens in a spreadsheet; handy for distributor metadata forms.", dims: () => "CSV",
    text: () => TR.toText(SP.get(), "csv"), name: () => `${cat()}_tracklist.csv`, mime: "text/csv", needs: "tracks" },
  { id: "youtube", group: "text", label: "YouTube description", use: "Paste under the full-release video; the timestamps become chapters.", dims: () => timed() ? "Text, with chapter timestamps" : "Text (add track lengths for timestamps)",
    text: youtubeText, name: () => `${cat()}_youtube_description.txt` },
  { id: "suno", group: "text", label: "Suno prompts", use: "Your style, exclude and per-track prompts, ready to paste into Suno.", dims: () => "Plain text",
    text: styleText, name: () => `${cat()}_suno_prompts.txt`, needs: "style" },
  { id: "palette", group: "text", label: "Palette (.css)", use: "The sleeve colours as CSS variables, for a website or link page.", dims: () => "CSS",
    text: cssText, name: () => `${cat()}_palette.css`, mime: "text/css" },
  { id: "json", group: "text", label: "release.json", use: "The whole release with its picture: open it here again any time.", dims: () => "JSON, picture included",
    text: () => JSON.stringify({ ...SP.clone(SP.get()), schema: SP.SCHEMA }, null, 2), name: () => `${cat()}_release.json`, mime: "application/json",
    files: async () => [[`${cat()}_release.json`, textBlob(JSON.stringify(await SP.exportObject(true), null, 2), "application/json")]] },

  { id: "vinyl", group: "extras", label: "Vinyl centre labels", use: "Transparent PNGs, one per side, for mock-ups or the pressing plant.", dims: () => `${Makers.vinylSides(SP.get()).length} × 1500 px PNG, transparent`,
    preview: async (e) => Makers.vinylPng(e, Makers.vinylSides(SP.get())[0], 520), checker: true,
    files: async () => { const e = await env(), out = []; for (const s of Makers.vinylSides(SP.get())) out.push([SR.filename(st(), 1500, "label" + s), await png(await Makers.vinylPng(e, s, 1500))]); return out; } },
];
const GROUPS = [
  { id: "stream", title: "Streaming", sub: "What your distributor asks for." },
  { id: "promo", title: "Promo", sub: "Six different layouts for socials, YouTube and headers. The words below go on them." },
  { id: "text", title: "Text", sub: "Copy-and-paste text for store pages, video descriptions and your site." },
  { id: "extras", title: "Artwork extras", sub: "Less common pieces." },
];
const DEFAULT_OFF = new Set(["vinyl", "tracklist-md", "tracklist-csv"]);

/* Why an output can't be made right now (or ""). */
function missing(o) {
  const d = SP.get();
  if (o.needs === "tracks" && !d.tracks.length) return "Add tracks in Words first.";
  if (o.needs === "style" && !(d.style && d.style.prompt)) return "No style prompt yet: build one in Forge.";
  return "";
}
async function filesOf(o) {
  if (o.files) return o.files();
  return [[o.name(), textBlob(o.text(), o.mime)]];
}

/* ---------- selection ---------- */
function picked() {
  const p = SP.get().promo && SP.get().promo.picked;
  return new Set(Array.isArray(p) ? p : OUTS.filter(o => !DEFAULT_OFF.has(o.id)).map(o => o.id));
}
function setPicked(set) { SP.patch("promo", { picked: OUTS.map(o => o.id).filter(id => set.has(id)) }); }

/* ---------- view ---------- */
let root = null, visible = false, cards = new Map(), zipBtn = null, countOut = null, checksEl = null, fields = {};
const q = App.queue(), pending = new Set(), seen = new Set();
let imgSig = "", textSig = "";

function card(o) {
  const pv = h("div", { class: "ex-pv" + (o.checker ? " checker" : "") + (o.text && !o.preview ? " text" : "") });
  if (o.text && !o.preview) pv.append(h("pre", { class: "ex-txt" }));
  else { const cv = document.createElement("canvas"); cv.width = 8; cv.height = 8; cv.setAttribute("role", "img"); cv.setAttribute("aria-label", `Preview: ${o.label}`); pv.append(cv); pv.classList.add("loading"); }
  const cb = h("input", { type: "checkbox", id: "ex-pick-" + o.id });
  cb.addEventListener("change", () => { const s = picked(); cb.checked ? s.add(o.id) : s.delete(o.id); setPicked(s); });
  const dl = h("button", { type: "button", class: "btn small", onclick: () => downloadOne(o, dl) }, "Download");
  const actions = h("div", { class: "ex-act" },
    h("label", { class: "ex-pick", for: "ex-pick-" + o.id, title: "Include in the zip" }, cb, h("span", {}, "In zip")),
    o.text ? h("button", { type: "button", class: "btn small", onclick: () => { const t = o.text(); if (t) SP.copy(t, o.label); } }, "Copy") : null,
    dl);
  const el = h("article", { class: "ex-card", id: "ex-card-" + o.id, "data-id": o.id },
    pv,
    h("div", { class: "ex-meta" },
      h("h3", {}, o.label),
      h("p", { class: "ex-use" }, o.use),
      h("p", { class: "ex-dims" }, ""),
      h("p", { class: "ex-miss" }, "")),
    actions);
  cards.set(o.id, { o, el, pv, cb, dl });
  return el;
}

function mount(el) {
  root = el;
  zipBtn = h("button", { type: "button", class: "btn primary", id: "ex-zip", onclick: buildZip }, "Download selected (.zip)");
  countOut = h("span", { class: "ex-count", id: "ex-count" });
  const head = h("div", { class: "view-head" },
    h("div", {}, h("h1", {}, "Export"), h("p", {}, "Every file for release day. Download one at a time, or tick what you need and get one zip.")),
    h("div", { class: "ex-zipbar" },
      h("button", { type: "button", class: "btn small", id: "ex-all", onclick: () => { setPicked(new Set(OUTS.filter(o => !missing(o)).map(o => o.id))); } }, "All"),
      h("button", { type: "button", class: "btn small", id: "ex-none", onclick: () => setPicked(new Set()) }, "None"),
      countOut, zipBtn));
  checksEl = h("ul", { class: "ex-checks", id: "ex-checks", "aria-label": "Preflight" });
  el.append(head, checksEl);

  for (const g of GROUPS) {
    const grid = h("div", { class: "ex-grid ex-grid-" + g.id });
    const sec = h("section", { class: "ex-group", id: "ex-g-" + g.id, "aria-labelledby": "ex-h-" + g.id },
      h("div", { class: "ex-ghead" }, h("h2", { id: "ex-h-" + g.id }, g.title), h("p", {}, g.sub)));
    if (g.id === "promo") sec.append(copyFields());
    sec.append(grid);
    OUTS.filter(o => o.group === g.id).forEach(o => grid.append(card(o)));
    el.append(sec);
  }
  const io = App.lazy((node) => { const id = node.dataset.id; seen.add(id); render(id); }, "300px");
  for (const { o, el: c } of cards.values()) if (o.preview) io.watch(c);

  SP.on(() => { if (visible) refresh(); });
  SP.cover.on(() => { imgSig = ""; if (visible) refresh(); });
  SP.logo.on(() => { imgSig = ""; if (visible) refresh(); });
}

function copyFields() {
  const r = SP.get().release;
  const push = SP.debounce(() => {
    SP.patch("release", { date: fields.date.value, cta: fields.cta.value, links: fields.links.value });
  }, 300);
  const inp = (key, label, ph, hint) => {
    const i = h("input", { type: "text", id: "ex-" + key, placeholder: ph, autocomplete: "off", spellcheck: "false" });
    i.value = r[key] || ""; i.addEventListener("input", push); fields[key] = i;
    return h("label", { class: "f", for: "ex-" + key }, h("span", {}, label, hint ? h("output", {}, hint) : null), i);
  };
  const seg = h("div", { class: "seg", id: "ex-format", role: "group", "aria-label": "Format" },
    ...["Single", "EP", "LP", "Mixtape"].map(v => h("button", { type: "button", "data-v": v }, v)));
  fields.formatRefresh = SP.bindSeg(seg, () => SP.get().release.format, (v) => SP.patch("release", { format: v }));
  return h("div", { class: "ex-copy panel", id: "ex-copy" },
    inp("date", "Release date", "FRI 14 NOV", "any text"),
    inp("cta", "Call to action", "OUT NOW"),
    inp("links", "Where to listen", "Spotify · Apple Music · Bandcamp"),
    h("div", { class: "f" }, h("span", { class: "legend" }, "Format"), seg));
}

/* ---------- refreshing ---------- */
function sigs() {
  const d = SP.get();
  return {
    img: JSON.stringify([d.release, d.palette, d.tracks, d.sleeve, d.typeset]),
    text: JSON.stringify([d.release, d.palette, d.tracks, d.style, d.typeset]),
  };
}
const refresh = SP.debounce(() => {
  const s = sigs();
  syncFields(); syncPicks(); preflight();
  if (s.text !== textSig) { textSig = s.text; renderTexts(); }
  if (s.img !== imgSig) { imgSig = s.img; for (const id of seen) render(id); }
}, 200);

function syncFields() {
  const r = SP.get().release;
  for (const k of ["date", "cta", "links"]) if (fields[k] && document.activeElement !== fields[k] && fields[k].value !== (r[k] || "")) fields[k].value = r[k] || "";
  fields.formatRefresh && fields.formatRefresh();
}
function syncPicks() {
  const p = picked(); let n = 0;
  for (const { o, el, cb, dl } of cards.values()) {
    const miss = missing(o);
    cb.checked = p.has(o.id) && !miss; cb.disabled = !!miss; dl.disabled = !!miss;
    el.classList.toggle("off", !!miss);
    el.querySelector(".ex-miss").textContent = miss;
    el.querySelector(".ex-dims").textContent = o.dims();
    if (cb.checked) n++;
  }
  countOut.textContent = n ? `${n} selected` : "Nothing selected";
  if (!zipBtn.dataset.busy) zipBtn.disabled = !n;
}
function renderTexts() {
  for (const { o, pv } of cards.values()) {
    if (!o.text || o.preview) continue;
    const t = missing(o) ? "" : o.text(), pre = pv.querySelector("pre");
    pre.textContent = t ? t.split("\n").slice(0, 14).join("\n") : "—";
  }
}
/* Queue one preview; repeated requests while it waits fold into one. */
function render(id) {
  if (pending.has(id)) return; pending.add(id);
  q(async () => {
    pending.delete(id);
    if (!visible) { imgSig = ""; return; }
    const { o, pv } = cards.get(id); if (!o.preview) return;
    const src = await o.preview(await env(true));
    const cv = pv.querySelector("canvas");
    cv.width = src.width; cv.height = src.height; cv.getContext("2d").drawImage(src, 0, 0);
    pv.classList.remove("loading");
  });
}

/* ---------- preflight ---------- */
function preflight() {
  const d = SP.get(), r = d.release, p = d.palette, out = [];
  const add = (ok, txt, tip) => out.push([ok, txt, tip]);
  add(!!r.artist.trim(), r.artist.trim() ? "Artist" : "No artist");
  add(!!SP.titleLine(r), SP.titleLine(r) ? "Title" : "No title");
  add(!!(r.catalog || "").trim(), (r.catalog || "").trim() ? `Cat. ${r.catalog}` : "No catalogue no.", "Files are named after the catalogue number.");
  const ink = SP.hexToRgb(p.ink), bg = SP.hexToRgb(p.bg), cr = ink && bg ? SP.contrast(ink, bg) : 0;
  add(cr >= 4.5, `Contrast ${cr.toFixed(1)}:1`, cr >= 4.5 ? "Ink on ground reads well." : "Ink on ground is low: small text may be hard to read.");
  add(hasPic, hasPic ? "Picture" : "No picture", hasPic ? "" : "Sleeves will be type only.");
  add(d.tracks.length > 0, d.tracks.length ? `${d.tracks.length} tracks` : "No tracks", d.tracks.length ? "" : "Back cover, story and video still need a tracklist.");
  if (d.tracks.length && !timed()) add(false, "Lengths missing", "Add a length to every track for YouTube timestamps.");
  checksEl.replaceChildren(...out.map(([ok, t, tip]) => h("li", { class: ok ? "ok" : "warn", title: tip || "" }, h("b", { "aria-hidden": "true" }, ok ? "✓" : "!"), t)));
}
let hasPic = false;
async function checkPic() { hasPic = !!(await SP.cover.image()); if (root) preflight(); }
SP.cover.on(checkPic);

/* ---------- downloads ---------- */
async function downloadOne(o, btn) {
  const was = btn.textContent; btn.disabled = true; btn.textContent = "Building…";
  try { for (const [name, blob] of await filesOf(o)) SP.download(blob, name); }
  catch (e) { console.error(e); SP.toast("Couldn't build that file."); }
  btn.disabled = false; btn.textContent = was;
}
async function buildZip() {
  const p = picked(), sel = OUTS.filter(o => p.has(o.id) && !missing(o));
  if (!sel.length) return SP.toast("Tick at least one file.");
  zipBtn.dataset.busy = "1"; zipBtn.disabled = true;
  const files = [], made = [];
  try {
    for (let i = 0; i < sel.length; i++) {
      const o = sel[i];
      zipBtn.textContent = `Building ${i + 1} / ${sel.length}…`;
      await new Promise(r => setTimeout(r, 16));
      for (const [name, blob] of await filesOf(o)) {
        files.push({ name, data: new Uint8Array(await blob.arrayBuffer()) });
        made.push({ name, output: o.label, use: o.use, bytes: blob.size });
      }
    }
    const d = SP.get(), pal = d.palette;
    files.push({ name: "manifest.json", data: enc(JSON.stringify({
      schema: "sleevepress.kit/2", generated: new Date().toISOString(),
      release: d.release, palette: { bg: pal.bg, ink: pal.ink, accent: pal.accent, name: pal.name }, tracks: d.tracks.length, files: made,
    }, null, 2)) });
    zipBtn.textContent = "Zipping…"; await new Promise(r => setTimeout(r, 16));
    SP.download(PDF.zip(files), `${cat()}_release-kit.zip`);
    SP.toast(`Zip ready: ${made.length} file${made.length === 1 ? "" : "s"} + manifest`);
  } catch (e) { console.error(e); SP.toast("Couldn't build the zip."); }
  delete zipBtn.dataset.busy; zipBtn.textContent = "Download selected (.zip)"; syncPicks();
}

App.view("export", {
  label: "Export",
  mount,
  show() { visible = true; imgSig = ""; textSig = ""; checkPic(); refresh(); },
  hide() { visible = false; },
});
})();
