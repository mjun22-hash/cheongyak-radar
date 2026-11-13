import fs from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const list = 'https://apply.lh.or.kr/lhapply/apply/wt/wrtanc/selectWrtancList.do?mi=1027'
const destination = new URL('../data/lh.json', import.meta.url)
const north = /^(?:고양|남양주|파주|의정부|양주|구리|포천|동두천|가평|연천)/
const plain = (html = '') => html.replace(/<!--[\s\S]*?-->|<em\b[^>]*>[\s\S]*?<\/em>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
const iso = (value) => value?.replaceAll('.', '-') ?? null
async function html(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) })
  if (!response.ok) throw new Error(`LH HTTP ${response.status}`)
  return response.text()
}

export function parseLhList(source) {
  return [...source.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].flatMap(([,row]) => {
    const link = row.match(/<a\b([^>]*\bwrtancInfoBtn\b[^>]*)>([\s\S]*?)<\/a>/i)
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => plain(m[1]))
    const ids = link && [1,2,3,4].map((n) => link[1].match(new RegExp(`data-id${n}="([0-9]+)"`))?.[1])
    if (!ids?.every(Boolean) || !/^(경기도|서울특별시|서울)$/.test(cells[3] ?? '')) return []
    const name = plain(link[2])
    const [panId, ccrCnntSysDsCd, aisTpCd, uppAisTpCd] = ids
    const url = new URL('selectWrtancInfo.do', list)
    url.search = new URLSearchParams({mi:'1027', panId, ccrCnntSysDsCd, aisTpCd, uppAisTpCd}).toString()
    return [{ id: `lh-${panId}`, url: url.href, name, sido: cells[3], published: iso(cells[5]), end: iso(cells[6]) }]
  })
}

export function parseLhDetail(row, source) {
  const address = [...source.matchAll(/<strong>\s*소재지\s*<\/strong>([^<]+)/g)].map((m) => plain(m[1]))[0] ?? ''
  const sido = row.sido.startsWith('서울') ? '서울특별시' : '경기도'
  const sigungu = address.match(/(?:경기도|서울특별시|서울시)\s+([가-힣]+(?:시|구|군))/)?.[1] ??
    (row.name.includes('광교') ? '수원시' : row.name.match(/([가-힣]+(?:시|구|군))\s/)?.[1] ?? '')
  const schedule = [...source.matchAll(/id="sta_acpDt"[^>]*>\s*(\d{4}\.\d{2}\.\d{2})\s*(?:~\s*(\d{4}\.\d{2}\.\d{2}))?/g)][0]
  const remaining = /무순위|잔여세대|공가세대|선착순/.test(row.name)
  const requirement = plain(source.match(/■\s*금회\s*공급하는\s*주택은[^<]{0,600}?공급합니다\./)?.[0] ?? '')
  const summary = requirement.match(/수도권\([^)]*\)에\s*거주하는.{0,75}?무주택세대구성원/) ? '수도권 거주 성년 무주택세대구성원' : ''
  return { ...row, source: 'lh', title: row.name, region:{sido,sigungu}, application_start:iso(schedule?.[1]), application_end:iso(schedule?.[2] ?? schedule?.[1]) ?? row.end,
    category: remaining ? 'remaining' : 'upcoming', requirement:summary, requires_homeless: /무주택세대구성원/.test(row.name) && !/유주택자 가능/.test(row.name),
    rating:null, gain_estimate_krw:null, gain_basis:null, cash_needed_krw:null }
}

async function main() {
  const prior = JSON.parse(await fs.readFile(destination, 'utf8'))
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0,10)
  try {
    const rows = parseLhList(await html(list))
    if (!rows.length) throw new Error('LH 대상 목록을 확인하지 못했습니다.')
    const items = []
    for (const row of rows.filter((x) => /무순위|잔여세대|공가세대|선착순/.test(x.name) && x.end >= today)) {
      const item = await html(row.url).then((source) => parseLhDetail(row, source)).catch(() => prior.items.find((x) => x.id === row.id) ?? parseLhDetail(row, ''))
      if (!north.test(item.region.sigungu) && !north.test(item.name.replace(/^\[정정공고\]\s*/, ''))) items.push(item)
    }
    await fs.writeFile(destination, JSON.stringify({metadata:{ checked_at:new Date().toISOString(), last_fetch_error:null },items},null,2)+'\n')
    console.log(`LH 공식 잔여·공가 공고 ${items.length}건`)
  } catch (error) {
    await fs.writeFile(destination, JSON.stringify({...prior, metadata:{...prior.metadata,last_fetch_error:String(error.message)}},null,2)+'\n')
    console.warn('LH 갱신 실패: 이전 목록 유지')
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main()
