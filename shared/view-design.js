/* Sleeve Press: Design. The sleeve on the left; click anything on it to edit that thing.
   Drag to move, double-click words to retype them in place, Ctrl/⌘+scroll on the picture to zoom.
   The inspector on the right shows one subject at a time and only the controls that do something right now. */
(function () {
"use strict";
const SR = SleeveRender, L = Looks, h = App.h;
const PREVIEW = 1200;

/* ---------- subjects: what can be selected, and the tab that edits it ---------- */
const TABS = [
  ["title", "Title"], ["artist", "Artist"], ["footer", "Footer"], ["colour", "Colour"], ["picture", "Picture"],
  ["label", "Label"], ["marks", "Marks"], ["surface", "Surface"], ["layout", "Layout"],
];
const HIT_TAB = { title: "title", artist: "artist", footer: "footer", motif: "marks", label: "label", barcode: "label", image: "picture" };

let el, st, boxes = {}, tab = "title", visible = false, writing = false, stale = true;
let image = null, logo = null, canvas, overlay, hoverBox, selBox, editor, panel, tabsEl;
const prefs = (() => { try { return JSON.parse(localStorage.getItem("sleevepress.design") || "{}"); } catch (e) { return {}; } })();
const savePrefs = () => { try { localStorage.setItem("sleevepress.design", JSON.stringify(prefs)); } catch (e) {} };

/* ---------- writing ---------- */
function set(k, v, opts) { st[k] = v; write(opts); }
function setMany(o, opts) { Object.assign(st, o); write(opts); }
function write(opts = {}) {
  writing = true; App.commit(st, opts); writing = false;
  st = App.state(); draw(); refreshVisibility(); if (opts.rebuild) buildPanel();
}

/* ---------- rendering ---------- */
let drawGen = 0;
const draw = SP.rafOnce(async () => {
  if (!visible) { stale = true; return; }
  const gen = ++drawGen, snap = { ...st }, c = document.createElement("canvas"); c.width = c.height = PREVIEW;
  const b = await SR.render(c, snap, image, logo);
  if (gen !== drawGen) return;   // a newer render has started; this one is out of date
  canvas.getContext("2d").drawImage(c, 0, 0);
  boxes = b || {}; positionSel();
  el.querySelector(".dz-file").textContent = SR.filename(st, st.exportSize || "3000");
});

/* ---------- control kit ---------- */
const ctl = [];   // { el, show, update }
function field(label, input, opts = {}) {
  const wrap = h("label", { class: "f" + (opts.half ? " half" : "") }, h("span", {}, label, opts.out || ""), input);
  return wrap;
}
function reg(node, show, update) { ctl.push({ el: node, show, update }); if (update) update(); return node; }
function range(k, label, min, max, step = 1, opts = {}) {
  const out = h("output"), inp = h("input", { type: "range", min, max, step });
  const fmt = opts.fmt || ((v) => `${v}${opts.unit || ""}`);
  inp.addEventListener("input", () => { out.textContent = fmt(+inp.value); set(k, +inp.value); });
  inp.addEventListener("dblclick", () => { if (opts.reset != null) { inp.value = opts.reset; out.textContent = fmt(opts.reset); set(k, opts.reset); } });
  return reg(field(label, inp, { out, half: opts.half }), opts.show, () => { inp.value = st[k]; out.textContent = fmt(st[k]); });
}
function seg(k, label, opts, o = {}) {
  const box = h("div", { class: "seg", role: "group", "aria-label": label });
  opts.forEach(([v, t, title]) => box.append(h("button", { type: "button", "data-v": String(v), title: title || null, onclick: () => set(k, typeof st[k] === "number" ? +v : typeof st[k] === "boolean" ? v === "true" : v, { rebuild: o.rebuild }) }, t)));
  const node = label ? h("div", { class: "f" + (o.half ? " half" : "") }, h("span", { class: "legend" }, label), box) : box;
  return reg(node, o.show, () => box.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === String(st[k])))));
}
function check(k, label, o = {}) {
  const inp = h("input", { type: "checkbox", onchange: () => set(k, inp.checked, { rebuild: o.rebuild }) });
  return reg(h("label", { class: "check" }, inp, label), o.show, () => { inp.checked = !!st[k]; });
}
function text(k, label, o = {}) {
  const inp = o.area ? h("textarea", { rows: o.rows || 2, class: o.cls || null }) : h("input", { type: "text", placeholder: o.ph || "" });
  inp.addEventListener("input", () => set(k, inp.value));
  return reg(field(label, inp, { half: o.half }), o.show, () => { if (document.activeElement !== inp) inp.value = st[k] ?? ""; });
}
/* Visual picker: each option draws its own little picture. */
function pick(k, label, values, drawFn, o = {}) {
  const grid = h("div", { class: "dz-pick" + (o.wide ? " wide" : "") });
  values.forEach(([v, name]) => {
    const c = h("canvas", { width: 96, height: o.wide ? 64 : 96 });
    const b = h("button", { type: "button", "data-v": String(v), title: name, onclick: () => set(k, v, { rebuild: o.rebuild }) }, c, h("small", {}, name));
    grid.append(b);
    b._draw = () => { const x = c.getContext("2d"); x.clearRect(0, 0, c.width, c.height); drawFn(x, v, c.width, c.height); };
  });
  const node = h("div", { class: "f" }, label ? h("span", { class: "legend" }, label) : null, grid);
  // the little pictures only depend on the colours and a few settings: repaint when those change, not on every slider tick
  const sig = () => [st.bg, st.ink, st.accent, st.font, st.titleCase, st.patternSeed, st.label, st.logoMode, st.bodyFont, st.pattern, st.patternArea, logo ? 1 : 0].join("|");
  let drawn = null;
  return reg(node, o.show, () => {
    const now = sig(), paint = now !== drawn; drawn = now;
    grid.querySelectorAll("button").forEach(b => { b.setAttribute("aria-pressed", String(b.dataset.v === String(st[k]))); if (paint) b._draw(); });
  });
}
function fontPick(k, label, o = {}) {
  const list = h("div", { class: "dz-fonts", role: "listbox", "aria-label": label });
  const opts = [...(o.empty ? [["", o.empty]] : []), ...L.FONTS.map(f => [f.n, f.n])];
  opts.forEach(([v, name]) => list.append(h("button", { type: "button", "data-v": v, role: "option", style: v ? { fontFamily: `"${v}", sans-serif`, fontWeight: SR.weightFor(v, 700) } : null, onclick: () => set(k, v) }, name)));
  const node = h("div", { class: "f" }, h("span", { class: "legend" }, label), list);
  return reg(node, o.show, () => list.querySelectorAll("button").forEach(b => { const on = b.dataset.v === String(st[k]); b.setAttribute("aria-selected", String(on)); b.setAttribute("aria-pressed", String(on)); }));
}
const colourSeg = (k, label, o = {}) => seg(k, label, [["ink", h("span", { class: "dz-dot", "data-role": "ink" }, "Ink")], ["accent", h("span", { class: "dz-dot", "data-role": "accent" }, "Spot")]], o);
const alignSeg = (k, o = {}) => seg(k, "Alignment", [["", "Auto", "Follow the sleeve's alignment (Layout)"], ["left", "Left"], ["centre", "Centre"], ["right", "Right"]], o);
const btn = (label, fn, cls = "btn small") => h("button", { type: "button", class: cls, onclick: fn }, label);
const row = (...kids) => h("div", { class: "dz-row" }, ...kids);
const hint = (t) => h("p", { class: "hint" }, t);
const group = (title, ...kids) => h("div", { class: "dz-group" }, title ? h("h3", {}, title) : null, ...kids);

/* ---------- mini drawings for pickers ---------- */
const cols = () => ({ bg: SP.hexToRgb(st.bg), ink: SP.hexToRgb(st.ink), spot: SP.hexToRgb(st.accent) });
function miniGround(x, w, hh) { const { bg } = cols(); x.fillStyle = SP.rgba(bg, 1); x.fillRect(0, 0, w, hh); }
function drawImgMode(x, v, w, hh) {
  miniGround(x, w, hh); const { ink, spot } = cols(), b = SR.imageBox({ ...st, imgMode: v, imgBoxSize: 100, imgBoxX: 0, imgBoxY: 0 }, w);
  const g = x.createLinearGradient(0, b.y, 0, b.y + b.h); g.addColorStop(0, SP.rgba(ink, 0.75)); g.addColorStop(1, SP.rgba(spot, 0.6));
  x.save(); x.beginPath(); SR.boxPath(b)(x); x.clip(); x.fillStyle = g; x.fillRect(0, 0, w, hh); x.restore();
}
function drawFrameMini(x, v, w, hh) { miniGround(x, w, hh); const { ink, spot } = cols(); SR.drawFrame(x, w, hh, { ...st, frame: true, frameStyle: v, frameOpacity: 90, frameWidth: 260, frameInset: 10 }, ink, spot); }
function drawMotifMini(x, v, w, hh) {
  miniGround(x, w, hh); if (v === "none") return; const { ink, spot } = cols();
  const s = { ...st, motifKind: v, count: 5, missing: 3, motifSize: 150, motifPitch: 150 }, S = w * 1.6;
  x.save(); x.translate(w / 2 - 0.0232 * S * 1.5 * 2 - 0.0105 * S * 0.75, hh / 2 - 0.05 * S * 0.75); SR.drawMotif ? SR.drawMotif(x, S, s, 0, 0, ink, spot, "x") : null; x.restore();
}
function drawTitleStyle(x, v, w, hh) {
  miniGround(x, w, hh);
  const fake = { ...st, title: "Aa", titleStyle: v, titleSize: 100, titleDy: 0, titlePos: "centre", titleX: 0, titleAlign: "centre", artist: "", footer: "", year: "",
    motifKind: "none", frame: false, barcode: false, plate: false, labelMark: "none", wash: "none", shape: "none", texture: "none", grain: 0, vignette: 0, margin: 12, titleCase: "asis" };
  const c = document.createElement("canvas"); c.width = c.height = 240;
  // render synchronously isn't possible; draw a cached copy when it arrives
  SR.render(c, fake, null).then(() => { x.clearRect(0, 0, w, hh); x.drawImage(c, 0, -w * 0.2, w, w); });
}
function drawWash(x, v, w, hh) { miniGround(x, w, hh); const { ink, spot } = cols(); SR.drawBackdrop(x, w, hh, { ...st, pattern: "none", shapeOutline: false, shapeRot: 0, wash: v, washAmt: 90, shape: "none", texture: "none" }, cols().bg, ink, spot); }
function drawPatternMini(x, v, w, hh) {
  miniGround(x, w, hh); if (v === "none" || !window.Patterns) return; const { bg, ink, spot } = cols();
  try { Patterns.draw(x, w, hh, v, { S: w, scale: 60, angle: 0, fg: ink, fg2: spot, bg, alpha: 0.8, seed: st.patternSeed || 1 }); } catch (e) {}
}
function drawShape(x, v, w, hh) { miniGround(x, w, hh); const { ink, spot } = cols(); SR.drawBackdrop(x, w, hh, { ...st, pattern: "none", wash: "none", shape: v, shapeAmt: 95, shapeSize: 60, shapeX: 50, shapeY: 50, texture: "none" }, cols().bg, ink, spot); }
function drawTexture(x, v, w, hh) { miniGround(x, w, hh); const { ink, spot } = cols(); SR.drawBackdrop(x, w, hh, { ...st, pattern: "none", shapeOutline: false, shapeRot: 0, wash: "none", shape: "none", texture: v, textureAmt: 100 }, cols().bg, ink, spot); x.scale(1, 1); }
function drawBarcodeMini(x, v, w, hh) {
  miniGround(x, w, hh); const { bg, ink, spot } = cols();
  x.save(); x.translate(0, 0); SR.drawBarcode(x, w * 3.2, w * 0.92, hh * 0.86, '"IBM Plex Mono", monospace', bg, ink, { ...st, barcodeStyle: v, barcodeSize: 100 }, spot); x.restore();
}
function drawMark(x, v, w, hh) {
  miniGround(x, w, hh); if (v === "none") return; const { ink } = cols();
  const S = v === "stamp" ? w * 9 : v === "logo" ? w * 4 : w * 5.5, name = (st.label || "LABEL").slice(0, 14);
  SR.drawLabelMark(x, S, { ...st, labelMark: v, label: name, labelSize: v === "stamp" ? 100 : 100, labelOpacity: 100, logoMode: st.logoMode }, w / 2, hh / 2, ink, st.bodyFont || st.font, logo);
}

/* ---------- colour from the picture (k-means in Lab, seeded) ---------- */
function extract(img, k = 6) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height, s = Math.min(1, 96 / Math.max(iw, ih));
  const w = Math.max(1, Math.round(iw * s)), hh = Math.max(1, Math.round(ih * s));
  const c = document.createElement("canvas"); c.width = w; c.height = hh;
  const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0, w, hh);
  const d = g.getImageData(0, 0, w, hh).data, pts = [];
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) { const rgb = [d[i], d[i + 1], d[i + 2]]; pts.push({ rgb, lab: SP.rgbToLab(rgb) }); }
  if (!pts.length) return [];
  const rnd = SP.mulberry32(20240607), centers = [pts[Math.floor(rnd() * pts.length)].lab.slice()];
  while (centers.length < Math.min(k, pts.length)) {
    const d2 = pts.map(p => Math.min(...centers.map(c0 => SP.labDist(p.lab, c0) ** 2))), sum = d2.reduce((a, b) => a + b, 0);
    if (!sum) break; let r = rnd() * sum, idx = 0; for (; idx < d2.length - 1; idx++) { r -= d2[idx]; if (r <= 0) break; }
    centers.push(pts[idx].lab.slice());
  }
  const assign = new Int16Array(pts.length);
  for (let it = 0; it < 12; it++) {
    const acc = centers.map(() => [0, 0, 0, 0]);
    pts.forEach((p, i) => { let b = 0, bd = 1e12; for (let j = 0; j < centers.length; j++) { const x = SP.labDist(p.lab, centers[j]); if (x < bd) { bd = x; b = j; } } assign[i] = b; const a = acc[b]; a[0] += p.lab[0]; a[1] += p.lab[1]; a[2] += p.lab[2]; a[3]++; });
    acc.forEach((a, j) => { if (a[3]) centers[j] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]; });
  }
  const sums = centers.map(() => [0, 0, 0, 0]);
  pts.forEach((p, i) => { const a = sums[assign[i]]; a[0] += p.rgb[0]; a[1] += p.rgb[1]; a[2] += p.rgb[2]; a[3]++; });
  return sums.filter(a => a[3]).map(a => { const rgb = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]; return { hex: SP.rgbToHex(rgb), rgb, share: a[3] / pts.length }; }).sort((x, y) => y.share - x.share);
}
/* Turns swatches into a few legible palettes: each swatch takes a turn as the ground, pushed dark or light. */
function suggestions(sw) {
  const out = [], seen = new Set();
  const pushL = (hsl, g, target, up) => { let [hh, s, l] = hsl; for (let i = 0; i < 80 && SP.contrast(SP.hslToRgb([hh, s, l]), g) < target; i++) l = up ? Math.min(1, l + 0.012) : Math.max(0, l - 0.012); return SP.rgbToHex(SP.hslToRgb([hh, s, l])); };
  const chroma = (x) => { const [, s, l] = SP.rgbToHsl(x.rgb); return s * (1 - Math.abs(2 * l - 1)); };
  for (const dark of [true, false]) for (const g of sw) {
    let [gh, gs, gl] = SP.rgbToHsl(g.rgb); gs = Math.min(gs, 0.55); gl = dark ? Math.min(gl, 0.11) : Math.max(gl, 0.87);
    const gRgb = SP.hslToRgb([gh, gs, gl]);
    const others = sw.filter(x => x !== g), spotSw = [...others].sort((a, b) => chroma(b) - chroma(a))[0] || g;
    const inkSw = [...others].sort((a, b) => (dark ? SP.relLum(b.rgb) - SP.relLum(a.rgb) : SP.relLum(a.rgb) - SP.relLum(b.rgb)))[0] || g;
    let ih = SP.rgbToHsl(inkSw.rgb); ih = [ih[0], Math.min(ih[1], 0.25), dark ? Math.max(ih[2], 0.8) : Math.min(ih[2], 0.12)];
    let sh = SP.rgbToHsl(spotSw.rgb); sh = [sh[0], Math.max(0.45, sh[1]), Math.min(0.65, Math.max(0.35, sh[2]))];
    const p = { bg: SP.rgbToHex(gRgb), ink: pushL(ih, gRgb, 7.1, dark), accent: pushL(sh, gRgb, 3.1, dark), name: "From picture" };
    const key = p.bg + p.accent; if (seen.has(key)) continue; seen.add(key); out.push(p);
  }
  return out.slice(0, 8);
}

/* ---------- panels ---------- */
function panelFor(t) {
  const P = [];
  const resetPos = (keys, label = "Reset position") => btn(label, () => setMany(keys));
  if (t === "title") {
    P.push(group(null,
      text("title", "Title (one line per row)", { area: true, rows: 2, cls: "up" }),
      row(seg("titleCase", "Case", [["upper", "AA"], ["title", "Aa"], ["lower", "aa"], ["asis", "As typed"]], { half: true }), colourSeg("titleColor", "Colour", { half: true })),
      pick("titleStyle", "Style", [["solid", "Solid"], ["outline", "Outline"], ["shadow", "Shadow"], ["echo", "Echo"], ["block", "Block"]], drawTitleStyle, { wide: true }),
      check("titleAccent", "Last line in the spot colour"),
    ));
    P.push(group("Type", fontPick("font", "Face"),
      row(range("titleSize", "Size", 40, 160, 1, { unit: "%", half: true, reset: 100 }), range("leading", "Line spacing", 70, 130, 0.5, { unit: "%", half: true, reset: 88.5 })),
      range("tracking", "Letter spacing", -8, 30, 1, { reset: -1 })));
    P.push(group("Position", alignSeg("titleAlign"),
      seg("titlePos", "Block", [["upper", "Upper"], ["centre", "Middle"], ["lower", "Lower"]]),
      row(range("titleDy", "Up / down", -30, 20, 0.5, { unit: "%", half: true, reset: 0 }), range("titleX", "Left / right", -30, 30, 0.5, { unit: "%", half: true, reset: 0 })),
      row(resetPos({ titleDy: 0, titleX: 0, titleAlign: "" })), hint("Or drag the title on the cover.")));
  }
  if (t === "artist") {
    P.push(group(null,
      row(text("artist", "Artist", { half: true }), text("year", "Year / edition", { half: true, ph: "2026" })),
      row(seg("artistCase", "Case", [["upper", "AA"], ["title", "Aa"], ["lower", "aa"], ["asis", "As typed"]], { half: true }), colourSeg("artistColor", "Colour", { half: true })),
      seg("artistWeight", "Weight", [[600, "Regular"], [700, "Bold"], [800, "Heavy"]])));
    P.push(group("Type", fontPick("artistFont", "Face", { empty: "Same as footer" }),
      row(range("artistSize", "Size", 50, 260, 5, { unit: "%", half: true, reset: 100 }), range("artistTrack", "Letter spacing", 0, 60, 1, { half: true, reset: 32 }))));
    P.push(group("Position",
      seg("artistRotate", "Direction", [["none", "Across"], ["left", "Up the left"], ["right", "Down the right"]]),
      alignSeg("artistAlign", { show: () => st.artistRotate === "none" }),
      row(range("artistY", "Height", 4, 96, 0.2, { unit: "%", half: true, reset: 15.8 }), range("artistX", "Left / right", -40, 40, 0.5, { unit: "%", half: true, reset: 0, show: () => st.artistRotate === "none" })),
      row(resetPos({ artistY: 15.8, artistX: 0, artistAlign: "", artistRotate: "none" })), hint("Or drag the artist name on the cover.")));
  }
  if (t === "footer") {
    P.push(group(null,
      text("footer", "Footer line", { ph: "KGN — N17 · DPWR-001" }),
      row(seg("footerCase", "Case", [["upper", "AA"], ["title", "Aa"], ["asis", "As typed"]], { half: true }), colourSeg("footerColor", "Colour", { half: true })),
      row(range("footerSize", "Size", 50, 200, 5, { unit: "%", half: true, reset: 100 }), range("footerOpacity", "Strength", 20, 100, 1, { unit: "%", half: true, reset: 58 })),
      range("footerTrack", "Letter spacing", 0, 50, 1, { reset: 25 })));
    P.push(group("Small-type face", fontPick("bodyFont", "Used for the footer, year, plate and barcode digits (and the artist unless it has its own)", { empty: "Same as title" })));
    P.push(group("Position", alignSeg("footerAlign"),
      row(range("footerY", "Height", 4, 97, 0.2, { unit: "%", half: true, reset: 92.2 }), range("footerX", "Left / right", -40, 40, 0.5, { unit: "%", half: true, reset: 0 })),
      row(btn("To bottom", () => setMany({ footerY: 92.2, footerPos: "bottom" })), btn("To top", () => setMany({ footerY: 7.5, footerPos: "top" })), resetPos({ footerX: 0, footerAlign: "" })),
      hint("The record label's name has its own mark now (Label tab), so this line can carry anything.")));
  }
  if (t === "colour") P.push(...colourPanel());
  if (t === "picture") P.push(...picturePanel());
  if (t === "label") P.push(...labelPanel());
  if (t === "marks") {
    const MOT = [["none", "None"], ...L.MOTIFS.map(m => [m, m[0].toUpperCase() + m.slice(1)]),
      ...((window.Glyphs && Glyphs.MARKS) || []).filter(m => !L.MOTIFS.includes(m.id)).map(m => [m.id, m.name])];
    P.push(group(null, pick("motifKind", "Marks", MOT, drawMotifMini, { rebuild: true })));
    if (st.motifKind !== "none") {
      P.push(group("Count",
        row(range("count", "How many", 1, 24, 1, { half: true, reset: 9 }), range("missing", "Odd one out", 0, 24, 1, { half: true, fmt: (v) => v ? `#${v}` : "none", reset: 0 })),
        seg("missingStyle", "Odd one is", [["outline", "Outline"], ["filled", "Spot colour"], ["gap", "Missing"]], { show: () => st.missing > 0 && st.missing <= st.count }),
        row(range("motifSize", "Size", 50, 200, 5, { unit: "%", half: true, reset: 100 }), range("motifPitch", "Spacing", 60, 250, 5, { unit: "%", half: true, reset: 100 }))));
      P.push(group("Position", alignSeg("motifAlign"),
        row(range("motifY", "Height", 4, 96, 0.2, { unit: "%", half: true, reset: 20.6 }), range("motifX", "Left / right", -40, 40, 0.5, { unit: "%", half: true, reset: 0 })),
        row(resetPos({ motifX: 0, motifAlign: "" }))));
    }
  }
  if (t === "surface") {
    P.push(group("Border", check("frame", "Show a border", { rebuild: true }),
      ...(st.frame ? [pick("frameStyle", null, L.FRAME_STYLES.map(f => [f, f[0].toUpperCase() + f.slice(1)]), drawFrameMini),
        row(range("frameInset", "Inset", 1, 12, 0.5, { unit: "%", half: true, reset: 4.5 }), range("frameWidth", "Weight", 50, 400, 10, { unit: "%", half: true, reset: 100 })),
        row(range("frameOpacity", "Strength", 5, 100, 1, { unit: "%", half: true, reset: 14 }), colourSeg("frameColor", "Colour", { half: true }))] : [])));
    P.push(group("Wash", pick("wash", null, [["none", "None"], ["top", "Top"], ["bottom", "Bottom"], ["radial", "Glow"], ["diagonal", "Diagonal"]], drawWash, { rebuild: true }),
      range("washAmt", "Strength", 0, 100, 1, { unit: "%", show: () => st.wash !== "none", reset: 45 })));
    const SHAPES = window.Glyphs && Glyphs.SHAPES ? Glyphs.SHAPES.map(g => [g.id, g.name]) : [["circle", "Circle"], ["ring", "Ring"], ["square", "Square"], ["half", "Half"], ["bars", "Bars"]];
    P.push(group("Big shape", h("div", { class: "dz-scroll" }, pick("shape", null, [["none", "None"], ...SHAPES], drawShape, { rebuild: true })),
      ...(st.shape !== "none" ? [row(range("shapeSize", "Size", 10, 140, 1, { unit: "%", half: true, reset: 55 }), range("shapeAmt", "Strength", 5, 100, 1, { unit: "%", half: true, reset: 85 })),
        row(range("shapeX", "Across", 0, 100, 1, { unit: "%", half: true, reset: 70 }), range("shapeY", "Down", 0, 100, 1, { unit: "%", half: true, reset: 38 })),
        row(colourSeg("shapeColor", "Colour", { half: true }), range("shapeRot", "Turn", -180, 180, 1, { unit: "°", half: true, reset: 0, show: () => !!window.Glyphs })),
        check("shapeOutline", "Line drawing instead of solid", { show: () => !!window.Glyphs })] : [])));
    if (window.Patterns) {
      const PATS = Patterns.LIST.map(p => [p.id, p.name]);
      P.push(group("Pattern", h("div", { class: "dz-scroll" }, pick("pattern", null, [["none", "None"], ...PATS], drawPatternMini, { rebuild: true })),
        ...(st.pattern !== "none" ? [
          seg("patternArea", "Where", [["full", "All over"], ["band", "Band"], ["top", "Top"], ["bottom", "Bottom"], ["left", "Left"], ["right", "Right"], ["edge", "Edges"], ["shape", "In shape"]], { rebuild: true }),
          range("patternPos", st.patternArea === "band" ? "Band height" : "Split at", 10, 90, 1, { unit: "%", reset: 50, show: () => ["band", "top", "bottom", "left", "right"].includes(st.patternArea) }),
          seg("patternColor", "Colour", [["ink", "Ink"], ["accent", "Spot"], ["duo", "Both"]]),
          row(range("patternAmt", "Strength", 3, 100, 1, { unit: "%", half: true, reset: 35 }), range("patternScale", "Scale", 40, 220, 5, { unit: "%", half: true, reset: 100 })),
          row(range("patternAngle", "Turn", -90, 90, 1, { unit: "°", half: true, reset: 0 }), h("div", { class: "f half" }, h("span", { class: "legend" }, "Variation"),
            row(btn("Reroll", () => set("patternSeed", ((st.patternSeed || 1) * 7 + 13) % 9973 + 1)))))] : []),
        st.pattern !== "none" && st.patternArea === "shape" && st.shape === "none" ? hint("Pick a big shape above for the pattern to fill.") : null));
    }
    P.push(group("Cut-out plates", seg("plates", null, [["none", "None"], ["title", "Behind title"], ["all", "Behind all words"]]),
      hint("Patches of ground colour behind the words, so a loud pattern or shape can run underneath.")));
    P.push(group("Texture", pick("texture", null, [["none", "None"], ["halftone", "Halftone"], ["lines", "Lines"], ["grid", "Grid"]], drawTexture, { rebuild: true }),
      range("textureAmt", "Strength", 0, 100, 1, { unit: "%", show: () => st.texture !== "none", reset: 45 }),
      row(range("grain", "Grain", 0, 100, 1, { half: true, reset: 28 }), range("vignette", "Vignette", 0, 100, 1, { half: true, reset: 55 }))));
  }
  if (t === "layout") P.push(...layoutPanel());
  return P;
}

function colourPanel() {
  const out = [];
  const sw = h("div", { class: "dz-swatches" });
  const roles = [["bg", "Ground"], ["ink", "Ink"], ["accent", "Spot"]];
  const rowsUpd = [];
  for (const [k, name] of roles) {
    const col = h("input", { type: "color", "aria-label": name }), hex = h("input", { type: "text", class: "mono", spellcheck: "false", "aria-label": name + " hex" });
    const ratio = h("small", { class: "dz-ratio" });
    col.addEventListener("input", () => { hex.value = col.value; set(k, col.value, { paletteName: "Custom" }); });
    hex.addEventListener("change", () => { const v = hex.value.trim().replace(/^([^#])/, "#$1"); if (SP.hexToRgb(v)) set(k, v.toLowerCase(), { paletteName: "Custom" }); else hex.value = st[k]; });
    const r = h("div", { class: "dz-sw" }, col, h("div", {}, h("b", {}, name), hex), ratio);
    sw.append(r);
    rowsUpd.push(() => {
      col.value = st[k]; if (document.activeElement !== hex) hex.value = st[k];
      if (k === "bg") { ratio.textContent = ""; return; }
      const c = SP.contrast(SP.hexToRgb(st[k]), SP.hexToRgb(st.bg)), good = k === "ink" ? c >= 4.5 : c >= 3;
      ratio.textContent = `${c.toFixed(1)}:1`; ratio.className = "dz-ratio " + (good ? "ok" : "bad");
      ratio.title = good ? "Readable on the ground" : "Low contrast against the ground";
    });
  }
  out.push(group(null, reg(sw, null, () => rowsUpd.forEach(f => f())),
    row(btn("Swap ground ⇄ ink", () => setMany({ bg: st.ink, ink: st.bg }, { paletteName: "Custom" })), btn("Swap ink ⇄ spot", () => setMany({ ink: st.accent, accent: st.ink }, { paletteName: "Custom" })))));

  // roll by mood
  const rolls = h("div", { class: "chips" });
  L.MOODS.forEach(m => rolls.append(btn(m === "any" ? "Any" : m[0].toUpperCase() + m.slice(1), () => {
    prefs.roll = (prefs.roll || 0) + 1; savePrefs();
    const p = L.makePalette(SP.mulberry32(SP.hashStr(m + prefs.roll)), m); setMany({ bg: p.bg, ink: p.ink, accent: p.accent }, { paletteName: p.name });
  }, "chip-b")));
  out.push(group("Roll a new palette", rolls, hint("Every roll keeps ink at 7:1 or better against the ground.")));

  // from picture
  const fromPic = h("div", { class: "dz-frompic" });
  out.push(group("From your picture", fromPic));
  (async () => {
    if (!image) { fromPic.append(hint("Add a picture (Picture tab) and palettes pulled from it appear here.")); return; }
    const swatches = extract(image, 6), sugg = suggestions(swatches);
    const raw = h("div", { class: "dz-raw" });
    swatches.forEach(s => raw.append(h("div", { class: "dz-rawsw" }, h("i", { style: { background: s.hex }, title: s.hex }),
      ...["bg", "ink", "accent"].map((k, i) => h("button", { type: "button", title: `Use as ${["ground", "ink", "spot"][i]}`, onclick: () => set(k, s.hex, { paletteName: "Custom" }) }, "GIS"[i])))));
    const sg = h("div", { class: "dz-pals" });
    sugg.forEach(p => sg.append(palButton(p)));
    fromPic.append(sg, h("span", { class: "legend" }, "Its colours — G I S puts one in as ground, ink or spot"), raw);
  })();

  // library
  const moodBar = h("div", { class: "chips" }), lib = h("div", { class: "dz-pals" });
  const fill = () => {
    lib.innerHTML = ""; const mood = prefs.palMood || "any";
    L.PALETTES.filter(p => L.moodsOf(p).includes(mood)).forEach(p => lib.append(palButton(p)));
    moodBar.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === mood)));
  };
  L.MOODS.forEach(m => moodBar.append(h("button", { type: "button", class: "chip-b", "data-v": m, onclick: () => { prefs.palMood = m; savePrefs(); fill(); } }, m === "any" ? "All" : m)));
  fill();
  out.push(group(`Palettes (${L.PALETTES.length})`, moodBar, lib));
  return out;
}
function palButton(p) {
  return h("button", { type: "button", class: "dz-pal", title: `${p.name}: ${p.bg} ${p.ink} ${p.accent}`, onclick: () => setMany({ bg: p.bg, ink: p.ink, accent: p.accent }, { paletteName: p.name }) },
    h("i", { style: { background: p.bg } }, h("b", { style: { background: p.ink } }), h("u", { style: { background: p.accent } })), h("small", {}, p.name));
}

function picturePanel() {
  const out = [], input = h("input", { type: "file", accept: "image/*", hidden: true });
  const drop = h("label", { class: "file-drop" }, input, h("span", {}, image ? "Drop a new picture here, or click to choose" : "Drop a picture here, or click to choose"));
  SP.bindDrop(SP.cover, { drop, input });
  const meta = SP.cover.meta();
  out.push(group(null, drop, image ? row(h("small", { class: "dz-meta" }, meta ? `${meta.name} · ${meta.w}×${meta.h}` : ""), btn("Remove picture", () => SP.cover.clear())) : null));
  if (!image) { out.push(hint("No picture: the sleeve is type only, which works too.")); return out; }
  out.push(group("Placement", pick("imgMode", null, [["bleed", "Full bleed"], ["panel", "Panel"], ["band", "Band"], ["circle", "Circle"], ["split", "Split"], ["inset", "Inset"], ["top", "Top"], ["arch", "Arch"]], drawImgMode, { rebuild: true }),
    ...(st.imgMode !== "bleed" ? [row(range("imgBoxSize", "Window size", 40, 160, 1, { unit: "%", half: true, reset: 100 }), range("dim", "Fade", 0, 95, 1, { unit: "%", half: true, reset: 60 })),
      row(range("imgBoxX", "Window across", -40, 40, 0.5, { unit: "%", half: true, reset: 0 }), range("imgBoxY", "Window down", -40, 40, 0.5, { unit: "%", half: true, reset: 0 }))] : [range("dim", "Fade into the ground", 0, 95, 1, { unit: "%", reset: 60 })])));
  out.push(group("Crop",
    row(btn("−", () => set("zoom", Math.max(20, st.zoom - 10))), range("zoom", "Zoom", 20, 300, 1, { unit: "%", reset: 100 }), btn("+", () => set("zoom", Math.min(300, st.zoom + 10)))),
    row(range("shiftX", "Across", -100, 100, 0.5, { unit: "%", half: true, reset: 0 }), range("shiftY", "Down", -100, 100, 0.5, { unit: "%", half: true, reset: 0 })),
    row(btn("Fit whole picture", () => setMany({ zoom: fitZoom(), shiftX: 0, shiftY: 0 })), btn("Fill", () => setMany({ zoom: 100, shiftX: 0, shiftY: 0 }))),
    hint("Drag the picture on the cover to move it; Ctrl/⌘ + scroll to zoom. Below 100% it floats on the ground.")));
  out.push(group("Colour",
    seg("imgTone", null, [["ink", "Ground → ink"], ["accent", "Ground → spot"], ["original", "Original"]]),
    row(range("imgContrast", "Contrast", 50, 200, 5, { unit: "%", half: true, reset: 100 }), range("imgBlur", "Blur", 0, 100, 1, { half: true, reset: 0 })),
    range("imgPosterize", "Posterize", 0, 8, 1, { fmt: (v) => v >= 2 ? `${v} levels` : "off", reset: 0 })));
  return out;
}
/* Zoom that shows the whole picture inside its window. */
function fitZoom() {
  if (!image) return 100; const b = SR.imageBox(st, 1), iw = image.naturalWidth, ih = image.naturalHeight;
  const cover = Math.max(b.w / iw, b.h / ih), contain = Math.min(b.w / iw, b.h / ih);
  return Math.max(20, Math.round(contain / cover * 100));
}

function labelPanel() {
  const out = [];
  const marks = [["none", "None"], ["text", "Name"], ["box", "Boxed"], ["stamp", "Roundel"], ["logo", "Logo"]];
  out.push(group(null, text("label", "Record label", { ph: "DUPPY WIRE SOUND" }),
    pick("labelMark", "Show it on the sleeve as", marks, drawMark, { rebuild: true })));
  if (st.labelMark === "logo" || !logo) {
    const input = h("input", { type: "file", accept: "image/*", hidden: true });
    const drop = h("label", { class: "file-drop" }, input, h("span", {}, logo ? "Drop a new logo, or click to choose" : "Add your logo: drop a PNG/SVG/JPG here, or click"));
    SP.bindDrop(SP.logo, { drop, input });
    out.push(group("Logo", drop, logo ? row(btn("Remove logo", () => SP.logo.clear())) : null,
      seg("logoMode", "Colour it", [["tint", "In one colour"], ["knockout", "Drop white bg"], ["original", "As is"]], { show: () => !!logo }),
      hint("The logo is kept for every release in this browser. “Drop white bg” is for logos saved on white (JPG).")));
  }
  if (st.labelMark !== "none") {
    const corners = [["↖", 14, 9], ["↗", 86, 9], ["↙", 14, 91], ["↘", 86, 91], ["⊙", 50, 91]];
    out.push(group("Mark",
      row(range("labelSize", "Size", 40, 260, 5, { unit: "%", half: true, reset: 100 }), range("labelOpacity", "Strength", 20, 100, 1, { unit: "%", half: true, reset: 85 })),
      colourSeg("labelColor", "Colour"),
      h("div", { class: "chips" }, h("span", { class: "legend" }, "Place"), ...corners.map(([t, x, y]) => btn(t, () => setMany({ labelX: x, labelY: y }), "chip-b"))),
      hint("Or drag it on the cover.")));
  }
  const rev = h("p", { class: "hint warn" });
  out.push(group("Catalogue", text("catalog", "Catalogue number", { ph: "DPWR-001" }),
    check("plate", "Catalogue plate", { rebuild: true }),
    ...(st.plate ? [row(seg("platePos", "Plate", [["tr", "Top right"], ["br", "Bottom right"]], { half: true }), text("plateText", "Plate text", { half: true, ph: "blank = catalogue no." }))] : []),
    check("barcode", "Barcode", { rebuild: true }),
    ...(st.barcode ? [pick("barcodeStyle", null, [["box", "Boxed"], ["clear", "Clear"], ["spot", "Spot"], ["spotbox", "Spot box"]], drawBarcodeMini, { wide: true }),
      reg(rev, null, () => { rev.hidden = !SR.barcodeReversed(st); rev.textContent = "Light bars on a darker ground: looks fine, but a scanner may not read it. Fine for digital covers."; }),
      row(range("barcodeSize", "Size", 60, 160, 5, { unit: "%", half: true, reset: 100 }), text("barcodeDigits", "Digits (12 or 13)", { half: true, ph: "blank = made up" }))] : [])));
  return out;
}

function layoutPanel() {
  const out = [], grid = h("div", { class: "dz-layouts" });
  const q = App.queue();
  for (const [key, Lp] of Object.entries(L.LAYOUTS)) {
    const c = h("canvas", { width: 200, height: 200 });
    grid.append(h("button", { type: "button", title: Lp.label, onclick: () => { const o = {}; L.LAYOUT_KEYS.forEach(k => o[k] = Lp[k]); setMany({ ...o, titleX: 0, artistX: 0, footerX: 0, motifX: 0, titleAlign: "", artistAlign: "", footerAlign: "", motifAlign: "", artistRotate: "none" }); } }, c, h("small", {}, Lp.label)));
    const s = { ...st }; L.LAYOUT_KEYS.forEach(k => s[k] = Lp[k]); Object.assign(s, { titleX: 0, artistX: 0, footerX: 0, motifX: 0, titleAlign: "", artistAlign: "", footerAlign: "", motifAlign: "", artistRotate: "none" });
    q(() => App.thumb(c, s));
  }
  out.push(group("Start from", grid));
  out.push(group("Whole sleeve",
    seg("align", "Alignment", [["left", "Left"], ["centre", "Centre"], ["right", "Right"]]),
    range("margin", "Margin", 4, 20, 0.5, { unit: "%", reset: 11 }),
    row(btn("Line everything up again", () => setMany({ titleX: 0, artistX: 0, footerX: 0, motifX: 0, titleAlign: "", artistAlign: "", footerAlign: "", motifAlign: "" }))),
    hint("Each element can also have its own alignment in its own tab.")));
  return out;
}

/* ---------- panel plumbing ---------- */
function buildPanel() {
  ctl.length = 0; panel.innerHTML = "";
  panelFor(tab).forEach(n => n && panel.append(n));
  tabsEl.querySelectorAll("button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
  refreshVisibility(); positionSel();
}
function refreshVisibility() {
  for (const c of ctl) { if (c.show) c.el.hidden = !c.show(); if (c.update) c.update(); }
  el.querySelectorAll(".dz-dot").forEach(d => { d.style.setProperty("--c", d.dataset.role === "ink" ? st.ink : st.accent); });
}
function select(t, opts = {}) {
  if (!TABS.some(x => x[0] === t)) return;
  tab = t; prefs.tab = t; savePrefs(); buildPanel();
  if (opts.focus) { const f = panel.querySelector("textarea, input[type=text]"); if (f) f.focus(); }
  if (window.innerWidth < 900 && opts.scroll) panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------- direct manipulation on the canvas ---------- */
const SEL_FOR_TAB = { title: "title", artist: "artist", footer: "footer", marks: "motif", label: "label", picture: "image" };
function toCanvas(e) { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * PREVIEW / r.width, y: (e.clientY - r.top) * PREVIEW / r.height, k: PREVIEW / r.width }; }
function hitTest(p) {
  const pad = 14;
  for (const k of ["label", "barcode", "artist", "footer", "motif", "title", "image"]) {
    const b = boxes[k]; if (!b) continue;
    if (p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad) return k;
  }
  return null;
}
function place(div, b) {
  if (!b) { div.hidden = true; return; }
  const r = canvas.getBoundingClientRect(), s = r.width / PREVIEW;
  Object.assign(div.style, { left: `${b.x * s - 4}px`, top: `${b.y * s - 4}px`, width: `${b.w * s + 8}px`, height: `${b.h * s + 8}px` }); div.hidden = false;
}
function positionSel() { if (!selBox) return; const k = SEL_FOR_TAB[tab]; place(selBox, k && boxes[k]); if (selBox.querySelector("span")) selBox.querySelector("span").textContent = TABS.find(t => t[0] === tab)[1]; }

function bindCanvas() {
  let drag = null;
  overlay.addEventListener("pointermove", (e) => {
    if (editor.contains(e.target)) return;
    const p = toCanvas(e);
    if (drag) {
      const dx = (p.x - drag.p.x) / PREVIEW * 100, dy = (p.y - drag.p.y) / PREVIEW * 100;
      if (Math.abs(dx) + Math.abs(dy) > 0.3) drag.moved = true;
      if (!drag.moved) return;
      const o = {}, snap = (v) => Math.abs(v) < 1.2 ? 0 : Math.round(v * 2) / 2;
      const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
      switch (drag.k) {
        case "title": o.titleDy = clamp(Math.round((drag.s.titleDy + dy) * 2) / 2, -45, 30); o.titleX = clamp(snap(drag.s.titleX + dx), -40, 40); break;
        case "artist": o.artistY = clamp(Math.round((drag.s.artistY + dy) * 5) / 5, 3, 97); if (st.artistRotate === "none") o.artistX = clamp(snap(drag.s.artistX + dx), -45, 45); break;
        case "footer": o.footerY = clamp(Math.round((drag.s.footerY + dy) * 5) / 5, 3, 98); o.footerX = clamp(snap(drag.s.footerX + dx), -45, 45); break;
        case "motif": o.motifY = clamp(Math.round((drag.s.motifY + dy) * 5) / 5, 3, 97); o.motifX = clamp(snap(drag.s.motifX + dx), -45, 45); break;
        case "label": o.labelX = clamp(Math.round((drag.s.labelX + dx) * 2) / 2, 2, 98); o.labelY = clamp(Math.round((drag.s.labelY + dy) * 2) / 2, 2, 98); break;
        case "image": { const b = SR.imageBox(st, 100); o.shiftX = clamp(drag.s.shiftX + dx / b.w * 100, -150, 150); o.shiftY = clamp(drag.s.shiftY + dy / b.h * 100, -150, 150); break; }
      }
      Object.assign(st, o); writing = true; App.commit(st, { force: drag.first }); writing = false; drag.first = false; draw(); refreshVisibility();
      return;
    }
    const k = hitTest(p); place(hoverBox, k && k !== SEL_FOR_TAB[tab] ? boxes[k] : null);
    overlay.style.cursor = k ? (k === "image" ? "grab" : "move") : "default";
  });
  overlay.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || editor.contains(e.target)) return;
    const p = toCanvas(e), k = hitTest(p);
    if (!k) { select(image ? "surface" : "colour", { scroll: true }); return; }
    const t = HIT_TAB[k]; if (t !== tab) select(t, { scroll: e.pointerType !== "mouse" });
    if (k === "barcode") return;
    drag = { k, p, s: { ...st }, moved: false, first: true }; overlay.setPointerCapture(e.pointerId); hoverBox.hidden = true;
  });
  const end = () => { drag = null; };
  overlay.addEventListener("pointerup", end); overlay.addEventListener("pointercancel", end);
  overlay.addEventListener("pointerleave", () => { hoverBox.hidden = true; });
  overlay.addEventListener("dblclick", (e) => { if (editor.contains(e.target)) return; const k = hitTest(toCanvas(e)); if (k === "title" || k === "artist" || k === "footer") openEditor(k); });
  overlay.addEventListener("wheel", (e) => {
    if (!image || !(e.ctrlKey || e.metaKey) || hitTest(toCanvas(e)) !== "image" && !boxes.image) return;
    e.preventDefault(); set("zoom", Math.max(20, Math.min(300, Math.round(st.zoom * (e.deltaY < 0 ? 1.05 : 0.95)))));
  }, { passive: false });
  // keyboard nudges for the selected element
  overlay.tabIndex = 0;
  overlay.addEventListener("keydown", (e) => {
    if (editor.contains(e.target)) return;
    const step = e.shiftKey ? 2 : 0.5, k = SEL_FOR_TAB[tab]; if (!k || !e.key.startsWith("Arrow")) return;
    e.preventDefault(); const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0, dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
    const map = { title: ["titleX", "titleDy"], artist: ["artistX", "artistY"], footer: ["footerX", "footerY"], motif: ["motifX", "motifY"], label: ["labelX", "labelY"], image: ["shiftX", "shiftY"] }[k];
    setMany({ [map[0]]: st[map[0]] + dx, [map[1]]: st[map[1]] + dy });
  });
}
/* Retype words right on the cover. */
function openEditor(k) {
  const b = boxes[k]; if (!b) return;
  const r = canvas.getBoundingClientRect(), s = r.width / PREVIEW, multi = k === "title";
  const ta = h("textarea", { class: "dz-inline", rows: multi ? Math.max(1, st.title.split("\n").length) : 1, spellcheck: "false" });
  ta.value = st[k];
  Object.assign(ta.style, { left: `${Math.max(0, b.x * s - 8)}px`, top: `${Math.max(0, b.y * s - 8)}px`, width: `${Math.min(r.width - Math.max(0, b.x * s - 8), Math.max(160, b.w * s + 16))}px`,
    fontSize: `${Math.max(14, Math.min(40, (multi ? b.h / Math.max(1, st.title.split("\n").length) : b.h) * s * 0.7))}px` });
  editor.innerHTML = ""; editor.append(ta); editor.hidden = false; ta.focus(); ta.select();
  ta.addEventListener("input", () => set(k, multi ? ta.value : ta.value.replace(/\n/g, " ")));
  const close = () => { editor.hidden = true; editor.innerHTML = ""; overlay.focus(); };
  ta.addEventListener("keydown", (e) => { if (e.key === "Escape" || (e.key === "Enter" && (!multi || e.ctrlKey || e.metaKey))) { e.preventDefault(); close(); } });
  ta.addEventListener("blur", () => setTimeout(close, 60));
  select(k);
}

/* ---------- shuffle + variations ---------- */
function locks() { return prefs.locks || {}; }
function shuffle(seed) {
  seed = seed ?? ((SP.get().sleeve.lookSeed || 0) + 1); if (seed < 1) seed = 1;
  const s = L.randomize(App.state(), seed, locks());
  s.lookSeed = seed; writing = true; App.commit(s, { force: true, paletteName: s.paletteName }); SP.patch("sleeve", { lookSeed: seed }); writing = false;
  st = App.state(); buildPanel(); draw(); updateSeed();
}
function updateSeed() { el.querySelector(".dz-seed b").textContent = SP.get().sleeve.lookSeed || "—"; }
let varBase = 1;
function showVariations() {
  const strip = el.querySelector(".dz-vars"), grid = strip.querySelector(".dz-vargrid"); strip.hidden = false; grid.innerHTML = "";
  const base = App.state(), q = App.queue();
  for (let i = 0; i < 8; i++) {
    const s = L.mutate(base, varBase * 100 + i, locks()), c = h("canvas", { width: 240, height: 240 });
    grid.append(h("button", { type: "button", title: "Use this", onclick: () => { App.applyLook(SR.lookOf(s)); } }, c,
      h("span", { class: "iconbtn dz-varflag", role: "button", title: "Flag for later", onclick: (e) => { e.stopPropagation(); const on = App.toggleFlag(SR.lookOf(s)); e.currentTarget.setAttribute("aria-pressed", String(on)); } }, "♥")));
    q(() => App.thumb(c, s));
  }
}

/* ---------- mount ---------- */
function mount(root) {
  el = root; st = App.state(); tab = prefs.tab || "title";
  const lockChips = h("div", { class: "chips dz-locks" }, h("span", { class: "legend" }, "Keep"));
  const names = { colour: "Colours", type: "Type", layout: "Layout", motif: "Marks", border: "Border", backdrop: "Backdrop", picture: "Picture" };
  L.GROUPS.forEach(g => lockChips.append(h("button", { type: "button", class: "chip-b", "aria-pressed": String(!!locks()[g]), title: `Shuffling leaves the ${names[g].toLowerCase()} alone`, onclick: (e) => {
    prefs.locks = { ...locks(), [g]: !locks()[g] }; savePrefs(); e.currentTarget.setAttribute("aria-pressed", String(!!prefs.locks[g])); } }, names[g])));
  canvas = h("canvas", { width: PREVIEW, height: PREVIEW, "aria-label": "The sleeve. Click an element to edit it." });
  hoverBox = h("div", { class: "dz-hover", hidden: true });
  selBox = h("div", { class: "dz-sel", hidden: true }, h("span"));
  editor = h("div", { class: "dz-editor", hidden: true });
  overlay = h("div", { class: "dz-overlay" }, hoverBox, selBox, editor);
  tabsEl = h("div", { class: "dz-tabs", role: "tablist" }, ...TABS.map(([k, t]) => h("button", { type: "button", role: "tab", "data-tab": k, onclick: () => select(k) }, t)));
  panel = h("div", { class: "dz-panel", role: "tabpanel" });
  const sizeSel = h("select", { "aria-label": "Download size", onchange: (e) => set("exportSize", e.target.value) }, ...["3000", "2000", "1400"].map(v => h("option", { value: v }, `${v} px`)));

  el.append(
    h("div", { class: "dz-wrap" },
      h("div", { class: "dz-stage" },
        h("div", { class: "dz-tools" },
          h("button", { type: "button", class: "btn primary", title: "A new look for these words (keeps what you've locked)", onclick: () => shuffle() }, "Shuffle"),
          h("div", { class: "dz-seed" }, btn("‹", () => shuffle((SP.get().sleeve.lookSeed || 2) - 1)), h("span", {}, "#", h("b", {}, "—")), btn("›", () => shuffle())),
          btn("Variations", () => { varBase++; showVariations(); }),
          btn("♥ Flag this look", (e) => { const on = App.toggleFlag(SR.lookOf(App.state())); e.currentTarget.textContent = on ? "♥ Flagged" : "♥ Flag this look"; }),
          lockChips),
        h("div", { class: "dz-vars", hidden: true }, h("div", { class: "dz-varhead" }, h("span", { class: "legend" }, "Variations on this look: click one to use it"), btn("More", () => { varBase++; showVariations(); }), btn("Close", () => { el.querySelector(".dz-vars").hidden = true; })), h("div", { class: "dz-vargrid" })),
        h("div", { class: "dz-sleeve" }, canvas, overlay),
        h("div", { class: "dz-foot" },
          h("span", { class: "hint" }, "Click anything to edit it · drag to move · double-click words to retype · arrows nudge"),
          h("div", { class: "dz-dl" }, h("output", { class: "dz-file" }), sizeSel, h("button", { type: "button", class: "btn small", onclick: download }, "Download PNG")))),
      h("aside", { class: "dz-side" }, tabsEl, panel)));
  sizeSel.value = st.exportSize || "3000";

  bindCanvas();
  SP.on(() => { if (writing) return; st = App.state(); if (!visible) { stale = true; return; } if (!panel.contains(document.activeElement)) buildPanel(); else refreshVisibility(); draw(); updateSeed(); });
  SP.cover.on(async () => { image = await SP.cover.image(); st = App.state(); if (visible) { buildPanel(); draw(); } else stale = true; });
  SP.logo.on(async () => { logo = await SP.logo.image(); if (visible) { buildPanel(); draw(); } else stale = true; });
  window.addEventListener("resize", SP.rafOnce(positionSel));
  (async () => { image = await SP.cover.image(); logo = await SP.logo.image(); buildPanel(); draw(); updateSeed(); })();
}
async function download() {
  const size = +(st.exportSize || 3000), c = document.createElement("canvas"); c.width = c.height = size;
  await SR.render(c, st, image, logo);
  SP.download(await SP.canvasBlob(c), SR.filename(st, size));
}

App.view("design", {
  label: "Design", mount,
  show() { visible = true; st = App.state(); if (stale) { stale = false; buildPanel(); } draw(); updateSeed(); },
  hide() { visible = false; },
});
window.Design = { select: (t) => select(t, { focus: true }) };
})();
