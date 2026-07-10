/**
 * Phase 5 — mode lecture seule strict + export de session.
 * Lancer :  npx tsx --tsconfig tsconfig.node.json scripts/integration-phase5.ts
 */
import { join } from 'node:path'
import { SidecarService } from '../src/main/services/SidecarService'
import { DebugService } from '../src/main/services/DebugService'
import { buildMarkdown } from '../src/main/services/ExportService'
import { closeAllPools, getPool } from '../src/main/services/SqlService'
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
  await pool.request().batch(
    `IF OBJECT_ID('dbo.GTraceRoTest') IS NOT NULL DROP TABLE dbo.GTraceRoTest;
     CREATE TABLE dbo.GTraceRoTest (Id int);`
  )

  // ── Lecture seule : refus d'un script qui écrit dans une vraie table ────────
  {
    let refused: string | null = null
    try {
      await debug.run({
        connection: CONNECTION,
        sql: 'INSERT INTO dbo.GTraceRoTest VALUES (1);\nSELECT 1 AS X;',
        compatLevel: 160,
        readOnly: true
      })
    } catch (e) {
      refused = e instanceof Error ? e.message : String(e)
    }
    check('écriture vers table réelle refusée', refused !== null)
    check('message : ligne + type + cible',
      refused?.includes('ligne 1') === true &&
        refused.includes('INSERT') &&
        refused.includes('GTraceRoTest'),
      refused)
    const rows = await pool.request().query('SELECT COUNT(*) AS n FROM dbo.GTraceRoTest')
    check('rien n a été exécuté', Number(rows.recordset[0].n) === 0)
  }

  // ── Lecture seule : #temp et variables tables passent ──────────────────────
  {
    const run = await debug.run({
      connection: CONNECTION,
      sql: `CREATE TABLE #ro (Id int);
DECLARE @v TABLE (Id int);
INSERT INTO #ro VALUES (1);
INSERT INTO @v VALUES (2);
SELECT (SELECT COUNT(*) FROM #ro) + (SELECT COUNT(*) FROM @v) AS Total;`,
      compatLevel: 160,
      readOnly: true
    })
    check('#temp / @tablevar autorisées en lecture seule',
      run.errors.length === 0 && Number(run.resultsets[0]?.rows[0]?.[0]) === 2,
      run.errors)
  }

  // ── Lecture seule : liste blanche ───────────────────────────────────────────
  {
    const run = await debug.run({
      connection: CONNECTION,
      sql: 'INSERT INTO dbo.GTraceRoTest VALUES (1);\nSELECT COUNT(*) AS N FROM dbo.GTraceRoTest;',
      compatLevel: 160,
      readOnly: true,
      readOnlyWhitelist: ['dbo.GTraceRoTest']
    })
    check('liste blanche : écriture autorisée',
      run.errors.length === 0 && Number(run.resultsets[0]?.rows[0]?.[0]) === 1, run.errors)
  }

  // ── Lecture seule : EXEC opaque refusé ──────────────────────────────────────
  {
    let refused = false
    try {
      await debug.run({
        connection: CONNECTION,
        sql: "DECLARE @s nvarchar(50) = N'SELECT 1'; EXEC (@s);",
        compatLevel: 160,
        readOnly: true
      })
    } catch (e) {
      refused = e instanceof Error && e.message.includes('opaque')
    }
    check('SQL dynamique refusé (opaque)', refused)
  }

  // ── Export Markdown ─────────────────────────────────────────────────────────
  {
    const run = await debug.run({
      connection: CONNECTION,
      sql: `DECLARE @x int = 21;
SET @x = @x * 2;
SELECT @x AS Reponse;`,
      compatLevel: 160,
      snapshots: []
    })
    const md = buildMarkdown({
      title: 'export-test',
      server: CONNECTION.server,
      database: CONNECTION.database,
      sql: 'DECLARE @x int = 21;',
      run
    })
    check('markdown : titre + timeline + variables + resultset',
      md.includes('# GTrace — session de debug : export-test') &&
        md.includes('| # | Ligne | Statement |') &&
        md.includes('@x = 42') &&
        md.includes('| Reponse |') &&
        md.includes('```sql'),
      md.slice(0, 400))
  }

  await pool.request().batch('DROP TABLE dbo.GTraceRoTest;')
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
