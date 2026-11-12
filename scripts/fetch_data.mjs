import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataPath = path.join(root, 'data', 'announcements.json')
const cacheDir = path.join(root, '.cache', 'applyhome')
const key = process.env.DATA_GO_KR_KEY
const base = 'https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1'

if (!key) {
  console.error('DATA_GO_KR_KEY가 없습니다. 공공데이터포털 Decoding 인증키를 환경변수 또는 GitHub Secret으로 설정하세요.')
  process.exit(1)
}

const kstNow = () => new Date(Date.now() + 9 * 3_600_000)
const isoKst = () => `${kstNow().toISOString().slice(0, 19)}+09:00`
const dateOnly = (date) => date.toISOString().slice(0, 10)
const clean = (value) => value === undefined || value === null || value === '' ? null : String(value).trim()
const number = (value) => value === undefined || value === null || value === '' || Number.isNaN(Number(String(value).replaceAll(',', ''))) ? null : Number(String(value).replaceAll(',', ''))
const date = (value) => clean(value)?.replaceAll('.', '-').slice(0, 10) ?? null
const booleanFlag = (...values) => {
  const known = values.map(clean).filter((value) => value === 'Y' || value === 'N')
  return known.length ? known.includes('Y') : null
}

async function readExisting() {
  try { return JSON.parse(await fs.readFile(dataPath, 'utf8')) } catch { return null }
}

async function cachedFetch(operation, params, cacheKey, maxAgeMs = 6 * 3_600_000) {
  await fs.mkdir(cacheDir, { recursive: true })
  const cachePath = path.join(cacheDir, `${cacheKey}.json`)
  try {
    const stat = await fs.stat(cachePath)
    if (Date.now() - stat.mtimeMs < maxAgeMs) return JSON.parse(await fs.readFile(cachePath, 'utf8'))
  } catch {}

  const url = new URL(`${base}/${operation}`)
  Object.entries({ ...params, serviceKey: key }).forEach(([name, value]) => url.searchParams.set(name, String(value)))
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`${operation} HTTP ${response.status}`)
  const body = await response.json()
  if (!Array.isArray(body.data)) throw new Error(`${operation} 응답에 data 배열이 없습니다.`)
  await fs.writeFile(cachePath, `${JSON.stringify(body)}\n`)
  return body
}

async function fetchAll(operation, fromDate) {
  const result = []
  let page = 1
  while (true) {
    const body = await cachedFetch(operation, { page, perPage: 100, returnType: 'JSON', 'cond[RCRIT_PBLANC_DE::GTE]': fromDate }, `${operation}-${fromDate}-${page}`)
    result.push(...body.data)
    if (result.length >= Number(body.totalCount ?? result.length) || !body.data.length) break
    page += 1
    if (page > 100) throw new Error(`${operation} 페이지 수가 안전 한도(100)를 넘었습니다.`)
  }
  return result
}

async function fetchModels(operation, row) {
  const house = clean(row.HOUSE_MANAGE_NO)
  const notice = clean(row.PBLANC_NO)
  if (!house || !notice) return []
  const body = await cachedFetch(operation, { page: 1, perPage: 100, returnType: 'JSON', 'cond[HOUSE_MANAGE_NO::EQ]': house, 'cond[PBLANC_NO::EQ]': notice }, `${operation}-${house}-${notice}`)
  return body.data
}

function parseRegion(row) {
  const address = clean(row.HSSPLY_ADRES) ?? clean(row.HOUSE_NM) ?? ''
  const areaName = clean(row.SUBSCRPT_AREA_CODE_NM) ?? ''
  const sido = areaName.includes('서울') ? '서울특별시' : areaName.includes('경기') ? '경기도' : /^(서울특별시|서울시)/.test(address) ? '서울특별시' : /^(경기도|경기)/.test(address) ? '경기도' : ''
  const sigungu = address.match(/^(?:서울특별시|서울시|경기도|경기)\s+([^\s]+(?:시|군|구|특례시))/)?.[1] ?? address.match(/([^\s]+(?:시|군|구|특례시))/)?.[1] ?? ''
  return { sido, sigungu, address }
}

function normalizeModel(row) {
  const amountManwon = number(row.LTTOT_TOP_AMOUNT ?? row.SUPLY_AMOUNT ?? row.LTTOT_AMOUNT)
  const rawType = clean(row.HOUSE_TY ?? row.MODEL_NM ?? row.HOUSE_MODEL_NO) ?? '주택형 확인'
  const exclusiveArea = number(row.EXCLUSE_AR) ?? number(rawType.match(/^\d+(?:\.\d+)?/)?.[0])
  const typeSuffix = rawType.match(/[A-Za-z]+$/)?.[0] ?? ''
  const displayType = exclusiveArea === null ? rawType : `${Math.floor(exclusiveArea)}${typeSuffix}`
  return {
    name: displayType,
    area_sqm: exclusiveArea,
    households: number(row.GNRL_HSHLDCO ?? row.SUPLY_HSHLDCO) ?? 0,
    price_krw: amountManwon === null ? null : amountManwon * 10_000,
    special_counts: {
      first_home: number(row.LFE_FRST_HSHLDCO ?? row.SPSPLY_LFE_FRST_HSHLDCO) ?? 0,
      newlywed: number(row.NWWDS_HSHLDCO ?? row.SPSPLY_NEW_MRRG_HSHLDCO) ?? 0,
      multi_child: number(row.MNYCH_HSHLDCO ?? row.SPSPLY_MNY_CHLD_HSHLDCO) ?? 0,
      newborn: number(row.NWBB_HSHLDCO ?? row.SPSPLY_NWBB_HSHLDCO) ?? 0,
      elderly_parent: number(row.OLD_PARNTS_SUPORT_HSHLDCO ?? row.SPSPLY_OLD_PARNTS_SUPORT_HSHLDCO) ?? 0,
    }
  }
}

function supplyOptions(models, remaining, category, row) {
  if (remaining) {
    const cancelledContract = clean(row.HOUSE_SECD) === '06'
    return [{
      id: 'remaining', label: cancelledContract ? '계약취소주택 재공급' : '무순위·잔여세대', kind: 'remaining',
      min_age: 19, requires_homeless: true, requirements_complete: !cancelledContract,
      source_ref: cancelledContract ? '주택공급에 관한 규칙 및 원 공급유형 자격' : '주택공급에 관한 규칙 제26조제5항',
    }]
  }
  const options = [{
    id: 'general-first', label: '일반공급 1순위', kind: 'general_first', min_account_months: 12,
    min_deposit_count: category === 'national' ? 12 : undefined, requires_homeless: category === 'national' ? true : null,
    requirements_complete: true, source_ref: `주택공급에 관한 규칙 ${category === 'national' ? '제27조' : '제28조'} 및 별표 2`,
  }]
  const totals = models.reduce((sum, model) => Object.fromEntries(Object.keys(sum).map((keyName) => [keyName, sum[keyName] + model.special_counts[keyName]])), { first_home: 0, newlywed: 0, multi_child: 0, newborn: 0, elderly_parent: 0 })
  const definitions = [
    ['first_home', '생애최초 특별공급', 'special_first_home'], ['newlywed', '신혼부부 특별공급', 'special_newlywed'],
    ['multi_child', '다자녀 특별공급', 'special_multi_child'], ['newborn', '신생아 특별공급', 'special_newborn'],
    ['elderly_parent', '노부모부양 특별공급', 'special_elderly_parent'],
  ]
  for (const [id, label, kind] of definitions) if (totals[id] > 0) options.push({ id, label, kind, requires_homeless: true, requirements_complete: false, source_ref: '주택공급에 관한 규칙 및 해당 입주자모집공고문' })
  return options
}

function normalize(row, modelsRaw, remaining, previous) {
  const region = parseRegion(row)
  const models = modelsRaw.map(normalizeModel)
  const detailName = `${clean(row.HOUSE_SECD_NM) ?? ''} ${clean(row.HOUSE_DTL_SECD_NM) ?? ''}`
  const category = remaining ? 'remaining' : /국민|공공/.test(detailName) ? 'national' : /민영/.test(detailName) ? 'private' : 'unknown'
  const notice = clean(row.PBLANC_NO) ?? clean(row.HOUSE_MANAGE_NO) ?? crypto.randomUUID()
  const prior = previous?.announcements?.find((item) => item.notice_number === notice)
  return {
    id: notice,
    notice_number: notice,
    name: clean(row.HOUSE_NM) ?? '단지명 확인',
    is_sample: false,
    region,
    lawd_code: null,
    total_households: number(row.TOT_SUPLY_HSHLDCO ?? row.SUPLY_HSHLDCO),
    housing_category: category,
    announcement_date: date(row.RCRIT_PBLANC_DE) ?? dateOnly(kstNow()),
    application_start: date(row.RCEPT_BGNDE ?? row.SUBSCRPT_RCEPT_BGNDE ?? row.SPSPLY_RCEPT_BGNDE ?? row.GNRL_RNK1_CRSPAREA_RCPTDE),
    application_end: date(row.RCEPT_ENDDE ?? row.SUBSCRPT_RCEPT_ENDDE ?? row.SPSPLY_RCEPT_ENDDE ?? row.GNRL_RNK2_CRSPAREA_ENDDE ?? row.GNRL_RNK2_CRSPAREA_RCPTDE ?? row.GNRL_RNK1_ETC_AREA_ENDDE ?? row.GNRL_RNK1_ETC_AREA_RCPTDE),
    winner_date: date(row.PRZWNER_PRESNATN_DE),
    contract_start: date(row.CNTRCT_CNCLS_BGNDE),
    contract_end: date(row.CNTRCT_CNCLS_ENDDE),
    move_in_month: clean(row.MVN_PREARNGE_YM),
    links: {
      official: clean(row.PBLANC_URL) ?? clean(row.HMPG_ADRES) ?? 'https://www.applyhome.co.kr/',
      homepage: clean(row.HMPG_ADRES),
      homedubu: 'https://homedubu.com/',
    },
    policy: {
      regulated: remaining ? null : booleanFlag(row.SPECLT_RDN_EARTH_AT, row.MDAT_TRGET_AREA_SECD),
      price_cap: remaining ? null : booleanFlag(row.PARCPRC_ULS_AT),
      public_land: remaining ? null : booleanFlag(row.PUBLIC_HOUSE_EARTH_AT),
      large_land: remaining ? null : booleanFlag(row.LRSCL_BLDLND_AT),
    },
    housing_types: models.map(({ special_counts, ...model }) => model),
    supply_options: supplyOptions(models, remaining, category, row),
    notice_analysis: prior?.notice_analysis,
    price_gain: prior?.price_gain ?? { status: 'unavailable', estimated_krw: null, basis: '실거래 비교자료가 아직 충분하지 않습니다.', comparables: [] },
    restrictions: prior?.restrictions ?? { resale: null, residence: null },
  }
}

async function main() {
  const previous = await readExisting()
  const from = new Date(kstNow())
  from.setUTCDate(from.getUTCDate() - 120)
  const fromDate = dateOnly(from)
  try {
    const [aptRows, remainingRows] = await Promise.all([fetchAll('getAPTLttotPblancDetail', fromDate), fetchAll('getRemndrLttotPblancDetail', fromDate)])
    const candidates = [...aptRows.map((row) => ({ row, remaining: false })), ...remainingRows.map((row) => ({ row, remaining: true }))]
      .filter(({ row }) => ['서울특별시', '경기도'].includes(parseRegion(row).sido))
    const deduped = [...new Map(candidates.map((item) => [clean(item.row.PBLANC_NO) ?? clean(item.row.HOUSE_MANAGE_NO), item])).values()]
    const announcements = []
    for (const item of deduped) {
      const operation = item.remaining ? 'getRemndrLttotPblancMdl' : 'getAPTLttotPblancMdl'
      const models = await fetchModels(operation, item.row)
      announcements.push(normalize(item.row, models, item.remaining, previous))
    }
    if (!announcements.length) throw new Error('API 결과가 비어 있어 이전 정상 데이터를 유지합니다.')
    const output = { metadata: { generated_at: isoKst(), source: '한국부동산원 청약홈 분양정보 조회 서비스', is_sample: false, last_fetch_error: null, count: announcements.length }, announcements }
    await fs.writeFile(dataPath, `${JSON.stringify(output, null, 2)}\n`)
    console.log(`서울·경기 공고 ${announcements.length}건을 저장했습니다.`)
  } catch (error) {
    if (!previous?.announcements?.length) throw error
    previous.metadata = { ...previous.metadata, generated_at: isoKst(), last_fetch_error: error instanceof Error ? error.message : String(error), count: previous.announcements.length }
    await fs.writeFile(dataPath, `${JSON.stringify(previous, null, 2)}\n`)
    console.error(`갱신 실패: 이전 정상 데이터 ${previous.announcements.length}건을 유지했습니다.`)
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 })
