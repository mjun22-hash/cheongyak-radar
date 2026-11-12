import { describe, expect, it } from 'vitest'
import { estimateTypePrice, legalDongFromAddress, median, quantile } from './price_model.mjs'

const trade = (name, legalDong, price, overrides = {}) => ({
  name,
  legal_dong: legalDong,
  build_year: 2020,
  area_sqm: 84,
  floor: 10,
  price_krw: price,
  date: '2026-10-15',
  month: '2026-10',
  cancelled: false,
  ...overrides,
})

describe('realistic price model', () => {
  it('uses the same legal dong before wider sigungu outliers', () => {
    const trades = [
      trade('가단지', '망우동', 600_000_000), trade('가단지', '망우동', 610_000_000, { date: '2026-09-10' }),
      trade('나단지', '망우동', 620_000_000), trade('나단지', '망우동', 630_000_000, { date: '2026-09-11' }),
      trade('다단지', '망우동', 640_000_000), trade('다단지', '망우동', 650_000_000, { date: '2026-09-12' }),
      ...Array.from({ length: 10 }, (_, index) => trade(`외부${index}`, '신내동', 1_300_000_000)),
    ]
    const result = estimateTypePrice({ trades, targetArea: 84, salePrice: 500_000_000, targetDong: '망우동', currentYear: 2026 })

    expect(result?.scope).toBe('same_dong')
    expect(result?.complex_count).toBe(3)
    expect(result?.market_base_krw).toBe(625_000_000)
    expect(result?.gain_base_krw).toBe(125_000_000)
  })

  it('excludes cancelled deals and low floors', () => {
    const trades = [
      trade('가단지', '망우동', 600_000_000), trade('가단지', '망우동', 610_000_000),
      trade('나단지', '망우동', 620_000_000), trade('나단지', '망우동', 630_000_000),
      trade('다단지', '망우동', 640_000_000), trade('다단지', '망우동', 650_000_000),
      trade('취소거래', '망우동', 2_000_000_000, { cancelled: true }),
      trade('저층거래', '망우동', 1_800_000_000, { floor: 2 }),
    ]
    const result = estimateTypePrice({ trades, targetArea: 84, salePrice: 500_000_000, targetDong: '망우동', currentYear: 2026 })

    expect(result?.market_high_krw).toBeLessThan(700_000_000)
    expect(result?.comparables.map((item) => item.name)).not.toContain('취소거래')
    expect(result?.comparables.map((item) => item.name)).not.toContain('저층거래')
  })

  it('does not invent a value with fewer than three comparable complexes', () => {
    const trades = Array.from({ length: 6 }, (_, index) => trade(index < 3 ? '가단지' : '나단지', '망우동', 600_000_000 + index * 1_000_000))
    expect(estimateTypePrice({ trades, targetArea: 84, salePrice: 500_000_000, targetDong: '망우동', currentYear: 2026 })).toBeNull()
  })

  it('normalizes legal dong names and calculates robust statistics', () => {
    expect(legalDongFromAddress('서울특별시 중랑구 망우동 123')).toBe('망우동')
    expect(median([10, 40, 20, 30])).toBe(25)
    expect(quantile([10, 20, 30, 40, 50], 0.25)).toBe(20)
  })
})
