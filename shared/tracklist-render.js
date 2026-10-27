/* Sleeve Press: tracklist / back-sleeve renderer, shared by Tracklist and Kit.
   Uses the front sleeve's face, palette, grain, vignette and frame so the two always match. */
(function () {
"use strict";
const { rgba, hexToRgb } = SP;
const SR = SleeveRender;

const DEFAULTS = {
  layout: "back",        // back (1:1) | sides (1:1, A/B columns) | card (4:5)
  numbering: "01",       // 01 | 1. | A1
  showFeat: true, showBpm: true, showKey: true, showLength: true, showRuntime: true,
  rules: true, scale: 100,
  credits: "", copyright: true,
  ghost: false, ghostDim: 82, backdrop: true, trackCase: "upper",
  exportSize: "3000", textFormat: "plain",
};
function settings(db) {
  const s = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) if (k in db.typeset && typeof db.typeset[k] === typeof DEFAULTS[k]) s[k] = db.typeset[k];
  return s;
}
function dims(layout, long) { return layout === "card" ? [Math.round(long * 0.8), long] : [long, long]; }

function sidesOf(tracks, layout) {
  const order = []; const map = {};
  tracks.forEach((t, i) => { const s = (t.side || "A").toUpperCase(); if (!map[s]) { map[s] = []; order.push(s); } map[s].push({ t, i }); });
  if (layout === "sides" && order.length === 1 && tracks.length > 1) {
    const half = Math.ceil(tracks.length / 2);
    return [{ side: "A", rows: tracks.slice(0, half).map((t, i) => ({ t, i })) }, { side: "B", rows: tracks.slice(half).map((t, k) => ({ t, i: half + k })) }];
  }
  return order.sort().map(s => ({ side: s, rows: map[s] }));
}
function numberLabel(ts, side, posInSide, idx) {
  if (ts.numbering === "A1") return `${side}${posInSide + 1}`;
  if (ts.numbering === "1.") return `${idx + 1}.`;
  return String(idx + 1).padStart(2, "0");
}
function metaParts(t, ts) {
  const p = [];
  if (ts.showBpm && t.bpm) p.push(`${t.bpm} BPM`);
  if (ts.showKey && t.key) p.push(t.key);
  if (ts.showLength && t.length) p.push(t.length);
  return p;
}

function fitText(ctx, text, maxW, size, track) {
  if (SR.measureTracked(ctx, text, track, size) <= maxW) return text;
  let t = text;
  while (t.length > 1 && SR.measureTracked(ctx, t + "…", track, size) > maxW) t = t.slice(0, -1);
  return t.trimEnd() + "…";
}

async function render(canvas, db, image) {
  const sl = SR.flatten(db), ts = settings(db), tracks = db.tracks;
  const W = canvas.width, H = canvas.height, u = W;
  const ctx = canvas.getContext("2d");
  await SR.loadFonts(sl);
  const bg = hexToRgb(sl.bg) || [21, 18, 15], ink = hexToRgb(sl.ink) || [236, 230, 218];
  const face = SR.faceStack(sl.font);
  const wt = (w) => SR.weightFor(sl.font, w);
  const bodyName = sl.bodyFont || sl.font, bface = SR.faceStack(bodyName), bwt = (w) => SR.weightFor(bodyName, w);
  const spot = hexToRgb(sl.accent) || [155, 27, 30];
  const tc = (s) => ts.trackCase === "asis" ? s : SR.applyCase(s, ts.trackCase === "title" ? "title" : "upper");
  const X = u * (sl.margin || 11) / 100, R = W - X;

  ctx.fillStyle = rgba(bg, 1); ctx.fillRect(0, 0, W, H);
  const timg = ts.ghost ? SR.toned(image, sl) : null;
  if (timg) { SR.drawCover(ctx, timg, 0, 0, W, H, { zoom: sl.zoom, shiftX: sl.shiftX, shiftY: sl.shiftY }); ctx.fillStyle = rgba(bg, ts.ghostDim / 100); ctx.fillRect(0, 0, W, H); }
  if (ts.backdrop) SR.drawBackdrop(ctx, W, H, { ...sl, shape: "none", pattern: sl.patternArea === "edge" ? sl.pattern : "none" }, bg, ink, spot, 0.45);   // the front's wash and texture, quieter; the big shape would sit behind the list
  SR.applyVignette(ctx, W, H, sl, bg, ink);
  SR.drawFrame(ctx, W, H, sl, ink, spot);

  // Head: artist, year, title line, runtime
  ctx.textBaseline = "alphabetic";
  const artistSize = u * 0.0295, afn = sl.artistFont || bodyName;
  ctx.font = `${SR.weightFor(afn, sl.artistWeight || 700)} ${artistSize}px ${SR.faceStack(afn)}`; ctx.fillStyle = rgba(sl.artistColor === "accent" ? spot : ink, 1);
  SR.drawTracked(ctx, SR.applyCase(sl.artist, sl.artistCase || "upper"), X, u * 0.158, 0.32, artistSize);
  if (sl.year.trim()) {
    const ys = u * 0.016; ctx.font = `${bwt("600")} ${ys}px ${bface}`; ctx.fillStyle = rgba(ink, 0.6);
    const w = SR.measureTracked(ctx, sl.year.toUpperCase(), 0.26, ys);
    SR.drawTracked(ctx, sl.year.toUpperCase(), R - w, u * 0.158, 0.26, ys);
  }
  const titleLine = SR.applyCase(sl.title.split("\n").map(s => s.trim()).filter(Boolean).join(" "), sl.titleCase);
  const total = SP.runtime(tracks);
  const runText = ts.showRuntime && tracks.length ? `${tracks.length} TRACK${tracks.length === 1 ? "" : "S"}${total ? "  ·  " + SP.fmtTime(total) : ""}` : "";
  const runSize = u * 0.0165; ctx.font = `${bwt("600")} ${runSize}px ${bface}`;
  const runW = runText ? SR.measureTracked(ctx, runText, 0.22, runSize) : 0;
  let tsz = u * 0.056; const tTrack = -0.01; const titleMax = R - X - (runW ? runW + u * 0.04 : 0);
  ctx.font = `${wt("700")} ${tsz}px ${face}`;
  const tw = SR.measureTracked(ctx, titleLine, tTrack, tsz);
  if (tw > titleMax) tsz *= titleMax / tw;
  const titleY = u * 0.158 + u * 0.082;
  ctx.font = `${wt("700")} ${tsz}px ${face}`; ctx.fillStyle = rgba(ink, 1);
  SR.drawTracked(ctx, titleLine, X, titleY, tTrack, tsz);
  if (runText) {
    ctx.font = `${bwt("600")} ${runSize}px ${bface}`; ctx.fillStyle = rgba(ink, 0.55);
    SR.drawTracked(ctx, runText, R - runW, titleY, 0.22, runSize);
  }
  const ruleY = titleY + u * 0.03;
  ctx.strokeStyle = rgba(ink, 0.3); ctx.lineWidth = Math.max(1, u * 0.0016);
  ctx.beginPath(); ctx.moveTo(X, ruleY); ctx.lineTo(R, ruleY); ctx.stroke();

  // Foot: barcode, footer, credits (credits sit above the footer)
  const footerY = H - u * 0.078;
  let cornerTop = H - u * 0.065, barcodeLeft = R;
  if (sl.barcode) { barcodeLeft = R - SR.barcodeWidth(u, sl); cornerTop = SR.drawBarcode(ctx, u, R, cornerTop, bface, bg, ink, sl, spot); }
  if (sl.footer.trim()) {
    let fs = u * 0.0172; const avail = (sl.barcode ? barcodeLeft - u * 0.03 : R) - X;
    ctx.fillStyle = rgba(ink, 0.58);
    let text = sl.footer.toUpperCase().replace(/\s*·\s*/g, "  ·  "), track = 0.25;
    ctx.font = `${bwt("600")} ${fs}px ${bface}`;
    if (SR.measureTracked(ctx, text, track, fs) > avail) { text = sl.footer.toUpperCase(); track = 0.16; }
    const w = SR.measureTracked(ctx, text, track, fs);
    if (w > avail) { fs *= avail / w; ctx.font = `${bwt("600")} ${fs}px ${bface}`; }
    SR.drawTracked(ctx, text, X, footerY, track, fs);
  }
  const credits = ts.credits.split("\n").map(s => s.trim()).filter(Boolean);
  if (ts.copyright && sl.year.trim()) credits.push(`℗ ${sl.year.trim()} ${sl.artist}`);
  let creditsTop = Infinity;
  if (credits.length) {
    const cs = u * 0.0148, pitch = cs * 1.75, availC = (sl.barcode ? barcodeLeft - u * 0.03 : R) - X;
    const lastY = footerY - u * 0.036;
    creditsTop = lastY - (credits.length - 1) * pitch - cs;
    credits.forEach((line, i) => {
      let size = cs; ctx.font = `${bwt("600")} ${size}px ${bface}`;
      const txt = line.toUpperCase(), w = SR.measureTracked(ctx, txt, 0.12, size);
      if (w > availC) { size *= availC / w; ctx.font = `${bwt("600")} ${size}px ${bface}`; }
      ctx.fillStyle = rgba(ink, 0.5);
      SR.drawTracked(ctx, txt, X, lastY - (credits.length - 1 - i) * pitch, 0.12, size);
    });
  }

  // List region
  const listTop = ruleY + u * 0.035;
  let listBottom = (credits.length ? creditsTop - u * 0.035 : footerY - u * 0.06);
  if (sl.barcode) listBottom = Math.min(listBottom, cornerTop - u * 0.025);

  if (!tracks.length) {
    ctx.font = `${bwt("600")} ${u * 0.018}px ${bface}`; ctx.fillStyle = rgba(ink, 0.35);
    SR.drawTracked(ctx, "NO TRACKS YET", X, listTop + u * 0.04, 0.3, u * 0.018);
  } else if (ts.layout === "sides") {
    drawSides();
  } else {
    drawColumn();
  }
  SR.applyGrain(ctx, W, H, sl.grain, u);

  /* ---- single column: number | title (+feat) | bpm key length ---- */
  function drawColumn() {
    const groups = sidesOf(tracks, ts.layout);
    const multiSide = groups.length > 1;
    const n = tracks.length, headerH = multiSide ? u * 0.03 : 0;
    const colHead = u * 0.032;                       // small column labels above the first row
    const avail = listBottom - listTop - colHead - headerH * groups.length;
    const rowMax = (ts.layout === "card" ? 0.078 : 0.062) * u;
    const pitch = Math.min(avail / n, rowMax);
    const any = (f) => tracks.some(f);
    const geom = (stack) => {
      const fs = Math.min(pitch * (stack ? 0.4 : 0.5), u * 0.036) * (ts.scale / 100);
      const ms = fs * 0.7, mTrack = 0.1, gap = fs * 1.3, cols = [];
      ctx.font = `${bwt("600")} ${ms}px ${bface}`;
      if (ts.showBpm && any(t => t.bpm)) cols.push(["bpm", SR.measureTracked(ctx, "000", mTrack, ms)]);
      if (ts.showKey && any(t => t.key)) cols.push(["key", SR.measureTracked(ctx, "F♯m", mTrack, ms)]);
      if (ts.showLength && any(t => t.length)) cols.push(["length", SR.measureTracked(ctx, "00:00", mTrack, ms)]);
      const metaW = cols.reduce((a, c) => a + c[1] + gap, 0);
      const titleX = X + fs * 2.7, titleMax = R - metaW - titleX - gap * 0.6;
      return { fs, ms, mTrack, gap, cols, titleX, titleMax, tSize: uniformSize(titleMax, fs) };
    };
    // If any feature credit can't sit beside its title, every row stacks it underneath instead, so rows stay consistent.
    let stack = false, G = geom(false);
    if (ts.showFeat && any(t => t.feat) && tracks.some(t => !featFits(t, G.titleMax, G.tSize))) { stack = true; G = geom(true); }
    const { fs, ms, mTrack, gap, cols, titleX, titleMax, tSize } = G;
    let y = listTop + colHead;
    {
      const cs = ms * 0.78; ctx.font = `${bwt("600")} ${cs}px ${bface}`; ctx.fillStyle = rgba(ink, 0.34);
      let hx = R;
      for (let c = cols.length - 1; c >= 0; c--) {
        const [k, w] = cols[c], lab = k === "bpm" ? "BPM" : k === "key" ? "KEY" : "TIME";
        const lw = SR.measureTracked(ctx, lab, 0.2, cs); SR.drawTracked(ctx, lab, hx - lw, listTop + cs * 0.9, 0.2, cs); hx -= w + gap;
      }
    }
    groups.forEach(g => {
      if (multiSide) {
        ctx.font = `${bwt("700")} ${fs * 0.62}px ${bface}`; ctx.fillStyle = rgba(ink, 0.55);
        SR.drawTracked(ctx, `SIDE ${g.side}`, X, y + headerH * 0.7, 0.3, fs * 0.62);
        y += headerH;
      }
      g.rows.forEach(({ t, i }, pos) => {
        const base = y + pitch / 2 + fs * (stack ? 0.1 : 0.34);
        ctx.font = `${bwt("600")} ${fs * 0.8}px ${bface}`; ctx.fillStyle = rgba(ink, 0.5);
        SR.drawTracked(ctx, numberLabel(ts, g.side, pos, i), X, base, 0.12, fs * 0.8);
        drawTitle(titleX, base, titleMax, tSize, t, stack ? "stack" : "inline", fs);
        let cx = R;
        for (let c = cols.length - 1; c >= 0; c--) {
          const [k, w] = cols[c]; const val = t[k] || "";
          ctx.font = `${bwt("600")} ${ms}px ${bface}`; ctx.fillStyle = rgba(ink, 0.62);
          if (val) { const vw = SR.measureTracked(ctx, val, mTrack, ms); SR.drawTracked(ctx, val, cx - vw, base, mTrack, ms); }
          cx -= w + gap;
        }
        if (ts.rules) { ctx.strokeStyle = rgba(ink, 0.09); ctx.lineWidth = Math.max(1, u * 0.001); ctx.beginPath(); ctx.moveTo(X, y + pitch); ctx.lineTo(R, y + pitch); ctx.stroke(); }
        y += pitch;
      });
    });
  }

  // One title size for the whole list: the largest that fits the longest title (floor 62%), so rows never differ in size.
  function uniformSize(maxW, fs) {
    let size = fs; const track = 0.02;
    ctx.font = `${wt("700")} ${fs}px ${face}`;
    tracks.forEach(t => { const w = SR.measureTracked(ctx, tc(t.title), track, fs); if (w > maxW) size = Math.min(size, fs * maxW / w); });
    return Math.max(fs * 0.62, size);
  }
  function featOf(t) { return `FEAT. ${t.feat.toUpperCase()}`; }
  function featFits(t, maxW, size) {
    if (!t.feat) return true;
    ctx.font = `${wt("700")} ${size}px ${face}`; const tw = SR.measureTracked(ctx, tc(t.title), 0.02, size);
    ctx.font = `${bwt("600")} ${size * 0.7}px ${bface}`;
    return tw + size * 0.3 + SR.measureTracked(ctx, featOf(t), 0.02, size * 0.7) <= maxW;
  }
  // mode: inline (feat after the title) | stack (feat on a second line) | none (caller handles it)
  function drawTitle(x, base, maxW, size, t, mode = "inline", fs = size) {
    const track = 0.02, title = tc(t.title);
    ctx.font = `${wt("700")} ${size}px ${face}`; ctx.fillStyle = rgba(ink, 1);
    const tt = fitText(ctx, title, maxW + 0.5, size, track);
    const w = SR.drawTracked(ctx, tt, x, base, track, size);
    if (!ts.showFeat || !t.feat || mode === "none") return;
    if (mode === "stack") {
      const fsz = fs * 0.6; ctx.font = `${bwt("600")} ${fsz}px ${bface}`; ctx.fillStyle = rgba(ink, 0.55);
      SR.drawTracked(ctx, fitText(ctx, featOf(t), maxW, fsz, 0.12), x, base + fs * 0.72, 0.12, fsz);
    } else if (tt === title) {
      const fsz = size * 0.7, avail = maxW - w - size * 0.3;
      ctx.font = `${bwt("600")} ${fsz}px ${bface}`; ctx.fillStyle = rgba(ink, 0.55);
      if (avail > 0) SR.drawTracked(ctx, fitText(ctx, " " + featOf(t), avail, fsz, track), x + w + size * 0.3, base, track, fsz);
    }
  }

  /* ---- A/B columns: two lines per track ---- */
  function drawSides() {
    const groups = sidesOf(tracks, "sides");
    const cols = groups.length, gapC = u * 0.05, colW = (R - X - gapC * (cols - 1)) / cols;
    const maxRows = Math.max(...groups.map(g => g.rows.length));
    const headerH = u * 0.05;
    const pitch = Math.min((listBottom - listTop - headerH) / maxRows, u * 0.088);
    const fs = Math.min(pitch * 0.34, u * 0.027) * (ts.scale / 100);
    const sSize = uniformSize(colW - fs * 2.8, fs);
    groups.forEach((g, ci) => {
      const gx = X + ci * (colW + gapC);
      const hs = fs * 0.72;
      ctx.font = `${bwt("700")} ${hs}px ${bface}`; ctx.fillStyle = rgba(ink, 1);
      SR.drawTracked(ctx, `SIDE ${g.side}`, gx, listTop + hs, 0.3, hs);
      const rt = SP.runtime(g.rows.map(r => r.t));
      if (rt) {
        ctx.font = `${bwt("600")} ${hs}px ${bface}`; ctx.fillStyle = rgba(ink, 0.5);
        const txt = SP.fmtTime(rt), w = SR.measureTracked(ctx, txt, 0.12, hs);
        SR.drawTracked(ctx, txt, gx + colW - w, listTop + hs, 0.12, hs);
      }
      ctx.strokeStyle = rgba(ink, 0.3); ctx.lineWidth = Math.max(1, u * 0.0016);
      ctx.beginPath(); ctx.moveTo(gx, listTop + hs * 1.7); ctx.lineTo(gx + colW, listTop + hs * 1.7); ctx.stroke();
      let y = listTop + headerH;
      g.rows.forEach(({ t, i }, pos) => {
        const base = y + pitch * 0.46;
        const lab = numberLabel({ numbering: "A1" }, g.side, pos, i);
        ctx.font = `${bwt("600")} ${fs * 0.8}px ${bface}`; ctx.fillStyle = rgba(ink, 0.5);
        SR.drawTracked(ctx, lab, gx, base, 0.12, fs * 0.8);
        const nx = gx + fs * 2.8;
        drawTitle(nx, base, gx + colW - nx, sSize, t, "none");
        const sub = [...(ts.showFeat && t.feat ? [featOf(t)] : []), ...metaParts(t, ts)].join("  ·  ");
        if (sub) {
          let ss = fs * 0.62; const sw = gx + colW - nx; ctx.font = `${bwt("600")} ${ss}px ${bface}`; ctx.fillStyle = rgba(ink, 0.5);
          const w0 = SR.measureTracked(ctx, sub, 0.1, ss); if (w0 > sw) ss = Math.max(fs * 0.62 * 0.78, ss * sw / w0);   // shrink a little, then truncate
          ctx.font = `${bwt("600")} ${ss}px ${bface}`;
          SR.drawTracked(ctx, fitText(ctx, sub, sw + 0.5, ss, 0.1), nx, base + fs * 0.62 * 1.55, 0.1, ss);
        }
        if (ts.rules) { ctx.strokeStyle = rgba(ink, 0.09); ctx.lineWidth = Math.max(1, u * 0.001); ctx.beginPath(); ctx.moveTo(gx, y + pitch); ctx.lineTo(gx + colW, y + pitch); ctx.stroke(); }
        y += pitch;
      });
    });
  }
}

/* ---------- plain-text exports ---------- */
function toText(db, fmt) {
  const ts = settings(db), tracks = db.tracks, r = db.release;
  const sides = sidesOf(tracks, "back");
  const label = (t) => t.title + (t.feat ? ` (feat. ${t.feat})` : "");
  if (fmt === "csv") {
    const q = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    return ["#,side,title,feat,bpm,key,length", ...tracks.map((t, i) => [i + 1, t.side || "A", t.title, t.feat, t.bpm, t.key, t.length].map(q).join(","))].join("\n");
  }
  if (fmt === "md") {
    const rows = tracks.map((t, i) => `| ${i + 1} | ${label(t)} | ${t.bpm || ""} | ${t.key || ""} | ${t.length || ""} |`);
    return [`# ${SP.titleLine(r)} — ${r.artist}`, "", "| # | Title | BPM | Key | Length |", "|--:|---|--:|---|--:|", ...rows].join("\n");
  }
  const out = []; let idx = 0;
  sides.forEach(g => {
    if (sides.length > 1) { if (out.length) out.push(""); out.push(`Side ${g.side}`); }
    g.rows.forEach(({ t }) => { idx++; out.push(`${idx}. ${label(t)}${t.length ? ` [${t.length}]` : ""}`); });
  });
  return out.join("\n");
}

window.TracklistRender = { DEFAULTS, settings, dims, render, toText, sidesOf };
})();
