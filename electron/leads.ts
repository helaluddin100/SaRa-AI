import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { shell } from 'electron'
import { BrowserWindow } from 'electron'
import { geminiGenerateContent } from './gemini'
import { runComputerTask } from './computer-agent'
import { getSettings } from './store'
import {
  chromeExecJs,
  openUrlInBrowser,
  readBrowserPageText,
} from './ui-automation'

export type LeadRow = {
  name: string
  rating?: string
  reviews?: string
  category?: string
  address?: string
  phone?: string
  website?: string
  mapsUrl?: string
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function csvEscape(value: string): string {
  const v = String(value ?? '').replace(/\r?\n/g, ' ').trim()
  if (/[",]/.test(v)) return `"${v.replace(/"/g, '""')}"`
  return v
}

function toCsv(rows: LeadRow[]): string {
  const header = ['name', 'rating', 'reviews', 'category', 'address', 'phone', 'website', 'maps_url']
  const lines = [header.join(',')]
  for (const row of rows) {
    lines.push(
      [
        csvEscape(row.name),
        csvEscape(row.rating || ''),
        csvEscape(row.reviews || ''),
        csvEscape(row.category || ''),
        csvEscape(row.address || ''),
        csvEscape(row.phone || ''),
        csvEscape(row.website || ''),
        csvEscape(row.mapsUrl || ''),
      ].join(','),
    )
  }
  return lines.join('\n') + '\n'
}

function mapsSearchUrl(query: string, location?: string): string {
  const q = [query.trim(), location?.trim()].filter(Boolean).join(' ')
  return `https://www.google.com/maps/search/${encodeURIComponent(q)}`
}

function parseLeadsJson(raw: string): LeadRow[] {
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  const start = cleaned.indexOf('[')
  const end = cleaned.lastIndexOf(']')
  if (start < 0 || end <= start) return []
  try {
    const arr = JSON.parse(cleaned.slice(start, end + 1)) as unknown
    if (!Array.isArray(arr)) return []
    return arr
      .map((item) => {
        const o = item as Record<string, unknown>
        const name = String(o.name || o.title || '').trim()
        if (!name) return null
        return {
          name,
          rating: o.rating != null ? String(o.rating) : '',
          reviews: o.reviews != null ? String(o.reviews) : '',
          category: o.category != null ? String(o.category) : '',
          address: o.address != null ? String(o.address) : '',
          phone: o.phone != null ? String(o.phone) : '',
          website: o.website != null ? String(o.website) : '',
          mapsUrl: o.mapsUrl != null || o.maps_url != null ? String(o.mapsUrl || o.maps_url) : '',
        } as LeadRow
      })
      .filter((x): x is LeadRow => Boolean(x))
  } catch {
    return []
  }
}

async function scrapeLeadsFromChromeDom(maxResults: number): Promise<LeadRow[]> {
  const js = `(() => {
  const max = ${Math.max(1, Math.min(50, maxResults))};
  const out = [];
  const seen = new Set();
  const cards = Array.from(document.querySelectorAll('div[role="article"], a[href*="/maps/place/"]'));
  for (const card of cards) {
    if (out.length >= max) break;
    let root = card;
    if (card.tagName === 'A') root = card.closest('div[role="article"]') || card;
    const link = root.querySelector('a[href*="/maps/place/"]') || (card.tagName === 'A' ? card : null);
    const nameEl = root.querySelector('div[role="heading"], .fontHeadlineSmall, .qBF1Pd');
    const name = (nameEl && nameEl.textContent ? nameEl.textContent.trim() : (link && link.getAttribute('aria-label')) || '').trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const text = (root.innerText || '').split('\\n').map(s => s.trim()).filter(Boolean);
    let rating = '', reviews = '', category = '', address = '', phone = '', website = '';
    for (const line of text) {
      if (!rating && /^\\d(\\.\\d)?$/.test(line)) rating = line;
      else if (!reviews && /^\\(?\\d+[\\d,]*\\)?$/.test(line.replace(/,/g,'')) && line.length < 10) reviews = line.replace(/[()]/g,'');
      else if (!category && /restaurant|cafe|shop|clinic|hospital|salon|hotel|store|বাজার|রেস্তোরাঁ|ক্লিনিক/i.test(line) && line.length < 60) category = line;
      else if (!address && (line.includes(',') || /road|rd|street|avenue|সড়ক|রোড|এভিনিউ/i.test(line)) && line.length > 8) address = line;
      else if (!phone && /(\\+?\\d[\\d\\s()-]{7,}\\d)/.test(line)) phone = line;
      else if (!website && /\\./.test(line) && !line.includes(' ') && /\\.(com|net|org|bd|io)/i.test(line)) website = line;
    }
    const mapsUrl = link && link.href ? link.href : '';
    out.push({ name, rating, reviews, category, address, phone, website, mapsUrl });
  }
  return JSON.stringify(out);
})()`

  const raw = await chromeExecJs(js)
  return parseLeadsJson(raw)
}

async function extractLeadsWithGemini(
  query: string,
  pageText: string,
  maxResults: number,
): Promise<LeadRow[]> {
  const settings = getSettings()
  const apiKey = settings.geminiApiKey?.trim()
  if (!apiKey || !pageText.trim()) return []

  const result = await geminiGenerateContent(
    {
      apiKey,
      model: settings.model || 'gemini-3.8-flash',
      body: {
        contents: [
          {
            role: 'user',
            parts: [
              {
                text:
                  `Extract business leads from this Google Maps search page text.\n` +
                  `Search: ${query}\n` +
                  `Return ONLY a JSON array (max ${maxResults} items) with keys: ` +
                  `name, rating, reviews, category, address, phone, website, mapsUrl.\n` +
                  `Skip ads/navigation chrome. If a field is unknown use "".\n\n` +
                  pageText.slice(0, 12000),
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          thinkingConfig: { thinkingLevel: 'low' },
        },
      },
    },
    60_000,
  )
  if (!result.ok) return []
  const data = result.data as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>
  }
  const text = (data.candidates?.[0]?.content?.parts || [])
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => p.text || '')
    .join('\n')
  return parseLeadsJson(text).slice(0, maxResults)
}

async function writeLeadsCsv(query: string, rows: LeadRow[]): Promise<string> {
  const safe = query
    .toLowerCase()
    .replace(/[^a-z0-9\u0980-\u09ff]+/gi, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'leads'
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const dir = path.join(os.homedir(), 'Desktop')
  const file = path.join(dir, `jarvis-leads-${safe}-${stamp}.csv`)
  await fs.writeFile(file, toCsv(rows), 'utf8')
  return file
}

/**
 * Generate business leads from Google Maps → CSV on Desktop.
 */
export async function generateMapsLeads(
  options: {
    query: string
    location?: string
    maxResults?: number
  },
  win: BrowserWindow | null,
): Promise<{
  ok: boolean
  message: string
  count?: number
  filePath?: string
  leads?: LeadRow[]
}> {
  const query = String(options.query || '').trim()
  if (!query) {
    return { ok: false, message: 'কী ধরনের লিড? যেমন "dentist Gulshan" বা "restaurants Banani".' }
  }
  const location = String(options.location || '').trim()
  const maxResults = Math.max(5, Math.min(40, Number(options.maxResults) || 15))
  const url = mapsSearchUrl(query, location)

  try {
    const browser = await openUrlInBrowser(url)
    await sleep(5000)

    let leads: LeadRow[] = []

    // 1) DOM scrape (best when Chrome Apple Events JS is on)
    try {
      leads = await scrapeLeadsFromChromeDom(maxResults)
      // Scroll feed a bit for more results
      if (leads.length < Math.min(8, maxResults)) {
        try {
          await chromeExecJs(`(() => {
  const feed = document.querySelector('div[role="feed"]');
  if (feed) feed.scrollBy(0, 1200);
  return 'scrolled';
})()`)
          await sleep(1800)
          const more = await scrapeLeadsFromChromeDom(maxResults)
          const seen = new Set(leads.map((l) => l.name.toLowerCase()))
          for (const row of more) {
            if (!seen.has(row.name.toLowerCase())) {
              leads.push(row)
              seen.add(row.name.toLowerCase())
            }
          }
        } catch {
          // ignore scroll errors
        }
      }
    } catch {
      // JS blocked — continue
    }

    // 2) Page text + Gemini structure
    if (leads.length < 3) {
      try {
        const text = await readBrowserPageText(browser)
        const fromAi = await extractLeadsWithGemini(
          [query, location].filter(Boolean).join(' — '),
          text,
          maxResults,
        )
        if (fromAi.length > leads.length) leads = fromAi
      } catch {
        // ignore
      }
    }

    // 3) Vision computer-use fallback: open Maps, scroll, then Gemini from captured text goal
    if (leads.length < 3) {
      const vision = await runComputerTask(
        `Open Google Maps search results for "${[query, location].filter(Boolean).join(' ')}" if not already open. ` +
          `Scroll the results list so multiple businesses are visible. ` +
          `Then finish with a summary listing business names, ratings, addresses, and phones you can see (at least ${Math.min(
            8,
            maxResults,
          )} if available).`,
        win,
      )
      if (vision.ok && vision.message) {
        const fromVision = await extractLeadsWithGemini(
          [query, location].filter(Boolean).join(' — '),
          vision.message + '\n' + (vision.steps || []).join('\n'),
          maxResults,
        )
        if (fromVision.length > leads.length) leads = fromVision
      }
    }

    leads = leads.slice(0, maxResults)
    if (!leads.length) {
      return {
        ok: false,
        message:
          'Google Maps থেকে লিড আনতে পারিনি। Chrome লগইন/লোড চেক করো, এবং View → Developer → Allow JavaScript from Apple Events চালু রাখো।',
      }
    }

    const filePath = await writeLeadsCsv([query, location].filter(Boolean).join(' '), leads)
    try {
      shell.showItemInFolder(filePath)
    } catch {
      // ignore
    }

    const preview = leads
      .slice(0, 5)
      .map((l, i) => `${i + 1}. ${l.name}${l.phone ? ` — ${l.phone}` : ''}${l.address ? ` (${l.address})` : ''}`)
      .join('\n')

    return {
      ok: true,
      count: leads.length,
      filePath,
      leads,
      message:
        `${leads.length}টি লিড রেডি। CSV Desktop-এ সেভ: ${filePath}\n` +
        `নমুনা:\n${preview}`,
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}
