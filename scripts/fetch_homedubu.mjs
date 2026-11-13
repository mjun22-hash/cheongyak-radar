import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataPath = path.join(root, 'data', 'announcements.json')
const supplementsPath = path.join(root, 'data', 'homedubu.json')
const userAgent = 'CheongyakRadar/1.0 (+personal dashboard; public pages only)'
const north = new Set(['고양시', '남양주시', '파주시', '의정부시', '양주시', '구리시', '포천시', '동두천시', '가평군', '연천군'])
const gyeonggiCities = ['수원', '성남', '안양', '부천', '광명', '평택', '안산', '과천', '오산', '시흥', '군포', '의왕', '하남', '용인', '이천', '안성', '김포', '화성', '광주', '여주']

const decode = (value = '') => value
  .replaceAll('&amp;', '&').replaceAll('&#038;', '&').replaceAll('&quot;', '"')
  .replaceAll('&#039;', "'").replaceAll('&#8217;', '’').replaceAll('&#8211;', '–')
  .replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&nbsp;', ' ')

const stripTags = (html = '') => decode(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
const todayKst = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const checkedAt = () => new Date().toISOString()

async function fetchHtml(url) {
  const response = await fetch(url, { headers: { 'User-Agent': userAgent, Accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(25_000) })
  if (!response.ok) throw new Error(`${url} HTTP ${response.status}`)
  return response.text()
}

function parseResults(html) {
  const results = new Map()
  for (const match of html.matchAll(/href="(https:\/\/homedubu\.com\/(\d+)\/)"[^>]*title="([^"]+)"/g)) {
    const title = decode(match[3]).trim()
    if (!results.has(match[1])) results.set(match[1], { url: match[1], id: match[2], title })
  }
  return [...results.values()]
}

function normalizeName(value) {
  return decode(value)
    .replace(/\([^)]*(?:\d{1,2}\/|['’]\d{2}|청약|예정)[^)]*\)/g, ' ')
    .replace(/\b(?:청약|무순위|줍줍|분양주택|공공분양주택|공공분양|신혼희망타운|본청약|사후|임의공급|계약취소분|불법행위재공급)\b/g, ' ')
    .replace(/[^0-9A-Za-z가-힣]/g, '')
    .toLowerCase()
}

function bigrams(value) {
  const set = new Set()
  for (let index = 0; index < value.length - 1; index += 1) set.add(value.slice(index, index + 2))
  return set
}

function scoreNames(left, right) {
  const a = normalizeName(left)
  const b = normalizeName(right)
  if (!a || !b) return 0
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) >= 5 ? 1 : 0.5
  const aa = bigrams(a)
  const bb = bigrams(b)
  const intersection = [...aa].filter((value) => bb.has(value)).length
  const union = new Set([...aa, ...bb]).size
  return union ? intersection / union : 0
}

function bestMatch(name, posts) {
  return posts
    .map((post) => ({ post, score: scoreNames(name, post.title) }))
    .sort((a, b) => b.score - a.score)[0]
}

function metaContent(html, name) {
  return decode(html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']*)["']`, 'i'))?.[1]
    ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${name}["']`, 'i'))?.[1]
    ?? '')
}

function eok(value) {
  const parsed = Number(String(value).replace(',', '.'))
  return Number.isFinite(parsed) ? Math.round(parsed * 100_000_000) : null
}

function parseDateRange(title, description) {
  const titleMatch = decode(title).match(/[’'](\d{2})\.\s*(\d{1,2})\/(\d{1,2})(?:\s*[~–-]\s*(\d{1,2}))?/)
  if (titleMatch) {
    const [, year, month, start, end = start] = titleMatch
    const prefix = `20${year}-${String(month).padStart(2, '0')}-`
    return { start: `${prefix}${String(start).padStart(2, '0')}`, end: `${prefix}${String(end).padStart(2, '0')}` }
  }
  const proseMatch = description.match(/(20\d{2})년\s*(\d{1,2})월\s*(\d{1,2})일/)
  if (!proseMatch) return { start: null, end: null }
  const [, year, month, day] = proseMatch
  const value = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return { start: value, end: value }
}

function parseRegion(title, description, text) {
  const source = `${description} ${text.slice(0, 8_000)} ${title}`
  if (title.includes('광교')) return { sido: '경기도', sigungu: '수원시' }
  const titledCity = gyeonggiCities.find((name) => title.includes(name))
  if (titledCity) return { sido: '경기도', sigungu: `${titledCity}시` }
  const direct = source.match(/(서울특별시|서울시|경기도)\s+([가-힣]+(?:시|구|군))/)
  if (direct) return { sido: direct[1].startsWith('서울') ? '서울특별시' : '경기도', sigungu: direct[2] }
  const seoul = source.match(/서울\s*([가-힣]+구)/)
  if (seoul) return { sido: '서울특별시', sigungu: seoul[1] }
  const city = gyeonggiCities.find((name) => title.includes(name) || source.includes(`${name}시`))
  return city ? { sido: '경기도', sigungu: `${city}시` } : null
}

function parseInsight(post, html) {
  const description = metaContent(html, 'description') || metaContent(html, 'og:description')
  const text = stripTags(html)
  const combined = `${description} ${text.slice(0, 30_000)}`
  const rating = Number(combined.match(/두부\s*별\s*(\d)/)?.[1] ?? 0) || null
  const directGain = combined.match(/(?:시세\s*차익|안전마진)[^0-9]{0,24}(\d+(?:[.,]\d+)?)\s*억/)
  const premiumGain = combined.match(/분양가(?:보다|\s*대비)[^0-9]{0,16}(\d+(?:[.,]\d+)?)\s*억(?:원)?\s*이상\s*(?:높|오른)/)
  const gainEstimate = eok(directGain?.[1] ?? premiumGain?.[1])
  const cashNeeded = eok(combined.match(/현금\s*(\d+(?:[.,]\d+)?)\s*억(?:원)?\s*이상/)?.[1])
  const dates = parseDateRange(post.title, description)
  const region = parseRegion(post.title, description, text)
  return {
    ...post,
    name: decode(post.title).replace(/\s*\([^)]*(?:[’']?\d{2}\.|\d{1,2}\/)[^)]*\)\s*$/, '').replace(/\s+(?:청약|무순위 줍줍|줍줍).*$/, '').trim(),
    application_start: dates.start,
    application_end: dates.end,
    region,
    category: /무순위|줍줍|임의공급|재공급/.test(post.title) ? 'remaining' : 'upcoming',
    rating,
    gain_estimate_krw: gainEstimate,
    gain_basis: gainEstimate ? (premiumGain ? '홈두부가 확인한 현재 매물 호가 기준' : '홈두부 분석의 시세차익·안전마진 기준') : null,
    cash_needed_krw: cashNeeded,
    checked_at: checkedAt(),
  }
}

function bestAnnouncementMatch(announcement, insights) {
  return insights.map((item) => {
    const nameScore = scoreNames(announcement.name, item.title)
    const sameCategory = announcement.housing_category === 'remaining' ? item.category === 'remaining' : item.category !== 'remaining'
    if (!sameCategory) return { post: item, score: 0 }
    let dateScore = 0
    if (announcement.application_start && item.application_start) {
      const gap = Math.abs((Date.parse(announcement.application_start) - Date.parse(item.application_start)) / 86_400_000)
      dateScore = gap <= 3 ? 0.2 : gap <= 31 ? 0.05 : -0.2
    }
    return { post: item, score: nameScore + dateScore }
  }).sort((a, b) => b.score - a.score)[0]
}

async function mapLimit(items, limit, mapper) {
  const output = new Array(items.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      output[index] = await mapper(items[index], index)
    }
  }))
  return output
}

async function main() {
  const data = JSON.parse(await fs.readFile(dataPath, 'utf8'))
  let priorSupplements = { metadata: {}, items: [] }
  try { priorSupplements = JSON.parse(await fs.readFile(supplementsPath, 'utf8')) } catch {}

  try {
    const categoryPages = await Promise.all([
      fetchHtml('https://homedubu.com/category/subscription/'),
      fetchHtml('https://homedubu.com/category/subscription/page/2/'),
      fetchHtml('https://homedubu.com/category/subscription/page/3/'),
    ])
    const postMap = new Map(categoryPages.flatMap(parseResults).map((post) => [post.url, post]))
    const openAnnouncements = data.announcements.filter((item) => !item.application_end || item.application_end >= todayKst())
    const unmatched = openAnnouncements.filter((item) => (bestMatch(item.name, [...postMap.values()])?.score ?? 0) < 0.48)
    const searchResults = await mapLimit(unmatched.slice(0, 30), 3, async (item) => {
      try {
        const html = await fetchHtml(`https://homedubu.com/?s=${encodeURIComponent(item.name)}`)
        const match = bestMatch(item.name, parseResults(html))
        return match?.score >= 0.48 ? match.post : null
      } catch { return null }
    })
    for (const post of searchResults.filter(Boolean)) postMap.set(post.url, post)

    const posts = [...postMap.values()].filter((post) => !/^\[주간 캘린더\]|^2026 청약 한눈에/.test(post.title)).slice(0, 50)
    const insights = (await mapLimit(posts, 4, async (post) => {
      try { return parseInsight(post, await fetchHtml(post.url)) } catch { return null }
    })).filter(Boolean)

    for (const announcement of data.announcements) {
      const match = bestAnnouncementMatch(announcement, insights)
      if (match?.score >= 0.48) {
        const item = match.post
        announcement.links.homedubu = item.url
        announcement.homedubu = {
          url: item.url,
          title: item.title,
          rating: item.rating,
          gain_estimate_krw: item.gain_estimate_krw,
          gain_basis: item.gain_basis,
          cash_needed_krw: item.cash_needed_krw,
          checked_at: item.checked_at,
        }
      } else {
        announcement.links.homedubu = null
        delete announcement.homedubu
      }
    }

    const officialNames = data.announcements.map((item) => item.name)
    const horizon = new Date(`${todayKst()}T00:00:00+09:00`)
    horizon.setDate(horizon.getDate() + 60)
    const horizonDate = horizon.toISOString().slice(0, 10)
    const supplements = insights.filter((item) => {
      if (!item.region || north.has(item.region.sigungu)) return false
      if (bestMatch(item.name, officialNames.map((title) => ({ title })))?.score >= 0.48) return false
      if (item.application_end && item.application_end < todayKst()) return false
      if (item.application_start && item.application_start > horizonDate) return false
      return true
    }).map(({ id, url, title, name, application_start, application_end, region, category, rating, gain_estimate_krw, gain_basis, cash_needed_krw, checked_at }) => ({
      id, url, title, name, application_start, application_end, region, category, rating, gain_estimate_krw, gain_basis, cash_needed_krw, checked_at,
    }))

    await fs.writeFile(dataPath, `${JSON.stringify(data, null, 2)}\n`)
    await fs.writeFile(supplementsPath, `${JSON.stringify({ metadata: { generated_at: checkedAt(), source: '홈두부 공개 청약 카테고리', count: supplements.length, last_fetch_error: null }, items: supplements }, null, 2)}\n`)
    console.log(`홈두부 개별 분석 ${data.announcements.filter((item) => item.homedubu).length}건 연결, 보완 공고 ${supplements.length}건 저장했습니다.`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    priorSupplements.metadata = { ...priorSupplements.metadata, generated_at: checkedAt(), last_fetch_error: message }
    await fs.writeFile(supplementsPath, `${JSON.stringify(priorSupplements, null, 2)}\n`)
    console.error(`홈두부 갱신 실패: 이전 정상 데이터 유지 (${message})`)
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
