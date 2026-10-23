# NPB Explorer

A Baseball Savant-style explorer for Nippon Professional Baseball, written for English-speaking
fans: percentile rankings, pitch arsenals, spray charts, location heatmaps, leaderboards and
player comparisons for every top-squad regular season since 2019.

It is a static site. All rate stats and percentiles are computed in the browser from
pre-built JSON, so there is no backend to host.

## Run it

```sh
npm install
npm run data     # download the raw data (~2 GB, cached), resolve names, build public/data
npm run dev
```

`npm run data` is three steps you can run on their own:

| Script | What it does |
| --- | --- |
| `npm run data:fetch` | Downloads box scores and play-by-play from the data repository's GitHub releases into `.cache/raw`. Skips files that have not changed. |
| `npm run data:names` | Matches players to npb.jp for English names, headshots and bio details. Writes `data/names.json` (committed). Responses are cached in `.cache/npb`. |
| `npm run data:tracking` | Fetches NPB+ Hawk-Eye season tracking aggregates (exit velocity, launch angle, hard-hit, barrel, swing and max sprint speed) for every rostered player from the NPB+ GraphQL API. Writes `data/tracking-<year>.json` (committed). |
| `npm run data:build` | Aggregates everything into `public/data` (about 28 MB across 1,550 small files). Takes about two minutes. When `data/tracking-<year>.json` exists for a season, the measured tracking values are merged into that season’s file. No modeled stats: expected stats like xwOBA need per-batted-ball data, which NPB does not publish. |

`npm run build` then produces a fully static `dist/`. `public/_redirects` sends every path to
`index.html` for hosts that honor it (Cloudflare Pages, Netlify).

## Deployment

`.github/workflows/deploy.yml` rebuilds the data and publishes to GitHub Pages on every push
to `main` and once a day. It does not run `data:names`: run that locally and commit
`data/names.json` when new players need English names or headshots.

## Where things live

- `scripts/build-data.mjs` decodes the play-by-play result codes and writes the JSON.
- `src/lib/stats.ts` defines every stat: formula, format, direction and tooltip text.
- `scripts/seager.mjs` fits the NPB SEAGER decision model; see [method and checks](docs/seager.md).
- `src/lib/data.ts` loads the JSON and computes league context and percentiles.
- `data/name-overrides.json` holds hand-entered names for players npb.jp could not resolve.

## Data

This uses data sourced from the Nippon Baseball Data Repository, which can be accessed here:

https://github.com/armstjc/Nippon-Baseball-Data-Repository

Player names and headshots come from npb.jp. Headshots are linked from npb.jp, not copied.
