import { useEffect, useMemo, useState, type FormEvent } from 'react'
import rawData from '../data/announcements.json'
import { evaluateAnnouncement, getRuleVersion } from './eligibility'
import { formatKrw, recommendation } from './recommendation'
import type { Announcement, AnnouncementData, AnnouncementEvaluation, Profile, Verdict } from './types'

const data = rawData as AnnouncementData
const STORAGE_KEY = 'cheongyak-radar-profile-v1'
const DISCLAIMER = '참고용, 최종 자격은 청약홈 공고문과 순위확인서로 확인'

const EMPTY_PROFILE: Profile = {
  birth_year: 1995,
  marital_status: 'single',
  children: 0,
  household_size: 1,
  is_household_head: true,
  homeless: true,
  residence: { sido: '경기도', sigungu: '', registered_since: '' },
  account: { type: '주택청약종합저축', rank_base_date: '', total_deposit_krw: null, deposit_count_estimate: null, verified: false },
  income: { gross_annual_krw: null, basis_verified: false },
  assets: { financial_krw: null, real_estate_krw: 0, car_value_krw: null, verified: false },
}

const verdictMeta: Record<Verdict, { icon: string; label: string; className: string }> = {
  eligible: { icon: '✓', label: '신청 가능', className: 'eligible' },
  review: { icon: '!', label: '확인 필요', className: 'review' },
  ineligible: { icon: '×', label: '불가', className: 'ineligible' },
}

function loadProfile(): Profile | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? JSON.parse(saved) as Profile : null
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
  if (!value) return '공고문 확인'
  const [, month, day] = value.split('-')
  return `${Number(month)}.${Number(day)}`
}

function priceRange(announcement: Announcement): string {
  const prices = announcement.housing_types.map((type) => type.price_krw).filter((value): value is number => value !== null)
  if (!prices.length) return '분양가 확인 필요'
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  return min === max ? formatKrw(min) : `${formatKrw(min)} ~ ${formatKrw(max)}`
}

function regionLabel(sido: string): string {
  return sido.startsWith('서울') ? '서울' : sido.startsWith('경기') ? '경기' : sido
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
      <p className="privacy-note">입력값은 이 기기의 localStorage에만 저장되며 서버·URL·분석도구로 전송하지 않습니다.</p>
      <form onSubmit={save} className="profile-form">
        <fieldset><legend>기본 조건</legend><div className="form-grid">
          <label>출생연도<input type="number" min="1900" max="2100" value={draft.birth_year} onChange={(e) => set('birth_year', Number(e.target.value))} /></label>
          <label>혼인 상태<select value={draft.marital_status} onChange={(e) => set('marital_status', e.target.value as Profile['marital_status'])}><option value="single">미혼</option><option value="married">기혼</option></select></label>
          <label>자녀 수<input type="number" min="0" value={draft.children} onChange={(e) => set('children', Number(e.target.value))} /></label>
          <label>가구원 수<input type="number" min="1" value={draft.household_size} onChange={(e) => set('household_size', Number(e.target.value))} /></label>
        </div><div className="check-row">
          <label><input type="checkbox" checked={draft.is_household_head} onChange={(e) => set('is_household_head', e.target.checked)} /> 세대주</label>
          <label><input type="checkbox" checked={draft.homeless} onChange={(e) => set('homeless', e.target.checked)} /> 무주택</label>
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

function AnnouncementCard({ announcement, evaluation }: { announcement: Announcement; evaluation: AnnouncementEvaluation }) {
  const meta = verdictMeta[evaluation.verdict]
  const lead = leadTime(announcement)
  const best = evaluation.best
  const status = statusOf(announcement)
  const oneReason = best?.reasons[0] ?? '공급유형 정보가 없습니다.'
  return <article className={`announcement-card ${meta.className} ${status === 'closed' ? 'is-closed' : ''}`}>
    <div className="card-topline"><div className="tag-row"><span className={`verdict-chip ${meta.className}`}>{meta.icon} {meta.label}</span><span className={`lead-chip ${lead.tone}`}>{lead.label}</span>{announcement.is_sample && <span className="sample-chip">샘플</span>}</div><span className="region-text">{regionLabel(announcement.region.sido)} · {announcement.region.sigungu}</span></div>
    <h3>{announcement.name}</h3>
    <p className="verdict-reason">{oneReason}</p>
    <div className="key-grid">
      <div><span>추천 경로</span><strong>{best ? `${best.option.label} · ${best.housingType.name}` : '공고문 확인'}</strong></div>
      <div><span>분양가</span><strong>{priceRange(announcement)}</strong></div>
      <div><span>접수</span><strong>{formatDate(announcement.application_start)}–{formatDate(announcement.application_end)}</strong></div>
      <div><span>발표</span><strong>{formatDate(announcement.winner_date)}</strong></div>
    </div>
    <div className="gain-row"><div><span className="mini-label">추정 시세차익</span><strong>{announcement.price_gain.status === 'estimated' && announcement.price_gain.estimated_krw !== null ? formatKrw(announcement.price_gain.estimated_krw) : '산출 불가'}</strong></div><p>{announcement.price_gain.basis}</p></div>
    <p className="recommendation">{recommendation(announcement, evaluation)}</p>
    <details className="card-details" open={evaluation.verdict !== 'ineligible' && status !== 'closed'}>
      <summary>주택형·판정 근거 자세히</summary>
      <div className="type-list">{announcement.housing_types.map((type, index) => <div key={`${type.name}-${index}`}><strong>{type.name}</strong><span>{type.area_sqm ? `${type.area_sqm}㎡` : '면적 확인'} · {type.households ?? '–'}세대 · {type.price_krw ? formatKrw(type.price_krw) : '가격 확인'}</span></div>)}</div>
      <div className="evaluation-list">{evaluation.all.map((item, index) => <div key={`${item.option.id}-${item.housingType.name}-${index}`} className={`evaluation-item ${item.verdict}`}><strong>{verdictMeta[item.verdict].icon} {item.option.label} · {item.housingType.name}</strong><ul>{item.reasons.slice(0, 4).map((reason, reasonIndex) => <li key={`${reason}-${reasonIndex}`}>{reason}</li>)}</ul><small>근거: {item.sourceRef}</small></div>)}</div>
      <div className="restriction-row"><span>전매제한 {announcement.restrictions.resale ?? '공고문 확인'}</span><span>거주의무 {announcement.restrictions.residence ?? '공고문 확인'}</span></div>
    </details>
    <div className="card-links"><a href={announcement.links.official} target="_blank" rel="noreferrer">청약홈 원문 ↗</a><a href={announcement.links.homedubu} target="_blank" rel="noreferrer">홈두부 보기 ↗</a></div>
  </article>
}

export default function App() {
  const [profile, setProfile] = useState<Profile | null>(() => loadProfile())
  const [editing, setEditing] = useState(false)
  const [verdictFilter, setVerdictFilter] = useState<'all' | Verdict>('all')
  const [regionFilter, setRegionFilter] = useState<'all' | '서울' | '경기'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'upcoming' | 'closed'>('all')

  const evaluated = useMemo(() => data.announcements.map((announcement) => ({ announcement, evaluation: evaluateAnnouncement(profile, announcement) })), [profile])
  const filtered = useMemo(() => evaluated.filter(({ announcement, evaluation }) => {
    if (verdictFilter !== 'all' && evaluation.verdict !== verdictFilter) return false
    if (regionFilter !== 'all' && regionLabel(announcement.region.sido) !== regionFilter) return false
    if (statusFilter !== 'all' && statusOf(announcement) !== statusFilter) return false
    return true
  }).sort((a, b) => {
    const aClosed = statusOf(a.announcement) === 'closed' ? 1 : 0
    const bClosed = statusOf(b.announcement) === 'closed' ? 1 : 0
    if (aClosed !== bClosed) return aClosed - bClosed
    return (a.announcement.application_start ?? '9999').localeCompare(b.announcement.application_start ?? '9999')
  }), [evaluated, verdictFilter, regionFilter, statusFilter])

  const counts = evaluated.reduce((acc, item) => ({ ...acc, [item.evaluation.verdict]: acc[item.evaluation.verdict] + 1 }), { eligible: 0, review: 0, ineligible: 0 })
  const urgent = evaluated.filter(({ announcement }) => {
    const status = statusOf(announcement)
    if (status === 'active') return true
    if (status !== 'upcoming' || !announcement.application_start) return false
    const days = dateDiff(todayKst(), announcement.application_start)
    return days >= 0 && days <= 7
  })

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

      <section className="daily-brief" aria-labelledby="brief-title">
        <div className="section-kicker">TODAY'S SIGNAL</div><h2 id="brief-title">오늘의 레이더</h2>
        <p>{urgent.length ? `${urgent.length}개 공고가 7일 안에 접수를 시작하거나 진행 중입니다. ${urgent.map((item) => item.announcement.name).slice(0, 2).join(', ')}부터 확인하세요.` : '7일 안에 시작하는 새 접수는 없습니다. 예정 공고를 차분히 검토해 보세요.'}</p>
        <div className="brief-stats"><button onClick={() => setVerdictFilter('eligible')}><span>✓</span><strong>{counts.eligible}</strong><small>신청 가능</small></button><button onClick={() => setVerdictFilter('review')}><span>!</span><strong>{counts.review}</strong><small>확인 필요</small></button><button onClick={() => setVerdictFilter('ineligible')}><span>×</span><strong>{counts.ineligible}</strong><small>불가</small></button></div>
      </section>

      <section className="profile-strip">
        <div><span>내 조건</span><strong>{profile ? `${profile.residence.sido} ${profile.residence.sigungu || '지역 미입력'} · ${profile.homeless ? '무주택' : '주택 보유'}` : '아직 입력하지 않았어요'}</strong></div>
        <div><span>청약통장</span><strong>{profile?.account.rank_base_date ? `${profile.account.rank_base_date.slice(0, 7)} 가입 · ${profile.account.deposit_count_estimate ?? '–'}회` : '입력 후 자동 판정'}</strong></div>
        <button onClick={() => setEditing(true)}>{profile ? '수정' : '입력'}</button>
      </section>

      <section className="lead-guide"><div className="section-heading"><div><p className="section-kicker">LEAD TIME</p><h2>접수까지 남은 시간</h2></div></div><div className="guide-row"><span><i className="green" />여유 · 7일 이상</span><span><i className="amber" />임박 · 7일 이내</span><span><i className="red" />하루 접수</span></div></section>

      <section className="list-section" aria-labelledby="list-title">
        <div className="section-heading"><div><p className="section-kicker">OPPORTUNITIES</p><h2 id="list-title">청약 공고</h2></div><span>{filtered.length}건</span></div>
        <div className="filter-group" aria-label="판정 필터">{([['all', '전체'], ['eligible', '✓ 가능'], ['review', '! 확인'], ['ineligible', '× 불가']] as const).map(([value, label]) => <button key={value} className={verdictFilter === value ? 'active' : ''} onClick={() => setVerdictFilter(value)}>{label}</button>)}</div>
        <div className="filter-row"><div className="filter-group compact">{(['all', '서울', '경기'] as const).map((value) => <button key={value} className={regionFilter === value ? 'active' : ''} onClick={() => setRegionFilter(value)}>{value === 'all' ? '전 지역' : value}</button>)}</div><select aria-label="진행 상태" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}><option value="all">전체 상태</option><option value="active">진행중</option><option value="upcoming">예정</option><option value="closed">마감</option></select></div>
        <div className="card-list">{filtered.map((item) => <AnnouncementCard key={item.announcement.id} {...item} />)}{!filtered.length && <div className="empty-state">선택한 조건에 맞는 공고가 없습니다.</div>}</div>
      </section>

      <section className="method-note"><p className="section-kicker">HOW IT WORKS</p><h2>판정 원칙</h2><div className="method-grid"><div><span>01</span><strong>모르면 확인 필요</strong><p>공고문 필드가 없거나 소득·자산 산정 기준이 다르면 가능으로 단정하지 않습니다.</p></div><div><span>02</span><strong>공고일 기준 계산</strong><p>통장 가입기간과 거주기간은 오늘이 아니라 각 입주자모집공고일을 기준으로 계산합니다.</p></div><div><span>03</span><strong>가격은 근거가 있을 때만</strong><p>가까운 신축의 최근 실거래가가 충분할 때만 추정하고 비교 단지와 월을 함께 표시합니다.</p></div></div></section>
    </main>

    <footer><strong>청약 레이더</strong><p>{DISCLAIMER}</p><p>개인정보는 브라우저에만 저장 · 추적 도구 없음</p>{profile && <button onClick={clearProfile}>이 기기의 내 조건 삭제</button>}</footer>
    <div className="sticky-disclaimer">{DISCLAIMER}</div>
    {editing && <ProfileEditor profile={profile} onSave={saveProfile} onClose={() => setEditing(false)} />}
  </div>
}
