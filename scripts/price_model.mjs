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
  return String(address ?? '').split(/\s+/).find((part) => /(?:동|가|읍|면|리)$/.test(part))?.replace(/[0-9-]+$/, '') ?? ''
}

function compactByComplex(trades, targetArea) {
  const groups = new Map()
  for (const trade of trades) {
    const key = `${trade.name}|${Math.round(trade.area_sqm * 10)}`
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

export function estimateTypePrice({ trades, targetArea, salePrice, targetDong, currentYear }) {
  const areaTolerance = Math.max(2.5, targetArea * 0.05)
  let comparable = trades.filter((trade) =>
    !trade.cancelled && trade.floor >= 3 && Math.abs(trade.area_sqm - targetArea) <= areaTolerance,
  )
  if (comparable.length < 5) return null

  const sameDong = comparable.filter((trade) => targetDong && trade.legal_dong === targetDong)
  const sameDongComplexes = new Set(sameDong.map((trade) => trade.name)).size
  const scope = sameDong.length >= 5 && sameDongComplexes >= 3 ? 'same_dong' : 'sigungu'
  if (scope === 'same_dong') comparable = sameDong

  const ageBands = [5, 10, 15]
  let ageLimit = null
  for (const years of ageBands) {
    const recentBuildings = comparable.filter((trade) => trade.build_year && currentYear - trade.build_year <= years)
    if (recentBuildings.length >= 5 && new Set(recentBuildings.map((trade) => trade.name)).size >= 3) {
      comparable = recentBuildings
      ageLimit = years
      break
    }
  }
  if (ageLimit === null) return null

  const complexes = compactByComplex(comparable, targetArea)
  if (complexes.length < 3) return null
  const marketValues = complexes.map((item) => item.market_krw)
  const marketLow = Math.round(quantile(marketValues, 0.25))
  const marketBase = Math.round(median(marketValues))
  const marketHigh = Math.round(quantile(marketValues, 0.75))
  const confidence = scope === 'same_dong' && ageLimit <= 10 && complexes.length >= 4 ? 'high' : scope === 'same_dong' || ageLimit <= 10 ? 'medium' : 'low'
  return {
    status: 'estimated',
    market_low_krw: marketLow,
    market_base_krw: marketBase,
    market_high_krw: marketHigh,
    gain_low_krw: Math.round(marketLow - salePrice),
    gain_base_krw: Math.round(marketBase - salePrice),
    gain_high_krw: Math.round(marketHigh - salePrice),
    confidence,
    scope,
    age_limit_years: ageLimit,
    trade_count: comparable.length,
    complex_count: complexes.length,
    comparables: complexes.sort((a, b) => Math.abs(a.market_krw - marketBase) - Math.abs(b.market_krw - marketBase)).slice(0, 5),
  }
}
