import { useEffect, useState } from 'react'
import {
  BANGLA_VOICES,
  ENGLISH_VOICES,
  VOICE_PRESETS,
  resolveVoiceRef,
} from '../lib/voiceCatalog'

type Settings = {
  geminiApiKey: string
  model: string
  voiceEnabled: boolean
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
    voiceName: initial.voiceName === 'jarvis' || initial.voiceName === 'aria' ? initial.voiceName : 'aria',
    voiceNameEn: initial.voiceNameEn || '',
    voiceNameBn: initial.voiceNameBn || '',
  })
  const [contactsText, setContactsText] = useState(() => contactsToText(initial.whatsappContacts))
  const [saving, setSaving] = useState(false)
  const [previewLang, setPreviewLang] = useState<'en' | 'bn'>('en')

  useEffect(() => {
    // warm lists (optional — catalog is local; IPC still available)
    void window.jarvis.listBanglaVoices().catch(() => undefined)
    void window.jarvis.listKokoroVoices().catch(() => undefined)
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
        ? 'হ্যালো স্যার, আমি জার্ভিস। সব সিস্টেম অপারেশনাল।'
        : 'Good evening sir. I am Jarvis. All systems are operational.'
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
          ইংরেজি: <b>Daniel</b>। বাংলা: <b>Edge neural Pradeep/Nabanita</b> (ফ্রি, পরিষ্কার) — অফলাইনে Piya
          fallback।
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
          <label>Gemini API key (chat only)</label>
          <input
            type="password"
            value={form.geminiApiKey}
            onChange={(e) => setForm((s) => ({ ...s, geminiApiKey: e.target.value }))}
            placeholder="AIza... or AQ...."
          />
        </div>

        <div className="field">
          <label>Chat model</label>
          <select
            value={form.model}
            onChange={(e) => setForm((s) => ({ ...s, model: e.target.value }))}
          >
            <option value="gemini-3.8-flash">gemini-3.8-flash</option>
            <option value="gemini-flash-latest">gemini-flash-latest</option>
            <option value="gemini-3-flash-preview">gemini-3-flash-preview</option>
          </select>
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
