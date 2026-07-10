import type { GTraceApi } from '../shared/ipc'

declare global {
  interface Window {
    gtrace: GTraceApi
  }
}

export {}
