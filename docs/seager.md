# SEAGER in NPB Explorer

Based on Robert Orr’s [Quantifying the Corey Seager Approach](https://www.baseballprospectus.com/news/article/86572/the-crooked-inning-corey-seager-rangers/) (Baseball Prospectus, November 8, 2023).

SEAGER = good takes / (good takes + good swings) − hittable takes / all takes.
The app multiplies this difference by 100 and displays a unitless score (for example, 48.0), without a percent sign. The percentile rail separately shows the player’s rank.
A good swing has positive modeled swing-minus-take value; a good take has negative value.
Zero deltas are ungraded. Missing denominators produce no value.

This is an NPB adaptation, not BP’s published model or MLB scale. The article describes
the approach without supplying a reproducible fitted model. We use the app’s existing
NPB outcome weights and count values, with the following explicit modeling choices:

- Fit each season separately, using regular-season pitches only.
- Use all 12 counts and the existing 10 × 10 pitch-location grid.
- Estimate swing run value from actual count transitions and terminal outcomes.
- Estimate called-strike probability from ordinary takes, then compute take value
  from the probability-weighted values of a ball and a strike. Ball four credits a
  walk and strike three credits an out.
- Smooth a 3 × 3 neighborhood, weighting the center cell 4, orthogonal neighbors 2,
  and diagonal neighbors 1. Shrink estimates with 20 weighted observations at the
  same count’s season average. Require at least 10 unweighted observations of
  each action in the neighborhood. Unsupported locations remain ungraded.
- Exclude bunts, HBP, interference, invalid coordinates and missing counts.
  Training and grading use the same eligible pitches. Each player receives the
  season’s shared model, without a player-specific power adjustment.

The stored `sgN` is the number of graded pitches, `sgTake` all graded takes,
`sgHitTake` hittable takes, `sgGoodTake` good takes, and `sgGoodSwing` good swings.
These fields preserve zero values. Legacy season files without these fields show
no SEAGER value; rebuild data to populate them.

Adding the batting stat to the existing Advanced group places its percentile in
the top-left Hitting block and exposes it in leaderboards, comparisons and season
tables through the shared stat registry. No separate section is added.

Checks:

```sh
node --experimental-strip-types --test scripts/seager.test.mjs
npm run data:build
npm run build
npm run lint
```
