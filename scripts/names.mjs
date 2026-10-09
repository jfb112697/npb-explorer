// Resolves English names, headshots and bio details for every player in the stats feed.
//
// The stats feed (SPAIA, via the Nippon Baseball Data Repository) only has names in Japanese.
// npb.jp publishes official English spellings for active players and a kana reading for
// everyone who has ever appeared, so this script matches the two by name, team and year.
// Results are written to data/names.json and committed; network responses are cached in
// .cache/npb so re-runs only fetch what is new.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  COUNTRIES, PREFECTURES, RAW, ROOT, TEAMS, cap, hasKanji, id, kanaToRomaji, listCsv, normName,
  readCsv, stripInitial, titleCase, writeJson,
} from './lib.mjs'

const CACHE = join(ROOT, '.cache', 'npb')
const OUT = join(ROOT, 'data', 'names.json')
const UA = 'Mozilla/5.0 (compatible; npb-explorer data build; +https://github.com/armstjc/Nippon-Baseball-Data-Repository)'
const PHOTO_YEAR = new Date().getFullYear()
mkdirSync(CACHE, { recursive: true })

async function get(url, { fresh = false } = {}) {
  const f = join(CACHE, createHash('sha1').update(url).digest('hex') + '.html')
  if (!fresh && existsSync(f)) return readFileSync(f, 'utf8')
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } })
      if (res.status === 404) { writeFileSync(f, ''); return '' }
      if (!res.ok) throw new Error(`${res.status}`)
      const text = await res.text()
      writeFileSync(f, text)
      return text
    } catch (e) {
      if (attempt === 2) { console.warn('  fetch failed', url, e.message); return '' }
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)))
    }
  }
  return ''
}
async function pool(items, size, fn) {
  const out = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: size }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k) }
  }))
  return out
}
const strip = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()

// ---------- 1. who do we need names for ----------
const players = new Map() // spaiaId -> { jp, seasons:Set, teamYears:Set("2023:5"), last:[season, team] }
for (const file of listCsv('game_stats')) {
  for await (const r of readCsv(file)) {
    const team = id(r.team_id)
    if (!TEAMS[team]) continue
    const pid = id(r.player_id)
    if (!pid) continue
    let p = players.get(pid)
    if (!p) players.set(pid, (p = { jp: r.player_name_jap, seasons: new Set(), teamYears: new Set(), last: ['', ''] }))
    p.jp = r.player_name_jap || p.jp
    p.seasons.add(r.season)
    p.teamYears.add(`${r.season}:${team}`)
    if (r.game_date >= p.last[0]) p.last = [r.game_date, team]
  }
}
console.log(`${players.size} players in the stats feed`)

const directory = new Map()
const dirFile = join(RAW, 'directory.json')
if (!existsSync(dirFile)) {
  const res = await fetch('https://raw.githubusercontent.com/armstjc/Nippon-Baseball-Data-Repository/main/rosters/player_directory/directory.json')
  writeFileSync(dirFile, await res.text())
}
for (const d of JSON.parse(readFileSync(dirFile, 'utf8'))) directory.set(String(d.PersonInfoID), d)

// ---------- 2. active rosters: official English names + headshots ----------
const active = [] // { npbId, team, jp, en, no, born, ht, wt, t, b }
await pool(Object.entries(TEAMS), 4, async ([teamId, t]) => {
  const [jp, en] = await Promise.all([
    get(`https://npb.jp/bis/teams/rst_${t.code}.html`, { fresh: true }),
    get(`https://npb.jp/bis/eng/teams/rst_${t.code}.html`, { fresh: true }),
  ])
  const rowRe = /<tr class="rosterPlayer">(.*?)<\/tr>/gs
  const enById = new Map()
  for (const m of en.matchAll(rowRe)) {
    const a = m[1].match(/players\/(\d+)\.html">([^<]+)<\/a>/)
    if (!a) continue
    const cells = [...m[1].matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((c) => strip(c[1]))
    enById.set(a[1], { en: a[2].trim(), born: cells[2], ht: cells[3], wt: cells[4], t: cells[5], b: cells[6] })
  }
  for (const m of jp.matchAll(rowRe)) {
    const a = m[1].match(/players\/(\d+)\.html">([^<]+)<\/a>/)
    if (!a) continue
    const no = strip(m[1].match(/<td[^>]*>(.*?)<\/td>/s)?.[1] ?? '')
    active.push({ npbId: a[1], team: teamId, jp: a[2].trim(), no, ...(enById.get(a[1]) ?? {}) })
  }
})
console.log(`${active.length} players on current npb.jp rosters`)
const activeByName = new Map()
for (const a of active) {
  for (const key of new Set([normName(a.jp), normName(stripInitial(a.jp))])) {
    if (!activeByName.has(key)) activeByName.set(key, [])
    activeByName.get(key).push(a)
  }
}

// ---------- 3. all-time index: kana readings for everyone else ----------
const indexHome = await get('https://npb.jp/bis/players/all/index.html')
const indexPages = [...new Set([...indexHome.matchAll(/href="(index_[a-z0-9_]+\.html)"/g)].map((m) => m[1]))]
const allTime = new Map() // normalized name -> [{ npbId, name, debut }]
await pool(indexPages, 4, async (page) => {
  const h = await get(`https://npb.jp/bis/players/all/${page}`)
  const re = /<a href="\/bis\/players\/(\d+)\.html"[^>]*>\s*<div>\s*<dl>\s*<dd class="name">\s*(.*?)\s*<\/dd>\s*(?:<dd class="note">\s*(.*?)\s*<\/dd>)?/gs
  for (const m of h.matchAll(re)) {
    const entry = { npbId: m[1], name: strip(m[2]), debut: Number((m[3] ?? '').match(/(\d{4})年/)?.[1] ?? 0) }
    for (const key of new Set([normName(entry.name), normName(stripInitial(entry.name))])) {
      if (!allTime.has(key)) allTime.set(key, [])
      allTime.get(key).push(entry)
    }
  }
})
console.log(`${allTime.size} names in the npb.jp all-time index (${indexPages.length} pages)`)

function parsePlayerPage(h) {
  if (!h) return null
  const kana = strip(h.match(/id="pc_v_kana">([^<]*)</)?.[1] ?? '')
  const photo = h.match(/id="pc_v_photo">\s*<img src="([^"]+)"/)?.[1] ?? ''
  const bio = h.slice(h.indexOf('id="pc_bio"'), h.indexOf('id="pc_bio"') + 2500)
  const cell = (label) => strip(bio.match(new RegExp(`${label}\\s*</th>\\s*<td[^>]*>(.*?)</td>`, 's'))?.[1] ?? '')
  const teamYears = new Set()
  for (const m of h.matchAll(/<tr[^>]*>\s*<t[dh][^>]*>\s*(\d{4})\s*<\/t[dh]>\s*<t[dh][^>]*>\s*([^<]+?)\s*</g)) {
    const team = Object.entries(TEAMS).find(([, t]) => t.jp.some((n) => m[2].normalize('NFKC').replace(/\s/g, '').includes(n.normalize('NFKC'))))
    if (team) teamYears.add(`${m[1]}:${team[0]}`)
  }
  const hands = cell('投打')
  const size = cell('身長／体重')
  const born = cell('生年月日').match(/(\d{4})年(\d{1,2})月(\d{1,2})日/)
  return {
    kana, photo, teamYears,
    t: hands.match(/(右|左|両)投/)?.[1], b: hands.match(/(右|左|両)打/)?.[1],
    ht: size.match(/(\d+)cm/)?.[1], wt: size.match(/(\d+)kg/)?.[1],
    draft: cell('ドラフト').match(/(\d{4})年ドラフト(\d+)位/)?.slice(1, 3),
    born: born ? `${born[1]}-${born[2].padStart(2, '0')}-${born[3].padStart(2, '0')}` : undefined,
  }
}

/** npb.jp writes readings as "family・given"; foreign players also get "(ENGLISH NAME)". */
function nameFromKana(kana, jp) {
  const eng = kana.match(/[(（]([A-Za-z .,'’-]+)[)）]/)
  if (eng) return { en: titleCase(eng[1].replace(/,/g, ' ')), src: 'official' }
  const parts = kana.replace(/[(（].*$/, '').split(/[・\s]+/).filter(Boolean)
  if (!parts.length) return null
  if (!hasKanji(jp) && /[ァ-ヺ]/.test(kana)) {
    // Katakana with no English given: a foreign name we can only transliterate.
    return { en: parts.map((p) => cap(kanaToRomaji(p))).join(' '), src: 'kana' }
  }
  const [family, ...given] = parts.map((p) => cap(kanaToRomaji(p)))
  return { en: given.length ? `${given.join(' ')} ${family}` : family, family, src: 'kana' }
}
const HAND = { 右: 'R', 左: 'L', 両: 'S' }
const EN_MONTH = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' }
function enDate(s) {
  const m = (s ?? '').match(/([A-Z][a-z]{2})\.?\s+(\d{1,2}),\s*(\d{4})/)
  return m ? `${m[3]}-${EN_MONTH[m[1]]}-${m[2].padStart(2, '0')}` : undefined
}

// ---------- 4. resolve ----------
// Hand-entered names for the few players npb.jp cannot resolve. Keys are stats-feed ids.
const overridesFile = join(ROOT, 'data', 'name-overrides.json')
const overrides = existsSync(overridesFile) ? JSON.parse(readFileSync(overridesFile, 'utf8')) : {}
const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {}
const out = {}
const stats = { roster: 0, page: 0, kana: 0, translit: 0, none: 0 }
const latestSeason = String(Math.max(...[...players.values()].flatMap((p) => [...p.seasons].map(Number))))

await pool([...players.entries()], 6, async ([pid, p]) => {
  const dir = directory.get(pid)
  const keys = [normName(p.jp), normName(stripInitial(p.jp))]
  const rec = { jp: p.jp.replace(/\s+/g, ' ').trim() }

  // Active roster: match on name, preferring the player's current team.
  let hit
  if (p.seasons.has(latestSeason) || dir) {
    const team = dir ? String(dir.TeamID) : p.last[1]
    const cands = keys.flatMap((k) => activeByName.get(k) ?? [])
    // A full Japanese name is unique enough to follow a player across a trade; a bare
    // katakana surname (Rodriguez, Martinez) is not, so those must also match on team.
    hit = cands.find((a) => a.team === team) ?? (cands.length === 1 && hasKanji(p.jp) ? cands[0] : undefined)
  }
  if (hit) {
    rec.npbId = hit.npbId
    if (hit.en) {
      const [family, given] = hit.en.split(',').map((s) => s.trim())
      rec.en = given ? `${given} ${family}` : family
      rec.family = family
      rec.src = 'official'
    }
    rec.photo = `https://p.npb.jp/players_photo/${PHOTO_YEAR}/180/${TEAMS[hit.team].code}/${hit.no.padStart(3, '0')}_${hit.npbId}.jpg`
    rec.born = enDate(hit.born); rec.ht = hit.ht; rec.wt = hit.wt; rec.t = hit.t; rec.b = hit.b
    stats.roster++
  } else {
    // Historical: pick the all-time index entry whose team-by-year record overlaps ours.
    const first = Math.min(...[...p.seasons].map(Number))
    const last = Math.max(...[...p.seasons].map(Number))
    let pool0 = keys.flatMap((k) => allTime.get(k) ?? [])
    if (!pool0.length && !hasKanji(p.jp) && keys[1].length >= 3) {
      // Foreign players are sometimes indexed under a fuller name ("C.C.メルセデス", "ダヤン・ビシエド").
      pool0 = [...allTime.entries()].filter(([k]) => k.endsWith(keys[1]) || k.startsWith(keys[1])).flatMap(([, v]) => v)
    }
    const cands = [...new Map(pool0.map((c) => [c.npbId, c])).values()]
      .filter((c) => !c.debut || (c.debut <= last && c.debut >= first - 28))
      .sort((a, b) => b.debut - a.debut)
      .slice(0, 8)
    let best, bestScore = 0
    for (const c of cands) {
      const page = parsePlayerPage(await get(`https://npb.jp/bis/players/${c.npbId}.html`))
      if (!page) continue
      let score = 0
      for (const ty of p.teamYears) if (page.teamYears.has(ty)) score++
      if (score > bestScore) { best = { c, page }; bestScore = score }
    }
    if (best) {
      rec.npbId = best.c.npbId
      const n = nameFromKana(best.page.kana, p.jp)
      if (n) Object.assign(rec, n)
      rec.born = best.page.born; rec.ht = best.page.ht; rec.wt = best.page.wt
      rec.t = HAND[best.page.t]; rec.b = HAND[best.page.b]
      if (best.page.draft) rec.draft = [Number(best.page.draft[0]), best.page.draft[1]]
      stats.page++
    }
  }

  // Fallbacks when npb.jp gave us nothing: the feed's own kana, then transliteration.
  if (!rec.en && dir?.DelivFirstNameK && hasKanji(p.jp)) {
    const family = cap(kanaToRomaji(dir.DelivFirstNameK))
    const given = dir.DelivLastNameK ? cap(kanaToRomaji(dir.DelivLastNameK)) : ''
    rec.en = given ? `${given} ${family}` : family
    rec.family = family
    rec.src = 'kana'
    stats.kana++
  }
  if (!rec.en && !hasKanji(p.jp)) {
    rec.en = stripInitial(p.jp).split(/[・\s]+/).map((s) => cap(kanaToRomaji(s))).join(' ')
    rec.src = 'translit'
    stats.translit++
  }
  if (overrides[pid]) Object.assign(rec, { en: overrides[pid], family: undefined, src: 'manual' })
  if (!rec.en && prev[pid]?.en) Object.assign(rec, { en: prev[pid].en, family: prev[pid].family, src: prev[pid].src })
  if (!rec.en) { rec.src = 'none'; stats.none++ }

  if (dir) {
    rec.born ??= dir.Birthday ? `${dir.Birthday.slice(0, 4)}-${dir.Birthday.slice(4, 6)}-${dir.Birthday.slice(6, 8)}` : undefined
    rec.ht ??= dir.Height || undefined
    rec.wt ??= dir.Weight || undefined
    rec.t ??= { 1: 'L', 2: 'R' }[dir.PitchingArm] // provisional; the play-by-play hands override this
    rec.from = PREFECTURES[dir.Hometown] ? `${PREFECTURES[dir.Hometown]}, Japan` : COUNTRIES[dir.Hometown]
    rec.no = dir.BackNumber || undefined
    if (dir.DraftYear) rec.draft = [Number(dir.DraftYear), (dir.DraftNo ?? '').match(/\d+/)?.[0] ?? '']
    rec.pro = dir.ProTotal ? Number(dir.ProTotal) : undefined
  }
  out[pid] = rec
})

// Drop headshot links that do not resolve, so the app never shows a broken image.
const withPhoto = Object.values(out).filter((r) => r.photo)
let bad = 0
await pool(withPhoto, 8, async (r) => {
  try {
    const res = await fetch(r.photo, { method: 'HEAD', headers: { 'User-Agent': UA } })
    if (!res.ok) { delete r.photo; bad++ }
  } catch { delete r.photo; bad++ }
})

writeJson(OUT, Object.fromEntries(Object.entries(out).sort(([a], [b]) => Number(a) - Number(b))))
console.log(`names: ${stats.roster} from active rosters, ${stats.page} from npb.jp player pages, ` +
  `${stats.kana} from feed kana, ${stats.translit} transliterated, ${stats.none} unresolved`)
console.log(`headshots: ${withPhoto.length - bad} ok, ${bad} missing`)
const unresolved = Object.entries(out).filter(([, r]) => r.src === 'none' || r.src === 'translit')
writeFileSync(join(ROOT, '.cache', 'names-review.txt'), unresolved.map(([k, r]) => `${k}\t${r.src}\t${r.jp}\t${r.en ?? ''}`).join('\n'))
