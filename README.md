# Sleeve Press

Small, fast, predictable tools for making a release's cover art, tracklist and Suno prompts. Nothing is AI-generated: everything is rule-based, seeded and repeatable, so the same input always gives the same output.

Plain HTML, CSS and JavaScript. No build step, no dependencies. Open `index.html`, or host the folder anywhere static (GitHub Pages works as is).

| Page | What it does |
|---|---|
| `index.html` | **Release Desk.** Basics for the current release, import/export, "next release, keep the look". |
| `title-lab.html` | **Title Lab.** Release and track names from 14 theme word banks, 28 templates and filters (length, syllables, alliteration). Seeded; star names to teach the next batch, **Riff** on a starred name, or **Surprise** for two random themes. |
| `palette-pull.html` | **Palette Pull.** Ground / ink / spot from the cover (seeded k-means), from one colour, from a 36-palette library, or rolled (dark / light / bold) with per-role locks. Every roll clears 7:1 ink and 3:1 spot contrast. Alternatives from the same swatches, plus a plain-language colour description. |
| `sleeve-press.html` | **Sleeve Press.** The front sleeve. Seeded **Shuffle look** with group locks (colours, type, layout, motif, border, backdrop), a 12-variant gallery, undo, layout presets and saved looks. 20 faces (separate title and body face), free positioning, 8 border styles, 8 motif kinds, wash / big shape / texture layers, image blur, contrast and posterize, catalogue plate, EAN-13 barcode. |
| `tracklist.html` | **Tracklist Typesetter.** Back sleeve in the same type system, border and backdrop: single column, A/B sides, or a 4:5 card. Text/Markdown/CSV export. |
| `style-forge.html` | **Style Forge.** Suno style prompts from toggles across 38 genres. Locks, seeded shuffle, energy, trim to your character limit, exclude list, structure tags, a saved prompt bank, and per-track prompts using each track's BPM and key, with optional per-track variety. |
| `release-kit.html` | **Release Kit.** Cover sizes, back sleeve, banner, social tile, YouTube 16:9, story 9:16, vinyl centre labels per side, series strip, text files and `release.json`, zipped by catalogue number. Preflight checklist. |

## How the tools connect

Every page reads and writes one record, kept in `localStorage` and exportable at any time as `release.json` (button at the top right of every page). Change something in one tool and the others see it:

```
Title Lab ──► release.title, tracks
Palette Pull ──► palette ──► Sleeve, Tracklist, Kit (colours everywhere)
Sleeve ──► release fields, sleeve look (face, grain, frame…) ──► Tracklist, Kit
Tracklist ──► tracks (title, feat, bpm, key, length, side) ──► Style Forge, Kit
Style Forge ──► style prompt / exclude / structure / per-track batch ──► Kit
Cover image ── shared by Palette Pull, Sleeve, Tracklist (ghost), Kit
```

`release.json` is also the portable format: import it on another machine or browser and everything, cover image included, is back where you left it.

> **Opening from disk:** browsers differ on whether `file://` pages share storage. If the tools don't seem to share state, serve the folder (`python3 -m http.server`) or move a release between pages with Export / Import.

## `release.json` (`sleevepress.release/1`)

```jsonc
{
  "schema": "sleevepress.release/1",
  "release": { "artist": "", "title": "NINE\nNIGHT", "catalog": "", "year": "", "footer": "", "format": "EP" },
  "palette": { "bg": "#15120f", "ink": "#ece6da", "accent": "#9b1b1e", "name": "", "swatches": [], "words": "" },
  "tracks":  [ { "title": "", "feat": "", "bpm": "", "key": "", "length": "3:41", "side": "A" } ],
  "sleeve":  { /* Sleeve Press settings: motif, type, image mode, barcode, … */ },
  "typeset": { /* Tracklist settings: layout, numbering, columns, credits, … */ },
  "style":   { "form": { /* Style Forge state */ }, "prompt": "", "exclude": "", "structure": "", "batch": [] },
  "names":   { "shortlist": [], "seed": 1, "opts": {} },
  "kit":     { "series": [], "sizes": null },
  "looks":   [ { "name": "", "look": { /* sleeve settings + bg/ink/accent */ } } ],
  "image":   { "dataUrl": "data:image/jpeg;base64,…", "name": "", "w": 0, "h": 0 }   // export only
}
```

Unknown or missing keys fall back to defaults, so older files keep loading as the schema grows.

## Layout

```
index.html, title-lab.html, palette-pull.html, sleeve-press.html,
tracklist.html, style-forge.html, release-kit.html
shared/press.css            house style
shared/press.js             release store, cover image, import/export, nav, helpers, track parser
shared/looks.js             palette library, font table, layout presets, palette roller, look randomizer
shared/sleeve-render.js     front-sleeve renderer, border and backdrop layers (used by every page that draws)
shared/tracklist-render.js  back-sleeve renderer and text exports (used by Tracklist, Kit)
```

Fonts load from Google Fonts; offline, the renderers fall back to system sans-serif.
