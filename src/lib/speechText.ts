import { textLooksBangla } from './voices'

const BN_DIGIT: Record<string, string> = {
  '0': '০',
  '1': '১',
  '2': '২',
  '3': '৩',
  '4': '৪',
  '5': '৫',
  '6': '৬',
  '7': '৭',
  '8': '৮',
  '9': '৯',
}

/** Digits only, spaced so TTS does not say "one hundred twenty-three". */
function speakDigits(digits: string, bangla: boolean): string {
  const chars = digits.split('')
  if (bangla) {
    return chars.map((d) => BN_DIGIT[d] || d).join(' ')
  }
  return chars.join(' ')
}

function isLikelyPhone(digits: string): boolean {
  if (digits.length < 7 || digits.length > 15) return false
  // BD mobile: 01XXXXXXXXX or 8801XXXXXXXXX
  if (/^(?:\+?88)?0?1[3-9]\d{8}$/.test(digits)) return true
  // Generic long number sequences used as phones
  if (digits.length >= 10 && digits.length <= 15) return true
  return false
}

function replacePhones(text: string, bangla: boolean): string {
  // Match common phone shapes: +8801712-345678, (017) 12-345678, 01712 345 678
  return text.replace(
    /(?:\+?\d{1,3}[\s\-.]*)?(?:\(?\d{2,4}\)?[\s\-.]*)?\d(?:[\d\s\-().]{5,16})\d/g,
    (match) => {
      const digits = match.replace(/\D/g, '')
      if (!isLikelyPhone(digits)) return match
      // Avoid rewriting plain years / short codes already handled
      if (/^\d{4}$/.test(digits)) return match
      const spoken = speakDigits(digits, bangla)
      return bangla ? ` ফোন নম্বর ${spoken} ` : ` phone number ${spoken} `
    },
  )
}

/**
 * Prepare assistant text for TTS:
 * - phone numbers → spoken digit-by-digit (not "one hundred…")
 * - skip decorative symbols * ( ) % , . etc. that voices read aloud
 * - soften URLs / emails / markdown
 */
export function prepareSpeechText(raw: string): string {
  let t = String(raw || '').trim()
  if (!t) return ''

  const bangla = textLooksBangla(t)

  // Leaked model tags
  t = t.replace(/\n?VOICE_STYLE:\s*.+$/i, '').trim()

  // Markdown / code fences
  t = t.replace(/```[\s\S]*?```/g, ' ')
  t = t.replace(/`([^`]+)`/g, '$1')
  t = t.replace(/\*\*([^*]+)\*\*/g, '$1')
  t = t.replace(/__([^_]+)__/g, '$1')
  t = t.replace(/\*([^*]+)\*/g, '$1')
  t = t.replace(/^#{1,6}\s*/gm, '')
  t = t.replace(/^\s*[-*•]\s+/gm, '')

  // URLs & emails — don't spell out every slash/dot
  t = t.replace(/https?:\/\/[^\s]+/gi, bangla ? ' লিংক ' : ' link ')
  t = t.replace(/www\.[^\s]+/gi, bangla ? ' লিংক ' : ' link ')
  t = t.replace(
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    bangla ? ' ইমেইল অ্যাড্রেস ' : ' email address ',
  )

  // File paths (Windows / Unix) — avoid reading backslashes
  t = t.replace(/[A-Za-z]:\\[^\s]+/g, bangla ? ' ফাইল পাথ ' : ' file path ')
  t = t.replace(/\/(?:Users|home|var|tmp)\/[^\s]+/g, bangla ? ' ফাইল পাথ ' : ' file path ')

  // Phones before stripping parentheses / dashes
  t = replacePhones(t, bangla)

  // 50% → "50 percent" / "৫০ শতাংশ" (then strip lone %)
  t = t.replace(/(\d+)\s*%/g, (_, n: string) =>
    bangla ? ` ${n} শতাংশ ` : ` ${n} percent `,
  )

  // Standalone symbols voices often pronounce: * ( ) % , . ! ? # @ ^ ~ _ = + | \ / < > { } [ ]
  // Keep Bangla danda । and question/exclaim as short pauses via space
  t = t.replace(/[*#@_^=+|\\<>{}[\]()%~`]+/g, ' ')
  // Don't speak punctuation — turn into pauses (incl. Bangla danda)
  t = t.replace(/[.,;:!?…।॥]+/g, ' ')
  // Dashes / bullets leftover
  t = t.replace(/[-–—/]+/g, ' ')

  // Collapse whitespace
  t = t.replace(/\s+/g, ' ').trim()
  return t
}
