import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataPath = path.join(root, 'data', 'announcements.json')
const cacheDir = path.join(root, '.cache', 'trades')
const codes = JSON.parse(await fs.readFile(path.join(root, 'data', 'lawd_codes.json'), 'utf8'))
const key = process.env.DATA_GO_KR_KEY
if (!key) { console.error('DATA_GO_KR_KEY가 없어 실거래가를 조회할 수 없습니다.'); process.exit(1) }

const decode = (text) => text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')
const tag = (xml, name) => decode(xml.match(new RegExp(`<${name}>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?</${name}>`, 's'))?.[1]?.trim() ?? '')
const number = (value) => Number(String(value).replaceAll(',', '').trim())
const months = Array.from({ length: 6 }, (_, index) => { const date = new Date(); date.setUTCMonth(date.getUTCMonth() - index); return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}` })

async function fetchTrades(lawdCode, dealMonth) {
  await fs.mkdir(cacheDir, { recursive: true })
  const cachePath = path.join(cacheDir, `${lawdCode}-${dealMonth}.json`)
  try {
    const stat = await fs.stat(cachePath)
    if (Date.now() - stat.mtimeMs < 12 * 3_600_000) return JSON.parse(await fs.readFile(cachePath, 'utf8'))
  } catch {}
  const url = new URL('https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev')
  Object.entries({ serviceKey: key, LAWD_CD: lawdCode, DEAL_YMD: dealMonth, numOfRows: 9999, pageNo: 1 }).forEach(([name, value]) => url.searchParams.set(name, String(value)))
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (response.status === 403) throw new Error('실거래가 API 활용신청 또는 인증 권한 확인 필요 (HTTP 403)')
  if (!response.ok) throw new Error(`실거래가 API HTTP ${response.status}`)
  const xml = await response.text()
  const resultCode = tag(xml, 'resultCode')
  if (resultCode && !['00', '000'].includes(resultCode)) throw new Error(`실거래가 API 오류 ${resultCode}: ${tag(xml, 'resultMsg') || '권한 또는 요청조건 확인'}`)
  const trades = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => ({
    name: tag(match[1], 'aptNm'),
    area_sqm: number(tag(match[1], 'excluUseAr')),
    price_krw: number(tag(match[1], 'dealAmount')) * 10_000,
    month: `${tag(match[1], 'dealYear')}-${String(tag(match[1], 'dealMonth')).padStart(2, '0')}`,
  })).filter((item) => item.name && item.area_sqm > 0 && item.price_krw > 0)
  await fs.writeFile(cachePath, `${JSON.stringify(trades)}\n`)
  return trades
}

function median(values) { const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2 }

const data = JSON.parse(await fs.readFile(dataPath, 'utf8'))
const tradesByCode = new Map()
for (const announcement of data.announcements) {
  const code = announcement.lawd_code ?? codes[announcement.region.sido]?.[announcement.region.sigungu]
  if (!code) { announcement.price_gain = { status: 'unavailable', estimated_krw: null, basis: '시·군·구 법정동 코드가 없어 산출할 수 없습니다.', comparables: [] }; continue }
  let trades = tradesByCode.get(code)
  if (!trades) {
    trades = []
    try {
      for (const month of months) trades.push(...await fetchTrades(code, month))
      tradesByCode.set(code, trades)
    } catch (error) {
      announcement.price_gain = { status: 'unavailable', estimated_krw: null, basis: error instanceof Error ? error.message : '실거래가 API 호출 오류', comparables: [] }
      continue
    }
  }
  const candidates = []
  for (const type of announcement.housing_types) {
    if (!type.area_sqm || !type.price_krw) continue
    const comparable = trades.filter((trade) => Math.abs(trade.area_sqm - type.area_sqm) <= Math.max(3, type.area_sqm * 0.08))
    if (comparable.length < 3) continue
    const unitPrices = comparable.map((trade) => trade.price_krw / trade.area_sqm)
    const market = median(unitPrices) * type.area_sqm
    candidates.push({ gain: Math.round(market - type.price_krw), type, comparable })
  }
  if (!candidates.length) { announcement.price_gain = { status: 'unavailable', estimated_krw: null, basis: '최근 6개월 유사면적 실거래가 3건 미만 또는 분양가 누락', comparables: [] }; continue }
  const best = candidates.sort((a, b) => b.gain - a.gain)[0]
  const samples = best.comparable.slice(0, 5)
  announcement.price_gain = { status: 'estimated', estimated_krw: best.gain, basis: `${announcement.region.sigungu} 최근 6개월 유사면적 ${best.comparable.length}건의 ㎡당 중간값 × ${best.type.area_sqm}㎡ - 분양가`, comparables: samples }
}
await fs.writeFile(dataPath, `${JSON.stringify(data, null, 2)}\n`)
console.log('실거래가 비교가 가능한 공고의 추정 시세차익을 갱신했습니다.')
