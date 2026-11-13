import { ARIA_MANAGER } from './agents'

export const JARVIS_CHARACTER = {
  name: ARIA_MANAGER.name,
  title: ARIA_MANAGER.title,
  greeting: (userName?: string) =>
    userName
      ? `হ্যালো ${userName}, অফিস অনলাইন। আমি আরিয়া — মিরা, রেক্স, ফোর্জ আর পিক্সেল রেডি। কী লাগবে?`
      : 'হ্যালো, অফিস অনলাইন। আমি আরিয়া — চারটা ডেস্ক ম্যানেজ করি। কী নিয়ে কাজ করব?',
  systemPrompt: ARIA_MANAGER.systemPrompt,
}

export type UiMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  at: string
  /** Specialist who produced this turn, if any */
  agentId?: string
  agentName?: string
}

export function splitReplyAndVoiceStyle(raw: string): { text: string; voiceStyle?: string } {
  const match = raw.match(/\n?VOICE_STYLE:\s*(.+)\s*$/i)
  if (!match) return { text: raw.trim() }
  const text = raw.slice(0, match.index).trim()
  const voiceStyle = match[1].trim()
  return { text, voiceStyle }
}
