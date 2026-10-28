import { useState } from 'react'
import type { RunMessage } from '../../lib/messages'

/**
 * Onglet « Messages » (comme SSMS) : lignes affectées, erreurs en rouge,
 * heure de fin. Double-cliquer sur une erreur sélectionne la ligne fautive
 * dans l'éditeur.
 */
export default function MessagesPanel({
  messages,
  onGoToLine
}: {
  messages: RunMessage[]
  onGoToLine: (line: number) => void
}): JSX.Element {
  const [selected, setSelected] = useState<number | null>(null)

  if (messages.length === 0) {
    return <p className="hint">Exécuter d&apos;abord (▶) : les messages du serveur s&apos;afficheront ici.</p>
  }

  return (
    <div className="messages">
      {messages.map((m, i) => (
        <div
          key={i}
          className={`message ${m.kind}${selected === i ? ' selected' : ''}${m.line ? ' has-line' : ''}`}
          onClick={() => setSelected(i)}
          onDoubleClick={() => m.line && onGoToLine(m.line)}
          title={m.line ? `Double-cliquer pour aller à la ligne ${m.line}` : undefined}
        >
          {m.header && <div>{m.header}</div>}
          <div>{m.text}</div>
        </div>
      ))}
    </div>
  )
}
