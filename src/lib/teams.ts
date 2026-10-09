import type { Meta } from './types'

/** Club colors, used for the small team marks and the player header. */
export const TEAM_COLOR: Record<number, { bg: string; fg: string }> = {
  1: { bg: '#F26A0F', fg: '#16110C' },
  2: { bg: '#12224F', fg: '#D7F26B' },
  3: { bg: '#0B4FA3', fg: '#FFFFFF' },
  4: { bg: '#0A2E7A', fg: '#FFFFFF' },
  5: { bg: '#F5D90A', fg: '#15130A' },
  6: { bg: '#D6001C', fg: '#FFFFFF' },
  7: { bg: '#102E63', fg: '#9CC8FF' },
  8: { bg: '#016299', fg: '#F2D48A' },
  9: { bg: '#1D1D1F', fg: '#FFFFFF' },
  11: { bg: '#0B1A3B', fg: '#C9A54C' },
  12: { bg: '#F2C400', fg: '#15130A' },
  376: { bg: '#85010F', fg: '#F5E6C8' },
}

export const LEAGUE_NAME = { CL: 'Central League', PL: 'Pacific League' } as const

export function teamName(meta: Meta | undefined, id: number, short = false): string {
  const t = meta?.teams[id]
  if (!t) return '—'
  return short ? t.nick : `${t.city} ${t.nick}`
}

export const POSITIONS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'] as const
export const POSITION_NAME: Record<string, string> = {
  P: 'Pitcher', C: 'Catcher', '1B': 'First base', '2B': 'Second base', '3B': 'Third base', SS: 'Shortstop',
  LF: 'Left field', CF: 'Center field', RF: 'Right field', DH: 'Designated hitter', PH: 'Pinch hitter', PR: 'Pinch runner',
}
