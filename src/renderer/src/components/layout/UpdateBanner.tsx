import { useEffect, type JSX } from 'react'
import { useUpdateStore } from '../../stores/updateStore'

/**
 * Bandeau de mise à jour sous la barre de titre : affiché quand une mise à
 * jour est disponible, en téléchargement, prête à installer, ou en erreur.
 * Les messages transitoires (« à jour », « indisponible », « vérification »)
 * ne s'affichent qu'après une vérification manuelle et disparaissent seuls.
 */
export default function UpdateBanner(): JSX.Element | null {
  const status = useUpdateStore((s) => s.status)
  const manualHint = useUpdateStore((s) => s.manualHint)
  const dismissed = useUpdateStore((s) => s.dismissed)
  const install = useUpdateStore((s) => s.install)
  const dismiss = useUpdateStore((s) => s.dismiss)

  const transient =
    status.state === 'none' || status.state === 'unsupported' || status.state === 'checking'

  // Masque automatiquement les messages transitoires après quelques secondes.
  useEffect(() => {
    if (manualHint && (status.state === 'none' || status.state === 'unsupported')) {
      const t = setTimeout(dismiss, 4000)
      return () => clearTimeout(t)
    }
    return undefined
  }, [manualHint, status.state, dismiss])

  if (dismissed) return null
  if (transient && !manualHint) return null
  if (status.state === 'idle') return null

  let text: string
  let tone = ''
  let action: JSX.Element | null = null

  switch (status.state) {
    case 'checking':
      text = 'Recherche de mises à jour…'
      break
    case 'available':
      text = `Mise à jour v${status.version} disponible — téléchargement…`
      tone = 'accent'
      break
    case 'downloading':
      text = `Téléchargement de la mise à jour… ${status.percent}%`
      tone = 'accent'
      break
    case 'ready':
      text = `Mise à jour v${status.version} prête.`
      tone = 'accent'
      action = (
        <button className="btn btn-primary btn-sm" onClick={install}>
          Redémarrer et installer
        </button>
      )
      break
    case 'none':
      text = `GTrace est à jour (v${status.version}).`
      break
    case 'unsupported':
      text = 'Mises à jour indisponibles ici (mode dev).'
      break
    case 'error':
      text = `Échec de la mise à jour : ${status.message}`
      tone = 'danger'
      break
    default:
      return null
  }

  return (
    <div className={`update-banner ${tone}`}>
      <span className="update-banner-text">{text}</span>
      {action}
      <button className="btn btn-icon" onClick={dismiss} title="Masquer">
        ✕
      </button>
    </div>
  )
}
