# To do

Top item first. Tick each with the commit that finished it: `- [x] item (abc1234)`.

## Open

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
