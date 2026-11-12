import { useEffect, useMemo, useState, type FormEvent } from 'react'
import rawData from '../data/announcements.json'
import { evaluateAnnouncement, getRuleVersion } from './eligibility'
import { formatKrw, recommendation } from './recommendation'
import type { Announcement, AnnouncementData, AnnouncementEvaluation, PriceTypeEstimate, Profile, Verdict } from './types'

const data = rawData as AnnouncementData
const STORAGE_KEY = 'cheongyak-radar-profile-v1'
const REGION_STORAGE_KEY = 'cheongyak-radar-regions-v1'
const DISCLAIMER = '참고용, 최종 자격은 청약홈 공고문과 순위확인서로 확인'
const TRADE_API_APPLY_URL = 'https://www.data.go.kr/data/15126468/openapi.do'
const SEOUL_DISTRICTS = ['종로구', '중구', '용산구', '성동구', '광진구', '동대문구', '중랑구', '성북구', '강북구', '도봉구', '노원구', '은평구', '서대문구', '마포구', '양천구', '강서구', '구로구', '금천구', '영등포구', '동작구', '관악구', '서초구', '강남구', '송파구', '강동구']
const GYEONGGI_CITIES = ['수원시', '성남시', '의정부시', '안양시', '부천시', '광명시', '평택시', '동두천시', '안산시', '고양시', '과천시', '구리시', '남양주시', '오산시', '시흥시', '군포시', '의왕시', '하남시', '용인시', '파주시', '이천시', '안성시', '김포시', '화성시', '광주시', '양주시', '포천시', '여주시']
const REGION_OPTIONS = [...SEOUL_DISTRICTS.map((name) => `서울 ${name}`), ...GYEONGGI_CITIES.map((name) => `경기 ${name}`)]

const EMPTY_PROFILE: Profile = {
  birth_year: 1995,
  marital_status: 'single',
  children: 0,
  household_size: 1,
  is_household_head: true,
  homeless: true,
  no_win_last_5_years: null,
  never_owned_home: null,
  income_tax_paid_5_years: null,
  residence: { sido: '경기도', sigungu: '', registered_since: '' },
  account: { type: '주택청약종합저축', rank_base_date: '', total_deposit_krw: null, deposit_count_estimate: null, verified: false },
  income: { gross_annual_krw: null, basis_verified: false },
  assets: { financial_krw: null, real_estate_krw: 0, car_value_krw: null, verified: false },
}

const verdictMeta: Record<Verdict, { icon: string; label: string; className: string }> = {
  eligible: { icon: '✓', label: '신청 가능', className: 'eligible' },
  review: { icon: '!', label: '조건 보완', className: 'review' },
  ineligible: { icon: '×', label: '불가', className: 'ineligible' },
}

function normalizeProfile(parsed: Partial<Profile>): Profile {
  return {
    ...EMPTY_PROFILE,
    ...parsed,
    residence: { ...EMPTY_PROFILE.residence, ...parsed.residence },
    account: { ...EMPTY_PROFILE.account, ...parsed.account },
    income: { ...EMPTY_PROFILE.income, ...parsed.income },
    assets: { ...EMPTY_PROFILE.assets, ...parsed.assets },
  }
}

function profileFromFragment(): Profile | null {
  const encoded = new URLSearchParams(window.location.hash.slice(1)).get('profile')
  if (!encoded) return null
  try {
    const base64 = encoded.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(encoded.length / 4) * 4, '=')
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
    return normalizeProfile(JSON.parse(new TextDecoder().decode(bytes)) as Partial<Profile>)
  } catch {
    return null
  }
}

function loadProfile(): Profile | null {
  try {
    const imported = profileFromFragment()
    if (imported) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(imported))
      history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
      return imported
    }
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return null
    const parsed = JSON.parse(saved) as Partial<Profile>
    return normalizeProfile(parsed)
  } catch {
    return null
  }
}

function todayKst(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

function dateDiff(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00+09:00`) - Date.parse(`${from}T00:00:00+09:00`)) / 86_400_000)
}

function statusOf(announcement: Announcement, today = todayKst()): 'active' | 'upcoming' | 'closed' {
  const start = announcement.application_start
  const end = announcement.application_end ?? start
  if (!start || !end) return 'upcoming'
  if (today < start) return 'upcoming'
  if (today > end) return 'closed'
  return 'active'
}

function leadTime(announcement: Announcement, today = todayKst()): { tone: string; label: string } {
  const start = announcement.application_start
  const end = announcement.application_end ?? start
  if (!start || !end) return { tone: 'gray', label: '일정 확인' }
  const status = statusOf(announcement, today)
  if (status === 'closed') return { tone: 'gray', label: `마감 D+${Math.abs(dateDiff(end, today))}` }
  if (start === end) {
    const days = dateDiff(today, start)
    return { tone: 'red', label: days === 0 ? '당일 마감' : `하루 접수 D-${days}` }
  }
  if (status === 'active') return { tone: 'amber', label: `접수 중 · ${dateDiff(today, end) === 0 ? '오늘 마감' : `마감 D-${dateDiff(today, end)}`}` }
  const days = dateDiff(today, start)
  return days <= 7 ? { tone: 'amber', label: `임박 · D-${days}` } : { tone: 'green', label: `여유 · D-${days}` }
}

function formatDate(value: string | null): string {
  if (!value) return '일정 미제공'
  const [, month, day] = value.split('-')
  return `${Number(month)}.${Number(day)}`
}

function priceRange(announcement: Announcement): string {
  const prices = announcement.housing_types.map((type) => type.price_krw).filter((value): value is number => value !== null)
  if (!prices.length) return '분양가 미제공'
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  return min === max ? formatKrw(min) : `${formatKrw(min)} ~ ${formatKrw(max)}`
}

function regionLabel(sido: string): string {
  return sido.startsWith('서울') ? '서울' : sido.startsWith('경기') ? '경기' : sido
}

function specificRegionLabel(announcement: Announcement): string {
  const prefix = regionLabel(announcement.region.sido)
  const normalized = announcement.region.sigungu.replace('특례시', '시')
  return `${prefix} ${normalized}`
}

function loadSelectedRegions(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(REGION_STORAGE_KEY) ?? '[]')
    return Array.isArray(saved) ? saved.filter((item): item is string => typeof item === 'string') : []
  } catch { return [] }
}

function estimateFor(evaluation: AnnouncementEvaluation, announcement: Announcement): PriceTypeEstimate | null {
  const estimates = announcement.price_gain.by_type ?? []
  if (!estimates.length) return null
  return estimates.find((item) => item.housing_type === evaluation.best?.housingType.name) ?? null
}

function confidenceLabel(value: PriceTypeEstimate['confidence']): string {
  return value === 'high' ? '높음' : value === 'medium' ? '보통' : '낮음'
}

function ProfileEditor({ profile, onSave, onClose }: { profile: Profile | null; onSave: (profile: Profile) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<Profile>(() => structuredClone(profile ?? EMPTY_PROFILE))
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState('')
  const set = <K extends keyof Profile>(key: K, value: Profile[K]) => setDraft((current) => ({ ...current, [key]: value }))

  const save = (event: FormEvent) => {
    event.preventDefault()
    onSave(draft)
  }
  const applyJson = () => {
    try {
      const parsed = JSON.parse(jsonText) as Partial<Profile> & {
        income?: Partial<Profile['income']> & { gross_2025_krw?: number }
      }
      if (!parsed.birth_year || !parsed.residence || !parsed.account) throw new Error('필수 필드가 없습니다.')
      setDraft({
        ...EMPTY_PROFILE,
        ...parsed,
        residence: { ...EMPTY_PROFILE.residence, ...parsed.residence },
        account: { ...EMPTY_PROFILE.account, ...parsed.account, verified: parsed.account.verified ?? false },
        income: {
          ...EMPTY_PROFILE.income,
          ...parsed.income,
          gross_annual_krw: parsed.income?.gross_annual_krw ?? parsed.income?.gross_2025_krw ?? null,
          basis_verified: parsed.income?.basis_verified ?? false,
        },
        assets: { ...EMPTY_PROFILE.assets, ...parsed.assets, verified: parsed.assets?.verified ?? false },
      })
      setJsonError('')
    } catch {
      setJsonError('JSON 형식을 확인해 주세요. profile.example.json 구조를 사용할 수 있습니다.')
    }
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="profile-sheet" role="dialog" aria-modal="true" aria-labelledby="profile-title">
      <header className="sheet-header">
        <div><p className="eyebrow">브라우저에만 저장</p><h2 id="profile-title">내 조건</h2></div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="닫기">×</button>
      </header>
      <p className="privacy-note">입력값은 이 기기의 localStorage에만 저장되며 서버·분석도구로 전송하지 않습니다.</p>
      <form onSubmit={save} className="profile-form">
        <fieldset><legend>기본 조건</legend><div className="form-grid">
          <label>출생연도<input type="number" min="1900" max="2100" value={draft.birth_year} onChange={(e) => set('birth_year', Number(e.target.value))} /></label>
          <label>혼인 상태<select value={draft.marital_status} onChange={(e) => set('marital_status', e.target.value as Profile['marital_status'])}><option value="single">미혼</option><option value="married">기혼</option></select></label>
          <label>자녀 수<input type="number" min="0" value={draft.children} onChange={(e) => set('children', Number(e.target.value))} /></label>
          <label>가구원 수<input type="number" min="1" value={draft.household_size} onChange={(e) => set('household_size', Number(e.target.value))} /></label>
        </div><div className="check-row">
          <label><input type="checkbox" checked={draft.is_household_head} onChange={(e) => set('is_household_head', e.target.checked)} /> 세대주</label>
          <label><input type="checkbox" checked={draft.homeless} onChange={(e) => set('homeless', e.target.checked)} /> 무주택</label>
        </div><div className="form-grid history-grid">
          <label>최근 5년 세대원 당첨이력<select value={draft.no_win_last_5_years === null ? 'unknown' : draft.no_win_last_5_years ? 'none' : 'has'} onChange={(e) => set('no_win_last_5_years', e.target.value === 'unknown' ? null : e.target.value === 'none')}><option value="unknown">모름</option><option value="none">없음</option><option value="has">있음</option></select></label>
          <label>본인·세대원 과거 주택소유<select value={draft.never_owned_home === null ? 'unknown' : draft.never_owned_home ? 'none' : 'has'} onChange={(e) => set('never_owned_home', e.target.value === 'unknown' ? null : e.target.value === 'none')}><option value="unknown">모름</option><option value="none">없음</option><option value="has">있음</option></select></label>
          <label className="span-2">최근 5개년도 소득세 납부<select value={draft.income_tax_paid_5_years === null ? 'unknown' : draft.income_tax_paid_5_years ? 'yes' : 'no'} onChange={(e) => set('income_tax_paid_5_years', e.target.value === 'unknown' ? null : e.target.value === 'yes')}><option value="unknown">모름</option><option value="yes">충족</option><option value="no">미충족</option></select></label>
        </div></fieldset>

        <fieldset><legend>거주지</legend><div className="form-grid">
          <label>시·도<select value={draft.residence.sido} onChange={(e) => set('residence', { ...draft.residence, sido: e.target.value })}><option>경기도</option><option>서울특별시</option><option>인천광역시</option></select></label>
          <label>시·군·구<input value={draft.residence.sigungu} placeholder="예: 수원시" onChange={(e) => set('residence', { ...draft.residence, sigungu: e.target.value })} /></label>
          <label className="span-2">전입 기준월<input type="month" value={draft.residence.registered_since} onChange={(e) => set('residence', { ...draft.residence, registered_since: e.target.value })} /></label>
        </div></fieldset>

        <fieldset><legend>청약통장</legend><div className="form-grid">
          <label className="span-2">통장 종류<input value={draft.account.type} onChange={(e) => set('account', { ...draft.account, type: e.target.value })} /></label>
          <label>가입 기준일<input type="date" value={draft.account.rank_base_date} onChange={(e) => set('account', { ...draft.account, rank_base_date: e.target.value })} /></label>
          <label>예상 납입횟수<input type="number" min="0" value={draft.account.deposit_count_estimate ?? ''} onChange={(e) => set('account', { ...draft.account, deposit_count_estimate: e.target.value ? Number(e.target.value) : null })} /></label>
          <label>총 납입액(원)<input type="number" min="0" value={draft.account.total_deposit_krw ?? ''} onChange={(e) => set('account', { ...draft.account, total_deposit_krw: e.target.value ? Number(e.target.value) : null })} /></label>
          <label className="checkbox-label"><input type="checkbox" checked={draft.account.verified} onChange={(e) => set('account', { ...draft.account, verified: e.target.checked })} /> 순위확인서로 검증함</label>
        </div></fieldset>

        <fieldset><legend>소득·자산</legend><div className="form-grid">
          <label>연간 총소득(원)<input type="number" min="0" value={draft.income.gross_annual_krw ?? ''} onChange={(e) => set('income', { ...draft.income, gross_annual_krw: e.target.value ? Number(e.target.value) : null })} /></label>
          <label>금융자산(원)<input type="number" min="0" value={draft.assets.financial_krw ?? ''} onChange={(e) => set('assets', { ...draft.assets, financial_krw: e.target.value ? Number(e.target.value) : null })} /></label>
          <label>부동산자산(원)<input type="number" min="0" value={draft.assets.real_estate_krw ?? ''} onChange={(e) => set('assets', { ...draft.assets, real_estate_krw: e.target.value ? Number(e.target.value) : null })} /></label>
          <label>자동차가액(원)<input type="number" min="0" value={draft.assets.car_value_krw ?? ''} onChange={(e) => set('assets', { ...draft.assets, car_value_krw: e.target.value ? Number(e.target.value) : null })} /></label>
        </div><div className="check-row">
          <label><input type="checkbox" checked={draft.income.basis_verified} onChange={(e) => set('income', { ...draft.income, basis_verified: e.target.checked })} /> 공고문 방식으로 소득 검증</label>
          <label><input type="checkbox" checked={draft.assets.verified} onChange={(e) => set('assets', { ...draft.assets, verified: e.target.checked })} /> 자산 검증</label>
        </div></fieldset>

        <details className="json-import"><summary>JSON으로 한 번에 입력</summary><textarea value={jsonText} onChange={(e) => setJsonText(e.target.value)} placeholder="profile.example.json 구조의 JSON을 붙여넣으세요." /><button type="button" className="secondary-button" onClick={applyJson}>JSON 적용</button>{jsonError && <p className="field-error">{jsonError}</p>}</details>
        <button className="primary-button full" type="submit">이 기기에 저장하고 다시 계산</button>
      </form>
    </section>
  </div>
}

function RegionPicker({ options, selected, onChange }: { options: string[]; selected: string[]; onChange: (next: string[]) => void }) {
  const toggle = (region: string) => onChange(selected.includes(region) ? selected.filter((item) => item !== region) : [...selected, region])
  const groups = [
    ['서울', options.filter((item) => item.startsWith('서울 '))],
    ['경기', options.filter((item) => item.startsWith('경기 '))],
  ] as const
  return <details className="region-picker">
    <summary><span><strong>관심 지역</strong><small>여러 곳 선택 가능 · 이 기기에 기억</small></span><b>{selected.length ? `${selected.length}곳` : '전체'}</b></summary>
    <div className="region-picker-body">
      <button type="button" className={!selected.length ? 'active' : ''} onClick={() => onChange([])}>전체 지역</button>
      {groups.map(([label, regions]) => <div className="region-group" key={label}><span>{label}</span><div>{regions.map((region) => <button type="button" key={region} className={selected.includes(region) ? 'active' : ''} onClick={() => toggle(region)}>{region.replace(`${label} `, '')}</button>)}</div></div>)}
    </div>
  </details>
}

function AnnouncementCard({ announcement, evaluation, profile }: { announcement: Announcement; evaluation: AnnouncementEvaluation; profile: Profile | null }) {
  const meta = verdictMeta[evaluation.verdict]
  const lead = leadTime(announcement)
  const best = evaluation.best
  const visibleEvaluations = evaluation.all.filter((item) => item.verdict !== 'ineligible')
  const hiddenEvaluationCount = evaluation.all.length - visibleEvaluations.length
  const status = statusOf(announcement)
  const oneReason = best?.reasons[0] ?? '공급유형 정보가 없습니다.'
  const estimate = estimateFor(evaluation, announcement)
  const policyTags = [
    announcement.policy?.regulated ? '규제지역' : null,
    announcement.policy?.price_cap ? '분양가상한제' : null,
    announcement.policy?.public_land ? '공공주택지구' : null,
  ].filter((item): item is string => Boolean(item))
  const noticeFacts = announcement.notice_analysis?.facts ?? {}
  const categoryLabel = announcement.housing_category === 'remaining' ? '무순위·잔여세대' : '일반·특별공급'
  const visibleFact = (value: string | null | undefined) => value || '미표기'
  return <article className={`announcement-card ${meta.className} ${status === 'closed' ? 'is-closed' : ''}`}>
    <div className="card-topline"><div className="tag-row"><span className={`verdict-chip ${meta.className}`}>{meta.icon} {meta.label}</span><span className={`supply-chip ${announcement.housing_category === 'remaining' ? 'remaining' : ''}`}>{categoryLabel}</span><span className={`lead-chip ${lead.tone}`}>{lead.label}</span>{announcement.is_sample && <span className="sample-chip">샘플</span>}</div><span className="region-text">{regionLabel(announcement.region.sido)} · {announcement.region.sigungu}</span></div>
    <h3>{announcement.name}</h3>
    <p className="verdict-reason">{oneReason}</p>
    {policyTags.length > 0 && <div className="fact-chips">{policyTags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
    <div className="key-grid">
      <div><span>분양가</span><strong>{priceRange(announcement)}</strong></div>
      <div><span>계약금</span><strong>{visibleFact(noticeFacts.contract_deposit)}</strong></div>
      <div><span>전매제한</span><strong>{visibleFact(announcement.restrictions.resale)}</strong></div>
      <div><span>거주의무</span><strong>{visibleFact(announcement.restrictions.residence)}</strong></div>
      <div><span>재당첨 제한</span><strong>{visibleFact(noticeFacts.rewinning)}</strong></div>
      <div><span>접수</span><strong>{formatDate(announcement.application_start)}–{formatDate(announcement.application_end)}</strong></div>
      <div><span>발표</span><strong>{formatDate(announcement.winner_date)}</strong></div>
      <div><span>입주예정</span><strong>{announcement.move_in_month || '미표기'}</strong></div>
      <div className="key-wide"><span>내 추천 경로</span><strong>{best ? `${best.option.label} · ${best.housingType.name}` : '공급유형 미제공'}</strong></div>
    </div>
    {estimate && <div className="gain-row"><div><span className="mini-label">현실화 시세차익 · {estimate.housing_type}</span><strong>{formatKrw(estimate.gain_low_krw)} ~ {formatKrw(estimate.gain_high_krw)}</strong></div><p>기준 {formatKrw(estimate.gain_base_krw)} · 예상 시세 {formatKrw(estimate.market_base_krw)} · 신뢰도 {confidenceLabel(estimate.confidence)}</p><details className="comparable-details"><summary>비교 근거 {estimate.complex_count}개 단지</summary><p>{announcement.price_gain.basis}</p><ul>{estimate.comparables.map((item) => <li key={`${item.name}-${item.month}`}><strong>{item.name}</strong><span>{item.legal_dong ? `${item.legal_dong} · ` : ''}{item.build_year ? `${item.build_year}년 · ` : ''}{item.area_sqm}㎡ · {item.month} · {formatKrw(item.price_krw)}</span></li>)}</ul></details></div>}
    <p className="recommendation">{recommendation(announcement, evaluation, profile)}</p>
    <details className="card-details" open={evaluation.verdict !== 'ineligible' && status !== 'closed'}>
      <summary>주택형·판정 근거 자세히</summary>
      <div className="type-list">{announcement.housing_types.map((type, index) => <div key={`${type.name}-${index}`}><strong>{type.name}</strong><span>{type.area_sqm ? `${type.area_sqm}㎡` : '면적 확인'} · {type.households ?? '–'}세대 · {type.price_krw ? formatKrw(type.price_krw) : '가격 확인'}</span></div>)}</div>
      <div className="evaluation-list">{visibleEvaluations.map((item, index) => <div key={`${item.option.id}-${item.housingType.name}-${index}`} className={`evaluation-item ${item.verdict}`}><strong>{verdictMeta[item.verdict].icon} {item.option.label} · {item.housingType.name}</strong><ul>{item.reasons.slice(0, 4).map((reason, reasonIndex) => <li key={`${reason}-${reasonIndex}`}>{reason}</li>)}</ul><small>근거: {item.sourceRef}</small></div>)}</div>
      {hiddenEvaluationCount > 0 && <p className="hidden-option-note">입력 조건상 불가능한 공급유형 {hiddenEvaluationCount}개는 숨겼습니다.</p>}
      {(announcement.restrictions.resale || announcement.restrictions.residence || noticeFacts.priority_residence) && <div className="restriction-row">{announcement.restrictions.resale && <span>전매제한 {announcement.restrictions.resale}</span>}{announcement.restrictions.residence && <span>거주의무 {announcement.restrictions.residence}</span>}{noticeFacts.priority_residence && <span>지역우선 {noticeFacts.priority_residence}</span>}</div>}
    </details>
    <div className="card-links"><a href={announcement.notice_analysis?.source_url ?? announcement.links.official} target="_blank" rel="noreferrer">공식 공고 원문 ↗</a>{announcement.links.homepage && <a href={announcement.links.homepage} target="_blank" rel="noreferrer">분양 홈페이지 ↗</a>}<a href={announcement.links.homedubu} target="_blank" rel="noreferrer">홈두부 참고 ↗</a></div>
  </article>
}

export default function App() {
  const [profile, setProfile] = useState<Profile | null>(() => loadProfile())
  const [editing, setEditing] = useState(false)
  const [verdictFilter, setVerdictFilter] = useState<'all' | 'eligible' | 'review'>('all')
  const [selectedRegions, setSelectedRegions] = useState<string[]>(() => loadSelectedRegions())
  const [opportunityFilter, setOpportunityFilter] = useState<'open' | 'remaining' | 'upcoming' | 'active'>('open')

  const evaluated = useMemo(() => data.announcements.map((announcement) => ({ announcement, evaluation: evaluateAnnouncement(profile, announcement) })), [profile])
  const scoped = useMemo(() => selectedRegions.length ? evaluated.filter(({ announcement }) => selectedRegions.includes(specificRegionLabel(announcement))) : evaluated, [evaluated, selectedRegions])
  const filtered = useMemo(() => evaluated.filter(({ announcement, evaluation }) => {
    if (profile && evaluation.verdict === 'ineligible') return false
    if (verdictFilter !== 'all' && evaluation.verdict !== verdictFilter) return false
    if (selectedRegions.length && !selectedRegions.includes(specificRegionLabel(announcement))) return false
    const status = statusOf(announcement)
    if (opportunityFilter === 'open' && status === 'closed') return false
    if (opportunityFilter === 'remaining' && (announcement.housing_category !== 'remaining' || status === 'closed')) return false
    if (opportunityFilter === 'upcoming' && status !== 'upcoming') return false
    if (opportunityFilter === 'active' && status !== 'active') return false
    return true
  }).sort((a, b) => {
    const aClosed = statusOf(a.announcement) === 'closed' ? 1 : 0
    const bClosed = statusOf(b.announcement) === 'closed' ? 1 : 0
    if (aClosed !== bClosed) return aClosed - bClosed
    return (a.announcement.application_start ?? '9999').localeCompare(b.announcement.application_start ?? '9999')
  }), [evaluated, profile, verdictFilter, selectedRegions, opportunityFilter])

  const counts = scoped.reduce((acc, item) => ({ ...acc, [item.evaluation.verdict]: acc[item.evaluation.verdict] + 1 }), { eligible: 0, review: 0, ineligible: 0 })
  const categoryCounts = scoped.filter((item) => !profile || item.evaluation.verdict !== 'ineligible').reduce((acc, { announcement }) => {
    const status = statusOf(announcement)
    if (status !== 'closed') acc.open += 1
    if (status !== 'closed' && announcement.housing_category === 'remaining') acc.remaining += 1
    if (status === 'upcoming') acc.upcoming += 1
    if (status === 'active') acc.active += 1
    return acc
  }, { open: 0, remaining: 0, upcoming: 0, active: 0 })
  const urgent = scoped.filter(({ announcement }) => {
    const status = statusOf(announcement)
    if (status === 'active') return true
    if (status !== 'upcoming' || !announcement.application_start) return false
    const days = dateDiff(todayKst(), announcement.application_start)
    return days >= 0 && days <= 7
  })
  const tradeApiAccessMissing = data.announcements.length > 0 && data.announcements.every((announcement) => announcement.price_gain.basis.includes('HTTP 403'))

  const saveProfile = (next: Profile) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    setProfile(next)
    setEditing(false)
  }
  const clearProfile = () => {
    localStorage.removeItem(STORAGE_KEY)
    setProfile(null)
    setEditing(false)
  }
  const saveRegions = (next: string[]) => {
    localStorage.setItem(REGION_STORAGE_KEY, JSON.stringify(next))
    setSelectedRegions(next)
  }

  useEffect(() => { document.documentElement.lang = 'ko' }, [])

  return <div className="app-shell">
    <header className="hero">
      <div className="topbar"><div className="brand-mark" aria-hidden="true"><span /></div><button className="profile-button" onClick={() => setEditing(true)}>{profile ? '내 조건 수정' : '내 조건 입력'} <span>→</span></button></div>
      <div className="hero-title"><div><p className="eyebrow">SEOUL · GYEONGGI</p><h1>청약<br />레이더</h1></div><div className="radar-art" aria-hidden="true"><i /><i /><i /><span /></div></div>
      <p className="hero-copy">공고는 빠르게, 자격은 보수적으로.<br />내가 실제로 넣어볼 청약만 먼저 봅니다.</p>
      <div className="update-row"><span className="live-dot" />마지막 갱신 {new Date(data.metadata.generated_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}<span>규칙 {getRuleVersion()}</span></div>
    </header>

    <main>
      {data.metadata.is_sample && <section className="notice sample-notice"><strong>지금은 안전한 샘플 데이터입니다.</strong><span>API 키를 설정하고 자동 갱신을 실행하면 실제 서울·경기 공고로 교체됩니다. 샘플에는 실제 단지명·가격을 넣지 않았습니다.</span></section>}
      {data.metadata.last_fetch_error && <section className="notice error-notice"><strong>최근 자동 갱신에 실패했습니다.</strong><span>이전 정상 데이터를 유지합니다. {data.metadata.last_fetch_error}</span></section>}
      {tradeApiAccessMissing && <section className="notice error-notice"><strong>실거래가 API 권한이 아직 없습니다.</strong><span><a href={TRADE_API_APPLY_URL} target="_blank" rel="noreferrer">공공데이터포털에서 활용신청</a>하면 다음 자동 갱신부터 추정 시세차익을 계산합니다.</span></section>}

      <section className="daily-brief" aria-labelledby="brief-title">
        <div className="section-kicker">TODAY'S SIGNAL</div><h2 id="brief-title">오늘의 레이더</h2>
        <p>{urgent.length ? `${urgent.length}개 공고가 7일 안에 접수를 시작하거나 진행 중입니다. ${urgent.map((item) => item.announcement.name).slice(0, 2).join(', ')}부터 확인하세요.` : '7일 안에 시작하는 새 접수는 없습니다. 예정 공고를 차분히 검토해 보세요.'}</p>
        <div className="brief-stats"><button onClick={() => setVerdictFilter('eligible')}><span>✓</span><strong>{counts.eligible}</strong><small>신청 가능</small></button><button onClick={() => setVerdictFilter('review')}><span>!</span><strong>{counts.review}</strong><small>조건 보완</small></button></div>
      </section>

      <section className="profile-strip">
        <div><span>내 조건</span><strong>{profile ? `${profile.residence.sido} ${profile.residence.sigungu || '지역 미입력'} · ${profile.homeless ? '무주택' : '주택 보유'}` : '아직 입력하지 않았어요'}</strong></div>
        <div><span>청약통장</span><strong>{profile?.account.rank_base_date ? `${profile.account.rank_base_date.slice(0, 7)} 가입 · ${profile.account.deposit_count_estimate ?? '–'}회` : '입력 후 자동 판정'}</strong></div>
        <button onClick={() => setEditing(true)}>{profile ? '수정' : '입력'}</button>
      </section>

      <RegionPicker options={REGION_OPTIONS} selected={selectedRegions} onChange={saveRegions} />

      <section className="lead-guide"><div className="section-heading"><div><p className="section-kicker">LEAD TIME</p><h2>접수까지 남은 시간</h2></div></div><div className="guide-row"><span><i className="green" />여유 · 7일 이상</span><span><i className="amber" />임박 · 7일 이내</span><span><i className="red" />하루 접수</span></div></section>

      <section className="list-section" aria-labelledby="list-title">
        <div className="section-heading"><div><p className="section-kicker">OPPORTUNITIES</p><h2 id="list-title">청약 공고</h2></div><span>{filtered.length}건</span></div>
        <nav className="opportunity-tabs" aria-label="공고 종류">{([
          ['open', '추천 공고', categoryCounts.open],
          ['remaining', '무순위·잔여', categoryCounts.remaining],
          ['upcoming', '다가오는 공고', categoryCounts.upcoming],
          ['active', '접수 중', categoryCounts.active],
        ] as const).map(([value, label, count]) => <button key={value} className={opportunityFilter === value ? 'active' : ''} onClick={() => setOpportunityFilter(value)}><strong>{count}</strong><span>{label}</span></button>)}</nav>
        <div className="filter-group" aria-label="판정 필터">{([['all', '추천만'], ['eligible', '✓ 가능'], ['review', '! 보완']] as const).map(([value, label]) => <button key={value} className={verdictFilter === value ? 'active' : ''} onClick={() => setVerdictFilter(value)}>{label}</button>)}</div>
        <div className="filter-row"><span className="selected-region-summary">{selectedRegions.length ? selectedRegions.join(' · ') : '서울·경기 전체'}</span></div>
        <div className="card-list">{filtered.map((item) => <AnnouncementCard key={item.announcement.id} {...item} profile={profile} />)}{!filtered.length && <div className="empty-state">선택한 조건에 맞는 공고가 없습니다.</div>}</div>
      </section>

      <section className="method-note"><p className="section-kicker">HOW IT WORKS</p><h2>판정 원칙</h2><div className="method-grid"><div><span>01</span><strong>공식 공고 자동분석</strong><p>청약홈 정보와 공식 분양 홈페이지의 모집공고를 읽어 제한사항과 납부 일정을 카드에 반영합니다.</p></div><div><span>02</span><strong>내 조건 자동 대조</strong><p>공고일 기준 통장·거주·무주택 조건을 계산하고, 부족한 입력이 있으면 그 항목만 정확히 알려줍니다.</p></div><div><span>03</span><strong>동·준신축 단지 비교</strong><p>같은 동을 우선해 유사면적·준신축·3층 이상 실거래를 단지별로 균형 있게 비교합니다.</p></div></div></section>
    </main>

    <footer><strong>청약 레이더</strong><p>{DISCLAIMER}</p><p>개인정보는 브라우저에만 저장 · 추적 도구 없음</p>{profile && <button onClick={clearProfile}>이 기기의 내 조건 삭제</button>}</footer>
    <div className="sticky-disclaimer">{DISCLAIMER}</div>
    {editing && <ProfileEditor profile={profile} onSave={saveProfile} onClose={() => setEditing(false)} />}
  </div>
}
