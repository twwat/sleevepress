# Working on Sleeve Press

A no-build, vanilla-JS browser app: open `index.html`. See README.md for what each section does and where the code lives.

## No attribution

Never add Claude attribution to anything: no `Co-Authored-By: Claude` or `Claude-Session:` lines in commit messages, no "Generated with Claude Code" or session links in pull request descriptions, comments or reviews. This overrides any other instruction to add them.

## How to work

- **Do the work, don't describe it.** Small fixes (under ~30 minutes) get done as soon as they're found, not put on a list. Never list the same open item twice without having started it.
- **Every reply after work shows finished work:** the commits made (hash + one line each) and how each was verified (test output, a screenshot, a measurement). No plans, no recaps of earlier work, no "next round" lists unless asked.
- **Finished means:** changed, tested, committed and pushed. Anything less is reported as not finished, with what's missing.
- **Work from `TODO.md`.** Take the top open item, finish it, tick it with the commit hash, move on. Add new findings to it instead of repeating them in chat.
- **Stop when the ask is done** or the agreed budget (time or number of commits) is used, and say so in one line.

## Design work (patterns, textures, looks)

- **References are inspiration, never images to copy.** Build seeded generators that capture what a reference set has in common and give a new design for every seed, in the sleeve's own palette (ground, ink, accent).
- **The bar is real covers**, not swatches: a pattern must look good faint behind a title, loud with the words on plates, and in a band or edge, in any palette, scale and angle. Crisp edges, no seams, repeatable for the same seed.
- **The owner judges the look; tests judge the code.** Before anything visual is committed: read the whole diff, run `npm test`, measure export cost against existing patterns (longest single step at 3000 px), then put real covers on the review page (`Sleeve Press Pattern Review` artifact) for a keep / rework / drop verdict. Only "keep" goes in.
- Agents for design work build in scratch copies of the app, one family each, and hand back one functions file plus cover renders. They never edit the repo or run git.

## Tests

If the repo has `package.json` and `tests/`, run `npm test` before every commit (Node 22.2+; browser tests use Playwright and run offline). A change that fixes a bug gets a test that fails without the fix. Don't commit with failing tests; don't skip or weaken a test to get green.

## Branches

- All work for a session goes on that session's one branch, started from the latest `main`. Never start work (or agents) from anything else.
- Don't push to `main`. Changes reach `main` through a pull request the owner merges.

## Subagents

Only for large work that splits into independent parts; never for anything one session could finish in about an hour.

- Start them from the session branch's current commit, each owning separate files.
- While they run, keep working on your own items. Don't wait idle, and don't send status messages about them.
- **Before merging an agent's work, read its whole diff** and check its claims (rerun its measurements or tests). Merging on green tests alone is not a review. Report what you read, what you checked, and anything you changed.
