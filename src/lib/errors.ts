export function formatGeminiError(raw: string): string {
  const text = raw || ''

  if (/429|RESOURCE_EXHAUSTED|quota|rate-limits|Free Tier/i.test(text)) {
    return [
      'Gemini quota/rate limit।',
      'Billing on আছে কিনা চেক করো, কিছুক্ষণ পর আবার চেষ্টা করো।',
      'https://aistudio.google.com/rate-limit',
    ].join(' ')
  }

  if (/503|UNAVAILABLE|high demand/i.test(text)) {
    return 'Gemini model এখন ব্যস্ত (503)। কিছুক্ষণ পর আবার চেষ্টা করো।'
  }

  if (/404|no longer available|NOT_FOUND/i.test(text)) {
    return 'এই model আর নেই। Settings → gemini-3.8-flash সিলেক্ট করে Save করো।'
  }

  // Keep short — full JSON is noisy in UI
  const compact = text.replace(/\s+/g, ' ').slice(0, 280)
  return compact
}
