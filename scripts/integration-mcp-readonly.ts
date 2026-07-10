/**
 * Phase 6.2 — inspection lecture seule via MCP : run_readonly_query (SELECT ok,
 * UPDATE/EXEC rejetés), get_schema_info, masquage de colonnes, journal d'audit,
 * opt-in / révocation par connexion.
 * Lancer :  npx tsx --tsconfig tsconfig.node.json scripts/integration-mcp-readonly.ts
 */
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SidecarService } from '../src/main/services/SidecarService'
import { McpConnectionStore } from '../src/main/services/McpConnectionStore'
import { McpAudit } from '../src/main/mcp/audit'
import { getPool, closeAllPools } from '../src/main/services/SqlService'
import type { ConnectionConfig } from '../src/shared/types'

const CONNECTION: ConnectionConfig = {
  server: 'localhost',
  port: 14333,
  database: 'master',
  user: 'sa',
  password: 'GTrace!Dev2026',
  trustServerCertificate: true
}

const sidecarExe = join(__dirname, '..', 'resources', 'sidecar', 'GTrace.Parser.exe')

let failures = 0
function check(label: string, ok: boolean, detail?: unknown): void {
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : ` — ${JSON.stringify(detail)?.slice(0, 300)}`}`)
  if (!ok) failures++
}

async function main(): Promise<void> {
  const userData = mkdtempSync(join(tmpdir(), 'gtrace-mcp-ro-'))
  mkdirSync(join(userData, 'sessions'), { recursive: true })
  const sidecar = new SidecarService(sidecarExe)

  try {
    // ── DPAPI round-trip (le store en dépend) ─────────────────────────────────
    const enc = await sidecar.dpapiProtect('secret42')
    const dec = await sidecar.dpapiUnprotect(enc)
    check('DPAPI protect/unprotect round-trip', dec === 'secret42', dec)

    // ── Seed : données + connexion MCP opt-in ────────────────────────────────
    const pool = await getPool(CONNECTION)
    await pool.request().batch(
      `IF OBJECT_ID('dbo.GTraceMcpClients') IS NOT NULL DROP TABLE dbo.GTraceMcpClients;
       CREATE TABLE dbo.GTraceMcpClients (Id int PRIMARY KEY, Nom nvarchar(50), Email nvarchar(100));
       INSERT INTO dbo.GTraceMcpClients VALUES (1, N'Alpha', N'a@ex.com'), (2, N'Beta', N'b@ex.com');`
    )
    const store = new McpConnectionStore(userData, sidecar)
    const granted = await store.grant(CONNECTION, 'dev-local', ['email'])
    check('connexion exposée (opt-in) avec masquage email', granted.maskPatterns.includes('email'))
    await closeAllPools()

    // ── Client MCP réel ──────────────────────────────────────────────────────
    const client = new Client({ name: 'gtrace-ro-test', version: '0.0.1' })
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ['--import', 'tsx', 'bin/gtrace-mcp.ts', '--sessions-dir', join(userData, 'sessions')],
        cwd: join(__dirname, '..'),
        env: { ...process.env, GTRACE_SIDECAR: sidecarExe }
      })
    )

    const call = async (name: string, args: Record<string, unknown>): Promise<{ json: any; isError: boolean }> => {
      const res = (await client.callTool({ name, arguments: args })) as {
        content: Array<{ text: string }>
        isError?: boolean
      }
      const text = res.content[0].text
      let json: unknown = text
      try {
        json = JSON.parse(text)
      } catch {
        /* message d'erreur brut */
      }
      return { json, isError: res.isError === true }
    }

    const list = await call('list_readonly_connections', {})
    check('list_readonly_connections voit la connexion', list.json.connections?.[0]?.id === granted.id, list.json)

    // SELECT autorisé + masquage
    const sel = await call('run_readonly_query', {
      connectionId: granted.id,
      sql: 'SELECT Id, Nom, Email FROM dbo.GTraceMcpClients ORDER BY Id;'
    })
    check('SELECT autorisé : 2 lignes', !sel.isError && sel.json.rowCount === 2, sel.json)
    check('colonne Email masquée (***), Nom en clair',
      sel.json.rows?.[0]?.[2] === '***' && sel.json.rows?.[0]?.[1] === 'Alpha', sel.json.rows?.[0])

    // UPDATE rejeté (critère du milestone)
    const upd = await call('run_readonly_query', {
      connectionId: granted.id,
      sql: 'UPDATE dbo.GTraceMcpClients SET Nom = N\'X\' WHERE Id = 1;'
    })
    check('UPDATE rejeté avec message clair',
      upd.isError && String(upd.json).includes('lecture seule'), upd.json)
    const after = await getPool(CONNECTION)
    const stillAlpha = await after.request().query('SELECT Nom FROM dbo.GTraceMcpClients WHERE Id = 1')
    check('UPDATE réellement bloqué (Nom inchangé)', stillAlpha.recordset[0].Nom === 'Alpha')
    await closeAllPools()

    // EXEC / dynamic / OPENROWSET rejetés
    const exec = await call('run_readonly_query', { connectionId: granted.id, sql: 'EXEC sp_who;' })
    check('EXEC rejeté', exec.isError, exec.json)
    const openrowset = await call('run_readonly_query', {
      connectionId: granted.id,
      sql: "SELECT * FROM OPENROWSET('SQLNCLI', 'x', 'SELECT 1');"
    })
    check('OPENROWSET rejeté', openrowset.isError, openrowset.json)

    // maxRows
    const capped = await call('run_readonly_query', {
      connectionId: granted.id,
      sql: 'SELECT Id FROM dbo.GTraceMcpClients ORDER BY Id;',
      maxRows: 1
    })
    check('maxRows respecté + truncated', capped.json.rowCount === 1 && capped.json.truncated === true, capped.json)

    // get_schema_info
    const schema = await call('get_schema_info', { connectionId: granted.id, objectName: 'dbo.GTraceMcpClients' })
    check('get_schema_info : 3 colonnes + clé primaire',
      schema.json.columns?.length === 3 &&
        schema.json.indexes?.some((i: { isPrimaryKey: boolean }) => i.isPrimaryKey),
      schema.json)

    // Connexion inconnue rejetée
    const badConn = await call('run_readonly_query', { connectionId: 'inexistant', sql: 'SELECT 1;' })
    check('connexion non autorisée rejetée', badConn.isError, badConn.json)

    await client.close()

    // ── Audit ────────────────────────────────────────────────────────────────
    const audit = new McpAudit(userData).read()
    check('audit : appels journalisés', audit.length >= 6, audit.length)
    check('audit : le SELECT réussi est tracé',
      audit.some((a) => a.tool === 'run_readonly_query' && a.ok && a.rows === 2), audit.slice(0, 3))
    check('audit : l UPDATE rejeté est tracé (ok=false)',
      audit.some((a) => a.tool === 'run_readonly_query' && !a.ok && a.sql?.includes('UPDATE')),
      audit.filter((a) => !a.ok).slice(0, 2))

    // ── Révocation ───────────────────────────────────────────────────────────
    store.revoke(granted.id)
    const client2 = new Client({ name: 'gtrace-ro-test2', version: '0.0.1' })
    await client2.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ['--import', 'tsx', 'bin/gtrace-mcp.ts', '--sessions-dir', join(userData, 'sessions')],
        cwd: join(__dirname, '..'),
        env: { ...process.env, GTRACE_SIDECAR: sidecarExe }
      })
    )
    const afterRevoke = (await client2.callTool({
      name: 'run_readonly_query',
      arguments: { connectionId: granted.id, sql: 'SELECT 1;' }
    })) as { isError?: boolean }
    check('après révocation : accès refusé', afterRevoke.isError === true)
    await client2.close()

    // Nettoyage base
    const cleanup = await getPool(CONNECTION)
    await cleanup.request().batch('DROP TABLE dbo.GTraceMcpClients;')
    await closeAllPools()
  } finally {
    rmSync(userData, { recursive: true, force: true })
    sidecar.dispose()
    await closeAllPools().catch(() => undefined)
  }

  console.log(`\n${failures === 0 ? 'SUCCÈS' : `${failures} ÉCHEC(S)`}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error('ERREUR FATALE :', e)
  await closeAllPools().catch(() => undefined)
  process.exit(2)
})
