export function median(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

export function quantile(values, ratio) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const position = (sorted.length - 1) * ratio
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return sorted[lower]
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
}

export function legalDongFromAddress(address) {
  return String(address ?? '').split(/\s+/).find((part) => /(?:동|가|읍|면|리)[,]?$/.test(part))?.replace(/\d+동,?$/, '동').replace(/,$/, '') ?? ''
}

const complexKey = (trade) => trade.apt_seq || `${trade.legal_dong}|${trade.name}|${trade.build_year}`
const complexName = (name) => String(name ?? '').split(/[([]/)[0].replace(/(?:무순위|잔여세대|줍줍).*$/, '').replace(/[^가-힣a-zA-Z0-9]/g, '').toLowerCase()

function compactByComplex(trades, targetArea) {
  const groups = new Map()
  for (const trade of trades) {
    const key = complexKey(trade)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(trade)
  }
  return [...groups.values()].map((items) => {
    const recent = [...items].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4)
    const marketValues = recent.map((trade) => trade.price_krw / trade.area_sqm * targetArea)
    const representative = median(marketValues)
    const newest = recent[0]
    return {
      name: newest.name,
      legal_dong: newest.legal_dong,
      build_year: newest.build_year,
      month: newest.month,
      area_sqm: newest.area_sqm,
      floor: newest.floor,
      price_krw: newest.price_krw,
      market_krw: representative,
      trade_count: items.length,
    }
  })
}

function summarizeEstimate({ comparable, targetArea, salePrice, scope, ageLimit, confidence, method }) {
  const complexes = compactByComplex(comparable, targetArea)
  if (!complexes.length) return null
  const marketValues = method === 'same_complex' ? comparable.map((trade) => trade.price_krw / trade.area_sqm * targetArea) : complexes.map((item) => item.market_krw)
  const marketLow = Math.round(quantile(marketValues, 0.25))
  const marketBase = Math.round(median(marketValues))
  const marketHigh = Math.round(quantile(marketValues, 0.75))
  return {
    status: 'estimated',
    market_low_krw: marketLow,
    market_base_krw: marketBase,
    market_high_krw: marketHigh,
    gain_low_krw: Math.round(marketLow - salePrice),
    gain_base_krw: Math.round(marketBase - salePrice),
    gain_high_krw: Math.round(marketHigh - salePrice),
    confidence,
    method,
    scope,
    age_limit_years: ageLimit,
    trade_count: comparable.length,
    complex_count: complexes.length,
    comparables: complexes.sort((a, b) => Math.abs(a.market_krw - marketBase) - Math.abs(b.market_krw - marketBase)).slice(0, 5),
  }
}

export function estimateTypePrice({ trades, targetArea, salePrice, targetDong, targetName, currentYear }) {
  const name = complexName(targetName)
  const exact = trades.filter((t) => name.length >= 5 && complexName(t.name) === name && (!targetDong || t.legal_dong === targetDong) &&
    !t.cancelled && t.floor > 0 && Math.abs(t.area_sqm - targetArea) <= 1)
    .sort((a,b) => b.date.localeCompare(a.date)).slice(0,8)
  if (exact.length) return summarizeEstimate({comparable:exact,targetArea,salePrice,scope:'same_complex',ageLimit:0,confidence:exact.length >= 3 ? 'high' : 'low',method:'same_complex'})
  const areaTolerance = Math.max(2.5, targetArea * 0.05)
  let comparable = trades.filter((trade) =>
    !trade.cancelled && trade.floor >= 3 && Math.abs(trade.area_sqm - targetArea) <= areaTolerance,
  )
  if (comparable.length >= 5) {
    const sameDong = comparable.filter((trade) => targetDong && trade.legal_dong === targetDong)
    const sameDongComplexes = new Set(sameDong.map(complexKey)).size
    const scope = sameDong.length >= 5 && sameDongComplexes >= 3 ? 'same_dong' : 'sigungu'
    if (scope === 'same_dong') comparable = sameDong

    const ageBands = [5, 10, 15]
    for (const years of ageBands) {
      const recentBuildings = comparable.filter((trade) => trade.build_year && currentYear - trade.build_year <= years)
      if (recentBuildings.length >= 5 && new Set(recentBuildings.map(complexKey)).size >= 3) {
        const strict = summarizeEstimate({
          comparable: recentBuildings,
          targetArea,
          salePrice,
          scope,
          ageLimit: years,
          confidence: scope === 'same_dong' && years <= 10 && new Set(recentBuildings.map(complexKey)).size >= 4 ? 'high' : scope === 'same_dong' || years <= 10 ? 'medium' : 'low',
          method: 'strict',
        })
        if (strict && strict.complex_count >= 3) return strict
      }
    }
  }

  const relaxedTolerance = Math.max(5, targetArea * 0.1)
  let relaxed = trades.filter((trade) =>
    !trade.cancelled && trade.floor >= 2 && Math.abs(trade.area_sqm - targetArea) <= relaxedTolerance,
  )
  const relaxedSameDong = relaxed.filter((trade) => targetDong && trade.legal_dong === targetDong)
  const relaxedScope = new Set(relaxedSameDong.map((trade) => trade.name)).size >= 2 ? 'same_dong' : 'sigungu'
  if (relaxedScope === 'same_dong') relaxed = relaxedSameDong
  const regional = summarizeEstimate({
    comparable: relaxed,
    targetArea,
    salePrice,
    scope: relaxedScope,
    ageLimit: 30,
    confidence: 'low',
    method: 'regional_relaxed',
  })
  if (regional) return regional

  const nearest = trades
    .filter((trade) => !trade.cancelled && trade.floor >= 1 && trade.area_sqm > 0)
    .sort((a, b) => Math.abs(a.area_sqm - targetArea) - Math.abs(b.area_sqm - targetArea))
    .slice(0, 40)
  return summarizeEstimate({
    comparable: nearest,
    targetArea,
    salePrice,
    scope: 'sigungu',
    ageLimit: 50,
    confidence: 'low',
    method: 'nearest_area',
  })
}
