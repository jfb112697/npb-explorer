import { useCallback, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { useSettings } from '../lib/settings'
import { STAT, fmt, veloLabel, type StatDef } from '../lib/stats'
import { TEAM_COLOR, teamName } from '../lib/teams'
import type { Category, Meta, PlayerInfo } from '../lib/types'

// ---------- percentile color ----------
const STOPS: [number, [number, number, number]][] = [
  [0, [38, 70, 166]],
  [50, [160, 168, 187]],
  [100, [215, 51, 42]],
]
/** Indigo for the bottom of the league, vermilion for the top: the Savant convention. */
// eslint-disable-next-line react-refresh/only-export-components
export function pctColor(p: number): string {
  const x = Math.min(100, Math.max(0, p))
  const hi = x <= 50 ? 1 : 2
  const [a, ca] = STOPS[hi - 1], [b, cb] = STOPS[hi]
  const t = (x - a) / (b - a)
  const c = ca.map((v, i) => Math.round(v + (cb[i] - v) * t))
  return `rgb(${c[0]} ${c[1]} ${c[2]})`
}
// eslint-disable-next-line react-refresh/only-export-components
export const pctInk = (p: number) => (p > 28 && p < 72 ? '#14182B' : '#FFFFFF')

// ---------- tooltip ----------
export function Tip({ content, children, className }: { content: ReactNode; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<CSSProperties>({ left: 0, top: 0, visibility: 'hidden' })
  const anchor = useRef<HTMLSpanElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const tipId = useId()

  useLayoutEffect(() => {
    if (!open || !anchor.current || !box.current) return
    const a = anchor.current.getBoundingClientRect()
    const b = box.current.getBoundingClientRect()
    const margin = 8
    let left = a.left + a.width / 2 - b.width / 2
    left = Math.max(margin, Math.min(left, window.innerWidth - b.width - margin))
    const above = a.top - b.height - 8
    const top = above < margin ? a.bottom + 8 : above
    setPos({ left, top, visibility: 'visible' })
  }, [open, content])

  const show = useCallback(() => setOpen(true), [])
  const hide = useCallback(() => { setOpen(false); setPos((p) => ({ ...p, visibility: 'hidden' })) }, [])

  return (
    <>
      <span
        ref={anchor}
        className={className ? `tip-anchor ${className}` : 'tip-anchor'}
        tabIndex={0}
        aria-describedby={open ? tipId : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onKeyDown={(e) => e.key === 'Escape' && hide()}
      >
        {children}
      </span>
      {open && createPortal(<div ref={box} id={tipId} role="tooltip" className="tip" style={pos}>{content}</div>, document.body)}
    </>
  )
}

export function StatTip({ def }: { def: StatDef }) {
  const { unit } = useSettings()
  return (
    <div className="stat-tip">
      <div className="stat-tip-name">
        {def.name}
        {def.fmt === 'velo' && <span className="stat-tip-unit"> ({veloLabel(unit)})</span>}
      </div>
      <p>{def.desc}</p>
      {def.mlb && (
        <p className="stat-tip-mlb">
          <span>MLB frame of reference</span>
          {def.mlb}
        </p>
      )}
      {def.better && <p className="stat-tip-dir">{def.better === 'high' ? 'Higher is better.' : 'Lower is better.'}</p>}
    </div>
  )
}

/** A stat abbreviation that explains itself on hover or keyboard focus. */
export function StatLabel({ cat, k, children }: { cat: Category; k: string; children?: ReactNode }) {
  const def = STAT[`${cat}.${k}`]
  if (!def) return <>{children ?? k}</>
  return (
    <Tip content={<StatTip def={def} />} className="stat-label">
      {children ?? def.label}
    </Tip>
  )
}

// ---------- percentile rail ----------
export function Rail({ cat, k, value, pct, small }: { cat: Category; k: string; value: number | null | undefined; pct: number | null; small?: boolean }) {
  const { unit } = useSettings()
  const def = STAT[`${cat}.${k}`]
  if (!def) return null
  const neutral = !def.better
  const color = pct == null ? 'var(--line-strong)' : neutral ? 'var(--neutral-dot)' : pctColor(pct)
  return (
    <div className={small ? 'rail rail-small' : 'rail'}>
      <div className="rail-label"><StatLabel cat={cat} k={k} /></div>
      <div className="rail-track" aria-hidden="true">
        <span className="rail-mid" />
        {pct != null && (
          <>
            <span className="rail-fill" style={{ width: `${pct}%`, background: color }} />
            <span className="rail-dot" style={{ left: `${pct}%`, background: color, color: neutral ? 'var(--bg)' : pctInk(pct) }}>{pct}</span>
          </>
        )}
      </div>
      <div className="rail-value">
        {fmt(value, def.fmt, unit)}
        <span className="sr-only">{pct != null ? `, ${pct}th percentile` : ', no percentile'}</span>
      </div>
    </div>
  )
}

export function RailScale() {
  return (
    <div className="rail rail-scale" aria-hidden="true">
      <div />
      <div className="rail-scale-labels"><span>Poor</span><span>Average</span><span>Great</span></div>
      <div />
    </div>
  )
}

// ---------- identity ----------
export function TeamMark({ meta, id, withName }: { meta?: Meta; id: number; withName?: boolean | 'short' }) {
  const c = TEAM_COLOR[id] ?? { bg: 'var(--line-strong)', fg: 'var(--ink)' }
  const t = meta?.teams[id]
  return (
    <span className="team-mark-wrap" title={withName ? undefined : teamName(meta, id)}>
      <span className="team-mark" style={{ background: c.bg, color: c.fg }}>{t?.abbr ?? '—'}</span>
      {withName && <span>{teamName(meta, id, withName === 'short')}</span>}
    </span>
  )
}

export function Avatar({ player, team, size = 40 }: { player?: PlayerInfo; team?: number; size?: number }) {
  const [failed, setFailed] = useState(false)
  const c = (team != null && TEAM_COLOR[team]) || { bg: 'var(--line-strong)', fg: 'var(--ink)' }
  const initials = (player?.n ?? '?').split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
  const style = { width: size, height: size, fontSize: size * 0.36, background: c.bg, color: c.fg }
  return (
    <span className="avatar" style={style}>
      {player?.ph && !failed
        ? <img src={player.ph} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
        : <span aria-hidden="true">{initials}</span>}
    </span>
  )
}

export function PlayerLink({ player, season, cat, children }: { player: PlayerInfo | undefined; season?: number; cat?: Category; children?: ReactNode }) {
  if (!player) return <>{children ?? '—'}</>
  const q = new URLSearchParams()
  if (season) q.set('season', String(season))
  if (cat === 'pit') q.set('view', 'pit')
  const qs = q.toString()
  return <Link className="player-link" to={`/player/${player.id}${qs ? `?${qs}` : ''}`}>{children ?? player.n}</Link>
}

// ---------- controls ----------
export function Segmented<T extends string>({ value, onChange, options, label }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; title?: string }[]; label: string
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} title={o.title} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  )
}

export function Select<T extends string | number>({ value, onChange, options, label }: {
  value: T; onChange: (v: string) => void; options: { value: T; label: string }[]; label: string
}) {
  return (
    <label className="select">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}

export function Status({ loading, error, children }: { loading?: boolean; error?: string; children?: ReactNode }) {
  if (error) return <div className="status status-error" role="alert">The data did not load. {error}. Reload the page to try again.</div>
  if (loading) return <div className="status" role="status">Loading…</div>
  return <>{children}</>
}

export function Panel({ title, note, actions, children, className }: { title?: ReactNode; note?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={className ? `panel ${className}` : 'panel'}>
      {(title || actions) && (
        <header className="panel-head">
          <div>
            {title && <h2>{title}</h2>}
            {note && <p className="panel-note">{note}</p>}
          </div>
          {actions && <div className="panel-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  )
}
