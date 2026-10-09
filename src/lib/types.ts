export type Counts = Record<string, number>

/** One player's regular-season counts, as written by scripts/build-data.mjs. */
export interface SeasonRow {
  id: number
  /** Most recent team that season. */
  t: number
  /** Every team that season, in order, when there was more than one. */
  ts?: number[]
  pos: string
  b?: Counts
  p?: Counts
  r?: Counts
  f?: Record<string, Counts>
  /** Errors charged in the box score, across all positions. */
  e?: number
  dh?: number
}
export interface SeasonFile {
  season: number
  games: Record<string, number>
  players: SeasonRow[]
}

export interface PlayerInfo {
  id: number
  /** English name, given name first. */
  n: string
  fam?: string
  jp?: string
  src: 'official' | 'kana' | 'translit' | 'manual' | 'none'
  ph?: string
  npb?: string
  b?: 'L' | 'R' | 'S'
  t?: 'L' | 'R'
  born?: string
  ht?: number
  wt?: number
  from?: string
  no?: string
  draft?: [number, string]
  /** [season, team, position, PA, outs pitched] */
  s: [number, number, string, number, number][]
}

export interface TeamInfo {
  abbr: string
  city: string
  nick: string
  league: 'CL' | 'PL'
}
export interface Meta {
  generated: string
  through: string
  seasons: number[]
  teams: Record<string, TeamInfo>
}

/** rv is from the page owner's side: positive helps the batter on bg, the pitcher on pg. */
export interface Grid { n: number[]; sw: number[]; wh: number[]; h: number[]; rv?: number[] }
export interface Line { pa: number; ab: number; h: number; d: number; t: number; hr: number; bb: number; so: number; hbp: number; sf: number }
export interface ArsenalPitch {
  id: number; n: number; vn: number; vmax: number; v?: number; sw: number; wh: number; z: number
  osw: number; on: number; ab: number; h: number; tb: number; k: number; pa: number; L: number; R: number
  /** Run value, positive is good for the pitcher. */
  rv?: number
}
export interface PitchGroupLine { n: number; sw: number; wh: number; ab: number; h: number; tb: number; k: number; rv?: number }
export interface SeasonDetail {
  /** Flat triples: x, y, code. code = kind * 2 + (1 if it was an air out). */
  spray?: number[]
  pspray?: number[]
  bg?: Grid
  pg?: Grid
  ars?: ArsenalPitch[]
  vs?: Record<'FB' | 'BR' | 'OS', PitchGroupLine>
  sb?: Record<'L' | 'R', Line>
  sp?: Record<'L' | 'R', Line>
  glb?: number[][]
  glp?: number[][]
}
export type PlayerDetail = Record<string, SeasonDetail>

export type Category = 'bat' | 'pit' | 'fld' | 'run'
export type Values = Record<string, number | null>
