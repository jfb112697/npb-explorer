// Fetches NPB+ (npb-plus.jp) Hawk-Eye season tracking aggregates for every rostered
// player and writes data/tracking-<season>.json, keyed by NPB+ player id.
// Endpoint reverse-engineered from the NPB+ Android app; no auth required.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const API = 'https://api.npb-plus.jp/graphql'
const SEASON = process.argv[2] ?? String(new Date().getFullYear())
const OUT = join(ROOT, 'data', `tracking-${SEASON}.json`)

const TEAM_MAP = {
  巨人: 1, ヤクルト: 2, DeNA: 3, 中日: 4, 阪神: 5, 広島: 6,
  西武: 7, 日本ハム: 8, ロッテ: 9, オリックス: 11, ソフトバンク: 12, 楽天: 376,
}

const gq = async (query, variables) => {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      if (json.errors) throw new Error(json.errors[0].message)
      return json.data
    } catch (e) {
      if (attempt >= 4) throw e
      await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)))
    }
  }
}
const num = (v) => (v == null || v === '' ? null : Number(v))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const TEAMS_Q = `query { central: teams(leagueKind: CENTRAL_LEAGUE) { id shortName } pacific: teams(leagueKind: PACIFIC_LEAGUE) { id shortName } }`
const ROSTER_Q = `query R($teamId: TeamID!) { players(teamId: $teamId) { id useName positionInContract } }`
const PERF_Q = `query P($id: PlayerID!) { player(id: $id) { detail { performance { maxPerformance {
  averageExitVelocity averageLaunchAngle hardHitPercentage barrelPercentage averageSwingSpeed maxSprintSpeed
} } } } }`

const existing = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { fetched: null, players: [] }
const done = new Set(existing.players.map((p) => p.id))

const teams = [...(await gq(TEAMS_Q)).central, ...(await gq(TEAMS_Q)).pacific]
  .filter((t) => TEAM_MAP[t.shortName])

const players = [...existing.players]
let fetched = 0
for (const team of teams) {
  const roster = (await gq(ROSTER_Q, { teamId: team.id })).players
  for (const p of roster) {
    if (done.has(p.id)) continue
    try {
      const d = await gq(PERF_Q, { id: p.id })
      const m = d?.player?.detail?.performance?.maxPerformance ?? {}
      players.push({
        id: p.id, name: p.useName, team: team.shortName, teamId: TEAM_MAP[team.shortName], pos: p.positionInContract,
        ev: num(m.averageExitVelocity), la: num(m.averageLaunchAngle), hh: num(m.hardHitPercentage),
        bar: num(m.barrelPercentage), sws: num(m.averageSwingSpeed), spr: num(m.maxSprintSpeed),
      })
    } catch (e) {
      console.error(`  ${p.useName}: ${e.message}`)
      players.push({ id: p.id, name: p.useName, team: team.shortName, teamId: TEAM_MAP[team.shortName], pos: p.positionInContract, error: String(e.message) })
    }
    fetched++
    if (fetched % 50 === 0) {
      console.log(`  ${fetched} fetched (${players.length} total)`)
      writeFileSync(OUT, JSON.stringify({ ...existing, players }, null, 1))
    }
    await sleep(150)
  }
}

writeFileSync(OUT, JSON.stringify({ fetched: new Date().toISOString(), players }, null, 1))
const withEv = players.filter((p) => p.ev != null).length
console.log(`wrote ${OUT}: ${players.length} players, ${withEv} with tracking data`)
