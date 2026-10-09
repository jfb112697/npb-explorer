import { useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { LineChart, SprayChart, UsageBar, ZoneMap } from '../components/charts'
import { Avatar, Panel, Rail, RailScale, Segmented, Select, StatLabel, Status, TeamMark, Tip, pctColor } from '../components/ui'
import { inPool, percentile, useMeta, usePlayerDetail, usePlayers, useSeasons, valuesOf, type Derived, type Season } from '../lib/data'
import { PITCH_GROUP_NAME, PITCH_GROUP_NOTE, pitchOf } from '../lib/pitches'
import { useSettings } from '../lib/settings'
import { CATEGORY_LABEL, STAT, fmt, groupsFor, statsFor, veloLabel } from '../lib/stats'
import { POSITION_NAME, TEAM_COLOR, teamName } from '../lib/teams'
import type { Category, Line, Meta, PlayerInfo, SeasonDetail } from '../lib/types'

type View = 'bat' | 'pit'

const RAILS: Record<View, { title: string; cat: Category; groups?: string[] }[]> = {
  bat: [
    { title: 'Hitting', cat: 'bat', groups: ['Standard', 'Advanced'] },
    { title: 'Plate discipline', cat: 'bat', groups: ['Plate discipline'] },
    { title: 'Baserunning', cat: 'run' },
    { title: 'Fielding', cat: 'fld' },
  ],
  pit: [
    { title: 'Results', cat: 'pit', groups: ['Standard', 'Advanced'] },
    { title: 'Stuff and command', cat: 'pit', groups: ['Stuff and command'] },
  ],
}
const HEADLINE: Record<View, [Category, string][]> = {
  bat: [['bat', 'pa'], ['bat', 'avg'], ['bat', 'obp'], ['bat', 'slg'], ['bat', 'hr'], ['bat', 'rbi'], ['bat', 'sb'], ['bat', 'wrcp']],
  pit: [['pit', 'w'], ['pit', 'l'], ['pit', 'era'], ['pit', 'ip'], ['pit', 'so'], ['pit', 'whip'], ['pit', 'fip'], ['pit', 'sv']],
}

// ---------- bio helpers ----------
function age(born: string | undefined, season: number): number | null {
  if (!born) return null
  const [y, m, d] = born.split('-').map(Number)
  // Seasonal age: how old the player is on July 1, the convention MLB references use.
  return season - y - (m > 7 || (m === 7 && d > 1) ? 1 : 0)
}
const feet = (cm: number) => { const inches = Math.round(cm / 2.54); return `${Math.floor(inches / 12)}′${inches % 12}″` }
const pounds = (kg: number) => `${Math.round(kg * 2.20462)} lb`
const HAND = { L: 'Left', R: 'Right', S: 'Switch' } as const
const date = (md: string) => `${Number(md.slice(0, 2))}/${Number(md.slice(2))}`

function lineStats(l: Line | undefined) {
  if (!l || !l.pa) return null
  const tb = l.h + l.d + 2 * l.t + 3 * l.hr
  const avg = l.ab ? l.h / l.ab : null
  const obp = l.ab + l.bb + l.hbp + l.sf ? (l.h + l.bb + l.hbp) / (l.ab + l.bb + l.hbp + l.sf) : null
  const slg = l.ab ? tb / l.ab : null
  return { pa: l.pa, avg, obp, slg, ops: obp != null && slg != null ? obp + slg : null, hr: l.hr, kp: l.so / l.pa, bbp: l.bb / l.pa }
}

export default function Player() {
  const { id } = useParams()
  const pid = Number(id)
  const [params, setParams] = useSearchParams()
  const players = usePlayers()
  const meta = useMeta()
  const info = useMemo(() => players.data?.find((p) => p.id === pid), [players.data, pid])
  const years = useMemo(() => info?.s.map((s) => s[0]) ?? [], [info])
  const all = useSeasons(years)
  const detail = usePlayerDetail(info ? pid : null)

  if (players.loading || meta.loading) return <div className="page"><Status loading /></div>
  if (!info) {
    return (
      <div className="page">
        <header className="page-head"><h1>Player not found</h1></header>
        <p className="empty">No player has the id {id}. <Link to="/leaders">Browse the leaderboards</Link> or use the search box above.</p>
      </div>
    )
  }
  const seasonNo = years.includes(Number(params.get('season'))) ? Number(params.get('season')) : years[years.length - 1]
  const s = all.data?.get(seasonNo)
  const d = s?.byId.get(pid)
  const hasBat = (d?.row.b?.pa ?? 0) > 0
  const hasPit = !!d?.row.p
  const fallback: View = d?.row.pos === 'P' || !hasBat ? 'pit' : 'bat'
  const asked = params.get('view') as View | null
  const view: View = asked === 'pit' && hasPit ? 'pit' : asked === 'bat' && hasBat ? 'bat' : fallback
  const set = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(changes)) { if (v == null) next.delete(k); else next.set(k, v) }
    setParams(next, { replace: true })
  }

  return (
    <div className="page">
      <Header info={info} meta={meta.data} season={seasonNo} d={d} />

      <div className="player-bar">
        <Select label="Season" value={seasonNo} onChange={(v) => set({ season: v })} options={[...years].reverse().map((y) => ({ value: y, label: String(y) }))} />
        {hasBat && hasPit && (
          <Segmented label="Role" value={view} onChange={(v) => set({ view: v })} options={[{ value: 'bat', label: 'As a hitter' }, { value: 'pit', label: 'As a pitcher' }]} />
        )}
        <Link className="btn" to={`/compare?p=${pid}-${seasonNo}&view=${view}`}>Compare with another player</Link>
      </div>

      <Status loading={all.loading} error={all.error}>
        {s && d && (
          <>
            <Headline s={s} d={d} view={view} />
            <Percentiles s={s} d={d} view={view} />
            <Visuals detail={detail.data?.[String(seasonNo)]} loading={detail.loading} error={detail.error} view={view} info={info} season={seasonNo} />
            <Career info={info} meta={meta.data} seasons={all.data!} view={view} current={seasonNo} />
            <GameLog detail={detail.data?.[String(seasonNo)]} view={view} meta={meta.data} s={s} d={d} />
          </>
        )}
      </Status>
    </div>
  )
}

function Header({ info, meta, season, d }: { info: PlayerInfo; meta?: Meta; season: number; d?: Derived }) {
  const entry = info.s.find((x) => x[0] === season) ?? info.s[info.s.length - 1]
  const team = d?.row.t ?? entry[1]
  const pos = d?.row.pos ?? entry[2]
  const c = TEAM_COLOR[team] ?? { bg: 'var(--line-strong)', fg: 'var(--ink)' }
  const a = age(info.born, season)
  const first = info.s[0][0], last = info.s[info.s.length - 1][0]
  const facts: [string, string][] = []
  if (info.b || info.t) facts.push(['Bats / Throws', `${info.b ? HAND[info.b] : '–'} / ${info.t ? HAND[info.t] : '–'}`])
  if (a != null) facts.push([`Age in ${season}`, String(a)])
  if (info.ht && info.wt) facts.push(['Height / Weight', `${feet(info.ht)}, ${pounds(info.wt)}`])
  if (info.from) facts.push(['From', info.from])
  if (info.draft?.[0]) facts.push(['NPB draft', `${info.draft[0]}${info.draft[1] ? `, round ${info.draft[1]}` : ''}`])
  facts.push(['In this data', first === last ? String(first) : `${first} to ${last}`])
  return (
    <header className="player-head" style={{ '--team': c.bg, '--team-ink': c.fg } as React.CSSProperties}>
      <div className="player-photo"><Avatar player={info} team={team} size={132} /></div>
      <div className="player-id">
        <h1>{info.n}</h1>
        <p className="player-sub">
          <TeamMark meta={meta} id={team} />
          <Link to={`/leaders?team=${team}&season=${season}`}>{teamName(meta, team)}</Link>
          <span>{POSITION_NAME[pos] ?? pos}</span>
          {info.no && season === last && <span>No. {Number(info.no)}</span>}
          {info.jp && <span className="player-jp" lang="ja" title="Name as registered in Japanese">{info.jp}</span>}
        </p>
        {d?.row.ts && <p className="player-note">Played for {d.row.ts.map((t) => teamName(meta, t)).join(', then ')} in {season}. Stats cover both.</p>}
        {info.src === 'translit' && <p className="player-note">No official English spelling was found for this player, so the name is transliterated from katakana.</p>}
      </div>
      <dl className="player-facts">
        {facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
    </header>
  )
}

function Headline({ s, d, view }: { s: Season; d: Derived; view: View }) {
  const { unit } = useSettings()
  return (
    <div className="headline">
      {HEADLINE[view].map(([cat, key]) => {
        const def = STAT[`${cat}.${key}`]
        const v = valuesOf(d, cat)?.[key]
        const pct = def.better && def.fmt !== 'int' ? percentile(s, cat, key, v) : null
        return (
          <div key={key} className="headline-item">
            <div className="headline-label"><StatLabel cat={cat} k={key} /></div>
            <div className="headline-value">{fmt(v, def.fmt, unit)}</div>
            <div className="headline-bar" style={pct != null ? { background: pctColor(pct) } : undefined} />
          </div>
        )
      })}
    </div>
  )
}

function Percentiles({ s, d, view }: { s: Season; d: Derived; view: View }) {
  // Fielding is ranked one position at a time, so let the reader choose which.
  const fieldPositions = Object.entries(d.row.f ?? {}).filter(([p]) => p !== 'P').sort((a, b) => (b[1].o ?? 0) - (a[1].o ?? 0)).map(([p]) => p)
  const [pickedPos, setPickedPos] = useState<string | null>(null)
  const fieldPos = pickedPos && fieldPositions.includes(pickedPos) ? pickedPos : fieldPositions.includes(d.mainPos ?? '') ? d.mainPos : fieldPositions[0]
  const blocks = RAILS[view].map((b) => {
    const pos = b.cat === 'fld' ? fieldPos : undefined
    if (b.cat === 'fld' && (!pos || pos === 'P' || !d.fld?.[pos])) return null
    const values = valuesOf(d, b.cat, pos)
    if (!values) return null
    const defs = statsFor(b.cat).filter((x) => x.rail && (!b.groups || b.groups.includes(x.group)) && (x.group !== 'Catching' || pos === 'C'))
    const items = defs.map((def) => ({ def, value: values[def.key], pct: percentile(s, b.cat, def.key, values[def.key], 'all', pos) }))
      .filter((x) => x.value != null)
    if (!items.length) return null
    return { ...b, pos, items, qualified: inPool(s, d, b.cat, pos) }
  }).filter((b) => b != null)
  if (!blocks.length) return null
  const poolNote = view === 'pit' ? `${s.min.bf} batters faced` : `${s.min.pa} plate appearances`
  return (
    <Panel
      title={`${s.season} percentile rankings`}
      note={<>Where this player ranks among NPB {view === 'pit' ? 'pitchers' : 'hitters'} with at least {poolNote}. 100 is the best in the league, 50 is the median. Hover a stat name for its definition and how it compares with MLB.</>}
    >
      <div className="rail-grid">
        {blocks.map((b) => (
          <div key={b.title} className="rail-block">
            <h3>
              {b.title}{b.pos && <span className="muted"> at {POSITION_NAME[b.pos]?.toLowerCase()}, {fmt(d.row.f?.[b.pos]?.o ?? 0, 'ip')} innings</span>}
              {!b.qualified && (
                <Tip content={<div className="stat-tip"><p>Below the playing-time minimum for this group, so these ranks rest on a small sample. The player is ranked against the qualified pool but is not part of it.</p></div>}>
                  <span className="chip chip-warn">Small sample</span>
                </Tip>
              )}
            </h3>
            {b.cat === 'fld' && fieldPositions.length > 1 && (
              <div className="rail-filter">
                <Segmented label="Fielding position" value={b.pos!} onChange={setPickedPos}
                  options={fieldPositions.map((p) => ({ value: p, label: p, title: `${POSITION_NAME[p]}, ${d.row.f?.[p]?.g ?? 0} games` }))} />
              </div>
            )}
            <RailScale />
            {b.items.map((x) => <Rail key={x.def.key} cat={b.cat} k={x.def.key} value={x.value} pct={x.pct} />)}
          </div>
        ))}
      </div>
    </Panel>
  )
}

function Visuals({ detail, loading, error, view, info, season }: { detail?: SeasonDetail; loading: boolean; error?: string; view: View; info: PlayerInfo; season: number }) {
  const { unit } = useSettings()
  if (loading || error) return <Panel title="Pitch and batted-ball detail"><Status loading={loading} error={error} /></Panel>
  if (!detail) return null
  const spray = view === 'bat' ? detail.spray : detail.pspray
  const grid = view === 'bat' ? detail.bg : detail.pg
  const splits = view === 'bat' ? detail.sb : detail.sp
  const totalPitches = (detail.ars ?? []).reduce((a, p) => a + p.n, 0)
  return (
    <>
      <div className="two-col">
        {spray && spray.length > 0 && (
          <Panel title={view === 'bat' ? 'Spray chart' : 'Balls in play allowed'}
            note="Where each tracked ball in play was fielded or landed. The feed uses a stylized field, so read direction, not distance.">
            <SprayChart points={spray} title={`${info.n} ${season} spray chart`} />
          </Panel>
        )}
        {grid && (
          <Panel title={view === 'bat' ? 'Pitches seen by location' : 'Pitch locations'}
            note={view === 'bat' ? 'Where this hitter does damage, how pitchers attack him and where he swings and misses.' : 'Where this pitcher wins and loses, where he works and where he gets swings and misses.'}>
            <ZoneMap grid={grid} perspective={view === 'bat' ? 'batter' : 'pitcher'} />
          </Panel>
        )}
      </div>

      {view === 'pit' && detail.ars && totalPitches > 0 && (
        <Panel title="Pitch arsenal" note="Pitch types as the Japanese scorers classify them. Hover a pitch name where the Japanese label differs from MLB usage.">
          <UsageBar pitches={detail.ars} />
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th className="col-name">Pitch</th>
                  <th className="num">Usage</th><th className="num">vs L</th><th className="num">vs R</th>
                  <th className="num"><Tip content={<div className="stat-tip"><div className="stat-tip-name">Run value</div><p>Runs saved with this pitch over the season, from the change in count and the outcome of every one thrown. Positive is good for the pitcher.</p><p className="stat-tip-mlb"><span>MLB frame of reference</span>Savant’s pitch Run Value, without the base-out state.</p></div>} className="stat-label">RV</Tip></th>
                  <th className="num"><Tip content={<div className="stat-tip"><p>Run value per 100 pitches of this type, so pitches thrown at different rates can be compared.</p></div>} className="stat-label">RV/100</Tip></th>
                  <th className="num">Velo ({veloLabel(unit)})</th><th className="num">Max</th>
                  <th className="num"><StatLabel cat="pit" k="whiffp" /></th><th className="num"><StatLabel cat="pit" k="chasep" /></th>
                  <th className="num"><StatLabel cat="pit" k="zonep" /></th>
                  <th className="num"><Tip content={<div className="stat-tip"><p>Batting average on plate appearances that ended on this pitch.</p></div>} className="stat-label">AVG</Tip></th>
                  <th className="num"><Tip content={<div className="stat-tip"><p>Slugging on plate appearances that ended on this pitch.</p></div>} className="stat-label">SLG</Tip></th>
                  <th className="num"><Tip content={<div className="stat-tip"><p>Share of plate appearances ending on this pitch that were strikeouts. Savant calls this PutAway% when measured per two-strike pitch; this version is per plate appearance.</p></div>} className="stat-label">K%</Tip></th>
                </tr>
              </thead>
              <tbody>
                {detail.ars.filter((p) => p.n >= 5).map((p) => {
                  const t = pitchOf(p.id)
                  const vsL = detail.ars!.reduce((a, x) => a + x.L, 0), vsR = detail.ars!.reduce((a, x) => a + x.R, 0)
                  return (
                    <tr key={p.id}>
                      <td className="col-name">
                        <span className="pitch-name">
                          <i className="legend-dot" style={{ background: t.color }} />
                          {t.note ? <Tip content={<div className="stat-tip"><div className="stat-tip-name">{t.name}</div><p>{t.note}</p></div>} className="stat-label">{t.name}</Tip> : t.name}
                        </span>
                      </td>
                      <td className="num">{fmt(p.n / totalPitches, 'pct')}</td>
                      <td className="num">{fmt(vsL ? p.L / vsL : null, 'pct')}</td>
                      <td className="num">{fmt(vsR ? p.R / vsR : null, 'pct')}</td>
                      <td className="num">{fmt(p.rv ?? null, 'signed')}</td>
                      <td className="num">{fmt(p.rv != null && p.n >= 30 ? (p.rv / p.n) * 100 : null, 'signed')}</td>
                      <td className="num">{fmt(p.v, 'velo', unit)}</td>
                      <td className="num">{fmt(p.vmax || null, 'velo', unit)}</td>
                      <td className="num">{fmt(p.sw >= 10 ? p.wh / p.sw : null, 'pct')}</td>
                      <td className="num">{fmt(p.on >= 10 ? p.osw / p.on : null, 'pct')}</td>
                      <td className="num">{fmt(p.z / p.n, 'pct')}</td>
                      <td className="num">{fmt(p.ab >= 5 ? p.h / p.ab : null, 'avg')}</td>
                      <td className="num">{fmt(p.ab >= 5 ? p.tb / p.ab : null, 'avg')}</td>
                      <td className="num">{fmt(p.pa >= 5 ? p.k / p.pa : null, 'pct')}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <div className="two-col">
        {splits && (
          <Panel title="Platoon splits" note={view === 'bat' ? 'Against left- and right-handed pitchers.' : 'Against left- and right-handed batters.'}>
            <SplitTable rows={(['L', 'R'] as const).map((h) => ({ label: view === 'bat' ? `vs ${h === 'L' ? 'left' : 'right'}-handed pitchers` : `vs ${h === 'L' ? 'left' : 'right'}-handed batters`, s: lineStats(splits[h]) }))} />
          </Panel>
        )}
        {view === 'bat' && detail.vs && (
          <Panel title="By pitch type" note="Results on plate appearances ending on each family of pitches, and swings against all of them.">
            <div className="table-scroll">
              <table className="data">
                <thead><tr><th className="col-name">Pitches</th><th className="num">Seen</th><th className="num">Share</th><th className="num"><StatLabel cat="bat" k="rv" /></th><th className="num">AVG</th><th className="num">SLG</th><th className="num"><StatLabel cat="bat" k="whiffp" /></th></tr></thead>
                <tbody>
                  {(['FB', 'BR', 'OS'] as const).map((g) => {
                    const v = detail.vs![g]
                    if (!v) return null
                    const total = Object.values(detail.vs!).reduce((a, x) => a + x.n, 0)
                    return (
                      <tr key={g}>
                        <td className="col-name"><Tip content={<div className="stat-tip"><p>{PITCH_GROUP_NOTE[g]}</p></div>} className="stat-label">{PITCH_GROUP_NAME[g]}</Tip></td>
                        <td className="num">{v.n}</td>
                        <td className="num">{fmt(v.n / total, 'pct')}</td>
                        <td className="num">{fmt(v.rv ?? null, 'signed')}</td>
                        <td className="num">{fmt(v.ab >= 5 ? v.h / v.ab : null, 'avg')}</td>
                        <td className="num">{fmt(v.ab >= 5 ? v.tb / v.ab : null, 'avg')}</td>
                        <td className="num">{fmt(v.sw >= 10 ? v.wh / v.sw : null, 'pct')}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        )}
      </div>
    </>
  )
}

function SplitTable({ rows }: { rows: { label: string; s: ReturnType<typeof lineStats> }[] }) {
  return (
    <div className="table-scroll">
      <table className="data">
        <thead><tr><th className="col-name">Split</th><th className="num">PA</th><th className="num">AVG</th><th className="num">OBP</th><th className="num">SLG</th><th className="num">OPS</th><th className="num">HR</th><th className="num">K%</th><th className="num">BB%</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="col-name">{r.label}</td>
              <td className="num">{r.s?.pa ?? '–'}</td>
              <td className="num">{fmt(r.s?.avg, 'avg')}</td><td className="num">{fmt(r.s?.obp, 'avg')}</td>
              <td className="num">{fmt(r.s?.slg, 'avg')}</td><td className="num">{fmt(r.s?.ops, 'avg')}</td>
              <td className="num">{r.s?.hr ?? '–'}</td>
              <td className="num">{fmt(r.s?.kp, 'pct')}</td><td className="num">{fmt(r.s?.bbp, 'pct')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Career({ info, meta, seasons, view, current }: { info: PlayerInfo; meta?: Meta; seasons: Map<number, Season>; view: View; current: number }) {
  const { unit } = useSettings()
  const cats: Category[] = view === 'pit' ? ['pit'] : ['bat', 'run', 'fld']
  const [cat, setCat] = useState<Category>(cats[0])
  const active = cats.includes(cat) ? cat : cats[0]
  const groups = groupsFor(active)
  const [group, setGroup] = useState(groups[0])
  const activeGroup = groups.includes(group) ? group : groups[0]
  const cols = statsFor(active).filter((x) => x.group === activeGroup)
  const rows: { season: number; s: Season; d: Derived; pos?: string }[] = []
  for (const [year] of info.s) {
    const s = seasons.get(year), d = s?.byId.get(info.id)
    if (!s || !d) continue
    if (active === 'fld') {
      for (const pos of Object.keys(d.fld ?? {})) if (activeGroup !== 'Catching' || pos === 'C') rows.push({ season: year, s, d, pos })
    } else if (valuesOf(d, active)) rows.push({ season: year, s, d })
  }
  return (
    <Panel
      title="Season by season"
      note="Regular season only. Shading shows each season’s percentile rank within that year."
      actions={
        <>
          {cats.length > 1 && <Segmented label="Category" value={active} onChange={(c) => { setCat(c); setGroup(groupsFor(c)[0]) }} options={cats.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))} />}
          {groups.length > 1 && <Segmented label="Stat group" value={activeGroup} onChange={setGroup} options={groups.map((g) => ({ value: g, label: g }))} />}
        </>
      }
      className="panel-flush"
    >
      {rows.length === 0 ? <p className="empty">Nothing recorded in this category.</p> : (
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>Season</th><th>Team</th>{active === 'fld' && <th>Pos</th>}
                {cols.map((c) => <th key={c.key} className="num"><StatLabel cat={active} k={c.key} /></th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const v = valuesOf(r.d, active, r.pos)!
                return (
                  <tr key={`${r.season}.${r.pos ?? ''}`} className={r.season === current ? 'current' : undefined}>
                    <td><Link to={`?season=${r.season}${view === 'pit' ? '&view=pit' : ''}`}>{r.season}</Link></td>
                    <td><TeamMark meta={meta} id={r.d.row.t} /></td>
                    {active === 'fld' && <td className="muted">{r.pos}</td>}
                    {cols.map((c) => {
                      const pct = c.better && c.fmt !== 'int' ? percentile(r.s, active, c.key, v[c.key], 'all', r.pos) : null
                      return (
                        <td key={c.key} className="num" title={pct != null ? `${pct}th percentile` : undefined}
                          style={pct != null ? { background: `color-mix(in srgb, ${pctColor(pct)} ${Math.round(Math.abs(pct - 50) * 1.1)}%, transparent)` } : undefined}>
                          {fmt(v[c.key], c.fmt, unit)}
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
    </Panel>
  )
}

function GameLog({ detail, view, meta, s, d }: { detail?: SeasonDetail; view: View; meta?: Meta; s: Season; d: Derived }) {
  const [all, setAll] = useState(false)
  const log = view === 'bat' ? detail?.glb : detail?.glp
  const trend = useMemo(() => {
    if (!log) return []
    if (view === 'bat') {
      const W = 15
      return log.map((g, i) => {
        if (i < W - 1) return { label: date(String(g[0])), y: null }
        let ab = 0, h = 0, tb = 0, bb = 0, hbp = 0, sf = 0
        for (const x of log.slice(i - W + 1, i + 1)) { ab += x[3]; h += x[4]; tb += x[4] + x[5] + 2 * x[6] + 3 * x[7]; bb += x[9]; hbp += x[13]; sf += x[14] }
        const obp = ab + bb + hbp + sf ? (h + bb + hbp) / (ab + bb + hbp + sf) : 0
        return { label: date(String(g[0])), y: ab ? obp + tb / ab : null }
      })
    }
    let outs = 0, er = 0
    return log.map((g) => { outs += g[3]; er += g[6]; return { label: date(String(g[0])), y: outs ? (27 * er) / outs : null } })
  }, [log, view])
  if (!log?.length) return null
  const shown = all ? [...log].reverse() : log.slice(-10).reverse()
  const lgOps = s.league.all.obp + s.league.all.slg
  return (
    <Panel title="Game log" note={view === 'bat' ? 'Rolling 15-game OPS across the season, with the most recent games below.' : 'Season ERA after each appearance, with the most recent games below.'}>
      <LineChart
        series={[{ name: view === 'bat' ? 'OPS' : 'ERA', color: 'var(--accent)', points: trend }]}
        baseline={view === 'bat' ? { y: lgOps, label: `League OPS ${fmt(lgOps, 'avg')}` } : { y: s.league.pit.era, label: `League ERA ${s.league.pit.era.toFixed(2)}` }}
        format={(v) => (view === 'bat' ? fmt(v, 'avg') : v.toFixed(2))}
        yLabel={view === 'bat' ? 'Rolling 15-game OPS. Hover the chart to read a date.' : 'Season-to-date ERA. Hover the chart to read a date.'}
      />
      <div className="table-scroll">
        <table className="data">
          <thead>
            {view === 'bat'
              ? <tr><th>Date</th><th>Opp</th><th className="num">PA</th><th className="num">AB</th><th className="num">H</th><th className="num">2B</th><th className="num">3B</th><th className="num">HR</th><th className="num">RBI</th><th className="num">BB</th><th className="num">SO</th><th className="num">SB</th><th className="num">R</th></tr>
              : <tr><th>Date</th><th>Opp</th><th>Role</th><th className="num">IP</th><th className="num">H</th><th className="num">R</th><th className="num">ER</th><th className="num">BB</th><th className="num">SO</th><th className="num">HR</th><th className="num">Pitches</th><th className="num">BF</th></tr>}
          </thead>
          <tbody>
            {shown.map((g, i) => (
              <tr key={i}>
                <td>{date(String(g[0]))}</td>
                <td><TeamMark meta={meta} id={g[1]} /></td>
                {view === 'bat'
                  ? g.slice(2, 13).map((v, k) => <td key={k} className="num">{v}</td>)
                  : <>
                      <td className="muted">{g[2] ? 'Start' : 'Relief'}</td>
                      <td className="num">{fmt(g[3], 'ip')}</td>
                      {g.slice(4, 12).map((v, k) => <td key={k} className="num">{v}</td>)}
                    </>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {log.length > 10 && (
        <div className="table-more">
          <button type="button" className="btn" onClick={() => setAll((x) => !x)}>{all ? 'Show the last 10 games' : `Show all ${log.length} games`}</button>
          <span className="muted">{d.row.ts ? 'Includes games for every team that season.' : ''}</span>
        </div>
      )}
    </Panel>
  )
}
