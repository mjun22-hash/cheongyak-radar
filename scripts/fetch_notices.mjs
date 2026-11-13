import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFParse } from 'pdf-parse'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataPath = path.join(root, 'data', 'announcements.json')
const userAgent = 'Mozilla/5.0 (compatible; CheongyakRadar/1.0; personal research)'
const checkedAt = new Date().toISOString()
const parserVersion = 'notice-id-v4'
const nextFactLabel = /전매제한기간|전매제한|거주의무기간|거주의무|재당첨 제한기간|재당첨제한|재당첨 제한|우선공급|해당지역|계약금|중도금|잔금/

const htmlDecode = (value) => value.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'")
const normalizeUrl = (href, base) => {
  try { return new URL(htmlDecode(href).replaceAll('\\', '/'), base).href } catch { return null }
}

async function fetchResponse(url, timeout = 15_000) {
  const response = await fetch(url, { headers: { 'User-Agent': userAgent }, redirect: 'follow', signal: AbortSignal.timeout(timeout) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response
}

function linksFromHtml(html, base) {
  return [...html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map((match) => ({
    url: normalizeUrl(match[1], base),
    text: match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
  })).filter((item) => item.url)
}

function factNear(text, labels, valuePattern) {
  for (const label of labels) {
    let cursor = 0
    while (cursor < text.length) {
      const index = text.indexOf(label, cursor)
      if (index < 0) break
      const tail = text.slice(index + label.length, index + label.length + 180)
      const nextLabelIndex = tail.search(nextFactLabel)
      const window = nextLabelIndex >= 0 ? tail.slice(0, nextLabelIndex) : tail
      const match = window.match(valuePattern)
      if (match) return match[1].replace(/\s+/g, ' ').trim()
      cursor = index + label.length
    }
  }
  return null
}

export function extractFacts(rawText) {
  const text = rawText.replace(/\u0000/g, '').replace(/\s+/g, ' ')
  const facts = {}
  const resale = factNear(text, ['전매제한기간', '전매제한'], /(없음|소유권이전등기[^,.;]{0,35}|\d+\s*(?:년|개월))/)
  const residence = factNear(text, ['거주의무기간', '거주의무'], /(없음|[1-5]\s*년)/)
  const rewinning = factNear(text, ['재당첨 제한기간', '재당첨제한', '재당첨 제한'], /(없음|\d+\s*년)/)
  const priorityResidence = factNear(text, ['우선공급', '해당지역'], /(계속하여\s*\d+\s*(?:년|개월)\s*이상)/)
  const deposit = factNear(text, ['계약금'], /(\d+\s*%)/)
  const interim = factNear(text, ['중도금'], /(\d+\s*%)/)
  const balance = factNear(text, ['잔금'], /(\d+\s*%)/)
  if (resale) facts.resale = resale.includes('소유권이전등기') ? '소유권이전등기일까지' : resale
  if (residence) facts.residence = residence
  if (rewinning) facts.rewinning = rewinning
  if (priorityResidence) facts.priority_residence = priorityResidence
  if (deposit) facts.contract_deposit = deposit
  if (interim) facts.interim_payment = interim
  if (balance) facts.balance_payment = balance
  const expired = text.match(/재당첨제한\s+전매제한\s+거주의무기간\s+분양가상한제\s+없음\s+최초\s+당첨자\s+발표일.{0,100}?현재\s*전매제한기간(?:이)?\s*(?:경과|도과)\s*없음/)
  if (expired) Object.assign(facts, {resale:'기간 경과', residence:'없음', rewinning:'없음'})
  const payments = text.match(/계약금\s*\((\d+)%\)\s+잔금\s*\((\d+)%\)/)
  if (payments) {
    facts.contract_deposit = payments[1] + '%'
    delete facts.interim_payment
    facts.balance_payment = payments[2] + '%'
  }
  return facts
}

async function textFromPdf(url) {
  const response = await fetchResponse(url, 30_000)
  const contentLength = Number(response.headers.get('content-length') || 0)
  if (contentLength > 30_000_000) throw new Error('PDF too large')
  const buffer = new Uint8Array(await response.arrayBuffer())
  const parser = new PDFParse({ data: buffer })
  try { return (await parser.getText()).text } finally { await parser.destroy() }
}

export function officialAttachment(html, base, noticeNumber) {
  return linksFromHtml(html, base).find(({url, text}) => {
    const u = new URL(url)
    return u.protocol === 'https:' && u.hostname === 'static.applyhome.co.kr' &&
      u.pathname.endsWith('/getAtchmnfl.do') && u.searchParams.get('pblancNo') === noticeNumber &&
      /모집\s*공고/.test(text)
  })?.url ?? null
}

export function extractEligibility(rawText) {
  const text = rawText.replace(/\s+/g, ' ')
  const row = text.match(/무순위\s*\(사후\)\s*입주자모집공고일\s*현재\s*(경기도|서울특별시|인천광역시)에\s*거주하는\s*무주택세대구성원인\s*성년자/)
  return row ? { residence_sido: row[1], requires_homeless: true } : {}
}

async function main() {
  const data = JSON.parse(await fs.readFile(dataPath, 'utf8'))
  const activeCutoff = Date.now() - 21 * 86_400_000
  let parsedCount = 0
  const queue = [...data.announcements]
  async function worker() {
  for (let announcement; (announcement = queue.shift());) {
    const endTime = Date.parse(`${announcement.application_end ?? announcement.application_start ?? announcement.announcement_date}T00:00:00+09:00`)
    if (Number.isFinite(endTime) && endTime < activeCutoff) continue
    if (announcement.notice_analysis?.parser_version === parserVersion && announcement.notice_analysis?.verified_notice_number === announcement.notice_number) continue
    announcement.restrictions = { resale: null, residence: null }
    const official = announcement.links?.official
    try {
      const url = new URL(official)
      if (url.protocol !== 'https:' || url.hostname !== 'www.applyhome.co.kr' || url.searchParams.get('pblancNo') !== announcement.notice_number) throw new Error('공고번호 불일치')
      const source = officialAttachment(await (await fetchResponse(official)).text(), official, announcement.notice_number)
      if (!source) {
        announcement.notice_analysis = { status: 'not_found', source_url: null, checked_at: checkedAt, parser_version: parserVersion, facts: {} }
        continue
      }
      const text = await textFromPdf(source)
      const facts = extractFacts(text)
      announcement.notice_analysis = { status: 'parsed', source_url: source, checked_at: checkedAt, parser_version: parserVersion, verified_notice_number: announcement.notice_number, facts, eligibility: extractEligibility(text) }
      if (facts.resale) announcement.restrictions.resale = facts.resale
      if (facts.residence) announcement.restrictions.residence = facts.residence
      if (Object.keys(facts).length) parsedCount += 1
    } catch {
      announcement.notice_analysis = { status: 'error', source_url: null, checked_at: checkedAt, parser_version: parserVersion, facts: {} }
    }
  }
  }
  await Promise.all(Array.from({length:4}, worker))
  await fs.writeFile(dataPath, `${JSON.stringify(data, null, 2)}\n`)
  console.log(`공식 분양 홈페이지·모집공고에서 ${parsedCount}개 공고의 제한·납부 조건을 자동 추출했습니다.`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 })
}
