import { useMemo, type JSX } from 'react'
import { LogoIcon } from './Logo'
import { WHATS_NEW } from '../../data/whatsNew'
import { useUpdateStore } from '../../stores/updateStore'

/** Compare deux versions « x.y.z » (>0 si a>b). */
function cmpVer(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d > 0 ? 1 : -1
  }
  return 0
}

/**
 * Pop-up « Nouveautés » : montre les notes des versions plus récentes que
 * `since`. Affichée une fois après une mise à jour (cf. App.tsx,
 * lastSeenVersion en localStorage) ; `since = ''` montre tout le changelog.
 */
export default function WhatsNew({
  since,
  onClose
}: {
  since: string
  onClose: () => void
}): JSX.Element {
  const version = useUpdateStore((s) => s.version)

  const items = useMemo(() => WHATS_NEW.filter((r) => cmpVer(r.version, since) > 0), [since])
  // Si rien de spécifique au changelog, message générique.
  const shown = items.length > 0 ? items : version ? [{ version, notes: [] as string[] }] : []

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal whats-new" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="whats-new-title">
            <LogoIcon size={24} />
            <span>
              Nouveautés de GTrace
              {version && <span className="whats-new-version"> — version {version}</span>}
            </span>
          </span>
          <button className="btn btn-icon" onClick={onClose} title="Fermer">
            ✕
          </button>
        </div>
        <div className="modal-body whats-new-body">
          {shown.length === 0 ? (
            <p className="dim">Aucune note de version disponible.</p>
          ) : (
            shown.map((r) => (
              <div key={r.version} className="whats-new-release">
                <div className="whats-new-release-version">v{r.version}</div>
                {r.notes.length === 0 ? (
                  <p className="dim">Mise à jour appliquée.</p>
                ) : (
                  <ul>
                    {r.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))
          )}
        </div>
        <div className="dialog-actions">
          <button className="btn btn-primary" onClick={onClose}>
            Super, merci !
          </button>
        </div>
      </div>
    </div>
  )
}
