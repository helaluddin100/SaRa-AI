import { styleToProsody, textLooksBangla } from './voices'

export function stopSpeaking() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel()
  void window.jarvis?.stopLocalSpeak?.()
}

/**
 * Local TTS only:
 * - বাংলা → Piper Bangla female neural (bn_f_*)
 * - English → Kokoro female neural (af_*)
 */
export async function speak(options: {
  text: string
  enabled?: boolean
  voiceName?: string
  voiceStyle?: string
}): Promise<void> {
  const { text, enabled = true, voiceName, voiceStyle } = options
  if (!enabled || !text.trim()) return

  stopSpeaking()
  const { rate, pitch } = styleToProsody(voiceStyle)
  const banglaPreferred =
    textLooksBangla(text) || Boolean(voiceName?.startsWith('bn_f_')) || voiceName === 'auto-bn'

  if (banglaPreferred) {
    const result = await window.jarvis.speakLocal({
      text,
      voiceId: voiceName?.startsWith('bn_f_') ? voiceName : 'bn_f_10',
      rate,
      pitch,
      engine: 'piper-bn',
    })
    if (result.ok) return
    // fallback system Piya (macOS Bangla female)
    await window.jarvis.speakLocal({ text, voiceId: 'Piya', rate, pitch, engine: 'system' })
    return
  }

  const result = await window.jarvis.speakLocal({
    text,
    voiceId: voiceName?.startsWith('af_') || voiceName?.startsWith('bf_') ? voiceName : 'af_heart',
    rate,
    pitch,
    engine: 'kokoro',
  })
  if (!result.ok) {
    await window.jarvis.speakLocal({ text, voiceId: 'Samantha', rate, pitch, engine: 'system' })
  }
}

function pickMimeType(): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ]
  for (const type of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) {
      return type
    }
  }
  return 'audio/webm'
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export type MicAudio = { base64: string; mimeType: string; byteLength: number }

export type MicSession = {
  /** Force-end recording (also used by VAD). Safe to call once. */
  stop: () => Promise<MicAudio>
  /** Resolves when recording ends (manual stop or silence VAD). */
  result: Promise<MicAudio>
}

type CaptureOptions = {
  /** Auto-stop after silence once speech was detected (continuous talk mode) */
  vad?: boolean
  silenceMs?: number
  maxMs?: number
}

export async function startMicCapture(options: CaptureOptions = {}): Promise<MicSession> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone API not available in this build')
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  })

  const mimeType = pickMimeType()
  const recorder = new MediaRecorder(stream, { mimeType })
  const chunks: Blob[] = []
  let stopped = false
  let audioCtx: AudioContext | null = null
  let settle!: (value: MicAudio | PromiseLike<MicAudio>) => void
  let fail!: (reason?: unknown) => void
  const result = new Promise<MicAudio>((resolve, reject) => {
    settle = resolve
    fail = reject
  })

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  }

  recorder.start(250)

  const stopInternal = () => {
    if (stopped) return result
    stopped = true

    const finish = async () => {
      try {
        stream.getTracks().forEach((t) => t.stop())
        void audioCtx?.close().catch(() => undefined)
        const blob = new Blob(chunks, { type: mimeType.split(';')[0] })
        if (blob.size < 800) {
          fail(new Error('No speech captured. Speak a bit longer.'))
          return
        }
        const base64 = await blobToBase64(blob)
        settle({
          base64,
          mimeType: blob.type || mimeType.split(';')[0],
          byteLength: blob.size,
        })
      } catch (error) {
        fail(error)
      }
    }

    recorder.onerror = () => {
      stream.getTracks().forEach((t) => t.stop())
      fail(new Error('Microphone recording failed'))
    }

    if (recorder.state === 'inactive') {
      void finish()
      return result
    }

    recorder.onstop = () => {
      void finish()
    }
    recorder.stop()
    return result
  }

  if (options.vad) {
    const silenceMs = options.silenceMs ?? 1400
    const maxMs = options.maxMs ?? 28000
    const startedAt = Date.now()
    let heardSpeech = false
    let lastLoudAt = Date.now()

    audioCtx = new AudioContext()
    const source = audioCtx.createMediaStreamSource(stream)
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 2048
    source.connect(analyser)
    const data = new Uint8Array(analyser.fftSize)

    const tick = () => {
      if (stopped) return
      analyser.getByteTimeDomainData(data)
      let sum = 0
      for (let i = 0; i < data.length; i += 1) {
        const v = (data[i]! - 128) / 128
        sum += v * v
      }
      const rms = Math.sqrt(sum / data.length)
      if (rms > 0.045) {
        heardSpeech = true
        lastLoudAt = Date.now()
      }
      const now = Date.now()
      if (heardSpeech && now - lastLoudAt >= silenceMs) {
        stopInternal()
        return
      }
      if (now - startedAt >= maxMs) {
        stopInternal()
        return
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }

  return {
    stop: () => stopInternal(),
    result,
  }
}

export async function transcribeWithGemini(options: {
  apiKey: string
  model: string
  base64: string
  mimeType: string
}): Promise<string> {
  const { apiKey, model, base64, mimeType } = options
  if (!apiKey.trim()) {
    throw new Error('Gemini API key missing. Open Settings and paste your key.')
  }

  const result = await window.jarvis.geminiGenerate({
    apiKey,
    model,
    body: {
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: mimeType || 'audio/webm',
                data: base64,
              },
            },
            {
              text: 'Transcribe this voice note into plain text only. Keep the original language (English, Bangla, Hindi-Urdu, or mixed). Do not add quotes, labels, or commentary. If silence, return an empty string.',
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        thinkingConfig: { thinkingLevel: 'low' },
      },
    },
  })

  if (!result.ok) {
    throw new Error(`Transcription failed (${result.status}): ${result.error}`)
  }

  const data = result.data as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>
  }
  const text =
    data.candidates?.[0]?.content?.parts
      ?.filter((p) => typeof p.text === 'string' && !p.thought)
      .map((p) => p.text || '')
      .join(' ')
      .trim() || ''

  return text
}
