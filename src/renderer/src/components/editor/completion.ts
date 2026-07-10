import * as monaco from 'monaco-editor'

/**
 * Auto-complétion T-SQL pour Monaco : mots-clés/fonctions intégrés + schéma
 * dynamique (objets et colonnes de la base connectée, alimenté par App via
 * setCompletionSchema). Un seul provider est enregistré pour le langage 'sql'.
 */

const KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING', 'JOIN', 'INNER JOIN',
  'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'CROSS JOIN', 'ON', 'AS', 'AND', 'OR', 'NOT',
  'IN', 'EXISTS', 'BETWEEN', 'LIKE', 'IS NULL', 'IS NOT NULL', 'TOP', 'DISTINCT',
  'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'MERGE', 'OUTPUT', 'INTO',
  'CREATE', 'ALTER', 'DROP', 'PROCEDURE', 'FUNCTION', 'VIEW', 'TABLE', 'INDEX',
  'DECLARE', 'BEGIN', 'END', 'IF', 'ELSE', 'WHILE', 'RETURN', 'BREAK', 'CONTINUE',
  'TRY', 'CATCH', 'THROW', 'RAISERROR', 'BEGIN TRANSACTION', 'COMMIT', 'ROLLBACK',
  'BEGIN TRY', 'END TRY', 'BEGIN CATCH', 'END CATCH', 'EXEC', 'EXECUTE', 'UNION',
  'UNION ALL', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'WITH', 'OVER', 'PARTITION BY',
  'ASC', 'DESC', 'OFFSET', 'FETCH', 'NEXT', 'ROWS', 'ONLY', 'PIVOT', 'APPLY',
  'CROSS APPLY', 'OUTER APPLY'
]

const FUNCTIONS = [
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'ISNULL', 'COALESCE', 'NULLIF', 'CAST', 'CONVERT',
  'TRY_CAST', 'TRY_CONVERT', 'GETDATE', 'SYSDATETIME', 'DATEADD', 'DATEDIFF', 'DATEPART',
  'YEAR', 'MONTH', 'DAY', 'FORMAT', 'LEN', 'LEFT', 'RIGHT', 'SUBSTRING', 'REPLACE',
  'UPPER', 'LOWER', 'LTRIM', 'RTRIM', 'TRIM', 'CONCAT', 'STRING_AGG', 'ROW_NUMBER',
  'RANK', 'DENSE_RANK', 'IIF', 'CHOOSE', 'ABS', 'ROUND', 'FLOOR', 'CEILING',
  'NEWID', 'SCOPE_IDENTITY', 'OBJECT_ID', 'OBJECT_NAME'
]

interface CompletionSchema {
  /** Noms qualifiés d'objets (schema.name) : tables, vues, procédures, fonctions */
  objects: string[]
  /** Noms de colonnes distincts */
  columns: string[]
}

// État posé sur `window` pour survivre au remplacement de module par le HMR
// (sinon : double enregistrement du provider → suggestions dupliquées, et
// désync entre l'écriture du schéma par App et sa lecture par le provider).
interface CompletionGlobal {
  registered: boolean
  schema: CompletionSchema
}
const g = window as unknown as { __gtraceCompletion?: CompletionGlobal }
if (!g.__gtraceCompletion) {
  g.__gtraceCompletion = { registered: false, schema: { objects: [], columns: [] } }
}
const store = g.__gtraceCompletion

export function setCompletionSchema(objects: string[], columns: string[]): void {
  store.schema = { objects, columns }
}

/** Enregistre le provider d'auto-complétion 'sql' (une seule fois, HMR compris). */
export function registerSqlCompletion(): void {
  if (store.registered) return
  store.registered = true

  monaco.languages.registerCompletionItemProvider('sql', {
    triggerCharacters: [' ', '.', ',', '('],
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position)
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn
      }
      const K = monaco.languages.CompletionItemKind
      const suggestions: monaco.languages.CompletionItem[] = []

      for (const kw of KEYWORDS) {
        suggestions.push({ label: kw, kind: K.Keyword, insertText: kw, range, sortText: '3' + kw })
      }
      for (const fn of FUNCTIONS) {
        suggestions.push({
          label: fn,
          kind: K.Function,
          insertText: `${fn}()`,
          range,
          detail: 'fonction',
          sortText: '2' + fn
        })
      }
      for (const o of store.schema.objects) {
        suggestions.push({
          label: o,
          kind: K.Struct,
          insertText: o,
          range,
          detail: 'objet',
          sortText: '0' + o
        })
      }
      for (const c of store.schema.columns) {
        suggestions.push({
          label: c,
          kind: K.Field,
          insertText: c,
          range,
          detail: 'colonne',
          sortText: '1' + c
        })
      }
      return { suggestions }
    }
  })
}
