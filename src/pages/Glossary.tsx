import { Panel } from '../components/ui'
import { useMeta } from '../lib/data'
import { PITCH, PITCH_GROUP_NAME } from '../lib/pitches'
import { CATEGORY_LABEL, groupsFor, statsFor } from '../lib/stats'
import type { Category } from '../lib/types'

const PRIMER: [string, string][] = [
  ['Two leagues, twelve clubs', 'The Central and Pacific Leagues have six clubs each. Clubs are named for their corporate owners, with the home city sometimes attached: the Hanshin Tigers play in Nishinomiya, near Osaka, and the Yomiuri Giants in Tokyo.'],
  ['143 games', 'Each club plays 143 regular-season games, including 18 interleague games in late May and June. Counting stats run about 12% below a 162-game pace, so 30 home runs is a big year.'],
  ['The DH split', 'The Pacific League has used the designated hitter since 1975. Central League pitchers bat, which drags down that league’s hitting numbers and props up its pitchers’ strikeout totals. That is why wRC+, OPS+, ERA- and FIP- here compare a player with his own league. The Central League has voted to adopt the DH from 2027.'],
  ['Games can end in a tie', 'Regular-season games stop after 12 innings and go in the books as ties. Standings are decided on winning percentage with ties left out.'],
  ['Six-man rotations', 'Starters usually pitch once a week, so a full season is 24 to 26 starts. Pitch counts run higher and complete games are still routine for an ace.'],
  ['A lower-scoring, higher-contact game', 'Hitters strike out a little less and hit for less power than in MLB, and since 2022 run scoring has been low: league ERA has sat between 3.00 and 3.35. Sacrifice bunts are a normal part of offense. Shift your sense of “good” accordingly; the percentile sliders do that for you.'],
  ['Top team and farm team', 'Each club has a top squad (ichi-gun) and a farm squad (ni-gun) in the Eastern or Western League. Everything on this site is top-squad, regular-season play. The Climax Series and Japan Series are left out.'],
  ['Foreign players', 'A club may register any number of foreign players but can carry only four on the active roster at once. Their names here use the spelling npb.jp publishes.'],
  ['Speeds in km/h', 'Japanese broadcasts and this data feed use kilometres per hour. The site converts to mph by default; switch units in the header. 150 km/h is 93.2 mph and 160 km/h is 99.4.'],
]

const NOTES: [string, string][] = [
  ['Where the numbers come from', 'Counting stats (hits, innings, strikeouts and so on) come from official box scores. Everything pitch-level comes from play-by-play that records each pitch’s type, speed and location, and where each ball in play went. Both are collected from SPAIA by the Nippon Baseball Data Repository.'],
  ['What NPB does not publish', 'There is no public exit velocity, launch angle, spin rate, pitch movement or sprint speed. So there is no xwOBA, xwOBAcon, barrel rate, hard-hit rate or Stuff+ here (wOBAcon, the actual-results version, is included), and no true ground-ball rate: contact type is only recorded on outs, which is why you see GO/AO instead.'],
  ['Percentiles', 'A player’s percentile is his rank among players with regular playing time that season: one plate appearance per team game for hitters, 0.75 batters faced per team game for pitchers, and 1.5 innings per team game at a position for fielders. 100 is best. Players under the minimum are still ranked against that pool and flagged as a small sample.'],
  ['Strike zone', 'Pitch locations arrive on a fixed grid, and the zone used for O-Swing%, Z-Swing%, Zone% and the heatmaps is the fixed box on that grid. It does not move with the batter’s height the way Statcast’s does.'],
  ['Fielding', 'Innings and chances are rebuilt from play-by-play, which lists the nine fielders on most pitches. Coverage is thinner before 2023, so older innings totals run short. Plays above average is a zone rating, not a tracking metric.'],
  ['Not park-adjusted', 'wRC+, OPS+, ERA- and FIP- are adjusted for league and season but not for ballpark.'],
  ['Names and photos', 'English names and headshots for active players come from npb.jp. For retired players npb.jp gives a reading in kana, which is converted to romaji with long vowels dropped (Shohei, not Shouhei). Japanese names are shown given name first.'],
]

export default function Glossary() {
  const meta = useMeta()
  return (
    <div className="page page-narrow">
      <header className="page-head">
        <h1>Primer and glossary</h1>
        <p className="lede">What an MLB fan needs to know to read NPB numbers, every stat on the site with its closest MLB reference, and how the data is put together.</p>
      </header>

      <nav className="toc" aria-label="On this page">
        <a href="#primer">NPB in nine points</a>
        {(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => <a key={c} href={`#${c}`}>{CATEGORY_LABEL[c]} stats</a>)}
        <a href="#pitches">Pitch types</a>
        <a href="#method">Data and method</a>
      </nav>

      <Panel title={<span id="primer">NPB in nine points</span>}>
        <dl className="defs">
          {PRIMER.map(([t, d]) => <div key={t}><dt>{t}</dt><dd>{d}</dd></div>)}
        </dl>
      </Panel>

      {(Object.keys(CATEGORY_LABEL) as Category[]).map((cat) => (
        <Panel key={cat} title={<span id={cat}>{CATEGORY_LABEL[cat]} stats</span>}>
          {groupsFor(cat).map((g) => (
            <div key={g} className="gloss-group">
              <h3>{g}</h3>
              <dl className="gloss">
                {statsFor(cat).filter((s) => s.group === g).map((s) => (
                  <div key={s.key}>
                    <dt><b>{s.label}</b><span>{s.name}</span></dt>
                    <dd>
                      {s.desc}
                      {s.mlb && <span className="gloss-mlb"><b>MLB frame of reference.</b> {s.mlb}</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </Panel>
      ))}

      <Panel title={<span id="pitches">Pitch types</span>} note="Labels come from Japanese scorers, and a few do not mean what the same word means in MLB.">
        <dl className="gloss">
          {Object.values(PITCH).map((p) => (
            <div key={p.name}>
              <dt><b><i className="legend-dot" style={{ background: p.color }} />{p.short}</b><span>{p.name}</span></dt>
              <dd>{p.note ?? 'Same pitch as in MLB.'} <span className="muted">Grouped with {PITCH_GROUP_NAME[p.group].toLowerCase()}.</span></dd>
            </div>
          ))}
        </dl>
      </Panel>

      <Panel title={<span id="method">Data and method</span>}>
        <dl className="defs">
          {NOTES.map(([t, d]) => <div key={t}><dt>{t}</dt><dd>{d}</dd></div>)}
        </dl>
        <p className="credit">
          This uses data sourced from the Nippon Baseball Data Repository, which can be accessed here:{' '}
          <a href="https://github.com/armstjc/Nippon-Baseball-Data-Repository" target="_blank" rel="noreferrer">https://github.com/armstjc/Nippon-Baseball-Data-Repository</a>
          {meta.data && <> Data last built {new Date(meta.data.generated).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}, covering games through {meta.data.through}.</>}
        </p>
      </Panel>
    </div>
  )
}
