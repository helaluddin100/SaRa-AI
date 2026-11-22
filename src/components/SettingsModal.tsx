import { useEffect, useState } from 'react'
import {
  BANGLA_VOICES,
  ENGLISH_VOICES,
  VOICE_PRESETS,
  resolveVoiceRef,
} from '../lib/voiceCatalog'

type Settings = {
  geminiApiKey: string
  xaiApiKey: string
  aiProvider: 'gemini' | 'grok'
  model: string
  grokModel: string
  voiceEnabled: boolean
  ttsProvider: 'auto' | 'grok' | 'local'
  grokVoiceId: string
  userName: string
  voiceName: string
  voiceNameEn: string
  voiceNameBn: string
  whatsappContacts: Record<string, string>
  gmailUser: string
  gmailAppPassword: string
  facebookPageId: string
  facebookPageToken: string
}

type Props = {
  initial: Settings
  onClose: () => void
  onSave: (next: Settings) => Promise<void>
}

function contactsToText(contacts: Record<string, string> | undefined): string {
  return Object.entries(contacts || {})
    .map(([name, phone]) => `${name}=${phone}`)
    .join('\n')
}

function textToContacts(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split(/\n+/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const name = trimmed.slice(0, eq).trim()
    const phone = trimmed.slice(eq + 1).trim().replace(/[^\d+]/g, '')
    if (name && phone) out[name] = phone.replace(/^\+/, '')
  }
  return out
}

export function SettingsModal({ initial, onClose, onSave }: Props) {
  const [form, setForm] = useState({
    ...initial,
    xaiApiKey: initial.xaiApiKey || '',
    aiProvider: initial.aiProvider || (initial.xaiApiKey ? 'grok' : 'gemini'),
    grokModel: initial.grokModel || 'grok-4-1-fast-non-reasoning',
    ttsProvider: initial.ttsProvider || (initial.xaiApiKey ? 'grok' : 'auto'),
    grokVoiceId: initial.grokVoiceId || 'ara',
    voiceName: initial.voiceName === 'jarvis' || initial.voiceName === 'aria' ? initial.voiceName : 'aria',
    voiceNameEn: initial.voiceNameEn || '',
    voiceNameBn: initial.voiceNameBn || '',
  })
  const [contactsText, setContactsText] = useState(() => contactsToText(initial.whatsappContacts))
  const [saving, setSaving] = useState(false)
  const [previewLang, setPreviewLang] = useState<'en' | 'bn'>('en')
  const [grokVoices, setGrokVoices] = useState<Array<{ voice_id: string; name: string }>>([
    { voice_id: 'eve', name: 'Eve' },
    { voice_id: 'ara', name: 'Ara' },
    { voice_id: 'rex', name: 'Rex' },
  ])

  useEffect(() => {
    // warm lists (optional — catalog is local; IPC still available)
    void window.jarvis.listBanglaVoices().catch(() => undefined)
    void window.jarvis.listKokoroVoices().catch(() => undefined)
    void window.jarvis.listGrokVoices?.().then((v) => {
      if (v?.length) setGrokVoices(v)
    }).catch(() => undefined)
  }, [])

  async function handleSave() {
    setSaving(true)
    try {
      await onSave({
        ...form,
        whatsappContacts: textToContacts(contactsText),
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  async function previewVoice() {
    const sample =
      previewLang === 'bn'
        ? 'হ্যালো, আমি আরিয়া। গ্রক ভয়েস কানেক্টেড।'
        : 'Hello, I am Aria. Grok voice is connected.'
    if (form.ttsProvider === 'grok' || form.aiProvider === 'grok') {
      await window.jarvis.speakLocal({
        text: sample,
        voiceId: form.grokVoiceId || 'ara',
        rate: 1,
        pitch: 1,
        engine: 'grok',
      })
      return
    }
    const plan = resolveVoiceRef(previewLang === 'bn', {
      preset: form.voiceName,
      voiceNameEn: form.voiceNameEn,
      voiceNameBn: form.voiceNameBn,
    })
    await window.jarvis.speakLocal({
      text: sample,
      voiceId: plan.voiceId,
      rate: 1,
      pitch: plan.pitchBoost ?? 1,
      engine: plan.engine,
    })
  }

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel settings-panel-wide" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>
        <p>
          Chat + voice: <b>Grok (xAI)</b> recommended. Local Edge/Kokoro fallback থাকবে।
        </p>

        <div className="field">
          <label>Your name</label>
          <input
            value={form.userName}
            onChange={(e) => setForm((s) => ({ ...s, userName: e.target.value }))}
            placeholder="e.g. Helal"
          />
        </div>

        <div className="field">
          <label>AI provider</label>
          <select
            value={form.aiProvider}
            onChange={(e) =>
              setForm((s) => ({
                ...s,
                aiProvider: e.target.value as 'gemini' | 'grok',
                ttsProvider:
                  e.target.value === 'grok' ? 'grok' : s.ttsProvider === 'grok' ? 'auto' : s.ttsProvider,
              }))
            }
          >
            <option value="grok">Grok (xAI) ★</option>
            <option value="gemini">Gemini (Google)</option>
          </select>
        </div>

        <div className="field">
          <label>Grok / xAI API key</label>
          <input
            type="password"
            value={form.xaiApiKey}
            onChange={(e) => setForm((s) => ({ ...s, xaiApiKey: e.target.value }))}
            placeholder="xai-..."
          />
        </div>

        <div className="field">
          <label>Grok chat model</label>
          <select
            value={form.grokModel}
            onChange={(e) => setForm((s) => ({ ...s, grokModel: e.target.value }))}
          >
            <option value="grok-4-1-fast-non-reasoning">grok-4-1-fast-non-reasoning</option>
            <option value="grok-4-fast-non-reasoning">grok-4-fast-non-reasoning</option>
            <option value="grok-4-fast-reasoning">grok-4-fast-reasoning</option>
            <option value="grok-3">grok-3</option>
            <option value="grok-3-mini">grok-3-mini</option>
            <option value="grok-2-latest">grok-2-latest</option>
          </select>
        </div>

        <div className="field">
          <label>Gemini API key (optional — mic STT / vision fallback)</label>
          <input
            type="password"
            value={form.geminiApiKey}
            onChange={(e) => setForm((s) => ({ ...s, geminiApiKey: e.target.value }))}
            placeholder="AIza... or AQ...."
          />
        </div>

        <div className="field">
          <label>Gemini chat model</label>
          <select
            value={form.model}
            onChange={(e) => setForm((s) => ({ ...s, model: e.target.value }))}
          >
            <option value="gemini-3.8-flash">gemini-3.8-flash</option>
            <option value="gemini-flash-latest">gemini-flash-latest</option>
            <option value="gemini-3-flash-preview">gemini-3-flash-preview</option>
          </select>
        </div>

        <div className="field">
          <label>TTS provider</label>
          <select
            value={form.ttsProvider}
            onChange={(e) =>
              setForm((s) => ({ ...s, ttsProvider: e.target.value as 'auto' | 'grok' | 'local' }))
            }
          >
            <option value="grok">Grok voice (cloud) ★</option>
            <option value="auto">Auto (Grok if key, else local)</option>
            <option value="local">Local only (Edge / Kokoro / system)</option>
          </select>
        </div>

        <div className="field">
          <label>Grok voice</label>
          <select
            value={form.grokVoiceId}
            onChange={(e) => setForm((s) => ({ ...s, grokVoiceId: e.target.value }))}
          >
            {grokVoices.map((v) => (
              <option key={v.voice_id} value={v.voice_id}>
                {v.name || v.voice_id}
              </option>
            ))}
          </select>
          <p className="settings-hint" style={{ marginTop: 6 }}>
            Bangla + English — Grok TTS (`bn` / `auto`). Default <b>ara</b>.
          </p>
        </div>

        <div className="field-row">
          <label htmlFor="voiceEnabled">Speak replies</label>
          <input
            id="voiceEnabled"
            type="checkbox"
            checked={form.voiceEnabled}
            onChange={(e) => setForm((s) => ({ ...s, voiceEnabled: e.target.checked }))}
          />
        </div>

        <h3 className="settings-section">Voice persona</h3>
        <div className="field">
          <label>Default persona</label>
          <select
            value={form.voiceName}
            onChange={(e) =>
              setForm((s) => ({
                ...s,
                voiceName: e.target.value,
                voiceNameEn: '',
                voiceNameBn: '',
              }))
            }
          >
            {Object.values(VOICE_PRESETS).map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
                {p.id === 'aria' ? ' ★ default' : ''}
              </option>
            ))}
          </select>
          <p className="settings-hint" style={{ marginTop: 6 }}>
            ডিফল্ট = <b>Female (Nabanita)</b>। Male = Pradeep। পারসোনা বদলালে আগের override মুছে যায়।
          </p>
        </div>

        <div className="field">
          <label>English voice override (optional)</label>
          <select
            value={form.voiceNameEn}
            onChange={(e) => setForm((s) => ({ ...s, voiceNameEn: e.target.value }))}
          >
            <option value="">— persona default —</option>
            {ENGLISH_VOICES.map((v) => (
              <option key={v.id} value={v.id}>
                [{v.gender}] {v.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Bangla voice override (optional)</label>
          <select
            value={form.voiceNameBn}
            onChange={(e) => setForm((s) => ({ ...s, voiceNameBn: e.target.value }))}
          >
            <option value="">— persona default —</option>
            {BANGLA_VOICES.map((v) => (
              <option key={v.id} value={v.id}>
                [{v.gender}] {v.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field-row" style={{ gap: 12 }}>
          <label>
            <input
              type="radio"
              name="previewLang"
              checked={previewLang === 'en'}
              onChange={() => setPreviewLang('en')}
            />{' '}
            Preview English
          </label>
          <label>
            <input
              type="radio"
              name="previewLang"
              checked={previewLang === 'bn'}
              onChange={() => setPreviewLang('bn')}
            />{' '}
            Preview বাংলা
          </label>
        </div>

        <h3 className="settings-section">Screen agent (দেখে কাজ করে)</h3>
        <p className="settings-hint">
          একবার allow করো: Privacy → Screen Recording + Accessibility → Electron / Jarvis
        </p>
        <div className="field">
          <label>Facebook Page username / ID (optional)</label>
          <input
            value={form.facebookPageId}
            onChange={(e) => setForm((s) => ({ ...s, facebookPageId: e.target.value }))}
            placeholder="mybusinesspage"
          />
        </div>
        <div className="field">
          <label>Optional WhatsApp name aliases</label>
          <textarea
            rows={3}
            value={contactsText}
            onChange={(e) => setContactsText(e.target.value)}
            placeholder={'# optional\nJoya=Joya Robi'}
          />
        </div>
        <div className="field">
          <label>Optional Gmail IMAP</label>
          <input
            type="email"
            value={form.gmailUser}
            onChange={(e) => setForm((s) => ({ ...s, gmailUser: e.target.value }))}
            placeholder="you@gmail.com"
          />
        </div>
        <div className="field">
          <label>Optional Gmail App Password</label>
          <input
            type="password"
            value={form.gmailAppPassword}
            onChange={(e) => setForm((s) => ({ ...s, gmailAppPassword: e.target.value }))}
          />
        </div>
        <div className="settings-actions">
          <button className="icon-btn" type="button" onClick={() => void previewVoice()}>
            Preview
          </button>
          <button className="icon-btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="send-btn" type="button" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
