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
];
const FONT = Object.fromEntries(FONTS.map(f => [f.n, f]));
const BODY_FONTS = ["Archivo", "Inter Tight", "Space Grotesk", "Barlow Condensed", "Oswald", "Space Mono", "IBM Plex Mono", "DM Serif Display", "Fraunces"];
const GOOGLE_CSS = "https://fonts.googleapis.com/css2?" + [
  "Archivo:wght@500;600;700;800", "Inter+Tight:wght@600;700;800", "Space+Grotesk:wght@500;700", "Syne:wght@700", "Barlow+Condensed:wght@600;700",
  "Oswald:wght@500;700", "Bebas+Neue", "Anton", "League+Gothic", "Big+Shoulders+Display:wght@700", "Archivo+Black", "Unbounded:wght@700",
  "Rubik+Mono+One", "DM+Serif+Display", "Playfair+Display:wght@700", "Bodoni+Moda:wght@700", "Fraunces:wght@700", "Cormorant+Garamond:wght@600",
  "Space+Mono:wght@700", "IBM+Plex+Mono:wght@400;500",
].map(f => "family=" + f).join("&") + "&display=swap";

/* ---------- layout presets: only positional keys, so they combine freely with colour and type ---------- */
const LAYOUT_KEYS = ["align", "margin", "artistY", "motifY", "titlePos", "titleDy", "titleSize", "footerY"];
const LAYOUTS = {
  classic: { label: "Classic", align: "left", margin: 11, artistY: 15.8, motifY: 20.6, titlePos: "centre", titleDy: 0, titleSize: 100, footerY: 92.2 },
  centred: { label: "Centred", align: "centre", margin: 11, artistY: 15.8, motifY: 20.6, titlePos: "centre", titleDy: 0, titleSize: 100, footerY: 92.2 },
  right: { label: "Right hand", align: "right", margin: 11, artistY: 15.8, motifY: 20.6, titlePos: "centre", titleDy: 0, titleSize: 100, footerY: 92.2 },
  poster: { label: "Poster", align: "left", margin: 8, artistY: 11, motifY: 15.5, titlePos: "lower", titleDy: -1, titleSize: 128, footerY: 94.5 },
  quiet: { label: "Quiet", align: "centre", margin: 14, artistY: 61, motifY: 65.5, titlePos: "centre", titleDy: -15, titleSize: 62, footerY: 91 },
  flipped: { label: "Flipped", align: "left", margin: 11, artistY: 84, motifY: 77, titlePos: "upper", titleDy: -2, titleSize: 100, footerY: 93 },
  stacked: { label: "Stacked low", align: "right", margin: 9, artistY: 44, motifY: 49, titlePos: "lower", titleDy: 3, titleSize: 110, footerY: 94.5 },
};

const FRAME_STYLES = ["hairline", "double", "thick", "corners", "dashed", "inset", "round", "crop"];
const MOTIFS = ["bars", "dots", "squares", "rings", "diamonds", "ticks", "wave", "slants"];

/* ---------- colour generation ---------- */
const hsl = (h, s, l) => hslToRgb([h, Math.max(0, Math.min(1, s)), Math.max(0, Math.min(1, l))]);
function push(h, s, l, against, target, towardLight) {
  for (let i = 0; i < 90 && contrast(hslToRgb([h, s, l]), against) < target; i++) l = towardLight ? Math.min(1, l + 0.01) : Math.max(0, l - 0.01);
  return hslToRgb([h, s, l]);
}
/* Rolls a palette that always clears 7:1 for ink and 3:1 for the spot. mode: dark | light | bold | any */
function makePalette(rng, mode = "any", hue) {
  const pick = (a) => a[Math.floor(rng() * a.length)];
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
  let spot = hsl(h + off, 0.55 + rng() * 0.35, 0.4 + rng() * 0.18);
  const [sh, ss, sl] = rgbToHsl(spot); spot = push(sh, ss, sl, bg, 3.1, bgDark);
  return { bg: rgbToHex(bg), ink: rgbToHex(ink), accent: rgbToHex(spot), name: "Rolled" };
}

/* ---------- the randomizer ----------
   locks: { colour, type, layout, motif, border, backdrop }  true = leave that group alone. */
function randomize(state, seed, locks = {}) {
  const rnd = mulberry32((seed * 2654435761) >>> 0 || 1), pick = (a) => a[Math.floor(rnd() * a.length)];
  const between = (a, b, step = 1) => Math.round((a + rnd() * (b - a)) / step) * step;
  const chance = (p) => rnd() < p;
  const s = { ...state };

  if (!locks.colour) {
    const p = chance(0.4) ? pick(PALETTES) : makePalette(rnd);
    s.bg = p.bg; s.ink = p.ink; s.accent = p.accent; s.paletteName = p.name;
  }
  if (!locks.type) {
    s.font = pick(FONTS).n;
    s.bodyFont = chance(0.5) ? "" : pick(BODY_FONTS);
    s.titleSize = between(86, 124); s.tracking = between(-4, 8);
    s.artistTrack = between(18, 42); s.artistSize = between(85, 130, 5); s.footerSize = between(90, 125, 5);
    s.titleCase = pick(["upper", "upper", "upper", "title", "lower"]);
    s.leading = between(78, 100); s.titleAccent = chance(0.25);
    if (FONT[s.font].mono) { s.tracking = between(-2, 2); s.titleSize = Math.min(s.titleSize, 110); }
  }
  if (!locks.layout) {
    const L = LAYOUTS[pick(Object.keys(LAYOUTS))]; LAYOUT_KEYS.forEach(k => { s[k] = L[k]; });
    s.margin = between(8, 14); s.titleDy += between(-3, 3);
    s.footerPos = chance(0.15) ? "top" : "bottom"; if (s.footerPos === "top") s.footerY = between(6, 9);
  }
  if (!locks.motif) {
    s.motifKind = chance(0.1) ? "none" : pick(MOTIFS);
    s.count = between(3, 16); s.missing = chance(0.5) ? 0 : between(1, s.count);
    s.missingStyle = pick(["outline", "filled", "gap"]);
    s.motifSize = between(75, 150, 5); s.motifPitch = between(85, 170, 5);
  }
  if (!locks.border) {
    s.frame = chance(0.8); s.frameStyle = pick(FRAME_STYLES); s.frameInset = between(3, 7, 0.5);
    s.frameWidth = between(80, 220, 10); s.frameOpacity = between(14, 55); s.frameColor = chance(0.8) ? "ink" : "accent";
  }
  if (!locks.backdrop) {
    s.wash = chance(0.35) ? pick(["top", "bottom", "radial", "diagonal"]) : "none"; s.washAmt = between(25, 70);
    s.shape = chance(0.4) ? pick(["circle", "ring", "square", "half", "bars"]) : "none";
    s.shapeAmt = between(40, 95); s.shapeSize = between(35, 90); s.shapeX = between(20, 85); s.shapeY = between(20, 80);
    s.shapeColor = chance(0.75) ? "accent" : "ink";
    s.texture = chance(0.3) ? pick(["halftone", "lines", "grid"]) : "none"; s.textureAmt = between(25, 75);
    s.grain = between(8, 55); s.vignette = between(15, 75);
  }
  return s;
}

// Every face the renderers can use, loaded once per page.
if (!document.querySelector("link[data-looks-fonts]")) {
  const l = document.createElement("link"); l.rel = "stylesheet"; l.href = GOOGLE_CSS; l.dataset.looksFonts = "1"; document.head.appendChild(l);
}

window.Looks = { PALETTES, FONTS, FONT, BODY_FONTS, GOOGLE_CSS, LAYOUTS, LAYOUT_KEYS, FRAME_STYLES, MOTIFS, makePalette, randomize };
})();
