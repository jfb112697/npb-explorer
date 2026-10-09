import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PlayerSearch } from '../components/PlayerSearch'
import { Avatar, Panel, PlayerLink, Rail, RailScale, StatLabel, Status, TeamMark } from '../components/ui'
import { percentile, useMeta, usePlayers, useSeason, valuesOf, type Derived, type Season } from '../lib/data'
import { useSettings } from '../lib/settings'
import { STAT, fmt, veloLabel } from '../lib/stats'
import { teamName } from '../lib/teams'
import type { Category } from '../lib/types'

interface Board { cat: Category; key: string; group: string; qualified: boolean }
const BOARDS: Board[] = [
  { cat: 'bat', key: 'wrcp', group: 'Advanced', qualified: true },
  { cat: 'bat', key: 'hr', group: 'Standard', qualified: false },
  { cat: 'bat', key: 'avg', group: 'Standard', qualified: true },
  { cat: 'run', key: 'sb', group: 'Stolen bases', qualified: false },
  { cat: 'pit', key: 'era', group: 'Standard', qualified: true },
  { cat: 'pit', key: 'kbbp', group: 'Advanced', qualified: true },
  { cat: 'pit', key: 'fbv', group: 'Stuff and command', qualified: false },
  { cat: 'pit', key: 'sv', group: 'Standard', qualified: false },
]
const DEMO_RAILS: [Category, string][] = [['bat', 'wrcp'], ['bat', 'iso'], ['bat', 'bbp'], ['bat', 'kp'], ['bat', 'whiffp'], ['bat', 'zoswingp'], ['bat', 'rv']]

function top(s: Season, b: Board, count: number): Derived[] {
  const def = STAT[`${b.cat}.${b.key}`]
  const sign = def.better === 'low' ? 1 : -1
  return s.players
    .filter((d) => {
      if (valuesOf(d, b.cat)?.[b.key] == null) return false
      if (b.cat === 'pit') return b.qualified ? (d.row.p?.outs ?? 0) >= s.min.qualOuts : (d.row.p?.bf ?? 0) >= s.min.bf / 2
      return b.qualified ? (d.row.b?.pa ?? 0) >= s.min.qualPa : true
    })
    .sort((x, y) => sign * (valuesOf(x, b.cat)![b.key]! - valuesOf(y, b.cat)![b.key]!))
    .slice(0, count)
}

export default function Home() {
  const meta = useMeta()
  const players = usePlayers()
  const navigate = useNavigate()
  const { unit } = useSettings()
  const latest = meta.data?.seasons[meta.data.seasons.length - 1] ?? null
  const season = useSeason(latest)
  const byId = useMemo(() => new Map((players.data ?? []).map((p) => [p.id, p])), [players.data])
  const s = season.data
  const star = s ? top(s, BOARDS[0], 1)[0] : undefined
  const starInfo = star ? byId.get(star.row.id) : undefined

  return (
    <div className="page">
      <section className="hero">
        <div className="hero-copy">
          <h1>Japanese pro baseball, in the stats you already read.</h1>
          <p className="lede">
            Percentile rankings, pitch mixes, spray charts and plate discipline for every Nippon Professional Baseball player since 2019.
            Names are in English, and every stat explains itself against its MLB counterpart.
          </p>
          <PlayerSearch onPick={(p) => navigate(`/player/${p.id}`)} placeholder="Find a player: Murakami, Moinelo, Sasaki…" />
          <p className="hero-links">
            <Link to="/leaders">Open the leaderboards</Link>
            <Link to="/compare">Compare players</Link>
            <Link to="/glossary">New to NPB? Read the primer</Link>
          </p>
        </div>

        {s && star && starInfo && (
          <div className="hero-demo">
            <div className="hero-demo-head">
              <Avatar player={starInfo} team={star.row.t} size={56} />
              <div>
                <PlayerLink player={starInfo} season={s.season} />
                <span className="muted"><TeamMark meta={meta.data} id={star.row.t} /> {teamName(meta.data, star.row.t)}, {s.season}</span>
              </div>
            </div>
            <p className="hero-demo-note">The league’s best qualified hitter by wRC+, ranked against everyone else.</p>
            <RailScale />
            {DEMO_RAILS.map(([cat, key]) => {
              const v = valuesOf(star, cat)?.[key]
              return <Rail key={key} cat={cat} k={key} value={v} pct={percentile(s, cat, key, v)} />
            })}
          </div>
        )}
      </section>

      <Status loading={season.loading || players.loading} error={season.error ?? players.error}>
        {s && (
          <>
            <div className="section-head">
              <h2>{s.season} leaders</h2>
              <p className="muted">Regular season through {meta.data ? new Date(meta.data.through + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : ''}.</p>
            </div>
            <div className="boards">
              {BOARDS.map((b) => {
                const def = STAT[`${b.cat}.${b.key}`]
                return (
                  <Panel key={`${b.cat}.${b.key}`} className="board"
                    title={<StatLabel cat={b.cat} k={b.key}>{def.name}{def.fmt === 'velo' ? ` (${veloLabel(unit)})` : ''}</StatLabel>}>
                    <ol>
                      {top(s, b, 5).map((d) => (
                        <li key={d.row.id}>
                          <Avatar player={byId.get(d.row.id)} team={d.row.t} size={30} />
                          <PlayerLink player={byId.get(d.row.id)} season={s.season} cat={b.cat} />
                          <TeamMark meta={meta.data} id={d.row.t} />
                          <b>{fmt(valuesOf(d, b.cat)![b.key], def.fmt, unit)}</b>
                        </li>
                      ))}
                    </ol>
                    <Link className="board-more" to={`/leaders?cat=${b.cat}&group=${encodeURIComponent(b.group)}&sort=${b.key}&season=${s.season}${b.qualified ? '' : '&min=regular'}`}>Full {def.label} leaderboard</Link>
                  </Panel>
                )
              })}
            </div>
          </>
        )}
      </Status>
    </div>
  )
}
