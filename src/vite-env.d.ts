/// <reference types="vite/client" />

import type { JarvisAPI } from '../electron/preload'

declare global {
  interface Window {
    jarvis: JarvisAPI
  }
}

export {}
