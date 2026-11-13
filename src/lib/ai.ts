import { JARVIS_CHARACTER, splitReplyAndVoiceStyle } from './character'

type GeminiPart = Record<string, unknown> & {
  text?: string
  functionCall?: { name: string; args?: Record<string, unknown> }
  functionResponse?: { name: string; response: Record<string, unknown> }
  thought?: boolean
}

type GeminiContent = {
  role: 'user' | 'model'
  parts: GeminiPart[]
}

const FUNCTION_DECLARATIONS = [
  {
    name: 'open_app',
    description: 'Open an application on the user PC (Chrome, Spotify, VS Code, etc.)',
    parameters: {
      type: 'OBJECT',
      properties: {
        app: { type: 'STRING', description: 'App name, e.g. chrome, spotify, code' },
      },
      required: ['app'],
    },
  },
  {
    name: 'close_app',
    description: 'Close/quit an application on the user PC',
    parameters: {
      type: 'OBJECT',
      properties: {
        app: { type: 'STRING' },
      },
      required: ['app'],
    },
  },
  {
    name: 'open_url',
    description: 'Open a website URL in the default browser',
    parameters: {
      type: 'OBJECT',
      properties: {
        url: { type: 'STRING' },
      },
      required: ['url'],
    },
  },
  {
    name: 'remember_fact',
    description: 'Store a personal fact the user wants remembered',
    parameters: {
      type: 'OBJECT',
      properties: {
        fact: { type: 'STRING' },
      },
      required: ['fact'],
    },
  },
  {
    name: 'get_system_info',
    description: 'Get basic PC health info: RAM, CPU count, uptime. No arguments needed.',
    parameters: {
      type: 'OBJECT',
      properties: {
        confirm: {
          type: 'BOOLEAN',
          description: 'Optional. Set true to confirm the request.',
        },
      },
    },
  },
  {
    name: 'open_whatsapp',
    description: 'Open the WhatsApp desktop app on the PC (voice command).',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'send_whatsapp_message',
    description:
      'FULL automation: open WhatsApp, search the contact BY NAME inside WhatsApp (as saved on phone/desktop, e.g. "Joya Robi"), open chat, type the message, and press Send. Use for voice commands like "WhatsApp open kore Joya Robi ke message pathao hello". Do NOT ask for phone numbers or Settings.',
    parameters: {
      type: 'OBJECT',
      properties: {
        contact: {
          type: 'STRING',
          description: 'Contact display name exactly as in WhatsApp, e.g. Joya Robi',
        },
        message: { type: 'STRING', description: 'Message text to send, e.g. hello joya' },
      },
      required: ['contact', 'message'],
    },
  },
  {
    name: 'check_email',
    description:
      'Open Gmail in the already-logged-in browser and summarize visible inbox / important mail for the user.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'check_facebook_page',
    description:
      'Open Facebook Page inbox in the already-logged-in Chrome/Safari browser, read visible messages, and summarize. No API token needed.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'post_facebook_status',
    description:
      'PRIMARY for Facebook posts. Open logged-in Facebook in Chrome, open the create-post composer, type the status text, and click Post. Use for "Facebook e post koro", "ফেসবুকে পোস্ট করো", etc. Pass the full post text exactly as the user wants published.',
    parameters: {
      type: 'OBJECT',
      properties: {
        text: {
          type: 'STRING',
          description: 'Exact Facebook status/post text to publish',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'complete_computer_task',
    description:
      'PRIMARY tool for general on-screen PC work. Aria can SEE the user screen, break the goal into steps, click/type/hotkey, verify on screen, and report when done. Prefer post_facebook_status for Facebook posts and send_whatsapp_message for WhatsApp. Use this for other UI tasks.',
    parameters: {
      type: 'OBJECT',
      properties: {
        goal: {
          type: 'STRING',
          description:
            'Full task, e.g. "Open WhatsApp, message Joya Robi saying hello joya, and confirm sent"',
        },
      },
      required: ['goal'],
    },
  },
  {
    name: 'generate_maps_leads',
    description:
      'PRIMARY for lead generation. Open Google Maps, collect business leads for a search (name, rating, address, phone, website), save a CSV on the Desktop, and return the file path. Use for "Google Map e lead generate koro", dentists/restaurants/clinics in an area, etc.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: {
          type: 'STRING',
          description: 'What to search, e.g. dentist, restaurant, salon, digital agency',
        },
        location: {
          type: 'STRING',
          description: 'Area/city optional, e.g. Gulshan Dhaka, Banani',
        },
        max_results: {
          type: 'NUMBER',
          description: 'How many leads to collect (default 15, max 40)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'schedule_task',
    description:
      'Schedule a future job Aria will run herself after a delay (app must stay open). Use for "5 minute pore message pathao", "10 min pore Facebook post", "20 minute pore lead generate", reminders, delayed WhatsApp/computer tasks. Convert minutes/seconds to delay fields.',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: {
          type: 'STRING',
          description: 'Short label, e.g. WhatsApp Joya, Maps dentist leads',
        },
        goal: {
          type: 'STRING',
          description:
            'Full instruction Aria will execute later, e.g. "Send WhatsApp to Joya Robi: hello" or "Generate Maps leads for dentist in Gulshan"',
        },
        delay_minutes: {
          type: 'NUMBER',
          description: 'Minutes to wait before running (use for 5/10/20 minute schedules)',
        },
        delay_seconds: {
          type: 'NUMBER',
          description: 'Optional seconds delay (overrides minutes if both set carefully; prefer minutes for voice)',
        },
        kind: {
          type: 'STRING',
          description:
            'computer_task | whatsapp | facebook_post | leads. Prefer the matching kind when clear.',
        },
        contact: {
          type: 'STRING',
          description: 'For kind=whatsapp: contact name',
        },
        message: {
          type: 'STRING',
          description: 'For kind=whatsapp or facebook_post: message/post text',
        },
        query: {
          type: 'STRING',
          description: 'For kind=leads: Maps search query',
        },
        location: {
          type: 'STRING',
          description: 'For kind=leads: optional area',
        },
      },
      required: ['title', 'goal'],
    },
  },
  {
    name: 'list_scheduled_tasks',
    description: 'List pending/recent scheduled jobs Aria will run.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'cancel_scheduled_task',
    description: 'Cancel a pending scheduled task by id from list_scheduled_tasks.',
    parameters: {
      type: 'OBJECT',
      properties: {
        id: { type: 'STRING', description: 'Scheduled task id' },
      },
      required: ['id'],
    },
  },
]

async function runTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  switch (name) {
    case 'open_app':
      return window.jarvis.openApp(String(args.app || ''))
    case 'close_app':
      return window.jarvis.closeApp(String(args.app || ''))
    case 'open_url':
      return window.jarvis.openUrl(String(args.url || ''))
    case 'remember_fact': {
      const fact = await window.jarvis.addMemory(String(args.fact || ''))
      return { ok: true, saved: fact.text }
    }
    case 'get_system_info':
      return window.jarvis.systemInfo()
    case 'open_whatsapp':
      return window.jarvis.openWhatsApp()
    case 'send_whatsapp_message':
      await window.jarvis.ensureScreenPermission()
      return window.jarvis.sendWhatsApp({
        contactOrPhone: String(args.contact || ''),
        message: String(args.message || ''),
      })
    case 'check_email':
      await window.jarvis.ensureScreenPermission()
      return window.jarvis.checkEmail()
    case 'check_facebook_page':
      await window.jarvis.ensureScreenPermission()
      return window.jarvis.checkFacebook()
    case 'post_facebook_status':
      await window.jarvis.ensureScreenPermission()
      return window.jarvis.postFacebook(String(args.text || ''))
    case 'complete_computer_task':
      await window.jarvis.ensureScreenPermission()
      return window.jarvis.runComputerTask(String(args.goal || ''))
    case 'generate_maps_leads':
      await window.jarvis.ensureScreenPermission()
      return window.jarvis.generateMapsLeads({
        query: String(args.query || ''),
        location: args.location ? String(args.location) : undefined,
        maxResults: args.max_results != null ? Number(args.max_results) : undefined,
      })
    case 'schedule_task': {
      const kindRaw = String(args.kind || '').trim().toLowerCase()
      const kind =
        kindRaw === 'whatsapp' ||
        kindRaw === 'facebook_post' ||
        kindRaw === 'leads' ||
        kindRaw === 'computer_task'
          ? kindRaw
          : /lead|maps|google map/i.test(String(args.goal || ''))
            ? 'leads'
            : /whatsapp|মেসেজ|message/i.test(String(args.goal || ''))
              ? 'whatsapp'
              : /facebook|পোস্ট/i.test(String(args.goal || ''))
                ? 'facebook_post'
                : 'computer_task'
      const payload: Record<string, unknown> = {}
      if (args.contact) payload.contact = String(args.contact)
      if (args.message) payload.message = String(args.message)
      if (args.query) payload.query = String(args.query)
      if (args.location) payload.location = String(args.location)
      if (kind === 'facebook_post' && args.message && !payload.text) {
        payload.text = String(args.message)
      }
      return window.jarvis.scheduleTask({
        title: String(args.title || 'Scheduled task'),
        goal: String(args.goal || ''),
        delayMinutes: args.delay_minutes != null ? Number(args.delay_minutes) : undefined,
        delaySeconds: args.delay_seconds != null ? Number(args.delay_seconds) : undefined,
        kind,
        payload,
      })
    }
    case 'list_scheduled_tasks': {
      const tasks = await window.jarvis.listScheduledTasks()
      return {
        ok: true,
        count: tasks.length,
        tasks: tasks.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          runAt: t.runAt,
          kind: t.kind,
          resultMessage: t.resultMessage,
        })),
      }
    }
    case 'cancel_scheduled_task':
      return window.jarvis.cancelScheduledTask(String(args.id || ''))
    default:
      return { ok: false, message: `Unknown tool: ${name}` }
  }
}

function extractText(parts: GeminiPart[] | undefined): string {
  if (!parts?.length) return ''
  return parts
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => p.text || '')
    .filter(Boolean)
    .join('\n')
    .trim()
}

function extractFunctionCalls(parts: GeminiPart[] | undefined) {
  if (!parts?.length) return []
  return parts
    .map((p) => p.functionCall)
    .filter((c): c is { name: string; args?: Record<string, unknown> } => Boolean(c?.name))
}

export async function askJarvis(options: {
  apiKey: string
  model: string
  userName: string
  userText: string
  history: Array<{ role: 'user' | 'assistant'; content: string }>
}): Promise<{ text: string; voiceStyle?: string }> {
  const { apiKey, model, userName, userText, history } = options
  if (!apiKey.trim()) {
    throw new Error('Gemini API key missing. Open Settings and paste your key.')
  }

  const memory = await window.jarvis.listMemory()
  const memoryBlock =
    memory.length > 0
      ? `Known facts about the user:\n${memory.map((m) => `- ${m.text}`).join('\n')}`
      : 'No stored personal facts yet.'

  const systemText = `${JARVIS_CHARACTER.systemPrompt}\n\nUser name: ${userName || 'unknown'}\n${memoryBlock}`

  // Gemini requires alternating roles; collapse history safely
  const contents: GeminiContent[] = []
  for (const m of history.slice(-12)) {
    const role = m.role === 'assistant' ? 'model' : 'user'
    const last = contents[contents.length - 1]
    if (last?.role === role) {
      last.parts.push({ text: m.content })
    } else {
      contents.push({ role, parts: [{ text: m.content }] })
    }
  }

  const last = contents[contents.length - 1]
  if (last?.role === 'user') {
    last.parts.push({ text: userText })
  } else {
    contents.push({ role: 'user', parts: [{ text: userText }] })
  }

  // If history somehow starts with model-only, prepend a tiny user turn
  if (contents[0]?.role === 'model') {
    contents.unshift({ role: 'user', parts: [{ text: 'Hello' }] })
  }

  for (let round = 0; round < 6; round += 1) {
    const result = await window.jarvis.geminiGenerate({
      apiKey,
      model,
      body: {
        systemInstruction: { parts: [{ text: systemText }] },
        contents,
        tools: [{ functionDeclarations: FUNCTION_DECLARATIONS }],
        generationConfig: {
          temperature: 0.6,
          // Gemini 3.x default thinking can hang for a long time in chat UX
          thinkingConfig: { thinkingLevel: 'low' },
        },
      },
    })

    if (!result.ok) {
      throw new Error(`Gemini error ${result.status}: ${result.error}`)
    }

    const data = result.data as {
      candidates?: Array<{
        content?: { parts?: GeminiPart[] }
        finishReason?: string
      }>
      promptFeedback?: { blockReason?: string }
    }

    const candidate = data.candidates?.[0]
    const parts = candidate?.content?.parts
    if (!parts?.length) {
      const block = data.promptFeedback?.blockReason
      const reason = candidate?.finishReason
      throw new Error(
        block
          ? `Gemini blocked the request: ${block}`
          : `Empty response from Gemini${reason ? ` (${reason})` : ''}`,
      )
    }

    const calls = extractFunctionCalls(parts)
    if (calls.length) {
      contents.push({ role: 'model', parts })

      const responseParts: GeminiPart[] = []
      for (const call of calls) {
        const toolResult = await runTool(call.name, call.args || {})
        responseParts.push({
          functionResponse: {
            name: call.name,
            response: toolResult,
          },
        })
      }
      contents.push({ role: 'user', parts: responseParts })
      continue
    }

    const text = extractText(parts)
    if (text) return splitReplyAndVoiceStyle(text)
    return { text: 'Done.' }
  }

  return { text: 'I hit a tool loop limit. Try again with a simpler request.' }
}
