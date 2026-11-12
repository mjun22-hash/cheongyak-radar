import { describe, expect, it } from 'vitest'
import { extractFacts } from './fetch_notices.mjs'

describe('official notice fact extraction', () => {
  it('extracts restrictions, local priority and payment schedule', () => {
    const facts = extractFacts(`
      전매제한기간 3년, 거주의무기간 없음, 재당첨 제한기간 10년
      해당지역 우선공급 계속하여 2년 이상 거주한 신청자
      계약금 10% / 중도금 60% / 잔금 30%
    `)

    expect(facts).toMatchObject({
      resale: '3년',
      residence: '없음',
      rewinning: '10년',
      priority_residence: '계속하여 2년 이상',
      contract_deposit: '10%',
      interim_payment: '60%',
      balance_payment: '30%',
    })
  })
})
