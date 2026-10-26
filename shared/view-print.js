/* Sleeve Press: Print view. Physical pieces (CD booklet, tray inlay, wallet, disc + vinyl labels, stickers)
   laid out on A4 / US Letter at exact size, with crop marks, bleed and fold lines, saved as a PDF. */
(function () {
"use strict";
const h = App.h;
const PPM_PDF = 300 / 25.4, PPM_PREVIEW = 2.6, PPM_THUMB = 1.4;
const PAPER = { A4: { w: 210, h: 297, label: "A4" }, Letter: { w: 215.9, h: 279.4, label: "US Letter" } };
const MARGIN = 10, GAP = 4, BLEED = 3, CROP_LEN = 4, VINYL_HOLE = 7.24;

const PIECES = [
  { id: "booklet", name: "CD booklet front", help: "The front of a jewel case. Slides under the lid clips." },
  { id: "booklet2", name: "CD booklet, folded", help: "Tracklist panel + front. Fold at the dashed line." },
  { id: "inlay", name: "CD tray inlay", help: "The back card. Goes behind the tray; the two 6.5 mm spines fold up the sides." },
  { id: "wallet", name: "Card wallet sleeve", help: "Back + front panels for a card wallet. Fold in the middle." },
  { id: "disc", name: "CD disc label", help: "Stick-on label for the disc face.", round: true },
  { id: "vinyl", name: "Vinyl centre labels", help: "One label per side, from the tracklist sides.", round: true },
  { id: "sticker", name: "Sticker sheet", help: "The cover as square stickers, filling the page." },
];
const GRID_PRESETS = [
  { id: "cd2a4", name: "2 per page, 117 mm CD labels (A4)", paper: "A4", g: { cols: 1, rows: 2, d: 117, x: 105, y: 76.5, px: 0, py: 144 } },
  { id: "cd2let", name: "2 per page, 117 mm CD labels (US Letter)", paper: "Letter", g: { cols: 1, rows: 2, d: 117, x: 107.95, y: 69.85, px: 0, py: 139.7 } },
  { id: "v4a4", name: "4 per page, 100 mm round (A4)", paper: "A4", g: { cols: 2, rows: 2, d: 100, x: 52.5, y: 96.5, px: 105, py: 104 } },
  { id: "v4let", name: "4 per page, 100 mm round (US Letter)", paper: "Letter", g: { cols: 2, rows: 2, d: 100, x: 53.975, y: 87.7, px: 107.95, py: 104 } },
];
const DEF = {
  paper: "A4", crops: true, bleed: true, folds: true, whiteHole: true, layout: "free", fill: false, preset: "cd2a4",
  pieces: { booklet: { on: true, n: 1 } }, discD: 117, discHole: 41, vinylD: 100, sticker: 50,
  grid: { ...GRID_PRESETS[0].g, nx: 0, ny: 0 },
};
const clampN = (v, lo, hi, d) => { v = parseFloat(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };

function opts() {
  const p = SP.get().print || {};
  const o = { ...DEF, ...p, pieces: { ...(p.pieces || DEF.pieces) }, grid: { ...DEF.grid, ...(p.grid || {}) } };
  if (!PAPER[o.paper]) o.paper = "A4";
  o.discD = clampN(o.discD, 40, 130, 117); o.discHole = clampN(o.discHole, 0, o.discD - 10, 41);
  o.vinylD = clampN(o.vinylD, 40, 180, 100); o.sticker = clampN(o.sticker, 15, 180, 50);
  return o;
}
const save = (p) => SP.patch("print", p);
const pieceOn = (o, id) => !!(o.pieces[id] && o.pieces[id].on);
const copiesOf = (o, id) => Math.round(clampN(o.pieces[id] && o.pieces[id].n, 1, 50, 1));

/* trim size + extras of each piece, in mm */
function spec(o, id) {
  const P = Makers.PRINT;
  switch (id) {
    case "booklet": return { w: P.booklet.w, h: P.booklet.h, folds: [] };
    case "booklet2": return { w: P.booklet2.w, h: P.booklet2.h, folds: P.booklet2.folds };
    case "inlay": return { w: P.inlay.w, h: P.inlay.h, folds: P.inlay.folds };
    case "wallet": return { w: P.wallet.w, h: P.wallet.h, folds: P.wallet.folds };
    case "disc": return { w: o.discD, h: o.discD, round: true, hole: o.discHole };
    case "vinyl": return { w: o.vinylD, h: o.vinylD, round: true, hole: VINYL_HOLE };
    case "sticker": return { w: o.sticker, h: o.sticker };
  }
}
const sizeText = (o, id) => {
  const s = spec(o, id);
  if (id === "disc") return `${s.w} mm round · ${s.hole} mm hub hole`;
  if (id === "vinyl") return `${s.w} mm round · ${VINYL_HOLE} mm hole`;
  if (id === "sticker") return `${s.w} × ${s.w} mm each`;
  if (id === "inlay") return "151 × 118 mm · 6.5 mm spines";
  return `${s.w} × ${s.h} mm`;
};

/* ---------- canvases ---------- */
const mk = (w, hh) => { const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(hh)); return c; };
/* Artwork for one piece at ppm (no bleed, not rotated). D = diameter override for round labels. */
async function artwork(e, id, ppm, o, side, D) {
  switch (id) {
    case "booklet": return Makers.cover(e, 120 * ppm);
    case "booklet2": return Makers.booklet2(e, ppm);
    case "inlay": return Makers.inlay(e, ppm);
    case "wallet": return Makers.wallet(e, ppm);
    case "sticker": return Makers.cover(e, o.sticker * ppm);
    case "disc": { const d = D || o.discD; return Makers.disc(e, d * ppm, o.discHole / d); }
    case "vinyl": return Makers.vinyl(e, side, (D || o.vinylD) * ppm);
  }
}
/* Extends a canvas by b px on every side by mirroring its edges, so the art runs past the cut. */
function addBleed(src, b) {
  b = Math.round(b); if (b <= 0) return src;
  const W = src.width + b * 2, H = src.height + b * 2, c = mk(W, H), x = c.getContext("2d");
  x.drawImage(src, b, b);
  x.save(); x.translate(b * 2, 0); x.scale(-1, 1); x.drawImage(src, 0, 0, b, src.height, b, b, b, src.height); x.restore();
  x.save(); x.translate(W + src.width, 0); x.scale(-1, 1); x.drawImage(src, src.width - b, 0, b, src.height, src.width, b, b, src.height); x.restore();
  x.save(); x.translate(0, b * 2); x.scale(1, -1); x.drawImage(c, 0, b, W, b, 0, b, W, b); x.restore();
  x.save(); x.translate(0, H + src.height); x.scale(1, -1); x.drawImage(c, 0, src.height, W, b, 0, src.height, W, b); x.restore();
  return c;
}
/* 90° clockwise */
function rotate(src) {
  const c = mk(src.height, src.width), x = c.getContext("2d");
  x.translate(c.width, 0); x.rotate(Math.PI / 2); x.drawImage(src, 0, 0); return c;
}

/* ---------- layout (all mm, independent of resolution) ---------- */
/* Returns { pages: [{ w, h, ops }], jobs: Map key → { id, side, D, bleed, rot }, warn } */
function layout(o, db) {
  const paper = PAPER[o.paper], b = o.bleed ? BLEED : 0, pw = paper.w - MARGIN * 2, ph = paper.h - MARGIN * 2;
  const cropPad = o.crops ? 1 + CROP_LEN : 0, pages = [], jobs = new Map(), warn = [];
  const newPage = () => { const p = { w: paper.w, h: paper.h, ops: [] }; pages.push(p); return p; };
  const job = (id, side, D, rot) => { const k = [id, side || "", D || "", b, rot ? 1 : 0].join("|"); if (!jobs.has(k)) jobs.set(k, { id, side, D, bleed: b, rot }); return k; };
  const cut = { width: 0.2, gray: 0.35 }, fold = { width: 0.2, gray: 0.45, dash: 1.2 };
  const sides = Makers.vinylSides(db);

  function drawRect(pg, it, tx, ty) {
    const s = it.s, rot = it.rot, w = rot ? s.h : s.w, hh = rot ? s.w : s.h;
    pg.ops.push({ t: "img", key: job(it.id, it.side, 0, rot), x: tx - b, y: ty - b, w: w + b * 2, h: hh + b * 2 });
    if (o.crops) pg.ops.push({ t: "crops", x: tx, y: ty, w, h: hh, len: CROP_LEN, gap: b + 1 });
    if (o.folds) for (const [x1, y1, x2, y2] of s.folds || []) {
      const m = (x, y) => rot ? [tx + (s.h - y), ty + x] : [tx + x, ty + y];
      const a = m(x1, y1), c = m(x2, y2), ext = cropPad + b;   // run the fold out into the crop-mark margin too
      if (Math.abs(a[0] - c[0]) < 0.01) pg.ops.push({ t: "line", x1: a[0], y1: Math.min(a[1], c[1]) - ext, x2: a[0], y2: Math.max(a[1], c[1]) + ext, o: fold });
      else pg.ops.push({ t: "line", x1: Math.min(a[0], c[0]) - ext, y1: a[1], x2: Math.max(a[0], c[0]) + ext, y2: a[1], o: fold });
    }
  }
  function drawRound(pg, it, cx, cy, D) {
    const r = D / 2;
    pg.ops.push({ t: "img", key: job(it.id, it.side, D, false), x: cx - r - b, y: cy - r - b, w: D + b * 2, h: D + b * 2, clip: "circle" });
    pg.ops.push({ t: "circle", cx, cy, r, o: cut });
    const hr = Math.min(it.s.hole, D - 4) / 2;
    if (hr > 0) {
      if (o.whiteHole) pg.ops.push({ t: "circle", cx, cy, r: hr, o: { width: 0.2, gray: 0.35, fill: 1, strokeToo: true } });
      else pg.ops.push({ t: "circle", cx, cy, r: hr, o: cut });
    }
  }

  // expand the selection into items
  const rects = [], rounds = [];
  for (const P of PIECES) {
    if (!pieceOn(o, P.id) || P.id === "sticker") continue;
    const s = spec(o, P.id), n = copiesOf(o, P.id);
    for (let i = 0; i < n; i++) {
      if (P.id === "vinyl") for (const sd of sides) (o.layout === "grid" ? rounds : rects).push({ id: P.id, side: sd, s, name: `${P.name} ${sd}` });
      else if (s.round && o.layout === "grid") rounds.push({ id: P.id, s, name: P.name });
      else rects.push({ id: P.id, s, name: P.name });
    }
  }

  // label-sheet grid for round labels
  if (rounds.length) {
    const g = o.grid, cols = Math.max(1, Math.round(g.cols)), rows = Math.max(1, Math.round(g.rows)), per = cols * rows, D = clampN(g.d, 10, 200, 117);
    let list = rounds.slice();
    if (o.fill && list.length % per) { const base = list.slice(); while (list.length % per) list.push(base[list.length % base.length]); }
    for (let i = 0; i < list.length; i++) {
      const pg = i % per === 0 ? newPage() : pages[pages.length - 1], k = i % per, c = k % cols, r = Math.floor(k / cols);
      const cx = g.x + c * g.px + (+g.nx || 0), cy = g.y + r * g.py + (+g.ny || 0);
      drawRound(pg, list[i], cx, cy, D);
    }
  }

  // free shelf packing, tallest first (stable). The trim + bleed stays inside the margin; crop marks may
  // run into the margin, and neighbours sit far enough apart that marks never land on another piece.
  if (rects.length) {
    const sp = GAP + (o.crops ? cropPad * 2 : 0);
    for (const it of rects) {
      let fw = it.s.w + b * 2, fh = it.s.h + b * 2;
      it.rot = false;
      if (!it.s.round && (fw > pw || fh > ph) && fh <= pw && fw <= ph) { it.rot = true; [fw, fh] = [fh, fw]; }
      if (fw > pw + 0.01 || fh > ph + 0.01) warn.push(`${it.name} is larger than the printable area of ${paper.label}.`);
      it.fw = fw; it.fh = fh;
    }
    const sorted = rects.map((it, i) => [it, i]).sort((a, z) => (z[0].fh - a[0].fh) || (a[1] - z[1])).map(x => x[0]);
    let pg = null, x = 0, y = 0, shelf = 0;
    for (const it of sorted) {
      if (!pg) { pg = newPage(); x = 0; y = 0; shelf = 0; }
      if (x > 0 && x + it.fw > pw + 0.01) { x = 0; y += shelf + sp; shelf = 0; }
      if (y > 0 && y + it.fh > ph + 0.01) { pg = newPage(); x = 0; y = 0; shelf = 0; }
      const ox = MARGIN + x + b, oy = MARGIN + y + b;
      if (it.s.round) drawRound(pg, it, ox + it.s.w / 2, oy + it.s.h / 2, it.s.w); else drawRect(pg, it, ox, oy);
      x += it.fw + (it.s.round ? GAP : sp); shelf = Math.max(shelf, it.fh);
    }
  }

  // sticker sheets: a full page grid each
  if (pieceOn(o, "sticker")) {
    const s = spec(o, "sticker"), cell = s.w + b * 2, sg = GAP + (o.crops ? 0 : 0);
    const cols = Math.max(1, Math.floor((pw + sg) / (cell + sg))), rows = Math.max(1, Math.floor((ph + sg) / (cell + sg)));
    if (cell > pw || cell > ph) warn.push(`Stickers of ${s.w} mm don't fit on ${paper.label}.`);
    const ox = MARGIN + (pw - (cols * cell + (cols - 1) * sg)) / 2, oy = MARGIN + (ph - (rows * cell + (rows - 1) * sg)) / 2;
    for (let n = copiesOf(o, "sticker"); n > 0; n--) {
      const pg = newPage();
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const tx = ox + c * (cell + sg) + b, ty = oy + r * (cell + sg) + b;
        pg.ops.push({ t: "img", key: job("sticker", "", 0, false), x: tx - b, y: ty - b, w: cell, h: cell });
        if (o.crops) pg.ops.push({ t: "rect", x: tx, y: ty, w: s.w, h: s.w, o: cut });
      }
    }
  }

  // footer on every page
  const r = db.release, tag = [r.catalog, r.artist, SP.titleLine(r)].filter(Boolean).join(" - ");
  pages.forEach((pg, i) => pg.ops.push({ t: "text", s: `${tag}  |  ${paper.label}  |  page ${i + 1} of ${pages.length}  |  print at 100% / actual size`, x: MARGIN, y: paper.h - 4.5, size: 6.5, gray: 0.5 }));
  return { pages, jobs, warn };
}

/* Renders the canvases a layout needs at ppm. */
async function renderJobs(L, e, o, ppm) {
  const out = new Map(), base = new Map();
  for (const [k, j] of L.jobs) {
    const bk = [j.id, j.side || "", j.D || ""].join("|");
    if (!base.has(bk)) base.set(bk, await artwork(e, j.id, ppm, o, j.side, j.D));
    let c = addBleed(base.get(bk), j.bleed * ppm);
    if (j.rot) c = rotate(c);
    out.set(k, c);
  }
  return out;
}
function cropLines(op) {
  const { x, y, w, h: hh, len, gap } = op, L = [];
  for (const [cx, cy, sx, sy] of [[x, y, -1, -1], [x + w, y, 1, -1], [x, y + hh, -1, 1], [x + w, y + hh, 1, 1]]) {
    L.push([cx + sx * gap, cy, cx + sx * (gap + len), cy]); L.push([cx, cy + sy * gap, cx, cy + sy * (gap + len)]);
  }
  return L;
}
function toPdf(L, cv) {
  const d = PDF.doc();
  for (const pg of L.pages) {
    const p = d.page(pg.w, pg.h);
    for (const op of pg.ops) {
      if (op.t === "img") p.image(cv.get(op.key), op.x, op.y, op.w, op.h, op.clip);
      else if (op.t === "crops") cropLines(op).forEach(l => p.line(...l, { width: 0.2 }));
      else if (op.t === "line") p.line(op.x1, op.y1, op.x2, op.y2, op.o);
      else if (op.t === "rect") p.rect(op.x, op.y, op.w, op.h, op.o);
      else if (op.t === "circle") p.circle(op.cx, op.cy, op.r, op.o);
      else if (op.t === "text") p.text(op.s, op.x, op.y, op.size, op.gray);
    }
  }
  return d.blob();
}
function drawPage(canvas, pg, cv, k) {
  canvas.width = Math.round(pg.w * k); canvas.height = Math.round(pg.h * k);
  const x = canvas.getContext("2d");
  x.fillStyle = "#fff"; x.fillRect(0, 0, canvas.width, canvas.height);
  const stroke = (o = {}) => { x.lineWidth = Math.max(0.6, (o.width || 0.25) * k); const g = Math.round((o.gray ?? 0) * 255); x.strokeStyle = `rgb(${g},${g},${g})`; x.setLineDash(o.dash ? [o.dash * k, o.dash * k] : []); };
  for (const op of pg.ops) {
    if (op.t === "img") {
      const c = cv.get(op.key); x.save();
      if (op.clip === "circle") { x.beginPath(); x.arc((op.x + op.w / 2) * k, (op.y + op.h / 2) * k, Math.min(op.w, op.h) / 2 * k, 0, Math.PI * 2); x.clip(); }
      x.drawImage(c, op.x * k, op.y * k, op.w * k, op.h * k); x.restore();
    } else if (op.t === "crops" || op.t === "line") {
      stroke(op.t === "crops" ? { width: 0.2 } : op.o); x.beginPath();
      for (const l of op.t === "crops" ? cropLines(op) : [[op.x1, op.y1, op.x2, op.y2]]) { x.moveTo(l[0] * k, l[1] * k); x.lineTo(l[2] * k, l[3] * k); }
      x.stroke();
    } else if (op.t === "rect") { stroke(op.o); x.strokeRect(op.x * k, op.y * k, op.w * k, op.h * k); }
    else if (op.t === "circle") {
      x.beginPath(); x.arc(op.cx * k, op.cy * k, op.r * k, 0, Math.PI * 2);
      if (op.o.fill != null) { const g = Math.round(op.o.fill * 255); x.fillStyle = `rgb(${g},${g},${g})`; x.fill(); }
      if (op.o.fill == null || op.o.strokeToo) { stroke(op.o); x.stroke(); }
    } else if (op.t === "text") {
      const g = Math.round(op.gray * 255); x.fillStyle = `rgb(${g},${g},${g})`; x.font = `${op.size * 0.3528 * k}px Helvetica, Arial, sans-serif`; x.fillText(op.s, op.x * k, op.y * k);
    }
  }
  x.setLineDash([]);
}
const fileName = (db, o) => `${SP.safeName(db.release.catalog || db.release.artist || "release") || "release"}_print_${o.paper}.pdf`;

async function smallEnv() { return Makers.env(SP.get(), await App.smallImage(), await SP.logo.image()); }
async function buildPdf(o) {
  const db = SP.get(), L = layout(o, db);
  if (!L.pages.length) return null;
  const e = await App.env(), cv = await renderJobs(L, e, o, PPM_PDF);
  return { blob: toPdf(L, cv), pages: L.pages.length, name: fileName(db, o) };
}

/* ---------- view ---------- */
let root = null, visible = false, pageIdx = 0;
const q = App.queue();
let gen = 0;

function mount(el) {
  root = el;
  el.append(
    h("div", { class: "view-head" },
      h("div", {}, h("h1", { text: "Print" }), h("p", { text: "Pick the pieces you need. They are laid out at exact size on your paper, ready to print, cut and fold." }))),
    h("div", { class: "pr-wrap" },
      h("div", { class: "pr-main" },
        h("div", { class: "pr-pieces", id: "pr-pieces" }),
        h("div", { class: "panel pr-tracks" },
          h("h2", {}, "Tracklist", h("small", { id: "pr-trk-meta" })),
          h("p", { class: "hint", text: "The booklet, inlay, wallet and vinyl labels print these. One per line: Title | feat. Name | 140 | Am | 3:45. A line of --- starts side B." }),
          h("textarea", { id: "pr-trk", class: "mono", rows: "7", spellcheck: "false", "aria-label": "Tracklist, one track per line" }),
          h("div", { class: "btn-row" }, h("button", { type: "button", class: "btn small", id: "pr-demo", text: "Load demo tracks" })))),
      h("aside", { class: "pr-side" },
        h("div", { class: "panel pr-sheet" },
          h("h2", { text: "Sheet" }),
          h("label", { class: "f" }, h("span", { text: "Paper" }),
            h("div", { class: "seg", id: "pr-paper" }, h("button", { type: "button", "data-v": "A4", text: "A4" }), h("button", { type: "button", "data-v": "Letter", text: "US Letter" }))),
          h("div", { class: "pr-checks" },
            h("label", { class: "check" }, h("input", { type: "checkbox", id: "pr-crops" }), "Crop marks"),
            h("label", { class: "check" }, h("input", { type: "checkbox", id: "pr-bleed" }), "3 mm bleed"),
            h("label", { class: "check" }, h("input", { type: "checkbox", id: "pr-folds" }), "Fold lines"),
            h("label", { class: "check" }, h("input", { type: "checkbox", id: "pr-whitehole" }), "White centre hole")),
          h("div", { class: "pr-roundopts", id: "pr-roundopts" },
            h("label", { class: "f" }, h("span", { text: "Round labels" }),
              h("select", { id: "pr-layout" }, h("option", { value: "free", text: "Free (cut by hand)" }), h("option", { value: "grid", text: "Label sheet grid" }))),
            h("div", { class: "pr-grid", id: "pr-grid" },
              h("label", { class: "f" }, h("span", { text: "Template" }), h("select", { id: "pr-preset" },
                ...GRID_PRESETS.map(p => h("option", { value: p.id, text: p.name })), h("option", { value: "custom", text: "Custom measurements" }))),
              h("div", { class: "pr-nums" },
                ...[["cols", "Columns", 1], ["rows", "Rows", 1], ["d", "Label Ø mm", 0.5], ["x", "1st centre X", 0.1], ["y", "1st centre Y", 0.1], ["px", "Pitch X", 0.1], ["py", "Pitch Y", 0.1], ["nx", "Nudge X", 0.1], ["ny", "Nudge Y", 0.1]]
                  .map(([k, l, st]) => h("label", { class: "f" }, h("span", { text: l }), h("input", { type: "number", step: String(st), "data-g": k, inputmode: "decimal" })))),
              h("label", { class: "check" }, h("input", { type: "checkbox", id: "pr-fill" }), "Fill every label on the sheet"),
              h("p", { class: "hint", text: "Centres and pitch are mm from the page's top-left corner. Check your label maker's template measurements and do a test print on plain paper first; use the nudges to correct any printer offset." })))),
        h("div", { class: "panel pr-out" },
          h("h2", {}, "Preview", h("small", { id: "pr-pageinfo" })),
          h("div", { class: "pr-pagewrap" }, h("canvas", { id: "pr-page", class: "pr-page", "aria-label": "Page layout preview" })),
          h("div", { class: "pr-pager" },
            h("button", { type: "button", class: "btn small", id: "pr-prev", "aria-label": "Previous page", text: "‹ Prev" }),
            h("button", { type: "button", class: "btn small", id: "pr-next", "aria-label": "Next page", text: "Next ›" })),
          h("div", { class: "pr-warn", id: "pr-warn", hidden: true }),
          h("button", { type: "button", class: "btn primary pr-dl", id: "pr-dl", text: "Download PDF" }),
          h("p", { class: "hint pr-note" }, h("b", { text: "Print at 100% / Actual size" }), ", not Fit to page. Measure the first print: the booklet should be exactly 120 mm across.")))));

  buildPieces();
  const $ = (id) => el.querySelector("#" + id);
  SP.bindSeg($("pr-paper"), () => opts().paper, (v) => save({ paper: v }));
  for (const [id, key] of [["pr-crops", "crops"], ["pr-bleed", "bleed"], ["pr-folds", "folds"], ["pr-whitehole", "whiteHole"], ["pr-fill", "fill"]])
    $(id).addEventListener("change", (ev) => save({ [key]: ev.target.checked }));
  $("pr-layout").addEventListener("change", (ev) => save({ layout: ev.target.value }));
  $("pr-preset").addEventListener("change", (ev) => {
    const p = GRID_PRESETS.find(x => x.id === ev.target.value);
    if (!p) { save({ preset: "custom" }); return; }
    save({ preset: p.id, paper: p.paper, grid: { ...opts().grid, ...p.g } });
  });
  el.querySelectorAll("[data-g]").forEach(inp => inp.addEventListener("input", SP.debounce(() => {
    const v = parseFloat(inp.value); if (!Number.isFinite(v)) return;
    save({ preset: "custom", grid: { ...opts().grid, [inp.dataset.g]: v } });
  }, 250)));
  $("pr-prev").addEventListener("click", () => { pageIdx = Math.max(0, pageIdx - 1); schedulePage(); });
  $("pr-next").addEventListener("click", () => { pageIdx++; schedulePage(); });
  $("pr-dl").addEventListener("click", download);

  const trk = $("pr-trk"), writeTracks = SP.debounce(() => SP.set("tracks", SP.parseTracks(trk.value)), 400);
  trk.addEventListener("input", writeTracks);
  $("pr-demo").addEventListener("click", () => { trk.value = SP.DEMO_TRACKS; SP.set("tracks", SP.parseTracks(trk.value)); SP.toast("Loaded demo tracks"); });

  SP.on(() => { if (visible) refresh(); });
  SP.cover.on(() => { if (visible) { lastThumbKey = ""; refresh(); } });
  if (SP.logo.on) SP.logo.on(() => { if (visible) { lastThumbKey = ""; refresh(); } });
}

function buildPieces() {
  const box = root.querySelector("#pr-pieces");
  for (const P of PIECES) {
    const extra = [];
    if (P.id === "disc") extra.push(numField("discD", "Diameter mm", 0.5), numField("discHole", "Hub hole mm", 0.5));
    if (P.id === "vinyl") extra.push(numField("vinylD", "Diameter mm", 0.5));
    if (P.id === "sticker") extra.push(numField("sticker", "Sticker mm", 1));
    const card = h("div", { class: "pr-card", "data-id": P.id },
      h("button", { type: "button", class: "pr-pick", "aria-pressed": "false", "aria-label": `Print ${P.name}`, onclick: () => togglePiece(P.id) },
        h("span", { class: "pr-thumb" + (P.round ? " round" : "") }, h("canvas", { width: "10", height: "10" })),
        h("span", { class: "pr-tick", "aria-hidden": "true" })),
      h("div", { class: "pr-info" },
        h("b", { text: P.name }), h("span", { class: "pr-size" }), h("p", { class: "hint", text: P.help }),
        h("div", { class: "pr-fields" },
          h("label", { class: "f pr-n" }, h("span", { text: P.id === "sticker" ? "Sheets" : P.id === "vinyl" ? "Sets" : "Copies" }),
            h("input", { type: "number", min: "1", max: "50", step: "1", "data-n": P.id, inputmode: "numeric" })),
          ...extra)));
    box.append(card);
  }
  box.querySelectorAll("[data-n]").forEach(inp => inp.addEventListener("input", SP.debounce(() => {
    const id = inp.dataset.n, cur = opts().pieces[id] || { on: false, n: 1 };
    save({ pieces: { ...opts().pieces, [id]: { ...cur, on: true, n: Math.round(clampN(inp.value, 1, 50, 1)) } } });
  }, 300)));
  box.querySelectorAll("[data-o]").forEach(inp => inp.addEventListener("input", SP.debounce(() => {
    const v = parseFloat(inp.value); if (!Number.isFinite(v)) return;
    save({ [inp.dataset.o]: v });
  }, 350)));
}
function numField(key, label, step) {
  return h("label", { class: "f" }, h("span", { text: label }), h("input", { type: "number", step: String(step), "data-o": key, inputmode: "decimal" }));
}
function togglePiece(id) {
  const o = opts(), cur = o.pieces[id] || { on: false, n: 1 };
  save({ pieces: { ...o.pieces, [id]: { ...cur, on: !cur.on } } });
}

/* sync controls with the record (never clobber a field being typed in) */
function syncControls(o) {
  const active = document.activeElement, set = (inp, v) => { if (inp && inp !== active && String(inp.value) !== String(v)) inp.value = v; };
  const $ = (id) => root.querySelector("#" + id);
  root.querySelectorAll("#pr-paper button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === o.paper)));
  $("pr-crops").checked = o.crops; $("pr-bleed").checked = o.bleed; $("pr-folds").checked = o.folds; $("pr-whitehole").checked = o.whiteHole; $("pr-fill").checked = o.fill;
  $("pr-layout").value = o.layout; $("pr-preset").value = GRID_PRESETS.some(p => p.id === o.preset) ? o.preset : "custom";
  $("pr-grid").hidden = o.layout !== "grid";
  root.querySelectorAll("[data-g]").forEach(inp => set(inp, o.grid[inp.dataset.g]));
  for (const P of PIECES) {
    const card = root.querySelector(`.pr-card[data-id="${P.id}"]`), on = pieceOn(o, P.id);
    card.classList.toggle("on", on); card.querySelector(".pr-pick").setAttribute("aria-pressed", String(on));
    card.querySelector(".pr-size").textContent = sizeText(o, P.id) + (P.round && o.layout === "grid" ? ` (sheet: ${o.grid.d} mm)` : "");
    set(card.querySelector("[data-n]"), copiesOf(o, P.id));
  }
  root.querySelectorAll("[data-o]").forEach(inp => set(inp, o[inp.dataset.o]));
  const db = SP.get(), trk = $("pr-trk");
  if (trk !== active) { const t = SP.tracksToText(db.tracks); if (SP.tracksToText(SP.parseTracks(trk.value)) !== t) trk.value = t; }
  const rt = SP.runtime(db.tracks);
  $("pr-trk-meta").textContent = db.tracks.length ? `${db.tracks.length} tracks${rt ? " · " + SP.fmtTime(rt) : ""}` : "empty";
}

let lastThumbKey = "";
function refresh() {
  const o = opts(); syncControls(o);
  const d = SP.get(), key = JSON.stringify([d.release, d.palette, d.sleeve, d.typeset, d.tracks, o.discD, o.discHole, o.vinylD, o.sticker]);
  if (key !== lastThumbKey) { lastThumbKey = key; scheduleThumbs(); }
  schedulePage();
}

const scheduleThumbs = SP.debounce(() => {
  const my = ++gen;
  q(async () => {
    if (my !== gen || !visible) return;
    const e = await smallEnv(), o = opts();
    for (const P of PIECES) {
      if (my !== gen) return;
      const cv = root.querySelector(`.pr-card[data-id="${P.id}"] canvas`);
      let c;
      if (P.id === "vinyl") c = await Makers.vinyl(e, Makers.vinylSides(e.db)[0], 160);
      else if (P.id === "disc") c = await Makers.disc(e, 160, o.discHole / o.discD);
      else if (P.id === "sticker") c = await stickerThumb(e);
      else c = await artwork(e, P.id, PPM_THUMB, o);
      cv.width = c.width; cv.height = c.height; cv.getContext("2d").drawImage(c, 0, 0);
      await new Promise(r => setTimeout(r, 0));
    }
  });
}, 250);
async function stickerThumb(e) {
  const one = await Makers.cover(e, 60), c = mk(160, 160), x = c.getContext("2d");
  x.fillStyle = "#f4f1ea"; x.fillRect(0, 0, 160, 160);
  for (let r = 0; r < 2; r++) for (let k = 0; k < 2; k++) x.drawImage(one, 14 + k * 72, 14 + r * 72, 60, 60);
  return c;
}

let pageGen = 0;
const schedulePage = SP.debounce(() => {
  const my = ++pageGen;
  q(async () => {
    if (my !== pageGen || !visible) return;
    const o = opts(), db = SP.get(), L = layout(o, db), cvs = root.querySelector("#pr-page");
    const info = root.querySelector("#pr-pageinfo"), warn = root.querySelector("#pr-warn"), dl = root.querySelector("#pr-dl");
    warn.hidden = !L.warn.length; warn.textContent = L.warn.join(" ");
    dl.disabled = !L.pages.length;
    root.querySelector("#pr-roundopts").classList.toggle("dim", !pieceOn(o, "disc") && !pieceOn(o, "vinyl"));
    if (!L.pages.length) {
      info.textContent = "nothing picked"; pageIdx = 0;
      const pg = { w: PAPER[o.paper].w, h: PAPER[o.paper].h, ops: [{ t: "text", s: "Pick a piece to print", x: 72, y: 140, size: 14, gray: 0.6 }] };
      drawPage(cvs, pg, new Map(), PPM_PREVIEW); toggles(0, 1); return;
    }
    pageIdx = Math.min(pageIdx, L.pages.length - 1);
    const page = L.pages[pageIdx], need = new Map();
    for (const op of page.ops) if (op.key) need.set(op.key, L.jobs.get(op.key));
    const cv = await renderJobs({ jobs: need }, await smallEnv(), o, PPM_PREVIEW);
    if (my !== pageGen) return;
    drawPage(cvs, page, cv, PPM_PREVIEW);
    info.textContent = `page ${pageIdx + 1} of ${L.pages.length} · ${PAPER[o.paper].label}`;
    toggles(pageIdx, L.pages.length);
  });
}, 200);
function toggles(i, n) { root.querySelector("#pr-prev").disabled = i <= 0; root.querySelector("#pr-next").disabled = i >= n - 1; }

let busy = false;
async function download() {
  if (busy) return; busy = true;
  const btn = root.querySelector("#pr-dl"); btn.disabled = true; btn.textContent = "Rendering at 300 dpi…";
  try {
    await new Promise(r => setTimeout(r, 30));
    const res = await buildPdf(opts());
    if (!res) { SP.toast("Pick at least one piece first"); return; }
    SP.download(res.blob, res.name, "application/pdf");
    SP.toast(`Saved ${res.name} (${res.pages} page${res.pages > 1 ? "s" : ""})`);
  } catch (err) { console.error(err); SP.toast("Couldn't make the PDF: " + err.message); }
  finally { busy = false; btn.disabled = false; btn.textContent = "Download PDF"; }
}

App.view("print", {
  label: "Print",
  mount,
  show() { visible = true; refresh(); },
  hide() { visible = false; },
});

/* for tests and other views */
window.PrintSheet = { layout: (o) => layout({ ...opts(), ...(o || {}) }, SP.get()), buildPdf: (o) => buildPdf({ ...opts(), ...(o || {}) }), PIECES, PAPER, GRID_PRESETS };
})();
