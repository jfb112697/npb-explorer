# MLB hitter comps design

Date: 2026-10-23
Status: Approved design, pending implementation

## 1. Product contract

Add a static-site workflow that lets a user:

1. Select an NPB hitter and season and receive the closest Overall MLB player-season comp plus four alternates. The five results contain at most one season per MLB player.
2. Keep that NPB target fixed, select an eligible MLB hitter and season manually, and inspect the pair's distance, rank among eligible candidates, coverage, and feature-level explanation.
3. Open a methodology page that documents the exact model and visualization.

“Overall” follows `comparison.md`: approach, contact, and power dominate; age, defensive role, and running have lighter roles. The result answers “which MLB hitter has a similar profile?” It does not answer “what will this NPB hitter do in MLB?”

Offense-only, projection, translation-assisted, pitcher, and MLB-to-MLB comp modes are out of scope. The existing NPB `/compare` page remains unchanged in purpose.

## 2. Architecture

Use compact aggregate MLB feeds in a versioned static data build, then run one shared TypeScript model in Node and the browser.

- Node imports pure `.ts` modules with `--experimental-strip-types`. The project's Node 22 toolchain supports this, and the app TypeScript config already allows TypeScript-extension imports and erasable syntax only. No new dependency or backend is needed.
- The offline build adapts both leagues to a common schema, adjusts and normalizes profiles, estimates reliability/reference distributions, and calibrates historical distance thresholds.
- Static JSON contains normalized profiles and the information needed to display and compare them. A source/config hash identifies the model version.
- The browser uses the same pure distance and explanation functions for a manually selected pair. A module Web Worker performs automatic ranking and weight sensitivity without blocking interaction.
- The UI never calls MLB services live. A deployed result therefore does not depend on browser CORS, upstream rate limits, or later upstream revisions.
- The build does not precompute every NPB–MLB pair.

Preserve unrelated existing workspace changes, including the current Cloudflare/package work and the deleted `public/_redirects`.

## 3. Data sources and coverage

### NPB

Use the existing season/player/detail JSON produced by `scripts/build-data.mjs`, player metadata in `data/names.json`, and the already-downloaded regular-season box scores for home/road counts and team park factors. NPB targets cover 2019 through the latest available season.

### MLB

Use these public aggregate sources:

- MLB Stats API season hitting: season role, age, PA, outcome counts, and running counts.
- MLB Stats API `statSplits` with `playerPool=all` for `vl`, `vr`, `home`, and `away`: platoon and actual home/road counts.
- MLB Stats API season fielding and bulk people: defensive innings/roles, birth/bio details, and batting side.
- MLB Stats API regular-season schedule: team-game denominators and source coverage.
- Baseball Savant custom leaderboard CSV with `min=0`: discipline, contact, spray, tracking, pitch counts, sprint speed, and available Outs Above Average. Eligibility thresholds are applied by the model, not by the download. Expected stats are never matching inputs.
- Baseball Savant pitch arsenal CSV with `type=batter` and `min=0`: pitch-family PA, pitches, run value/100, and SLG.
- Baseball Savant three-year rolling park factors: component factors joined by team and season.

MLB candidates cover 2015 through the latest available regular season. Only regular-season records are used. Pitcher-only batting records are excluded by player-season role; a person-level pitcher flag must not remove a genuine two-way hitting season.

Cache completed-season responses under `.cache/mlb` and refresh the current season during normal data builds. Validate content type, schema, required fields, and ID joins so an HTML error page cannot be accepted as CSV. Record source timestamps and input hashes.

### Static outputs

- `public/data/comps/model.json`: model version, configuration, feature metadata, calibration/reference values, source timestamps, and data limitations.
- `public/data/comps/npb.json`: normalized NPB target profiles.
- `public/data/comps/mlb.json`: normalized MLB candidate profiles and MLB search/season metadata.

## 4. Common profile pipeline

Process both leagues through the same sequence: **park adjustment → shrinkage → league-season normalization → recency aggregation**.

### Park adjustment

Adjust only shared outcome components with a defensible park input: singles, doubles, triples, home runs, walks, and strikeouts.

For NPB, calculate component-specific team home-park factors from home and road box-score rates, pooling up to three trailing seasons. For MLB, use the corresponding three-year rolling Savant component indices. Regressed log factors shrink toward zero using component-specific between-park and sampling variances; rare components such as triples therefore shrink more strongly.

For each player split, leave away events unchanged and divide home events by the relevant factor. Recombine home and away counts, recompute hits/total bases and shared wOBA-style values, and expose whether a profile received full, partial, or no park adjustment. Use the same fixed linear-weight formulas for both leagues so unlike published wOBA implementations are not compared directly.

Do not claim park adjustment for tracking, pitch-location, defensive, or other fields without a common defensible adjustment. Their league-season normalization and limitations remain explicit.

### Shrinkage and reliability

Retain the numerator and denominator for every rate. Where an aggregate source publishes a rate and opportunity count but not the exact numerator, retain the published rate and effective denominator instead of fabricating integer counts. Use empirical-Bayes posteriors rather than raw small-sample extremes.

For a rate with `x` successes in `n` opportunities and league-season prior `p0`:

- Estimate the prior sample size `κ` from observed between-player variance after subtracting binomial sampling variance, pooled by league and feature with role-group checks.
- Posterior mean: `(x + κ p0) / (n + κ)`.
- Carry the beta posterior variance and reliability `n / (n + κ)` into the distance calculation.

For continuous features, fit a normal variance-components approximation. Estimate `κ` from weighted adjacent-season reliability at the observed median denominator when at least 30 eligible pairs exist. New tracking fields may pool this **reliability estimate only** across the matching MLB metric; league-specific priors and values are never pooled. If a continuous metric has no defensible reliability estimate, omit it rather than inventing one.

NPB MaxSprint and MLB sustained Sprint Speed are different constructs. They may be compared only as within-league speed signals with a declared `0.25` reliability ceiling, not treated as raw-unit equivalents or used to borrow reliability.

Spray and pitch-mix counts receive Dirichlet smoothing. Fit the concentration from category sampling variance and between-player variance, then calculate symmetric Jensen–Shannon distance. Scale each distribution distance from historical pseudo-NPB MLB pairs so its historical median is approximately the median scalar absolute difference, while preserving zero for identical distributions and capping extremes at three.

### Normalization and recency

For scalar features, compute robust z-scores within league and season among non-pitcher hitters with at least 150 PA:

`z = (posterior - leagueSeasonMedian) / (1.4826 * MAD)`

Use a documented standard-deviation fallback if MAD is zero. Convert posterior standard errors to the same scale. Store empirical within-league percentiles for display. Age uses a direct three-year-scale distance; position is categorical; distributions use the distribution calculation above.

Build each target and candidate season from up to three trailing player seasons with weights `0.60 / 0.27 / 0.13`, renormalized over seasons present. Aggregate denominator-aware numerators/denominators with those weights before the final posterior where applicable. No candidate profile uses a later season. Record which seasons contributed.

## 5. Eligibility and role matching

- Regular MLB candidate pool: at least 250 PA in the candidate season.
- Fallback/manual pool: 150–249 PA, always labeled as a small-sample fallback. Below 150 PA is ineligible for a scored comp.
- NPB targets below 150 PA show a small-sample warning and may abstain when coverage or reliability is inadequate.
- Batting side must match exactly (`L`, `R`, or `S`). It is a gate, not a scored feature.
- Mandatory core blocks are Production, Swing decisions and contact, and Power. Each needs at least 60% of its base feature weight available on both sides.
- Total configured block coverage must be at least 70%. Missing fields are excluded pairwise and never mean-imputed.
- Primary defensive role comes from the season's defensive workload; secondary roles count when they have at least 20% of defensive innings or 20 games.
- Catchers match only catchers. Infield roles (`1B`, `2B`, `3B`, `SS`) are compatible within that group; outfield roles (`LF`, `CF`, `RF`) are compatible within that group. DH-only profiles can match `1B` or corner outfield profiles. Other cross-group pairs are ineligible unless a qualifying secondary role provides a compatible match.
- Position distance is zero for the same primary role, `0.75` for another compatible role, and `1.25` for DH-to-corner matches. A match through a secondary role adds `0.25`. Only the best compatible role pairing is scored.

## 6. Blocks and exact feature weights

The model implements nine blocks from `comparison.md`. Zone maps are omitted because there is no pool-level common MLB feed in this version. The remaining original weights total `0.93`; divide each by `0.93` so the configured model sums to one. The methodology page shows both original and effective weights.

The tables below give **within-block** weights. Each row sums to one within its block.

### Production — original 0.12

| Feature | Weight |
| --- | ---: |
| Park-neutral shared wOBA | 0.70 |
| Park-neutral shared wOBA on contact | 0.30 |

No RBI, runs, raw home-run totals, or raw season PA are similarity features.

### Swing decisions and contact — original 0.20

| Feature | Weight |
| --- | ---: |
| Chase rate | 0.20 |
| Zone swing rate | 0.10 |
| Overall swing rate | 0.08 |
| Whiff rate | 0.18 |
| Zone contact rate | 0.12 |
| Out-of-zone contact rate | 0.08 |
| Walk rate | 0.12 |
| Strikeout rate | 0.12 |

Contact%, SwStr%, and Z−O Swing% are not additional inputs because they duplicate information already present. First-pitch swing is omitted from the common aggregate feed. Zone% is pitcher treatment, not hitter discipline.

### Power and contact quality — original 0.17

| Feature | Weight |
| --- | ---: |
| ISO | 0.30 |
| HR/PA | 0.25 |
| XBH/PA | 0.20 |
| Average exit velocity | 0.07 |
| Average launch angle | 0.04 |
| Hard-hit rate | 0.05 |
| Barrel rate | 0.05 |
| Average bat speed | 0.04 |

The outcome features total `0.75`; tracking totals `0.25`. If tracking is absent on either side, only the available power features are renormalized. Tracking is never allowed to create an MLB-only advantage.

### Spray and batted-ball shape — original 0.09

| Feature | Weight |
| --- | ---: |
| Smoothed pull/center/opposite Jensen–Shannon distance | 0.75 |
| Log-smoothed GO/AO tilt | 0.25 |

GO/AO is ground outs per air out, not a true GB/FB classification.

### Pitch-family profile — original 0.10

| Feature | Weight |
| --- | ---: |
| Fastball RV/100 | 0.15 |
| Breaking-ball RV/100 | 0.15 |
| Off-speed RV/100 | 0.15 |
| Fastball SLG | 0.10 |
| Breaking-ball SLG | 0.10 |
| Off-speed SLG | 0.10 |
| Three-family pitch-mix Jensen–Shannon distance | 0.25 |

Map fine labels to the three shared families before aggregation. Aggregate RV/100 from run value and pitches; aggregate published family SLG by PA and use PA as its reliability denominator because the feed does not expose family at-bats. Pitch mix describes pitcher treatment and has less influence than family performance. Expected stats and unmatched fine Japanese/MLB pitch labels are excluded.

### Platoon shape — original 0.06

| Feature | Weight |
| --- | ---: |
| Shrunken OPS vs LHP | 0.25 |
| Shrunken OPS vs RHP | 0.25 |
| OPS asymmetry, vs LHP minus vs RHP | 0.20 |
| K-rate asymmetry, vs LHP minus vs RHP | 0.15 |
| BB-rate asymmetry, vs LHP minus vs RHP | 0.15 |

Splits use their own PA denominators and higher posterior uncertainty. Asymmetry references are specific to league, season, and batting side.

### Position and defense — original 0.08

| Feature | Weight |
| --- | ---: |
| Compatible-position distance | 0.30 |
| Same-position-normalized defensive value rate | 0.50 |
| Defensive workload share | 0.20 |

Defensive value is NPB PAA per zone chance or MLB OAA per defensive inning, normalized within primary position and league season. The UI never calls PAA “OAA.” Position and workload remain observed when defensive value is unavailable, so those two features can still contribute without treating the missing defensive metric as average.

### Baserunning and speed — original 0.06

| Feature | Weight |
| --- | ---: |
| Steal attempt rate per time on first | 0.30 |
| Steal success rate | 0.20 |
| Opportunity-adjusted stolen-base runs per time on first | 0.20 |
| Within-league sprint-speed signal | 0.15 |
| Triples/PA | 0.15 |

Zero steal attempts makes success unavailable, not zero or average. Raw stolen-base success is interpreted within league and era.

### Age, body, and playing-time role — original 0.05

| Feature | Weight |
| --- | ---: |
| Seasonal-age distance | 0.45 |
| PA per team game | 0.30 |
| Height | 0.125 |
| Weight | 0.125 |

Age is a soft descriptive constraint. Body features are tie-breakers. Batting side remains a gate. Historical MLB bio measurements are acknowledged as low-weight limitations when only current bio data are available.

## 7. Distance, availability, and ranking

For scalar feature `f`:

`d(f) = min(3, abs(zTarget(f) - zCandidate(f)) / sqrt(1 + seTarget(f)^2 + seCandidate(f)^2))`

Feature influence within a block is its published within-block weight times `sqrt(reliabilityTarget * reliabilityCandidate)`. The block's reliability multiplier is the weighted mean of those feature reliabilities. Effective block weight is:

`configuredBlockWeight * blockReliability * weightVariation`

Block distance is the reliability-weighted mean of available feature distances. Final distance is the sum of effective block distances divided by the sum of effective block weights. Position is included once in this sum; there is no additional role penalty outside it.

Coverage is reported separately as observed configured feature/block weight, before reliability multipliers and weight variations. Missing data cannot raise coverage or be treated as league average.

For automatic ranking, compare every eligible MLB candidate. Return the best season per MLB player in the visible best-plus-four list. A manually selected pair's displayed rank is its one-based position among all eligible MLB player-seasons using the unperturbed distance; this is distinct from the recommended list's ensemble ordering.

## 8. Calibration, assessment, and weight stability

Offline, run pseudo-NPB MLB-to-MLB historical queries with the same reduced schema. Exclude every season of the query player from that query's candidate pool. Collect nearest-neighbor distances and derive the empirical reference distribution.

Assessment thresholds are the learned distance quantiles:

- **Strong:** at or below the 25th percentile.
- **Usable:** above the 25th through the 60th percentile.
- **Weak:** above the 60th through the 90th percentile.
- **No close comp:** above the 90th percentile, or inadequate mandatory/total coverage.

The UI may show a numeric distance and its empirical reference percentile, always with “lower is closer.” It must never present a distance as percent identical, a probability, or a projection.

For an automatic target, run 200 deterministic weight variations seeded by target ID and season. For each block, multiply its configured weight by `exp(ε)`, where `ε ~ Normal(0, 0.20²)` from a seeded PRNG, then renormalize. Record every candidate season's rank and distance over the 200 variations and order the recommended list by median rank, then median distance, keeping one season per MLB player. Separately, for each variation, take the best season per player before recording the five unique players selected; top-five stability is that player's selection count divided by 200.

Label this exactly as “top five in N of 200 model-weight variations.” It measures sensitivity to reasonable block weighting, not sampling confidence. Game-block bootstrap and posterior rank probabilities are not included in this version.

## 9. Signed feature explanation

Raw feature distances are nonnegative. Signed bars therefore describe distance **relative to a target-specific typical comparison**, not negative distance.

For the selected pair:

1. Compute each available feature's final effective global weight `w(f)` and distance `d(f)`, including the position term.
2. Across eligible MLB candidates for this NPB target, compute the median `r(f)` of that feature's distance wherever it is available.
3. Compute `typicalDistance = Σ w(f) r(f)` using the same selected-pair weights.
4. Compute `signedContribution(f) = w(f) * (d(f) - r(f))`.

The following must reconcile within floating-point tolerance:

`finalDistance = typicalDistance + Σ signedContribution(f)`

A negative/left bar means “closer than typical”; a positive/right bar means “farther than typical.” Contributions are descriptive, not causal.

The chart is a zero-centered horizontal bar graph grouped by block, with the largest absolute drivers emphasized and all features available. Each row exposes raw target/candidate values, within-league percentiles, effective weight, and contribution. Missing features are listed as “not compared,” not plotted as zero. An accessible table provides the same information without relying on color.

## 10. User interface

Add `/comps` and `/comps/methodology`, a main-nav “MLB comps” link, and a hitter-only action on existing player pages.

### Comp page

1. NPB player search and season selector.
2. Best comp plus four alternate cards with player/season/role, distance/assessment, weighted coverage, and weight stability when available.
3. “Check a specific MLB hitter” search and season selector. Selecting an alternate populates it; manual selection shows rank and the pair explanation. A reset action returns to the best comp.
4. Strongest matching blocks, largest disagreements, signed bar chart, and full feature table.
5. Profile seasons, data coverage, small-sample/fallback notices, no-close-comp state, model version, and methodology link.
6. URL parameters preserve NPB ID/season and MLB ID/season for shareable, restorable comparisons.

An ineligible manual choice explains batting-side, role, PA, or coverage failure and does not receive a misleading score. In no-close-comp mode, the nearest players are explicitly “partial-profile illustrations,” not endorsed matches.

### Methodology page

Document the product question, sources, coverage, exact effective weights/features, formulas and processing order, eligibility, missing-data behavior, calibration, weight stability, and chart equation. Link to the NPB repository, MLB Stats API, and Baseball Savant sources.

Limitations must include fixed-zone differences, tracking definitions, PAA versus OAA, MaxSprint versus sustained Sprint Speed, coarse pitch-family mapping, park approximation, incomplete defensive coverage, current bio measurements for some historical seasons, omitted zone maps, lack of game-block bootstrap, and the distinction between similarity and projection.

Reuse existing panels, status states, controls, search behavior, tooltips, typography, and light/dark variables. Add an MLB search adapter without destabilizing the NPB search. Provide responsive layouts, keyboard access, text/table alternatives, and labels that do not rely on color alone.

## 11. Implementation boundaries

Keep the shared model pure in `src/lib/comps/model.ts`, schemas in `src/lib/comps/types.ts`, static loading/ranking in focused comp modules, MLB acquisition in `scripts/fetch-mlb.mjs`, and profile/calibration output in `scripts/build-comps.mjs`.

Add `src/pages/Comps.tsx`, `src/pages/CompMethod.tsx`, and focused comp/search/chart components. Update routes, player actions, styles, deployment data commands/cache, README, and MLB attribution. Reuse the existing generic static loader with only a minimal export change.

No backend, chart library, test framework, or other new dependency is required. The repo has no test suite, so use executable Node assertions, build-time data invariants, standard lint/build commands, and real browser verification rather than adding unrelated scaffolding.

## 12. Acceptance criteria

- The real full-season MLB fetch and comp build succeed, produce finite valid profiles, and include the expected NPB/MLB ID joins and season windows.
- Model checks cover identical profiles, symmetry where applicable, capped outliers, trailing weights, batting/role/PA gates, missing-data renormalization, one season per displayed player, no-comp abstention, and exact signed-bar reconciliation.
- Automatic ranking returns a best comp and four distinct-player alternates or a documented no-comp/coverage result.
- Manual selection displays the correct pair, rank, explanation, and ineligible reasons, and survives a deep-link reload.
- Methodology values agree with the emitted model configuration.
- Loading, fetch failure, small sample, ineligible, and no-comp states are understandable and non-misleading.
- Mobile, dark mode, and keyboard use work; existing Home, Player, Leaders, and NPB Compare flows still render.
- `npm run lint` and `npm run build` pass on the final workspace, and the production comp workflow is exercised in a real browser before completion is claimed.
