/**
 * Reconnaissance d'un appel de procédure écrit à la main, du type
 * `ma_procedure 1374` ou `EXEC dbo.ma_procedure @Id = 1374, 'x'`.
 *
 * Sert à proposer d'ouvrir le corps de la procédure appelée en reprenant les
 * arguments : l'utilisateur écrit l'appel qu'il connaît, GTrace se charge
 * d'aller chercher le code et de pré-remplir les paramètres.
 */
export interface ProcCall {
  /** Nom tel qu'écrit, crochets retirés, ex. « dbo.ma_procedure ». */
  name: string
  /** Arguments positionnels ou nommés, dans l'ordre d'écriture. */
  args: string[]
}

/** Découpe sur les virgules de premier niveau (hors quotes et parenthèses). */
function splitArgs(rest: string): string[] {
  const out: string[] = []
  let depth = 0
  let quote: string | null = null
  let cur = ''
  for (const ch of rest) {
    if (quote) {
      cur += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      cur += ch
      continue
    }
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      out.push(cur.trim())
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

const NAME = String.raw`(?:\[[^\]]+\]|[A-Za-z_#@][\w@$#]*)`

export function parseProcCall(sql: string): ProcCall | null {
  // Retire commentaires de ligne, commentaires de bloc et point-virgule final.
  const cleaned = sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .trim()
    .replace(/;+\s*$/, '')
    .trim()
  if (!cleaned) return null

  const re = new RegExp(`^(?:EXEC(?:UTE)?\\s+)?(${NAME}(?:\\s*\\.\\s*${NAME}){0,2})\\s*([\\s\\S]*)$`, 'i')
  const m = re.exec(cleaned)
  if (!m) return null

  const name = m[1].replace(/[[\]]/g, '').replace(/\s*\.\s*/g, '.').trim()
  // Un mot-clé seul n'est pas un appel de procédure.
  if (/^(select|insert|update|delete|merge|declare|set|if|while|begin|with|create|alter|drop|use|print)$/i.test(name)) {
    return null
  }
  const rest = m[2].trim()
  return { name, args: rest ? splitArgs(rest) : [] }
}

/**
 * Associe les arguments de l'appel aux paramètres de la procédure.
 * Gère la forme nommée (`@Id = 5`) comme la forme positionnelle.
 */
export function mapArgsToParams(
  args: string[],
  params: { name: string }[]
): Record<string, string | null> {
  const values: Record<string, string | null> = {}
  let positional = 0
  for (const raw of args) {
    const named = /^\s*(@[\w$#]+)\s*=\s*([\s\S]+)$/.exec(raw)
    if (named) {
      const target = params.find((p) => p.name.toLowerCase() === named[1].toLowerCase())
      if (target) values[target.name] = clean(named[2])
      continue
    }
    const target = params[positional++]
    if (target) values[target.name] = clean(raw)
  }
  return values
}

/** Retire les quotes SQL externes et le mot-clé OUTPUT. */
function clean(v: string): string {
  const t = v.trim().replace(/\s+(OUTPUT|OUT)$/i, '').trim()
  const m = /^N?'([\s\S]*)'$/.exec(t)
  return m ? m[1].replace(/''/g, "'") : t
}
