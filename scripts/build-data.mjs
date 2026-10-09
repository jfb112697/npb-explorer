// Turns the raw CSVs in .cache/raw into the static JSON the app reads from public/data.
//
//   box scores (game_stats)  -> official counting stats, game logs, games by position
//   play-by-play (pbp)       -> everything pitch-level: velocity, plate discipline, pitch mix,
//                               spray, fielding chances, steals and baserunning
//
// Only regular-season games count (Central, Pacific and interleague). The browser derives
// every rate stat and percentile from these counts, so there is no server.
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { REGULAR, ROOT, TEAMS, id, listCsv, normName, num, readCsv, writeJson } from './lib.mjs'

const OUT = join(ROOT, 'public', 'data')
const names = existsSync(join(ROOT, 'data', 'names.json'))
  ? JSON.parse(readFileSync(join(ROOT, 'data', 'names.json'), 'utf8'))
  : {}

// ---------- code tables (decoded from the feed's Japanese descriptions) ----------
const SWING = new Set(['101', '116', '130', '102', '104', '105', '106', '107', '108', '109', '110', '111', '112', '113', '115', '125', '126', '127', '132', '133'])
const WHIFF = new Set(['116', '130'])
const CALLED = new Set(['117', '131'])
const BALL = new Set(['118', '119'])
const HIT_BASES = { 102: 1, 104: 2, 132: 2, 105: 3, 106: 4, 133: 4 }
const K = new Set(['130', '131', '129', '123'])
const GROUND_OUT = new Set(['108'])
const AIR_OUT = new Set(['109', '110', '112', '113', '115'])
const OUT_IN_PLAY = new Set(['108', '109', '110', '111', '112', '113', '114', '115'])
const ERROR = new Set(['107', '124', '125', '127'])
const BUNT = new Set(['114', '124', '128', '129'])
const NO_AB = new Set(['119', '103', '114', '115', '124', '121', '139'])
const POS = ['', 'P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF']
const BOX_POS = { 投: 'P', 捕: 'C', 一: '1B', 二: '2B', 三: '3B', 遊: 'SS', 左: 'LF', 中: 'CF', 右: 'RF', 指: 'DH', 打: 'PH', 走: 'PR' }
const BASE_IDX = { 一: 0, 二: 1, 三: 2, 1: 0, 2: 1, 3: 2, '１': 0, '２': 1, '３': 2 }
// Hit coordinates: home plate sits bottom-left with the left-field line running straight up.
const HOME_X = 40, HOME_Y = 250
const ZONE = (x, y) => x >= 40 && x < 160 && y >= 50 && y < 200

// ---------- accumulators ----------
const seasons = new Map() // season -> Map(playerId -> record)
const games = new Map() // gameId -> { type, home, away, date, season }
const zeros = (n) => new Array(n).fill(0)
function rec(season, pid) {
  let s = seasons.get(season)
  if (!s) seasons.set(season, (s = new Map()))
  let r = s.get(pid)
  if (!r) {
    s.set(pid, (r = {
      teams: new Map(), bat: null, pit: null, bp: null, pp: null, run: null, fld: {}, gpos: {},
      hands: { bL: 0, bR: 0, pL: 0, pR: 0 },
      d: { spray: [], pspray: [], bg: null, pg: null, ars: {}, vs: {}, sb: {}, sp: {}, glb: [], glp: [] },
    }))
  }
  return r
}
const disc = () => ({ n: 0, z: 0, sw: 0, wh: 0, zsw: 0, zct: 0, osw: 0, oct: 0, cs: 0, fpn: 0, fps: 0, fpsw: 0 })
const newBp = () => ({ ...disc(), go: 0, ao: 0, ld: 0, iffb: 0, gidp: 0, dpo: 0, ifh: 0, pl: 0, ce: 0, op: 0, ibb: 0, pa: 0 })
const newPp = () => ({ ...disc(), go: 0, ao: 0, ld: 0, iffb: 0, gidp: 0, ibb: 0, wp: 0, bk: 0, sb: 0, cs: 0, pk: 0, fbn: 0, fbs: 0, vmax: 0, vn: 0, vs: 0, pa: 0 })
const newRun = () => ({ sb: 0, cs: 0, sb2: 0, sb3: 0, pk: 0, oob: 0, xo: 0, xt: 0 })
const newFld = () => ({ o: 0, ch: 0, out: 0, pm: 0, e: 0, sb: 0, cs: 0, pb: 0, wp: 0 })
const newGrid = () => ({ n: zeros(100), sw: zeros(100), wh: zeros(100), h: zeros(100), ...newRv(100) })

// ---------- run value ----------
// Each pitch moves the plate appearance from one ball-strike count to another, or ends it.
// Its run value is the change in what the batter is expected to produce. Count values are
// only known once the whole season is read, so we store transitions and price them at the end:
//   value = sum(ending weights) - mean * endings + sum(net[count] * V[count])
const OUTCOME_RUNS = { 119: 0.55, 103: 0.57, 102: 0.7, 104: 1.0, 132: 1.0, 105: 1.27, 106: 1.65, 133: 1.65 }
const newRv = (cells) => ({ net: new Int32Array(cells * 12), term: zeros(cells), tn: zeros(cells) })
const countValues = new Map() // season -> { cs: sum of outcomes by count, cn, ts, tn }
const seasonRv = (season) => {
  let v = countValues.get(season)
  if (!v) countValues.set(season, (v = { cs: zeros(12), cn: zeros(12), ts: 0, tn: 0 }))
  return v
}
function addRv(acc, cell, from, to, w) {
  acc.net[cell * 12 + from]--
  if (to < 0) { acc.term[cell] += w; acc.tn[cell]++ } else acc.net[cell * 12 + to]++
}
function priceRv(acc, cell, V, mean) {
  let v = acc.term[cell] - mean * acc.tn[cell]
  for (let c = 0; c < 12; c++) v += acc.net[cell * 12 + c] * V[c]
  return Math.round(v * 100) / 100
}
const newLine = () => ({ pa: 0, ab: 0, h: 0, d: 0, t: 0, hr: 0, bb: 0, so: 0, hbp: 0, sf: 0 })
const fld = (r, k) => (r.fld[POS[k]] ??= newFld())

function tally(dsc, pr, zone, first) {
  dsc.n++
  const swing = SWING.has(pr), whiff = WHIFF.has(pr)
  if (zone) dsc.z++
  if (swing) {
    dsc.sw++
    if (whiff) dsc.wh++
    if (zone) { dsc.zsw++; if (!whiff) dsc.zct++ } else { dsc.osw++; if (!whiff) dsc.oct++ }
  }
  if (CALLED.has(pr)) dsc.cs++
  if (first) { dsc.fpn++; if (!BALL.has(pr) && pr !== '103') dsc.fps++; if (swing) dsc.fpsw++ }
}
function addLine(line, pr) {
  line.pa++
  if (!NO_AB.has(pr)) line.ab++
  const b = HIT_BASES[pr]
  if (b) { line.h++; if (b === 2) line.d++; if (b === 3) line.t++; if (b === 4) line.hr++ }
  if (pr === '119') line.bb++
  if (K.has(pr)) line.so++
  if (pr === '103') line.hbp++
  if (pr === '115') line.sf++
}
const PITCH_GROUP = {
  31: 'FB', 47: 'FB', 46: 'FB', 48: 'FB', 49: 'FB', 51: 'FB',
  32: 'BR', 33: 'BR', 34: 'BR', 35: 'BR', 36: 'BR', 37: 'BR', 38: 'BR', 52: 'BR', 53: 'BR',
  39: 'OS', 40: 'OS', 41: 'OS', 42: 'OS', 43: 'OS', 44: 'OS', 45: 'OS', 50: 'OS',
}

// ---------- play-by-play ----------
function processGame(rows) {
  const g = rows[0]
  const type = id(g.game_type_id)
  const season = g.season
  const gid = id(g.game_id)
  games.set(gid, { type, home: id(g.home_team_id), away: id(g.away_team_id), date: g.game_date.slice(0, 10), season })
  if (!REGULAR.has(type)) return

  let halfKey = null
  let st = null
  const R = (pid) => rec(season, pid)
  const creditOuts = (n) => { for (let k = 1; k <= 9; k++) if (st.f[k]) fld(R(st.f[k]), k).o += n }

  /** Who is the runner a text event refers to? Check the last known base state, then the next pitch. */
  const runnerAt = (i, base, shortName, movedTo) => {
    const want = normName(shortName)
    const cands = [[st.bases[base], st.names[base]]]
    for (let j = i + 1; j < rows.length && j < i + 8; j++) {
      const n = rows[j]
      if (n.inning + n.game_state_name !== halfKey) break
      if (n.pitch_id === '' || n.pitch_id === 'None') continue
      const keys = [['on_1b', 'on_1b_name'], ['on_2b', 'on_2b_name'], ['on_3b', 'on_3b_name']]
      if (movedTo != null && movedTo < 3) cands.push([id(n[keys[movedTo][0]]), n[keys[movedTo][1]]])
      cands.push([id(n[keys[base][0]]), n[keys[base][1]]])
      break
    }
    const named = cands.find(([pid, nm]) => pid && want && normName(nm).startsWith(want))
    return (named ?? cands.find(([pid]) => pid))?.[0] ?? ''
  }

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const hk = r.inning + r.game_state_name
    if (hk !== halfKey) {
      halfKey = hk
      st = { f: zeros(10).map(() => ''), bases: ['', '', ''], names: ['', '', ''], outOnBases: new Set(), pending: null, paBatter: '', paCounts: new Set() }
    }
    const d = r.description_jap
    const pr = id(r.presult), br = id(r.bresult)
    const P = id(r.pitcher), B = id(r.batter)
    const isPitch = r.pitch_id !== '' && r.pitch_id !== 'None'

    if (!isPitch) {
      if (P) st.f[1] = P
      let m
      if (pr === '139') {
        // Intentional walks are announced, not thrown, so they never show up as pitches.
        if (B) (R(B).bp ??= newBp()).ibb++
        if (P) (R(P).pp ??= newPp()).ibb++
      } else if ((m = d.match(/^([一二三123１２３])塁走者(.+?)[:：].*?盗塁成功/))) {
        const base = BASE_IDX[m[1]]
        const who = runnerAt(i, base, m[2], base + 1)
        if (who) { const rr = (R(who).run ??= newRun()); rr.sb++; if (base === 0) rr.sb2++; else rr.sb3++ }
        if (st.f[2]) fld(R(st.f[2]), 2).sb++
        if (P) (R(P).pp ??= newPp()).sb++
      } else if ((m = d.match(/^([一二三123１２３])塁走者(.+?)[:：].*?(盗塁を試みるもアウト|盗塁失敗|盗塁死)/))) {
        const who = runnerAt(i, BASE_IDX[m[1]], m[2])
        if (who) { (R(who).run ??= newRun()).cs++; st.outOnBases.add(who) }
        if (st.f[2]) fld(R(st.f[2]), 2).cs++
        if (P) (R(P).pp ??= newPp()).cs++
        creditOuts(1)
      } else if ((m = d.match(/([一二三123１２３])塁けん制[:：]ランナー(.+?)(戻りきれず|タッチアウト)/)) && d.includes('アウト')) {
        const who = runnerAt(i, BASE_IDX[m[1]], m[2])
        if (who) { (R(who).run ??= newRun()).pk++; st.outOnBases.add(who) }
        if (P) (R(P).pp ??= newPp()).pk++
        creditOuts(1)
      } else if ((m = d.match(/^([一二三123１２３])塁走者(.+?)は走塁死/))) {
        const who = runnerAt(i, BASE_IDX[m[1]], m[2])
        if (who) { (R(who).run ??= newRun()).oob++; st.outOnBases.add(who) }
        creditOuts(1)
      } else if (/\(投\)[:：](暴投|ワイルドピッチ)/.test(d)) {
        if (P) (R(P).pp ??= newPp()).wp++
        if (st.f[2]) fld(R(st.f[2]), 2).wp++
      } else if (/\(捕\)[:：](パスボール|捕逸)/.test(d)) {
        if (st.f[2]) fld(R(st.f[2]), 2).pb++
      } else if (/\(投\)[:：]ボーク/.test(d)) {
        if (P) (R(P).pp ??= newPp()).bk++
      }
      continue
    }

    // ----- a tracked pitch -----
    for (let k = 2; k <= 9; k++) { const v = id(r['fielder_' + k]); if (v) st.f[k] = v }
    st.f[1] = P
    const bases = [id(r.on_1b), id(r.on_2b), id(r.on_3b)]
    if (st.pending) {
      // Resolve "did the runner take the extra base?" now that we can see where everyone ended up.
      for (const q of st.pending) {
        const at = bases.indexOf(q.id) + 1
        const rr = (R(q.id).run ??= newRun())
        rr.xo++
        if (at ? at >= q.need : !st.outOnBases.has(q.id)) rr.xt++
      }
      st.pending = null
    }
    st.bases = bases
    st.names = [r.on_1b_name, r.on_2b_name, r.on_3b_name]
    if (!B || !P) continue

    const rb = R(B), rp = R(P)
    const bp = (rb.bp ??= newBp()), pp = (rp.pp ??= newPp())
    const bh = r.batter_hand === 'left' ? 'L' : 'R', ph = r.pitcher_hand === 'left' ? 'L' : 'R'
    rb.hands['b' + bh]++; rp.hands['p' + ph]++
    const px = num(r.plate_x), py = num(r.plate_y)
    const zone = ZONE(px, py)
    const first = r.balls === '0' && r.strikes === '0' || (num(r.balls) === 0 && num(r.strikes) === 0 && r.balls !== '')
    const pt = id(r.pitch_id)
    const group = PITCH_GROUP[pt] ?? 'OS'
    const swing = SWING.has(pr), whiff = WHIFF.has(pr)
    const bases4 = HIT_BASES[pr] ?? 0
    const paEnd = br !== '0' && br !== ''

    if (!BUNT.has(pr)) { tally(bp, pr, zone, first); tally(pp, pr, zone, first) }

    // Velocity and arsenal
    const v = num(r.release_speed_kmh)
    const a = (rp.d.ars[pt] ??= { n: 0, vn: 0, vs: 0, vmax: 0, sw: 0, wh: 0, z: 0, osw: 0, on: 0, ab: 0, h: 0, tb: 0, k: 0, pa: 0, L: 0, R: 0, ...newRv(1) })
    a.n++; a[bh]++
    if (zone) a.z++; else { a.on++; if (swing) a.osw++ }
    if (swing) a.sw++
    if (whiff) a.wh++
    if (v > 60 && v < 175) {
      a.vn++; a.vs += v; if (v > a.vmax) a.vmax = v
      pp.vn++; pp.vs += v; if (v > pp.vmax) pp.vmax = v
      if (pt === '31') { pp.fbn++; pp.fbs += v }
    }
    const vg = (rb.d.vs[group] ??= { n: 0, sw: 0, wh: 0, ab: 0, h: 0, tb: 0, k: 0, ...newRv(1) })
    vg.n++; if (swing) vg.sw++; if (whiff) vg.wh++

    // Location heatmaps (10 x 10 cells over the 200 x 250 plot; the zone is the middle 6 x 6)
    const cell = Math.min(9, Math.max(0, Math.floor(px / 20))) + 10 * Math.min(9, Math.max(0, Math.floor(py / 25)))
    const bg = (rb.d.bg ??= newGrid()), pg = (rp.d.pg ??= newGrid())
    bg.n[cell]++; pg.n[cell]++
    if (swing) { bg.sw[cell]++; pg.sw[cell]++ }
    if (whiff) { bg.wh[cell]++; pg.wh[cell]++ }
    if (bases4) { bg.h[cell]++; pg.h[cell]++ }

    // Run value: where did this pitch move the count?
    const nb = Math.min(3, num(r.balls)), ns = Math.min(2, num(r.strikes))
    const from = nb * 3 + ns
    const w = OUTCOME_RUNS[pr] ?? 0
    let to = from
    if (paEnd) to = -1
    else if (BALL.has(pr) && nb < 3) to = from + 3
    else if ((CALLED.has(pr) || pr === '116' || pr === '101') && ns < 2) to = from + 1
    for (const acc of [bg, pg]) addRv(acc, cell, from, to, w)
    addRv(a, 0, from, to, w)
    addRv(vg, 0, from, to, w)
    if (st.paBatter !== B) { st.paBatter = B; st.paCounts = new Set() }
    st.paCounts.add(from)
    if (paEnd) {
      const sv = seasonRv(season)
      for (const c of st.paCounts) { sv.cs[c] += w; sv.cn[c]++ }
      sv.ts += w; sv.tn++
      st.paBatter = ''
    }

    if (!paEnd) {
      // A strikeout can carry a steal on the same pitch; plain pitches cannot end here.
      continue
    }

    // ----- the plate appearance ended on this pitch -----
    bp.pa++; pp.pa++
    addLine((rb.d.sb[ph] ??= newLine()), pr)
    addLine((rp.d.sp[bh] ??= newLine()), pr)
    if (!NO_AB.has(pr)) { a.ab++; vg.ab++ }
    a.pa++
    if (bases4) { a.h++; a.tb += bases4; vg.h++; vg.tb += bases4 }
    if (K.has(pr)) { a.k++; vg.k++ }

    const outs = num(r.outs_when_up)
    if (bases[0] && outs < 2) bp.dpo++
    const brn = Number(br)
    const isDp = pr === '111'
    if (GROUND_OUT.has(pr) || (isDp && brn !== 92)) { bp.go++; pp.go++ }
    if (AIR_OUT.has(pr)) { bp.ao++; pp.ao++ }
    if (pr === '110' || pr === '113') { bp.ld++; pp.ld++ }
    if (brn >= 49 && brn <= 54) { bp.iffb++; pp.iffb++ }
    if (isDp && brn !== 92) { bp.gidp++; pp.gidp++ }
    if (brn >= 1 && brn <= 6) bp.ifh++

    // Spray
    const inPlay = bases4 || OUT_IN_PLAY.has(pr) || ERROR.has(pr) || pr === '126'
    if (inPlay && r.hc_x !== '' && r.hc_x !== 'None' && !BUNT.has(pr)) {
      const hx = num(r.hc_x), hy = num(r.hc_y)
      const foul = pr === '112' || pr === '113'
      if (!foul) {
        // 0 degrees is the right-field line, 90 the left-field line.
        const ang = (Math.atan2(HOME_Y - hy, hx - HOME_X) * 180) / Math.PI
        // The feed's field graphic squeezes angles toward center, so the middle band is 33-57
        // rather than 30-60. That lands on the familiar ~37 / 40 / 23 pull-center-oppo split.
        const side = ang > 57 ? 'L' : ang < 33 ? 'R' : 'C'
        if (side === 'C') bp.ce++
        else if ((side === 'L') === (bh === 'R')) bp.pl++
        else bp.op++
      }
      const kind = bases4 || (ERROR.has(pr) || pr === '126' ? 5 : 0)
      const air = AIR_OUT.has(pr) ? 1 : 0
      rb.d.spray.push(hx, hy, kind * 2 + air)
      rp.d.pspray.push(hx, hy, kind * 2 + air)
    }

    // Fielding
    const outsMade = K.has(pr) && pr !== '123' ? 1 : isDp ? 2 : OUT_IN_PLAY.has(pr) ? 1 : 0
    if (outsMade) creditOuts(outsMade)
    const hl = num(r.hit_location)
    const foulOut = pr === '112' || pr === '113'
    if (hl >= 1 && hl <= 9 && inPlay && pr !== '106' && !foulOut && st.f[hl]) {
      const f = fld(R(st.f[hl]), hl)
      f.ch++
      if (OUT_IN_PLAY.has(pr)) f.out++
    }
    if (ERROR.has(pr) && brn >= 100 && brn <= 108 && st.f[brn - 99]) fld(R(st.f[brn - 99]), brn - 99).e++
    const fielder = id(r.fielder)
    if (fielder && OUT_IN_PLAY.has(pr)) {
      const k = st.f.indexOf(fielder)
      if (k > 0) fld(R(fielder), k).pm++
    }

    // Baserunning: extra bases taken on singles and doubles
    const pend = []
    if (pr === '102') {
      if (bases[0]) pend.push({ id: bases[0], need: 3 })
      if (bases[1]) pend.push({ id: bases[1], need: 4 })
    } else if (pr === '104') {
      if (bases[0]) pend.push({ id: bases[0], need: 4 })
    }
    st.pending = pend.length ? pend : null
    st.outOnBases = new Set()

    // Steals recorded on a strikeout pitch
    const sm = d.match(/([一二三])塁走者(.+?)[がも](?:.*?)盗塁(成功|失敗)/)
    if (sm) {
      const who = bases[BASE_IDX[sm[1]]]
      const ok = sm[3] === '成功'
      if (who) { const rr = (R(who).run ??= newRun()); if (ok) { rr.sb++; if (sm[1] === '一') rr.sb2++; else rr.sb3++ } else rr.cs++ }
      if (st.f[2]) fld(R(st.f[2]), 2)[ok ? 'sb' : 'cs']++
      pp[ok ? 'sb' : 'cs']++
      if (!ok) creditOuts(1)
    }
  }
}

console.time('play-by-play')
let pbpRows = 0
for (const file of listCsv('pbp')) {
  let cur = null, buf = []
  for await (const r of readCsv(file)) {
    pbpRows++
    if (r.game_id !== cur) {
      if (buf.length) processGame(buf)
      cur = r.game_id; buf = []
    }
    buf.push(r)
  }
  if (buf.length) processGame(buf)
}
console.timeEnd('play-by-play')
console.log(`${pbpRows.toLocaleString()} play-by-play rows, ${games.size} games`)

// ---------- box scores ----------
const pitchersInGame = new Map() // gameId:team -> count
const boxFiles = listCsv('game_stats')
for (const file of boxFiles) {
  for await (const r of readCsv(file)) {
    if (num(r.pitching_G) || num(r.pitching_BF)) {
      const k = id(r.game_id) + ':' + id(r.team_id)
      pitchersInGame.set(k, (pitchersInGame.get(k) ?? 0) + 1)
    }
  }
}
const teamGames = new Map() // season:team -> Set(gameId)
let boxRows = 0, boxSkipped = 0
for (const file of boxFiles) {
  for await (const r of readCsv(file)) {
    const gid = id(r.game_id), team = id(r.team_id)
    const g = games.get(gid)
    if (!g || !REGULAR.has(g.type) || !TEAMS[team] || !id(r.player_id)) { boxSkipped++; continue }
    boxRows++
    const season = r.season
    const tk = season + ':' + team
    if (!teamGames.has(tk)) teamGames.set(tk, new Set())
    teamGames.get(tk).add(gid)
    const pr = rec(season, id(r.player_id))
    const date = r.game_date.slice(0, 10)
    const prevTeam = pr.teams.get(team)
    if (!prevTeam || date > prevTeam) pr.teams.set(team, date)
    const opp = g.home === team ? g.away : g.home
    const md = date.slice(5, 7) + date.slice(8, 10)

    for (const ch of r.position ?? '') if (BOX_POS[ch]) pr.gpos[BOX_POS[ch]] = (pr.gpos[BOX_POS[ch]] ?? 0) + 1

    if (num(r.batting_G)) {
      const b = (pr.bat ??= { g: 0, pa: 0, ab: 0, r: 0, h: 0, d: 0, t: 0, hr: 0, rbi: 0, sb: 0, bb: 0, so: 0, hbp: 0, sh: 0, sf: 0, e: 0 })
      const v = (k) => num(r['batting_' + k])
      b.g += 1; b.pa += v('PA'); b.ab += v('AB'); b.r += v('R'); b.h += v('H'); b.d += v('2B'); b.t += v('3B')
      b.hr += v('HR'); b.rbi += v('RBI'); b.sb += v('SB'); b.bb += v('BB'); b.so += v('SO'); b.hbp += v('HBP')
      b.sh += v('SH'); b.sf += v('SF'); b.e += v('E')
      if (v('PA')) pr.d.glb.push([md, Number(opp), v('PA'), v('AB'), v('H'), v('2B'), v('3B'), v('HR'), v('RBI'), v('BB'), v('SO'), v('SB'), v('R'), v('HBP'), v('SF')])
    }
    if (num(r.pitching_G) || num(r.pitching_BF)) {
      const p = (pr.pit ??= { g: 0, gs: 0, w: 0, l: 0, sv: 0, outs: 0, h: 0, r: 0, er: 0, hr: 0, bb: 0, so: 0, hbp: 0, bf: 0, pi: 0, qs: 0, cg: 0, sho: 0, last: '' })
      const v = (k) => num(r['pitching_' + k])
      const outs = Math.round(v('IP') * 3)
      const started = num(r.pitcher_order_number) === 1
      p.g += 1; if (started) p.gs += 1
      p.outs += outs; p.h += v('H'); p.r += v('R'); p.er += v('ER'); p.hr += v('HR'); p.bb += v('BB'); p.so += v('SO')
      p.hbp += v('HBP'); p.bf += v('BF'); p.pi += v('PI')
      if (started && outs >= 18 && v('ER') <= 3) p.qs++
      if (started && pitchersInGame.get(gid + ':' + team) === 1) { p.cg++; if (v('R') === 0) p.sho++ }
      // W, L and SV arrive as season-to-date totals, so keep the latest.
      if (date >= p.last) { p.last = date; p.w = v('W'); p.l = v('L'); p.sv = v('SV') }
      pr.d.glp.push([md, Number(opp), started ? 1 : 0, outs, v('H'), v('R'), v('ER'), v('BB'), v('SO'), v('HR'), v('PI'), v('BF')])
    }
  }
}
console.log(`${boxRows.toLocaleString()} regular-season box score lines (${boxSkipped.toLocaleString()} exhibition, postseason or all-star lines skipped)`)

// ---------- write ----------
if (existsSync(OUT)) rmSync(OUT, { recursive: true })
mkdirSync(join(OUT, 'p'), { recursive: true })
mkdirSync(join(OUT, 's'), { recursive: true })

const round1 = (x) => Math.round(x * 10) / 10
const strip = (o, keep = []) => {
  const out = {}
  for (const [k, v] of Object.entries(o)) if (v || keep.includes(k)) out[k] = v
  return out
}
const playerIndex = new Map() // pid -> { seasons: [] }
const details = new Map() // pid -> { season: detail }
const seasonList = [...seasons.keys()].sort()

for (const season of seasonList) {
  const out = []
  const sv = seasonRv(season)
  const rvMean = sv.tn ? sv.ts / sv.tn : 0
  const V = sv.cs.map((x, c) => (sv.cn[c] ? x / sv.cn[c] - rvMean : 0))
  const gridRv = (g) => g.n.map((_, cell) => priceRv(g, cell, V, rvMean))
  const total = (arr) => Math.round(arr.reduce((x, y) => x + y, 0) * 10) / 10
  for (const [pid, r] of seasons.get(season)) {
    if (!r.bat && !r.pit) continue // appeared only in play-by-play (e.g. as a fielder id we could not place)
    const teams = [...r.teams.entries()].sort((a, b) => (a[1] < b[1] ? -1 : 1)).map(([t]) => Number(t))
    const team = teams[teams.length - 1]
    // Primary position: most games in the field; pitchers and DHs fall out naturally.
    const fieldG = Object.entries(r.gpos).filter(([k]) => k !== 'PH' && k !== 'PR').sort((a, b) => b[1] - a[1])
    const pos = r.pit && (!r.bat || r.pit.bf > r.bat.pa) ? 'P' : fieldG[0]?.[0] ?? (r.pit ? 'P' : 'PH')
    const row = { id: Number(pid), t: team, pos }
    if (teams.length > 1) row.ts = teams
    const bgRv = r.d.bg ? gridRv(r.d.bg) : null
    const pgRv = r.d.pg ? gridRv(r.d.pg) : null
    if (r.bat) {
      const { e, ...b } = r.bat
      row.b = strip(b, ['g', 'pa', 'ab'])
      if (r.bp) Object.assign(row.b, strip(r.bp))
      if (bgRv && r.bat.pa) row.b.rv = total(bgRv)
      if (e) row.e = e
    }
    if (r.pit) {
      const { last: _last, ...p } = r.pit
      row.p = strip(p, ['g', 'outs', 'bf'])
      if (r.pp) {
        const { fbn, fbs, vn, vs, ...pp } = r.pp
        Object.assign(row.p, strip(pp))
        if (fbn >= 5) row.p.fbv = round1(fbs / fbn)
        if (vn >= 5) row.p.vavg = round1(vs / vn)
        row.p.vn = vn; row.p.fbn = fbn
        // Flipped so that positive is good for the pitcher, as Savant shows it.
        if (pgRv) row.p.rv = -total(pgRv)
      }
    }
    if (r.run) row.r = strip(r.run)
    const f = {}
    for (const [k, v] of Object.entries(r.fld)) {
      const g = r.gpos[k] ?? 0
      if (v.o < 3 && !g) continue
      f[k] = { g, ...strip(v) }
    }
    for (const [k, g] of Object.entries(r.gpos)) if (!f[k] && k !== 'PH' && k !== 'PR' && k !== 'DH') f[k] = { g }
    if (f.P && r.pit) f.P.g = r.pit.g
    if (Object.keys(f).length) row.f = f
    if (r.gpos.DH) row.dh = r.gpos.DH
    out.push(row)

    const h = r.hands
    const bats = h.bL + h.bR < 5 ? undefined : h.bL > 0.1 * (h.bL + h.bR) && h.bR > 0.1 * (h.bL + h.bR) ? 'S' : h.bL > h.bR ? 'L' : 'R'
    const throws = h.pL + h.pR < 5 ? undefined : h.pL > h.pR ? 'L' : 'R'
    let pi = playerIndex.get(pid)
    if (!pi) playerIndex.set(pid, (pi = { s: [] }))
    pi.s.push([Number(season), team, pos, r.bat?.pa ?? 0, r.pit?.outs ?? 0])
    if (bats) pi.bats = bats
    if (throws) pi.throws = throws

    const d = r.d
    const det = {}
    if (d.spray.length) det.spray = d.spray
    if (d.pspray.length && r.pit) det.pspray = d.pspray
    const slim = (g, rv) => ({ n: g.n, sw: g.sw, wh: g.wh, h: g.h, rv })
    if (d.bg && r.bat?.pa) det.bg = slim(d.bg, bgRv)
    if (d.pg && r.pit) det.pg = slim(d.pg, pgRv.map((x) => -x || 0))
    if (r.pit && Object.keys(d.ars).length) {
      det.ars = Object.entries(d.ars).sort((a, b) => b[1].n - a[1].n)
        .map(([k, a]) => ({ id: Number(k), ...a, vs: undefined, net: undefined, term: undefined, tn: undefined, rv: -priceRv(a, 0, V, rvMean) || 0, v: a.vn ? round1(a.vs / a.vn) : undefined }))
    }
    if (Object.keys(d.vs).length && r.bat?.pa) {
      det.vs = Object.fromEntries(Object.entries(d.vs).map(([k, g]) => [k, { ...g, net: undefined, term: undefined, tn: undefined, rv: priceRv(g, 0, V, rvMean) }]))
    }
    if (Object.keys(d.sb).length && r.bat?.pa) det.sb = d.sb
    if (Object.keys(d.sp).length && r.pit) det.sp = d.sp
    if (d.glb.length) det.glb = d.glb.sort((a, b) => (a[0] < b[0] ? -1 : 1))
    if (d.glp.length) det.glp = d.glp.sort((a, b) => (a[0] < b[0] ? -1 : 1))
    if (!details.has(pid)) details.set(pid, {})
    details.get(pid)[season] = det
  }
  const tg = {}
  for (const t of Object.keys(TEAMS)) tg[t] = teamGames.get(season + ':' + t)?.size ?? 0
  writeJson(join(OUT, 's', `${season}.json`), { season: Number(season), games: tg, players: out })
  console.log(`    count values 0-0 ${V[0].toFixed(3)}, 3-0 ${V[9].toFixed(3)}, 0-2 ${V[2].toFixed(3)}, 3-2 ${V[11].toFixed(3)}; out ${(-rvMean).toFixed(3)}`)
  console.log(`  ${season}: ${out.length} players, team games ${Math.min(...Object.values(tg))}-${Math.max(...Object.values(tg))}`)
}

for (const [pid, d] of details) writeJson(join(OUT, 'p', `${pid}.json`), d)

const players = []
let unnamed = 0
for (const [pid, pi] of playerIndex) {
  const n = names[pid] ?? {}
  if (!n.en) unnamed++
  players.push(strip({
    id: Number(pid), n: n.en || n.jp || String(pid), fam: n.family, jp: n.jp, src: n.src ?? 'none', ph: n.photo, npb: n.npbId,
    b: pi.bats ?? n.b, t: pi.throws ?? n.t, born: n.born, ht: Number(n.ht) || 0, wt: Number(n.wt) || 0,
    from: n.from, no: n.no, draft: n.draft, s: pi.s,
  }))
}
players.sort((a, b) => a.n.localeCompare(b.n))
writeJson(join(OUT, 'players.json'), players)

const lastDate = [...games.values()].filter((g) => REGULAR.has(g.type)).reduce((m, g) => (g.date > m ? g.date : m), '')
writeJson(join(OUT, 'meta.json'), {
  generated: new Date().toISOString(),
  through: lastDate,
  seasons: seasonList.map(Number),
  teams: Object.fromEntries(Object.entries(TEAMS).map(([k, t]) => [k, { abbr: t.abbr, city: t.city, nick: t.nick, league: t.league }])),
})
console.log(`wrote ${players.length} players (${unnamed} without an English name), data through ${lastDate}`)
