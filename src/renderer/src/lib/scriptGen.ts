import type { ColumnInfo, ProcParameter } from '@shared/types'

/**
 * Scripts générés depuis l'explorateur d'objets, au format de SSMS (« Générer
 * un script en tant que… », « Sélectionner les 1000 premières lignes »).
 * Rien n'est exécuté ici : on produit seulement le texte SQL.
 */

/** Identifiant délimité SQL Server : les `]` internes sont doublés. */
export function bracket(id: string): string {
  return `[${id.replace(/]/g, ']]')}]`
}

export function qualify(schema: string, name: string): string {
  return `${bracket(schema)}.${bracket(name)}`
}

function useHeader(db: string): string {
  return `USE ${bracket(db)}\nGO\n\n`
}

/** Colonnes une par ligne, virgule en tête de ligne (mise en forme SSMS). */
function columnList(cols: string[], indent: string): string {
  return cols.map((c, i) => (i === 0 ? c : `${indent},${c}`)).join('\n')
}

export function selectTopScript(db: string, schema: string, name: string, cols: ColumnInfo[], n = 1000): string {
  const list = cols.length > 0 ? columnList(cols.map((c) => bracket(c.name)), '      ') : '*'
  return (
    `/****** Script de la commande « Sélectionner les ${n} premières lignes » (GTrace) ******/\n` +
    `SELECT TOP (${n}) ${list}\n  FROM ${bracket(db)}.${qualify(schema, name)}`
  )
}

export function selectScript(db: string, schema: string, name: string, cols: ColumnInfo[]): string {
  const list = cols.length > 0 ? columnList(cols.map((c) => bracket(c.name)), '      ') : '*'
  return `${useHeader(db)}SELECT ${list}\n  FROM ${qualify(schema, name)}\nGO\n`
}

/** Paramètre de modèle à remplir, comme SSMS : <nom, type,>. */
function placeholder(c: ColumnInfo): string {
  return `<${c.name}, ${c.dataType},>`
}

export function insertScript(db: string, schema: string, name: string, cols: ColumnInfo[]): string {
  const writable = cols.filter((c) => !c.isIdentity)
  return (
    `${useHeader(db)}INSERT INTO ${qualify(schema, name)}\n` +
    `           (${columnList(writable.map((c) => bracket(c.name)), '           ')})\n` +
    `     VALUES\n` +
    `           (${columnList(writable.map(placeholder), '           ')})\nGO\n`
  )
}

export function updateScript(db: string, schema: string, name: string, cols: ColumnInfo[]): string {
  const writable = cols.filter((c) => !c.isIdentity)
  const sets = writable.map((c, i) => `${i === 0 ? '   SET ' : '      ,'}${bracket(c.name)} = ${placeholder(c)}`)
  return (
    `${useHeader(db)}UPDATE ${qualify(schema, name)}\n${sets.join('\n')}\n` +
    ` WHERE <Conditions de recherche,,>\nGO\n`
  )
}

export function deleteScript(db: string, schema: string, name: string): string {
  return `${useHeader(db)}DELETE FROM ${qualify(schema, name)}\n      WHERE <Conditions de recherche,,>\nGO\n`
}

export function createScript(db: string, definition: string): string {
  return `${useHeader(db)}${definition.trim()}\nGO\n`
}

/** CREATE (ou CREATE OR ALTER) → ALTER, en sautant les commentaires de tête. */
export function alterScript(db: string, definition: string): string {
  const altered = definition
    .trim()
    .replace(/^((?:\s|--[^\n]*\n|\/\*[\s\S]*?\*\/)*)CREATE(?:\s+OR\s+ALTER)?\b/i, '$1ALTER')
  return `${useHeader(db)}${altered}\nGO\n`
}

export function executeScript(db: string, schema: string, name: string, params: ProcParameter[]): string {
  const decls = params.map((p) => `DECLARE ${p.name} ${p.type}`).join('\n')
  const args = params.map((p) => `${p.name}${p.isOutput ? ' OUTPUT' : ''}`)
  return (
    `${useHeader(db)}DECLARE @RC int\n${decls ? `${decls}\n` : ''}\n` +
    `-- TODO : définir ici les valeurs des paramètres.\n\n` +
    `EXECUTE @RC = ${qualify(schema, name)}${args.length > 0 ? `\n   ${args.join('\n  ,')}` : ''}\nGO\n`
  )
}
