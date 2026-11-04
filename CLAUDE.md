# Working on Sleeve Press

A no-build, vanilla-JS browser app: open `index.html`. See README.md for what each section does and where the code lives.

## How to work

- **Do the work, don't describe it.** Small fixes (under ~30 minutes) get done as soon as they're found, not put on a list. Never list the same open item twice without having started it.
- **Every reply after work shows finished work:** the commits made (hash + one line each) and how each was verified (test output, a screenshot, a measurement). No plans, no recaps of earlier work, no "next round" lists unless asked.
- **Finished means:** changed, tested, committed and pushed. Anything less is reported as not finished, with what's missing.
- **Work from `TODO.md`.** Take the top open item, finish it, tick it with the commit hash, move on. Add new findings to it instead of repeating them in chat.
- **Stop when the ask is done** or the agreed budget (time or number of commits) is used, and say so in one line.

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
