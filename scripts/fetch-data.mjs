// Downloads the raw CSVs from the Nippon Baseball Data Repository's GitHub releases into
// .cache/raw. Files whose size already matches the release asset are skipped, so a daily
// refresh only pulls the current season's months.
import { createWriteStream, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { RAW, REPO, fileSize } from './lib.mjs'

const RELEASES = { player_game_stats: 'game_stats', pbp: 'pbp' }
const headers = { 'User-Agent': 'npb-explorer', Accept: 'application/vnd.github+json' }
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`

let fetched = 0, skipped = 0
for (const [tag, dir] of Object.entries(RELEASES)) {
  mkdirSync(join(RAW, dir), { recursive: true })
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${tag}`, { headers })
  if (!res.ok) throw new Error(`Could not read the ${tag} release: ${res.status} ${await res.text()}`)
  const { assets } = await res.json()
  for (const a of assets.filter((x) => x.name.endsWith('.csv'))) {
    const dest = join(RAW, dir, a.name)
    if (fileSize(dest) === a.size) { skipped++; continue }
    const dl = await fetch(a.browser_download_url, { headers: { 'User-Agent': 'npb-explorer' } })
    if (!dl.ok || !dl.body) throw new Error(`Download failed for ${a.name}: ${dl.status}`)
    await pipeline(Readable.fromWeb(dl.body), createWriteStream(dest))
    fetched++
    console.log(`  ${a.name} (${(a.size / 1e6).toFixed(1)} MB)`)
  }
}
const dir = await fetch(`https://raw.githubusercontent.com/${REPO}/main/rosters/player_directory/directory.json`)
if (dir.ok && dir.body) await pipeline(Readable.fromWeb(dir.body), createWriteStream(join(RAW, 'directory.json')))
console.log(`fetched ${fetched} files, ${skipped} already up to date`)
