# tools

Both scripts write standalone animated SVGs into `dist/`. Everything animates
with CSS keyframes inside the SVG, because GitHub strips `<script>` from
rendered images and strips `<style>` from README HTML.

```sh
node tools/gen-maze.mjs c127dev dist    # board, dark + light
node tools/gen-terminal.mjs dist          # console, dark + light
```

`.github/workflows/board.yml` runs both daily and force-pushes the results to
the `output` branch, which is what `README.md` links to. Nothing is committed
to `main`.

## gen-maze.mjs

Reads the contribution calendar from `https://github.com/users/<user>/contributions`,
a public page - no token and no GraphQL scope. Falls back to a synthetic year
if that page is unreachable, so a run never fails the workflow.

The board is the calendar. The maze is a randomised DFS spanning tree, braided
so it has loops rather than nothing but dead ends. Pellet layout depends on how
busy the year is:

| | active days below 33% | 33% or above |
| --- | --- | --- |
| pellets | every day | commit days only |
| power pellets | your commit days | busiest days, capped at 6% of the board |
| empty days | pellets | plain corridor |

A quiet year needs the first layout or the board would sit untouched. Frightened
time scales with the number of power pellets, so the total stays about the same
either way.

Four chasers, arcade targeting: one goes straight at him, one aims four cells
ahead of his facing, one mirrors that through the first one, one breaks off when
it gets close. Scatter and chase phases alternate, they move at 4/5 his speed,
and they reverse when a power pellet is eaten.

He runs a BFS every tick, routes around corridors a chaser occupies or borders,
and only commits to a nearby target he provably reaches first. Distant targets
skip that test - the chasers follow him, not the pellet, so requiring a margin
out there leaves him circling instead of clearing.

Up to twelve mazes are played per run and the best game is the one published,
so a daily job never ships a loss. Positions are emitted as `steps(1, end)`
keyframes, which keeps every sprite on a cell centre instead of drifting
between them.

`dist/maze-stats.json` records what was played.

## gen-terminal.mjs

One 18 second session. The first prompt is on screen from the first frame, each
command types itself a character at a time, the caret rides the typing position,
and the last command is `clear` - the screen wipes and the loop restarts on that
same live prompt.

Text uses `textLength` with `lengthAdjust="spacingAndGlyphs"` so character
advance is exact whatever monospace font the viewer has. Without it the caret
would drift away from the text.

Edit the `lines` table at the top to change the session.
