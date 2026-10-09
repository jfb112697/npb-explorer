import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Avatar, Panel, PlayerLink, Segmented, Select, StatLabel, Status, TeamMark, pctColor } from '../components/ui'
import { inPool, percentile, useMeta, usePlayers, useSeason, valuesOf, type Derived, type Season } from '../lib/data'
import { useSettings } from '../lib/settings'
import { CATEGORY_LABEL, STAT, fmt, groupsFor, statsFor } from '../lib/stats'
import { POSITIONS, POSITION_NAME } from '../lib/teams'
import type { Category } from '../lib/types'

const DEFAULT_SORT: Record<string, string> = {
  'bat.Standard': 'ops', 'bat.Advanced': 'wrcp', 'bat.Plate discipline': 'whiffp', 'bat.Batted ball': 'pullp',
  'pit.Standard': 'era', 'pit.Advanced': 'fip', 'pit.Stuff and command': 'fbv', 'pit.Running game': 'sba',
  'fld.Fielding': 'paa', 'fld.Catching': 'cscp',
  'run.Stolen bases': 'wsb', 'run.On the bases': 'xbtp', 'run.Speed signals': 'ifh',
}
type Playing = 'qualified' | 'regular' | 'all'
const PAGE = 50

interface Row { d: Derived; pos?: string; v: Record<string, number | null> }

function qualifies(s: Season, d: Derived, cat: Category, playing: Playing, pos?: string): boolean {
  if (playing === 'all') return true
  if (playing === 'regular' || cat === 'fld') return inPool(s, d, cat, pos)
  if (cat === 'pit') return (d.row.p?.outs ?? 0) >= s.min.qualOuts
  return (d.row.b?.pa ?? 0) >= s.min.qualPa
}

export default function Leaders() {
  const [params, setParams] = useSearchParams()
  const meta = useMeta()
  const players = usePlayers()
  const { unit } = useSettings()
  const seasons = meta.data?.seasons ?? []
  const seasonNo = Number(params.get('season')) || seasons[seasons.length - 1] || null
  const season = useSeason(seasonNo)

  const cat = (['bat', 'pit', 'fld', 'run'].includes(params.get('cat') ?? '') ? params.get('cat') : 'bat') as Category
  const groups = groupsFor(cat)
  const group = groups.includes(params.get('group') ?? '') ? params.get('group')! : groups[0]
  const lg = params.get('lg') ?? 'all'
  const team = params.get('team') ?? 'all'
  const pos = params.get('pos') ?? 'all'
  const playing = (params.get('min') ?? (cat === 'bat' || cat === 'pit' ? 'qualified' : 'regular')) as Playing
  const cols = useMemo(() => statsFor(cat).filter((s) => s.group === group), [cat, group])
  const sortKey = params.get('sort') ?? DEFAULT_SORT[`${cat}.${group}`] ?? cols[0].key
  const sortDef = STAT[`${cat}.${sortKey}`]
  const dir = (params.get('dir') ?? (sortDef?.better === 'low' ? 'asc' : 'desc')) as 'asc' | 'desc'
  const [shown, setShown] = useState(PAGE)
  const [picked, setPicked] = useState<number[]>([])

  const set = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(changes)) { if (v == null) next.delete(k); else next.set(k, v) }
    setParams(next, { replace: true })
    setShown(PAGE)
  }

  const byId = useMemo(() => new Map((players.data ?? []).map((p) => [p.id, p])), [players.data])
  const rows = useMemo(() => {
    const s = season.data
    if (!s) return []
    const out: Row[] = []
    for (const d of s.players) {
      if (lg !== 'all' && d.league !== lg) continue
      if (team !== 'all' && !(d.row.ts ?? [d.row.t]).includes(Number(team))) continue
      if (cat === 'fld') {
        for (const p of Object.keys(d.fld ?? {})) {
          if (pos !== 'all' && p !== pos) continue
          if (group === 'Catching' && p !== 'C') continue
          if (!qualifies(s, d, cat, playing, p)) continue
          out.push({ d, pos: p, v: d.fld![p] })
        }
        continue
      }
      const v = valuesOf(d, cat)
      if (!v) continue
      if (pos !== 'all' && d.row.pos !== pos) continue
      if (cat !== 'pit' && d.row.pos === 'P' && pos === 'all' && playing === 'all' && (d.row.b?.pa ?? 0) === 0) continue
      if (!qualifies(s, d, cat, playing)) continue
      out.push({ d, v })
    }
    const sign = dir === 'asc' ? 1 : -1
    return out.sort((a, b) => {
      const x = a.v[sortKey], y = b.v[sortKey]
      if (x == null && y == null) return 0
      if (x == null) return 1
      if (y == null) return -1
      return (x - y) * sign
    })
  }, [season.data, cat, group, lg, team, pos, playing, sortKey, dir])

  const s = season.data
  const minNote = !s ? '' : cat === 'pit'
    ? { qualified: `${s.min.qualOuts / 3} innings (one per team game)`, regular: `${s.min.bf} batters faced`, all: 'no minimum' }[playing]
    : cat === 'fld'
      ? playing === 'all' ? 'no minimum' : `${s.min.inn / 3} innings at the position`
      : { qualified: `${s.min.qualPa} plate appearances (3.1 per team game)`, regular: `${s.min.pa} plate appearances`, all: 'no minimum' }[playing]

  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 4 ? p : [...p, id]))
  const posOptions = cat === 'pit' ? [] : cat === 'fld' ? POSITIONS.filter((p) => p !== 'DH') : POSITIONS.filter((p) => p !== 'P')

  return (
    <div className="page">
      <header className="page-head">
        <h1>Leaderboards</h1>
        <p className="lede">
          Every regular-season stat for every NPB player. Cells are shaded by percentile against players with regular playing time, from
          {' '}<span className="swatch" style={{ background: pctColor(3) }} /> worst to <span className="swatch" style={{ background: pctColor(97) }} /> best. Hover any column heading for what it means.
        </p>
      </header>

      <div className="tabs" role="tablist" aria-label="Stat category">
        {(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => (
          <button key={c} role="tab" aria-selected={c === cat} onClick={() => set({ cat: c, group: null, sort: null, dir: null, pos: null, min: null })}>{CATEGORY_LABEL[c]}</button>
        ))}
      </div>

      <div className="filters">
        <Select label="Season" value={seasonNo ?? ''} onChange={(v) => set({ season: v })} options={[...seasons].reverse().map((y) => ({ value: y, label: String(y) }))} />
        <Select label="League" value={lg} onChange={(v) => set({ lg: v === 'all' ? null : v, team: null })} options={[
          { value: 'all', label: 'Both leagues' }, { value: 'CL', label: 'Central' }, { value: 'PL', label: 'Pacific' },
        ]} />
        <Select label="Team" value={team} onChange={(v) => set({ team: v === 'all' ? null : v })} options={[
          { value: 'all', label: 'All teams' },
          ...Object.entries(meta.data?.teams ?? {}).filter(([, t]) => lg === 'all' || t.league === lg).map(([id, t]) => ({ value: id, label: `${t.city} ${t.nick}` })),
        ]} />
        {posOptions.length > 0 && (
          <Select label="Position" value={pos} onChange={(v) => set({ pos: v === 'all' ? null : v })} options={[
            { value: 'all', label: 'All positions' }, ...posOptions.map((p) => ({ value: p, label: POSITION_NAME[p] })),
          ]} />
        )}
        <div className="filter-group">
          <span className="filter-label">Playing time</span>
          <Segmented label="Playing time" value={cat === 'fld' && playing === 'qualified' ? 'regular' : playing} onChange={(v) => set({ min: v })} options={[
            ...(cat === 'fld' ? [] : [{ value: 'qualified' as Playing, label: 'Qualified' }]),
            { value: 'regular' as Playing, label: 'Regulars' }, { value: 'all' as Playing, label: 'Everyone' },
          ]} />
        </div>
      </div>

      <Panel className="panel-flush">
        <div className="table-bar">
          <Segmented label="Stat group" value={group} onChange={(v) => set({ group: v, sort: null, dir: null })} options={groups.map((g) => ({ value: g, label: g }))} />
          <span className="table-count">{rows.length} {rows.length === 1 ? 'player' : 'players'}, minimum {minNote}</span>
        </div>
        <Status loading={season.loading || players.loading} error={season.error ?? players.error}>
          {rows.length === 0 ? (
            <p className="empty">No players match these filters. Widen the playing-time filter or pick another team.</p>
          ) : (
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th className="col-rank">#</th>
                    <th className="col-check"><span className="sr-only">Compare</span></th>
                    <th className="col-name">Player</th>
                    <th>Team</th>
                    <th>Pos</th>
                    {cols.map((c) => (
                      <th key={c.key} className="num" aria-sort={c.key === sortKey ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                        <button type="button" className="sort" onClick={() => set({ sort: c.key, dir: c.key === sortKey ? (dir === 'asc' ? 'desc' : 'asc') : null })}>
                          <StatLabel cat={cat} k={c.key} />
                          <span className="sort-arrow" aria-hidden="true">{c.key === sortKey ? (dir === 'asc' ? '▲' : '▼') : ''}</span>
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, shown).map((r, i) => {
                    const info = byId.get(r.d.row.id)
                    return (
                      <tr key={`${r.d.row.id}.${r.pos ?? ''}`}>
                        <td className="col-rank">{i + 1}</td>
                        <td className="col-check">
                          <input type="checkbox" checked={picked.includes(r.d.row.id)} onChange={() => toggle(r.d.row.id)}
                            disabled={!picked.includes(r.d.row.id) && picked.length >= 4} aria-label={`Compare ${info?.n ?? 'player'}`} />
                        </td>
                        <td className="col-name">
                          <span className="name-cell">
                            <Avatar player={info} team={r.d.row.t} size={28} />
                            <PlayerLink player={info} season={seasonNo ?? undefined} cat={cat} />
                          </span>
                        </td>
                        <td><TeamMark meta={meta.data} id={r.d.row.t} /></td>
                        <td className="muted">{r.pos ?? r.d.row.pos}</td>
                        {cols.map((c) => {
                          const v = r.v[c.key]
                          const pct = c.better && c.fmt !== 'int' && s ? percentile(s, cat, c.key, v, 'all', r.pos) : null
                          return (
                            <td key={c.key} className={c.key === sortKey ? 'num sorted' : 'num'}
                              style={pct != null ? { background: `color-mix(in srgb, ${pctColor(pct)} ${Math.round(Math.abs(pct - 50) * 1.1)}%, transparent)` } : undefined}
                              title={pct != null ? `${pct}th percentile` : undefined}>
                              {fmt(v, c.fmt, unit)}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {rows.length > shown && (
            <div className="table-more"><button type="button" className="btn" onClick={() => setShown((n) => n + 100)}>Show 100 more</button></div>
          )}
        </Status>
      </Panel>

      {picked.length > 0 && (
        <div className="tray" role="region" aria-label="Players selected to compare">
          <span>{picked.map((id) => byId.get(id)?.n).join(', ')}</span>
          <button type="button" className="btn btn-quiet" onClick={() => setPicked([])}>Clear</button>
          {picked.length >= 2
            ? <Link className="btn btn-primary" to={`/compare?p=${picked.map((id) => `${id}-${seasonNo}`).join(',')}&view=${cat === 'pit' ? 'pit' : 'bat'}`}>Compare {picked.length} players</Link>
            : <span className="muted">Pick one more to compare</span>}
        </div>
      )}
    </div>
  )
}
