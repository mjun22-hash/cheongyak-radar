import { describe, expect, it } from 'vitest'
import { extractFacts, officialAttachment } from './fetch_notices.mjs'

describe('official notice fact extraction', () => {
  it('only links the attachment for this notice, and reads the new two-stage payment schedule', () => {
    const makeLink = (number) => `<a href="https://static.applyhome.co.kr/ai/aia/getAtchmnfl.do?pblancNo=${number}">모집공고문 보기</a>`
    expect(officialAttachment(makeLink('2023000431') + makeLink('2026910288'), 'https://www.applyhome.co.kr', '2026910288')).toContain('2026910288')
    expect(extractFacts('중도금 60% 계약금(10%) 잔금(90%)')).toEqual({contract_deposit:'10%',balance_payment:'90%'})
  })
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

  it('does not borrow a value from the next table heading', () => {
    const facts = extractFacts('거주의무기간 재당첨 제한기간 10년')
    expect(facts.residence).toBeUndefined()
    expect(facts.rewinning).toBe('10년')
  })

  it('rejects an implausible ten-year residence value', () => {
    expect(extractFacts('거주의무기간 10년').residence).toBeUndefined()
  })
})
