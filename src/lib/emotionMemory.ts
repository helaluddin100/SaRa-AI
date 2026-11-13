/** Client-side emotion detection + prompt formatting for companion memory */

export type EmotionMood =
  | 'neutral'
  | 'sad'
  | 'happy'
  | 'lonely'
  | 'angry'
  | 'anxious'
  | 'affectionate'
  | 'intimate'
  | 'excited'
  | 'tired'

export type EmotionMemory = {
  currentMood: EmotionMood
  intensity: number
  lastNote: string
  updatedAt: string
  likes: string[]
  dislikes: string[]
  joyTriggers: string[]
  sadnessTriggers: string[]
  nightMoodNotes: string[]
  intimatePreferences: string[]
  history: Array<{ at: string; mood: EmotionMood; note: string }>
}

const MOODS: EmotionMood[] = [
  'neutral',
  'sad',
  'happy',
  'lonely',
  'angry',
  'anxious',
  'affectionate',
  'intimate',
  'excited',
  'tired',
]

export function isEmotionMood(v: string): v is EmotionMood {
  return (MOODS as string[]).includes(v)
}

type Detected = { mood: EmotionMood; intensity: number; note: string }

/** Heuristic mood from the latest user utterance (Bangla + English). */
export function detectEmotionFromText(text: string): Detected | null {
  const t = text.trim()
  if (!t || t.length < 2) return null
  const lower = t.toLowerCase()

  const hit = (re: RegExp) => re.test(t) || re.test(lower)

  // Intimate / sexual mood — adults only, mirror when user leads
  if (
    hit(
      /সেক্স|সেক্সি|হর্নি|কাম|রোমান্টিক মুড|intimate|horny|sexy|turn.?on|miss your body|আমাকে ছোঁ|আদর কর|চুমু|kiss me|make love|naughty|dirty talk/i,
    )
  ) {
    return { mood: 'intimate', intensity: 4, note: t.slice(0, 120) }
  }

  if (
    hit(
      /মন খারাপ|খারাপ লাগ|দুঃখ|কান্দ|alone|lonely|একাকী|বিষণ্ণ|depressed|sad|hurt|ভেঙে|মনে হয় কেউ নেই|কষ্ট/i,
    )
  ) {
    const lonely = hit(/একাকী|lonely|একা|miss you|তোমাকে মিস/)
    return {
      mood: lonely ? 'lonely' : 'sad',
      intensity: 4,
      note: t.slice(0, 120),
    }
  }

  if (hit(/রাগ|angry|furious|চিৎকার|ঘৃণা|irritat|মেজাজ খারাপ|frustrated/i)) {
    return { mood: 'angry', intensity: 4, note: t.slice(0, 120) }
  }

  if (hit(/টেনশন|anxiety|anxious|worry|ভয়|panic|ঘুম আসছে না|stressed/i)) {
    return { mood: 'anxious', intensity: 3, note: t.slice(0, 120) }
  }

  if (hit(/ক্লান্ত|tired|ঘুম|exhausted|fatigue|শক্তি নেই/i)) {
    return { mood: 'tired', intensity: 3, note: t.slice(0, 120) }
  }

  if (
    hit(
      /ভালোবাসি|love you|miss you|আদর|পাশে থাক|তোমার কথা|affection|care about you|তুমি আমার/i,
    )
  ) {
    return { mood: 'affectionate', intensity: 3, note: t.slice(0, 120) }
  }

  if (
    hit(
      /মন ভালো|খুশি|আনন্দ|দারুণ|চমৎকার|excited|happy|great|awesome|হাসি|হুররে|উল্লাস|feel good/i,
    )
  ) {
    const excited = hit(/excited|উত্তেজ|হুররে|দারুণ খবর/)
    return {
      mood: excited ? 'excited' : 'happy',
      intensity: 4,
      note: t.slice(0, 120),
    }
  }

  // Night-time mood cues without strong emotion → soft note only
  if (hit(/রাত|tonight|late night|একা রাতে|শয়ন/i) && hit(/মন|feel|মুড|mood/i)) {
    return { mood: 'lonely', intensity: 2, note: t.slice(0, 120) }
  }

  return null
}

export function formatEmotionBlock(mem: EmotionMemory): string {
  const lines = [
    'EMOTION MEMORY (user feelings — follow this closely):',
    `- Current mood: ${mem.currentMood} (intensity ${mem.intensity}/5)`,
    mem.lastNote ? `- Latest note: ${mem.lastNote}` : null,
    mem.likes.length ? `- Likes: ${mem.likes.join('; ')}` : null,
    mem.dislikes.length ? `- Dislikes: ${mem.dislikes.join('; ')}` : null,
    mem.joyTriggers.length ? `- What brings joy: ${mem.joyTriggers.join('; ')}` : null,
    mem.sadnessTriggers.length ? `- What hurts: ${mem.sadnessTriggers.join('; ')}` : null,
    mem.nightMoodNotes.length ? `- Night feelings: ${mem.nightMoodNotes.join('; ')}` : null,
    mem.intimatePreferences.length
      ? `- Intimate preferences (adult, consensual mirror only): ${mem.intimatePreferences.join('; ')}`
      : null,
    '',
    'Mood response rules:',
    '- sad / lonely / anxious → gentle, comforting, stay with their feelings; help lift mood softly',
    '- happy / excited → match energy, celebrate with them',
    '- angry → calm, validating, not argumentative',
    '- affectionate → warm, caring companion tone',
    '- intimate → adult intimate/sexy conversation matching their lead (never crude unless they are; never involve minors)',
    '- tired → soft, short, caring',
    '- Use update_emotion_memory when they reveal lasting likes/dislikes/triggers/night moods',
  ]

  return lines.filter((x) => x !== null).join('\n')
}

export function voiceStyleForMood(mood: EmotionMood): string {
  switch (mood) {
    case 'sad':
    case 'lonely':
      return 'gentle, soft, comforting female companion, slow caring cadence'
    case 'anxious':
      return 'calm, reassuring, steady soft voice'
    case 'angry':
      return 'calm, grounded, validating without tension'
    case 'happy':
    case 'excited':
      return 'warm smile in voice, playful, lively but natural'
    case 'affectionate':
      return 'warm, intimate soft companion, close and caring'
    case 'intimate':
      return 'soft, low, sensual adult companion, unhurried'
    case 'tired':
      return 'quiet, soft, brief caring tone'
    default:
      return 'warm, friendly, emotionally present female companion'
  }
}
