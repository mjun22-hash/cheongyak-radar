import type { Announcement, AnnouncementEvaluation, Profile } from './types'

export function recommendation(announcement: Announcement, evaluation: AnnouncementEvaluation, profile: Profile | null): string {
  const best = evaluation.best
  if (!best) return '판정 가능한 공급유형이 없습니다. · 근거: 공식 공급유형 미수집 · 참고용'

  const estimate = announcement.price_gain.by_type?.find((item) => item.housing_type === best.housingType.name)
  const homedubuGain = !estimate ? announcement.homedubu?.gain_estimate_krw : null
  const salePrice = best.housingType.price_krw
  const depositText = announcement.notice_analysis?.facts?.contract_deposit
  const depositRate = Number(depositText?.match(/\d+/)?.[0] ?? 10) / 100
  const contractCash = salePrice ? salePrice * depositRate : null
  const capitalGap = profile?.assets.financial_krw !== null && profile?.assets.financial_krw !== undefined && contractCash ? profile.assets.financial_krw - contractCash : null
  const gainText = estimate ? `안전마진 ${formatKrw(estimate.gain_low_krw)}~${formatKrw(estimate.gain_high_krw)}` : homedubuGain ? `홈두부 보완 안전마진 약 ${formatKrw(homedubuGain)}` : null
  const capitalText = contractCash ? `계약금 약 ${formatKrw(contractCash)}${capitalGap !== null && capitalGap < 0 ? `, 금융자산 대비 ${formatKrw(Math.abs(capitalGap))} 부족` : ''}` : null
  const investmentText = [gainText, capitalText].filter(Boolean).join(', ')
  if (evaluation.verdict === 'ineligible') {
    return `현재 입력값으로는 ${best.option.label} 신청이 어렵습니다. · 근거: ${best.reasons[0]} · 참고용`
  }
  if (evaluation.verdict === 'review') {
    return `조건 보완 후 검토 · ${best.option.label}에서 ${best.reasons[0]}${investmentText ? ` ${investmentText}.` : ''} · 참고용`
  }
  const priorityGain = estimate?.gain_base_krw ?? homedubuGain
  const priority = priorityGain !== null && priorityGain !== undefined && priorityGain >= 100_000_000 ? '우선 검토' : priorityGain !== null && priorityGain !== undefined && priorityGain < 0 ? '후순위' : '검토 후보'
  return `${priority} · ${best.option.label} 기본요건 충족.${investmentText ? ` ${investmentText}.` : ''} · 근거: 공식 규칙·공고 데이터${estimate ? '와 단지별 실거래' : homedubuGain ? ' 및 홈두부 분석' : ''} · 참고용`
}

export function formatKrw(value: number): string {
  const eok = value / 100_000_000
  if (Math.abs(eok) >= 1) return `${eok.toFixed(1).replace(/\.0$/, '')}억원`
  return `${Math.round(value / 10_000).toLocaleString('ko-KR')}만원`
}
