// Pitch types as the Japanese scoring feed labels them, translated for an MLB reader.
export interface PitchType {
  name: string
  short: string
  group: 'FB' | 'BR' | 'OS'
  /** Categorical color (colorblind-safe ordering), used wherever pitches are told apart. */
  color: string
  note?: string
}

export const PITCH: Record<number, PitchType> = {
  31: { name: 'Four-seam fastball', short: 'FF', group: 'FB', color: '#D7332A', note: 'Scored as “straight” (sutorēto) in Japan.' },
  47: { name: 'Two-seam fastball', short: 'FT', group: 'FB', color: '#E8832A', note: 'What Savant would usually call a sinker.' },
  46: { name: 'Shuuto', short: 'SH', group: 'FB', color: '#B5651D', note: 'A Japanese staple: a hard pitch that runs in on same-handed hitters. Closest MLB match is a running two-seamer or sinker.' },
  48: { name: 'One-seam fastball', short: 'F1', group: 'FB', color: '#C9A227', note: 'A sinking fastball gripped along a single seam. Rare.' },
  51: { name: 'Hard sinker', short: 'SI', group: 'FB', color: '#A8782B', note: 'A power sinker in the MLB sense.' },
  49: { name: 'Cutter', short: 'FC', group: 'FB', color: '#8E5BC7' },
  32: { name: 'Slider', short: 'SL', group: 'BR', color: '#E3B505' },
  33: { name: 'Vertical slider', short: 'VS', group: 'BR', color: '#B8A000', note: 'A slider with drop and little sweep (tate-suraidā). Think gyro slider.' },
  52: { name: 'Hard slider', short: 'HS', group: 'BR', color: '#D4A017', note: 'A firmer slider, between a slider and a cutter.' },
  53: { name: 'Sweeper', short: 'ST', group: 'BR', color: '#C2C900' },
  34: { name: 'Slurve', short: 'SV', group: 'BR', color: '#3FA7A0' },
  35: { name: 'Curveball', short: 'CU', group: 'BR', color: '#19A0D8' },
  36: { name: 'Slow curve', short: 'CS', group: 'BR', color: '#5CC4EE', note: 'A looping curve, often under 65 mph (105 km/h).' },
  37: { name: 'Power curve', short: 'PC', group: 'BR', color: '#0F78B0' },
  38: { name: 'Knuckle curve', short: 'KC', group: 'BR', color: '#3B5BDB' },
  39: { name: 'Forkball', short: 'FO', group: 'OS', color: '#1B9E77', note: 'The signature Japanese out pitch. A deeper grip and bigger drop than a splitter, thrown a few mph slower.' },
  40: { name: 'Splitter', short: 'FS', group: 'OS', color: '#3CB8A0' },
  41: { name: 'Changeup', short: 'CH', group: 'OS', color: '#2E9E4F' },
  42: { name: 'Sinker (screwball type)', short: 'SK', group: 'OS', color: '#7FB069', note: 'Careful: in Japan a “sinker” is an off-speed pitch that fades and drops arm-side, closer to a screwball or circle change than to an MLB sinker.' },
  43: { name: 'Screwball', short: 'SC', group: 'OS', color: '#6A994E' },
  44: { name: 'Palmball', short: 'PA', group: 'OS', color: '#8AA29E' },
  45: { name: 'Knuckleball', short: 'KN', group: 'OS', color: '#7A7F8C' },
  50: { name: 'Slow ball', short: 'EP', group: 'OS', color: '#9AA0AE', note: 'An eephus.' },
}

export const PITCH_GROUP_NAME = { FB: 'Fastballs', BR: 'Breaking', OS: 'Off-speed' } as const
export const PITCH_GROUP_NOTE = {
  FB: 'Four-seamers, two-seamers, shuuto and cutters.',
  BR: 'Sliders, sweepers and curves.',
  OS: 'Forkballs, splitters, changeups and screwball-type sinkers.',
} as const

export const pitchOf = (id: number): PitchType => PITCH[id] ?? { name: `Pitch ${id}`, short: '??', group: 'OS', color: '#9AA0AE' }
