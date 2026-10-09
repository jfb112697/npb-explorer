import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useMeta, usePlayers } from '../lib/data'
import type { PlayerInfo } from '../lib/types'
import { Avatar, TeamMark } from './ui'

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Rank players for a query: surname prefix first, then any word prefix, then anywhere. */
// eslint-disable-next-line react-refresh/only-export-components
export function searchPlayers(players: PlayerInfo[], query: string, limit = 8): PlayerInfo[] {
  const q = fold(query.trim())
  if (!q) return []
  const scored: [number, PlayerInfo][] = []
  for (const p of players) {
    const name = fold(p.n)
    const words = name.split(/\s+/)
    let score = -1
    if (name.startsWith(q)) score = 3
    else if (words[words.length - 1].startsWith(q)) score = 4
    else if (words.some((w) => w.startsWith(q))) score = 2
    else if (name.includes(q)) score = 1
    else if (p.jp && p.jp.replace(/\s/g, '').includes(query.trim().replace(/\s/g, ''))) score = 1
    if (score < 0) continue
    const last = p.s[p.s.length - 1]
    scored.push([score * 1e7 + last[0] * 1e3 + Math.min(999, last[3] + last[4] / 3), p])
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, limit).map(([, p]) => p)
}

export function PlayerSearch({ onPick, placeholder = 'Search players', autoFocus, compact }: {
  onPick: (p: PlayerInfo) => void; placeholder?: string; autoFocus?: boolean; compact?: boolean
}) {
  const players = usePlayers()
  const meta = useMeta()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const listId = useId()
  const root = useRef<HTMLDivElement>(null)
  const results = useMemo(() => searchPlayers(players.data ?? [], q), [players.data, q])

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const pick = (p: PlayerInfo) => { onPick(p); setQ(''); setOpen(false) }
  return (
    <div className={compact ? 'search search-compact' : 'search'} ref={root}>
      <input
        type="search" value={q} placeholder={placeholder} autoFocus={autoFocus}
        role="combobox" aria-expanded={open && results.length > 0} aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={open && results[active] ? `${listId}-${active}` : undefined} aria-label={placeholder}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0) }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)) }
          else if (e.key === 'Enter' && results[active]) { e.preventDefault(); pick(results[active]) }
          else if (e.key === 'Escape') setOpen(false)
        }}
      />
      {open && q.trim() && (
        <ul className="search-results" id={listId} role="listbox">
          {results.length === 0 && <li className="search-empty">{players.loading ? 'Loading players…' : `No player matches “${q.trim()}”. Try a surname.`}</li>}
          {results.map((p, i) => {
            const last = p.s[p.s.length - 1]
            const first = p.s[0]
            return (
              <li key={p.id} id={`${listId}-${i}`} role="option" aria-selected={i === active}
                onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); pick(p) }}>
                <Avatar player={p} team={last[1]} size={32} />
                <span className="search-name">{p.n}</span>
                <span className="search-meta">
                  <TeamMark meta={meta.data} id={last[1]} /><span>{last[2]}</span><span>{first[0] === last[0] ? last[0] : `${first[0]}–${String(last[0]).slice(2)}`}</span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
