// Every stat the app shows: how it is computed from the season counts, how it is
// formatted, which direction is good, and the hover text that explains it to someone
// who knows MLB stats but not NPB.
import type { Category, Counts, SeasonFile, SeasonRow, Values } from './types'

export type Fmt = 'int' | 'avg' | 'pct' | 'dec1' | 'dec2' | 'ip' | 'velo' | 'plus' | 'signed'

export interface StatDef {
  key: string
  label: string
  name: string
  cat: Category
  group: string
  fmt: Fmt
  /** Which direction is better. Omitted for stats that are descriptive rather than good or bad. */
  better?: 'high' | 'low'
  /** Shown as a percentile slider on player pages. */
  rail?: boolean
  desc: string
  /** How it lines up with what a Savant or FanGraphs reader already knows. */
  mlb?: string
}

const div = (a: number, b: number): number | null => (b > 0 ? a / b : null)
const n = (c: Counts | undefined, k: string) => c?.[k] ?? 0

// ---------- league context ----------
// Run values above an out. Scaled each season so league wOBA equals league OBP.
const W = { bb: 0.55, hbp: 0.57, s: 0.7, d: 1.0, t: 1.27, hr: 1.65 }
const RUN_SB = 0.2
const RUN_CS = -0.41

interface LgBat { obp: number; slg: number; woba: number; rpa: number }
interface LgPit { era: number; fipC: number }
export interface League {
  all: LgBat
  byLeague: Record<string, LgBat>
  pit: LgPit
  pitByLeague: Record<string, LgPit>
  wobaScale: number
  /** League stolen-base runs per time on first, the baseline for wSB. */
  wsbRate: number
  /** Share of balls hit into each position's area that became outs. */
  outRate: Record<string, number>
  maxGames: number
}

function rawWoba(b: Counts) {
  const singles = n(b, 'h') - n(b, 'd') - n(b, 't') - n(b, 'hr')
  const ubb = n(b, 'bb') - n(b, 'ibb')
  const num = W.bb * ubb + W.hbp * n(b, 'hbp') + W.s * singles + W.d * n(b, 'd') + W.t * n(b, 't') + W.hr * n(b, 'hr')
  return div(num, n(b, 'ab') + ubb + n(b, 'sf') + n(b, 'hbp'))
}
const obp = (b: Counts) => div(n(b, 'h') + n(b, 'bb') + n(b, 'hbp'), n(b, 'ab') + n(b, 'bb') + n(b, 'hbp') + n(b, 'sf'))
const tb = (b: Counts) => n(b, 'h') + n(b, 'd') + 2 * n(b, 't') + 3 * n(b, 'hr')

function sum(rows: Counts[]): Counts {
  const out: Counts = {}
  for (const r of rows) for (const k in r) out[k] = (out[k] ?? 0) + r[k]
  return out
}

export function buildLeague(file: SeasonFile, leagueOf: (team: number) => string): League {
  const bats = file.players.filter((p) => p.b)
  const pits = file.players.filter((p) => p.p)
  const all = sum(bats.map((p) => p.b!))
  const scale = (obp(all) ?? 0.32) / (rawWoba(all) ?? 0.26)
  const lgBat = (rows: SeasonRow[]): LgBat => {
    const t = sum(rows.map((p) => p.b!))
    return { obp: obp(t) ?? 0.32, slg: div(tb(t), n(t, 'ab')) ?? 0.38, woba: (rawWoba(t) ?? 0.26) * scale, rpa: div(n(t, 'r'), n(t, 'pa')) ?? 0.1 }
  }
  const lgPit = (rows: SeasonRow[]): LgPit => {
    const t = sum(rows.map((p) => p.p!))
    const ip = n(t, 'outs') / 3
    const era = div(9 * n(t, 'er'), ip) ?? 3.5
    return { era, fipC: era - (div(13 * n(t, 'hr') + 3 * (n(t, 'bb') - n(t, 'ibb') + n(t, 'hbp')) - 2 * n(t, 'so'), ip) ?? 0) }
  }
  const runs = sum(file.players.filter((p) => p.r).map((p) => p.r!))
  const onFirst = n(all, 'h') - n(all, 'd') - n(all, 't') - n(all, 'hr') + n(all, 'bb') + n(all, 'hbp') - n(all, 'ibb')
  const outRate: Record<string, number> = {}
  const posTotals: Record<string, { ch: number; out: number }> = {}
  for (const p of file.players) {
    for (const [pos, f] of Object.entries(p.f ?? {})) {
      const t = (posTotals[pos] ??= { ch: 0, out: 0 })
      t.ch += n(f, 'ch'); t.out += n(f, 'out')
    }
  }
  for (const [pos, t] of Object.entries(posTotals)) outRate[pos] = t.ch ? t.out / t.ch : 0
  const byLg = (lg: string) => (rows: SeasonRow[]) => rows.filter((p) => leagueOf(p.t) === lg)
  return {
    all: lgBat(bats),
    byLeague: { CL: lgBat(byLg('CL')(bats)), PL: lgBat(byLg('PL')(bats)) },
    pit: lgPit(pits),
    pitByLeague: { CL: lgPit(byLg('CL')(pits)), PL: lgPit(byLg('PL')(pits)) },
    wobaScale: scale,
    wsbRate: div(RUN_SB * n(runs, 'sb') + RUN_CS * n(runs, 'cs'), onFirst) ?? 0,
    outRate,
    maxGames: Math.max(1, ...Object.values(file.games)),
  }
}

// ---------- per-player values ----------
function discipline(c: Counts): Values {
  const pitches = n(c, 'n')
  return {
    swingp: div(n(c, 'sw'), pitches),
    whiffp: div(n(c, 'wh'), n(c, 'sw')),
    chasep: div(n(c, 'osw'), pitches - n(c, 'z')),
    zswingp: div(n(c, 'zsw'), n(c, 'z')),
    zcontactp: div(n(c, 'zct'), n(c, 'zsw')),
    ocontactp: div(n(c, 'oct'), n(c, 'osw')),
    contactp: div(n(c, 'sw') - n(c, 'wh'), n(c, 'sw')),
    zonep: div(n(c, 'z'), pitches),
    swstrp: div(n(c, 'wh'), pitches),
    cswp: div(n(c, 'wh') + n(c, 'cs'), pitches),
    goao: div(n(c, 'go'), n(c, 'ao')),
    popupp: div(n(c, 'iffb'), n(c, 'go') + n(c, 'ao')),
  }
}

export function batValues(b: Counts, lg: League, league: string): Values {
  const ab = n(b, 'ab'), h = n(b, 'h'), pa = n(b, 'pa')
  const o = obp(b), s = div(tb(b), ab)
  const raw = rawWoba(b)
  const woba = raw == null ? null : raw * lg.wobaScale
  const own = lg.byLeague[league] ?? lg.all
  const d = discipline(b)
  const balls = n(b, 'pl') + n(b, 'ce') + n(b, 'op')
  const singles = h - n(b, 'd') - n(b, 't') - n(b, 'hr')
  const conRaw = div(W.s * singles + W.d * n(b, 'd') + W.t * n(b, 't') + W.hr * n(b, 'hr'), ab - n(b, 'so') + n(b, 'sf'))
  return {
    g: n(b, 'g'), pa, ab, r: n(b, 'r'), h, d: n(b, 'd'), t: n(b, 't'), hr: n(b, 'hr'), rbi: n(b, 'rbi'),
    bb: n(b, 'bb'), ibb: n(b, 'ibb'), so: n(b, 'so'), hbp: n(b, 'hbp'), sh: n(b, 'sh'), sf: n(b, 'sf'), sb: n(b, 'sb'),
    avg: div(h, ab), obp: o, slg: s, ops: o == null || s == null ? null : o + s,
    iso: s == null ? null : s - (div(h, ab) ?? 0),
    babip: div(h - n(b, 'hr'), ab - n(b, 'so') - n(b, 'hr') + n(b, 'sf')),
    bbp: div(n(b, 'bb'), pa), kp: div(n(b, 'so'), pa), bbk: div(n(b, 'bb'), n(b, 'so')),
    hrp: div(n(b, 'hr'), pa), xbhp: div(n(b, 'd') + n(b, 't') + n(b, 'hr'), pa),
    woba,
    wobacon: conRaw == null ? null : conRaw * lg.wobaScale,
    rv: n(b, 'n') > 0 ? n(b, 'rv') : null,
    wrcp: woba == null ? null : (((woba - lg.all.woba) / lg.wobaScale + lg.all.rpa) / own.rpa) * 100,
    opsp: o == null || s == null ? null : 100 * (o / own.obp + s / own.slg - 1),
    swingp: d.swingp, whiffp: d.whiffp, chasep: d.chasep, zswingp: d.zswingp, zcontactp: d.zcontactp,
    zoswingp: d.zswingp == null || d.chasep == null ? null : d.zswingp - d.chasep,
    ocontactp: d.ocontactp, contactp: d.contactp, zonep: d.zonep, swstrp: d.swstrp,
    fpswingp: div(n(b, 'fpsw'), n(b, 'fpn')),
    ppa: div(n(b, 'n'), n(b, 'pa') ? n(b, 'pa') : 0),
    goao: d.goao, popupp: d.popupp,
    pullp: div(n(b, 'pl'), balls), centp: div(n(b, 'ce'), balls), oppop: div(n(b, 'op'), balls),
    gidp: n(b, 'gidp'), ifh: n(b, 'ifh'),
  }
}

export function runValues(b: Counts, r: Counts | undefined, lg: League): Values {
  const sb = n(r, 'sb'), cs = n(r, 'cs')
  const singles = n(b, 'h') - n(b, 'd') - n(b, 't') - n(b, 'hr')
  const onFirst = singles + n(b, 'bb') + n(b, 'hbp') - n(b, 'ibb')
  const onBase = n(b, 'h') + n(b, 'bb') + n(b, 'hbp') - n(b, 'hr')
  return {
    pa: n(b, 'pa'), sb, cs, att: sb + cs,
    sbp: div(sb, sb + cs), attp: div(sb + cs, onFirst), sb3: n(r, 'sb3'),
    wsb: RUN_SB * sb + RUN_CS * cs - lg.wsbRate * onFirst,
    xbtp: div(n(r, 'xt'), n(r, 'xo')), xo: n(r, 'xo'),
    oob: n(r, 'oob'), pk: n(r, 'pk'),
    r: n(b, 'r'), rsp: div(n(b, 'r') - n(b, 'hr'), onBase),
    t: n(b, 't'), ifh: n(b, 'ifh'), gidp: n(b, 'gidp'), gidpp: div(n(b, 'gidp'), n(b, 'dpo')),
  }
}

export function pitValues(p: Counts, lg: League, league: string): Values {
  const outs = n(p, 'outs'), ip = outs / 3, bf = n(p, 'bf')
  const ubb = n(p, 'bb') - n(p, 'ibb')
  const era = div(9 * n(p, 'er'), ip)
  const fip = ip > 0 ? (13 * n(p, 'hr') + 3 * (ubb + n(p, 'hbp')) - 2 * n(p, 'so')) / ip + lg.pit.fipC : null
  const own = lg.pitByLeague[league] ?? lg.pit
  const d = discipline(p)
  const baserunners = n(p, 'h') + n(p, 'bb') + n(p, 'hbp')
  return {
    w: n(p, 'w'), l: n(p, 'l'), era, g: n(p, 'g'), gs: n(p, 'gs'), cg: n(p, 'cg'), sho: n(p, 'sho'), sv: n(p, 'sv'),
    ip: outs, h: n(p, 'h'), r: n(p, 'r'), er: n(p, 'er'), hr: n(p, 'hr'), bb: n(p, 'bb'), ibb: n(p, 'ibb'),
    so: n(p, 'so'), hbp: n(p, 'hbp'), wp: n(p, 'wp'), bk: n(p, 'bk'), bf, pi: n(p, 'pi'), qs: n(p, 'qs'),
    whip: div(n(p, 'h') + n(p, 'bb'), ip),
    fip, eram: era == null ? null : (100 * era) / own.era, fipm: fip == null ? null : (100 * fip) / own.era,
    kp: div(n(p, 'so'), bf), bbp: div(n(p, 'bb'), bf),
    kbbp: bf ? (n(p, 'so') - n(p, 'bb')) / bf : null,
    k9: div(9 * n(p, 'so'), ip), bb9: div(9 * n(p, 'bb'), ip), hr9: div(9 * n(p, 'hr'), ip), h9: div(9 * n(p, 'h'), ip),
    kbb: div(n(p, 'so'), n(p, 'bb')),
    babip: div(n(p, 'h') - n(p, 'hr'), bf - n(p, 'bb') - n(p, 'hbp') - n(p, 'so') - n(p, 'hr')),
    lobp: div(baserunners - n(p, 'r'), baserunners - 1.4 * n(p, 'hr')),
    rv: n(p, 'n') > 0 ? n(p, 'rv') : null,
    ppi: div(n(p, 'pi'), ip), qsp: div(n(p, 'qs'), n(p, 'gs')),
    fbv: n(p, 'fbn') >= 20 ? p.fbv ?? null : null,
    vmax: n(p, 'vn') >= 20 ? p.vmax ?? null : null,
    whiffp: d.whiffp, chasep: d.chasep, zonep: d.zonep, cswp: d.cswp, swstrp: d.swstrp,
    zswingp: d.zswingp, zoswingp: d.zswingp == null || d.chasep == null ? null : d.zswingp - d.chasep,
    fstrikep: div(n(p, 'fps'), n(p, 'fpn')), zcontactp: d.zcontactp,
    goao: d.goao, popupp: d.popupp,
    sba: n(p, 'sb'), csa: n(p, 'cs'), pk: n(p, 'pk'),
  }
}

export function fldValues(f: Counts, pos: string, lg: League): Values {
  const inn = n(f, 'o') / 3
  const ch = n(f, 'ch'), out = n(f, 'out')
  const sb = n(f, 'sb'), cs = n(f, 'cs')
  const base: Values = {
    g: n(f, 'g'), inn: n(f, 'o'), ch, out,
    outp: div(out, ch),
    paa: ch ? out - ch * (lg.outRate[pos] ?? 0) : null,
    pm: n(f, 'pm'), pm9: div(9 * n(f, 'pm'), inn), e: n(f, 'e'),
    sbc: null, csc: null, cscp: null, pb: null, wpc: null,
  }
  if (pos === 'C') Object.assign(base, { sbc: sb, csc: cs, cscp: div(cs, sb + cs), pb: n(f, 'pb'), wpc: n(f, 'wp') })
  return base
}

// ---------- definitions ----------
const S = (
  cat: Category, group: string, key: string, label: string, name: string, fmt: Fmt, desc: string,
  opt: { better?: 'high' | 'low'; rail?: boolean; mlb?: string } = {},
): StatDef => ({ cat, group, key, label, name, fmt, desc, ...opt })

const DISC_NOTE = 'The strike zone here is the rulebook box in the pitch-location feed, not a batter-specific zone.'

export const STATS: StatDef[] = [
  // ----- batting: standard -----
  S('bat', 'Standard', 'g', 'G', 'Games', 'int', 'Games played. NPB plays a 143-game season.', { mlb: '143 games, against 162 in MLB, so counting totals run about 12% lower.' }),
  S('bat', 'Standard', 'pa', 'PA', 'Plate appearances', 'int', 'Trips to the plate. A hitter qualifies for the batting title with 3.1 PA per team game (443 over a full season).', { mlb: 'Same 3.1-per-game rule as MLB, but 443 PA rather than 502.' }),
  S('bat', 'Standard', 'ab', 'AB', 'At-bats', 'int', 'Plate appearances that are not walks, hit-by-pitches, sacrifices or interference.'),
  S('bat', 'Standard', 'r', 'R', 'Runs', 'int', 'Runs scored.'),
  S('bat', 'Standard', 'h', 'H', 'Hits', 'int', 'Hits.'),
  S('bat', 'Standard', 'd', '2B', 'Doubles', 'int', 'Doubles.'),
  S('bat', 'Standard', 't', '3B', 'Triples', 'int', 'Triples.'),
  S('bat', 'Standard', 'hr', 'HR', 'Home runs', 'int', 'Home runs.', { better: 'high', mlb: 'NPB is a lower-power league. The leader usually finishes near 40, and 30 is a top-five season.' }),
  S('bat', 'Standard', 'rbi', 'RBI', 'Runs batted in', 'int', 'Runs batted in.'),
  S('bat', 'Standard', 'sb', 'SB', 'Stolen bases', 'int', 'Stolen bases, from the official box score.'),
  S('bat', 'Standard', 'bb', 'BB', 'Walks', 'int', 'Walks, including intentional ones.'),
  S('bat', 'Standard', 'ibb', 'IBB', 'Intentional walks', 'int', 'Intentional walks. NPB adopted the no-pitch intentional walk in 2018.'),
  S('bat', 'Standard', 'so', 'SO', 'Strikeouts', 'int', 'Strikeouts.'),
  S('bat', 'Standard', 'hbp', 'HBP', 'Hit by pitch', 'int', 'Times hit by a pitch.'),
  S('bat', 'Standard', 'sh', 'SH', 'Sacrifice bunts', 'int', 'Sacrifice bunts.', { mlb: 'Far more common than in MLB. An everyday No. 2 hitter can pass 30 in a season.' }),
  S('bat', 'Standard', 'sf', 'SF', 'Sacrifice flies', 'int', 'Sacrifice flies.'),
  S('bat', 'Standard', 'avg', 'AVG', 'Batting average', 'avg', 'Hits per at-bat.', { better: 'high', rail: true, mlb: 'League average sits around .245, close to MLB in recent seasons.' }),
  S('bat', 'Standard', 'obp', 'OBP', 'On-base percentage', 'avg', 'How often the hitter reaches base.', { better: 'high', rail: true }),
  S('bat', 'Standard', 'slg', 'SLG', 'Slugging percentage', 'avg', 'Total bases per at-bat.', { better: 'high', rail: true, mlb: 'Runs lower than MLB. The league has slugged between .350 and .390 since 2019; MLB is nearer .400.' }),
  S('bat', 'Standard', 'ops', 'OPS', 'On-base plus slugging', 'avg', 'OBP plus SLG.', { better: 'high', rail: true, mlb: 'Shift your scale down about 50 points: .800 in NPB is a star-level bat.' }),
  // ----- batting: advanced -----
  S('bat', 'Advanced', 'wrcp', 'wRC+', 'Weighted runs created plus', 'plus', 'Total offensive value per plate appearance, where 100 is league average and each point is one percent better or worse. Built from wOBA with linear weights rescaled to each NPB season, and compared with the player’s own league (Central or Pacific).', { better: 'high', rail: true, mlb: 'Reads like FanGraphs wRC+, with one caveat: it is not park-adjusted, so hitters in small parks (Jingu, Yokohama) look a bit better than they should.' }),
  S('bat', 'Advanced', 'opsp', 'OPS+', 'Adjusted OPS', 'plus', 'OPS relative to the player’s league, where 100 is average.', { better: 'high', mlb: 'Like Baseball-Reference OPS+, but not park-adjusted.' }),
  S('bat', 'Advanced', 'woba', 'wOBA', 'Weighted on-base average', 'avg', 'On-base percentage that credits each way of reaching base by how much it is worth in runs. Scaled so the league wOBA matches league OBP that season.', { better: 'high', rail: true, mlb: 'Same idea and scale as FanGraphs wOBA. Savant’s xwOBA is not possible here because NPB does not publish exit velocity or launch angle.' }),
  S('bat', 'Advanced', 'wobacon', 'wOBAcon', 'wOBA on contact', 'avg', 'wOBA counting only plate appearances that ended with the ball in play or over the fence: how much damage the hitter does when he connects.', { better: 'high', rail: true, mlb: 'Savant’s wOBAcon. The expected versions (xwOBA, xwOBAcon) need exit velocity and launch angle, which NPB does not publish, so only actual results are available.' }),
  S('bat', 'Advanced', 'rv', 'RV', 'Batting run value', 'signed', 'Runs added above an average hitter, summed pitch by pitch. Every pitch is credited with how much it moved the hitter’s expected production: a ball or a hit adds, a strike or an out subtracts. Covers tracked pitches only.', { better: 'high', rail: true, mlb: 'Built the way Savant builds Run Value, from the change in count and the outcome. It leaves out base-out state, so every single is worth the same whether or not anyone is on.' }),
  S('bat', 'Advanced', 'iso', 'ISO', 'Isolated power', 'avg', 'Slugging minus batting average: extra bases per at-bat.', { better: 'high', rail: true, mlb: 'League ISO has run from .105 to .140 since 2019, against roughly .160 in MLB.' }),
  S('bat', 'Advanced', 'babip', 'BABIP', 'Batting average on balls in play', 'avg', 'Average on balls put in play, leaving out homers and strikeouts. Swings a lot on luck and speed.', { mlb: 'League norm is about .290, a touch under MLB.' }),
  S('bat', 'Advanced', 'bbp', 'BB%', 'Walk rate', 'pct', 'Walks per plate appearance.', { better: 'high', rail: true }),
  S('bat', 'Advanced', 'kp', 'K%', 'Strikeout rate', 'pct', 'Strikeouts per plate appearance.', { better: 'low', rail: true, mlb: 'NPB hitters strike out a little less: the league rate runs 19 to 22%, against 22 to 23% in MLB.' }),
  S('bat', 'Advanced', 'bbk', 'BB/K', 'Walk-to-strikeout ratio', 'dec2', 'Walks divided by strikeouts.', { better: 'high' }),
  S('bat', 'Advanced', 'hrp', 'HR%', 'Home run rate', 'pct', 'Home runs per plate appearance.', { better: 'high', rail: true }),
  S('bat', 'Advanced', 'xbhp', 'XBH%', 'Extra-base hit rate', 'pct', 'Doubles, triples and homers per plate appearance.', { better: 'high' }),
  // ----- batting: plate discipline -----
  S('bat', 'Plate discipline', 'whiffp', 'Whiff%', 'Whiff rate', 'pct', 'Swings that miss, out of all swings.', { better: 'low', rail: true, mlb: 'Same definition as Savant’s Whiff%.' }),
  S('bat', 'Plate discipline', 'chasep', 'O-Swing%', 'Chase rate (O-Swing%)', 'pct', `Swings at pitches outside the strike zone, out of all pitches outside it. ${DISC_NOTE}`, { better: 'low', rail: true, mlb: 'FanGraphs’ O-Swing%, which Savant calls Chase%.' }),
  S('bat', 'Plate discipline', 'zswingp', 'Z-Swing%', 'Zone swing rate', 'pct', `Swings at pitches in the strike zone, out of all pitches in it. ${DISC_NOTE}`, { rail: true, mlb: 'FanGraphs’ Z-Swing%. Neither high nor low is better on its own, so the slider is not colored.' }),
  S('bat', 'Plate discipline', 'zoswingp', 'Z-O Swing%', 'Zone minus chase swing rate', 'pct', 'Z-Swing% minus O-Swing%: how much more often the hitter swings at strikes than at balls. The cleanest single read on swing decisions.', { better: 'high', rail: true, mlb: 'The same Z-Swing% minus O-Swing% gap analysts compute from FanGraphs. MLB average is about 38 points.' }),
  S('bat', 'Plate discipline', 'zcontactp', 'Z-Contact%', 'Zone contact rate', 'pct', 'Contact made on swings at pitches in the zone.', { better: 'high', rail: true, mlb: 'FanGraphs’ Z-Contact%.' }),
  S('bat', 'Plate discipline', 'ocontactp', 'O-Contact%', 'Chase contact rate', 'pct', 'Contact made on swings at pitches outside the zone.', { mlb: 'FanGraphs’ O-Contact%.' }),
  S('bat', 'Plate discipline', 'contactp', 'Contact%', 'Contact rate', 'pct', 'Swings that make contact (fair or foul), out of all swings. The mirror of Whiff%.', { better: 'high' }),
  S('bat', 'Plate discipline', 'swingp', 'Swing%', 'Swing rate', 'pct', 'Share of all pitches the hitter swings at.'),
  S('bat', 'Plate discipline', 'fpswingp', '1stP Sw%', 'First-pitch swing rate', 'pct', 'How often the hitter swings at the first pitch of a plate appearance.'),
  S('bat', 'Plate discipline', 'zonep', 'Zone%', 'Zone rate seen', 'pct', `Share of pitches seen that were in the strike zone. Low numbers mean pitchers are working around the hitter. ${DISC_NOTE}`),
  S('bat', 'Plate discipline', 'swstrp', 'SwStr%', 'Swinging-strike rate', 'pct', 'Swings and misses out of all pitches seen.', { better: 'low' }),
  S('bat', 'Plate discipline', 'ppa', 'P/PA', 'Pitches per plate appearance', 'dec2', 'Average pitches seen per trip to the plate.'),
  // ----- batting: batted ball -----
  S('bat', 'Batted ball', 'pullp', 'Pull%', 'Pull rate', 'pct', 'Share of fair balls hit to the hitter’s pull side. Measured from where the ball was fielded.', { mlb: 'Comparable to FanGraphs Pull%. The bands are calibrated so the league splits roughly 37 / 40 / 23 pull, center, opposite.' }),
  S('bat', 'Batted ball', 'centp', 'Cent%', 'Center rate', 'pct', 'Share of fair balls hit to the middle of the field.'),
  S('bat', 'Batted ball', 'oppop', 'Oppo%', 'Opposite-field rate', 'pct', 'Share of fair balls hit the other way.'),
  S('bat', 'Batted ball', 'goao', 'GO/AO', 'Ground outs per air out', 'dec2', 'Ground-ball outs divided by outs in the air (flies, liners, pop-ups). Above 1.0 is a ground-ball hitter.', { mlb: 'The MLB.com GO/AO stat. NPB does not publish launch angle, so there is no true GB% or FB%: the type of contact is only recorded on outs.' }),
  S('bat', 'Batted ball', 'popupp', 'Pop%', 'Infield pop-up rate', 'pct', 'Infield pop-ups as a share of batted-ball outs.', { better: 'low' }),
  S('bat', 'Batted ball', 'gidp', 'GIDP', 'Grounded into double plays', 'int', 'Ground-ball double plays hit into.'),
  S('bat', 'Batted ball', 'ifh', 'IFH', 'Infield hits', 'int', 'Hits fielded by an infielder, pitcher or catcher.'),

  // ----- running -----
  S('run', 'Stolen bases', 'sb', 'SB', 'Stolen bases', 'int', 'Stolen bases, counted from play-by-play.', { better: 'high' }),
  S('run', 'Stolen bases', 'cs', 'CS', 'Caught stealing', 'int', 'Times thrown out stealing.'),
  S('run', 'Stolen bases', 'sbp', 'SB%', 'Stolen-base success rate', 'pct', 'Steals divided by attempts.', { better: 'high', rail: true, mlb: 'Break-even is about 70%. NPB has no pitch clock, pickoff limit or bigger bases, so league success (about 71%) trails MLB’s post-2023 80%.' }),
  S('run', 'Stolen bases', 'att', 'Att', 'Steal attempts', 'int', 'Steals plus caught stealing.'),
  S('run', 'Stolen bases', 'attp', 'Att%', 'Steal attempt rate', 'pct', 'Steal attempts per time reaching first (singles, walks and hit-by-pitches).', { rail: true }),
  S('run', 'Stolen bases', 'sb3', 'SB 3rd', 'Steals of third or home', 'int', 'Steals of third base or home.'),
  S('run', 'Stolen bases', 'wsb', 'wSB', 'Weighted stolen-base runs', 'signed', 'Runs added by stealing compared with an average runner given the same chances: +0.2 per steal, -0.41 per caught stealing, less the league rate.', { better: 'high', rail: true, mlb: 'The FanGraphs wSB formula.' }),
  S('run', 'On the bases', 'xbtp', 'XBT%', 'Extra bases taken', 'pct', 'How often the runner takes more than the minimum: first to third or home on a single, second to home on a single, first to home on a double.', { better: 'high', rail: true, mlb: 'Baseball-Reference’s XBT%. MLB average is about 42%; the league figure here has run between 33 and 43%.' }),
  S('run', 'On the bases', 'xo', 'XBT opp', 'Extra-base chances', 'int', 'Times on base for a single or double with a chance to take the extra base.'),
  S('run', 'On the bases', 'oob', 'OOB', 'Outs on the bases', 'int', 'Times thrown out advancing or running into an out, not counting caught stealing or pickoffs.', { better: 'low' }),
  S('run', 'On the bases', 'pk', 'PO', 'Picked off', 'int', 'Times picked off.', { better: 'low' }),
  S('run', 'On the bases', 'rsp', 'RS%', 'Run-scoring rate', 'pct', 'How often the player scores after reaching base, leaving out his own home runs. Depends on speed and on the hitters behind him.', { better: 'high', mlb: 'Baseball-Reference’s RS%.' }),
  S('run', 'Speed signals', 'r', 'R', 'Runs', 'int', 'Runs scored.'),
  S('run', 'Speed signals', 't', '3B', 'Triples', 'int', 'Triples.'),
  S('run', 'Speed signals', 'ifh', 'IFH', 'Infield hits', 'int', 'Hits beaten out on the infield.', { better: 'high' }),
  S('run', 'Speed signals', 'gidpp', 'GIDP%', 'Double-play rate', 'pct', 'Ground-ball double plays per chance (runner on first, fewer than two outs).', { better: 'low', rail: true, mlb: 'A stand-in for sprint speed, which NPB does not publish.' }),
  S('run', 'Speed signals', 'gidp', 'GIDP', 'Grounded into double plays', 'int', 'Ground-ball double plays hit into.'),

  // ----- pitching: standard -----
  S('pit', 'Standard', 'w', 'W', 'Wins', 'int', 'Pitcher wins.'),
  S('pit', 'Standard', 'l', 'L', 'Losses', 'int', 'Pitcher losses.'),
  S('pit', 'Standard', 'era', 'ERA', 'Earned run average', 'dec2', 'Earned runs allowed per nine innings.', { better: 'low', rail: true, mlb: 'NPB has been a pitcher’s league since 2022: league ERA runs near 3.00 to 3.30, about a run below MLB. A 3.50 ERA is below average.' }),
  S('pit', 'Standard', 'g', 'G', 'Games', 'int', 'Appearances.'),
  S('pit', 'Standard', 'gs', 'GS', 'Starts', 'int', 'Games started.', { mlb: 'NPB rotations run six deep on a weekly schedule, so a full season is about 24 to 26 starts rather than 32.' }),
  S('pit', 'Standard', 'cg', 'CG', 'Complete games', 'int', 'Starts where no reliever followed. Counted from the box scores.', { mlb: 'Still a real part of the game in Japan: the leaders finish five or six a year.' }),
  S('pit', 'Standard', 'sho', 'SHO', 'Shutouts', 'int', 'Complete games with no runs allowed.'),
  S('pit', 'Standard', 'sv', 'SV', 'Saves', 'int', 'Saves.', { mlb: 'Holds, which NPB also tracks and awards a title for, are not in this data feed.' }),
  S('pit', 'Standard', 'ip', 'IP', 'Innings pitched', 'ip', 'Innings pitched. A pitcher qualifies for the ERA title with one inning per team game (143).', { mlb: 'Same one-per-game rule as MLB, but 143 innings rather than 162.' }),
  S('pit', 'Standard', 'h', 'H', 'Hits allowed', 'int', 'Hits allowed.'),
  S('pit', 'Standard', 'r', 'R', 'Runs allowed', 'int', 'Runs allowed.'),
  S('pit', 'Standard', 'er', 'ER', 'Earned runs', 'int', 'Earned runs allowed.'),
  S('pit', 'Standard', 'hr', 'HR', 'Home runs allowed', 'int', 'Home runs allowed.'),
  S('pit', 'Standard', 'bb', 'BB', 'Walks', 'int', 'Walks allowed, including intentional ones.'),
  S('pit', 'Standard', 'so', 'SO', 'Strikeouts', 'int', 'Strikeouts.', { better: 'high' }),
  S('pit', 'Standard', 'hbp', 'HBP', 'Hit batters', 'int', 'Batters hit.'),
  S('pit', 'Standard', 'wp', 'WP', 'Wild pitches', 'int', 'Wild pitches, counted from play-by-play.'),
  S('pit', 'Standard', 'bk', 'BK', 'Balks', 'int', 'Balks, counted from play-by-play.'),
  S('pit', 'Standard', 'bf', 'BF', 'Batters faced', 'int', 'Batters faced.'),
  S('pit', 'Standard', 'whip', 'WHIP', 'Walks and hits per inning', 'dec2', 'Walks plus hits per inning.', { better: 'low', rail: true, mlb: 'League WHIP has been about 1.22 since 2023; MLB is closer to 1.28.' }),
  S('pit', 'Standard', 'qs', 'QS', 'Quality starts', 'int', 'Starts of six or more innings with three or fewer earned runs.'),
  // ----- pitching: advanced -----
  S('pit', 'Advanced', 'fip', 'FIP', 'Fielding independent pitching', 'dec2', 'What ERA should look like from strikeouts, walks, hit batters and homers alone. The constant is set each season so league FIP equals league ERA.', { better: 'low', rail: true, mlb: 'The FanGraphs formula, recalibrated to NPB.' }),
  S('pit', 'Advanced', 'eram', 'ERA-', 'ERA minus', 'plus', 'ERA relative to the pitcher’s league, where 100 is average and lower is better.', { better: 'low', mlb: 'FanGraphs ERA-, without the park adjustment.' }),
  S('pit', 'Advanced', 'fipm', 'FIP-', 'FIP minus', 'plus', 'FIP relative to the league’s ERA, where 100 is average and lower is better.', { better: 'low', mlb: 'FanGraphs FIP-, without the park adjustment.' }),
  S('pit', 'Advanced', 'rv', 'RV', 'Pitching run value', 'signed', 'Runs saved against an average pitcher, summed pitch by pitch from the change in count and the outcome. Positive is good for the pitcher. Covers tracked pitches only.', { better: 'high', rail: true, mlb: 'Built the way Savant builds pitcher Run Value, without the base-out state.' }),
  S('pit', 'Advanced', 'kp', 'K%', 'Strikeout rate', 'pct', 'Strikeouts per batter faced.', { better: 'high', rail: true, mlb: 'League average runs 19 to 22%, against 22 to 23% in MLB. 25% is elite for an NPB starter.' }),
  S('pit', 'Advanced', 'bbp', 'BB%', 'Walk rate', 'pct', 'Walks per batter faced.', { better: 'low', rail: true, mlb: 'NPB pitchers walk fewer: 7 to 8% league-wide in recent seasons, against 8.5% in MLB.' }),
  S('pit', 'Advanced', 'kbbp', 'K-BB%', 'Strikeout minus walk rate', 'pct', 'Strikeout rate minus walk rate. The quickest single read on a pitcher’s skill.', { better: 'high', rail: true }),
  S('pit', 'Advanced', 'k9', 'K/9', 'Strikeouts per nine', 'dec2', 'Strikeouts per nine innings.', { better: 'high' }),
  S('pit', 'Advanced', 'bb9', 'BB/9', 'Walks per nine', 'dec2', 'Walks per nine innings.', { better: 'low' }),
  S('pit', 'Advanced', 'hr9', 'HR/9', 'Home runs per nine', 'dec2', 'Home runs allowed per nine innings.', { better: 'low', rail: true, mlb: 'Between 0.65 and 1.0 league-wide since 2019, under MLB’s 1.1 to 1.2.' }),
  S('pit', 'Advanced', 'h9', 'H/9', 'Hits per nine', 'dec2', 'Hits allowed per nine innings.', { better: 'low' }),
  S('pit', 'Advanced', 'kbb', 'K/BB', 'Strikeout-to-walk ratio', 'dec2', 'Strikeouts divided by walks.', { better: 'high' }),
  S('pit', 'Advanced', 'babip', 'BABIP', 'Batting average on balls in play', 'avg', 'Opponents’ average on balls in play. Sacrifices are not separated out in the pitching feed, so this runs a few points low.', { mlb: 'League norm by this measure is about .285.' }),
  S('pit', 'Advanced', 'lobp', 'LOB%', 'Left on base rate', 'pct', 'Share of baserunners who did not score.', { better: 'high', mlb: 'The FanGraphs formula. About 75% is normal.' }),
  S('pit', 'Advanced', 'ppi', 'P/IP', 'Pitches per inning', 'dec1', 'Pitches thrown per inning.', { better: 'low' }),
  S('pit', 'Advanced', 'qsp', 'QS%', 'Quality start rate', 'pct', 'Share of starts that were quality starts.', { better: 'high' }),
  // ----- pitching: stuff -----
  S('pit', 'Stuff and command', 'fbv', 'FB velo', 'Four-seam fastball velocity', 'velo', 'Average velocity of the four-seam fastball (“straight” in Japanese scoring).', { better: 'high', rail: true, mlb: 'NPB four-seamers average about 91.5 mph (147 km/h), around 2.5 mph under MLB, and have gained 2 mph since 2019. Broadcasts and scoreboards show km/h: 150 km/h is 93.2 mph, 160 is 99.4.' }),
  S('pit', 'Stuff and command', 'vmax', 'Max velo', 'Maximum velocity', 'velo', 'Fastest tracked pitch of the season. The feed records whole km/h.', { better: 'high' }),
  S('pit', 'Stuff and command', 'whiffp', 'Whiff%', 'Whiff rate', 'pct', 'Swings that miss, out of all swings against.', { better: 'high', rail: true, mlb: 'Same definition as Savant’s Whiff%.' }),
  S('pit', 'Stuff and command', 'chasep', 'O-Swing%', 'Chase rate (O-Swing%)', 'pct', `Swings drawn on pitches outside the strike zone. ${DISC_NOTE}`, { better: 'high', rail: true, mlb: 'FanGraphs’ O-Swing%, which Savant calls Chase%.' }),
  S('pit', 'Stuff and command', 'zswingp', 'Z-Swing%', 'Zone swing rate against', 'pct', `Swings drawn on pitches in the strike zone. ${DISC_NOTE}`, { mlb: 'FanGraphs’ Z-Swing%.' }),
  S('pit', 'Stuff and command', 'zoswingp', 'Z-O Swing%', 'Zone minus chase swing rate against', 'pct', 'Z-Swing% minus O-Swing% against. A small gap means hitters cannot tell this pitcher’s strikes from his balls.', { better: 'low' }),
  S('pit', 'Stuff and command', 'cswp', 'CSW%', 'Called strikes plus whiffs', 'pct', 'Called strikes and swinging strikes as a share of all pitches.', { better: 'high', rail: true, mlb: 'Same as the CSW% used across MLB analysis. About 28% is average.' }),
  S('pit', 'Stuff and command', 'swstrp', 'SwStr%', 'Swinging-strike rate', 'pct', 'Swings and misses out of all pitches.', { better: 'high' }),
  S('pit', 'Stuff and command', 'zonep', 'Zone%', 'Zone rate', 'pct', `Share of pitches thrown in the strike zone. ${DISC_NOTE}`, { rail: true }),
  S('pit', 'Stuff and command', 'fstrikep', 'F-Strike%', 'First-pitch strike rate', 'pct', 'How often the first pitch of a plate appearance is a strike or put in play.', { better: 'high', rail: true, mlb: 'FanGraphs’ F-Strike%.' }),
  S('pit', 'Stuff and command', 'zcontactp', 'Z-Contact%', 'Zone contact rate allowed', 'pct', 'Contact allowed on swings at pitches in the zone. Lower means the stuff plays in the strike zone.', { better: 'low' }),
  S('pit', 'Stuff and command', 'goao', 'GO/AO', 'Ground outs per air out', 'dec2', 'Ground-ball outs divided by air outs. Above 1.0 is a ground-ball pitcher.', { rail: true, mlb: 'The MLB.com GO/AO stat; there is no true GB% without launch angle.' }),
  S('pit', 'Stuff and command', 'popupp', 'Pop%', 'Infield pop-up rate', 'pct', 'Infield pop-ups as a share of batted-ball outs.', { better: 'high' }),
  S('pit', 'Running game', 'sba', 'SB', 'Stolen bases allowed', 'int', 'Steals allowed while on the mound.', { better: 'low' }),
  S('pit', 'Running game', 'csa', 'CS', 'Runners caught stealing', 'int', 'Runners caught stealing while on the mound.'),
  S('pit', 'Running game', 'pk', 'PK', 'Pickoffs', 'int', 'Runners picked off.', { better: 'high' }),

  // ----- fielding -----
  S('fld', 'Fielding', 'g', 'G', 'Games at position', 'int', 'Games in which the player appeared at this position, from the box score.'),
  S('fld', 'Fielding', 'inn', 'Inn', 'Innings', 'ip', 'Innings in the field at this position, estimated from the outs recorded while the play-by-play lists the player there. Lineups are missing for some innings before 2023, so older seasons run short.'),
  S('fld', 'Fielding', 'paa', 'PAA', 'Plays above average', 'signed', 'Outs made on balls hit into this position’s area, compared with what an average NPB fielder at the same position would have made on the same number of chances.', { better: 'high', rail: true, mlb: 'A rough cousin of Savant’s Outs Above Average. It knows where the ball went but not how hard it was hit or how far the fielder had to go, so read it as a zone rating, not a tracking metric.' }),
  S('fld', 'Fielding', 'outp', 'Out%', 'Out rate in zone', 'pct', 'Share of balls hit into this position’s area that became outs. Hits through the infield count against the outfielder who picked them up, so compare within a position.', { better: 'high', rail: true, mlb: 'Closest MLB reference is Revised Zone Rating.' }),
  S('fld', 'Fielding', 'ch', 'Ch', 'Chances in zone', 'int', 'Balls in play hit into this position’s area while the player was there.'),
  S('fld', 'Fielding', 'out', 'Outs', 'Outs in zone', 'int', 'Balls hit into this position’s area that became outs.'),
  S('fld', 'Fielding', 'pm', 'PM', 'Plays made', 'int', 'Batted-ball outs where the feed credits this player with fielding the ball, foul outs included.'),
  S('fld', 'Fielding', 'pm9', 'PM/9', 'Plays made per nine', 'dec2', 'Plays made per nine innings at the position.', { better: 'high', rail: true, mlb: 'Works like Range Factor per nine, but counts only the fielder who handled the ball, not every putout and assist.' }),
  S('fld', 'Fielding', 'e', 'E', 'Errors', 'int', 'Errors at this position that put the batter on base, from play-by-play. Throwing errors on other plays are only in the season total.', { better: 'low' }),
  S('fld', 'Catching', 'cscp', 'CS%', 'Caught-stealing rate', 'pct', 'Runners thrown out as a share of steal attempts with this catcher behind the plate.', { better: 'high', rail: true, mlb: 'Same as MLB CS%. NPB league average is around 30%, well above MLB’s post-2023 20%.' }),
  S('fld', 'Catching', 'sbc', 'SB', 'Steals allowed', 'int', 'Stolen bases allowed while catching.'),
  S('fld', 'Catching', 'csc', 'CS', 'Caught stealing', 'int', 'Runners thrown out while catching.'),
  S('fld', 'Catching', 'pb', 'PB', 'Passed balls', 'int', 'Passed balls.', { better: 'low' }),
  S('fld', 'Catching', 'wpc', 'WP', 'Wild pitches behind the plate', 'int', 'Wild pitches thrown while this catcher was behind the plate.'),
]

export const STAT: Record<string, StatDef> = Object.fromEntries(STATS.map((s) => [`${s.cat}.${s.key}`, s]))
export const statsFor = (cat: Category) => STATS.filter((s) => s.cat === cat)
export const groupsFor = (cat: Category) => [...new Set(statsFor(cat).map((s) => s.group))]

export const CATEGORY_LABEL: Record<Category, string> = { bat: 'Batting', pit: 'Pitching', fld: 'Fielding', run: 'Baserunning' }

// ---------- formatting ----------
export type VeloUnit = 'mph' | 'kmh'
const KMH_TO_MPH = 0.621371

export function fmt(v: number | null | undefined, f: Fmt, unit: VeloUnit = 'mph'): string {
  if (v == null || !Number.isFinite(v)) return '–'
  switch (f) {
    case 'int': return String(Math.round(v))
    case 'avg': {
      const s = v.toFixed(3)
      return s.startsWith('0.') ? s.slice(1) : s.startsWith('-0.') ? '-' + s.slice(2) : s
    }
    case 'pct': return (v * 100).toFixed(1) + '%'
    case 'dec1': return v.toFixed(1)
    case 'dec2': return v.toFixed(2)
    case 'ip': return `${Math.floor(v / 3)}.${Math.round(v) % 3}`
    case 'velo': return unit === 'mph' ? (v * KMH_TO_MPH).toFixed(1) : v.toFixed(1)
    case 'plus': return String(Math.round(v))
    case 'signed': return (v > 0 ? '+' : '') + v.toFixed(1)
  }
}
export const veloLabel = (unit: VeloUnit) => (unit === 'mph' ? 'mph' : 'km/h')
