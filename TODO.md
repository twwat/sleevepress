# To do

Top item first. Tick each with the commit that finished it: `- [x] item (abc1234)`.

## Open

- [ ] New patterns and textures are waiting for verdicts on the review page (batches 1–4). Integrate only the ones marked keep; rework notes go below as items.
  - Before committing any hardware pattern: its longest step at a 3000 px export is 0.45–1.2 s (existing patterns ~0.3 s), from the full-sleeve light compositing.
  - Before committing any cloth texture: add the new ids to the Design view's texture picker (`shared/view-design.js`), and run the memory-budget test with a texture on.
  - Ghosts' longest export step is 0.58 s rotated; look at it if kept.
- [ ] Pattern ideas not built yet: drip and halo (agent still working), paisley, tie-dye spiral, tunnel (bloom with a vanishing point), kaleidoscope and glitch as picture effects, rainbow-outline title style, patterns driven by the track list (bloom points = tracks, rings = track lengths).
- [ ] Review branch `claude/jolly-brahmagupta-5certj` before it goes to `main` (fixes, tests, and four agents' work). Not yet read line by line:
  - `shared/patterns.js` changes (cache sizes, tile-direct drawing, stepped builds)
  - accessibility changes in `shared/view-design.js`, `shared/view-forge.js`, `shared/view-titles.js`
  - release-day code in `shared/view-export.js` and `shared/view-print.js`, except the store check
- [ ] Discover never drops cards: after a long scroll there are ~1000 cards, each holding an image. Keep memory bounded without losing scroll position, ♥ state or keyboard focus. (Work was started in a local agent branch that was never pushed or reviewed; start fresh from the reviewed branch.)
- [ ] Two tabs share one stored cover picture: opening a different release in one tab can leave the other saving with the wrong picture.
- [ ] Halftone and riso picture effects at export size run as one ~100–190 ms block. Split them so the page stays responsive.
- [ ] Export: the placeholder text in a faded (unticked) preview is 2.6:1 contrast.
- [ ] Disc label: a very long title becomes very small on one line. Consider two lines that fit below the hub ring.

## Done
