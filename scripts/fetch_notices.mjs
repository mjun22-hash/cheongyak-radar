import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFParse } from 'pdf-parse'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataPath = path.join(root, 'data', 'announcements.json')
const userAgent = 'Mozilla/5.0 (compatible; CheongyakRadar/1.0; personal research)'
const checkedAt = new Date().toISOString()

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
      const window = text.slice(index, index + 240)
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
  const resale = factNear(text, ['전매제한기간', '전매제한'], /(?:전매제한(?:기간)?[^\d없소]{0,80})?(없음|소유권이전등기[^,.;]{0,30}|\d+\s*(?:년|개월))/)
  const residence = factNear(text, ['거주의무기간', '거주의무'], /(?:거주의무(?:기간)?[^\d없]{0,80})?(없음|\d+\s*년)/)
  const rewinning = factNear(text, ['재당첨 제한기간', '재당첨제한', '재당첨 제한'], /(?:재당첨\s*제한(?:기간)?[^\d없]{0,80})?(없음|\d+\s*년)/)
  const priorityResidence = factNear(text, ['우선공급', '해당지역'], /(계속하여\s*\d+\s*(?:년|개월)\s*이상)/)
  const deposit = factNear(text, ['계약금'], /(?:계약금[^\d]{0,60})?(\d+\s*%)/)
  const interim = factNear(text, ['중도금'], /(?:중도금[^\d]{0,60})?(\d+\s*%)/)
  const balance = factNear(text, ['잔금'], /(?:잔금[^\d]{0,60})?(\d+\s*%)/)
  if (resale) facts.resale = resale
  if (residence) facts.residence = residence
  if (rewinning) facts.rewinning = rewinning
  if (priorityResidence) facts.priority_residence = priorityResidence
  if (deposit) facts.contract_deposit = deposit
  if (interim) facts.interim_payment = interim
  if (balance) facts.balance_payment = balance
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

async function findNotice(homepage) {
  const firstResponse = await fetchResponse(homepage)
  const firstUrl = firstResponse.url
  const firstHtml = await firstResponse.text()
  const firstLinks = linksFromHtml(firstHtml, firstUrl)
  const directPdfs = firstLinks.filter((item) => /\.pdf(?:$|[?#])/i.test(item.url))
  const noticePages = firstLinks.filter((item) =>
    new URL(item.url).origin === new URL(firstUrl).origin && /공고|모집|gongo|gonggo|notice|recruit/i.test(`${item.text} ${item.url}`),
  ).slice(0, 3)
  let pdfs = directPdfs
  let combinedText = firstHtml.replace(/<[^>]+>/g, ' ')
  for (const page of noticePages) {
    try {
      const response = await fetchResponse(page.url)
      const html = await response.text()
      combinedText += ` ${html.replace(/<[^>]+>/g, ' ')}`
      pdfs.push(...linksFromHtml(html, response.url).filter((item) => /\.pdf(?:$|[?#])/i.test(item.url)))
    } catch {}
  }
  pdfs = [...new Map(pdfs.map((item) => [item.url, item])).values()]
  const preferred = pdfs.find((item) => /입주자|모집|공고|gongo|gonggo|pblanc/i.test(`${item.text} ${item.url}`)) ?? pdfs[0]
  if (!preferred) return { sourceUrl: firstUrl, text: combinedText }
  return { sourceUrl: preferred.url, text: await textFromPdf(preferred.url) }
}

async function main() {
  const data = JSON.parse(await fs.readFile(dataPath, 'utf8'))
  const activeCutoff = Date.now() - 21 * 86_400_000
  let parsedCount = 0
  for (const announcement of data.announcements) {
    const endTime = Date.parse(`${announcement.application_end ?? announcement.application_start ?? announcement.announcement_date}T00:00:00+09:00`)
    if (Number.isFinite(endTime) && endTime < activeCutoff) continue
    if (announcement.notice_analysis?.status === 'parsed' && Object.keys(announcement.notice_analysis.facts ?? {}).length) continue
    const homepage = announcement.links?.homepage
    if (!homepage || !/^https?:\/\//i.test(homepage) || /homedubu\.com/i.test(homepage)) {
      announcement.notice_analysis = { status: 'not_found', source_url: null, checked_at: checkedAt, facts: {} }
      continue
    }
    try {
      const notice = await findNotice(homepage)
      const facts = extractFacts(notice.text)
      announcement.notice_analysis = { status: Object.keys(facts).length ? 'parsed' : 'not_found', source_url: notice.sourceUrl, checked_at: checkedAt, facts }
      if (facts.resale) announcement.restrictions.resale = facts.resale
      if (facts.residence) announcement.restrictions.residence = facts.residence
      if (Object.keys(facts).length) parsedCount += 1
    } catch {
      announcement.notice_analysis = { status: 'error', source_url: homepage, checked_at: checkedAt, facts: {} }
    }
  }
  await fs.writeFile(dataPath, `${JSON.stringify(data, null, 2)}\n`)
  console.log(`공식 분양 홈페이지·모집공고에서 ${parsedCount}개 공고의 제한·납부 조건을 자동 추출했습니다.`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 })
}
