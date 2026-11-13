/** System + neural voice catalog for Jarvis Desktop */

export type VoiceEngine = 'kokoro' | 'piper-bn' | 'edge-bn' | 'system'

export type VoiceRef = {
  engine: VoiceEngine
  voiceId: string
  pitchBoost?: number
}

export type VoicePresetId = 'jarvis' | 'aria'

export type VoicePreset = {
  id: VoicePresetId
  label: string
  gender: 'male' | 'female'
  /** English replies */
  en: VoiceRef
  /** Bangla replies */
  bn: VoiceRef
  enFallback: VoiceRef
  bnFallback: VoiceRef
}

/**
 * macOS has no voice literally named "Jarvis".
 * Classic Jarvis EN = Daniel (system).
 * Best FREE clear Bangla = Microsoft Edge neural (bn-BD-Pradeep / Nabanita) via edge-tts.
 * Offline fallback = macOS Piya. Piper kept as last-resort local neural.
 * Kokoro has no Bengali voices.
 */
export const VOICE_PRESETS: Record<VoicePresetId, VoicePreset> = {
  jarvis: {
    id: 'jarvis',
    label: 'Jarvis — Male (British)',
    gender: 'male',
    en: { engine: 'system', voiceId: 'Daniel', pitchBoost: 1 },
    bn: { engine: 'edge-bn', voiceId: 'bn-BD-PradeepNeural', pitchBoost: 1 },
    enFallback: { engine: 'kokoro', voiceId: 'bm_daniel', pitchBoost: 0.98 },
    bnFallback: { engine: 'system', voiceId: 'Piya', pitchBoost: 1 },
  },
  aria: {
    id: 'aria',
    label: 'Aria — Female',
    gender: 'female',
    en: { engine: 'system', voiceId: 'Samantha', pitchBoost: 1.05 },
    bn: { engine: 'edge-bn', voiceId: 'bn-BD-NabanitaNeural', pitchBoost: 1 },
    enFallback: { engine: 'kokoro', voiceId: 'af_heart', pitchBoost: 1.06 },
    bnFallback: { engine: 'system', voiceId: 'Piya', pitchBoost: 1 },
  },
}

export const ENGLISH_VOICES: Array<{ id: string; label: string; gender: 'male' | 'female'; engine: VoiceEngine }> =
  [
    { id: 'bm_daniel', label: 'Jarvis / Daniel — British male (Kokoro)', gender: 'male', engine: 'kokoro' },
    { id: 'bm_george', label: 'George — British male', gender: 'male', engine: 'kokoro' },
    { id: 'am_michael', label: 'Michael — US male', gender: 'male', engine: 'kokoro' },
    { id: 'am_fenrir', label: 'Fenrir — deep US male', gender: 'male', engine: 'kokoro' },
    { id: 'say:Daniel', label: 'Daniel — macOS British male', gender: 'male', engine: 'system' },
    { id: 'af_heart', label: 'Heart — US female', gender: 'female', engine: 'kokoro' },
    { id: 'af_bella', label: 'Bella — warm US female', gender: 'female', engine: 'kokoro' },
    { id: 'bf_emma', label: 'Emma — British female', gender: 'female', engine: 'kokoro' },
    { id: 'bf_isabella', label: 'Isabella — British female', gender: 'female', engine: 'kokoro' },
    { id: 'say:Samantha', label: 'Samantha — macOS US female', gender: 'female', engine: 'system' },
    { id: 'say:Moira', label: 'Moira — macOS Irish female', gender: 'female', engine: 'system' },
  ]

export const BANGLA_VOICES: Array<{ id: string; label: string; gender: 'male' | 'female'; engine: VoiceEngine }> =
  [
    {
      id: 'bn-BD-PradeepNeural',
      label: 'Pradeep — বাংলা Male (Edge neural) ★ Jarvis default',
      gender: 'male',
      engine: 'edge-bn',
    },
    {
      id: 'bn-BD-NabanitaNeural',
      label: 'Nabanita — বাংলা Female (Edge neural) ★ Aria default',
      gender: 'female',
      engine: 'edge-bn',
    },
    { id: 'bn-IN-BashkarNeural', label: 'Bashkar — বাংলা Male (IN, Edge)', gender: 'male', engine: 'edge-bn' },
    { id: 'bn-IN-TanishaaNeural', label: 'Tanishaa — বাংলা Female (IN, Edge)', gender: 'female', engine: 'edge-bn' },
    { id: 'piya', label: 'Piya — বাংলা offline (macOS)', gender: 'female', engine: 'system' },
    { id: 'bn_f_10', label: 'Piper Female A — offline local', gender: 'female', engine: 'piper-bn' },
    { id: 'bn_m_0', label: 'Piper Male A — offline local', gender: 'male', engine: 'piper-bn' },
  ]

export function isVoicePreset(id: string): id is VoicePresetId {
  return id === 'jarvis' || id === 'aria'
}

export function resolveVoiceRef(
  textIsBangla: boolean,
  options: {
    preset?: string
    voiceNameEn?: string
    voiceNameBn?: string
  },
): VoiceRef {
  const presetId: VoicePresetId = isVoicePreset(options.preset || '')
    ? (options.preset as VoicePresetId)
    : 'aria'
  const preset = VOICE_PRESETS[presetId]

  if (textIsBangla) {
    const override = (options.voiceNameBn || '').trim()
    if (override) return parseVoiceId(override, 'bn', preset)
    return preset.bn
  }

  const override = (options.voiceNameEn || '').trim()
  if (override) return parseVoiceId(override, 'en', preset)
  return preset.en
}

function parseVoiceId(id: string, lang: 'en' | 'bn', preset: VoicePreset): VoiceRef {
  if (id.startsWith('say:')) {
    return { engine: 'system', voiceId: id.slice(4), pitchBoost: lang === 'bn' ? 1.08 : 1 }
  }
  if (id === 'piya' || id === 'Piya') {
    return { engine: 'system', voiceId: 'Piya', pitchBoost: 1 }
  }
  if (id === 'Daniel') {
    return { engine: 'system', voiceId: 'Daniel', pitchBoost: 1 }
  }
  if (id.startsWith('bn-BD-') || id.startsWith('bn-IN-')) {
    return { engine: 'edge-bn', voiceId: id, pitchBoost: 1 }
  }
  if (id.startsWith('bn_')) {
    return { engine: 'piper-bn', voiceId: id, pitchBoost: 1 }
  }
  if (/^[abefhijmpz][fm]_/.test(id)) {
    return { engine: 'kokoro', voiceId: id, pitchBoost: id.includes('m_') ? 0.98 : 1.06 }
  }
  // Unknown → preset default for language
  return lang === 'bn' ? preset.bn : preset.en
}
