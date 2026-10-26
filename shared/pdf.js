/* Sleeve Press: a tiny PDF writer (JPEG images, lines, circles, Helvetica labels) and a store-only ZIP.
   Sizes are in millimetres from the top-left, so print sheets read like the physical templates. */
(function () {
"use strict";
const PT = 72 / 25.4;

function dataUrlBytes(u) { const b = atob(u.split(",")[1]); const a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
const n2 = (v) => (Math.round(v * 1000) / 1000).toString();

function doc() {
  const pages = [], images = [], cache = new Map();
  const api = {
    page(wmm, hmm) {
      const ops = [], H = hmm * PT, pg = { w: wmm * PT, h: H, ops, xo: new Set() };
      const P = (x, y) => `${n2(x * PT)} ${n2(H - y * PT)}`;
      const circlePath = (cx, cy, r) => {
        const k = 0.5523 * r;
        return `${P(cx + r, cy)} m ${P(cx + r, cy - k)} ${P(cx + k, cy - r)} ${P(cx, cy - r)} c ${P(cx - k, cy - r)} ${P(cx - r, cy - k)} ${P(cx - r, cy)} c ` +
          `${P(cx - r, cy + k)} ${P(cx - k, cy + r)} ${P(cx, cy + r)} c ${P(cx + k, cy + r)} ${P(cx + r, cy + k)} ${P(cx + r, cy)} c`;
      };
      const stroke = (o = {}) => `${n2((o.width || 0.25) * PT)} w ${o.dash ? `[${n2(o.dash * PT)} ${n2(o.dash * PT)}] 0 d` : "[] 0 d"} ${o.gray ?? 0} G`;
      const p = {
        /* canvas → JPEG placed at (x,y,w,h) mm; clip: "circle" to clip to the inscribed circle */
        image(canvas, x, y, w, h, clip) {
          // the same canvas placed again (copies, sticker sheets) reuses one embedded JPEG
          let id = cache.get(canvas);
          if (!id) { id = images.length + 1; images.push({ bytes: dataUrlBytes(canvas.toDataURL("image/jpeg", 0.93)), w: canvas.width, h: canvas.height }); cache.set(canvas, id); }
          pg.xo.add(id);
          ops.push("q");
          if (clip === "circle") ops.push(`${circlePath(x + w / 2, y + h / 2, Math.min(w, h) / 2)} W n`);
          ops.push(`${n2(w * PT)} 0 0 ${n2(h * PT)} ${P(x, y + h)} cm /Im${id} Do Q`);
          return p;
        },
        line(x1, y1, x2, y2, o) { ops.push(`q ${stroke(o)} ${P(x1, y1)} m ${P(x2, y2)} l S Q`); return p; },
        rect(x, y, w, h, o) { ops.push(`q ${stroke(o)} ${n2(x * PT)} ${n2(H - (y + h) * PT)} ${n2(w * PT)} ${n2(h * PT)} re S Q`); return p; },
        circle(cx, cy, r, o = {}) { ops.push(`q ${stroke(o)} ${o.fill != null ? `${o.fill} g ` : ""}${circlePath(cx, cy, r)} ${o.fill != null ? (o.strokeToo ? "B" : "f") : "S"} Q`); return p; },
        text(s, x, y, size = 7, gray = 0.4) {
          const t = String(s).replace(/[^\x20-\x7e]/g, "-").replace(/([\\()])/g, "\\$1");
          ops.push(`BT /F1 ${n2(size)} Tf ${gray} g ${P(x, y)} Td (${t}) Tj ET`); return p;
        },
        /* crop marks just outside a trimmed box */
        crops(x, y, w, h, len = 5, gap = 2) {
          const o = { width: 0.2 };
          for (const [cx, cy, sx, sy] of [[x, y, -1, -1], [x + w, y, 1, -1], [x, y + h, -1, 1], [x + w, y + h, 1, 1]]) {
            p.line(cx + sx * gap, cy, cx + sx * (gap + len), cy, o); p.line(cx, cy + sy * gap, cx, cy + sy * (gap + len), o);
          }
          return p;
        },
      };
      pages.push(pg); return p;
    },
    blob() {
      const enc = new TextEncoder(), chunks = [], offs = []; let len = 0;
      const push = (x) => { const b = typeof x === "string" ? enc.encode(x) : x; chunks.push(b); len += b.length; };
      const obj = (n, body) => { offs[n] = len; push(`${n} 0 obj\n`); body(); push("\nendobj\n"); };
      push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
      // numbering: 1 catalog, 2 pages, 3 font, then images, then page+content pairs
      const imgBase = 4, pageBase = imgBase + images.length;
      obj(1, () => push("<< /Type /Catalog /Pages 2 0 R >>"));
      obj(2, () => push(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageBase + i * 2} 0 R`).join(" ")}] >>`));
      obj(3, () => push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"));
      images.forEach((im, i) => obj(imgBase + i, () => {
        push(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>\nstream\n`);
        push(im.bytes); push("\nendstream");
      }));
      pages.forEach((pg, i) => {
        const content = enc.encode(pg.ops.join("\n"));
        const xo = [...pg.xo].map(id => `/Im${id} ${imgBase + id - 1} 0 R`).join(" ");
        obj(pageBase + i * 2, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n2(pg.w)} ${n2(pg.h)}] /Resources << /Font << /F1 3 0 R >> /XObject << ${xo} >> >> /Contents ${pageBase + i * 2 + 1} 0 R >>`));
        obj(pageBase + i * 2 + 1, () => { push(`<< /Length ${content.length} >>\nstream\n`); push(content); push("\nendstream"); });
      });
      const count = pageBase + pages.length * 2, xref = len;
      push(`xref\n0 ${count}\n0000000000 65535 f \n`);
      for (let i = 1; i < count; i++) push(`${String(offs[i]).padStart(10, "0")} 00000 n \n`);
      push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
      return new Blob(chunks, { type: "application/pdf" });
    },
  };
  return api;
}

/* ---------- zip (store-only) ---------- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zip(files) {
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  const d = new Date(), dt = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)), dd = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate());
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
    const lh = new DataView(new ArrayBuffer(30)); lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, dt, true); lh.setUint16(12, dd, true); lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, f.data);
    const ch = new DataView(new ArrayBuffer(46)); ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, dt, true); ch.setUint16(14, dd, true); ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true); ch.setUint16(28, name.length, true);
    ch.setUint32(42, off, true); central.push(new Uint8Array(ch.buffer), name);
    off += 30 + name.length + size;
  }
  const cSize = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22)); end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cSize, true); end.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: "application/zip" });
}

window.PDF = { doc, zip, PT };
})();
