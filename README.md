# Jarvis Desktop

JARVIS-style AI desktop companion for **macOS** and **Windows**.

MVP scope:
- Voice + text chat with one character (Jarvis)
- Open / close apps, open URLs
- Local memory (facts + chat history)
- Bring your own Google Gemini API key
- Auth intentionally skipped for later

## Requirements

- Node.js 20+
- Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey)
- Microphone permission (for voice)

## Setup

```bash
cd ~/Work/jarvis-desktop
npm install
npm run dev
```

First launch → **Settings** → paste Gemini API key → Save.

## Try saying / typing

- `Open Chrome`
- `Close Spotify`
- `Open YouTube`
- `Remember that my sister's birthday is Friday`
- `How is my system doing?`

## Build installers

```bash
npm run electron:build
```

Outputs land in `release/` (macOS `.dmg` / Windows `.exe` depending on host OS).

## Notes

- STT uses Chromium Web Speech API
- TTS uses system `speechSynthesis` (upgrade to ElevenLabs/OpenAI TTS later)
- App control uses `open`/`osascript` on Mac and `start`/`taskkill` on Windows
- Auth / cloud billing can be added later without rewriting the core agent
