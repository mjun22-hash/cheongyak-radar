import { describe, expect, it } from 'vitest'
import { recommendation } from './recommendation'
import type { Announcement, AnnouncementEvaluation } from './types'

describe('recommendation copy', () => {
  it('stays silent when a matching market estimate is unavailable', () => {
    const announcement = {
      notice_analysis: { facts: {}, status: 'not_found', source_url: null, checked_at: '' },
      price_gain: { status: 'unavailable', estimated_krw: null, basis: '같은 동·준신축·유사면적 비교단지 3곳 미만', comparables: [], by_type: [] },
    } as unknown as Announcement
    const evaluation = {
      verdict: 'eligible',
      best: {
        verdict: 'eligible',
        option: { id: 'general', label: '일반공급 1순위', kind: 'general_first', requirements_complete: true, source_ref: '제28조' },
        housingType: { name: '84A', area_sqm: 84, households: 10, price_krw: 600_000_000 },
        reasons: ['구조화된 요건을 모두 충족합니다.'],
        sourceRef: '제28조',
      },
      all: [],
    } as AnnouncementEvaluation

    expect(recommendation(announcement, evaluation, null)).not.toContain('비교단지 부족')
  })

  it('uses a matched Homedubu gain when trade comparables are unavailable', () => {
    const announcement = {
      notice_analysis: { facts: {}, status: 'not_found', source_url: null, checked_at: '' },
      homedubu: { url: 'https://homedubu.com/12917/', title: '안양자이 더 포레스트', gain_estimate_krw: 100_000_000, checked_at: '' },
      price_gain: { status: 'unavailable', estimated_krw: null, basis: '', comparables: [], by_type: [] },
    } as unknown as Announcement
    const evaluation = {
      verdict: 'eligible',
      best: {
        verdict: 'eligible',
        option: { id: 'remaining', label: '무순위·잔여세대', kind: 'remaining', requirements_complete: true, source_ref: '제26조' },
        housingType: { name: '59A', area_sqm: 59, households: 1, price_krw: 680_000_000 },
        reasons: ['구조화된 요건을 모두 충족합니다.'],
        sourceRef: '제26조',
      },
      all: [],
    } as AnnouncementEvaluation

    expect(recommendation(announcement, evaluation, null)).toContain('홈두부 보완 안전마진 약 1억원')
  })
})
