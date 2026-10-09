import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Panel, Select, StatLabel, Status, TeamMark, pctColor } from '../components/ui'
import { useMeta, useSeason } from '../lib/data'
import { batValues, fmt, pitValues, STAT } from '../lib/stats'
import { LEAGUE_NAME, teamName } from '../lib/teams'
import type { Category, Counts, Values } from '../lib/types'

const COLS: [Category, string][] = [
  ['bat', 'r'], ['bat', 'hr'], ['bat', 'sb'], ['bat', 'avg'], ['bat', 'obp'], ['bat', 'slg'], ['bat', 'wrcp'], ['bat', 'kp'], ['bat', 'bbp'],
  ['pit', 'era'], ['pit', 'fip'], ['pit', 'whip'], ['pit', 'kp'], ['pit', 'bbp'], ['pit', 'hr9'], ['pit', 'fbv'],
]

export default function Teams() {
  const [params, setParams] = useSearchParams()
  const meta = useMeta()
  const seasons = meta.data?.seasons ?? []
  const seasonNo = Number(params.get('season')) || seasons[seasons.length - 1] || null
  const season = useSeason(seasonNo)

  const teams = useMemo(() => {
    const s = season.data
    if (!s || !meta.data) return []
    return Object.keys(meta.data.teams).map(Number).map((id) => {
      const bat: Counts = {}, pit: Counts = {}
      let fbn = 0, fbs = 0
      for (const p of s.file.players) {
        if (p.t !== id) continue
        for (const k in p.b) bat[k] = (bat[k] ?? 0) + p.b[k]
        if (p.p) {
          for (const k in p.p) if (k !== 'fbv' && k !== 'vavg' && k !== 'vmax') pit[k] = (pit[k] ?? 0) + p.p[k]
          if (p.p.fbv && p.p.fbn) { fbn += p.p.fbn; fbs += p.p.fbv * p.p.fbn }
        }
      }
      if (fbn) pit.fbv = fbs / fbn
      const league = meta.data!.teams[id].league
      return { id, league, games: s.file.games[id] ?? 0, v: { bat: batValues(bat, s.league, league), pit: pitValues(pit, s.league, league) } as Record<string, Values> }
    })
  }, [season.data, meta.data])

  // Rank each column across all twelve clubs, turned into a 0-100 score for shading.
  const shade = (cat: Category, key: string, value: number | null) => {
    const def = STAT[`${cat}.${key}`]
    if (value == null || !def.better) return null
    const vals = teams.map((t) => t.v[cat][key]).filter((x): x is number => x != null).sort((a, b) => a - b)
    const below = vals.filter((x) => x < value).length
    const pct = (below / Math.max(1, vals.length - 1)) * 100
    return def.better === 'low' ? 100 - pct : pct
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>Teams</h1>
        <p className="lede">
          Twelve clubs in two leagues of six. Clubs carry their owner’s name rather than a city’s: Hanshin is a railway, Yomiuri a newspaper, Nippon-Ham a meat packer.
          The Pacific League uses the designated hitter; Central League pitchers bat.
        </p>
      </header>
      <div className="filters">
        <Select label="Season" value={seasonNo ?? ''} onChange={(v) => setParams({ season: v }, { replace: true })} options={[...seasons].reverse().map((y) => ({ value: y, label: String(y) }))} />
      </div>
      <Status loading={season.loading} error={season.error}>
        {(['CL', 'PL'] as const).map((lg) => (
          <Panel key={lg} title={LEAGUE_NAME[lg]} className="panel-flush"
            note="Club totals from player lines. A player traded in-season is counted with his final club. Shading ranks all twelve clubs.">
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th className="col-name" rowSpan={2}>Club</th>
                    <th className="num" rowSpan={2}>G</th>
                    <th colSpan={9} className="group-head">Offense</th>
                    <th colSpan={7} className="group-head">Pitching</th>
                  </tr>
                  <tr>{COLS.map(([c, k]) => <th key={`${c}.${k}`} className="num"><StatLabel cat={c} k={k} /></th>)}</tr>
                </thead>
                <tbody>
                  {teams.filter((t) => t.league === lg).sort((a, b) => (b.v.bat.wrcp ?? 0) - (a.v.bat.wrcp ?? 0)).map((t) => (
                    <tr key={t.id}>
                      <td className="col-name">
                        <Link className="name-cell" to={`/leaders?team=${t.id}&season=${seasonNo}&min=regular`}><TeamMark meta={meta.data} id={t.id} /> {teamName(meta.data, t.id)}</Link>
                      </td>
                      <td className="num">{t.games}</td>
                      {COLS.map(([c, k]) => {
                        const v = t.v[c][k]
                        const pct = shade(c, k, v)
                        return (
                          <td key={`${c}.${k}`} className="num"
                            style={pct != null ? { background: `color-mix(in srgb, ${pctColor(pct)} ${Math.round(Math.abs(pct - 50) * 1.1)}%, transparent)` } : undefined}>
                            {fmt(v, STAT[`${c}.${k}`].fmt)}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        ))}
      </Status>
    </div>
  )
}
