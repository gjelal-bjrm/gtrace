import type { JSX } from 'react'
import { useEscapeClose } from '../../lib/useEscapeClose'

/**
 * Aide intégrée : à quoi sert chaque bouton, chaque panneau, et comment mener
 * les trois gestes de base (exécuter, déboguer, profiler). Volontairement
 * concrète et comparative — plusieurs panneaux se ressemblent, l'aide dit
 * précisément ce qui les distingue.
 */
export default function HelpDialog({ onClose }: { onClose: () => void }): JSX.Element {
  useEscapeClose(onClose)

  return (
    <div className="modal-overlay">
      <div className="modal help-dialog">
        <div className="modal-header">
          <span>❓ Comment utiliser GTrace</span>
          <button className="btn btn-icon" onClick={onClose} title="Fermer">
            ✕
          </button>
        </div>

        <div className="modal-body help-body">
          <h3>Les trois façons de lancer du SQL</h3>
          <div className="help-cards">
            <div className="help-card">
              <div className="help-card-title run">▶ Exécuter <span className="help-key">F5</span></div>
              <p>
                Lance le SQL <strong>et enregistre une trace pas à pas</strong> : chaque
                instruction exécutée, les variables qu&apos;elle a modifiées, ses résultats.
                C&apos;est le mode normal, celui qui alimente la timeline en bas.
              </p>
              <p className="help-tip">
                Si vous <strong>surlignez du texte</strong>, seule la sélection est exécutée — le
                bouton l&apos;annonce alors clairement.
              </p>
            </div>

            <div className="help-card">
              <div className="help-card-title">🔍 Analyser</div>
              <p>
                <strong>Ne touche pas au serveur.</strong> Vérifie la syntaxe, découpe le script en
                instructions et repère les paramètres de la procédure.
              </p>
              <p className="help-tip">
                À utiliser pour valider un script avant de le lancer, ou pour faire apparaître les
                champs de paramètres dans l&apos;onglet <em>Exécution</em>.
              </p>
            </div>

            <div className="help-card">
              <div className="help-card-title">⚡ Profiler</div>
              <p>
                Exécute le SQL <strong>tel quel, sans instrumentation</strong>, et mesure le temps
                réellement passé sur chaque ligne.
              </p>
              <p className="help-tip">
                À utiliser quand la question est « <em>pourquoi c&apos;est lent ?</em> ». En
                contrepartie : pas de variables ni de pas à pas, puisque le code n&apos;est pas
                instrumenté.
              </p>
            </div>
          </div>

          <h3>Déboguer pas à pas, avec des points d&apos;arrêt</h3>
          <ol className="help-steps">
            <li>
              Dans l&apos;explorateur à gauche, ouvrez <em>Procédures stockées</em> et cliquez sur
              l&apos;icône <strong>🐞</strong> de la procédure : son code s&apos;ouvre dans un onglet.
            </li>
            <li>
              Renseignez ses paramètres dans l&apos;onglet <strong>Exécution</strong>.
            </li>
            <li>
              <strong>Cliquez dans la marge grise</strong>, à gauche du numéro de ligne : un point
              rouge apparaît. C&apos;est votre point d&apos;arrêt.
            </li>
            <li>
              Le bouton devient <strong>▶ Déboguer</strong>. Lancez-le : l&apos;exécution
              s&apos;arrête sur chaque point d&apos;arrêt.
            </li>
            <li>
              À la pause, consultez <strong>Variables</strong> et <strong>Inspect</strong>, puis
              <strong> Continuer</strong> ou <strong>Step</strong> pour avancer.
            </li>
          </ol>
          <p className="help-note">
            La première fois, GTrace demande à créer une petite base technique{' '}
            <span className="vars">GTraceDB</span> : elle sert uniquement à envoyer les ordres
            « continuer / pas à pas » à la session en cours. Vos bases ne sont pas touchées.
          </p>

          <h3>À quoi sert chaque panneau</h3>
          <table className="help-table">
            <thead>
              <tr>
                <th>Panneau</th>
                <th>Ce qu&apos;on y trouve</th>
                <th>Quand s&apos;en servir</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="help-pane">Exécution</td>
                <td>
                  Les paramètres de la procédure, les options (mode lecture seule, tables à
                  suivre), l&apos;export de session et le diagnostic assisté.
                </td>
                <td>Avant de lancer — c&apos;est le point de départ.</td>
              </tr>
              <tr>
                <td className="help-pane">Variables</td>
                <td>
                  La valeur de <strong>toutes</strong> les variables au step sélectionné,
                  reconstruite depuis le début de l&apos;exécution.
                </td>
                <td>
                  Pour suivre l&apos;évolution d&apos;une valeur. Se déplace avec la timeline.
                </td>
              </tr>
              <tr>
                <td className="help-pane">Résultats</td>
                <td>
                  Les jeux de données que votre SQL <strong>renvoie</strong> (vos{' '}
                  <span className="vars">SELECT</span>).
                </td>
                <td>Pour lire ce que la requête a produit.</td>
              </tr>
              <tr>
                <td className="help-pane">Données</td>
                <td>
                  Le <strong>contenu des tables suivies</strong> (<span className="vars">#temp</span>,{' '}
                  <span className="vars">@variables</span>, tables réelles), capturé après chaque
                  écriture, avec le différentiel avant/après.
                </td>
                <td>
                  Pour voir ce qui a été écrit <em>même sans</em> <span className="vars">SELECT</span> —
                  et ça survit à un <span className="vars">ROLLBACK</span>.
                </td>
              </tr>
              <tr>
                <td className="help-pane">Inspect</td>
                <td>
                  <strong>Vos propres requêtes</strong>, réévaluées automatiquement à chaque pause.
                </td>
                <td>
                  Pendant un débogage, pour interroger la base sur autre chose que les variables.
                </td>
              </tr>
              <tr>
                <td className="help-pane">Profil</td>
                <td>Le temps passé par ligne, du plus lent au plus rapide.</td>
                <td>
                  Après un <strong>⚡ Profiler</strong> uniquement.
                </td>
              </tr>
            </tbody>
          </table>

          <h3>La bande colorée en bas : la chronologie</h3>
          <p className="help-para">
            Chaque petite case est <strong>une instruction réellement exécutée</strong>, dans
            l&apos;ordre. Sa couleur indique le temps qu&apos;elle a pris — du gris (rapide) au
            rouge (parmi les plus lentes) — et le rouge vif signale une erreur interceptée. Une
            boucle qui tourne 50 fois produit 50 cases.
          </p>
          <p className="help-para">
            <strong>Cliquez une case</strong> pour revenir à ce moment : l&apos;éditeur surligne la
            ligne concernée et l&apos;onglet <em>Variables</em> reprend les valeurs qu&apos;elles
            avaient <em>à cet instant</em>. C&apos;est tout l&apos;intérêt du voyage dans le
            temps : on rejoue l&apos;exécution sans relancer la requête. Les flèches{' '}
            <span className="help-key">⏮ ◀ ▶ ⏭</span> font la même chose au clavier avec{' '}
            <span className="help-key">F10</span> et <span className="help-key">Maj+F10</span>.
          </p>

          <h3>Deux confusions fréquentes</h3>
          <ul className="help-diff">
            <li>
              <strong>Variables ou Inspect ?</strong> <em>Variables</em> est automatique : ce que le
              code a lui-même modifié. <em>Inspect</em> est manuel : les requêtes que{' '}
              <strong>vous</strong> écrivez pour interroger la base pendant une pause.
            </li>
            <li>
              <strong>Résultats ou Données ?</strong> <em>Résultats</em> = ce que la requête
              renvoie au client. <em>Données</em> = le contenu réel des tables, même si aucun{' '}
              <span className="vars">SELECT</span> ne les affiche.
            </li>
          </ul>

          <h3>Raccourcis</h3>
          <table className="help-table help-keys">
            <tbody>
              <tr>
                <td>Exécuter</td>
                <td>
                  <span className="help-key">F5</span> ou{' '}
                  <span className="help-key">Ctrl+Entrée</span>
                </td>
                <td>Step suivant / précédent</td>
                <td>
                  <span className="help-key">F10</span> /{' '}
                  <span className="help-key">Maj+F10</span>
                </td>
              </tr>
              <tr>
                <td>Nouvel onglet</td>
                <td>
                  <span className="help-key">Ctrl+N</span>
                </td>
                <td>Premier / dernier step</td>
                <td>
                  <span className="help-key">Ctrl+←</span> /{' '}
                  <span className="help-key">Ctrl+→</span>
                </td>
              </tr>
              <tr>
                <td>Ouvrir / Enregistrer</td>
                <td>
                  <span className="help-key">Ctrl+O</span> /{' '}
                  <span className="help-key">Ctrl+S</span>
                </td>
                <td>Fermer l&apos;onglet</td>
                <td>
                  <span className="help-key">Ctrl+W</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="dialog-actions help-actions">
          <button className="btn btn-primary" onClick={onClose}>
            J&apos;ai compris
          </button>
        </div>
      </div>
    </div>
  )
}
