/** Instant local facts — no browser / no screen agent */

export type LocalContext = {
  ok: true
  timezone: string
  locale: string
  isoNow: string
  dateBn: string
  dateEn: string
  weekdayBn: string
  weekdayEn: string
  timeBn: string
  timeEn: string
  unix: number
}

const WEEKDAY_BN = ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার']

export function getLocalDateTime(locale = 'bn-BD'): LocalContext {
  const now = new Date()
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'
  const weekdayEn = now.toLocaleDateString('en-US', { weekday: 'long' })
  const dateEn = now.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  const timeEn = now.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })
  const dateBn = now.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  const timeBn = now.toLocaleTimeString(locale, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })

  return {
    ok: true,
    timezone,
    locale,
    isoNow: now.toISOString(),
    dateBn,
    dateEn,
    weekdayBn: WEEKDAY_BN[now.getDay()] || weekdayEn,
    weekdayEn,
    timeBn,
    timeEn,
    unix: Math.floor(now.getTime() / 1000),
  }
}

export async function getLocalWeather(cityHint?: string): Promise<Record<string, unknown>> {
  const q = (cityHint || '').trim() || 'Dhaka'
  try {
    // wttr.in JSON — no API key, no browser
    const url = `https://wttr.in/${encodeURIComponent(q)}?format=j1`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'jarvis-desktop/0.1' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      return { ok: false, message: `Weather fetch failed (${res.status})` }
    }
    const data = (await res.json()) as {
      current_condition?: Array<{
        temp_C?: string
        FeelsLikeC?: string
        humidity?: string
        weatherDesc?: Array<{ value?: string }>
        windspeedKmph?: string
      }>
      nearest_area?: Array<{ areaName?: Array<{ value?: string }>; country?: Array<{ value?: string }> }>
    }
    const cur = data.current_condition?.[0]
    const area = data.nearest_area?.[0]
    const place =
      area?.areaName?.[0]?.value ||
      q
    const country = area?.country?.[0]?.value || ''
    const desc = cur?.weatherDesc?.[0]?.value || 'unknown'
    return {
      ok: true,
      place,
      country,
      tempC: cur?.temp_C != null ? Number(cur.temp_C) : null,
      feelsLikeC: cur?.FeelsLikeC != null ? Number(cur.FeelsLikeC) : null,
      humidity: cur?.humidity != null ? Number(cur.humidity) : null,
      windKmph: cur?.windspeedKmph != null ? Number(cur.windspeedKmph) : null,
      condition: desc,
      summary: `${place}${country ? `, ${country}` : ''}: ${desc}, ${cur?.temp_C ?? '?'}°C (feels ${cur?.FeelsLikeC ?? '?'}°C), humidity ${cur?.humidity ?? '?'}%`,
      source: 'wttr.in',
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}
