import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'

const execFileAsync = promisify(execFile)
const platform = os.platform()

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

async function runOsascript(source: string): Promise<string> {
  const { stdout } = await execFileAsync('osascript', ['-e', source], {
    maxBuffer: 4 * 1024 * 1024,
    timeout: 120_000,
  })
  return String(stdout || '').trim()
}

async function pasteViaClipboardMac(text: string): Promise<void> {
  const escaped = escapeAppleScriptString(text)
  await runOsascript(`set the clipboard to "${escaped}"`)
  await runOsascript(`
tell application "System Events"
  keystroke "v" using command down
end tell
`)
}

/** Open WhatsApp Desktop (or Web fallback). */
export async function openWhatsAppApp(): Promise<{ ok: boolean; message: string }> {
  try {
    if (platform === 'darwin') {
      try {
        await execFileAsync('open', ['-a', 'WhatsApp'])
        return { ok: true, message: 'WhatsApp খোলা হয়েছে।' }
      } catch {
        await execFileAsync('open', ['https://web.whatsapp.com'])
        return { ok: true, message: 'WhatsApp Desktop না পেয়ে Web খোলা হয়েছে।' }
      }
    }
    if (platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', 'whatsapp:'], { detached: true, stdio: 'ignore' }).unref()
      return { ok: true, message: 'WhatsApp খোলার চেষ্টা করা হয়েছে।' }
    }
    spawn('xdg-open', ['https://web.whatsapp.com'], { detached: true, stdio: 'ignore' }).unref()
    return { ok: true, message: 'WhatsApp Web খোলা হয়েছে।' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Voice-style WhatsApp send: open app → search contact by name → type message → Send.
 * Uses macOS Accessibility (System Events). No phone book / Settings contacts needed.
 */
export async function sendWhatsAppToContact(
  contactName: string,
  message: string,
): Promise<{ ok: boolean; message: string }> {
  const contact = contactName.trim()
  const text = message.trim()
  if (!contact) return { ok: false, message: 'কন্টাক্টের নাম বলো — যেমন Joya Robi।' }
  if (!text) return { ok: false, message: 'মেসেজ কী লিখব বলো।' }

  if (platform !== 'darwin') {
    return sendWhatsAppWindows(contact, text)
  }

  try {
    await execFileAsync('open', ['-a', 'WhatsApp'])
  } catch {
    return {
      ok: false,
      message: 'WhatsApp Desktop পাওয়া যায়নি। Mac App Store থেকে WhatsApp ইনস্টল করো।',
    }
  }

  await sleep(1400)

  try {
    // Cmd+N = new chat / search (WhatsApp Desktop). Pick first result, paste message, Return = send.
    await runOsascript(`
tell application "WhatsApp" to activate
delay 0.6
tell application "System Events"
  tell process "WhatsApp"
    set frontmost to true
    keystroke "n" using command down
    delay 0.55
  end tell
end tell
`)
    await pasteViaClipboardMac(contact)
    await sleep(900)
    await runOsascript(`
tell application "System Events"
  tell process "WhatsApp"
    key code 125
    delay 0.25
    key code 36
    delay 0.7
  end tell
end tell
`)
    await pasteViaClipboardMac(text)
    await sleep(350)
    await runOsascript(`
tell application "System Events"
  tell process "WhatsApp"
    key code 36
  end tell
end tell
`)

    return {
      ok: true,
      message: `WhatsApp-এ "${contact}"-কে মেসেজ পাঠানো হয়েছে: ${text}`,
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (/not allowed|assistive|accessibility|1002/i.test(msg)) {
      return {
        ok: false,
        message:
          'macOS Accessibility লাগবে। System Settings → Privacy & Security → Accessibility → Jarvis / Electron চালু করো, তারপর আবার বলো।',
      }
    }
    return { ok: false, message: `WhatsApp অটোমেশন ব্যর্থ: ${msg}` }
  }
}

async function sendWhatsAppWindows(
  contact: string,
  text: string,
): Promise<{ ok: boolean; message: string }> {
  try {
    spawn('cmd', ['/c', 'start', '', 'whatsapp:'], { detached: true, stdio: 'ignore' }).unref()
    await sleep(2000)
    const ps = `
Add-Type -AssemblyName System.Windows.Forms
Start-Sleep -Milliseconds 400
[System.Windows.Forms.SendKeys]::SendWait('^n')
Start-Sleep -Milliseconds 500
[System.Windows.Forms.SendKeys]::SendWait('${contact.replace(/'/g, "''")}')
Start-Sleep -Milliseconds 900
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
Start-Sleep -Milliseconds 700
[System.Windows.Forms.SendKeys]::SendWait('${text.replace(/'/g, "''")}')
Start-Sleep -Milliseconds 300
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
`
    await execFileAsync('powershell', ['-NoProfile', '-Command', ps], { timeout: 60_000 })
    return { ok: true, message: `WhatsApp-এ "${contact}"-কে মেসেজ পাঠানোর চেষ্টা করা হয়েছে।` }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

function chromeExists(): boolean {
  return fs.existsSync('/Applications/Google Chrome.app')
}

function findDefaultBrowserMac(): 'chrome' | 'safari' {
  return chromeExists() ? 'chrome' : 'safari'
}

export async function openUrlInBrowser(url: string): Promise<'chrome' | 'safari'> {
  if (platform !== 'darwin') {
    if (platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref()
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref()
    }
    return 'chrome'
  }
  const browser = findDefaultBrowserMac()
  if (browser === 'chrome') {
    await runOsascript(`
tell application "Google Chrome"
  activate
  if (count of windows) = 0 then make new window
  set URL of active tab of front window to "${escapeAppleScriptString(url)}"
end tell
`)
  } else {
    await runOsascript(`
tell application "Safari"
  activate
  open location "${escapeAppleScriptString(url)}"
end tell
`)
  }
  return browser
}

export async function readBrowserPageText(browser: 'chrome' | 'safari'): Promise<string> {
  if (platform !== 'darwin') return ''

  if (browser === 'chrome') {
    // Needs: View → Developer → Allow JavaScript from Apple Events
    const out = await runOsascript(`
tell application "Google Chrome"
  set t to execute front window's active tab javascript "(() => { try { return (document.body && document.body.innerText) ? document.body.innerText.slice(0, 4500) : '' } catch (e) { return '' } })()"
  return t
end tell
`)
    return out
  }

  const out = await runOsascript(`
tell application "Safari"
  set t to do JavaScript "(() => { try { return (document.body && document.body.innerText) ? document.body.innerText.slice(0, 4500) : '' } catch (e) { return '' } })()" in document 1
  return t
end tell
`)
  return out
}

function summarizeInboxText(raw: string, label: string): string {
  const cleaned = raw
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && l.length > 1)
    .filter((l) => !/^(home|watch|marketplace|groups|menu|search|log in)/i.test(l))
    .slice(0, 40)

  if (!cleaned.length) {
    return `${label} ব্রাউজারে খোলা হয়েছে। পেজ লোড/লগইন চেক করো — টেক্সট পড়া যায়নি।`
  }

  const preview = cleaned.slice(0, 18).join('\n')
  return `${label} (লগইন করা ব্রাউজার থেকে):\n${preview}`
}

export async function chromeExecJs(js: string): Promise<string> {
  // Collapse newlines so AppleScript -e string stays valid
  const compact = js.replace(/\s*\n\s*/g, ' ').trim()
  const escaped = escapeAppleScriptString(compact)
  return runOsascript(`
tell application "Google Chrome"
  activate
  if (count of windows) = 0 then make new window
  set t to execute front window's active tab javascript "${escaped}"
  return t
end tell
`)
}

/**
 * Post a status update on the user's already-logged-in Facebook (Chrome).
 * Uses DOM clicks + clipboard paste — more reliable than vision mouse clicks on the composer.
 */
export async function postFacebookStatusInBrowser(text: string): Promise<{
  ok: boolean
  message: string
}> {
  const body = text.trim()
  if (!body) return { ok: false, message: 'পোস্টে কী লিখব বলো।' }

  if (platform !== 'darwin') {
    return {
      ok: false,
      message: 'Facebook পোস্ট অটোমেশন আপাতত macOS Chrome-এ সাপোর্টেড।',
    }
  }

  if (!chromeExists()) {
    return { ok: false, message: 'Google Chrome লাগবে — Facebook পোস্ট করতে Chrome ইনস্টল করো।' }
  }

  try {
    await openUrlInBrowser('https://www.facebook.com/')
    await sleep(2500)

    // Fail fast if Chrome blocks AppleScript JS — caller falls back to vision+click
    try {
      const probe = await chromeExecJs(`(() => 'hello-js-probe')()`)
      if (!String(probe).includes('hello-js-probe')) {
        return {
          ok: false,
          message:
            'Chrome JavaScript from Apple Events চালু নেই — vision click দিয়ে চেষ্টা হবে।',
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      if (/javascript|allow|osascript|turned off/i.test(msg)) {
        return {
          ok: false,
          message:
            'Chrome-এ JavaScript from Apple Events বন্ধ। Vision/click fallback চালু হবে।',
        }
      }
      throw error
    }

    await sleep(2000)

    // 1) Open create-post composer ("What's on your mind?")
    let openResult = ''
    try {
      openResult = await chromeExecJs(`(() => {
  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 8 && r.height > 8;
  };
  const score = (s) => {
    const t = String(s || '').toLowerCase();
    if ((t.includes("what's on your mind") || t.includes('whats on your mind'))) return 3;
    if (t.includes('মনে কী') || t.includes('মনে কি')) return 3;
    if (t.includes('create a post') || t.includes('create post') || t.includes('write something')) return 2;
    return 0;
  };
  const nodes = Array.from(document.querySelectorAll('[role="button"], div[role="button"], span[role="button"]'));
  let best = null, bestScore = 0;
  for (const el of nodes) {
    if (!visible(el)) continue;
    const label = (el.getAttribute('aria-label') || '') + ' ' + (el.innerText || '');
    const sc = score(label);
    if (sc > bestScore) { bestScore = sc; best = el; }
  }
  if (best) { best.click(); return 'opened:' + bestScore; }
  const editors = Array.from(document.querySelectorAll('[contenteditable="true"], [role="textbox"]'));
  for (const ed of editors) {
    if (visible(ed)) { ed.focus(); ed.click(); return 'focused_existing'; }
  }
  return 'composer_not_found';
})()`)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      if (/javascript|allow|osascript/i.test(msg)) {
        return {
          ok: false,
          message:
            'Chrome-এ JavaScript from Apple Events বন্ধ আছে। View → Developer → “Allow JavaScript from Apple Events” চালু করে আবার বলো।',
        }
      }
      throw error
    }

    if (openResult.includes('composer_not_found')) {
      return {
        ok: false,
        message:
          'Facebook composer পাওয়া যায়নি — লগইন/ফিড লোড চেক করো, তারপর আবার বলো।',
      }
    }

    await sleep(1600)

    // 2) Focus the post textbox in the dialog
    const focusResult = await chromeExecJs(`(() => {
  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 40 && r.height > 16;
  };
  const editors = Array.from(document.querySelectorAll(
    '[role="dialog"] [contenteditable="true"], [role="dialog"] [role="textbox"], [contenteditable="true"][role="textbox"], div[contenteditable="true"]'
  ));
  for (const ed of editors) {
    if (!visible(ed)) continue;
    ed.focus();
    ed.click();
    return 'focused';
  }
  return 'no_editor';
})()`)

    if (focusResult.includes('no_editor')) {
      // Retry opening composer once
      await chromeExecJs(`(() => {
  const nodes = Array.from(document.querySelectorAll('[role="button"]'));
  for (const el of nodes) {
    const t = ((el.getAttribute('aria-label')||'') + ' ' + (el.innerText||'')).toLowerCase();
    if (t.includes('mind') || t.includes('create a post') || t.includes('মনে')) { el.click(); return 'retry'; }
  }
  return 'no';
})()`)
      await sleep(1400)
      const focus2 = await chromeExecJs(`(() => {
  const editors = Array.from(document.querySelectorAll('[contenteditable="true"], [role="textbox"]'));
  for (const ed of editors) {
    const r = ed.getBoundingClientRect();
    if (r.width > 40 && r.height > 16) { ed.focus(); ed.click(); return 'focused'; }
  }
  return 'no_editor';
})()`)
      if (focus2.includes('no_editor')) {
        return {
          ok: false,
          message: 'পোস্ট বক্সে ফোকাস হয়নি — Facebook UI ব্লক/পপআপ থাকতে পারে।',
        }
      }
    }

    await sleep(350)
    await pasteViaClipboardMac(body)
    await sleep(700)

    // 3) Click Post / পোস্ট
    const postResult = await chromeExecJs(`(() => {
  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 20 && r.height > 12;
  };
  const isDisabled = (el) => {
    const aria = (el.getAttribute('aria-disabled') || '').toLowerCase();
    if (aria === 'true') return true;
    if (el.hasAttribute('disabled')) return true;
    const style = window.getComputedStyle(el);
    if (style.pointerEvents === 'none' || Number(style.opacity) < 0.4) return true;
    return false;
  };
  const labelOf = (el) => ((el.getAttribute('aria-label') || '') + ' ' + (el.innerText || '')).trim();
  const isPost = (el) => {
    const t = labelOf(el);
    return /^(post|পোস্ট)$/i.test(t) || /^post$/i.test((el.getAttribute('aria-label')||'').trim()) || /^পোস্ট$/i.test((el.innerText||'').trim());
  };
  const scope = document.querySelector('[role="dialog"]') || document.body;
  const buttons = Array.from(scope.querySelectorAll('[role="button"], button'));
  for (const el of buttons) {
    if (!visible(el) || isDisabled(el)) continue;
    if (isPost(el)) { el.click(); return 'posted'; }
  }
  // Fallback: any enabled button whose label contains Post near bottom of dialog
  for (const el of buttons) {
    if (!visible(el) || isDisabled(el)) continue;
    const t = labelOf(el).toLowerCase();
    if ((t === 'post' || t === 'পোস্ট' || t.startsWith('post ')) && !t.includes('poster')) {
      el.click(); return 'posted_fuzzy';
    }
  }
  return 'post_btn_not_found';
})()`)

    if (postResult.includes('post_btn_not_found')) {
      // Last resort: Cmd+Enter sometimes submits Facebook composer
      await runOsascript(`
tell application "System Events"
  keystroke return using command down
end tell
`)
      await sleep(1200)
      return {
        ok: true,
        message: `Facebook-এ পোস্ট পাঠানোর চেষ্টা হয়েছে: "${body.slice(0, 80)}${body.length > 80 ? '…' : ''}" (Post বাটন অটো-ক্লিক না পেয়ে Cmd+Enter)। স্ক্রিনে কনফার্ম করে দেখো।`,
      }
    }

    await sleep(1800)
    return {
      ok: true,
      message: `Facebook-এ পোস্ট করা হয়েছে: "${body.slice(0, 100)}${body.length > 100 ? '…' : ''}"`,
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Open Facebook Page / Business inbox in already-logged-in browser and read visible text.
 */
export async function checkFacebookPageInBrowser(pageHint?: string): Promise<{
  ok: boolean
  message: string
}> {
  const hint = (pageHint || '').trim()
  // Prefer Business Inbox (Page messages). Fallback: facebook messages.
  const url = hint
    ? hint.startsWith('http')
      ? hint
      : `https://www.facebook.com/${encodeURIComponent(hint)}/inbox`
    : 'https://business.facebook.com/latest/inbox'

  try {
    const browser = await openUrlInBrowser(url)
    await sleep(4500)
    let text = ''
    try {
      text = await readBrowserPageText(browser)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      if (/javascript|allow|osascript/i.test(msg)) {
        return {
          ok: true,
          message:
            `Facebook Page ইনবক্স ব্রাউজারে খোলা হয়েছে (${url}). ` +
            `মেসেজ পড়তে Chrome-এ: View → Developer → “Allow JavaScript from Apple Events” চালু করো।`,
        }
      }
      return {
        ok: true,
        message: `Facebook Page ইনবক্স খোলা হয়েছে। টেক্সট অটো-রিড ব্যর্থ: ${msg}`,
      }
    }

    if (!text || text.length < 40) {
      await sleep(2500)
      try {
        text = await readBrowserPageText(browser)
      } catch {
        // ignore
      }
    }

    return {
      ok: true,
      message: summarizeInboxText(text, 'Facebook Page ইনবক্স'),
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Open Gmail in logged-in browser and skim visible inbox text.
 */
export async function checkGmailInBrowser(): Promise<{ ok: boolean; message: string }> {
  try {
    const browser = await openUrlInBrowser('https://mail.google.com/mail/u/0/#inbox')
    await sleep(4500)
    let text = ''
    try {
      text = await readBrowserPageText(browser)
    } catch {
      return {
        ok: true,
        message:
          'Gmail ব্রাউজারে খোলা হয়েছে। অটো-রিডের জন্য Chrome → View → Developer → Allow JavaScript from Apple Events চালু রাখো।',
      }
    }
    if (!text || text.length < 40) {
      await sleep(2000)
      try {
        text = await readBrowserPageText(browser)
      } catch {
        // ignore
      }
    }
    return { ok: true, message: summarizeInboxText(text, 'Gmail ইনবক্স') }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export function accessibilityHintPath(): string {
  return path.join(os.homedir(), 'Library/Application Support/jarvis-desktop')
}
