import { useEffect, useState } from 'react'

type Settings = {
  geminiApiKey: string
  model: string
  voiceEnabled: boolean
  userName: string
  voiceName: string
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
  const [form, setForm] = useState(initial)
  const [contactsText, setContactsText] = useState(() => contactsToText(initial.whatsappContacts))
  const [saving, setSaving] = useState(false)
  const [banglaVoices, setBanglaVoices] = useState<Array<{ id: string; label: string }>>([])
  const [englishVoices, setEnglishVoices] = useState<Array<{ id: string; label: string }>>([])

  useEffect(() => {
    void window.jarvis.listBanglaVoices().then(setBanglaVoices)
    void window.jarvis.listKokoroVoices().then(setEnglishVoices)
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
    const isBn = form.voiceName.startsWith('bn_f_')
    await window.jarvis.speakLocal({
      text: isBn
        ? 'হ্যালো, আমি আরিয়া। এটা তোমার লোকাল বাংলা ফিমেল ভয়েস।'
        : 'Hello, I am Aria. This is the local English neural voice.',
      voiceId: form.voiceName,
      rate: 1,
      engine: isBn ? 'piper-bn' : 'kokoro',
    })
  }

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel settings-panel-wide" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>
        <p>
          বাংলা উত্তর <b>Piper Bangla female</b> (লোকাল)। WhatsApp / Gmail / Facebook Page নিচে সেট করো — তারপর voice
          দিয়ে বললে Aria টুল চালাবে।
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

        <div className="field">
          <label>বাংলা Female voice (recommended)</label>
          <select
            value={form.voiceName.startsWith('bn_f_') ? form.voiceName : 'bn_f_3'}
            onChange={(e) => setForm((s) => ({ ...s, voiceName: e.target.value }))}
          >
            {(banglaVoices.length
              ? banglaVoices
              : [{ id: 'bn_f_3', label: 'বাংলা Female A (natural)' }]
            ).map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>English Female voice (optional)</label>
          <select
            value={
              form.voiceName.startsWith('af_') || form.voiceName.startsWith('bf_')
                ? form.voiceName
                : ''
            }
            onChange={(e) => {
              if (e.target.value) setForm((s) => ({ ...s, voiceName: e.target.value }))
            }}
          >
            <option value="">— বাংলা ভয়েসই ডিফল্ট রাখো —</option>
            {(englishVoices.length
              ? englishVoices
              : [{ id: 'af_heart', label: 'Heart — US female' }]
            ).map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </div>

        <h3 className="settings-section">Screen agent (দেখে কাজ করে)</h3>
        <p className="settings-hint">
          Aria এখন স্ক্রিন দেখে টাস্ক নেয় → ক্লিক/টাইপ করে → শেষ হলে জানায় (অন্য AI agent-এর মতো)।
          <br />
          একবার allow করো:
          <br />
          1) <b>Privacy → Screen Recording</b> → Electron / Jarvis
          <br />
          2) <b>Privacy → Accessibility</b> → Electron / Jarvis
          <br />
          Chrome লগইন থাকলে Facebook পোস্ট / Gmail নিজে করতে পারবে।
          <br />
          3) Chrome → <b>View → Developer → Allow JavaScript from Apple Events</b> (Facebook পোস্টের জন্য)
        </p>
        <div className="field">
          <label>Facebook Page username / ID (optional)</label>
          <input
            value={form.facebookPageId}
            onChange={(e) => setForm((s) => ({ ...s, facebookPageId: e.target.value }))}
            placeholder="mybusinesspage — খালি রাখলে Business Inbox খুলবে"
          />
        </div>
        <div className="field">
          <label>Optional WhatsApp name aliases (rarely needed)</label>
          <textarea
            rows={3}
            value={contactsText}
            onChange={(e) => setContactsText(e.target.value)}
            placeholder={'# optional only\nJoya=Joya Robi'}
          />
        </div>
        <div className="field">
          <label>Optional Gmail IMAP (else browser Gmail)</label>
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
            placeholder="খালি রাখলে ব্রাউজার Gmail ব্যবহার হবে"
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
