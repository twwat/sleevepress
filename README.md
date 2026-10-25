# Sleeve Press

Small, fast, predictable tools for making a release's cover art, tracklist and Suno prompts. Nothing is AI-generated: everything is rule-based, seeded and repeatable, so the same input always gives the same output.

Plain HTML, CSS and JavaScript. No build step, no dependencies. Open `index.html`, or host the folder anywhere static (GitHub Pages works as is).

| Page | What it does |
|---|---|
| `index.html` | **Release Desk.** Basics for the current release, import/export, "next release, keep the look". |
| `title-lab.html` | **Title Lab.** Release and track names from theme word banks, templates and filters (length, syllables, alliteration). Seeded; star names to teach the next batch. |
| `palette-pull.html` | **Palette Pull.** Ground / ink / spot from the cover (seeded k-means) or from one colour, with contrast checks and a plain-language colour description. |
| `sleeve-press.html` | **Sleeve Press.** The front sleeve: motif, type, image toning, catalogue plate, EAN-13 barcode. |
| `tracklist.html` | **Tracklist Typesetter.** Back sleeve in the same type system: single column, A/B sides, or a 4:5 card. Text/Markdown/CSV export. |
| `style-forge.html` | **Style Forge.** Suno style prompts from toggles. Locks, seeded shuffle, trim to your character limit, exclude list, structure tags, per-track prompts using each track's BPM and key. |
| `release-kit.html` | **Release Kit.** Cover sizes, back sleeve, banner, social tile, series strip, text files and `release.json`, zipped by catalogue number. Preflight checklist. |

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
shared/sleeve-render.js     front-sleeve renderer (used by Sleeve, Tracklist, Kit)
shared/tracklist-render.js  back-sleeve renderer and text exports (used by Tracklist, Kit)
```

Fonts load from Google Fonts; offline, the renderers fall back to system sans-serif.
