/**
 * Test d'intégration bout-en-bout de la stratégie A contre un SQL Server réel.
 * Prérequis : conteneur docker « gtrace-sql » (voir README) + sidecar publié.
 * Lancer :   npx tsx --tsconfig tsconfig.node.json scripts/integration-replay.ts
 */
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

// Procédure exerçant les cas critiques : boucle WHILE, #temp, transaction avec
// ROLLBACK (les traces doivent survivre), TRY/CATCH, RETURN avec valeur, OUTPUT.
const PROC = `CREATE PROCEDURE dbo.TestGTrace
  @Facteur int,
  @Total decimal(18,2) OUTPUT
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @i int = 0;
  CREATE TABLE #tmp (Id int, Val decimal(18,2));
  WHILE @i < 3
  BEGIN
    SET @i = @i + 1;
    INSERT INTO #tmp VALUES (@i, @i * @Facteur);
  END
  SELECT @Total = SUM(Val) FROM #tmp;
  BEGIN TRANSACTION;
  UPDATE #tmp SET Val = 0;
  ROLLBACK;
  SELECT Id, Val FROM #tmp ORDER BY Id;
  BEGIN TRY
    RAISERROR('erreur volontaire', 16, 1);
  END TRY
  BEGIN CATCH
    SET @i = -1;
  END CATCH
  RETURN 42;
END`

let failures = 0
function check(label: string, ok: boolean, detail?: unknown): void {
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : ` — ${JSON.stringify(detail)}`}`)
  if (!ok) failures++
}

async function main(): Promise<void> {
  const sidecar = new SidecarService(join(__dirname, '..', 'resources', 'sidecar', 'GTrace.Parser.exe'))
  const debug = new DebugService(sidecar)

  const result = await debug.run({
    connection: CONNECTION,
    sql: PROC,
    compatLevel: 160,
    paramValues: { '@Facteur': '10' }
  })

  console.log(`\nSession ${result.sessionId} — ${result.steps.length} steps, ` +
    `${result.resultsets.length} resultsets métier, ${result.errors.length} erreurs driver\n`)

  check('instrumentation sans erreur', result.instrument.errors.length === 0, result.instrument.errors)
  check('au moins 12 steps capturés', result.steps.length >= 12, result.steps.length)

  // La boucle tourne 3 fois : SET @i doit apparaître 3 fois avec @i = 1, 2, 3
  const setISteps = result.steps.filter((s) => '@i' in s.variables && s.kind === 'step')
  const iValues = setISteps.map((s) => s.variables['@i'])
  check('itérations de boucle visibles (@i = 1,2,3)',
    JSON.stringify(iValues.slice(0, 4)) === JSON.stringify([0, 1, 2, 3]) ||
    JSON.stringify(iValues.slice(0, 4)).includes('1,2,3'), iValues)

  // Les steps INSERT dans la transaction rollbackée doivent être présents
  const insertSteps = result.steps.filter((s) =>
    result.instrument.statements[s.statementIndex]?.type === 'InsertStatement')
  check('3 INSERT tracés (dans la boucle)', insertSteps.length === 3, insertSteps.length)
  check('INSERT: @@ROWCOUNT = 1', insertSteps.every((s) => s.rowCount === 1),
    insertSteps.map((s) => s.rowCount))

  // Survie au ROLLBACK : l'UPDATE et le ROLLBACK eux-mêmes sont tracés
  const updateStep = result.steps.find((s) =>
    result.instrument.statements[s.statementIndex]?.type === 'UpdateStatement')
  check('UPDATE (rollbacké) tracé quand même', updateStep !== undefined)
  check('UPDATE: @@ROWCOUNT = 3', updateStep?.rowCount === 3, updateStep?.rowCount)
  const rollbackStep = result.steps.find((s) =>
    result.instrument.statements[s.statementIndex]?.type === 'RollbackTransactionStatement')
  check('ROLLBACK tracé (la trace survit)', rollbackStep !== undefined)

  // OUTPUT : @Total = (1+2+3) * 10 = 60 (le rollback n'affecte pas la variable)
  check('@Total OUTPUT = 60', Number(result.outputValues['@Total']) === 60, result.outputValues)

  // Resultset métier : les 3 lignes de #tmp, valeurs d'origine (rollback de l'UPDATE)
  const business = result.resultsets[0]
  check('resultset métier : 3 lignes', business?.rows.length === 3, business?.rows)
  check('valeurs restaurées par le ROLLBACK (10,20,30)',
    JSON.stringify(business?.rows.map((r) => Number(r[1]))) === '[10,20,30]', business?.rows)
  check('resultset rattaché à un step', business?.stepIndex !== null, business)

  // TRY/CATCH : trace d'entrée de CATCH avec le détail de l'erreur
  const catchStep = result.steps.find((s) => s.kind === 'catch')
  check('entrée de CATCH tracée', catchStep !== undefined)
  check('erreur 50000 « erreur volontaire »',
    catchStep?.error?.number === 50000 && catchStep.error.message.includes('volontaire'),
    catchStep?.error)
  check('ERROR_LINE mappe sur le source original (ligne 20 = RAISERROR)',
    catchStep?.error?.line === 20, catchStep?.error?.line)

  // RETURN 42 capturé
  const returnStep = result.steps.find((s) => s.returnValue !== null)
  check('RETURN 42 capturé dans _ret', Number(returnStep?.returnValue) === 42,
    returnStep?.returnValue)

  // Timestamps serveur : durées calculables
  check('timestamps serveur présents', result.steps.every((s) => s.kind === 'catch' || s.executedAt !== null))

  // ── Backend explorateur : créer une vraie proc, la lister, charger son source ──
  const pool = await getPool(CONNECTION)
  await pool.request().batch(
    `IF OBJECT_ID('dbo.GTraceExplorerTest') IS NOT NULL DROP PROCEDURE dbo.GTraceExplorerTest;`
  )
  await pool.request().batch(
    `CREATE PROCEDURE dbo.GTraceExplorerTest @X int AS BEGIN SELECT @X * 2 AS Resultat; END`
  )
  const procs = await listProcedures(CONNECTION)
  const found = procs.find((p) => p.schema === 'dbo' && p.name === 'GTraceExplorerTest')
  check('proc:list voit la procédure créée', found !== undefined, procs.map((p) => p.name))
  if (found) {
    const source = await loadProcedure(CONNECTION, found.objectId)
    check('proc:load renvoie la définition', source.definition.includes('SELECT @X * 2'), source)

    // Replay direct sur la proc chargée depuis la base
    const run2 = await debug.run({
      connection: CONNECTION,
      sql: source.definition,
      compatLevel: 160,
      paramValues: { '@X': '21' }
    })
    check('replay de la proc chargée : SELECT tracé et resultset 42',
      Number(run2.resultsets[0]?.rows[0]?.[0]) === 42, run2.resultsets)
  }
  await pool.request().batch(`DROP PROCEDURE dbo.GTraceExplorerTest;`)

  console.log(`\n${failures === 0 ? 'SUCCÈS' : `${failures} ÉCHEC(S)`}`)
  sidecar.dispose()
  await closeAllPools()
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('ERREUR FATALE :', e)
  process.exit(2)
})
