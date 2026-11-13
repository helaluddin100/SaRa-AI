import {
  ARIA_MANAGER,
  getSpecialist,
  type DeskStatus,
  type SpecialistId,
} from './agents'
import { JARVIS_CHARACTER, splitReplyAndVoiceStyle } from './character'
import {
  detectEmotionFromText,
  formatEmotionBlock,
  isEmotionMood,
  voiceStyleForMood,
  type EmotionMemory,
} from './emotionMemory'

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

type ToolDecl = {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export type OfficeStatusEvent = {
  activeAgentId: SpecialistId | 'aria' | null
  deskStatuses: Partial<Record<SpecialistId, DeskStatus>>
  lastBrief?: string
}

const ALL_TOOL_DECLARATIONS: ToolDecl[] = [
  {
    name: 'assign_agent',
    description:
      'Hand work to a specialist desk. agent_id: mira|rex|forge|pixel. brief: clear English instructions for that specialist.',
    parameters: {
      type: 'OBJECT',
      properties: {
        agent_id: {
          type: 'STRING',
          description: 'mira | rex | forge | pixel',
        },
        brief: {
          type: 'STRING',
          description: 'Full task brief for the specialist',
        },
      },
      required: ['agent_id', 'brief'],
    },
  },
  {
    name: 'open_app',
    description: 'Open an application on the user PC (Chrome, Cursor, Spotify, etc.)',
    parameters: {
      type: 'OBJECT',
      properties: {
        app: { type: 'STRING', description: 'App name, e.g. chrome, Cursor, code' },
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
    name: 'update_emotion_memory',
    description:
      'Update emotion memory: current mood and/or lasting likes, dislikes, joy/sadness triggers, night feelings, intimate preferences. Call when the user reveals how they feel or what moves them.',
    parameters: {
      type: 'OBJECT',
      properties: {
        mood: {
          type: 'STRING',
          description:
            'neutral|sad|happy|lonely|angry|anxious|affectionate|intimate|excited|tired',
        },
        intensity: { type: 'NUMBER', description: '1–5' },
        note: { type: 'STRING', description: 'Short note about this feeling' },
        add_like: { type: 'STRING' },
        add_dislike: { type: 'STRING' },
        add_joy_trigger: { type: 'STRING' },
        add_sadness_trigger: { type: 'STRING' },
        add_night_note: { type: 'STRING' },
        add_intimate_preference: { type: 'STRING' },
      },
    },
  },
  {
    name: 'get_system_info',
    description: 'Get PC health: CPU%, RAM, cores, uptime. Do NOT use for date/time/weather.',
    parameters: {
      type: 'OBJECT',
      properties: {
        confirm: { type: 'BOOLEAN', description: 'Optional confirm flag' },
      },
    },
  },
  {
    name: 'get_datetime',
    description:
      'Instant local date, weekday, and current time from the PC clock. Use for "আজকের তারিখ/দিন/সময়" — never open a browser or Calendar app.',
    parameters: {
      type: 'OBJECT',
      properties: {
        confirm: { type: 'BOOLEAN' },
      },
    },
  },
  {
    name: 'get_weather',
    description:
      'Live weather via network API (no browser). Optional city (default Dhaka). Use for "আজকের আবহাওয়া" — never open Chrome or Weather app.',
    parameters: {
      type: 'OBJECT',
      properties: {
        city: { type: 'STRING', description: 'City name, e.g. Dhaka, Chittagong' },
      },
    },
  },
  {
    name: 'open_whatsapp',
    description: 'Open the WhatsApp desktop app.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'send_whatsapp_message',
    description: 'Open WhatsApp, find contact by name, type message, send.',
    parameters: {
      type: 'OBJECT',
      properties: {
        contact: { type: 'STRING' },
        message: { type: 'STRING' },
      },
      required: ['contact', 'message'],
    },
  },
  {
    name: 'check_email',
    description: 'Open Gmail and summarize visible inbox.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'check_facebook_page',
    description: 'Open Facebook Page inbox and summarize messages.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'post_facebook_status',
    description: 'Post exact status text to Facebook.',
    parameters: {
      type: 'OBJECT',
      properties: {
        text: { type: 'STRING' },
      },
      required: ['text'],
    },
  },
  {
    name: 'complete_computer_task',
    description:
      'Screen vision + click/type loop until a PC/UI goal is done. Forge: use to drive Cursor. Rex: PC control. Pixel: design preview work.',
    parameters: {
      type: 'OBJECT',
      properties: {
        goal: { type: 'STRING' },
      },
      required: ['goal'],
    },
  },
  {
    name: 'generate_maps_leads',
    description: 'Google Maps lead gen → CSV on Desktop.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING' },
        location: { type: 'STRING' },
        max_results: { type: 'NUMBER' },
      },
      required: ['query'],
    },
  },
  {
    name: 'schedule_task',
    description: 'Schedule a delayed job (app must stay open).',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING' },
        goal: { type: 'STRING' },
        delay_minutes: { type: 'NUMBER' },
        delay_seconds: { type: 'NUMBER' },
        kind: { type: 'STRING' },
        contact: { type: 'STRING' },
        message: { type: 'STRING' },
        query: { type: 'STRING' },
        location: { type: 'STRING' },
      },
      required: ['title', 'goal'],
    },
  },
  {
    name: 'list_scheduled_tasks',
    description: 'List pending/recent scheduled jobs.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'cancel_scheduled_task',
    description: 'Cancel a pending scheduled task by id.',
    parameters: {
      type: 'OBJECT',
      properties: {
        id: { type: 'STRING' },
      },
      required: ['id'],
    },
  },
]

function toolsFor(allowed: string[]): ToolDecl[] {
  const set = new Set(allowed)
  return ALL_TOOL_DECLARATIONS.filter((t) => set.has(t.name))
}

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
    case 'update_emotion_memory': {
      const cur = await window.jarvis.getEmotionMemory()
      const push = (list: string[], item?: unknown) => {
        const v = String(item || '').trim()
        if (!v) return list
        if (list.some((x) => x.toLowerCase() === v.toLowerCase())) return list
        return [...list, v].slice(-24)
      }
      const moodRaw = String(args.mood || '').trim().toLowerCase()
      const next = await window.jarvis.setEmotionMemory({
        currentMood: isEmotionMood(moodRaw) ? moodRaw : cur.currentMood,
        intensity: args.intensity != null ? Number(args.intensity) : cur.intensity,
        lastNote: args.note != null ? String(args.note) : cur.lastNote,
        likes: push(cur.likes, args.add_like),
        dislikes: push(cur.dislikes, args.add_dislike),
        joyTriggers: push(cur.joyTriggers, args.add_joy_trigger),
        sadnessTriggers: push(cur.sadnessTriggers, args.add_sadness_trigger),
        nightMoodNotes: push(cur.nightMoodNotes, args.add_night_note),
        intimatePreferences: push(cur.intimatePreferences, args.add_intimate_preference),
      })
      return { ok: true, emotion: next }
    }
    case 'get_system_info':
      return window.jarvis.systemInfo()
    case 'get_datetime':
      return window.jarvis.getLocalDateTime()
    case 'get_weather':
      return window.jarvis.getLocalWeather(args.city ? String(args.city) : undefined)
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

function buildHistoryContents(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  userText: string,
): GeminiContent[] {
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
  if (contents[0]?.role === 'model') {
    contents.unshift({ role: 'user', parts: [{ text: 'Hello' }] })
  }
  return contents
}

async function geminiLoop(options: {
  apiKey: string
  model: string
  systemText: string
  contents: GeminiContent[]
  allowedTools: string[]
  maxRounds: number
  temperature: number
  onTool?: (name: string) => void
  runToolFn: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>
}): Promise<string> {
  const contents = options.contents
  const decls = toolsFor(options.allowedTools)

  for (let round = 0; round < options.maxRounds; round += 1) {
    const result = await window.jarvis.geminiGenerate({
      apiKey: options.apiKey,
      model: options.model,
      body: {
        systemInstruction: { parts: [{ text: options.systemText }] },
        contents,
        tools: decls.length ? [{ functionDeclarations: decls }] : undefined,
        generationConfig: {
          temperature: options.temperature,
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
        options.onTool?.(call.name)
        const toolResult = await options.runToolFn(call.name, call.args || {})
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

    return extractText(parts) || 'Done.'
  }

  return 'Tool loop limit — try a simpler request.'
}

async function runSpecialist(options: {
  apiKey: string
  model: string
  agentId: SpecialistId
  brief: string
  userName: string
  memoryBlock: string
  onOfficeStatus?: (ev: OfficeStatusEvent) => void
}): Promise<{ ok: boolean; agentId: SpecialistId; agentName: string; summary: string }> {
  const agent = getSpecialist(options.agentId)
  if (!agent) {
    return {
      ok: false,
      agentId: options.agentId,
      agentName: options.agentId,
      summary: `Unknown agent: ${options.agentId}`,
    }
  }

  options.onOfficeStatus?.({
    activeAgentId: agent.id as SpecialistId,
    deskStatuses: { [agent.id]: 'thinking' },
    lastBrief: options.brief,
  })

  const systemText = `${agent.systemPrompt}\n\nUser name: ${options.userName || 'unknown'}\n${options.memoryBlock}\n\nBrief from Aria:\n${options.brief}`

  try {
    const raw = await geminiLoop({
      apiKey: options.apiKey,
      model: options.model,
      systemText,
      contents: [{ role: 'user', parts: [{ text: options.brief }] }],
      allowedTools: agent.allowedTools,
      maxRounds: 6,
      temperature: 0.4,
      onTool: (name) => {
        const working =
          name === 'complete_computer_task' ||
          name === 'generate_maps_leads' ||
          name === 'post_facebook_status' ||
          name === 'send_whatsapp_message'
        options.onOfficeStatus?.({
          activeAgentId: agent.id as SpecialistId,
          deskStatuses: { [agent.id]: working ? 'working' : 'thinking' },
          lastBrief: options.brief,
        })
      },
      runToolFn: async (name, args) => {
        if (!agent.allowedTools.includes(name)) {
          return { ok: false, message: `${agent.name} cannot use tool ${name}` }
        }
        return runTool(name, args)
      },
    })

    const { text } = splitReplyAndVoiceStyle(raw)
    options.onOfficeStatus?.({
      activeAgentId: agent.id as SpecialistId,
      deskStatuses: { [agent.id]: 'done' },
      lastBrief: options.brief,
    })
    return {
      ok: true,
      agentId: agent.id as SpecialistId,
      agentName: agent.name,
      summary: text,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    options.onOfficeStatus?.({
      activeAgentId: agent.id as SpecialistId,
      deskStatuses: { [agent.id]: 'idle' },
    })
    return {
      ok: false,
      agentId: agent.id as SpecialistId,
      agentName: agent.name,
      summary: message,
    }
  }
}

export async function askJarvis(options: {
  apiKey: string
  model: string
  userName: string
  userText: string
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  onOfficeStatus?: (ev: OfficeStatusEvent) => void
}): Promise<{ text: string; voiceStyle?: string; agentId?: string; agentName?: string }> {
  const { apiKey, model, userName, userText, history, onOfficeStatus } = options
  if (!apiKey.trim()) {
    throw new Error('Gemini API key missing. Open Settings and paste your key.')
  }

  const memory = await window.jarvis.listMemory()
  const memoryBlock =
    memory.length > 0
      ? `Known facts about the user:\n${memory.map((m) => `- ${m.text}`).join('\n')}`
      : 'No stored personal facts yet.'

  // Emotion memory: detect from this turn, persist, then inject into prompt
  let emotion = (await window.jarvis.getEmotionMemory()) as EmotionMemory
  const detected = detectEmotionFromText(userText)
  if (detected) {
    emotion = (await window.jarvis.setEmotionMemory({
      currentMood: detected.mood,
      intensity: detected.intensity,
      lastNote: detected.note,
    })) as EmotionMemory
  }
  // Night-time pattern capture (soft)
  if (/রাত|tonight|late night/i.test(userText) && detected) {
    const note = `${detected.mood}: ${detected.note}`
    if (!emotion.nightMoodNotes.some((n) => n.includes(detected.note.slice(0, 40)))) {
      emotion = (await window.jarvis.setEmotionMemory({
        nightMoodNotes: [...emotion.nightMoodNotes, note].slice(-24),
      })) as EmotionMemory
    }
  }
  const emotionBlock = formatEmotionBlock(emotion)

  const clock = (await window.jarvis.getLocalDateTime()) as {
    weekdayBn?: string
    dateBn?: string
    timeBn?: string
    timezone?: string
  }

  onOfficeStatus?.({
    activeAgentId: 'aria',
    deskStatuses: {},
  })

  const systemText = `${JARVIS_CHARACTER.systemPrompt}\n\nUser name: ${userName || 'unknown'}\n${memoryBlock}\n\n${emotionBlock}\n\nPC clock (already local — do not open apps for this): ${clock.weekdayBn || ''}, ${clock.dateBn || ''}, ${clock.timeBn || ''} (${clock.timezone || 'local'}). For weather use get_weather tool.`
  const contents = buildHistoryContents(history, userText)

  let lastSpecialistId: SpecialistId | undefined
  let lastSpecialistName: string | undefined

  const raw = await geminiLoop({
    apiKey,
    model,
    systemText,
    contents,
    allowedTools: ARIA_MANAGER.allowedTools,
    maxRounds: 8,
    temperature: 0.55,
    runToolFn: async (name, args) => {
      if (name === 'assign_agent') {
        const agentId = String(args.agent_id || args.agentId || '')
          .trim()
          .toLowerCase() as SpecialistId
        const brief = String(args.brief || '').trim()
        if (!getSpecialist(agentId)) {
          return { ok: false, message: `Unknown agent_id: ${agentId}. Use mira|rex|forge|pixel.` }
        }
        if (!brief) return { ok: false, message: 'brief required for assign_agent' }

        const result = await runSpecialist({
          apiKey,
          model,
          agentId,
          brief,
          userName,
          memoryBlock,
          onOfficeStatus,
        })
        lastSpecialistId = result.agentId
        lastSpecialistName = result.agentName
        return result
      }

      if (!ARIA_MANAGER.allowedTools.includes(name)) {
        return { ok: false, message: `Aria cannot use tool ${name} — assign a specialist.` }
      }
      return runTool(name, args)
    },
  })

  const idleStatuses: Partial<Record<SpecialistId, DeskStatus>> = lastSpecialistId
    ? { [lastSpecialistId]: 'idle' }
    : { mira: 'idle', rex: 'idle', forge: 'idle', pixel: 'idle' }

  onOfficeStatus?.({
    activeAgentId: null,
    deskStatuses: idleStatuses,
  })

  const split = splitReplyAndVoiceStyle(raw)
  const mood = isEmotionMood(emotion.currentMood) ? emotion.currentMood : 'neutral'
  return {
    text: split.text,
    voiceStyle: split.voiceStyle || voiceStyleForMood(mood),
    agentId: lastSpecialistId,
    agentName: lastSpecialistName,
  }
}
