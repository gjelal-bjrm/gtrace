import type { JSX } from 'react'
import { useAppearanceStore } from '../../stores/appearanceStore'
import { THEMES } from '../../theme/themes'
import { useEscapeClose } from '../../lib/useEscapeClose'
import { Palette } from 'lucide-react'
import ModalHeader from '../ui/ModalHeader'

/**
 * Dialogue « Apparence » : choix du thème parmi des palettes prédéfinies
 * plus les réglages de confort de lecture.
 * L'aperçu de chaque thème est dessiné avec ses propres couleurs.
 */
export default function ThemeDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const appearance = useAppearanceStore((s) => s.appearance)
  const update = useAppearanceStore((s) => s.update)

  useEscapeClose(onClose)


  return (
    <div className="modal-overlay">
      <div className="modal theme-dialog">
        <ModalHeader icon={Palette} title="Apparence" onClose={onClose} />

        <div className="modal-body">
          <div className="theme-grid">
            {THEMES.map((t) => (
              <button
                key={t.id}
                className={`theme-card${appearance.themeId === t.id ? ' active' : ''}`}
                onClick={() => update({ themeId: t.id })}
                title={t.tagline}
              >
                {/* Aperçu : une mini-fenêtre peinte avec les couleurs du thème —
                    barres, onglets, éditeur, barre de requête, barre d'état. */}
                <span className="theme-preview" style={{ background: t.vars.chrome }}>
                  <span className="tp-band" style={{ background: t.vars.band }}>
                    <span className="tp-tab" style={{ background: t.vars['tab-active'] }} />
                    <span className="tp-tab off" style={{ background: t.vars['band-fg'] }} />
                  </span>
                  <span className="tp-body" style={{ background: t.vars.surface }}>
                    <span className="theme-line" style={{ background: t.vars.accent, width: '46%' }} />
                    <span className="theme-line" style={{ background: t.vars.text, width: '64%' }} />
                    <span
                      className="theme-line"
                      style={{ background: t.vars['text-dim'], width: '38%' }}
                    />
                  </span>
                  <span className="tp-query" style={{ background: t.vars.querybar }} />
                  <span className="tp-status" style={{ background: t.vars.statusbar }} />
                </span>
                <span className="theme-name">{t.label}</span>
                <span className="theme-tagline">{t.tagline}</span>
              </button>
            ))}
          </div>

          <div className="form-grid theme-settings">
            <label>Texte de l&apos;interface</label>
            <div className="form-inline">
              <input
                type="range"
                min={11}
                max={17}
                value={appearance.fontSize}
                onChange={(e) => update({ fontSize: Number(e.target.value) })}
              />
              <span className="theme-value">{appearance.fontSize} px</span>
            </div>

            <label>Texte de l&apos;éditeur</label>
            <div className="form-inline">
              <input
                type="range"
                min={11}
                max={20}
                value={appearance.editorFontSize}
                onChange={(e) => update({ editorFontSize: Number(e.target.value) })}
              />
              <span className="theme-value">{appearance.editorFontSize} px</span>
            </div>

            <label>Densité des tableaux</label>
            <select
              value={appearance.density}
              onChange={(e) => update({ density: e.target.value as 'compact' | 'confortable' })}
            >
              <option value="confortable">Confortable</option>
              <option value="compact">Compacte (plus de lignes visibles)</option>
            </select>
          </div>
        </div>

        <div className="dialog-actions theme-actions">
          <button className="btn btn-primary" onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  )
}
