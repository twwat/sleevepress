/* Sleeve Press: everything that turns the release into a picture other than the front sleeve itself.
   Print pieces (CD booklet, tray inlay, disc and vinyl labels) and promo designs (post, story, thumbnail,
   video frame, banner, teaser). Every maker takes an env { db, st, image, logo } and returns a canvas. */
(function () {
"use strict";
const SR = SleeveRender, TR = TracklistRender, { rgba, hexToRgb } = SP;

function env(db, image, logo) { const st = SR.flatten(db); st.paletteName = db.palette.name; return { db, st, image, logo }; }
const mk = (w, h) => { const c = document.createElement("canvas"); c.width = Math.round(w); c.height = Math.round(h); return c; };
const cols = (st) => ({ bg: hexToRgb(st.bg) || [21, 18, 15], ink: hexToRgb(st.ink) || [236, 230, 218], spot: hexToRgb(st.accent) || [155, 27, 30] });
const titleOneLine = (st) => SR.applyCase(st.title.split("\n").map(x => x.trim()).filter(Boolean).join(" "), st.titleCase);
const titleLines = (st) => st.title.split("\n").map(x => x.trim()).filter(Boolean).map(l => SR.applyCase(l, st.titleCase));
const bodyOf = (st) => st.bodyFont || st.font;

/* Text set at a size that fits maxW; align l|c|r around x. Returns { w, size }. */
function put(ctx, txt, x, y, size, face, weight, track, colour, alpha = 1, maxW = Infinity, align = "l", stroke) {
  if (!txt) return { w: 0, size };
  ctx.font = `${SR.weightFor(face, weight)} ${size}px ${SR.faceStack(face)}`;
  let w = SR.measureTracked(ctx, txt, track, size);
  if (w > maxW) { size *= maxW / w; ctx.font = `${SR.weightFor(face, weight)} ${size}px ${SR.faceStack(face)}`; w = SR.measureTracked(ctx, txt, track, size); }
  ctx.fillStyle = rgba(colour, alpha); ctx.strokeStyle = rgba(colour, alpha);
  SR.drawTracked(ctx, txt, align === "c" ? x - w / 2 : align === "r" ? x - w : x, y, track, size, stroke);
  return { w, size };
}
/* Like put, but shrinks at most to minK of the size and then cuts the text short with an ellipsis. */
function putClip(ctx, txt, x, y, size, face, weight, track, colour, alpha, maxW, minK = 0.8) {
  if (!txt) return;
  const w = (t, s) => { ctx.font = `${SR.weightFor(face, weight)} ${s}px ${SR.faceStack(face)}`; return SR.measureTracked(ctx, t, track, s); };
  let s = size, full = w(txt, size);
  if (full > maxW) s = Math.max(size * minK, size * maxW / full);
  let t = txt;
  while (t.length > 1 && w(t, s) > maxW) t = t.slice(0, -2).trimEnd() + "…";
  put(ctx, t, x, y, s, face, weight, track, colour, alpha, maxW);
}
function ground(ctx, W, H, st, k = 0.6, shape = false) {
  const { bg, ink, spot } = cols(st);
  ctx.fillStyle = rgba(bg, 1); ctx.fillRect(0, 0, W, H);
  SR.drawBackdrop(ctx, W, H, shape ? st : { ...st, shape: "none", pattern: st.patternArea === "edge" ? st.pattern : "none" }, bg, ink, spot, k);   // patterns only as an edge border: they would sit behind words here
}
function finish(ctx, W, H, st, frame = false) {
  const { bg, ink, spot } = cols(st);
  SR.applyVignette(ctx, W, H, { vignette: Math.round(st.vignette * 0.6) }, bg, ink);
  if (frame) SR.drawFrame(ctx, W, H, st, ink, spot);
  SR.applyGrain(ctx, W, H, st.grain * 0.8, Math.min(W, H));
}
function shadow(ctx, x, y, w, h, s) {
  ctx.save(); ctx.shadowColor = "rgba(0,0,0,.55)"; ctx.shadowBlur = s; ctx.shadowOffsetY = s * 0.35;
  ctx.fillStyle = "#000"; ctx.fillRect(x, y, w, h); ctx.restore();
}
function rotatedText(ctx, txt, cx, cy, angle, size, face, weight, track, colour, alpha, maxW) {
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(angle);
  put(ctx, txt, 0, size * 0.36, size, face, weight, track, colour, alpha, maxW, "c"); ctx.restore();
}

/* ---------- the basics ---------- */
async function cover(e, size) { const c = mk(size, size); await SR.render(c, e.st, e.image, e.logo); return c; }
async function back(e, size) { const [w, h] = TR.dims(TR.settings(e.db).layout, size); const c = mk(w, h); await TR.render(c, e.db, e.image); return c; }
/* The back sleeve forced square: the 4:5 "card" layout would be squashed into a square panel. */
async function squareBack(e, size) {
  if (TR.settings(e.db).layout !== "card") return back(e, size);
  const db = SP.clone(e.db); db.typeset = { ...db.typeset, layout: "back" }; return back({ ...e, db }, size);
}
/* A back panel drawn square, with no frame/vignette/grain of its own, for pieces that frame the whole sheet. */
async function bareBack(e, size) {
  const db = SP.clone(e.db); db.sleeve = { ...db.sleeve, frame: false, vignette: 0, grain: 0 }; db.typeset = { ...db.typeset, layout: db.typeset.layout === "card" ? "back" : db.typeset.layout };
  const c = mk(size, size); await TR.render(c, db, e.image); return c;
}

/* ---------- print pieces (sizes in mm, drawn at px per mm) ---------- */
const PRINT = {
  booklet: { w: 120, h: 120, label: "CD front insert" },
  booklet2: { w: 240, h: 120, label: "CD front insert, folded", folds: [[120, 0, 120, 120]] },
  inlay: { w: 151, h: 118, label: "CD back insert", folds: [[6.5, 0, 6.5, 118], [144.5, 0, 144.5, 118]] },
  wallet: { w: 250, h: 125, label: "Card wallet sleeve", folds: [[125, 0, 125, 125]] },
};
async function booklet2(e, ppm, wmm = 120) {
  const S = wmm * ppm, c = mk(S * 2, S), ctx = c.getContext("2d");
  ctx.drawImage(await squareBack(e, S), 0, 0, S, S);
  ctx.drawImage(await cover(e, S), S, 0, S, S);
  return c;
}
async function inlay(e, ppm) {
  const W = 151 * ppm, H = 118 * ppm, sp = 6.5 * ppm, c = mk(W, H), ctx = c.getContext("2d"), st = e.st, { bg, ink, spot } = cols(st);
  ground(ctx, W, H, st, 0.45);
  const panelW = W - sp * 2, sq = H;
  ctx.drawImage(await bareBack(e, sq), sp + (panelW - sq) / 2, 0, sq, sq);
  // the back panel's frame, inside the spines
  ctx.save(); ctx.translate(sp, 0); SR.drawFrame(ctx, panelW, H, st, ink, spot); ctx.restore();
  // spines: left reads bottom-to-top, right top-to-bottom
  const spine = [st.artist.toUpperCase(), titleOneLine(st), (st.catalog || "").toUpperCase()].filter(Boolean).join("   ·   ");
  for (const [x, a] of [[sp / 2, -Math.PI / 2], [W - sp / 2, Math.PI / 2]]) {
    ctx.fillStyle = rgba(spot, 0.0); rotatedText(ctx, spine, x, H / 2, a, sp * 0.42, bodyOf(st), "700", 0.18, ink, 0.92, H * 0.88);
  }
  ctx.strokeStyle = rgba(ink, 0.18); ctx.lineWidth = Math.max(1, ppm * 0.1);
  ctx.beginPath(); ctx.moveTo(sp, 0); ctx.lineTo(sp, H); ctx.moveTo(W - sp, 0); ctx.lineTo(W - sp, H); ctx.stroke();
  SR.applyGrain(ctx, W, H, st.grain * 0.7, H);
  return c;
}
async function wallet(e, ppm) { return booklet2(e, ppm, 125); }

/* Round labels. kind: "vinyl" (type label, one per side) | "disc" (CD face, artwork). Square canvas, nothing cut:
   the PDF clips the circle and marks the hole, so the JPEG never carries transparency. hole = hole diameter / label diameter. */
async function vinyl(e, side, D) {
  const st = e.st, d = e.db, c = mk(D, D), ctx = c.getContext("2d"), { bg, ink, spot } = cols(st);
  await SR.loadFonts(st);
  const r = D / 2, cx = r, cy = r, bfn = bodyOf(st);
  ctx.fillStyle = rgba(bg, 1); ctx.fillRect(0, 0, D, D);
  SR.drawBackdrop(ctx, D, D, { ...st, shape: "none", pattern: "none" }, bg, ink, spot, 0.7);
  ctx.strokeStyle = rgba(ink, 0.22); ctx.lineWidth = D * 0.003; ctx.beginPath(); ctx.arc(cx, cy, r * 0.93, 0, Math.PI * 2); ctx.stroke();
  ctx.textBaseline = "alphabetic";
  put(ctx, SR.applyCase(st.artist, st.artistCase || "upper"), cx, D * 0.25, D * 0.034, st.artistFont || bfn, "700", 0.3, ink, 1, D * 0.5, "c");
  put(ctx, titleOneLine(st), cx, D * 0.34, D * 0.07, st.font, "700", -0.01, ink, 1, D * 0.66, "c");
  put(ctx, `SIDE ${side}`, cx, cy + D * 0.1, D * 0.04, st.font, "700", 0.1, spot, 1, D * 0.2, "c");
  const rpm = d.release.format === "Single" ? "45 RPM" : "33⅓ RPM";
  put(ctx, rpm, cx - D * 0.2, cy + D * 0.007, D * 0.02, bfn, "600", 0.2, ink, 0.6, D * 0.2, "c");
  put(ctx, (st.catalog || "").toUpperCase(), cx + D * 0.2, cy + D * 0.007, D * 0.02, bfn, "600", 0.2, ink, 0.6, D * 0.2, "c");
  const g = TR.sidesOf(d.tracks, "sides").find(x => x.side === side), rows = g ? g.rows : [];
  const ls = Math.min(D * 0.022, (D * 0.17) / Math.max(1, rows.length));
  rows.forEach(({ t }, i) => put(ctx, `${side}${i + 1}  ${t.title.toUpperCase()}${t.length ? "  " + t.length : ""}`, cx, cy + D * 0.17 + i * ls * 1.5, ls, bfn, "600", 0.08, ink, 0.85, D * 0.56, "c"));
  const foot = [st.year.trim() ? `℗ ${st.year.trim()} ${st.label || st.artist}` : (st.label || st.artist), "ALL RIGHTS RESERVED"].join("  ·  ").toUpperCase();
  put(ctx, foot, cx, D * 0.86, D * 0.014, bfn, "600", 0.18, ink, 0.5, D * 0.5, "c");
  if (st.labelMark !== "none") SR.drawLabelMark(ctx, D, { ...st, labelSize: st.labelSize * 1.6 }, cx, D * 0.15, st.labelColor === "accent" ? spot : ink, bfn, e.logo);
  SR.applyGrain(ctx, D, D, st.grain * 0.7, D);
  return c;
}
const vinylSides = (db) => { const g = TR.sidesOf(db.tracks, "sides").map(x => x.side); return g.length ? g : ["A", "B"]; };
/* Transparent PNG version for the export (outside and hole cut away). */
async function vinylPng(e, side, D, hole = 0.0724) {
  const c = await vinyl(e, side, D), o = mk(D, D), ctx = o.getContext("2d");
  ctx.beginPath(); ctx.arc(D / 2, D / 2, D / 2, 0, Math.PI * 2); ctx.clip(); ctx.drawImage(c, 0, 0);
  ctx.globalCompositeOperation = "destination-out"; ctx.beginPath(); ctx.arc(D / 2, D / 2, D * hole / 2, 0, Math.PI * 2); ctx.fill();
  return o;
}
async function disc(e, D, hole = 41 / 117) {
  const st = e.st, c = mk(D, D), ctx = c.getContext("2d"), { bg, ink, spot } = cols(st);
  // The cover's own look, but with the words moved clear of the hub: artist near the top, title as one line near the bottom.
  const discSt = { ...st, title: titleOneLine(st), titleCase: "asis", titlePos: "lower", titleDy: 7, titleSize: Math.min(st.titleSize, 80), titleX: 0, titleAlign: "centre",
    align: "centre", margin: 19, artistY: 17, artistX: 0, artistAlign: "centre", artistRotate: "none", year: "", motifKind: "none", footer: "",
    barcode: false, plate: false, labelMark: "none", frame: false, vignette: 0, titleRotate: "none", titleBleed: false };
  ctx.drawImage(await cover({ ...e, st: discSt }, D), 0, 0);
  // a quiet ring of ground round the hub, with the catalogue set round it
  const r = D / 2, hubR = D * hole / 2, ringR = hubR + D * 0.075;
  ctx.fillStyle = rgba(bg, 0.92); ctx.beginPath(); ctx.arc(r, r, ringR, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = rgba(ink, 0.35); ctx.lineWidth = D * 0.002; ctx.beginPath(); ctx.arc(r, r, ringR, 0, Math.PI * 2); ctx.stroke();
  const txt = [st.catalog, st.year, st.label].filter(x => x && x.trim()).join("  ·  ").toUpperCase();
  if (txt) {
    const fs = D * 0.017; ctx.font = `${SR.weightFor(bodyOf(st), "600")} ${fs}px ${SR.faceStack(bodyOf(st))}`; ctx.fillStyle = rgba(ink, 0.8);
    const rr = hubR + D * 0.04; let ang = Math.PI / 2 + (SR.measureTracked(ctx, txt, 0.2, fs) / rr) / 2;
    for (const ch of txt) {
      const w = ctx.measureText(ch).width + fs * 0.2;
      ctx.save(); ctx.translate(r + Math.cos(ang - w / rr / 2) * rr, r + Math.sin(ang - w / rr / 2) * rr); ctx.rotate(ang - w / rr / 2 - Math.PI / 2);
      ctx.fillText(ch, -ctx.measureText(ch).width / 2, fs * 0.35); ctx.restore(); ang -= w / rr;
    }
  }
  return c;
}

/* ---------- promo ---------- */
const PROMO = [
  { id: "post", w: 1080, h: 1350, label: "Release post", use: "Instagram / Facebook feed (4:5): the cover with a date-and-links strip under it." },
  { id: "story", w: 1080, h: 1920, label: "Story", use: "Instagram / TikTok story (9:16): cover, tracklist and a link sticker spot." },
  { id: "thumb", w: 1280, h: 720, label: "YouTube thumbnail", use: "YouTube video thumbnail: big title that still reads when tiny." },
  { id: "video", w: 1920, h: 1080, label: "Video still", use: "The still image for a full-release YouTube upload, with timestamps." },
  { id: "banner", w: 1500, h: 500, label: "Header banner", use: "X / Bandcamp / SoundCloud header (3:1). Left side kept clear for your avatar." },
  { id: "teaser", w: 1080, h: 1080, label: "Teaser", use: "Countdown post before release day: the date, big, beside a slice of the art." },
];
const dateLine = (r) => (r.date || "").trim().toUpperCase();
const ctaOf = (r) => (r.cta || "").trim().toUpperCase();
const formatTag = (r) => { const f = (r.format || "").trim().toUpperCase(); return f ? (f === "SINGLE" ? "NEW SINGLE" : `NEW ${f}`) : "NEW MUSIC"; };
/* fg if it reads on bg, else the fallback. */
const legible = (fg, bg, alt, min = 3) => SP.contrast(fg, bg) >= min ? fg : alt;
/* The accent nudged toward the ink until it reads as text on the ground (keeps its hue where it can). */
function lift(spot, bg, ink, min = 3.2) {
  for (let t = 0; t <= 1.001; t += 0.1) { const c = spot.map((v, i) => v + (ink[i] - v) * t); if (SP.contrast(c, bg) >= min) return c; }
  return ink;
}
/* Which of ground/ink reads best on a fill. */
const onFill = (fill, bg, ink) => SP.contrast(bg, fill) >= SP.contrast(ink, fill) ? bg : ink;
function measure(ctx, txt, size, face, weight, track) {
  ctx.font = `${SR.weightFor(face, weight)} ${size}px ${SR.faceStack(face)}`; return SR.measureTracked(ctx, txt, track, size);
}
/* The size at which every line fits maxW, capped at max. */
function fitSize(ctx, lines, max, maxW, face, weight, track) {
  let s = max; for (const l of lines) { const w = measure(ctx, l, max, face, weight, track); if (w > maxW) s = Math.min(s, max * maxW / w); } return s;
}
/* Splits "a · b · c" (or words) into at most n lines that each fit maxW at size. */
function wrap(ctx, txt, maxW, size, face, weight, track, n = 2) {
  if (!txt) return [];
  if (measure(ctx, txt, size, face, weight, track) <= maxW) return [txt];
  const sep = txt.includes(" · ") ? " · " : " ", parts = txt.split(sep), out = []; let cur = "";
  if (n === 2 && parts.length > 1) {   // the split that keeps the longer line shortest
    let best = null;
    for (let i = 1; i < parts.length; i++) {
      const a = parts.slice(0, i).join(sep), b = parts.slice(i).join(sep), w = Math.max(measure(ctx, a, size, face, weight, track), measure(ctx, b, size, face, weight, track));
      if (!best || w < best.w) best = { w, lines: [a, b] };
    }
    return best.lines;
  }
  for (const p of parts) { const t = cur ? cur + sep + p : p; if (cur && measure(ctx, t, size, face, weight, track) > maxW) { out.push(cur); cur = p; } else cur = t; }
  if (cur) out.push(cur);
  if (out.length > n) { const head = out.slice(0, n - 1); head.push(out.slice(n - 1).join(sep)); return head; }
  return out;
}
/* Words split into n lines of about equal length. */
function balance(txt, n) {
  const words = txt.split(/\s+/).filter(Boolean); if (words.length < n) return null;
  const target = txt.length / n, out = []; let cur = "";
  for (const w of words) { if (cur && out.length < n - 1 && (cur + " " + w).length > target * 1.08) { out.push(cur); cur = w; } else cur = cur ? cur + " " + w : w; }
  out.push(cur); return out.length === n ? out : null;
}
/* The title broken the way that sets it biggest in a box: as written, on one line, or rebalanced over 2–3 lines.
   Returns { lines, size } with a line pitch of size * lead. */
function bestLines(ctx, written, one, maxSize, maxW, maxH, face, track, lead = 0.98, maxLines = 3) {
  const cands = [written.length <= maxLines ? written : null, [one], balance(one, 2), maxLines > 2 ? balance(one, 3) : null].filter(c => c && c.length && c.length <= maxLines);
  let best = null;
  for (const lines of cands) {
    const size = Math.min(fitSize(ctx, lines, maxSize, maxW, face, "700", track), maxH / (lines.length * lead));
    if (!best || size > best.size * 1.04) best = { lines, size };
  }
  return best;
}
/* The picture (toned like the sleeve) filling a box; false when there is none. */
function picture(ctx, e, x, y, w, h, blur = 0) {
  const t = SR.toned(e.image, e.st); if (!t) return false;
  ctx.save(); if (blur) ctx.filter = `blur(${blur}px)`;
  SR.drawCover(ctx, t, x, y, w, h, { zoom: 100, shiftX: e.st.shiftX, shiftY: e.st.shiftY }); ctx.restore(); return true;
}

/* scale < 1 draws the same design smaller (previews). */
async function promo(e, id, scale = 1) {
  const P = PROMO.find(p => p.id === id); if (!P) throw new Error("unknown promo " + id);
  const W = Math.round(P.w * scale), H = Math.round(P.h * scale), c = mk(W, H), ctx = c.getContext("2d");
  const st = e.st, r = e.db.release, { bg, ink, spot } = cols(st), bfn = bodyOf(st), afn = st.artistFont || bfn;
  await SR.loadFonts(st); ctx.textBaseline = "alphabetic";
  const artist = SR.applyCase(st.artist, st.artistCase || "upper"), title = titleOneLine(st), tl = titleLines(st);
  const tracks = e.db.tracks, tk = st.tracking / 100;
  const hi = lift(spot, bg, ink);             // accent text on the ground
  const date = dateLine(r), cta = ctaOf(r), tag = formatTag(r), links = (r.links || "").trim().toUpperCase();

  if (id === "post") {
    // the cover full-bleed on top, an info strip below: call to action left, date and links right
    ctx.fillStyle = rgba(bg, 1); ctx.fillRect(0, 0, W, H);
    ctx.drawImage(await cover(e, W), 0, 0);
    const sy = W, sh = H - W, m = W * 0.06, split = W * 0.58;
    ctx.fillStyle = rgba(bg, 1); ctx.fillRect(0, sy, W, sh);
    ctx.save(); ctx.beginPath(); ctx.rect(0, sy, W, sh); ctx.clip();
    SR.drawBackdrop(ctx, W, H, { ...st, shape: "none", pattern: "none" }, bg, ink, spot, 0.35); ctx.restore();
    ctx.fillStyle = rgba(spot, 1); ctx.fillRect(0, sy, W, Math.max(4, H * 0.006));
    const big = cta || tag, colW = split - m * 1.5;
    if (cta && tag !== cta) put(ctx, tag, m, sy + sh * 0.3, sh * 0.075, bfn, "700", 0.3, ink, 0.7, colW);
    const bs = fitSize(ctx, [big], sh * 0.4, colW, st.font, "700", tk);
    put(ctx, big, m - bs * 0.03, sy + sh * (cta && tag !== cta ? 0.74 : 0.66), bs, st.font, "700", tk, hi, 1, colW);
    ctx.fillStyle = rgba(ink, 0.22); ctx.fillRect(split, sy + sh * 0.2, Math.max(1, W * 0.0015), sh * 0.6);
    const R = W - m, rw = R - split - m * 0.8;
    const info = date || links ? [[date, 0.17, 1], ...wrap(ctx, links, rw, sh * 0.075, bfn, "600", 0.16, 2).map(l => [l, 0.075, 0.7])].filter(x => x[0])
      : [[artist, 0.08, 0.75], [title, 0.13, 1]];
    const sizes = info.map(([t, k]) => Math.min(sh * k, sh * k * rw / Math.max(1, measure(ctx, t, sh * k, k > 0.1 ? st.font : bfn, "700", 0.16))));
    const total = sizes.reduce((a, s) => a + s * 1.35, 0); let y = sy + sh / 2 - total / 2;
    info.forEach(([t, k, a], i) => { y += sizes[i] * 1.35; put(ctx, t, R, y - sizes[i] * 0.3, sizes[i], k > 0.1 ? st.font : bfn, "700", k > 0.1 ? tk : 0.16, ink, a, rw, "r"); });
    SR.applyGrain(ctx, W, H, st.grain * 0.8, W);
  }

  else if (id === "story") {
    ctx.fillStyle = rgba(bg, 1); ctx.fillRect(0, 0, W, H);
    if (picture(ctx, e, -W * 0.1, -H * 0.05, W * 1.2, H * 1.1, W * 0.035)) { ctx.fillStyle = rgba(bg, 0.7); ctx.fillRect(0, 0, W, H); }
    else SR.drawBackdrop(ctx, W, H, st, bg, ink, spot, 0.7);
    const m = W * 0.09, cw = W - m * 2;
    // header (below the app's own top bar): tag + date, then the call to action
    const hy = H * 0.085;
    put(ctx, tag, m, hy, W * 0.03, bfn, "700", 0.3, ink, 0.8, cw * 0.55);
    put(ctx, date, W - m, hy, W * 0.03, bfn, "700", 0.3, ink, 0.8, cw * 0.42, "r");
    const big = cta || title, bs = fitSize(ctx, [big], W * 0.11, cw, st.font, "700", tk);
    put(ctx, big, m - bs * 0.03, hy + W * 0.025 + bs * 0.86, bs, st.font, "700", tk, hi, 1, cw);
    const cy = hy + W * 0.06 + bs, cv = Math.min(cw, H * (tracks.length ? 0.33 : 0.43));
    const cx = (W - cv) / 2;
    shadow(ctx, cx, cy, cv, cv, W * 0.05); ctx.drawImage(await cover(e, cv), cx, cy);
    // words + tracklist, between the cover and the link sticker
    const pillH = H * 0.055, pillY = H * 0.82;
    let y = cy + cv + H * 0.045;
    put(ctx, artist, m, y, W * 0.03, afn, "700", 0.3, ink, 0.8, cw);
    const { lines: tls, size: ts } = bestLines(ctx, tl, title, W * 0.075, cw, W * 0.16, st.font, tk, 1.0);
    tls.forEach((l) => { y += ts * 1.0; put(ctx, l, m - ts * 0.03, y, ts, st.font, "700", tk, ink, 1, cw); });
    const top = y + H * 0.03, avail = pillY - H * 0.03 - top;
    if (tracks.length && avail > W * 0.05) {
      ctx.fillStyle = rgba(ink, 0.25); ctx.fillRect(m, top - H * 0.012, cw, Math.max(1, W * 0.002));
      const two = tracks.length > 5, perCol0 = two ? Math.ceil(tracks.length / 2) : tracks.length;
      let pitch = Math.min(W * 0.05, avail / perCol0), shown = tracks.length;
      const minPitch = W * 0.033;
      if (pitch < minPitch) { pitch = minPitch; shown = Math.max(1, Math.floor(avail / pitch) * (two ? 2 : 1) - 1); }
      const perCol = two ? Math.ceil(shown / 2) : shown, colW = two ? (cw - W * 0.04) / 2 : cw, fs = pitch * 0.5;
      const numW = measure(ctx, "00", fs, bfn, "700", 0.1) + fs * 0.8;
      tracks.slice(0, shown).forEach((t, i) => {
        const col = two && i >= perCol ? 1 : 0, xx = m + col * (colW + W * 0.04), yy = top + (i - col * perCol + 0.75) * pitch;
        put(ctx, String(i + 1).padStart(2, "0"), xx, yy, fs, bfn, "700", 0.1, hi, 1);
        putClip(ctx, t.title.toUpperCase(), xx + numW, yy, fs, bfn, "600", 0.08, ink, 0.88, colW - numW);
      });
      if (shown < tracks.length) put(ctx, `+ ${tracks.length - shown} MORE`, two ? m + colW + W * 0.04 : m, top + (perCol + (two ? 0 : 0) + 0.75) * pitch - (two ? pitch : 0), fs * 0.9, bfn, "700", 0.2, ink, 0.5);
    }
    // link sticker spot
    const label = links || "LINK IN BIO", ls = Math.min(pillH * 0.34, pillH * 0.34 * (cw - pillH) / Math.max(1, measure(ctx, label, pillH * 0.34, bfn, "700", 0.2)));
    const pw = Math.min(cw, measure(ctx, label, ls, bfn, "700", 0.2) + pillH * 1.2), px = (W - pw) / 2;
    ctx.fillStyle = rgba(spot, 1); ctx.beginPath(); ctx.roundRect ? ctx.roundRect(px, pillY, pw, pillH, pillH / 2) : ctx.rect(px, pillY, pw, pillH); ctx.fill();
    put(ctx, label, W / 2, pillY + pillH / 2 + ls * 0.36, ls, bfn, "700", 0.2, onFill(spot, bg, ink), 1, pw - pillH * 0.8, "c");
    finish(ctx, W, H, st);
  }

  else if (id === "thumb") {
    ground(ctx, W, H, st, 0.7);
    const cv = H * 0.8, cx = W - cv - H * 0.1, cy = (H - cv) / 2;
    ctx.fillStyle = rgba(spot, 1); ctx.fillRect(cx + cv * 0.12, cy - H * 0.03, W - cx, cv + H * 0.06);
    ctx.save(); ctx.translate(cx + cv / 2, cy + cv / 2); ctx.rotate(-0.045);
    shadow(ctx, -cv / 2, -cv / 2, cv, cv, H * 0.05); ctx.drawImage(await cover(e, cv), -cv / 2, -cv / 2); ctx.restore();
    const m = W * 0.05, maxW = cx - m * 1.6;
    const bs = H * 0.04, tw = measure(ctx, tag, bs, bfn, "700", 0.2);
    ctx.fillStyle = rgba(spot, 1); ctx.fillRect(m, H * 0.1, tw + bs * 1.2, bs * 1.8);
    put(ctx, tag, m + bs * 0.6, H * 0.1 + bs * 1.27, bs, bfn, "700", 0.2, onFill(spot, bg, ink));
    put(ctx, artist, m, H * 0.3, H * 0.055, afn, "700", 0.24, ink, 0.85, maxW);
    // title: as many lines as it has (max 3), as big as the room allows
    const { lines, size: fs } = bestLines(ctx, tl, title, H * 0.2, maxW, H * 0.46, st.font, tk, 0.98);
    const y0 = H * 0.33 + (H * 0.46 - lines.length * fs * 0.98) / 2;
    lines.forEach((l, i) => put(ctx, l, m - fs * 0.03, y0 + fs * (i * 0.98 + 0.86), fs, st.font, "700", tk, ink, 1, maxW));
    put(ctx, [cta, date].filter(Boolean).join("  ·  "), m, H * 0.9, H * 0.042, bfn, "700", 0.22, hi, 1, maxW);
    finish(ctx, W, H, st);
  }

  else if (id === "video") {
    ground(ctx, W, H, st, 0.5);
    const many = tracks.length > 12, cv = H * (many ? 0.64 : 0.74), m = (H - cv) / 2, cx = many ? H * 0.1 : m * 1.3;
    shadow(ctx, cx, m, cv, cv, H * 0.04); ctx.drawImage(await cover(e, cv), cx, m);
    const x = cx + cv + W * (many ? 0.04 : 0.05), R = W - (many ? H * 0.1 : m * 1.3), maxW = R - x;
    put(ctx, artist, x, m + H * 0.035, H * 0.03, afn, "700", 0.3, ink, 1, maxW);
    const { lines, size: ts } = bestLines(ctx, tl, title, H * 0.07, maxW, H * 0.13, st.font, tk, 1.0, 2);
    lines.forEach((l, i) => put(ctx, l, x - ts * 0.03, m + H * 0.045 + ts * (i + 0.9), ts, st.font, "700", tk, ink, 1, maxW));
    const ry = m + H * 0.075 + ts * lines.length;
    ctx.strokeStyle = rgba(ink, 0.3); ctx.lineWidth = Math.max(1, H * 0.002); ctx.beginPath(); ctx.moveTo(x, ry); ctx.lineTo(R, ry); ctx.stroke();
    const rows = chapters(tracks), top = ry + H * 0.06, avail = m + cv - H * 0.04 - top;
    const twoCol = rows.length > 12, perCol = twoCol ? Math.ceil(rows.length / 2) : rows.length;
    const pitch = Math.min(H * 0.05, avail / Math.max(1, perCol)), fs = pitch * 0.5, colW = twoCol ? (maxW - W * 0.02) / 2 : maxW;
    const numWs = [0, 1].map(col => Math.max(measure(ctx, "00", fs * 0.85, bfn, "600", 0.1), ...rows.filter((_, i) => (twoCol && i >= perCol ? 1 : 0) === col).map(r => measure(ctx, r.at, fs * 0.85, bfn, "600", 0.1))) + fs * 1.1);
    rows.forEach((row, i) => {
      const col = twoCol && i >= perCol ? 1 : 0, yy = top + (i - col * perCol) * pitch, xx = x + col * (colW + W * 0.02), numW = numWs[col];
      put(ctx, row.at || String(i + 1).padStart(2, "0"), xx, yy, fs * 0.85, bfn, "600", 0.1, hi, 1);
      putClip(ctx, row.title.toUpperCase(), xx + numW, yy, fs, bfn, "700", 0.04, ink, 0.92, colW - numW - fs * 0.5, 0.75);
    });
    if (!rows.length) {   // no tracklist: the release-day words instead
      let y = top + H * 0.05;
      const big = cta || tag; put(ctx, big, x - H * 0.003, y, H * 0.07, st.font, "700", tk, hi, 1, maxW);
      if (date) { y += H * 0.07; put(ctx, date, x, y, H * 0.04, st.font, "700", tk, ink, 1, maxW); }
      wrap(ctx, links, maxW, H * 0.024, bfn, "600", 0.2, 2).forEach(l => { y += H * 0.05; put(ctx, l, x, y, H * 0.024, bfn, "600", 0.2, ink, 0.7, maxW); });
    }
    put(ctx, [st.label, st.catalog, st.year].filter(v => v && v.trim()).join("  ·  ").toUpperCase(), x, m + cv, H * 0.02, bfn, "600", 0.24, ink, 0.55, maxW);
    finish(ctx, W, H, st);
  }

  else if (id === "banner") {
    ground(ctx, W, H, st, 0.6);
    // right half: the picture fading in from the left (or the title, outlined and huge)
    const zx = W * 0.5, zw = W - zx, z = mk(zw, H), zc = z.getContext("2d");
    if (picture(zc, e, 0, 0, zw, H)) {
      zc.fillStyle = rgba(bg, 0.35); zc.fillRect(0, 0, zw, H);
    } else {
      const big = H * 0.9; zc.lineWidth = Math.max(1.5, big * 0.012); zc.strokeStyle = rgba(ink, 0.16);
      zc.font = `${SR.weightFor(st.font, "700")} ${big}px ${SR.faceStack(st.font)}`;
      const word = (tl[0] || artist) + " ", ww = SR.measureTracked(zc, word, 0, big) || zw;
      for (let x = -ww * 0.15; x < zw; x += ww) SR.drawTracked(zc, word, x, H * 0.82, 0, big, true);
    }
    zc.globalCompositeOperation = "destination-in";
    const g = zc.createLinearGradient(0, 0, zw * 0.6, 0); g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,1)");
    zc.fillStyle = g; zc.fillRect(0, 0, zw, H);
    ctx.drawImage(z, zx, 0);
    const cv = H * 0.66, cy = (H - cv) / 2, cx = W - cv - H * 0.22;
    shadow(ctx, cx, cy, cv, cv, H * 0.05); ctx.drawImage(await cover(e, cv), cx, cy);
    // words, centred vertically, starting a third of the way in (the avatar sits bottom-left)
    const x = W * 0.33, maxW = cx - x - H * 0.14;
    const { lines, size: ts } = bestLines(ctx, tl, title, H * 0.13, maxW, H * 0.3, st.font, tk, 0.98);
    const as = Math.min(H * 0.05, ts * 0.45), cs = H * 0.04, foot = [cta, date].filter(Boolean).join("  ·  ");
    const blockH = as * 1.5 + lines.length * ts * 0.98 + (foot ? cs * 2.3 : 0);
    let y = H / 2 - blockH / 2 + as;
    ctx.fillStyle = rgba(spot, 1); ctx.fillRect(x - H * 0.06, H / 2 - blockH / 2 - as * 0.1, Math.max(3, H * 0.008), blockH);
    put(ctx, artist, x, y, as, afn, "700", 0.3, ink, 0.85, maxW); y += as * 0.5;
    lines.forEach(l => { y += ts * 0.98; put(ctx, l, x - ts * 0.03, y, ts, st.font, "700", tk, ink, 1, maxW); });
    if (foot) put(ctx, foot, x, y + cs * 2.1, cs, bfn, "700", 0.22, hi, 1, maxW);
    finish(ctx, W, H, st, true);
  }

  else if (id === "teaser") {
    // a tall slice of the art on the left, the date set huge on the right
    ground(ctx, W, H, st, 0.5);
    const sw = Math.round(W * 0.38);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, sw, H); ctx.clip();
    if (!picture(ctx, e, 0, 0, sw, H)) ctx.drawImage(await cover(e, H), -H * 0.04, 0);
    ctx.restore();
    ctx.fillStyle = rgba(spot, 1); ctx.fillRect(sw, 0, Math.max(4, W * 0.012), H);
    const x = sw + W * 0.08, R = W - W * 0.07, cw = R - x;
    put(ctx, artist, x, H * 0.12, W * 0.028, afn, "700", 0.3, ink, 0.8, cw);
    let words = (date || "SOON").split(/\s+/).filter(Boolean);
    if (words.length > 3) words = [words.slice(0, words.length - 2).join(" "), ...words.slice(-2)];
    const ds = words.map(w => Math.min(H * 0.24, H * 0.24 * cw / Math.max(1, measure(ctx, w, H * 0.24, st.font, "700", tk))));
    const total = ds.reduce((a, s) => a + s * 0.9, 0), scale = Math.min(1, (H * 0.58) / total);
    let y = H * 0.17 + (H * 0.58 - total * scale) / 2;
    words.forEach((w, i) => { const s = ds[i] * scale; y += s * 0.9; put(ctx, w, x - s * 0.04, y - s * 0.06, s, st.font, "700", tk, /\d/.test(w) ? hi : ink, 1, cw); });
    put(ctx, [tag, cta].filter(Boolean).join("  ·  "), x, H * 0.82, W * 0.026, bfn, "700", 0.26, hi, 1, cw);
    put(ctx, title, x, H * 0.89, W * 0.05, st.font, "700", tk, ink, 1, cw);
    finish(ctx, W, H, st);
  }
  return c;
}

/* Timestamps for a full-release upload: cumulative start times when every track has a length. */
function chapters(tracks) {
  const all = tracks.length && tracks.every(t => SP.secs(t.length));
  let at = 0;
  return tracks.map(t => { const row = { title: t.title + (t.feat ? ` (feat. ${t.feat})` : ""), at: all ? SP.fmtTime(at) : "" }; at += SP.secs(t.length); return row; });
}
function chaptersText(db) {
  const rows = chapters(db.tracks), r = db.release;
  if (!rows.length) return "";
  const head = `${r.artist} — ${SP.titleLine(r)}`;
  const timed = rows[0].at !== "";
  // paste-ready: no notes to the user in here (the Export view says when timestamps are missing)
  return [head, "", "Tracklist", ...rows.map((x, i) => timed ? `${x.at.length < 5 ? "0" + x.at : x.at} ${x.title}` : `${i + 1}. ${x.title}`)].join("\n");
}

window.Makers = { env, mk, cover, back, booklet2, inlay, wallet, vinyl, vinylPng, vinylSides, disc, promo, PROMO, PRINT, chapters, chaptersText, put, putClip };
})();
