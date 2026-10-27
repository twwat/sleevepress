/* Sleeve Press: looks. Curated palettes, font table, layout presets and the seeded randomizer.
   A "look" is everything about a sleeve except its words and its image. */
(function () {
"use strict";
const { hexToRgb, rgbToHex, hslToRgb, rgbToHsl, contrast, mulberry32 } = SP;

/* ---------- palettes (ground, ink, spot). Every ink clears 4.5:1 on its ground. ---------- */
const P = (name, bg, ink, accent) => ({ name, bg, ink, accent });
const PALETTES = [
  P("Nine Night", "#15120f", "#ece6da", "#9b1b1e"), P("Foreign", "#0f1316", "#d7dde1", "#6f8796"),
  P("Day Clean", "#e8e2d4", "#17130f", "#9b1b1e"), P("Golden Hour", "#2a1a0f", "#f2dfb6", "#d9a23a"),
  P("Dubplate", "#0a0a0a", "#bfbfbf", "#ffffff"), P("Scandal Bag", "#101a14", "#dbe6d6", "#e8c23a"),
  P("Oxblood & Bone", "#2a0f12", "#ecdcc8", "#d9a23a"), P("Sodium", "#0d0b08", "#f4e9d0", "#ff8a1f"),
  P("Pressing Plant", "#d9d4c7", "#1a1a1a", "#d62d20"), P("Harbour", "#0e1a24", "#d8e4ea", "#e0a458"),
  P("Moss", "#1b2415", "#e3e8d0", "#c9a227"), P("Bruise", "#1c1226", "#e6dcef", "#e0527a"),
  P("Concrete", "#2b2b2b", "#e9e9e9", "#ff5a36"), P("Lagoon", "#07252b", "#d6efe9", "#f26b5b"),
  P("Paper Cut", "#f1ece1", "#14213d", "#e63946"), P("Terracotta", "#3a1f17", "#f3dfc9", "#e58f65"),
  P("Ultramarine", "#0b1b4d", "#f1ede0", "#f2c230"), P("Mint Tape", "#e6f0e4", "#10261a", "#ef5b4f"),
  P("Rose Dust", "#2a1a20", "#f2e1dd", "#d46a7e"), P("Signal", "#101010", "#f2f2f2", "#ff2d2d"),
  P("Noir Gold", "#0b0b0c", "#e8dfc8", "#bda24a"), P("Sky Dub", "#0f2a3f", "#eaf2f5", "#7fd0f0"),
  P("Lemon Pith", "#1e1c0e", "#f5f2d0", "#f0e130"), P("Violet Hour", "#150f26", "#e9e3f7", "#9a7bff"),
  P("Brick Lane", "#2a1511", "#efe3d3", "#c8472b"), P("Blueprint", "#0d2f6b", "#e8f0ff", "#ffd400"),
  P("Ash", "#cfcac0", "#1e1e1e", "#7a1f1f"), P("Neon Sign", "#0a0a14", "#f0f0ff", "#3df5c1"),
  P("Cherry Cola", "#1a0c0e", "#f6e6df", "#e0243a"), P("Olive Oil", "#232314", "#efe9cf", "#b9c04a"),
  P("Ice", "#dfe8ee", "#0e2233", "#3b82f6"), P("Tobacco", "#2b1d12", "#e9dcc2", "#b5651d"),
  P("Spearmint", "#0c2a22", "#e6f4ee", "#5ce0b0"), P("Marigold", "#f2b632", "#1b1405", "#8a1c1c"),
  P("Vermilion", "#c8321e", "#fbf1e3", "#1a1210"), P("Bottle", "#12301f", "#e8efe0", "#e8a33a"),
  P("Riso Pink", "#f4e8e1", "#1d1a3a", "#ff48b0"), P("Riso Teal", "#eae6da", "#14202b", "#00838a"),
  P("Fluoro", "#121212", "#f2f2ea", "#c6ff00"), P("Kodak", "#ffcc00", "#1a1100", "#d1121e"),
  P("Sun Bleach", "#efe6cf", "#3a2a1a", "#c97b2a"), P("Night Bus", "#0a0f1f", "#f0e9d8", "#ff6f3c"),
  P("Plum Wine", "#2b0f24", "#f5e1ea", "#ff9fb2"), P("Seafoam", "#d7ece4", "#0f2a24", "#ff6b4a"),
  P("Cobalt Cream", "#f3ecdc", "#0d2fa8", "#e8452c"), P("Graphite", "#3a3d40", "#f4f4f2", "#ffb400"),
  P("Red Room", "#7a0d12", "#fbe9e1", "#ffcf6e"), P("Forest Floor", "#1a2318", "#ebe3cc", "#d4693b"),
  P("Lilac", "#e7e1f3", "#231a3b", "#6a3df0"), P("Tangerine", "#ff7a1a", "#1a0d02", "#fff3dc"),
  P("Deep Sea", "#031722", "#dff3f7", "#2ad4c6"), P("Butter", "#f6efc9", "#2b2410", "#2f6f4f"),
  P("Sepia Print", "#3b2e22", "#efe2c8", "#9fc5c3"), P("Club Flyer", "#1b0033", "#f9f1ff", "#ff2fd1"),
  P("Rust Belt", "#4a1f10", "#f6e6d4", "#7fb5c9"), P("Chalk Board", "#1f2a24", "#f1f1e8", "#f2d16b"),
  P("Hot Tarmac", "#18171a", "#ece8e1", "#ff4d00"), P("Pistachio", "#cfe0b4", "#1c2412", "#b8325a"),
  P("Mono Ink", "#f4f2ee", "#111111", "#111111"), P("Mono Night", "#0b0b0b", "#efefef", "#7a7a7a"),
];

/* ---------- fonts. one = single weight (never request bold: it would be faked). k = size multiplier. ---------- */
const F = (n, w, o = {}) => ({ n, w, ...o });
const FONTS = [
  F("Archivo", [600, 700]), F("Inter Tight", [600, 700]), F("Space Grotesk", [500, 700]), F("Syne", [700], { k: 0.95 }),
  F("Barlow Condensed", [600, 700], { k: 1.18 }), F("Oswald", [500, 700], { k: 1.18 }), F("Bebas Neue", [400], { k: 1.35 }),
  F("Anton", [400], { k: 1.3 }), F("League Gothic", [400], { k: 1.45 }), F("Big Shoulders Display", [700], { k: 1.25 }),
  F("Archivo Black", [400], { k: 0.95 }), F("Unbounded", [700], { k: 0.8 }), F("Rubik Mono One", [400], { k: 0.75 }),
  F("DM Serif Display", [400], { k: 1.02, serif: 1 }), F("Playfair Display", [700], { serif: 1 }), F("Bodoni Moda", [700], { k: 0.95, serif: 1 }),
  F("Fraunces", [700], { k: 0.97, serif: 1 }), F("Cormorant Garamond", [600], { k: 1.1, serif: 1 }),
  F("Space Mono", [700], { k: 0.8, mono: 1 }), F("IBM Plex Mono", [500], { k: 0.82, mono: 1 }),
  F("Bricolage Grotesque", [700, 800], { k: 0.95 }), F("Chakra Petch", [600, 700]), F("Archivo Narrow", [700], { k: 1.1 }),
  F("Staatliches", [400], { k: 1.25 }), F("Fjalla One", [400], { k: 1.12 }), F("Six Caps", [400], { k: 1.9 }),
  F("Michroma", [400], { k: 0.74 }), F("Krona One", [400], { k: 0.76 }), F("Syncopate", [700], { k: 0.74 }), F("Bungee", [400], { k: 0.84 }),
  F("Abril Fatface", [400], { k: 1.0, serif: 1 }), F("Instrument Serif", [400], { k: 1.12, serif: 1 }), F("Italiana", [400], { k: 1.06, serif: 1 }),
  F("Zilla Slab", [700], { k: 1.0, serif: 1 }), F("Major Mono Display", [400], { k: 0.8, mono: 1, manual: 1 }),
];
/* Type feel, for Discover's filter. */
const FEEL = (f) => f.mono ? "mono" : f.serif ? "serif" : (f.k || 1) >= 1.1 ? "condensed" : (f.k || 1) <= 0.85 ? "wide" : "grotesk";
FONTS.forEach(f => { f.feel = FEEL(f); });
const FONT = Object.fromEntries(FONTS.map(f => [f.n, f]));
const BODY_FONTS = ["Archivo", "Inter Tight", "Space Grotesk", "Barlow Condensed", "Oswald", "Space Mono", "IBM Plex Mono", "DM Serif Display", "Fraunces", "Chakra Petch", "Archivo Narrow", "Zilla Slab"];
const GOOGLE_CSS = "https://fonts.googleapis.com/css2?" + [
  "Archivo:wght@500;600;700;800", "Inter+Tight:wght@600;700;800", "Space+Grotesk:wght@500;700", "Syne:wght@700", "Barlow+Condensed:wght@600;700",
  "Oswald:wght@500;700", "Bebas+Neue", "Anton", "League+Gothic", "Big+Shoulders+Display:wght@700", "Archivo+Black", "Unbounded:wght@700",
  "Rubik+Mono+One", "DM+Serif+Display", "Playfair+Display:wght@700", "Bodoni+Moda:wght@700", "Fraunces:wght@700", "Cormorant+Garamond:wght@600",
  "Space+Mono:wght@700", "IBM+Plex+Mono:wght@400;500",
  "Bricolage+Grotesque:wght@700;800", "Chakra+Petch:wght@600;700", "Archivo+Narrow:wght@700", "Staatliches", "Fjalla+One", "Six+Caps",
  "Michroma", "Krona+One", "Syncopate:wght@700", "Bungee", "Abril+Fatface", "Instrument+Serif", "Italiana", "Zilla+Slab:wght@700", "Major+Mono+Display",
].map(f => "family=" + f).join("&") + "&display=swap";

/* ---------- layout presets: only positional keys, so they combine freely with colour and type ---------- */
const LAYOUT_KEYS = ["align", "margin", "artistY", "motifY", "titlePos", "titleDy", "titleSize", "footerY", "titleBleed", "titleRotate"];
const LAYOUTS = {
  classic: { label: "Classic", align: "left", margin: 11, artistY: 15.8, motifY: 20.6, titlePos: "centre", titleDy: 0, titleSize: 100, footerY: 92.2, titleBleed: false, titleRotate: "none" },
  centred: { label: "Centred", align: "centre", margin: 11, artistY: 15.8, motifY: 20.6, titlePos: "centre", titleDy: 0, titleSize: 100, footerY: 92.2, titleBleed: false, titleRotate: "none" },
  right: { label: "Right hand", align: "right", margin: 11, artistY: 15.8, motifY: 20.6, titlePos: "centre", titleDy: 0, titleSize: 100, footerY: 92.2, titleBleed: false, titleRotate: "none" },
  poster: { label: "Poster", align: "left", margin: 8, artistY: 11, motifY: 15.5, titlePos: "lower", titleDy: -1, titleSize: 128, footerY: 94.5, titleBleed: false, titleRotate: "none" },
  quiet: { label: "Quiet", align: "centre", margin: 14, artistY: 61, motifY: 65.5, titlePos: "centre", titleDy: -15, titleSize: 62, footerY: 91, titleBleed: false, titleRotate: "none" },
  flipped: { label: "Flipped", align: "left", margin: 11, artistY: 84, motifY: 77, titlePos: "upper", titleDy: -2, titleSize: 100, footerY: 93, titleBleed: false, titleRotate: "none" },
  stacked: { label: "Stacked low", align: "right", margin: 9, artistY: 44, motifY: 49, titlePos: "lower", titleDy: 3, titleSize: 110, footerY: 94.5, titleBleed: false, titleRotate: "none" },
  // the title too big for the sleeve, cropped by the far edge
  giant: { label: "Giant", align: "left", margin: 8, artistY: 11, motifY: 15.5, titlePos: "lower", titleDy: 4, titleSize: 100, footerY: 95, titleBleed: true, titleRotate: "none" },
  // everything small and tight in the bottom corner, the rest of the sleeve left open
  corner: { label: "Corner", align: "left", margin: 9, artistY: 54, motifY: 57.5, titlePos: "lower", titleDy: 3.5, titleSize: 74, footerY: 94.5, titleBleed: false, titleRotate: "none" },
  // the title runs up the left edge like a book spine; the other words keep to the column beside it
  spine: { label: "Spine", align: "left", margin: 9, artistY: 15.8, motifY: 20.6, titlePos: "centre", titleDy: 0, titleSize: 118, footerY: 93.5, titleBleed: false, titleRotate: "up" },
  // a lone mark at the top, the title and artist in one low band
  lowband: { label: "Low band", align: "left", margin: 10, artistY: 89.5, motifY: 9.5, titlePos: "lower", titleDy: -0.5, titleSize: 88, footerY: 95, titleBleed: false, titleRotate: "none" },
  // a big title at the very top, the artist under it, the lower half open
  topheavy: { label: "Top heavy", align: "left", margin: 8, artistY: 47, motifY: 51, titlePos: "upper", titleDy: -18, titleSize: 122, footerY: 94.5, titleBleed: false, titleRotate: "none" },
};

const FRAME_STYLES = ["hairline", "double", "thick", "corners", "dashed", "inset", "round", "crop", "rules", "film", "ticket", "perforated", "bracket", "registration"];
const MOTIFS = ["bars", "dots", "squares", "rings", "diamonds", "ticks", "wave", "slants", "plus", "chevrons"];

/* ---------- colour generation ---------- */
const hsl = (h, s, l) => hslToRgb([h, Math.max(0, Math.min(1, s)), Math.max(0, Math.min(1, l))]);
function push(h, s, l, against, target, towardLight) {
  for (let i = 0; i < 90 && contrast(hslToRgb([h, s, l]), against) < target; i++) l = towardLight ? Math.min(1, l + 0.01) : Math.max(0, l - 0.01);
  return hslToRgb([h, s, l]);
}
/* Rolls a palette that always clears 7:1 for ink and 3:1 for the spot. mode: dark | light | bold | any */
/* Spot hues a warm or cool mood keeps to (degrees; warm wraps through red). */
const SPOT_RANGE = { warm: [-30, 70], cool: [170, 280] };
const hueIn = (h, [a, b]) => { const x = ((h - a) % 360 + 360) % 360; return x <= b - a; };
function makePalette(rng, mode = "any", hue) {
  const pick = (a) => a[Math.floor(rng() * a.length)], range = SPOT_RANGE[mode];
  if (mode === "warm") { hue = hue ?? (rng() * 80 - 25); mode = pick(["dark", "dark", "light", "bold"]); }
  if (mode === "cool") { hue = hue ?? (170 + rng() * 100); mode = pick(["dark", "dark", "light", "bold"]); }
  if (mode === "mono") return monoPalette(rng);
  if (mode === "any") mode = pick(["dark", "dark", "dark", "light", "bold"]);
  const h = hue ?? rng() * 360;
  const off = pick([30, 150, 180, 120, -30, 60, -60, 200]);
  let bg;
  if (mode === "dark") bg = hsl(h, 0.1 + rng() * 0.45, 0.045 + rng() * 0.08);
  else if (mode === "light") bg = hsl(h, 0.1 + rng() * 0.4, 0.86 + rng() * 0.07);
  else bg = hsl(h, 0.45 + rng() * 0.4, 0.2 + rng() * 0.22);
  let ink; const bgDark0 = SP.relLum(bg) < 0.25;
  if (mode === "bold") {
    const light = hsl(h + rng() * 30, 0.1 + rng() * 0.2, 0.92), dark = hsl(h, 0.3, 0.07);
    ink = contrast(light, bg) >= contrast(dark, bg) ? light : dark;
  } else ink = bgDark0 ? hsl(h + rng() * 30, 0.06 + rng() * 0.2, 0.88) : hsl(h, 0.25, 0.09);
  const [ih, is, il] = rgbToHsl(ink); const inkLight = SP.relLum(ink) > SP.relLum(bg);
  ink = push(ih, is, il, bg, 7.1, inkLight);   // a little over, to survive hex rounding
  // A mid-tone ground can leave even white or black short of 7:1; then move the ground away from the ink.
  if (contrast(ink, bg) < 7.1) { const [bh, bs, bl] = rgbToHsl(bg); bg = push(bh, bs, bl, ink, 7.1, !inkLight); }
  const bgDark = SP.relLum(bg) < 0.25;
  let spot = hsl(range ? range[0] + rng() * (range[1] - range[0]) : h + off, 0.55 + rng() * 0.35, 0.4 + rng() * 0.18);
  const [sh, ss, sl] = rgbToHsl(spot); spot = push(sh, ss, sl, bg, 3.1, bgDark);
  return { bg: rgbToHex(bg), ink: rgbToHex(ink), accent: rgbToHex(spot), name: "Rolled" };
}

function monoPalette(rng) {
  const dark = rng() < 0.6, h = rng() * 360, tint = rng() * 0.08;
  const bg = dark ? hsl(h, tint, 0.04 + rng() * 0.06) : hsl(h, tint, 0.9 + rng() * 0.06);
  const ink = dark ? hsl(h, tint, 0.93) : hsl(h, tint, 0.07);
  let spot = rng() < 0.5 ? hsl(h, tint, dark ? 0.55 : 0.42) : hsl(rng() * 360, 0.75, 0.5);
  const [sh, ss, sl] = rgbToHsl(spot); spot = push(sh, ss, sl, bg, 3.1, dark);
  return { bg: rgbToHex(bg), ink: rgbToHex(ink), accent: rgbToHex(spot), name: "Rolled mono" };
}
/* Which moods a palette belongs to (for filtering the curated list). */
function moodsOf(p) {
  const b = hexToRgb(p.bg), a = hexToRgb(p.accent), L = SP.relLum(b), out = ["any"];
  const [bh, bs] = rgbToHsl(b), [ah, as] = rgbToHsl(a);
  if (L < 0.06) out.push("dark"); else if (L > 0.45) out.push("light"); else out.push("bold");
  if (bs < 0.12 && (as < 0.15 || L < 0.06 || L > 0.45)) out.push("mono");
  const warm = (h, s) => s > 0.2 && (h < 60 || h > 330), cool = (h, s) => s > 0.2 && h > 165 && h < 280;
  // a warm (cool) palette keeps its spot warm (cool) or neutral too: no cyan title on a maroon ground under "Warm"
  const spotOk = (k) => as < 0.15 || hueIn(ah, SPOT_RANGE[k]);
  if ((warm(bh, bs) || (bs < 0.25 && warm(ah, as))) && spotOk("warm")) out.push("warm");
  if ((cool(bh, bs) || (bs < 0.25 && cool(ah, as))) && spotOk("cool")) out.push("cool");
  return out;
}
const MOODS = ["any", "dark", "light", "bold", "mono", "warm", "cool"];
const FEELS = ["any", "grotesk", "condensed", "wide", "serif", "mono"];

/* ---------- geometry estimates ----------
   Everything below works in sleeve percent (0..100) so the randomizer can keep elements apart without
   measuring text (fonts may not be loaded yet, and the result must not depend on that).
   ADV: average advance per character, [capitals, lower case] as a share of the title size before the
   font's k, and [2] for small caps-tracked artist text as a share of its own size. Measured in Chrome. */
const ADV = {
  "Archivo": [0.613, 0.466, 0.644], "Inter Tight": [0.57, 0.458, 0.602], "Space Grotesk": [0.549, 0.491, 0.582], "Syne": [0.676, 0.516, 0.752],
  "Barlow Condensed": [0.49, 0.429, 0.434], "Oswald": [0.715, 0.576, 0.636], "Bebas Neue": [0.466, 0.466, 0.363], "Anton": [0.541, 0.527, 0.442],
  "League Gothic": [0.459, 0.38, 0.333], "Big Shoulders Display": [0.461, 0.439, 0.39], "Archivo Black": [0.653, 0.522, 0.712],
  "Unbounded": [0.609, 0.504, 0.796], "Rubik Mono One": [0.637, 0.637, 0.85], "DM Serif Display": [0.547, 0.456, 0.556],
  "Playfair Display": [0.605, 0.465, 0.628], "Bodoni Moda": [0.61, 0.467, 0.671], "Fraunces": [0.633, 0.49, 0.682],
  "Cormorant Garamond": [0.641, 0.438, 0.593], "Space Mono": [0.49, 0.49, 0.612], "IBM Plex Mono": [0.492, 0.492, 0.6],
  "Bricolage Grotesque": [0.561, 0.469, 0.623], "Chakra Petch": [0.571, 0.481, 0.606], "Archivo Narrow": [0.549, 0.433, 0.524],
  "Staatliches": [0.481, 0.481, 0.41], "Fjalla One": [0.482, 0.439, 0.46], "Six Caps": [0.399, 0.388, 0.222], "Michroma": [0.644, 0.46, 0.927],
  "Krona One": [0.609, 0.499, 0.832], "Syncopate": [0.608, 0.615, 0.863], "Bungee": [0.532, 0.532, 0.655], "Abril Fatface": [0.581, 0.461, 0.614],
  "Instrument Serif": [0.478, 0.386, 0.449], "Italiana": [0.551, 0.45, 0.553], "Zilla Slab": [0.582, 0.448, 0.602], "Major Mono Display": [0.592, 0.592, 0.74],
};
const adv = (face, i) => (ADV[face] || [0.6, 0.48, 0.62])[i];
/* Faces too fine for outline / echo treatments. */
const FINE = new Set(["Italiana", "Instrument Serif", "Cormorant Garamond", "Major Mono Display", "Six Caps"]);
const TITLE_BASE = { upper: 56, centre: 68, lower: 81.5 };
const titleBottom = (s) => (TITLE_BASE[s.titlePos] ?? 68) + (s.titleDy || 0);

const sideways = (s) => s.titleRotate === "up" || s.titleRotate === "down";
function titleEst(s) {
  const lines = String(s.title || "").split("\n").map(l => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const k = (FONT[s.font] || {}).k || 1, cs = s.titleCase || "upper", tr = (s.tracking || 0) / 100, lead = s.leading / 100;
  const r = cs === "upper" ? adv(s.font, 0) : cs === "lower" ? adv(s.font, 1) : adv(s.font, 0) * 0.25 + adv(s.font, 1) * 0.75;
  let size = 19 * (s.titleSize / 100) * k;
  const lens = lines.map(l => [...l].length), n = Math.max(...lens), per = r / k + tr, maxW = 100 - 2 * s.margin;
  const em = (c) => Math.max(0.5, c * per - tr), fitted = s.titleStyle === "fitted";
  const descOf = (z) => cs !== "upper" && /[gjpqy,]/.test(lines[lines.length - 1].toLowerCase()) ? z * 0.24 : z * 0.05;
  // fitted lines each fill the measure: the block's height is the sum of the lines
  const stack = (meas, cap) => {
    let sz = lens.map(c => Math.min(cap, meas / em(c)));
    const hOf = () => sz.reduce((t, z) => t + z * 0.72, 0) + sz.slice(1).reduce((t, z, i) => t + Math.min(z, sz[i]) * Math.max(0.07, lead - 0.72, cs === "upper" ? 0 : 0.27), 0);
    return { sz, h: hOf() };
  };
  const above = s.titleStyle === "echo" ? size * 0.5 : s.titleStyle === "block" ? size * 0.1 : s.titleStyle === "knockout" ? size * 0.17 : 0;
  if (sideways(s)) {
    const run = 100 - 2 * s.margin;
    let sz, th;
    if (fitted) { const st = stack(run * Math.min(1, s.titleSize / 100), 42); sz = Math.min(...st.sz); th = st.h; }
    else { sz = size; if (sz * em(n) > run) sz = run / em(n); th = sz * lead * (lines.length - 1) + sz * 0.74 + descOf(sz); }
    if (th > 42) { sz *= 42 / th; th = 42; }
    return { size: sz, w: th, h: run, desc: 0, above: 0, lines: lines.length, side: true };
  }
  if (s.titleBleed) {
    const reach = (s.titleAlign || s.align) === "centre" ? 100 : 100 - s.margin, f = Math.max(1.04, 1.14 * s.titleSize / 100);
    let w = reach * f;
    if (fitted) { const st = stack(w, 42); return { size: Math.min(...st.sz), w, h: st.h, desc: descOf(st.sz[st.sz.length - 1]), above, lines: lines.length, bleed: true }; }
    size = w / em(n);
    let h = size * lead * (lines.length - 1) + size * 0.72;
    if (h > 80) { size *= 80 / h; w *= 80 / h; h = 80; }
    return { size, w, h, desc: descOf(size), above, lines: lines.length, bleed: true };
  }
  if (fitted) { const w = maxW * Math.min(1, s.titleSize / 100), st = stack(w, 42); return { size: Math.min(...st.sz), w, h: st.h, desc: descOf(st.sz[st.sz.length - 1]), above, lines: lines.length }; }
  let w = size * (n * per - tr);
  if (w > maxW) { size *= maxW / w; w = maxW; }
  const h = size * lead * (lines.length - 1) + size * 0.72;
  return { size, w, h, desc: descOf(size), above, lines: lines.length };
}
const artistH = (s) => 2.95 * s.artistSize / 100;
function artistW(s) {
  const t = String(s.artist || ""); if (!t) return 0;
  const face = s.artistFont || s.bodyFont || s.font, a = artistH(s);
  return Math.min(100 - 2 * s.margin, [...t].length * a * (adv(face, 2) + s.artistTrack / 100));
}
const motifH = (s) => s.motifKind === "none" || !s.count ? 0 : 5 * s.motifSize / 100;
const motifW = (s) => (s.count - 1) * 2.32 * s.motifPitch / 100 + 1.05 * (s.motifSize / 100) * 1.6;
const xAt = (s, w, al) => al === "centre" ? (100 - w) / 2 : al === "right" ? 100 - s.margin - w : s.margin, xAtM = xAt;
const R = (x, y, w, h) => ({ x, y, w, h });
const overlap = (a, b, pad = 0) => !a || !b ? 0 :
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) + pad - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) + pad - Math.max(a.y, b.y));
/* Approximate boxes of every text element, in sleeve percent. */
function rects(s) {
  const out = {}, t = titleEst(s), al = (el) => s[el + "Align"] || s.align;
  // a sideways title owns a strip down one edge; the other words keep to the column beside it (as the renderer does)
  let ml = s.margin, mr = s.margin;
  if (t && t.side) {
    const up = s.titleRotate === "up", x = (up ? s.margin : 100 - s.margin - t.w) + (s.titleX || 0);
    out.title = R(x, s.margin, t.w, t.h);
    if (up) ml = x + t.w + 4; else mr = 100 - x + 4;
  } else if (t) { const tb = titleBottom(s); out.title = R(xAtM(s, t.w, al("title")), tb - t.h - t.above, t.w, t.h + t.above + t.desc); }
  const side = ml !== s.margin || mr !== s.margin;
  const xAt = (s, w, a) => !side ? xAtM(s, w, a) : a === "centre" ? (ml + 100 - mr - w) / 2 : a === "right" ? 100 - mr - w : ml;
  const a = artistH(s), aw = Math.min(artistW(s), 100 - ml - mr);
  if (aw) {
    if (s.artistRotate === "left" || s.artistRotate === "right") {
      const x = s.artistRotate === "left" ? s.margin * 0.62 : 100 - s.margin * 0.62 - a;
      const cy = Math.min(100 - aw / 2 - s.margin / 2, Math.max(aw / 2 + s.margin / 2, s.artistY));
      out.artist = R(x, cy - aw / 2, a, aw);
    } else out.artist = R(xAt(s, aw, al("artist")), s.artistY - a * 0.8, aw, a * 1.05);
  }
  if (String(s.year || "").trim()) {
    const rot = s.artistRotate === "left" || s.artistRotate === "right", aal = rot ? "centre" : al("artist");
    out.year = R(aal === "right" ? ml : 100 - mr - 6, (rot ? 7 : s.artistY) - 1.4, 6, 1.8);
  }
  const mh = motifH(s);
  if (mh) { const mw = motifW(s); out.motif = R(xAt(s, mw, al("motif")), s.motifY, mw, mh); }
  if (String(s.footer || "").trim()) {
    const fs = 1.72 * s.footerSize / 100, fw = Math.min(100 - ml - mr, [...s.footer].length * fs * (0.62 + s.footerTrack / 100));
    out.footer = R(xAt(s, fw, al("footer")), s.footerY - fs, fw, fs * 1.3);
  }
  if (s.barcode) { const bw = 17.5 * (s.barcodeSize || 100) / 100; out.barcode = R(100 - mr - bw, 93.5 - 8.5 * (s.barcodeSize || 100) / 100, bw, 8.5 * (s.barcodeSize || 100) / 100); }
  return out;
}

/* The biggest strip along one side of the sleeve with no words in it, for a full-strength pattern. */
function boldArea(s) {
  const boxes = Object.values(rects(s)), gap = 3, min = 24, out = [];
  if (!boxes.length) return { area: "left", pos: 50 };
  const top = Math.min(...boxes.map(b => b.y)) - gap, bottom = Math.max(...boxes.map(b => b.y + b.h)) + gap;
  const left = Math.min(...boxes.map(b => b.x)) - gap, right = Math.max(...boxes.map(b => b.x + b.w)) + gap;
  if (top >= min) out.push({ area: "top", pos: Math.round(top), size: top });
  if (100 - bottom >= min) out.push({ area: "bottom", pos: Math.round(bottom), size: 100 - bottom });
  if (left >= min) out.push({ area: "left", pos: Math.round(left), size: left });
  if (100 - right >= min) out.push({ area: "right", pos: Math.round(right), size: 100 - right });
  return out.sort((a, b) => b.size - a.size)[0] || null;
}

/* Shapes with inner detail or line work: they read as noise behind words. */
const BUSY_SHAPES = new Set(["bars", "target", "scope", "rays", "chevrons", "squares", "spiral", "wave", "honeycomb", "halftone", "sunset", "web", "snowflake",
  "glass", "rosewindow", "swords", "shuriken", "starburst", "sun", "discs", "eye"]);

/* Rectangles the pattern covers, in sleeve percent. */
function patternRect(s) {
  const p = s.patternPos ?? 50;
  switch (s.patternArea) {
    case "band": return [R(0, p - 13, 100, 26)];
    case "top": return [R(0, 0, 100, p)];
    case "bottom": return [R(0, p, 100, 100 - p)];
    case "left": return [R(0, 0, p, 100)];
    case "right": return [R(p, 0, 100 - p, 100)];
    case "edge": return [R(0, 0, 100, 7), R(0, 93, 100, 7), R(0, 0, 7, 100), R(93, 0, 7, 100)];
    default: return [R(0, 0, 100, 100)];
  }
}

/* ---------- colour helpers for legibility checks ---------- */
const mixRgb = (a, b, t) => [0, 1, 2].map(i => a[i] + (b[i] - a[i]) * t);
const textRgb = (s, which) => hexToRgb(s[which] === "accent" ? s.accent : s.ink);
/* Worst contrast a text colour can meet on the toned picture after dimming (the tone's two ends, pulled toward the ground). */
function picContrast(s, txt, dim) {
  const bg = hexToRgb(s.bg), eff = (dim / 100) * (s.imgMode === "bleed" ? 1 : 0.5);
  const ends = s.imgTone === "original" ? [[0, 0, 0], [255, 255, 255]] : [bg, hexToRgb(s.imgTone === "accent" ? s.accent : s.ink)];
  if (s.imgEffect === "riso" && s.imgTone !== "original") ends.push(hexToRgb(s.imgTone === "accent" ? s.ink : s.accent));   // riso prints the other colour too
  return Math.min(...ends.map(e => contrast(txt, mixRgb(e, bg, eff))));
}

/* ---------- the randomizer ----------
   locks: { colour, type, layout, motif, border, backdrop, picture }  true = leave that group alone.
   opts: { mood, feel } narrow colour and type for Discover. (hard, hue, paletteMode are used by mutate.)
   The groups are rolled first, then a repair pass keeps text apart, off the picture's busy parts and legible. */
/* ---------- dealing: spread choices across a stream ----------
   With opts.deal = { i, base }, the main choices (backdrop scheme, shape, pattern, marks, picture placement, border,
   face, title style) come from shuffled decks instead of independent dice, so any run of cards in Discover
   cycles through the options instead of repeating the same few. Without it, they're plain seeded picks. */
function dealer(deal, rnd) {
  if (!deal) return (key, list) => list[Math.floor(rnd() * list.length)];
  return (key, list) => {
    if (!list.length) return undefined;
    const r = mulberry32((SP.hashStr(key) ^ Math.imul(deal.base | 0, 2654435761)) >>> 0);
    const order = list.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const round = Math.floor(deal.i / list.length), at = deal.i % list.length;
    const passOrder = (n) => {
      const o = list.map((_, i) => i), r0 = n ? mulberry32((SP.hashStr(key) + n * 7919 + (deal.base | 0)) >>> 0) : mulberry32((SP.hashStr(key) ^ Math.imul(deal.base | 0, 2654435761)) >>> 0);
      for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(r0() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; }
      return o;
    };
    if (list.length > 1) {
      // each pass is its own shuffle; a pass that would open with the card the last one ended on swaps its first two
      const o = passOrder(round);
      if (round && list[passOrder(round - 1)[list.length - 1]] === list[o[0]]) [o[0], o[1]] = [o[1], o[0]];
      return list[o[at]];
    }
    // each pass through the deck is reshuffled, so neighbours differ between passes too
    if (round) { const r2 = mulberry32((SP.hashStr(key) + round * 7919 + (deal.base | 0)) >>> 0); for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r2() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; } }
    return list[order[at]];
  };
}
/* Weighted list → flat deck. */
const deck = (pairs) => pairs.flatMap(([v, n]) => Array(n).fill(v));

/* The big shapes and marks on offer: the built-ins, plus shared/glyphs.js when it is loaded. Round shapes are kept
   to a small share so circles don't dominate. */
function shapeDeck() {
  const g = window.Glyphs && Glyphs.SHAPES;
  if (!g) return ["circle", "ring", "square", "half", "bars"];
  const round = g.filter(x => x.round).map(x => x.id), other = g.filter(x => !x.round).map(x => x.id);
  return [...other, ...round.filter((_, i) => i % 2 === 0)];   // about half the round ones, once each
}
function markDeck() {
  const g = window.Glyphs && Glyphs.MARKS ? Glyphs.MARKS.map(x => x.id) : [];
  return [...MOTIFS, ...g.filter(id => !MOTIFS.includes(id))];
}
const patternList = () => (window.Patterns && Patterns.LIST) || [];

function randomize(state, seed, locks = {}, opts = {}) {
  const rnd = mulberry32((seed * 2654435761) >>> 0 || 1), pick = (a) => a[Math.floor(rnd() * a.length)];
  const dealt = dealer(opts.deal, rnd);
  const between = (a, b, step = 1) => Math.round((a + rnd() * (b - a)) / step) * step;
  const chance = (p) => rnd() < p;
  const s = { ...state };
  const hard = opts.hard || locks;   // groups the repair pass may not touch either

  const mood = opts.mood || "any", feel = opts.feel || "any";
  if (!locks.colour) {
    const pool = PALETTES.filter(p => moodsOf(p).includes(mood));
    const p = opts.hue == null && chance(0.4) && pool.length ? pick(pool) : makePalette(rnd, opts.paletteMode || mood, opts.hue);
    s.bg = p.bg; s.ink = p.ink; s.accent = p.accent; s.paletteName = p.name;
  }
  if (!locks.type) {
    const faces = FONTS.filter(f => (feel === "any" || f.feel === feel) && !f.manual);
    const F0 = dealt("font:" + feel, faces.length ? faces : FONTS); s.font = F0.n;
    s.bodyFont = chance(0.5) ? "" : pick(BODY_FONTS);
    s.artistFont = chance(0.22) ? pick(FONTS.filter(f => f.n !== s.font && !FINE.has(f.n))).n : "";
    s.artistCase = pick(["upper", "upper", "upper", "title", "lower"]); s.artistColor = chance(0.2) ? "accent" : "ink";
    s.artistWeight = pick([600, 700, 700, 800]);
    s.artistTrack = s.artistCase === "upper" ? between(16, 44) : between(4, 14);
    s.artistSize = between(85, 130, 5);
    s.titleStyle = dealt("titleStyle", FINE.has(s.font) ? deck([["solid", 6], ["shadow", 2], ["block", 2], ["split", 1], ["slant", 1], ["fitted", 1]])
      : deck([["solid", 6], ["outline", 1], ["echo", 1], ["shadow", 2], ["block", 2], ["split", 1], ["stencil", 1], ["stripe", 1], ["knockout", 1], ["slant", 1], ["fitted", 1]]));
    s.titleColor = chance(0.12) ? "accent" : "ink";
    s.titleCase = pick(F0.mono ? ["upper", "upper", "lower"] : ["upper", "upper", "upper", "title", "lower"]);
    const up = s.titleCase === "upper";
    // Tight caps, open lower case; serifs and monos want a touch more air.
    s.leading = F0.mono ? between(88, 100) : up ? between(F0.serif ? 84 : 78, F0.serif ? 96 : 92) : between(88, 104);
    const tr = { wide: [-4, 1], condensed: [-2, 6], serif: [-3, 2], mono: [-2, 2], grotesk: [-4, 5] }[F0.feel] || [-3, 4];
    s.tracking = between(tr[0], up ? tr[1] : Math.min(tr[1], 2));
    s.titleAccent = chance(0.25);
    s.footerColor = chance(0.15) ? "accent" : "ink"; s.footerOpacity = between(45, 80);
    s.footerSize = between(90, 120, 5); s.footerTrack = between(14, 36); s.footerCase = chance(0.85) ? "upper" : "asis";
  }
  if (!locks.motif) {
    s.motifKind = chance(0.1) ? "none" : dealt("motif", markDeck());
    s.motifSize = between(75, 140, 5); s.motifPitch = between(85, 160, 5);
    s.count = between(3, 14);
    while (s.count > 3 && motifW(s) > 40) s.count--;   // a row of marks, not a fence
    s.missing = chance(0.5) ? 0 : between(1, s.count);
    s.missingStyle = pick(["outline", "filled", "gap"]);
  }
  if (!locks.border) {
    s.frame = chance(0.75); s.frameStyle = dealt("frame", FRAME_STYLES); s.frameInset = between(3, 7, 0.5);
    s.frameWidth = between(80, 220, 10); s.frameOpacity = between(14, 55); s.frameColor = chance(0.8) ? "ink" : "accent";
    s.barcodeStyle = pick(["box", "box", "clear", "spot", "spotbox"]);
  }
  if (FONT[s.font] && FONT[s.font].mono && !hard.type) s.tracking = Math.max(-2, Math.min(2, s.tracking));

  if (!locks.layout) layout(s, rnd, pick, between, chance, dealt);
  if (!locks.picture) {
    s.imgMode = dealt("imgMode", deck([["bleed", 7], ["panel", 2], ["band", 1], ["circle", 1], ["split", 1], ["inset", 1], ["top", 1], ["arch", 1]]));
    s.imgTone = pick(["ink", "ink", "accent", "original"]); s.dim = s.imgMode === "bleed" ? between(35, 70) : between(0, 40);
    s.imgPosterize = chance(0.18) ? between(2, 5) : 0; s.imgContrast = between(90, 140, 5);
    s.imgBlur = chance(0.15) ? between(6, 30) : 0;
    s.imgEffect = dealt("imgEffect", deck([["none", 7], ["halftone", 1], ["riso", 1], ["grain", 1], ["photocopy", 1], ["dither", 1], ["scanlines", 1]]));
    if (["halftone", "dither", "photocopy"].includes(s.imgEffect)) s.imgPosterize = 0;   // already two-level
    s.imgBoxSize = 100; s.imgBoxX = 0; s.imgBoxY = 0;
    placePicture(s, rnd, pick, between, chance, hard);
  }
  if (!locks.backdrop) {
    const pic = s.imgMode === "bleed" && Looks.picture !== false;
    s.wash = chance(0.35) ? pick(["top", "bottom", "radial", "diagonal"]) : "none"; s.washAmt = between(25, pic ? 55 : 70);
    // One scheme per sleeve: plain ground, a big shape, a pattern, or a pattern working with a shape.
    const pats = patternList();
    // "bold": the pattern is the hero, full strength on the part of the sleeve the words leave free
    const scheme = dealt(pic ? "scheme:pic" : "scheme", deck(pats.length ? (pic ? [["plain", 4], ["shape", 2], ["pattern", 2], ["combo", 1], ["bold", 1]] : [["plain", 2], ["shape", 3], ["pattern", 3], ["combo", 2], ["bold", 2]]) : [["plain", 3], ["shape", 2]]));
    s.shape = "none"; s.pattern = "none"; s.shapeOutline = false; s.shapeRot = 0; s.plates = "none";
    if (scheme === "shape" || scheme === "combo") {
      s.shape = dealt("shape", shapeDeck());
      s.shapeAmt = between(40, pic ? 65 : 95); s.shapeSize = between(35, 85); s.shapeX = between(20, 85); s.shapeY = between(20, 80);
      s.shapeColor = chance(0.75) ? "accent" : "ink";
      s.shapeOutline = scheme === "shape" && chance(0.22); s.shapeRot = chance(0.3) ? between(-25, 25) : 0;
    }
    const bold = scheme === "bold" ? boldArea(s) : null;
    if (scheme === "pattern" || scheme === "combo" || scheme === "bold") {
      // one deck of every pattern, small families entered two or three times so each family gets a fair share
      // (a 2-pattern family would otherwise be lost among 12 plaids); dealt by card, so no pattern repeats within a pass
      const famSize = {}; pats.forEach(x => { famSize[x.family] = (famSize[x.family] || 0) + 1; });
      const P0 = dealt("pattern", deck(pats.map(x => [x, Math.max(1, Math.min(3, Math.round(6 / famSize[x.family])))]))); s.pattern = P0.id;
      s.patternSeed = between(1, 9999); s.patternScale = between(65, 150, 5);
      s.patternAngle = chance(0.25) ? pick([45, -45, 30, 15, -15, 90]) : 0;
      s.patternColor = dealt("patternColor", deck([["ink", 3], ["accent", 2], ["duo", 2]]));
      s.patternArea = scheme === "combo" && s.shape !== "bars" ? dealt("patternArea:combo", ["shape", "shape", "full", "band", "edge"])
        : dealt("patternArea", deck([["full", 4], ["band", 1], ["top", 1], ["bottom", 1], ["left", 1], ["right", 1], ["edge", 1]]));
      s.patternPos = s.patternArea === "band" ? between(30, 75) : between(38, 62);
      // louder patterns get less ink; a picture underneath halves it again
      const busy = P0.busy ?? 0.5;
      s.patternAmt = Math.round(between(30, 75) * (1 - busy * 0.55) * (pic ? 0.6 : 1));
      // an all-over pattern half the time goes loud, with the words on cut-out plates
      // plaid, camo, animal prints, checks and fabrics are hero patterns: they want to be seen, so they mostly get plates
      const hero = ["plaid", "camo", "animal", "check", "fabric"].includes(P0.family);
      if (!bold && s.patternArea === "full" && !pic && chance(hero ? 0.8 : 0.4)) { s.plates = chance(0.6) ? "all" : "title"; s.patternAmt = between(55, 95); s.patternScale = between(80, 170, 5); }
      if (bold) { s.patternArea = bold.area; s.patternPos = bold.pos; s.patternAmt = between(70, 100); s.patternScale = between(80, 170, 5); }
      else if (scheme === "bold") { s.patternArea = "edge"; s.patternAmt = between(60, 90); }   // no free side: a strong pattern border instead
    }
    s.texture = chance(0.3) ? pick(["halftone", "lines", "grid"]) : "none"; s.textureAmt = between(25, 75);
    s.grain = between(8, 55); s.vignette = between(15, 75);
  }
  repair(s, hard, rnd, pick, between, chance, locks);
  return s;
}

/* ---------- layout: a preset with some play, or a freeform stack ---------- */
/* Presets as dealt: the familiar ones a little more often than the special ones. */
const LAYOUT_DECK = deck([["classic", 2], ["centred", 2], ["right", 1], ["poster", 2], ["quiet", 1], ["flipped", 1], ["stacked", 1],
  ["giant", 1], ["corner", 1], ["spine", 1], ["lowband", 1], ["topheavy", 1]]);
function layout(s, rnd, pick, between, chance, dealt) {
  s.titleAlign = s.artistAlign = s.footerAlign = s.motifAlign = ""; s.titleX = s.artistX = s.footerX = s.motifX = 0;
  s.titleBleed = false; s.titleRotate = "none";
  s.artistRotate = chance(0.1) ? pick(["left", "right"]) : "none";
  const rotated = s.artistRotate !== "none";
  s.footerPos = !rotated && chance(0.15) ? "top" : "bottom";
  if (chance(0.55)) {
    const name = (dealt || ((k, l) => pick(l)))("layout", LAYOUT_DECK.filter(n => LAYOUTS[n])), L = LAYOUTS[name]; LAYOUT_KEYS.forEach(k => { if (k in L) s[k] = L[k]; });
    if (s.titleRotate !== "none") { s.artistRotate = "none"; if (chance(0.45)) s.titleRotate = "down"; }
    if (["corner", "lowband", "topheavy"].includes(name) && chance(0.3)) s.align = "right";   // (a giant title cropped on the left loses its first letters)
    s.margin = Math.max(7, Math.min(15, L.margin + between(-2, 3)));
    s.titleSize = Math.round(L.titleSize * between(88, 114) / 100); s.titleDy += between(-3, 3);
    if (L.artistY < 30) { const d = between(-2, 3, 0.5); s.artistY += d; s.motifY += d; }
    if (s.footerPos === "top") s.footerY = between(5.5, 7.5, 0.5); else s.footerY = Math.max(L.footerY, between(91.5, 95, 0.5));
  } else freeform(s, rnd, pick, between, chance);
  if (FONT[s.font] && FONT[s.font].mono) s.titleSize = Math.min(s.titleSize, 110);
  if (chance(0.16) && !s.titleBleed) s.artistAlign = s.motifAlign = pick(["left", "centre", "right"].filter(a => a !== s.align));
  if (chance(0.12)) s.footerAlign = pick(["left", "centre", "right"]);
}

/* Builds a vertical rhythm: an artist+motif block and the title, stacked in one of a few orders. */
function freeform(s, rnd, pick, between, chance) {
  s.align = pick(["left", "left", "centre", "right"]); s.margin = between(8, 14);
  s.titleSize = between(82, 128);
  s.footerY = s.footerPos === "top" ? between(5.5, 7.5, 0.5) : between(91.5, 95, 0.5);
  const T0 = Math.max(9.5, s.footerPos === "top" ? s.footerY + 5 : 0, (s.frameInset || 4) + 5);
  let B0 = s.footerPos === "top" ? 93 : s.footerY - 4.5;
  if (s.barcode && s.align !== "left") B0 = Math.min(B0, 83);
  const a = artistH(s), m = motifH(s), gap = between(1.6, 3.2, 0.1), artistFirst = !m || chance(0.7);
  const blockH = a * 1.05 + (m ? gap + m : 0);
  const putBlock = (top) => {
    if (artistFirst) { s.artistY = top + a * 0.8; s.motifY = s.artistY + a * 0.25 + gap; }
    else { s.motifY = top; s.artistY = top + m + gap + a * 0.8; }
  };
  // what the renderer needs above the title so it never shrinks it to make room
  const needAbove = () => Math.max(s.artistRotate === "none" ? s.artistY + 10.2 : 0, m ? s.motifY + m + 5.4 : 0);
  let recipe = pick(["top", "top", "top", "under", "over", "base"]);
  for (let tries = 0; tries < 6; tries++) {
    const t = titleEst(s) || { h: 0, desc: 0, above: 0 };
    let ok = true, tb;
    if (recipe === "top") {
      putBlock(T0 + between(0, 4, 0.5));
      const lo = needAbove() + t.above + t.h + between(0, 3), hi = B0 - t.desc - 1;
      tb = lo + (hi - lo) * pick([0.3, 0.55, 0.8, 1]); ok = lo <= hi;
    } else if (recipe === "under" || recipe === "base") {
      tb = T0 + between(0, 10) + t.above + t.h;
      const top = recipe === "under" ? tb + t.desc + between(4, 8) : B0 - blockH - between(0, 3);
      putBlock(top); ok = top >= tb + t.desc + 4 && top + blockH <= B0;
    } else {   // over: the block sits right above a low title
      tb = B0 - t.desc - between(0, 6); const top = tb - t.h - t.above;
      if (artistFirst) { s.motifY = top - 5.4 - (m ? m : 0) - between(0, 2, 0.5); s.artistY = m ? s.motifY - gap - a * 0.25 : top - 10.2; s.artistY = Math.min(s.artistY, top - 10.2); if (m) s.motifY = Math.max(s.motifY, s.artistY + a * 0.25 + gap); }
      else { s.artistY = top - 10.2 - between(0, 2, 0.5); s.motifY = s.artistY - a * 0.8 - gap - m; }
      ok = Math.min(s.artistY - a * 0.8, m ? s.motifY : 100) >= T0;
    }
    if (ok) {
      const pos = Object.keys(TITLE_BASE).reduce((p, q) => Math.abs(TITLE_BASE[q] - tb) < Math.abs(TITLE_BASE[p] - tb) ? q : p, "centre");
      s.titlePos = pos; s.titleDy = Math.round((tb - TITLE_BASE[pos]) * 2) / 2;
      s.artistY = Math.round(s.artistY * 10) / 10; s.motifY = Math.round(s.motifY * 10) / 10;
      return;
    }
    if (tries >= 1) recipe = "top";
    s.titleSize = Math.max(55, Math.round(s.titleSize * 0.86));
  }
  // nothing fitted (very long words): the classic stack, the renderer shrinks the title to suit
  putBlock(T0); s.titlePos = "lower"; s.titleDy = Math.round((B0 - 3 - 81.5) * 2) / 2;
}

/* ---------- picture placement ---------- */
function placePicture(s, rnd, pick, between, chance, hard) {
  const SR = window.SleeveRender; if (!SR) return;
  const r = rects(s), text = [[r.title, 1], [r.artist, 3], [r.motif, 2], [r.footer, 3], [r.year, 2], [r.barcode, 3]];
  const score = () => { const b = SR.imageBox(s, 100); return text.reduce((t, [q, w]) => t + overlap(b, q, 2) * w, 0); };
  if (s.imgMode === "panel") {
    // try corners and sizes; keep the placement that covers the least type
    let best = null;
    for (const k of [0.8, 0.9, 1, 1.12]) for (const [cx, cy] of [[1, 0], [0, 0], [1, 1], [0, 1]]) {
      const w = 37 * k, mg = 7 + rnd() * 4;
      s.imgBoxSize = Math.round(k * 100);
      s.imgBoxX = Math.round((cx ? 100 - mg - w / 2 : mg + w / 2) - 70.5); s.imgBoxY = Math.round((cy ? 100 - mg - w / 2 - 6 : mg + w / 2) - 29.5);
      const sc = score() + rnd() * 2 - k * 3;
      if (!best || sc < best.sc) best = { sc, size: s.imgBoxSize, x: s.imgBoxX, y: s.imgBoxY };
    }
    s.imgBoxSize = best.size; s.imgBoxX = best.x; s.imgBoxY = best.y;
    if (best.sc > 60) s.imgMode = "bleed";   // nowhere clean: fall back to a full-bleed picture
  } else if (s.imgMode === "split") {
    // the picture takes the half the type is not aligned to
    s.imgBoxX = s.align === "left" ? 50 : s.align === "right" ? 0 : pick([0, 50]);
    if (s.align === "centre" && !hard.layout) { s.align = s.imgBoxX ? "left" : "right"; }
  } else if (["circle", "inset", "arch"].includes(s.imgMode)) {
    s.imgBoxSize = between(82, 108); s.imgBoxY = between(-4, 4);
  }
  if (s.imgMode === "bleed") { s.dim = Math.max(s.dim, 35); s.imgBoxSize = 100; s.imgBoxX = s.imgBoxY = 0; }
}

/* ---------- repair: collisions, legibility ---------- */
function repair(s, hard, rnd, pick, between, chance, locks) {
  const a = artistH(s), m = motifH(s);
  // Artist and motif must not touch: slide the motif off the artist, keeping their order.
  if (!hard.layout && m && s.artistRotate === "none") {
    const aTop = s.artistY - a * 0.8, aBot = s.artistY + a * 0.25;
    if (s.motifY < aBot + 1.2 && s.motifY + m > aTop - 1.2) {
      if (s.motifY + m / 2 >= s.artistY - a * 0.3) s.motifY = Math.round((aBot + 1.8) * 10) / 10;
      else s.motifY = Math.round((aTop - 1.8 - m) * 10) / 10;
    }
  }
  // Footer at the top: everything else starts below it.
  if (!hard.layout && s.footerPos === "top") {
    const tops = [s.artistRotate === "none" ? s.artistY - a * 0.8 : 100, m ? s.motifY : 100, s.plate && s.platePos !== "br" ? Math.max(6, s.motifY) : 100];
    const d = s.footerY + 3.5 - Math.min(...tops);
    if (d > 0) {
      const tb = titleBottom(s);
      if (s.artistY < tb) s.artistY = Math.round((s.artistY + d) * 10) / 10;
      if (m && s.motifY < tb) s.motifY = Math.round((s.motifY + d) * 10) / 10;
    }
  }
  if (s.frame && !hard.layout && s.margin < s.frameInset + 3.5) s.margin = Math.ceil(s.frameInset + 3.5);
  // Title: clear of whatever sits below it, and of the barcode.
  if (!hard.layout) {
    const t = titleEst(s);
    if (t && t.side) {
      // sideways: the marks must fit the column beside the strip
      const r0 = rects(s), col = s.titleRotate === "up" ? 100 - s.margin - (r0.title.x + r0.title.w + 4) : r0.title.x - 4 - s.margin;
      if (!hard.motif) while (s.count > 3 && motifH(s) && motifW(s) > col) s.count--;
      if (col < 30 && s.titleSize > 60) s.titleSize = Math.max(60, Math.round(s.titleSize * 0.8));
    } else if (t) {
      const tb = titleBottom(s), below = [];
      if (s.artistRotate === "none" && s.artistY > tb) below.push(s.artistY - a * 0.8);
      if (m && s.motifY > tb) below.push(s.motifY);
      if (s.footerPos !== "top") below.push(s.footerY - 2.2);
      const r = rects(s);
      if (r.barcode && r.title && overlap(r.title, r.barcode)) below.push(r.barcode.y);
      const lim = Math.min(...below) - 2.5, over = tb + t.desc - lim;
      if (over > 0) s.titleDy = Math.round((s.titleDy - over) * 2) / 2;
      // and not pushed off the top: shrink rather than climb past the artist block
      for (let i = 0; i < 6; i++) {
        const t2 = titleEst(s), top = titleBottom(s) - t2.h - t2.above;
        const need = Math.max(8, s.artistRotate === "none" && s.artistY < titleBottom(s) ? s.artistY + 10.2 : 0, m && s.motifY < titleBottom(s) ? s.motifY + m + 5.4 : 0);
        if (top >= need - 0.5 || s.titleSize <= 50) break;
        s.titleSize = Math.max(50, Math.round(s.titleSize * 0.9));
      }
    }
  }
  // A sideways artist name runs down an edge: keep the title off it.
  if (!hard.layout && s.artistRotate !== "none") {
    const hit = () => { const q = rects(s); return overlap(q.title, q.artist, 1.5) || overlap(q.motif, q.artist, 1); };
    if (hit()) s.artistRotate = s.artistRotate === "left" ? "right" : "left";
    while (hit() && s.margin < 15) s.margin++;
    while (hit() && s.titleSize > 60) s.titleSize = Math.round(s.titleSize * 0.92);
    if (hit()) s.artistRotate = "none", s.artistY = Math.min(s.artistY, 16), s.motifY = s.artistY + artistH(s) * 0.25 + 2;
  }
  // A split picture owns one half: the type keeps to the other.
  if (s.imgMode === "split") {
    const picLeft = (s.imgBoxX || 0) < 25, free = picLeft ? "right" : "left";
    if (s.artistRotate !== "none" && !hard.layout) s.artistRotate = free;
    if (s.align !== free && !hard.layout) { s.align = free; s.artistAlign = s.motifAlign = s.titleAlign = ""; if (s.footerAlign === (picLeft ? "left" : "right")) s.footerAlign = ""; }
    else if (s.align !== free && !hard.picture && s.align !== "centre") s.imgBoxX = s.align === "left" ? 50 : 0;
  }
  // Outline and echo need size to read.
  if (!hard.type && ["outline", "echo", "stripe", "stencil"].includes(s.titleStyle)) { const t = titleEst(s); if (t && t.size < 8.5) s.titleStyle = "solid"; }
  // cut and striped letters need capitals: lower case breaks up into noise
  if (!hard.type && ["stripe", "stencil"].includes(s.titleStyle) && s.titleCase !== "upper") s.titleStyle = "solid";
  if (!hard.type && ["knockout", "split"].includes(s.titleStyle)) { const t = titleEst(s); if (t && t.size < 5.5) s.titleStyle = "solid"; }
  const r = rects(s);
  const titleCols = () => [textRgb(s, "titleColor")].concat(s.titleAccent && r.title && titleEst(s).lines > 1 ? [hexToRgb(s.accent)] : [])
    .concat(s.titleStyle === "split" ? [hexToRgb(s.titleColor === "accent" ? s.ink : s.accent)] : []);   // split's lower half is the other colour
  // Backdrop shape behind the title must not swallow it.
  if (!hard.backdrop && s.shape !== "none" && r.title) {
    const bg = hexToRgb(s.bg), rad = s.shapeSize / 2;
    const shapeRect = () => R(s.shapeX - rad, s.shapeY - rad, rad * 2, s.shape === "half" ? rad : rad * 2);
    const checks = [[r.title, s.titleStyle === "block" ? [] : titleCols(), 2.6], [r.artist, [textRgb(s, "artistColor")], 3], [r.footer, [textRgb(s, "footerColor")], 2.4]];
    // detailed shapes (and any shape carrying a pattern) never sit behind the title; plain ones may if the colours hold
    const busy = BUSY_SHAPES.has(s.shape) || (s.pattern !== "none" && s.patternArea === "shape") || s.shapeOutline || ["outline", "echo"].includes(s.titleStyle);
    const plated = (el) => s.plates === "all" || (s.plates === "title" && el === r.title);
    const ok = () => !(busy && !plated(r.title) && overlap(shapeRect(), r.title, 1)) && checks.every(([q, cols, t]) => !q || plated(q) || !overlap(shapeRect(), q) ||
      cols.every(c => contrast(c, mixRgb(bg, hexToRgb(s.shapeColor === "ink" ? s.ink : s.accent), s.shapeAmt / 100)) >= t));
    // first try moving it somewhere the words aren't (off-centre and half off the edge is a classic look anyway)
    if (!ok()) {
      const spots = [[78, 22], [22, 78], [88, 10], [10, 90], [92, 92], [8, 8], [97, 50], [3, 50], [50, 3], [50, 98]];
      const start = Math.floor(rnd() * spots.length), x0 = s.shapeX, y0 = s.shapeY, z0 = s.shapeSize;
      for (const z of [z0, Math.min(z0, 58), Math.min(z0, 44)]) {
        s.shapeSize = z;
        for (let i = 0; i < spots.length && !ok(); i++) { [s.shapeX, s.shapeY] = spots[(start + i) % spots.length]; }
        if (ok()) break;
      }
      if (!ok()) { s.shapeX = x0; s.shapeY = y0; s.shapeSize = z0; }
    }
    if (!ok()) s.shapeColor = s.shapeColor === "ink" ? "accent" : "ink";
    while (!ok() && s.shapeAmt > 30) s.shapeAmt -= 5;
    // stripes behind the title only ever look busy
    if (!ok()) s.shape = "none";
  }
  // a pattern that lived inside a shape that's gone fills the ground instead (and is quietened below)
  if (s.shape === "none" && s.patternArea === "shape" && !hard.backdrop) s.patternArea = "full";
  if (!hard.backdrop && s.wash !== "none") {
    const bg = hexToRgb(s.bg), ac = hexToRgb(s.accent), cols = titleCols();
    const want = ["outline", "echo"].includes(s.titleStyle) ? 4 : 3;
    while (s.washAmt > 15 && cols.some(tc => contrast(tc, mixRgb(bg, ac, 0.9 * s.washAmt / 100)) < want)) s.washAmt -= 5;
  }
  // Pattern behind type: keep it quiet where the words are (loudness = strength × how busy it is).
  if (!hard.backdrop && s.pattern !== "none") {
    const P0 = patternList().find(x => x.id === s.pattern), busy = P0 ? P0.busy ?? 0.5 : 0.5;
    const area = patternRect(s), hollow = ["outline", "echo", "stripe", "stencil", "knockout"].includes(s.titleStyle);
    const under = (q) => q && (s.patternArea === "shape" ? overlap(R(s.shapeX - s.shapeSize / 2, s.shapeY - s.shapeSize / 2, s.shapeSize, s.shapeSize), q) : area.some(a => overlap(a, q)));
    const titlePlated = s.plates === "all" || s.plates === "title", allPlated = s.plates === "all";
    const loudTitle = r.title && under(r.title) && s.titleStyle !== "block" && !titlePlated;
    const smallUnder = !allPlated && (under(r.artist) || under(r.footer) || under(r.year) || under(r.motif));
    const cap = loudTitle ? (hollow || FINE.has(s.font) ? 0.12 : 0.2) : smallUnder ? 0.3 : 1;
    if (busy * s.patternAmt / 100 > cap) s.patternAmt = Math.max(8, Math.floor(cap / busy * 100));
    if (loudTitle && hollow && busy > 0.6 && !hard.type) s.titleStyle = "solid";
  }
  // Type over the picture: dim it (or re-tone it) until the worst spot still reads.
  if (!hard.picture && window.SleeveRender) {
    const box = SleeveRender.imageBox(s, 100);
    const needs = () => {
      const n = [];
      if (r.title && s.titleStyle !== "block" && overlap(box, r.title)) {
        const t = titleEst(s), want = (["outline", "echo", "stripe", "stencil"].includes(s.titleStyle) ? 4 : t.size < 9 ? 3.5 : 3) + (FINE.has(s.font) ? 0.7 : 0);
        titleCols().forEach(c => n.push([c, want]));
      }
      if (r.artist && overlap(box, r.artist)) n.push([textRgb(s, "artistColor"), 3.5]);
      if (r.footer && overlap(box, r.footer)) n.push([textRgb(s, "footerColor"), 2.4]);
      return n;
    };
    // echo's ghost lines get lost in a photo
    if (!hard.type && s.titleStyle === "echo" && r.title && overlap(box, r.title)) s.titleStyle = "shadow";
    let need = needs();
    // A spot-coloured line over the picture rarely holds up: go back to ink before dimming everything.
    if (!hard.type && need.length) {
      const ink = hexToRgb(s.ink), weak = (c) => c[0] !== ink[0] || c[1] !== ink[1] || c[2] !== ink[2];
      if (need.some(([c, t]) => weak(c) && picContrast(s, c, s.imgMode === "bleed" ? 70 : 100) < t)) {
        if (r.title && overlap(box, r.title)) { s.titleColor = "ink"; s.titleAccent = false; }
        if (r.artist && overlap(box, r.artist)) s.artistColor = "ink";
        if (r.footer && overlap(box, r.footer)) s.footerColor = "ink";
        need = needs();
      }
    }
    if (need.length) {
      const cap = s.imgMode === "bleed" ? 85 : 100;
      const dimFor = () => { let d = s.dim; while (d < cap && need.some(([c, t]) => picContrast(s, c, d) < t)) d += 5; return Math.min(cap, d); };
      let d = dimFor();
      if (d >= cap - 10 && !locks.picture) {
        const tone0 = s.imgTone; let best = [d, tone0];
        for (const tone of ["accent", "ink", "original"]) { s.imgTone = tone; const dd = dimFor(); if (dd < best[0] - 5) best = [dd, tone]; }
        s.imgTone = best[1]; d = best[0];
      }
      // still short at full dim: hollow title styles go solid
      if (!hard.type && ["outline", "echo"].includes(s.titleStyle) && need.some(([c, t]) => picContrast(s, c, d) < t)) { s.titleStyle = "solid"; need = needs(); d = dimFor(); }
      s.dim = d;
    }
  }
  // Label mark and catalogue plate: only where there is room.
  if (!hard.border) {
    const name = String(s.label || "").trim();
    if (s.labelMark !== "logo") {
      s.labelMark = "none";
      if (name && chance(0.3)) {
        const kind = pick(["text", "text", "box", "stamp"]), k = between(80, 110, 5) / 100;
        const w = kind === "stamp" ? 8.4 * k : Math.min(40, [...name].length * 1.45 * k * 0.9 + (kind === "box" ? 2.4 * k : 0)), h = kind === "stamp" ? 8.4 * k : 3 * k;
        const busy = Object.values(rects(s));
        const spots = [[100 - s.margin - w / 2, 100 - s.margin * 0.75 - h / 2], [s.margin + w / 2, 100 - s.margin * 0.75 - h / 2],
          [100 - s.margin - w / 2, s.margin * 0.75 + h / 2], [s.margin + w / 2, s.margin * 0.75 + h / 2]];
        const start = Math.floor(rnd() * 4);
        for (let i = 0; i < 4; i++) {
          const [cx, cy] = spots[(start + i) % 4];
          // and never on a loud pattern strip
          const loud = s.pattern !== "none" && s.patternArea !== "shape" &&
            (((patternList().find(x => x.id === s.pattern) || {}).busy ?? 0.5) * s.patternAmt / 100 > 0.15);
          if (busy.every(b => !overlap(R(cx - w / 2, cy - h / 2, w, h), b, 2)) && !(loud && patternRect(s).some(a => overlap(a, R(cx - w / 2, cy - h / 2, w, h), 1)))) {
            s.labelMark = kind; s.labelSize = Math.round(k * 100); s.labelX = Math.round(cx * 2) / 2; s.labelY = Math.round(cy * 2) / 2;
            s.labelColor = chance(0.25) ? "accent" : "ink"; s.labelOpacity = between(60, 90, 5); break;
          }
        }
      }
    }
    s.plate = false;
    if (String(s.catalog || s.plateText || "").trim() && chance(0.14)) {
      const busy = Object.values(rects(s)), label = s.labelMark !== "none" ? R(s.labelX - 5, s.labelY - 5, 10, 10) : null;
      const w = Math.min(30, [...String(s.plateText || s.catalog)].length * 1.6 * 0.9 + 2.4);
      const tr = R(100 - s.margin - w, Math.max(6, s.motifY), w, 3.2);
      if (busy.every(b => !overlap(tr, b, 2)) && !overlap(tr, label, 2)) { s.plate = true; s.platePos = "tr"; }
      else if (s.footerPos !== "top") {
        const br = R(100 - s.margin - w, (r.barcode ? r.barcode.y - 1.4 : 93.5) - 3.2, w, 3.2);
        if (busy.filter(b => b !== r.footer).every(b => !overlap(br, b, 1.5)) && !overlap(br, label, 2)) { s.plate = true; s.platePos = "br"; }
      }
    }
  }
}

/* "More like this": a clear step in one direction (palette, type, layout or picture), sometimes with a lighter
   change to motif, border or backdrop. Colour and type changes stay related half the time. */
const GROUPS = ["colour", "type", "layout", "motif", "border", "backdrop", "picture"];
/* Which settings belong to which group, for laying "keep mine" over a saved look. */
const GROUP_KEYS = {
  colour: ["bg", "ink", "accent", "paletteName"],
  type: ["font", "bodyFont", "artistFont", "artistCase", "artistColor", "artistWeight", "artistTrack", "artistSize", "titleStyle", "titleColor", "titleCase",
    "leading", "tracking", "titleAccent", "footerColor", "footerOpacity", "footerSize", "footerTrack", "footerCase"],
  layout: ["align", "margin", "artistY", "motifY", "titlePos", "titleDy", "titleSize", "footerY", "footerPos", "titleAlign", "artistAlign", "footerAlign", "motifAlign",
    "titleX", "artistX", "footerX", "motifX", "artistRotate", "titleBleed", "titleRotate"],
  motif: ["motifKind", "motifSize", "motifPitch", "count", "missing", "missingStyle"],
  border: ["frame", "frameStyle", "frameInset", "frameWidth", "frameOpacity", "frameColor", "barcodeStyle"],
  backdrop: ["plates", "wash", "washAmt", "shape", "shapeAmt", "shapeSize", "shapeX", "shapeY", "shapeColor", "shapeOutline", "shapeRot", "pattern", "patternAmt", "patternScale",
    "patternAngle", "patternArea", "patternPos", "patternColor", "patternSeed", "texture", "textureAmt", "grain", "vignette"],
  picture: ["imgMode", "imgTone", "dim", "imgPosterize", "imgContrast", "imgBlur", "imgBoxSize", "imgBoxX", "imgBoxY", "imgEffect"],
};
/* A saved look with the locked groups taken from `mine` instead. */
function keepMine(look, mine, locks) {
  const o = { ...look };
  for (const g of GROUPS) if (locks[g]) for (const k of GROUP_KEYS[g]) if (k in mine) o[k] = mine[k];
  return o;
}
function mutate(state, seed, locks = {}, opts = {}) {
  const rnd = mulberry32((seed * 40503 + 17) >>> 0);
  const major = [["colour", 3], ["type", 3], ["layout", 2.5], ["picture", 1.5]].filter(([g]) => !locks[g]);
  const minor = ["motif", "border", "backdrop"].filter(g => !locks[g]);
  if (!major.length && !minor.length) return { ...state };
  const change = new Set(), wpick = (list) => { let t = rnd() * list.reduce((a, [, w]) => a + w, 0); for (const [g, w] of list) if ((t -= w) <= 0) return g; return list[0][0]; };
  if (major.length) change.add(wpick(major));
  if (major.length > 1 && rnd() < 0.15) change.add(wpick(major.filter(([g]) => !change.has(g))));
  if (minor.length && (!major.length || rnd() < 0.5)) change.add(minor[Math.floor(rnd() * minor.length)]);
  const keep = Object.fromEntries(GROUPS.map(g => [g, !change.has(g)]));
  const o = { ...opts, hard: locks };
  if (change.has("colour") && rnd() < 0.5) {
    // a sibling palette: same family of ground, hue nudged
    const bg = hexToRgb(state.bg), [h] = rgbToHsl(bg), L = SP.relLum(bg);
    o.hue = (h + (rnd() * 70 - 35) + 360) % 360; o.paletteMode = L < 0.06 ? "dark" : L > 0.45 ? "light" : "bold";
  }
  if (change.has("type") && (!opts.feel || opts.feel === "any") && rnd() < 0.5 && FONT[state.font]) o.feel = FONT[state.font].feel;
  const s = randomize(state, seed * 7 + 3, keep, o);
  const nudge = (k, d, lo, hi) => { if (typeof s[k] === "number") s[k] = Math.max(lo, Math.min(hi, Math.round(s[k] + (rnd() * 2 - 1) * d))); };
  if (!locks.backdrop) { nudge("grain", 8, 0, 100); nudge("vignette", 8, 0, 100); }
  return s;
}

// Every face the renderers can use, loaded once per page.
if (!document.querySelector("link[data-looks-fonts]")) {
  const l = document.createElement("link"); l.rel = "stylesheet"; l.href = GOOGLE_CSS; l.dataset.looksFonts = "1"; document.head.appendChild(l);
}

window.Looks = { dealer, patternRect, GROUP_KEYS, keepMine, PALETTES, FONTS, FONT, BODY_FONTS, GOOGLE_CSS, LAYOUTS, LAYOUT_KEYS, FRAME_STYLES, MOTIFS, MOODS, FEELS, GROUPS, moodsOf, makePalette, randomize, mutate };
})();
