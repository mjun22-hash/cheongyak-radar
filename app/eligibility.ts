import rulesData from '../rules/eligibility.json'
import type { Announcement, AnnouncementEvaluation, Evaluation, HousingType, Profile, SupplyOption, Verdict } from './types'

const verdictScore: Record<Verdict, number> = { eligible: 3, review: 2, ineligible: 1 }
const ruleTable = Object.fromEntries((rulesData.rules as Array<Record<string, unknown>>).map((rule) => [String(rule.id), rule]))
const ruleNumber = (ruleId: string, key: string, fallback: number): number => typeof ruleTable[ruleId]?.[key] === 'number' ? ruleTable[ruleId][key] as number : fallback
const kindPriority: Record<SupplyOption['kind'], number> = {
  special_first_home: 8,
  special_newborn: 7,
  special_newlywed: 6,
  special_multi_child: 5,
  special_elderly_parent: 4,
  general_first: 3,
  remaining: 2,
  general_second: 1,
}

export function monthsBetween(start: string, end: string): number | null {
  const s = /^(\d{4})-(\d{2})/.exec(start)
  const e = /^(\d{4})-(\d{2})/.exec(end)
  if (!s || !e) return null
  return (Number(e[1]) - Number(s[1])) * 12 + Number(e[2]) - Number(s[2])
}

export function ageAt(birthYear: number, date: string): number {
  return Number(date.slice(0, 4)) - birthYear
}

function evaluateSupply(profile: Profile | null, announcement: Announcement, option: SupplyOption, housingType: HousingType): Evaluation {
  const failures: string[] = []
  const warnings: string[] = []
  const basisDate = announcement.announcement_date

  if (!profile) {
    return { option, housingType, verdict: 'review', reasons: ['내 조건을 입력하면 자동 판정됩니다.'], sourceRef: option.source_ref }
  }

  const age = ageAt(profile.birth_year, basisDate)
  const adultAge = option.min_age ?? ruleNumber('adult', 'min_age', 19)
  if (age < adultAge) failures.push(`공고일 기준 만 ${adultAge}세 이상 요건을 충족하지 않습니다.`)
  if (option.requires_homeless === true && !profile.homeless) failures.push('무주택세대구성원 요건을 충족하지 않습니다.')
  if (option.requires_household_head && !profile.is_household_head) failures.push('세대주 요건을 충족하지 않습니다.')

  if (option.kind === 'special_newlywed' && profile.marital_status !== 'married') failures.push('혼인 중이 아니어서 신혼부부 공급 대상이 아닙니다.')
  if (option.kind === 'special_multi_child' && profile.children < 2) failures.push('자녀 수 요건을 충족하지 않습니다.')
  if (option.kind === 'special_newborn' && profile.children < 1) failures.push('신생아 가구 요건을 충족하지 않습니다.')
  if (option.kind === 'special_newborn' && profile.children > 0) warnings.push('자녀의 출생일·태아 여부를 공고문 기준으로 확인해야 합니다.')
  if (option.kind === 'special_elderly_parent' && profile.household_size <= 1) failures.push('노부모 부양 세대 요건을 충족하지 않습니다.')

  if (option.kind === 'special_first_home') {
    const singleMaxArea = option.max_area_sqm ?? ruleNumber('first_home_single_area', 'max_area_sqm', 60)
    if (!profile.homeless) failures.push('세대원 전원의 과거 주택소유 이력까지 확인해야 합니다.')
    if (profile.household_size === 1 && housingType.area_sqm !== null && housingType.area_sqm > singleMaxArea) {
      failures.push(`단독세대주는 생애최초 특별공급에서 전용 ${singleMaxArea}㎡ 이하만 신청할 수 있습니다.`)
    }
    if (profile.household_size === 1 && housingType.area_sqm === null) warnings.push(`단독세대주 ${singleMaxArea}㎡ 이하 제한을 확인할 면적 정보가 없습니다.`)
    warnings.push('생애최초 여부와 5개년도 소득세 납부실적을 공고문 서류 기준으로 확인해야 합니다.')
  }

  const generalRuleId = announcement.housing_category === 'national' ? 'national_first_rank' : 'private_first_rank'
  const minMonths = option.min_account_months ?? (option.kind === 'general_first' ? ruleNumber(generalRuleId, 'account_months', 12) : undefined)
  if (minMonths !== undefined) {
    const held = monthsBetween(profile.account.rank_base_date, basisDate)
    if (held === null) warnings.push('청약통장 가입 기준일을 확인할 수 없습니다.')
    else if (held < minMonths) failures.push(`청약통장 가입기간 ${minMonths}개월 요건에 미달합니다.`)
  }
  if (option.min_deposit_count !== undefined) {
    if (profile.account.deposit_count_estimate === null) warnings.push('인정 납입횟수를 순위확인서로 확인해야 합니다.')
    else if (profile.account.deposit_count_estimate < option.min_deposit_count) failures.push(`납입횟수 ${option.min_deposit_count}회 요건에 미달합니다.`)
  }
  if (option.min_deposit_krw !== undefined) {
    if (profile.account.total_deposit_krw === null) warnings.push('지역·면적별 예치금 충족 여부를 확인해야 합니다.')
    else if (profile.account.total_deposit_krw < option.min_deposit_krw) failures.push('청약 예치금 요건에 미달합니다.')
  }
  if (!profile.account.verified && ['general_first', 'special_first_home'].includes(option.kind)) {
    warnings.push('통장 납입횟수·인정금액이 미확인 값입니다.')
  }

  if (option.residence_sido) {
    if (profile.residence.sido !== option.residence_sido) failures.push(`${option.residence_sido} 거주자 요건을 충족하지 않습니다.`)
    if (option.residence_min_months) {
      const lived = monthsBetween(profile.residence.registered_since, basisDate)
      if (lived === null) warnings.push('거주 시작일을 확인할 수 없습니다.')
      else if (lived < option.residence_min_months) failures.push(`거주기간 ${option.residence_min_months}개월 요건에 미달합니다.`)
    }
  }

  if (option.max_income_krw !== undefined) {
    if (profile.income.gross_annual_krw === null || !profile.income.basis_verified) warnings.push('공고문 소득 산정방식으로 다시 확인해야 합니다.')
    else if (profile.income.gross_annual_krw > option.max_income_krw) failures.push('공고문 소득기준을 초과합니다.')
  } else if (option.kind.startsWith('special_')) {
    warnings.push('공급유형별 소득기준이 구조화되지 않아 공고문 확인이 필요합니다.')
  }

  if (option.max_assets_krw !== undefined) {
    const knownAssets = (profile.assets.financial_krw ?? 0) + (profile.assets.real_estate_krw ?? 0) + (profile.assets.car_value_krw ?? 0)
    if (!profile.assets.verified || profile.assets.car_value_krw === null) warnings.push('자동차가액을 포함한 자산기준을 다시 확인해야 합니다.')
    else if (knownAssets > option.max_assets_krw) failures.push('공고문 자산기준을 초과합니다.')
  } else if (option.kind.startsWith('special_')) {
    warnings.push('공급유형별 자산기준이 구조화되지 않아 공고문 확인이 필요합니다.')
  }

  if (option.kind === 'remaining' && option.requires_homeless == null) warnings.push('무순위 공고별 거주지·무주택·재당첨 제한을 확인해야 합니다.')
  if (!option.requirements_complete) warnings.push('API만으로 자격요건 전체를 확인할 수 없어 공고문 확인이 필요합니다.')

  const reasons = [...failures, ...warnings]
  const verdict: Verdict = failures.length ? 'ineligible' : warnings.length ? 'review' : 'eligible'
  return { option, housingType, verdict, reasons: reasons.length ? reasons : ['구조화된 요건을 모두 충족합니다.'], sourceRef: option.source_ref }
}

export function evaluateAnnouncement(profile: Profile | null, announcement: Announcement): AnnouncementEvaluation {
  const fallbackType: HousingType = { name: '주택형 미정', area_sqm: null, households: null, price_krw: null }
  const types = announcement.housing_types.length ? announcement.housing_types : [fallbackType]
  const all = announcement.supply_options.flatMap((option) => types.map((type) => evaluateSupply(profile, announcement, option, type)))
  const best = profile === null ? all[0] ?? null : [...all].sort((a, b) => {
    const verdictDelta = verdictScore[b.verdict] - verdictScore[a.verdict]
    if (verdictDelta) return verdictDelta
    const reasonDelta = a.reasons.length - b.reasons.length
    if (reasonDelta) return reasonDelta
    return kindPriority[b.option.kind] - kindPriority[a.option.kind]
  })[0] ?? null
  return { verdict: best?.verdict ?? 'review', best, all }
}

export function getRuleVersion(): string {
  return rulesData.version
}
