import { memo, useState } from 'react'
import type { RunMessage } from '../../lib/messages'
import { MessageSquareText } from 'lucide-react'
import EmptyState from '../ui/EmptyState'

/**
 * Onglet « Messages » (comme SSMS) : lignes affectées, erreurs en rouge,
 * heure de fin. Double-cliquer sur une erreur sélectionne la ligne fautive
 * dans l'éditeur.
 */
function MessagesPanel({
  messages,
  onGoToLine
}: {
  messages: RunMessage[]
  onGoToLine: (line: number) => void
}): JSX.Element {
  const [selected, setSelected] = useState<number | null>(null)

  if (messages.length === 0) {
    return (
      <EmptyState icon={MessageSquareText} title="Aucun message">
        Après l&apos;exécution : lignes affectées, erreurs (double-cliquez pour aller à la ligne)
        et heure de fin.
      </EmptyState>
    )
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

export default memo(MessagesPanel)
