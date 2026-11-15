/** Mirror of src/lib/speechText.ts — keep TTS sanitization in main process too. */

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

function textLooksBangla(text: string): boolean {
  return /[\u0980-\u09FF]/.test(text)
}

function speakDigits(digits: string, bangla: boolean): string {
  const chars = digits.split('')
  if (bangla) return chars.map((d) => BN_DIGIT[d] || d).join(' ')
  return chars.join(' ')
}

function isLikelyPhone(digits: string): boolean {
  if (digits.length < 7 || digits.length > 15) return false
  if (/^(?:\+?88)?0?1[3-9]\d{8}$/.test(digits)) return true
  if (digits.length >= 10 && digits.length <= 15) return true
  return false
}

function replacePhones(text: string, bangla: boolean): string {
  return text.replace(
    /(?:\+?\d{1,3}[\s\-.]*)?(?:\(?\d{2,4}\)?[\s\-.]*)?\d(?:[\d\s\-().]{5,16})\d/g,
    (match) => {
      const digits = match.replace(/\D/g, '')
      if (!isLikelyPhone(digits)) return match
      if (/^\d{4}$/.test(digits)) return match
      const spoken = speakDigits(digits, bangla)
      return bangla ? ` ফোন নম্বর ${spoken} ` : ` phone number ${spoken} `
    },
  )
}

/**
 * Prepare text for TTS: phones as digit-by-digit, skip decorative symbols.
 */
export function prepareSpeechText(raw: string): string {
  let t = String(raw || '').trim()
  if (!t) return ''

  const bangla = textLooksBangla(t)

  t = t.replace(/\n?VOICE_STYLE:\s*.+$/i, '').trim()
  t = t.replace(/```[\s\S]*?```/g, ' ')
  t = t.replace(/`([^`]+)`/g, '$1')
  t = t.replace(/\*\*([^*]+)\*\*/g, '$1')
  t = t.replace(/__([^_]+)__/g, '$1')
  t = t.replace(/\*([^*]+)\*/g, '$1')
  t = t.replace(/^#{1,6}\s*/gm, '')
  t = t.replace(/^\s*[-*•]\s+/gm, '')

  t = t.replace(/https?:\/\/[^\s]+/gi, bangla ? ' লিংক ' : ' link ')
  t = t.replace(/www\.[^\s]+/gi, bangla ? ' লিংক ' : ' link ')
  t = t.replace(
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    bangla ? ' ইমেইল অ্যাড্রেস ' : ' email address ',
  )
  t = t.replace(/[A-Za-z]:\\[^\s]+/g, bangla ? ' ফাইল পাথ ' : ' file path ')
  t = t.replace(/\/(?:Users|home|var|tmp)\/[^\s]+/g, bangla ? ' ফাইল পাথ ' : ' file path ')

  t = replacePhones(t, bangla)
  t = t.replace(/(\d+)\s*%/g, (_, n: string) =>
    bangla ? ` ${n} শতাংশ ` : ` ${n} percent `,
  )

  t = t.replace(/[*#@_^=+|\\<>{}[\]()%~`]+/g, ' ')
  t = t.replace(/[.,;:!?…।॥]+/g, ' ')
  t = t.replace(/[-–—/]+/g, ' ')
  t = t.replace(/\s+/g, ' ').trim()
  return t
}
