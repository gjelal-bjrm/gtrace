import { create } from 'zustand'
import type { UpdateStatus } from '@shared/types'

/**
 * État du système de mise à jour (relayé depuis le main / electron-updater).
 * `manualHint` : n'afficher les messages transitoires (« à jour »,
 * « indisponible ») qu'après une vérification déclenchée par l'utilisateur.
 */
interface UpdateState {
  status: UpdateStatus
  version: string
  manualHint: boolean
  dismissed: boolean
  init: () => () => void
  check: () => void
  install: () => void
  dismiss: () => void
}

export const useUpdateStore = create<UpdateState>((set) => ({
  status: { state: 'idle' },
  version: '',
  manualHint: false,
  dismissed: false,

  init: () => {
    void window.gtrace.updateGet().then(({ status, version }) => set({ status, version }))
    // Un nouveau statut réaffiche le bandeau (annule un masquage précédent).
    return window.gtrace.onUpdateStatus((status) => set({ status, dismissed: false }))
  },

  check: () => {
    set({ manualHint: true, dismissed: false })
    void window.gtrace.updateCheck()
  },

  install: () => void window.gtrace.updateInstall(),

  dismiss: () => set({ dismissed: true, manualHint: false })
}))
