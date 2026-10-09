import { useMemo, useState } from 'react'
import { pitchOf } from '../lib/pitches'
import type { ArsenalPitch, Grid } from '../lib/types'
import { Segmented, pctColor } from './ui'

// ---------- spray chart ----------
// The feed's hit coordinates put home plate bottom-left with the left-field line vertical.
// Rotating 45 degrees gives the usual view from behind home plate.
const HOME_X = 40, HOME_Y = 250, R2 = Math.SQRT1_2
const WALL = 238, DIRT = 138, BASE = 82
const KINDS = [
  { key: 'out', label: 'Out', color: 'var(--chart-out)' },
  { key: '1b', label: 'Single', color: '#19A0D8' },
  { key: '2b', label: 'Double', color: '#2E9E4F' },
  { key: '3b', label: 'Triple', color: '#E3A008' },
  { key: 'hr', label: 'Home run', color: '#D7332A' },
  { key: 'e', label: 'Error or fielder’s choice', color: 'var(--chart-out)' },
] as const

export function SprayChart({ points, title }: { points: number[]; title: string }) {
  const [filter, setFilter] = useState<'all' | 'hits' | 'outs'>('all')
  const dots = useMemo(() => {
    const out: { u: number; v: number; kind: number }[] = []
    for (let i = 0; i + 2 < points.length; i += 3) {
      const dx = points[i] - HOME_X, dy = HOME_Y - points[i + 1]
      out.push({ u: (dx - dy) * R2, v: (dx + dy) * R2, kind: points[i + 2] >> 1 })
    }
    return out
  }, [points])
  const counts = KINDS.map((_, k) => dots.filter((d) => d.kind === k).length)
  const shown = dots.filter((d) => (filter === 'all' ? true : filter === 'hits' ? d.kind >= 1 && d.kind <= 4 : d.kind === 0 || d.kind === 5))
  const top = 262
  const y = (v: number) => top - 14 - v
  const edge = WALL * R2
  return (
    <figure className="chart">
      <div className="chart-controls">
        <Segmented label="Show" value={filter} onChange={setFilter} options={[
          { value: 'all', label: 'All' }, { value: 'hits', label: 'Hits' }, { value: 'outs', label: 'Outs' },
        ]} />
      </div>
      <svg viewBox={`-176 0 352 ${top}`} role="img" aria-label={`${title}: ${dots.length} tracked balls in play`}>
        <path d={`M0 ${y(0)} L${-edge} ${y(edge)} A${WALL} ${WALL} 0 0 1 ${edge} ${y(edge)} Z`} className="field-grass" />
        <path d={`M0 ${y(0)} L${-DIRT * R2} ${y(DIRT * R2)} A${DIRT} ${DIRT} 0 0 1 ${DIRT * R2} ${y(DIRT * R2)} Z`} className="field-dirt" />
        <path d={`M0 ${y(0)} L${-BASE * R2} ${y(BASE * R2)} L0 ${y(BASE * Math.SQRT2)} L${BASE * R2} ${y(BASE * R2)} Z`} className="field-diamond" />
        <path d={`M0 ${y(0)} L${-edge} ${y(edge)} M0 ${y(0)} L${edge} ${y(edge)}`} className="field-line" />
        {shown.map((d, i) => (
          <circle key={i} cx={d.u} cy={y(d.v)} r={d.kind === 0 ? 2.4 : 3.4}
            fill={d.kind === 5 ? 'none' : KINDS[d.kind].color}
            stroke={d.kind === 5 ? 'var(--chart-out)' : 'var(--surface)'} strokeWidth={d.kind === 5 ? 1.2 : 0.6}
            opacity={d.kind === 0 ? 0.55 : 0.9} />
        ))}
      </svg>
      <figcaption className="legend">
        {KINDS.map((k, i) => counts[i] > 0 && (
          <span key={k.key}>
            <i className={i === 5 ? 'legend-dot hollow' : 'legend-dot'} style={{ background: i === 5 ? undefined : k.color }} />
            {k.label} <b>{counts[i]}</b>
          </span>
        ))}
      </figcaption>
    </figure>
  )
}

// ---------- pitch location heatmap ----------
type GridMetric = 'rv' | 'n' | 'sw' | 'wh' | 'h'
const GRID_METRICS: { value: GridMetric; label: string; title: string }[] = [
  { value: 'rv', label: 'Run value', title: 'Runs gained or lost on pitches in each cell' },
  { value: 'n', label: 'Pitches', title: 'Share of all pitches in each cell' },
  { value: 'sw', label: 'Swing%', title: 'Swings per pitch in each cell' },
  { value: 'wh', label: 'Whiff%', title: 'Misses per swing in each cell' },
  { value: 'h', label: 'Hits', title: 'Hits on pitches in each cell' },
]

export function ZoneMap({ grid, perspective }: { grid: Grid; perspective: 'batter' | 'pitcher' }) {
  const [picked, setMetric] = useState<GridMetric>('rv')
  // Older data files have no run values; fall back to pitch share.
  const metric: GridMetric = picked === 'rv' && !grid.rv ? 'n' : picked
  const total = grid.n.reduce((a, b) => a + b, 0)
  const cells = useMemo(() => {
    return grid.n.map((count, i) => {
      let value: number | null = null, text = ''
      if (metric === 'rv') { value = count >= 3 ? grid.rv![i] : null; text = value != null && Math.abs(value) >= 0.05 ? (value > 0 ? '+' : '') + value.toFixed(1) : '' }
      else if (metric === 'n') { value = total ? count / total : null; text = value != null && value >= 0.005 ? (value * 100).toFixed(1) : '' }
      else if (metric === 'sw') { value = count >= 8 ? grid.sw[i] / count : null; text = value != null ? String(Math.round(value * 100)) : '' }
      else if (metric === 'wh') { value = grid.sw[i] >= 8 ? grid.wh[i] / grid.sw[i] : null; text = value != null ? String(Math.round(value * 100)) : '' }
      else { value = grid.h[i]; text = value ? String(value) : '' }
      return { value, text }
    })
  }, [grid, metric, total])
  const max = Math.max(0.0001, ...cells.map((c) => Math.abs(c.value ?? 0)))
  const scaleMax = metric === 'sw' || metric === 'wh' ? Math.max(0.5, max) : max
  const CW = 30, CH = 37.5
  return (
    <figure className="chart">
      <div className="chart-controls">
        <Segmented label="Heatmap metric" value={metric} onChange={setMetric} options={GRID_METRICS} />
      </div>
      <svg viewBox={`-6 -6 ${CW * 10 + 12} ${CH * 10 + 34}`} role="img" aria-label={`Pitch location heatmap, ${GRID_METRICS.find((m) => m.value === metric)!.label}, catcher’s view, ${total} pitches`}>
        {cells.map((c, i) => {
          const col = i % 10, row = Math.floor(i / 10)
          const t = c.value == null ? 0 : Math.min(1, Math.abs(c.value) / scaleMax)
          return (
            <g key={i}>
              {metric === 'rv'
                ? <rect x={col * CW + 1} y={row * CH + 1} width={CW - 2} height={CH - 2} rx={3}
                    fill={c.value == null ? 'var(--line)' : pctColor(50 + (c.value / max) * 50)} fillOpacity={c.value == null ? 0.25 : 0.12 + Math.abs(c.value / max) * 0.88} />
                : <rect x={col * CW + 1} y={row * CH + 1} width={CW - 2} height={CH - 2} rx={3}
                    fill="var(--heat)" fillOpacity={c.value == null ? 0 : 0.06 + t * 0.9} />}
              {c.text && (
                <text x={col * CW + CW / 2} y={row * CH + CH / 2 + 4} textAnchor="middle" className="heat-text"
                  fill={metric === 'rv' ? (t > 0.5 ? '#fff' : 'var(--ink)') : t > 0.55 ? 'var(--heat-ink)' : 'var(--ink-2)'}>{c.text}</text>
              )}
            </g>
          )
        })}
        <rect x={2 * CW} y={2 * CH} width={6 * CW} height={6 * CH} className="zone-box" />
        <path d={`M${3.4 * CW} ${10 * CH + 8} h${3.2 * CW} l0 8 l${-1.6 * CW} 10 l${-1.6 * CW} -10 Z`} className="plate" />
      </svg>
      <figcaption className="chart-caption">
        Catcher’s view{perspective === 'pitcher' ? ', all batters' : ''}. The outlined box is the strike zone. {total.toLocaleString()} tracked pitches.
        {metric === 'rv' && <> Run value is in runs for the season: red cells are where this {perspective === 'pitcher' ? 'pitcher' : 'hitter'} gains, blue where he gives runs back.</>}
      </figcaption>
    </figure>
  )
}

// ---------- line chart ----------
export interface Series { name: string; color: string; points: { label: string; y: number | null }[] }

export function LineChart({ series, baseline, format, yLabel, height = 230 }: {
  series: Series[]; baseline?: { y: number; label: string }; format: (v: number) => string; yLabel: string; height?: number
}) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 1080, H = height, L = 46, Rg = 12, T = 14, B = 24
  const len = Math.max(...series.map((s) => s.points.length))
  const ys = series.flatMap((s) => s.points.map((p) => p.y)).filter((v): v is number => v != null)
  if (baseline) ys.push(baseline.y)
  if (len < 2 || !ys.length) return <p className="empty">Not enough games to draw a trend yet.</p>
  let lo = Math.min(...ys), hi = Math.max(...ys)
  const pad = (hi - lo || 1) * 0.12
  lo -= pad; hi += pad
  const x = (i: number) => L + (i / (len - 1)) * (W - L - Rg)
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B)
  const ticks = [0, 1, 2, 3].map((i) => lo + pad + ((hi - lo - 2 * pad) * i) / 3)
  const labels = series[0].points.map((p) => p.label)
  const xTicks = [0, Math.floor((len - 1) / 3), Math.floor((2 * (len - 1)) / 3), len - 1]
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={yLabel}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const px = ((e.clientX - r.left) / r.width) * W
          setHover(Math.max(0, Math.min(len - 1, Math.round(((px - L) / (W - L - Rg)) * (len - 1)))))
        }}
        onMouseLeave={() => setHover(null)}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={L} x2={W - Rg} y1={y(t)} y2={y(t)} className="grid-line" />
            <text x={L - 6} y={y(t) + 4} textAnchor="end" className="axis-text">{format(t)}</text>
          </g>
        ))}
        {xTicks.map((i) => <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === len - 1 ? 'end' : 'middle'} className="axis-text">{labels[i]}</text>)}
        {baseline && (
          <>
            <line x1={L} x2={W - Rg} y1={y(baseline.y)} y2={y(baseline.y)} className="base-line" />
            <text x={L + 6} y={y(baseline.y) - 5} className="axis-text">{baseline.label}</text>
          </>
        )}
        {series.map((s) => {
          let d = '', pen = false
          s.points.forEach((p, i) => {
            if (p.y == null) { pen = false; return }
            d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.y).toFixed(1)}`
            pen = true
          })
          return <path key={s.name} d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        })}
        {hover != null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="cross-line" />
            {series.map((s) => s.points[hover]?.y != null && (
              <circle key={s.name} cx={x(hover)} cy={y(s.points[hover].y!)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
            ))}
          </>
        )}
      </svg>
      <figcaption className="chart-readout" aria-live="off">
        {hover != null
          ? <><span>{labels[hover]}</span>{series.map((s) => <span key={s.name}><i className="legend-dot" style={{ background: s.color }} />{series.length > 1 ? `${s.name} ` : ''}<b>{s.points[hover]?.y != null ? format(s.points[hover].y!) : '–'}</b></span>)}</>
          : <span>{yLabel}{series.length > 1 && series.map((s) => <span key={s.name} className="legend-inline"><i className="legend-dot" style={{ background: s.color }} />{s.name}</span>)}</span>}
      </figcaption>
    </figure>
  )
}

// ---------- pitch usage ----------
export function UsageBar({ pitches }: { pitches: ArsenalPitch[] }) {
  const total = pitches.reduce((a, p) => a + p.n, 0)
  if (!total) return null
  return (
    <div className="usage" role="img" aria-label={'Pitch mix: ' + pitches.map((p) => `${pitchOf(p.id).name} ${Math.round((p.n / total) * 100)}%`).join(', ')}>
      {pitches.filter((p) => p.n / total >= 0.005).map((p) => {
        const t = pitchOf(p.id)
        const share = p.n / total
        return (
          <span key={p.id} style={{ flexGrow: share, background: t.color }} title={`${t.name} ${(share * 100).toFixed(1)}%`}>
            {share >= 0.07 && <>{t.short} {Math.round(share * 100)}%</>}
          </span>
        )
      })}
    </div>
  )
}
