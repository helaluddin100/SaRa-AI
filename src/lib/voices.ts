export function inferVoiceStyle(text: string): string {
  const t = text.toLowerCase()
  if (/দুঃখ|sorry|ক্ষমা|দুঃখিত|unfortunately|can't|পারছি না/.test(t)) {
    return 'gentle, apologetic, soft and caring'
  }
  if (/দারুণ|চমৎকার|awesome|excited|হুররে|congrats|love it|!{2,}/.test(t)) {
    return 'cheerful, warm, lively, happy smile in voice'
  }
  if (/সাবধান|careful|warning|dangerous|ঝুঁকি/.test(t)) {
    return 'serious but calm, reassuring, clear'
  }
  if (/হাসি|😄|😂|মজা|joke|hehe|haha/.test(t)) {
    return 'playful, light laugh in tone, friendly teasing'
  }
  if (/মিস|miss you|ভালবাসি|care about|পাশে আছি/.test(t)) {
    return 'warm, affectionate, intimate soft companion'
  }
  return 'warm, friendly, emotionally present female companion, natural conversational cadence, soft smile'
}

/** Map emotional style → local TTS prosody (no cloud). */
export function styleToProsody(style?: string): { rate: number; pitch: number } {
  const s = (style || '').toLowerCase()
  // Keep Bangla-friendly rates near 1.0 — extreme pitch/rate makes BN sound muddy
  if (/apolog|gentle|soft|sad|দুঃখ|care/.test(s)) return { rate: 0.92, pitch: 1 }
  if (/cheer|happy|lively|excit|দারুণ/.test(s)) return { rate: 1.05, pitch: 1.02 }
  if (/serious|calm|reassur|warning/.test(s)) return { rate: 0.95, pitch: 1 }
  if (/playful|teas|joke/.test(s)) return { rate: 1.04, pitch: 1.03 }
  if (/affection|intimate|warm/.test(s)) return { rate: 0.96, pitch: 1.02 }
  return { rate: 0.98, pitch: 1 }
}

export function textLooksBangla(text: string): boolean {
  return /[\u0980-\u09FF]/.test(text)
}
