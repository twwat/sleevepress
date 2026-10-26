# Sleeve Press

Cover art, print pieces and promo images for a release, all from one set of words and one look. It's not generative AI: everything is drawn in your browser from seeded rules, so the same settings always give the same picture. Open `index.html` (any static host, or straight from disk) and go.

## Sections

| Section | What it's for |
|---|---|
| **Discover** | An endless grid of designs for your release, one per seed. ♥ the ones you like, open one in Design, or ask for "more like this". Filter by mood (dark, light, bold, mono, warm, cool) and type feel, and keep parts of your current design fixed. |
| **Design** | The sleeve editor. Click anything on the cover (title, artist, footer, marks, label, picture, background) to edit just that thing. Drag to move it, double-click words to retype them in place, and Ctrl/⌘ + scroll to zoom the picture. Shuffle, Variations and ♥ Flag sit above the cover. |
| **Print** | Exact-size PDFs: CD booklet (single or folded), tray inlay with spines, card wallet, CD disc label, vinyl centre labels, and a sticker sheet. Crop marks, bleed and fold lines, on A4 or US Letter, with a grid mode for pre-cut label sheets. Print at 100% / Actual size. |
| **Export** | Release-day files: streaming covers, back cover, promo designs (release post, story, YouTube thumbnail, video still, header banner, countdown teaser), the tracklist, a YouTube description with chapter timestamps, Suno prompts and the palette. Download one at a time or as a zip. |
| **Library** | Saved releases (with their pictures), flagged looks, your record label name and logo, a catalogue sheet of everything you've saved, and back up / restore. |
| Titles, Suno style | Word tools: a seeded title brainstormer and a Suno style-prompt builder. They share the same release. |

## Saving

- Your current release autosaves in this browser as you work. The dot in the top bar says whether the browser is keeping it.
- **Save** (or Ctrl/⌘ + S) puts a copy in your Library. Open it again any time; "Next in series" starts the next catalogue number with the same look and label.
- **Library → Back up everything** writes one JSON file with every saved release, picture, flagged look and your logo. Restore it on any machine.
- `release.json` (Library or Export) carries a single release, picture included.

If the browser won't store anything (some private windows, or opening the file from disk in Firefox), the dot turns amber. Everything still works for the session; back up before you close the tab.

## Files

```
index.html                  the app (loads everything below)
shared/press.js             SP: the release record, storage (localStorage + IndexedDB), pictures, library, track parser, utilities
shared/looks.js             Looks: palettes, faces, layout presets, moods, the seeded randomizer and "more like this"
shared/sleeve-render.js     SleeveRender: the front sleeve (returns hit boxes for the editor)
shared/tracklist-render.js  TracklistRender: the back sleeve
shared/makers.js            Makers: print pieces and promo designs
shared/pdf.js               PDF writer and zip writer
shared/app.js               App: shell, routing, undo, flagging, saving
shared/view-*.js / .css     one file pair per section
```

## The release record

One JSON object (`schema: "sleevepress.release/1"`) with sections `release` (artist, title, catalog, year, footer, format, label, date, cta, links), `palette` (bg, ink, accent, name), `tracks`, `sleeve` (every look and position setting), `typeset` (back sleeve), `style` and `names` (word tools), `print`, `promo`, and `looks` (flagged looks). Unknown or missing keys fall back to defaults, so older files still open.
