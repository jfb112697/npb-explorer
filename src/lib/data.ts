// Loads the static JSON under /data and derives everything else in the browser.
import { useEffect, useMemo, useState } from 'react'
import { batValues, buildLeague, fldValues, pitValues, runValues, STAT, type League } from './stats'
import type { Category, Meta, PlayerDetail, PlayerInfo, SeasonFile, SeasonRow, Values } from './types'

const cache = new Map<string, Promise<unknown>>()
function load<T>(path: string): Promise<T> {
  let p = cache.get(path)
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}data/${path}`).then((r) => {
      if (!r.ok) throw new Error(`Could not load ${path} (${r.status})`)
      return r.json()
    })
    p.catch(() => cache.delete(path))
    cache.set(path, p)
  }
  return p as Promise<T>
}

export interface Loaded<T> { data?: T; error?: string; loading: boolean }
function useLoad<T>(path: string | null): Loaded<T> {
  const [state, setState] = useState<{ path: string | null; data?: T; error?: string }>({ path: null })
  useEffect(() => {
    if (!path) return
    let live = true
    load<T>(path).then(
      (data) => live && setState({ path, data }),
      (e: Error) => live && setState({ path, error: e.message }),
    )
    return () => { live = false }
  }, [path])
  if (!path) return { loading: false }
  if (state.path !== path) return { loading: true }
  return { data: state.data, error: state.error, loading: false }
}

export const useMeta = () => useLoad<Meta>('meta.json')
export const usePlayers = () => useLoad<PlayerInfo[]>('players.json')
export const usePlayerDetail = (id: number | null) => useLoad<PlayerDetail>(id ? `p/${id}.json` : null)

// ---------- derived season ----------
export interface Derived {
  row: SeasonRow
  league: string
  bat?: Values
  pit?: Values
  run?: Values
  /** Fielding values by position. */
  fld?: Record<string, Values>
  /** Position with the most innings in the field. */
  mainPos?: string
}
export interface Season {
  season: number
  file: SeasonFile
  league: League
  players: Derived[]
  byId: Map<number, Derived>
  /** Sample needed to count toward percentile pools, scaled to how far the season has run. */
  min: { pa: number; bf: number; inn: number; qualPa: number; qualOuts: number }
}

function derive(file: SeasonFile, meta: Meta): Season {
  const leagueOf = (t: number) => meta.teams[t]?.league ?? 'CL'
  const lg = buildLeague(file, leagueOf)
  const players = file.players.map((row): Derived => {
    const league = leagueOf(row.t)
    const d: Derived = { row, league }
    if (row.b) {
      d.bat = batValues(row.b, lg, league)
      d.run = runValues(row.b, row.r, lg)
    }
    if (row.p) d.pit = pitValues(row.p, lg, league)
    if (row.f) {
      d.fld = {}
      let best = -1
      for (const [pos, f] of Object.entries(row.f)) {
        d.fld[pos] = fldValues(f, pos, lg)
        const weight = (f.o ?? 0) + (f.g ?? 0)
        if (weight > best) { best = weight; d.mainPos = pos }
      }
    }
    return d
  })
  const g = lg.maxGames
  // Qualifying marks follow the shortest schedule, so a rained-out makeup does not move the bar.
  const sched = Math.min(...Object.values(file.games).filter((n) => n > 0), g)
  return {
    season: file.season, file, league: lg, players,
    byId: new Map(players.map((p) => [p.row.id, p])),
    min: {
      pa: Math.max(20, Math.round(g * 1.0)),
      bf: Math.max(20, Math.round(g * 0.75)),
      inn: Math.max(30, Math.round(g * 1.5)) * 3,
      qualPa: Math.floor(sched * 3.1),
      qualOuts: sched * 3,
    },
  }
}

const seasonCache = new Map<number, Season>()
export function useSeason(season: number | null): Loaded<Season> {
  const meta = useMeta()
  const file = useLoad<SeasonFile>(season ? `s/${season}.json` : null)
  const data = useMemo(() => {
    if (!file.data || !meta.data) return undefined
    let s = seasonCache.get(file.data.season)
    if (!s || s.file !== file.data) { s = derive(file.data, meta.data); seasonCache.set(file.data.season, s) }
    return s
  }, [file.data, meta.data])
  return { data, error: file.error ?? meta.error, loading: file.loading || meta.loading }
}
/** Several seasons at once, for career tables and comparisons. */
export function useSeasons(seasons: number[]): Loaded<Map<number, Season>> {
  const meta = useMeta()
  const key = seasons.join(',')
  const [state, setState] = useState<{ key: string; data?: Map<number, Season>; error?: string }>({ key: '' })
  useEffect(() => {
    if (!meta.data || !seasons.length) return
    let live = true
    Promise.all(seasons.map((s) => load<SeasonFile>(`s/${s}.json`))).then(
      (files) => {
        if (!live) return
        const out = new Map<number, Season>()
        for (const f of files) {
          let s = seasonCache.get(f.season)
          if (!s || s.file !== f) { s = derive(f, meta.data!); seasonCache.set(f.season, s) }
          out.set(f.season, s)
        }
        setState({ key, data: out })
      },
      (e: Error) => live && setState({ key, error: e.message }),
    )
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, meta.data])
  if (!seasons.length) return { loading: false, data: new Map() }
  if (state.key !== key) return { loading: true }
  return { data: state.data, error: state.error, loading: false }
}

// ---------- percentiles ----------
export type PoolScope = 'all' | 'CL' | 'PL'

/** Values for one category. Fielding is per position, so it needs one. */
export function valuesOf(d: Derived, cat: Category, pos?: string): Values | undefined {
  if (cat === 'fld') return d.fld?.[pos ?? d.mainPos ?? '']
  return d[cat]
}
/** Does this player have enough playing time to count toward the percentile pool? */
export function inPool(s: Season, d: Derived, cat: Category, pos?: string): boolean {
  if (cat === 'bat' || cat === 'run') return (d.row.b?.pa ?? 0) >= s.min.pa
  if (cat === 'pit') return (d.row.p?.bf ?? 0) >= s.min.bf
  const f = d.row.f?.[pos ?? d.mainPos ?? '']
  return (f?.o ?? 0) >= s.min.inn
}

const poolCache = new WeakMap<Season, Map<string, number[]>>()
function pool(s: Season, cat: Category, key: string, scope: PoolScope, pos?: string): number[] {
  let m = poolCache.get(s)
  if (!m) poolCache.set(s, (m = new Map()))
  const ck = `${cat}.${key}.${scope}.${pos ?? ''}`
  let arr = m.get(ck)
  if (!arr) {
    arr = []
    for (const d of s.players) {
      if (scope !== 'all' && d.league !== scope) continue
      if (cat === 'fld' && !d.fld?.[pos ?? '']) continue
      if (!inPool(s, d, cat, pos)) continue
      const v = valuesOf(d, cat, pos)?.[key]
      if (v != null && Number.isFinite(v)) arr.push(v)
    }
    arr.sort((a, b) => a - b)
    m.set(ck, arr)
  }
  return arr
}

/**
 * Percentile rank from 1 to 100 against players with enough playing time.
 * 100 is always the best, so stats where lower is better are flipped.
 */
export function percentile(s: Season, cat: Category, key: string, value: number | null | undefined, scope: PoolScope = 'all', pos?: string): number | null {
  if (value == null || !Number.isFinite(value)) return null
  const arr = pool(s, cat, key, scope, pos)
  if (arr.length < 8) return null
  let lo = 0, hi = arr.length
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < value) lo = mid + 1; else hi = mid }
  let eq = lo
  while (eq < arr.length && arr[eq] === value) eq++
  let pct = ((lo + (eq - lo) / 2) / arr.length) * 100
  if (STAT[`${cat}.${key}`]?.better === 'low') pct = 100 - pct
  return Math.min(100, Math.max(1, Math.round(pct)))
}
export const poolSize = (s: Season, cat: Category, key: string, scope: PoolScope = 'all', pos?: string) => pool(s, cat, key, scope, pos).length

/** Pitch-level detail for several players at once (the compare page). */
export function usePlayerDetails(ids: number[]): Loaded<Map<number, PlayerDetail>> {
  const key = ids.join(',')
  const [state, setState] = useState<{ key: string; data?: Map<number, PlayerDetail>; error?: string }>({ key: '' })
  useEffect(() => {
    if (!ids.length) return
    let live = true
    Promise.all(ids.map((id) => load<PlayerDetail>(`p/${id}.json`))).then(
      (files) => live && setState({ key, data: new Map(files.map((f, i) => [ids[i], f])) }),
      (e: Error) => live && setState({ key, error: e.message }),
    )
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  if (!ids.length) return { loading: false, data: new Map() }
  if (state.key !== key) return { loading: true }
  return { data: state.data, error: state.error, loading: false }
}
