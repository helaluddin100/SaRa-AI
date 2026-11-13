import { ImapFlow } from 'imapflow'
import type { AppSettings } from './store'
import {
  checkFacebookPageInBrowser,
  checkGmailInBrowser,
  openWhatsAppApp,
  postFacebookStatusInBrowser,
  sendWhatsAppToContact,
} from './ui-automation'

export async function openWhatsApp(): Promise<{ ok: boolean; message: string }> {
  return openWhatsAppApp()
}

/**
 * Voice command path: search contact BY NAME inside WhatsApp and send (UI automation).
 * Optional Settings phone book only used if contact looks like a raw phone number.
 */
export async function sendWhatsAppMessage(
  settings: AppSettings,
  contactOrPhone: string,
  message: string,
): Promise<{ ok: boolean; message: string }> {
  const raw = contactOrPhone.trim()
  const text = message.trim()
  if (!text) return { ok: false, message: 'মেসেজ কী লিখব বলো।' }
  if (!raw) return { ok: false, message: 'কাকে পাঠাব? নাম বলো — যেমন Joya Robi।' }

  // Digits-only → still try name automation first if mapped; else deep-link is not preferred.
  // Always prefer WhatsApp UI search by the spoken name.
  const contacts = settings.whatsappContacts || {}
  const mapped = Object.entries(contacts).find(
    ([name]) => name.toLowerCase() === raw.toLowerCase(),
  )
  const searchName = mapped ? mapped[0] : raw

  return sendWhatsAppToContact(searchName, text)
}

const IMPORTANT_HINTS =
  /urgent|important|invoice|payment|otp|bank|security|verify|deadline|interview|offer|bill|পেমেন্ট|জরুরি|ব্যাংক|ইনভয়েস|অফার/i

export async function checkEmail(
  settings: AppSettings,
): Promise<{
  ok: boolean
  message: string
  unread?: number
  important?: Array<{ from: string; subject: string; date: string }>
}> {
  // Prefer logged-in browser (voice-command style). IMAP only if App Password is set.
  const user = settings.gmailUser?.trim()
  const pass = settings.gmailAppPassword?.trim().replace(/\s+/g, '')
  if (!user || !pass) {
    return checkGmailInBrowser()
  }

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false,
  })

  try {
    await client.connect()
    const lock = await client.getMailboxLock('INBOX')
    try {
      const unread = typeof client.mailbox === 'object' && client.mailbox ? client.mailbox.exists : 0
      // Search recent unseen
      const uids = await client.search({ seen: false }, { uid: true })
      const list = Array.isArray(uids) ? uids.slice(-25) : []
      const important: Array<{ from: string; subject: string; date: string }> = []

      if (list.length) {
        for await (const msg of client.fetch(list, {
          uid: true,
          envelope: true,
          flags: true,
        })) {
          const from = msg.envelope?.from?.[0]
          const fromStr = from ? `${from.name || ''} <${from.address || ''}>`.trim() : 'unknown'
          const subject = msg.envelope?.subject || '(no subject)'
          const date = msg.envelope?.date ? new Date(msg.envelope.date).toISOString() : ''
          const flagged = Array.isArray(msg.flags) && [...msg.flags].some((f) => /flagged/i.test(String(f)))
          if (flagged || IMPORTANT_HINTS.test(`${fromStr} ${subject}`)) {
            important.push({ from: fromStr, subject, date })
          }
        }
      }

      // If nothing matched keywords, still show top unread subjects
      if (important.length === 0 && list.length) {
        let shown = 0
        for await (const msg of client.fetch(list.slice(-5), { envelope: true })) {
          const from = msg.envelope?.from?.[0]
          important.push({
            from: from ? `${from.name || ''} <${from.address || ''}>`.trim() : 'unknown',
            subject: msg.envelope?.subject || '(no subject)',
            date: msg.envelope?.date ? new Date(msg.envelope.date).toISOString() : '',
          })
          shown += 1
          if (shown >= 5) break
        }
      }

      const unreadCount = list.length || unread
      if (unreadCount === 0) {
        return { ok: true, message: 'ইনবক্সে নতুন unread মেইল নেই।', unread: 0, important: [] }
      }

      const lines = important.slice(0, 8).map((m, i) => `${i + 1}. ${m.subject} — ${m.from}`)
      return {
        ok: true,
        unread: unreadCount,
        important,
        message:
          `Unread মেইল: ${unreadCount}।` +
          (lines.length ? ` গুরুত্বপূর্ণ/সাম্প্রতিক:\n${lines.join('\n')}` : ''),
      }
    } finally {
      lock.release()
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      message: `মেইল চেক ব্যর্থ: ${message}. App Password ঠিক আছে কি? IMAP চালু আছে তো?`,
    }
  } finally {
    try {
      await client.logout()
    } catch {
      // ignore
    }
  }
}

export async function checkFacebookPageMessages(
  settings: AppSettings,
): Promise<{
  ok: boolean
  message: string
  conversations?: Array<{ from: string; preview: string; updated: string }>
}> {
  // Voice path: use already-logged-in Chrome/Safari. Optional page id/slug from settings as URL hint.
  const hint = settings.facebookPageId?.trim() || ''
  return checkFacebookPageInBrowser(hint)
}

export async function postFacebookStatus(
  text: string,
): Promise<{ ok: boolean; message: string }> {
  return postFacebookStatusInBrowser(text)
}
