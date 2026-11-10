import type { Announcement, AnnouncementEvaluation } from './types'

export function recommendation(announcement: Announcement, evaluation: AnnouncementEvaluation): string {
  const best = evaluation.best
  if (!best) return '공급유형 정보가 없어 공고문부터 확인하세요. · 근거: 공급유형 미확인 · 참고용'

  const gain = announcement.price_gain
  const restrictionUnknown = !announcement.restrictions.resale || !announcement.restrictions.residence
  if (evaluation.verdict === 'ineligible') {
    return `현재 입력값으로는 ${best.option.label} 신청이 어렵습니다. · 근거: ${best.reasons[0]} · 참고용`
  }
  if (evaluation.verdict === 'review') {
    const gainText = gain.status === 'estimated' && gain.estimated_krw !== null ? `추정 시세차익 ${formatKrw(gain.estimated_krw)}` : '시세차익 산출 불가'
    return `${best.option.label}을 우선 확인하되 공고문 검증이 필요합니다. · 근거: ${best.reasons[0]}, ${gainText}${restrictionUnknown ? ', 전매·거주의무 미확인' : ''} · 참고용`
  }
  return `${best.option.label} 신청 후보입니다. 자금계획과 제한사항을 함께 보세요. · 근거: 구조화 요건 충족, ${gain.status === 'estimated' ? '실거래 비교 있음' : '시세차익 미산출'} · 참고용`
}

export function formatKrw(value: number): string {
  const eok = value / 100_000_000
  if (Math.abs(eok) >= 1) return `${eok.toFixed(1).replace(/\.0$/, '')}억원`
  return `${Math.round(value / 10_000).toLocaleString('ko-KR')}만원`
}
