import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { LineChart, type Series } from '../components/charts'
import { PlayerSearch } from '../components/PlayerSearch'
import { Avatar, Panel, Segmented, StatLabel, Status, TeamMark, pctColor } from '../components/ui'
import { percentile, useMeta, usePlayerDetails, usePlayers, useSeasons, valuesOf, type Derived, type Season } from '../lib/data'
import { useSettings } from '../lib/settings'
import { CATEGORY_LABEL, STAT, fmt, groupsFor, statsFor } from '../lib/stats'
import { teamName } from '../lib/teams'
import type { Category, PlayerInfo } from '../lib/types'

type View = 'bat' | 'pit'
const MAX = 4
const ID_COLORS = ['var(--id-1)', 'var(--id-2)', 'var(--id-3)', 'var(--id-4)']
const LETTERS = ['A', 'B', 'C', 'D']

interface Slot { id: number; season: number; info: PlayerInfo; s?: Season; d?: Derived }

export default function Compare() {
  const [params, setParams] = useSearchParams()
  const players = usePlayers()
  const meta = useMeta()
  const { unit } = useSettings()
  const view: View = params.get('view') === 'pit' ? 'pit' : 'bat'

  const picks = useMemo(() => {
    const byId = new Map((players.data ?? []).map((p) => [p.id, p]))
    const out: { id: number; season: number; info: PlayerInfo }[] = []
    for (const part of (params.get('p') ?? '').split(',').filter(Boolean)) {
      const [id, season] = part.split('-').map(Number)
      const info = byId.get(id)
      if (!info) continue
      const years = info.s.map((x) => x[0])
      out.push({ id, info, season: years.includes(season) ? season : years[years.length - 1] })
    }
    return out.slice(0, MAX)
  }, [params, players.data])

  const seasons = useSeasons(useMemo(() => [...new Set(picks.map((p) => p.season))].sort(), [picks]))
  const details = usePlayerDetails(useMemo(() => [...new Set(picks.map((p) => p.id))], [picks]))
  const slots: Slot[] = picks.map((p) => {
    const s = seasons.data?.get(p.season)
    return { ...p, s, d: s?.byId.get(p.id) }
  })

  const write = (next: { id: number; season: number }[], nextView = view) => {
    const q = new URLSearchParams()
    if (next.length) q.set('p', next.map((p) => `${p.id}-${p.season}`).join(','))
    q.set('view', nextView)
    setParams(q, { replace: true })
  }
  const add = (info: PlayerInfo) => {
    const last = info.s[info.s.length - 1]
    // The first pick decides whether this is a hitter or pitcher comparison.
    const nextView = picks.length === 0 ? (last[2] === 'P' ? 'pit' : 'bat') : view
    write([...picks, { id: info.id, season: last[0] }], nextView)
  }

  const cats: Category[] = view === 'pit' ? ['pit'] : ['bat', 'run', 'fld']
  const [cat, setCat] = useState<Category>(cats[0])
  const active = cats.includes(cat) ? cat : cats[0]
  const groups = groupsFor(active)
  const [group, setGroup] = useState(groups[0])
  const activeGroup = groups.includes(group) ? group : groups[0]

  const railDefs = useMemo(() => (view === 'pit' ? statsFor('pit') : [...statsFor('bat'), ...statsFor('run')]).filter((x) => x.rail), [view])
  const tableDefs = statsFor(active).filter((x) => x.group === activeGroup)

  const cell = (slot: Slot, c: Category, key: string) => {
    if (!slot.s || !slot.d) return { v: null as number | null, pct: null as number | null }
    const pos = c === 'fld' ? slot.d.mainPos : undefined
    const v = valuesOf(slot.d, c, pos)?.[key] ?? null
    return { v, pct: percentile(slot.s, c, key, v, 'all', pos) }
  }
  const best = (c: Category, key: string, vals: (number | null)[]) => {
    const def = STAT[`${c}.${key}`]
    const nums = vals.filter((x): x is number => x != null)
    if (!def.better || nums.length < 2) return null
    return def.better === 'high' ? Math.max(...nums) : Math.min(...nums)
  }

  const trend: Series[] = slots.map((slot, i) => {
    const det = details.data?.get(slot.id)?.[String(slot.season)]
    const log = (view === 'bat' ? det?.glb : det?.glp) ?? []
    let points: { label: string; y: number | null }[]
    if (view === 'bat') {
      const W = 15
      points = log.map((_, k) => {
        if (k < W - 1) return { label: `Game ${k + 1}`, y: null }
        let ab = 0, h = 0, tb = 0, bb = 0, hbp = 0, sf = 0
        for (const x of log.slice(k - W + 1, k + 1)) { ab += x[3]; h += x[4]; tb += x[4] + x[5] + 2 * x[6] + 3 * x[7]; bb += x[9]; hbp += x[13]; sf += x[14] }
        const denom = ab + bb + hbp + sf
        return { label: `Game ${k + 1}`, y: ab && denom ? (h + bb + hbp) / denom + tb / ab : null }
      })
    } else {
      let outs = 0, er = 0
      points = log.map((g, k) => { outs += g[3]; er += g[6]; return { label: `Appearance ${k + 1}`, y: outs ? (27 * er) / outs : null } })
    }
    return { name: `${LETTERS[i]} ${slot.info.fam ?? slot.info.n}`, color: ID_COLORS[i], points }
  })
  const longest = Math.max(0, ...trend.map((t) => t.points.length))
  for (const t of trend) while (t.points.length < longest) t.points.push({ label: `${view === 'bat' ? 'Game' : 'Appearance'} ${t.points.length + 1}`, y: null })
  if (trend[0]) trend[0].points = trend[0].points.map((p, k) => ({ ...p, label: `${view === 'bat' ? 'Game' : 'Appearance'} ${k + 1}` }))

  return (
    <div className="page">
      <header className="page-head">
        <h1>Compare players</h1>
        <p className="lede">Put up to four player seasons side by side. Each can be a different year, so you can also compare a player with himself.</p>
      </header>

      <div className="compare-bar">
        <Segmented label="Compare as" value={view} onChange={(v) => write(picks, v)} options={[{ value: 'bat', label: 'Hitters' }, { value: 'pit', label: 'Pitchers' }]} />
        {picks.length < MAX && <PlayerSearch onPick={add} placeholder={picks.length ? 'Add another player' : 'Search for a player to start'} autoFocus={picks.length === 0} />}
      </div>

      <Status loading={players.loading} error={players.error}>
        {slots.length === 0 ? (
          <p className="empty">Nobody selected yet. Search above, or tick players on the <Link to="/leaders">leaderboards</Link> and choose Compare.</p>
        ) : (
          <>
            <div className="slots" style={{ gridTemplateColumns: `repeat(${slots.length}, minmax(0, 1fr))` }}>
              {slots.map((slot, i) => (
                <div key={`${slot.id}-${i}`} className="slot" style={{ '--id': ID_COLORS[i] } as React.CSSProperties}>
                  <span className="slot-letter">{LETTERS[i]}</span>
                  <Avatar player={slot.info} team={slot.d?.row.t ?? slot.info.s[slot.info.s.length - 1][1]} size={64} />
                  <div className="slot-body">
                    <Link className="slot-name" to={`/player/${slot.id}?season=${slot.season}${view === 'pit' ? '&view=pit' : ''}`}>{slot.info.n}</Link>
                    <span className="slot-team">{slot.d ? <><TeamMark meta={meta.data} id={slot.d.row.t} /> {teamName(meta.data, slot.d.row.t, true)}, {slot.d.row.pos}</> : ' '}</span>
                    <label className="slot-season">
                      <span className="sr-only">Season for {slot.info.n}</span>
                      <select value={slot.season} onChange={(e) => write(picks.map((p, k) => (k === i ? { ...p, season: Number(e.target.value) } : p)))}>
                        {[...slot.info.s].reverse().map((x) => <option key={x[0]} value={x[0]}>{x[0]}</option>)}
                      </select>
                    </label>
                  </div>
                  <button type="button" className="slot-remove" aria-label={`Remove ${slot.info.n}`} onClick={() => write(picks.filter((_, k) => k !== i))}>×</button>
                </div>
              ))}
            </div>

            <Status loading={seasons.loading} error={seasons.error}>
              {slots.some((x) => x.d && !valuesOf(x.d, view)) && (
                <p className="notice">{slots.filter((x) => x.d && !valuesOf(x.d, view)).map((x) => x.info.n).join(' and ')} did not {view === 'pit' ? 'pitch' : 'bat'} in the selected season. Switch between Hitters and Pitchers above.</p>
              )}

              <Panel title="Percentile rankings" note="Each marker is a player’s percentile rank within his own season. Further right is better.">
                <div className="cmp-rails">
                  {railDefs.map((def) => {
                    const cells = slots.map((slot) => cell(slot, def.cat, def.key))
                    if (cells.every((c) => c.v == null)) return null
                    const top = best(def.cat, def.key, cells.map((c) => c.v))
                    return (
                      <div className="cmp-rail" key={`${def.cat}.${def.key}`}>
                        <div className="rail-label"><StatLabel cat={def.cat} k={def.key} /></div>
                        <div className="rail-track" aria-hidden="true">
                          <span className="rail-mid" />
                          {cells.map((c, i) => c.pct != null && (
                            <span key={i} className="cmp-dot" style={{ left: `${c.pct}%`, background: ID_COLORS[i] }}>{LETTERS[i]}</span>
                          ))}
                        </div>
                        <div className="cmp-values" style={{ gridTemplateColumns: `repeat(${slots.length}, 1fr)` }}>
                          {cells.map((c, i) => (
                            <span key={i} className={c.v != null && c.v === top ? 'best' : undefined} style={{ '--id': ID_COLORS[i] } as React.CSSProperties}>
                              {fmt(c.v, def.fmt, unit)}{c.pct != null && <small>{c.pct}</small>}
                            </span>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </Panel>

              <Panel
                title="Stat by stat"
                note="The best mark in each row is in bold. Shading shows the percentile rank within that player’s season."
                actions={
                  <>
                    {cats.length > 1 && <Segmented label="Category" value={active} onChange={(c) => { setCat(c); setGroup(groupsFor(c)[0]) }} options={cats.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))} />}
                    {groups.length > 1 && <Segmented label="Stat group" value={activeGroup} onChange={setGroup} options={groups.map((g) => ({ value: g, label: g }))} />}
                  </>
                }
                className="panel-flush"
              >
                <div className="table-scroll">
                  <table className="data cmp-table">
                    <thead>
                      <tr>
                        <th className="col-name">Stat</th>
                        {slots.map((slot, i) => (
                          <th key={i} className="num"><span className="cmp-head" style={{ '--id': ID_COLORS[i] } as React.CSSProperties}><b>{LETTERS[i]}</b> {slot.info.fam ?? slot.info.n} <span className="muted">{slot.season}</span></span></th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tableDefs.map((def) => {
                        const cells = slots.map((slot) => cell(slot, active, def.key))
                        const top = best(active, def.key, cells.map((c) => c.v))
                        return (
                          <tr key={def.key}>
                            <td className="col-name"><StatLabel cat={active} k={def.key}>{def.name}</StatLabel> <span className="muted">{def.label}</span></td>
                            {cells.map((c, i) => {
                              const shade = def.better && def.fmt !== 'int' && c.pct != null
                              return (
                                <td key={i} className={c.v != null && c.v === top ? 'num best' : 'num'}
                                  style={shade ? { background: `color-mix(in srgb, ${pctColor(c.pct!)} ${Math.round(Math.abs(c.pct! - 50) * 1.1)}%, transparent)` } : undefined}
                                  title={shade ? `${c.pct}th percentile` : undefined}>
                                  {fmt(c.v, def.fmt, unit)}
                                </td>
                              )
                            })}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </Panel>

              <Panel title={view === 'bat' ? 'Rolling 15-game OPS' : 'Season ERA by appearance'} note="Lined up by game number within each player’s season, not by date.">
                <Status loading={details.loading} error={details.error}>
                  <LineChart series={trend} format={(v) => (view === 'bat' ? fmt(v, 'avg') : v.toFixed(2))} yLabel="Hover to read values. " height={260} />
                </Status>
              </Panel>
            </Status>
          </>
        )}
      </Status>
    </div>
  )
}
