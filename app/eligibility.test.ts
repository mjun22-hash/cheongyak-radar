import { describe, expect, it } from 'vitest'
import { evaluateAnnouncement, monthsBetween } from './eligibility'
import type { Announcement, Profile } from './types'

const profile: Profile = {
  birth_year: 2000,
  marital_status: 'single',
  children: 0,
  household_size: 1,
  is_household_head: true,
  homeless: true,
  residence: { sido: '경기도', sigungu: '예시시', registered_since: '2018-01' },
  account: { type: '청년주택드림청약통장', rank_base_date: '2020-01-15', total_deposit_krw: 5_000_000, deposit_count_estimate: 55, verified: false },
  income: { gross_annual_krw: 72_000_000, basis_verified: false },
  assets: { financial_krw: 80_000_000, real_estate_krw: 0, car_value_krw: null, verified: false },
}

function announcement(overrides: Partial<Announcement> = {}): Announcement {
  return {
    id: 'test', notice_number: 'test', name: '테스트', region: { sido: '경기도', sigungu: '예시시', address: '경기도 예시시' },
    total_households: 10, housing_category: 'national', announcement_date: '2026-11-10', application_start: '2026-11-12', application_end: '2026-11-12',
    winner_date: null, contract_start: null, contract_end: null, links: { official: '#', homedubu: '#' },
    housing_types: [{ name: '59A', area_sqm: 59, households: 10, price_krw: null }],
    supply_options: [{ id: 'g1', label: '일반공급 1순위', kind: 'general_first', min_account_months: 12, min_deposit_count: 12, requires_homeless: true, requirements_complete: true, source_ref: '제27조' }],
    price_gain: { status: 'unavailable', estimated_krw: null, basis: '', comparables: [] }, restrictions: { resale: null, residence: null }, ...overrides,
  }
}

describe('eligibility engine', () => {
  it('computes month differences at the announcement basis date', () => expect(monthsBetween('2019-03', '2026-11-10')).toBe(92))
  it('returns review when estimated account figures are unverified', () => expect(evaluateAnnouncement(profile, announcement()).verdict).toBe('review'))
  it('rejects a single-person household from first-home supply over 60㎡', () => {
    const result = evaluateAnnouncement(profile, announcement({
      housing_types: [{ name: '84A', area_sqm: 84, households: 10, price_krw: null }],
      supply_options: [{ id: 'first', label: '생애최초', kind: 'special_first_home', requires_homeless: true, requirements_complete: false, source_ref: '제43조' }],
    }))
    expect(result.verdict).toBe('ineligible')
    expect(result.best?.reasons.join(' ')).toContain('60㎡')
  })
  it('rejects newlywed supply for an unmarried applicant', () => {
    const result = evaluateAnnouncement(profile, announcement({
      supply_options: [{ id: 'newlywed', label: '신혼부부', kind: 'special_newlywed', requirements_complete: false, source_ref: '제41조' }],
    }))
    expect(result.verdict).toBe('ineligible')
  })
  it('uses the best housing type and supply option', () => {
    const verified = { ...profile, account: { ...profile.account, verified: true } }
    const result = evaluateAnnouncement(verified, announcement({
      supply_options: [
        { id: 'newlywed', label: '신혼부부', kind: 'special_newlywed', requirements_complete: true, source_ref: '제41조' },
        { id: 'general', label: '일반공급 1순위', kind: 'general_first', min_account_months: 12, min_deposit_count: 12, requires_homeless: true, requirements_complete: true, source_ref: '제27조' },
      ],
    }))
    expect(result.verdict).toBe('eligible')
    expect(result.best?.option.id).toBe('general')
  })
})
