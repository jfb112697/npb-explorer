// Shared helpers for the data scripts.
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'csv-parse'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const RAW = join(ROOT, '.cache', 'raw')
export const REPO = 'armstjc/Nippon-Baseball-Data-Repository'

// SPAIA team id -> everything the app needs to show a club in English.
export const TEAMS = {
  1: { code: 'g', abbr: 'YOM', city: 'Yomiuri', nick: 'Giants', league: 'CL', jp: ['巨人', '読売'] },
  2: { code: 's', abbr: 'YAK', city: 'Yakult', nick: 'Swallows', league: 'CL', jp: ['ヤクルト'] },
  3: { code: 'db', abbr: 'DNA', city: 'Yokohama DeNA', nick: 'BayStars', league: 'CL', jp: ['DeNA', 'ＤｅＮＡ', '横浜'] },
  4: { code: 'd', abbr: 'CHU', city: 'Chunichi', nick: 'Dragons', league: 'CL', jp: ['中日'] },
  5: { code: 't', abbr: 'HAN', city: 'Hanshin', nick: 'Tigers', league: 'CL', jp: ['阪神'] },
  6: { code: 'c', abbr: 'HIR', city: 'Hiroshima', nick: 'Carp', league: 'CL', jp: ['広島'] },
  7: { code: 'l', abbr: 'SEI', city: 'Seibu', nick: 'Lions', league: 'PL', jp: ['西武'] },
  8: { code: 'f', abbr: 'NIP', city: 'Nippon-Ham', nick: 'Fighters', league: 'PL', jp: ['日本ハム'] },
  9: { code: 'm', abbr: 'LOT', city: 'Lotte', nick: 'Marines', league: 'PL', jp: ['ロッテ'] },
  11: { code: 'b', abbr: 'ORX', city: 'Orix', nick: 'Buffaloes', league: 'PL', jp: ['オリックス'] },
  12: { code: 'h', abbr: 'SOF', city: 'SoftBank', nick: 'Hawks', league: 'PL', jp: ['ソフトバンク'] },
  376: { code: 'e', abbr: 'RAK', city: 'Rakuten', nick: 'Golden Eagles', league: 'PL', jp: ['楽天'] },
}

// Game types in the play-by-play feed.
export const REGULAR = new Set(['1', '2', '26'])

export const num = (v) => {
  if (v === '' || v == null || v === 'None') return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
/** Ids arrive as "1700044.0" in some files and "1700044" in others. */
export const id = (v) => {
  if (v === '' || v == null || v === 'None') return ''
  const s = String(v)
  return s.endsWith('.0') ? s.slice(0, -2) : s
}

export function listCsv(dir) {
  const d = join(RAW, dir)
  if (!existsSync(d)) return []
  return readdirSync(d)
    .filter((f) => f.endsWith('.csv'))
    .sort()
    .map((f) => join(d, f))
}

export async function* readCsv(file) {
  const parser = createReadStream(file).pipe(
    parse({ columns: true, bom: true, relax_quotes: true, relax_column_count: true }),
  )
  for await (const row of parser) yield row
}

export function writeJson(file, data) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(data))
}

export const fileSize = (f) => (existsSync(f) ? statSync(f).size : -1)

// ---------- Japanese text ----------

const KANJI_VARIANTS = {
  '﨑': '崎', '嵜': '崎', '髙': '高', '濵': '浜', '濱': '浜', '澤': '沢', '邊': '辺', '邉': '辺',
  '齋': '斉', '齊': '斉', '斎': '斉', '德': '徳', '廣': '広', '國': '国', '嶋': '島', '嶌': '島',
  '櫻': '桜', '眞': '真', '龍': '竜', '惠': '恵', '來': '来', '曾': '曽', '栁': '柳', '瀨': '瀬',
  '冨': '富', '渕': '淵', '萬': '万', '彌': '弥', '藏': '蔵', '壽': '寿', '將': '将', '樂': '楽',
  '顯': '顕', '晝': '昼', '埜': '野', '靏': '鶴', '槇': '槙', '莉': '莉', '凜': '凛', '駿': '駿',
  '增': '増', '神': '神', '祐': '祐', '塚': '塚', '隆': '隆', '晴': '晴', '郞': '郎', '朗': '朗',
  '吉': '吉', '𠮷': '吉', '桒': '桑', '舘': '館', '條': '条', '與': '与', '豐': '豊', '嶽': '岳',
  '髭': '髭', '禮': '礼', '淸': '清', '靑': '青', '黑': '黒', '兒': '児', '實': '実', '榮': '栄',
  '衞': '衛', '圓': '円', '應': '応', '櫂': '櫂', '稻': '稲', '鐵': '鉄', '燈': '灯', '縣': '県',
}

/** Collapse spacing, width and old-form kanji so the same person matches across sites. */
export function normName(s) {
  let out = (s ?? '').normalize('NFKC').replace(/[\s　・･.．]/g, '')
  out = [...out].map((c) => KANJI_VARIANTS[c] ?? c).join('')
  return out
}
export const hasKanji = (s) => /[一-鿿々]/.test(s ?? '')
/** "Ｒ．マルティネス" -> "マルティネス" */
export const stripInitial = (s) => (s ?? '').normalize('NFKC').replace(/^[A-Za-z]{1,2}[.．・]\s*/, '').trim()

const DIGRAPHS = {
  きゃ: 'kya', きゅ: 'kyu', きょ: 'kyo', しゃ: 'sha', しゅ: 'shu', しょ: 'sho', しぇ: 'she',
  ちゃ: 'cha', ちゅ: 'chu', ちょ: 'cho', ちぇ: 'che', にゃ: 'nya', にゅ: 'nyu', にょ: 'nyo',
  ひゃ: 'hya', ひゅ: 'hyu', ひょ: 'hyo', みゃ: 'mya', みゅ: 'myu', みょ: 'myo',
  りゃ: 'rya', りゅ: 'ryu', りょ: 'ryo', ぎゃ: 'gya', ぎゅ: 'gyu', ぎょ: 'gyo',
  じゃ: 'ja', じゅ: 'ju', じょ: 'jo', じぇ: 'je', びゃ: 'bya', びゅ: 'byu', びょ: 'byo',
  ぴゃ: 'pya', ぴゅ: 'pyu', ぴょ: 'pyo', ふぁ: 'fa', ふぃ: 'fi', ふぇ: 'fe', ふぉ: 'fo',
  てぃ: 'ti', でぃ: 'di', とぅ: 'tu', どぅ: 'du', うぃ: 'wi', うぇ: 'we', うぉ: 'wo',
  ゔぁ: 'va', ゔぃ: 'vi', ゔぇ: 've', ゔぉ: 'vo', つぁ: 'tsa', つぃ: 'tsi', つぇ: 'tse', つぉ: 'tso',
  でゅ: 'dyu', てゅ: 'tyu', ふゅ: 'fyu', いぇ: 'ye', くぁ: 'kwa', ぐぁ: 'gwa',
}
const MONO = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o', か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so', た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no', は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo', や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro', わ: 'wa', を: 'o', ん: 'n',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go', ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do', ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
  ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po', ゔ: 'vu',
  ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o', ゃ: 'ya', ゅ: 'yu', ょ: 'yo',
}
const toHira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))

/**
 * Kana -> Hepburn romaji in the style NPB and MLB use for player names:
 * long vowels are dropped (Shohei, Yuki, Ono) rather than written with macrons.
 */
export function kanaToRomaji(kana) {
  const s = toHira((kana ?? '').normalize('NFKC'))
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const two = s.slice(i, i + 2)
    const c = s[i]
    if (DIGRAPHS[two]) { out += DIGRAPHS[two]; i++; continue }
    if (c === 'っ') {
      const nxt = DIGRAPHS[s.slice(i + 1, i + 3)] ?? MONO[s[i + 1]] ?? ''
      out += nxt.startsWith('ch') ? 't' : nxt[0] ?? ''
      continue
    }
    if (c === 'ー') { continue }
    if (c === 'ん') {
      const nxt = MONO[s[i + 1]] ?? ''
      out += /^[aiueoy]/.test(nxt) ? "n'" : 'n'
      continue
    }
    if (MONO[c]) { out += MONO[c]; continue }
    if (/[a-z0-9 ]/i.test(c)) out += c
  }
  // Long vowels: おう/おお -> o, うう -> u. "ei" and "ii" are kept, as in Keiji or Niigata.
  out = out.replace(/ou/g, 'o').replace(/oo/g, 'o').replace(/uu/g, 'u')
  return out
}
export const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)
export function titleCase(s) {
  return (s ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      if (/^(jr|sr)\.?$/.test(w)) return cap(w.replace('.', '')) + '.'
      if (/^(de|la|del|van|von|da)$/.test(w)) return w === 'de' || w === 'la' || w === 'del' ? cap(w) : w
      if (/^mc[a-z]/.test(w)) return 'Mc' + cap(w.slice(2))
      if (w.includes('-')) return w.split('-').map(cap).join('-')
      if (w.includes("'")) return w.split("'").map(cap).join("'")
      return cap(w)
    })
    .join(' ')
}

export const PREFECTURES = {
  北海道: 'Hokkaido', 青森: 'Aomori', 岩手: 'Iwate', 宮城: 'Miyagi', 秋田: 'Akita', 山形: 'Yamagata',
  福島: 'Fukushima', 茨城: 'Ibaraki', 栃木: 'Tochigi', 群馬: 'Gunma', 埼玉: 'Saitama', 千葉: 'Chiba',
  東京: 'Tokyo', 神奈川: 'Kanagawa', 新潟: 'Niigata', 富山: 'Toyama', 石川: 'Ishikawa', 福井: 'Fukui',
  山梨: 'Yamanashi', 長野: 'Nagano', 岐阜: 'Gifu', 静岡: 'Shizuoka', 愛知: 'Aichi', 三重: 'Mie',
  滋賀: 'Shiga', 京都: 'Kyoto', 大阪: 'Osaka', 兵庫: 'Hyogo', 奈良: 'Nara', 和歌山: 'Wakayama',
  鳥取: 'Tottori', 島根: 'Shimane', 岡山: 'Okayama', 広島: 'Hiroshima', 山口: 'Yamaguchi',
  徳島: 'Tokushima', 香川: 'Kagawa', 愛媛: 'Ehime', 高知: 'Kochi', 福岡: 'Fukuoka', 佐賀: 'Saga',
  長崎: 'Nagasaki', 熊本: 'Kumamoto', 大分: 'Oita', 宮崎: 'Miyazaki', 鹿児島: 'Kagoshima', 沖縄: 'Okinawa',
}
export const COUNTRIES = {
  ドミニカ共和国: 'Dominican Republic', アメリカ: 'United States', ベネズエラ: 'Venezuela', キューバ: 'Cuba',
  台湾: 'Taiwan', ブラジル: 'Brazil', パナマ: 'Panama', 韓国: 'South Korea', メキシコ: 'Mexico',
  カナダ: 'Canada', ウガンダ: 'Uganda', プエルトリコ: 'Puerto Rico', コロンビア: 'Colombia',
  スロベニア: 'Slovenia', オーストラリア: 'Australia', オランダ: 'Netherlands', キュラソー: 'Curaçao',
  ニカラグア: 'Nicaragua', 中国: 'China', ドイツ: 'Germany', イタリア: 'Italy', 南アフリカ: 'South Africa',
}
