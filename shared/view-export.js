/* Sleeve Press: Export view. Every digital file for release day, grouped by where it goes,
   each with a real preview, one line on where it's used, its own download, and a tick for the zip. */
(function () {
"use strict";
const SR = SleeveRender, TR = TracklistRender, h = App.h;

/* File names keep to plain letters, so "Björk" becomes "Bjork" rather than "Bj_rk". */
const LETTERS = { "ß": "ss", "æ": "ae", "Æ": "AE", "œ": "oe", "Œ": "OE", "ø": "o", "Ø": "O", "ł": "l", "Ł": "L", "đ": "d", "Đ": "D", "þ": "th", "Þ": "TH" };
const plain = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[ßæÆœŒøØłŁđĐþÞ]/g, (c) => LETTERS[c]);
const cat = () => SP.safeName(plain(SP.get().release.catalog)) || "release";
const st = () => { const s = { ...App.state() }; for (const k of ["catalog", "artist", "title"]) s[k] = plain(s[k]); return s; };
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
/* Everything a distributor's upload form asks for, in one place to copy from. */
function infoText() {
  const d = SP.get(), r = d.release, t = d.tracks, title = SP.titleLine(r), rt = SP.runtime(t), owner = (r.label || r.artist || "").trim();
  const rows = [
    ["Artist", r.artist], ["Title", title], ["Format", r.format], ["Record label", r.label], ["Catalogue no.", r.catalog],
    ["Release date", r.date], ["Year", r.year],
    ["℗ line", r.year && owner ? `℗ ${r.year} ${owner}` : ""], ["© line", r.year && owner ? `© ${r.year} ${owner}` : ""],
    ["Tracks", t.length ? `${t.length}${rt ? ` · ${SP.fmtTime(rt)} total` : ""}` : ""],
  ].filter(([, v]) => v && String(v).trim());
  const w = Math.max(...rows.map(([k]) => k.length)) + 2;
  const out = [[r.artist, title].filter(Boolean).join(" — ") || "Release info", "", ...rows.map(([k, v]) => `${(k + ":").padEnd(w)}${String(v).trim()}`)];
  if (t.length) {
    out.push("", "TRACKS");
    t.forEach((x, i) => {
      const bits = [x.feat ? `feat. ${x.feat}` : "", x.length, x.bpm ? `${x.bpm} BPM` : "", x.key].filter(Boolean);
      out.push(`${String(i + 1).padStart(2, "0")}  ${x.title}${bits.length ? "  ·  " + bits.join("  ·  ") : ""}`);
    });
    if (t.some(x => x.feat)) out.push("", "Distributors usually want featured artists in their own field, not in the track title.");
  }
  return out.join("\n") + "\n";
}

/* ---------- store check: words on the cover that streaming stores turn down ---------- */
const MONTH = "jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?";
const STORE_RULES = [
  // artist and title are only checked for addresses and handles: a song can be called "Tidal" or "Friday 13"
  { what: "a web address", all: true, re: /\bhttps?:\/\/\S+|\bwww\.\S+|\b[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)*\.(com|net|org|io|co|fm|me|app|link|ly|to|ee|music|xyz|info|tv|uk)\b(\/\S*)?/i },
  { what: "a social handle", all: true, re: /(^|[\s(·|,])@[\w.]{2,}/ },
  { what: "promo words", re: /\b(out (now|today|soon|this|next)|new (single|album|ep|lp|music|release|record)|available (now|everywhere)|pre-?(save|order)|stream (it )?(now|everywhere)|listen now|coming soon|link in bio|in stores)\b/i },
  { what: "a release date", re: new RegExp(`\\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(day)?\\b\\.?,?\\s*\\d|\\b\\d{1,2}(st|nd|rd|th)?\\s+(${MONTH})\\b|\\b(${MONTH})\\.?\\s+\\d{1,2}(st|nd|rd|th)?\\b|\\b\\d{1,2}[./]\\d{1,2}[./]\\d{2,4}\\b`, "i") },
  { what: "a price", re: /[$€£¥]\s?\d|\b\d+([.,]\d\d)?\s?(usd|eur|gbp)\b|\bfree download\b/i },
  { what: "a store name", re: /\b(spotify|apple music|itunes|amazon music|deezer|tidal|youtube|soundcloud|bandcamp|beatport|pandora|napster|audiomack)\b/i },
];
/* The words that actually print on the front cover, by where they sit. */
function coverWords(d) {
  const r = d.release, s = SR.flatten(d), out = [];
  const add = (name, text, strict) => { const t = String(text || "").replace(/\s*\n\s*/g, " ").trim(); if (t) out.push({ name, text: t, strict }); };
  add("Artist", r.artist, false);
  add("Title", r.title, false);
  add("Footer", r.footer, true);
  if (["text", "box", "stamp"].includes(s.labelMark)) add("Label mark", r.label, true);
  if (s.plate) add("Plate", (s.plateText || "").trim() || r.catalog, true);
  return out;
}
/* [{ name, what, match }] for every cover word a store would likely reject. */
function storeIssues(d) {
  const out = [];
  for (const w of coverWords(d)) for (const rule of STORE_RULES) {
    if (!w.strict && !rule.all) continue;
    const m = rule.re.exec(w.text);
    if (m) out.push({ name: w.name, what: rule.what, match: m[0].replace(/^[\s(·|,]+/, "").trim() });
  }
  return out;
}
const SIZE_CAP = 10 * 1024 * 1024;   // a common distributor upload limit for artwork

/* ---------- the outputs ---------- */
async function env(preview) {
  return Makers.env(SP.get(), preview ? await App.smallImage() : await SP.cover.image(), await SP.logo.image());
}
const png = async (c) => SP.canvasBlob(c);
/* The 3000 px cover is drawn once per zip and shared by the PNG and the JPEG. */
let shared = null, pngBytes = null;
async function bigCover() {
  if (shared && shared.cover) return shared.cover;
  const c = await Makers.cover(await env(), 3000);
  if (shared) shared.cover = c;
  return c;
}
const sq = (n) => `${n} × ${n} px PNG`;
const backDims = (n) => { const [w, hh] = TR.dims(TR.settings(SP.get()).layout, n); return `${w} × ${hh} px PNG`; };

const OUTS = [
  { id: "cover3000", group: "stream", label: "Cover, 3000 px", use: "The main artwork for your distributor (DistroKid, TuneCore, CD Baby…).", dims: () => sq(3000),
    preview: async (e, c) => Makers.cover(e, 520), files: async () => { const ver = picVer, sig = sigs().img, b = await png(await bigCover()); pngBytes = { size: b.size, sig, ver }; return [[SR.filename(st(), 3000), b]]; } },
  { id: "cover3000jpg", group: "stream", label: "Cover, 3000 px JPEG", use: "The same cover as a much smaller file, for distributors that cap upload size.", dims: () => "3000 × 3000 px JPEG",
    preview: async (e) => Makers.cover(e, 520), files: async () => [[SR.filename(st(), 3000).replace(/\.png$/, ".jpg"), await SP.canvasBlob(await bigCover(), "image/jpeg", 0.92)]] },
  { id: "cover1400", group: "stream", label: "Cover, 1400 px", use: "For distributors, stores or podcast hosts that cap artwork size.", dims: () => sq(1400),
    preview: async (e) => Makers.cover(e, 520), files: async () => [[SR.filename(st(), 1400), await png(await Makers.cover(await env(), 1400))]] },
  { id: "back3000", group: "stream", label: "Back cover", use: "Extra image on Bandcamp, or the back of a physical release.", dims: () => backDims(3000),
    preview: async (e) => Makers.back(e, 520), files: async () => [[SR.filename(st(), 3000, "back"), await png(await Makers.back(await env(), 3000))]] },

  ...Makers.PROMO.map(p => ({
    id: "promo-" + p.id, group: "promo", label: p.label, use: p.use, dims: () => `${p.w} × ${p.h} px PNG`, ratio: p.w / p.h,
    preview: async (e) => Makers.promo(e, p.id, 560 / Math.max(p.w, p.h)),
    files: async () => [[SR.filename(st(), `${p.w}x${p.h}`, p.id), await png(await Makers.promo(await env(), p.id))]],
  })),

  { id: "info", group: "text", label: "Release info (.txt)", use: "Artist, title, label, ℗ line and every track in one place, to copy into your distributor's upload form.", dims: () => "Plain text",
    text: infoText, name: () => `${cat()}_release_info.txt` },
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
/* Folders inside the zip, one per group, so release day starts with "upload what's in Streaming". */
const FOLDERS = { stream: "Streaming", promo: "Promo", text: "Text", extras: "Extras" };

/* Why an output can't be made right now (or ""). */
function missing(o) {
  const d = SP.get();
  if (o.needs === "tracks" && !d.tracks.length) return "Needs a tracklist: add one under Print → Tracklist, or More → Suno style.";
  if (o.needs === "style" && !(d.style && d.style.prompt)) return "No Suno prompt yet: make one under More → Suno style.";
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
function setPicked(set) { SP.patch("promo", { picked: OUTS.map(o => o.id).filter(id => set.has(id)) }, { undo: false }); }

/* ---------- view ---------- */
let root = null, visible = false, cards = new Map(), zipBtn = null, countOut = null, checksEl = null, storeEl = null, fields = {};
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
    h("div", {}, h("h1", {}, "Covers, promo images & text"), h("p", {}, "Every file for release day. Download one at a time, or tick what you need and get one zip.")),
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
    if (g.id === "stream") sec.append(storeEl = h("div", { class: "ex-store", id: "ex-store", "aria-live": "polite" }));
    if (g.id === "promo") sec.append(copyFields());
    sec.append(grid);
    OUTS.filter(o => o.group === g.id).forEach(o => grid.append(card(o)));
    el.append(sec);
  }
  const io = App.lazy((node) => { const id = node.dataset.id; seen.add(id); render(id); }, "300px");
  for (const { o, el: c } of cards.values()) if (o.preview) io.watch(c);

  SP.on(() => { if (visible) refresh(); });
  SP.cover.on(() => { imgSig = ""; picVer++; if (visible) refresh(); });
  SP.logo.on(() => { imgSig = ""; picVer++; if (visible) refresh(); });
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
  const notes = storeNotes(d);
  add(!notes.length, notes.length ? `Store check: ${notes.length} to fix` : "Store check", notes.length ? "See Store check under Streaming." : "Nothing on the cover that stores usually turn down.");
  drawStore(notes);
  checksEl.replaceChildren(...out.map(([ok, t, tip]) => h("li", { class: ok ? "ok" : "warn", title: tip || "" }, h("b", { "aria-hidden": "true" }, ok ? "✓" : "!"), t)));
}
let hasPic = false, pic = null, picVer = 0;
async function checkPic() {
  const im = await SP.cover.image(), m = SP.cover.meta();
  hasPic = !!im; pic = im ? { w: im.naturalWidth, h: im.naturalHeight, ow: (m && m.w) || im.naturalWidth, oh: (m && m.h) || im.naturalHeight } : null;
  if (root) preflight();
}
SP.cover.on(checkPic);

/* Everything the store check says: cover words, a picture too small for 3000 px, a PNG over the usual size cap. */
function storeNotes(d) {
  const by = new Map();
  for (const i of storeIssues(d)) { const e = by.get(i.name) || { name: i.name, whats: [] }; if (!e.whats.includes(i.what)) e.whats.push(i.what); by.set(i.name, e); }
  const words = coverWords(d), list = (a) => a.length > 1 ? a.slice(0, -1).join(", ") + " and " + a[a.length - 1] : a[0];
  const out = [...by.values()].map(e => ({ kind: "words", name: e.name, text: ` has ${list(e.whats)}: “${words.find(w => w.name === e.name).text}”.` }));
  const s = SR.flatten(d);
  if (pic && !(s.imgBlur > 0)) {
    const b = SR.imageBox(s, 3000), k = Math.max(b.w / pic.w, b.h / pic.h) * (s.zoom || 100) / 100;
    if (k > 2) out.push({ kind: "picture", name: "Picture", text: ` is ${pic.ow} × ${pic.oh} px, stretched ${k.toFixed(1)}× on the 3000 px cover, so it will look soft. Stores can turn down blurry artwork: use a bigger picture if you have one.` });
  }
  if (pngBytes && pngBytes.ver === picVer && pngBytes.sig === sigs().img && pngBytes.size > SIZE_CAP)
    out.push({ kind: "size", name: "Cover PNG", text: ` came out at ${mb(pngBytes.size)}. Some distributors cap artwork at 10 MB: if the upload is refused, use the JPEG.` });
  return out;
}
const mb = (n) => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
function drawStore(notes) {
  if (!storeEl) return;
  const head = h("h3", {}, h("b", { "aria-hidden": "true" }, notes.length ? "!" : "✓"), "Store check");
  if (!notes.length) {
    storeEl.className = "ex-store ok";
    storeEl.replaceChildren(head, h("p", {}, "Nothing on the cover that stores usually turn down."));
    return;
  }
  storeEl.className = "ex-store warn";
  const words = notes.some(n => n.kind === "words");
  storeEl.replaceChildren(head,
    h("ul", {}, ...notes.map(n => h("li", { "data-kind": n.kind }, h("b", {}, n.name), n.text))),
    words ? h("p", { class: "hint" }, "Spotify, Apple Music and most stores turn down covers with web addresses, social handles, release dates, prices, promo words like “out now” or other store names. Keep those for the promo images.") : null,
    notes.some(n => n.kind !== "size") ? h("button", { type: "button", class: "btn small", onclick: () => App.go("design") }, "Edit the cover") : null);
}

/* ---------- downloads ---------- */
async function downloadOne(o, btn) {
  const was = btn.textContent; btn.disabled = true; btn.textContent = "Building…";
  try {
    for (const [name, blob] of await filesOf(o)) SP.download(blob, name);
    if (o.id === "cover3000") { preflight(); if (pngBytes.size > SIZE_CAP) SP.toast(`That PNG is ${mb(pngBytes.size)}. If your distributor refuses it, use the JPEG.`); }
  }
  catch (e) { console.error(e); SP.toast("Couldn't build that file."); }
  btn.disabled = false; btn.textContent = was;
}
/* What's in the zip and where to use it, in plain words: the first file anyone opens. */
const FOLDER_NOTES = {
  stream: "For your distributor. Upload the 3000 px cover; if it's refused for file size, the JPEG is the same picture, smaller.",
  promo: "For socials, YouTube and your header images. Post the teaser before release day and the release post on the day.",
  text: "Copy and paste into upload forms, store pages and video descriptions.",
  extras: "Less common pieces.",
};
function readme(made, d) {
  const r = d.release, name = [r.artist, SP.titleLine(r)].filter(Boolean).join(" — ") || "Release";
  const day = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const out = [name + (r.format ? ` (${r.format})` : ""), [r.catalog, r.label, `made with Sleeve Press, ${day}`].filter(x => x && String(x).trim()).join(" · "), ""];
  for (const g of GROUPS) {
    const rows = made.filter(m => m.group === g.id); if (!rows.length) continue;
    const big = rows.filter(m => /^Cover, 3000 px/.test(m.output)).length;
    const note = g.id !== "stream" ? FOLDER_NOTES[g.id] : big === 2 ? FOLDER_NOTES.stream : big ? "For your distributor: upload the 3000 px cover." : "For your distributor and store pages.";
    out.push(`${FOLDERS[g.id]}/`, `  ${note}`, "");
    for (const m of rows) out.push(`  ${m.name.slice(m.name.lastIndexOf("/") + 1)}  (${mb(m.bytes)})`, `    ${m.use}`);
    out.push("");
  }
  const notes = storeNotes(d);
  if (notes.length) out.push("Before you upload", ...notes.map(n => `  ! ${n.name}${n.text}`), "");
  out.push("Print pieces (CD inserts, disc and vinyl labels, stickers) are under Get files → Print in Sleeve Press.",
    "manifest.json lists every file, for scripts.");
  return out.join("\n") + "\n";
}
/* Builds the release kit: one top folder, a folder per group, README.txt and manifest.json. */
async function makeZip(sel, step = () => {}) {
  const top = `${cat()}_release-kit/`, files = [], made = [];
  shared = {};
  try {
    for (let i = 0; i < sel.length; i++) {
      const o = sel[i];
      await step(i, sel.length);
      for (const [name, blob] of await filesOf(o)) {
        const path = `${top}${FOLDERS[o.group]}/${name}`;
        files.push({ name: path, data: new Uint8Array(await blob.arrayBuffer()) });
        made.push({ name: path.slice(top.length), group: o.group, output: o.label, use: o.use, bytes: blob.size });
      }
    }
  } finally { shared = null; }
  const d = SP.get(), pal = d.palette;
  files.unshift({ name: top + "README.txt", data: enc(readme(made, d)) });
  files.push({ name: top + "manifest.json", data: enc(JSON.stringify({
    schema: "sleevepress.kit/3", generated: new Date().toISOString(),
    release: d.release, palette: { bg: pal.bg, ink: pal.ink, accent: pal.accent, name: pal.name }, tracks: d.tracks.length,
    files: made.map(({ group, ...m }) => m),
  }, null, 2)) });
  return { blob: PDF.zip(files), made, name: `${cat()}_release-kit.zip` };
}
async function buildZip() {
  const p = picked(), sel = OUTS.filter(o => p.has(o.id) && !missing(o));
  if (!sel.length) return SP.toast("Tick at least one file.");
  zipBtn.dataset.busy = "1"; zipBtn.disabled = true;
  try {
    const z = await makeZip(sel, async (i, n) => { zipBtn.textContent = `Building ${i + 1} / ${n}…`; await new Promise(r => setTimeout(r, 16)); });
    zipBtn.textContent = "Zipping…"; await new Promise(r => setTimeout(r, 16));
    SP.download(z.blob, z.name);
    preflight();
    const big = pngBytes && pngBytes.size > SIZE_CAP && z.made.some(m => m.output === "Cover, 3000 px");
    SP.toast(`Zip ready: ${z.made.length} file${z.made.length === 1 ? "" : "s"} + README` + (big ? `. The cover PNG is ${mb(pngBytes.size)}: use the JPEG if your distributor refuses it.` : ""));
  } catch (e) { console.error(e); SP.toast("Couldn't build the zip."); }
  delete zipBtn.dataset.busy; zipBtn.textContent = "Download selected (.zip)"; syncPicks();
}

/* for tests */
window.ExportKit = {
  OUTS, storeIssues: () => storeIssues(SP.get()), storeNotes: () => storeNotes(SP.get()), infoText, youtubeText,
  zip: (ids) => makeZip(OUTS.filter(o => ids.includes(o.id) && !missing(o))),
};

App.view("export", {
  label: "Export",
  mount,
  show() { visible = true; imgSig = ""; textSig = ""; checkPic(); refresh(); },
  hide() { visible = false; },
});
})();
