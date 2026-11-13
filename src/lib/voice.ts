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
  const { rate } = styleToProsody(voiceStyle)
  const banglaPreferred =
    textLooksBangla(text) || Boolean(voiceName?.startsWith('bn_f_')) || voiceName === 'auto-bn'

  if (banglaPreferred) {
    const result = await window.jarvis.speakLocal({
      text,
      voiceId: voiceName?.startsWith('bn_f_') ? voiceName : 'bn_f_3',
      rate,
      engine: 'piper-bn',
    })
    if (result.ok) return
    // fallback system Piya
    await window.jarvis.speakLocal({ text, voiceId: 'Piya', rate, engine: 'system' })
    return
  }

  const result = await window.jarvis.speakLocal({
    text,
    voiceId: voiceName?.startsWith('af_') || voiceName?.startsWith('bf_') ? voiceName : 'af_heart',
    rate,
    engine: 'kokoro',
  })
  if (!result.ok) {
    await window.jarvis.speakLocal({ text, voiceId: 'Samantha', rate, engine: 'system' })
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

export type MicSession = {
  stop: () => Promise<{ base64: string; mimeType: string; byteLength: number }>
}

export async function startMicCapture(): Promise<MicSession> {
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

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  }

  recorder.start(250)

  return {
    stop: () =>
      new Promise((resolve, reject) => {
        const finish = async () => {
          try {
            stream.getTracks().forEach((t) => t.stop())
            const blob = new Blob(chunks, { type: mimeType.split(';')[0] })
            if (blob.size < 800) {
              reject(new Error('No speech captured. Hold mic a moment longer, then click again.'))
              return
            }
            const base64 = await blobToBase64(blob)
            resolve({
              base64,
              mimeType: blob.type || mimeType.split(';')[0],
              byteLength: blob.size,
            })
          } catch (error) {
            reject(error)
          }
        }

        recorder.onerror = () => {
          stream.getTracks().forEach((t) => t.stop())
          reject(new Error('Microphone recording failed'))
        }

        if (recorder.state === 'inactive') {
          void finish()
          return
        }

        recorder.onstop = () => {
          void finish()
        }
        recorder.stop()
      }),
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
