/**
 * Critère de sortie Phase 1 : déboguer une procédure réelle de 300+ lignes.
 * Pipeline complet : setup schéma → CREATE PROC en base → proc:list → proc:load
 * → instrumentation → replay → assertions sur steps/erreurs/outputs/mapping.
 * Lancer :  npx tsx --tsconfig tsconfig.node.json scripts/integration-bigproc.ts
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SidecarService } from '../src/main/services/SidecarService'
import { DebugService } from '../src/main/services/DebugService'
import { closeAllPools, getPool, listProcedures, loadProcedure } from '../src/main/services/SqlService'
import type { ConnectionConfig } from '../src/shared/types'

const CONNECTION: ConnectionConfig = {
  server: 'localhost',
  port: 14333,
  database: 'master',
  user: 'sa',
  password: 'GTrace!Dev2026',
  trustServerCertificate: true
}

let failures = 0
function check(label: string, ok: boolean, detail?: unknown): void {
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : ` — ${JSON.stringify(detail)}`}`)
  if (!ok) failures++
}

async function main(): Promise<void> {
  const sidecar = new SidecarService(
    join(__dirname, '..', 'resources', 'sidecar', 'GTrace.Parser.exe')
  )
  const debug = new DebugService(sidecar)
  const pool = await getPool(CONNECTION)

  // ── Setup schéma + données + procédure ─────────────────────────────────────
  const setupSql = readFileSync(join(__dirname, 'fixtures', 'ventes-setup.sql'), 'utf8')
  for (const batch of setupSql.split(/^\s*GO\s*$/m).filter((b) => b.trim())) {
    await pool.request().batch(batch)
  }
  const procSql = readFileSync(join(__dirname, 'fixtures', 'TraiteCommandesEnAttente.sql'), 'utf8')
  await pool.request().batch(procSql)
  console.log('Schéma ventes + procédure créés.\n')

  // ── Explorateur : lister puis charger le source depuis la base ─────────────
  const procs = await listProcedures(CONNECTION)
  const found = procs.find((p) => p.schema === 'ventes' && p.name === 'TraiteCommandesEnAttente')
  check('proc:list voit ventes.TraiteCommandesEnAttente', found !== undefined)
  if (!found) throw new Error('procédure absente')

  const source = await loadProcedure(CONNECTION, found.objectId)
  const lineCount = source.definition.split('\n').length
  check(`source de 300+ lignes (${lineCount})`, lineCount >= 300, lineCount)

  // ── Replay en mode simulation (défaut) ─────────────────────────────────────
  const t0 = Date.now()
  const run = await debug.run({
    connection: CONNECTION,
    sql: source.definition,
    compatLevel: 160,
    paramValues: { '@DateLimite': '2026-07-04' }
  })
  const elapsed = Date.now() - t0
  console.log(
    `\nRun simulation : ${run.steps.length} steps, ${run.resultsets.length} resultsets, ` +
      `${run.errors.length} erreurs driver, ${elapsed} ms\n`
  )

  check('instrumentation sans erreur', run.instrument.errors.length === 0, run.instrument.errors)
  check('aucune erreur driver non gérée', run.errors.length === 0, run.errors)
  check('volume de steps réaliste (≥ 120)', run.steps.length >= 120, run.steps.length)
  check(
    'toutes les lignes des steps sont dans le source',
    run.steps.every((s) => s.startLine >= 1 && s.endLine <= lineCount),
    run.steps.filter((s) => s.startLine < 1 || s.endLine > lineCount).slice(0, 3)
  )

  // La commande 4 (quantité 0) doit échouer : exactement 1 entrée CATCH
  const catches = run.steps.filter((s) => s.kind === 'catch')
  check('exactement 1 passage en CATCH (commande 4)', catches.length === 1, catches.length)
  check(
    'erreur métier « Quantité invalide » remontée',
    catches[0]?.error?.message.includes('Quantité invalide') === true,
    catches[0]?.error
  )

  // 6 candidates, 5 traitées, 1 erreur → RETURN 1
  check('@NbTraitees = 5', Number(run.outputValues['@NbTraitees']) === 5, run.outputValues)
  check(
    '@MontantGlobal > 0',
    Number(run.outputValues['@MontantGlobal']) > 0,
    run.outputValues['@MontantGlobal']
  )
  const returnStep = run.steps.find((s) => s.returnValue !== null)
  check('RETURN 1 (lot terminé avec erreurs)', Number(returnStep?.returnValue) === 1,
    returnStep?.returnValue)

  // Resultsets : récap + erreurs + journal (journal vide : rollback simulation)
  check('3 resultsets métier', run.resultsets.length === 3, run.resultsets.length)
  check(
    'récap : 6 candidates / 5 traitées / 1 erreur',
    JSON.stringify(run.resultsets[0]?.rows[0]?.slice(0, 3).map(Number)) === '[6,5,1]',
    run.resultsets[0]?.rows
  )
  check(
    'erreurs : 1 ligne pour la commande 4 (la variable table survit au rollback)',
    run.resultsets[1]?.rows.length === 1 && Number(run.resultsets[1].rows[0][0]) === 4,
    run.resultsets[1]?.rows
  )
  // Le savepoint annule l'INSERT « Majoration » (dans la transaction) mais pas
  // l'INSERT « Commande traitée » (après COMMIT) : 5 lignes, aucune majoration.
  const journalMessages = (run.resultsets[2]?.rows ?? []).map((r) => String(r[1]))
  check(
    'journal : 5 « Commande traitée », zéro « Majoration » (savepoint)',
    journalMessages.length === 5 &&
      journalMessages.every((m) => m.startsWith('Commande traitée')) &&
      !journalMessages.some((m) => m.includes('Majoration')),
    journalMessages
  )

  // Les itérations de la boucle interne sont visibles : @LigneCourante parcourt 1..N
  const ligneValues = run.steps
    .filter((s) => '@LigneCourante' in s.variables)
    .map((s) => Number(s.variables['@LigneCourante']))
  check('itérations internes visibles (≥ 15 écritures de @LigneCourante)',
    ligneValues.filter((v) => v > 0).length >= 15, ligneValues.length)

  // Statements non tracés : l'UPDATE suivi de IF @@ROWCOUNT doit être protégé
  const skipped = run.instrument.statements.filter((s) => s.kind === 'statement' && !s.traced)
  check(
    "l'UPDATE avant IF @@ROWCOUNT est non tracé (protection)",
    skipped.some((s) => s.type === 'UpdateStatement'),
    skipped.map((s) => `${s.type}@${s.startLine}`)
  )

  // ── Second run : mode réel (@ModeSimulation = 0) ───────────────────────────
  const run2 = await debug.run({
    connection: CONNECTION,
    sql: source.definition,
    compatLevel: 160,
    paramValues: { '@DateLimite': '2026-07-04', '@ModeSimulation': '0' }
  })
  check('mode réel : 5 traitées', Number(run2.outputValues['@NbTraitees']) === 5,
    run2.outputValues)

  const statuts = await pool
    .request()
    .query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ventes.Commande
       WHERE Statut = N'Traitee' AND MontantTotal IS NOT NULL AND CommandeId IN (1,2,3,5,6)`
    )
  check('mode réel : les 5 commandes candidates passées à « Traitee » en base',
    statuts.recordset[0].n === 5, statuts.recordset[0])

  console.log(`\n${failures === 0 ? 'SUCCÈS' : `${failures} ÉCHEC(S)`}`)
  sidecar.dispose()
  await closeAllPools()
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error('ERREUR FATALE :', e)
  await closeAllPools().catch(() => undefined)
  process.exit(2)
})
