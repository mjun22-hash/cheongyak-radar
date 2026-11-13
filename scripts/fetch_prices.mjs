import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { estimateTypePrice, legalDongFromAddress } from './price_model.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataPath = path.join(root, 'data', 'announcements.json')
const cacheDir = path.join(root, '.cache', 'trades')
const codes = JSON.parse(await fs.readFile(path.join(root, 'data', 'lawd_codes.json'), 'utf8'))
const key = process.env.DATA_GO_KR_KEY
if (!key) { console.error('DATA_GO_KR_KEY가 없어 실거래가를 조회할 수 없습니다.'); process.exit(1) }

const decode = (text) => text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')
const tag = (xml, name) => decode(xml.match(new RegExp(`<${name}>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?</${name}>`, 's'))?.[1]?.trim() ?? '')
const number = (value) => Number(String(value).replaceAll(',', '').trim())
const months = Array.from({ length: 12 }, (_, index) => { const date = new Date(); date.setUTCMonth(date.getUTCMonth() - index); return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}` })

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
  const trades = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => {
    const year = tag(match[1], 'dealYear')
    const month = String(tag(match[1], 'dealMonth')).padStart(2, '0')
    const day = String(tag(match[1], 'dealDay') || '1').padStart(2, '0')
    return {
      name: tag(match[1], 'aptNm'),
      legal_dong: tag(match[1], 'umdNm'),
      area_sqm: number(tag(match[1], 'excluUseAr')),
      price_krw: number(tag(match[1], 'dealAmount')) * 10_000,
      build_year: number(tag(match[1], 'buildYear')),
      floor: number(tag(match[1], 'floor')),
      month: `${year}-${month}`,
      date: `${year}-${month}-${day}`,
      cancelled: Boolean(tag(match[1], 'cdealDay')),
    }
  }).filter((item) => item.name && item.area_sqm > 0 && item.price_krw > 0 && item.floor > 0)
  await fs.writeFile(cachePath, `${JSON.stringify(trades)}\n`)
  return trades
}

const data = JSON.parse(await fs.readFile(dataPath, 'utf8'))
const tradesByCode = new Map()
const currentYear = new Date().getUTCFullYear()
for (const announcement of data.announcements) {
  const code = announcement.lawd_code ?? codes[announcement.region.sido]?.[announcement.region.sigungu]
  if (!code) { announcement.price_gain = { status: 'unavailable', estimated_krw: null, basis: '비교지역 코드 없음', comparables: [], by_type: [] }; continue }
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
  const estimates = []
  const targetDong = legalDongFromAddress(announcement.region.address)
  for (const type of announcement.housing_types) {
    if (!type.area_sqm || !type.price_krw) continue
    const estimate = estimateTypePrice({ trades, targetArea: type.area_sqm, salePrice: type.price_krw, targetDong, currentYear })
    if (!estimate) continue
    estimates.push({ housing_type: type.name, area_sqm: type.area_sqm, sale_price_krw: type.price_krw, ...estimate })
  }
  if (!estimates.length) { announcement.price_gain = { status: 'unavailable', estimated_krw: null, basis: '같은 동·준신축·유사면적 비교단지 3곳 미만', comparables: [], by_type: [] }; continue }
  const representative = [...estimates].sort((a, b) => b.complex_count - a.complex_count || b.trade_count - a.trade_count)[0]
  const scopeLabel = representative.scope === 'same_dong' ? `${targetDong} 동일 법정동` : announcement.region.sigungu
  const basis = representative.method === 'strict'
    ? `${scopeLabel} · ${representative.age_limit_years}년 이내 준신축 ${representative.complex_count}개 단지 · 최근 12개월 유사면적 ${representative.trade_count}건`
    : representative.method === 'regional_relaxed'
      ? `${scopeLabel} · 유사면적 실거래 ${representative.complex_count}개 단지 ${representative.trade_count}건을 넓게 비교한 보완 추정`
      : `${announcement.region.sigungu} · 가장 가까운 면적의 실거래 ${representative.complex_count}개 단지 ${representative.trade_count}건으로 환산한 보완 추정`
  announcement.price_gain = {
    status: 'estimated',
    estimated_krw: representative.gain_base_krw,
    estimated_low_krw: representative.gain_low_krw,
    estimated_high_krw: representative.gain_high_krw,
    market_estimated_krw: representative.market_base_krw,
    confidence: representative.confidence,
    housing_type: representative.housing_type,
    basis,
    comparables: representative.comparables,
    by_type: estimates,
  }
}
await fs.writeFile(dataPath, `${JSON.stringify(data, null, 2)}\n`)
console.log('단지·동·연식·면적·층을 반영한 보수/기준/상단 시세차익 범위를 갱신했습니다.')
