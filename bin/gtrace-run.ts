/**
 * GTrace — mode headless (spec Phase 6 §4) : lance une session instrumentée
 * sans fenêtre Electron. La session est persistée dans l'historique et donc
 * interrogeable ensuite via le serveur MCP.
 *
 * Connexion : soit une connexion MCP autorisée (--connection <id|label>, flag
 * « runs autonomes » requis), soit des identifiants inline (--server/--user/…).
 *
 *   npx tsx bin/gtrace-run.ts --connection dev-local --proc dbo.CalculPaiement \
 *     --params params.json --output trace-summary.json [--full-trace trace.json]
 *
 * Codes retour : 0 = ok, 1 = session terminée avec erreurs, 2 = échec fatal.
 */
import { parseArgs } from 'node:util'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { SidecarService } from '../src/main/services/SidecarService'
import { McpConnectionStore } from '../src/main/services/McpConnectionStore'
import { closeAllPools } from '../src/main/services/SqlService'
import { runHeadless } from '../src/main/headless/runner'
import type { ConnectionConfig } from '../src/shared/types'

function resolveSessionsDir(explicit?: string): string {
  if (explicit) return explicit
  if (process.env.GTRACE_SESSIONS_DIR) return process.env.GTRACE_SESSIONS_DIR
  const appData =
    process.env.APPDATA ??
    (process.platform === 'darwin'
      ? join(process.env.HOME ?? '', 'Library', 'Application Support')
      : join(process.env.HOME ?? '', '.config'))
  return join(appData, 'gtrace', 'sessions')
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      connection: { type: 'string' },
      server: { type: 'string' },
      port: { type: 'string' },
      database: { type: 'string' },
      user: { type: 'string' },
      password: { type: 'string' },
      proc: { type: 'string' },
      file: { type: 'string' },
      sql: { type: 'string' },
      params: { type: 'string' },
      snapshots: { type: 'string' },
      readonly: { type: 'boolean', default: false },
      compat: { type: 'string' },
      output: { type: 'string' },
      'full-trace': { type: 'string' },
      'sessions-dir': { type: 'string' },
      help: { type: 'boolean', default: false }
    }
  })

  if (values.help || (!values.proc && !values.file && !values.sql)) {
    console.error(
      'Usage : gtrace-run --connection <id|label> | --server <h> --database <db> --user <u> --password <p>\n' +
        '        --proc <schema.nom> | --file <script.sql> | --sql "<T-SQL>"\n' +
        '        [--params params.json] [--snapshots "#t,@v"] [--readonly] [--compat 160]\n' +
        '        [--output summary.json] [--full-trace trace.json] [--sessions-dir <dir>]'
    )
    return values.help ? 0 : 2
  }

  const sessionsDir = resolveSessionsDir(values['sessions-dir'])
  const sidecar = new SidecarService(
    process.env.GTRACE_SIDECAR ?? join(__dirname, '..', 'resources', 'sidecar', 'GTrace.Parser.exe')
  )

  try {
    let config: ConnectionConfig
    if (values.connection) {
      const store = new McpConnectionStore(dirname(sessionsDir), sidecar)
      const found = store.findByIdOrLabel(values.connection)
      if (!found) throw new Error(`Connexion MCP inconnue : ${values.connection}`)
      if (!found.allowUnattendedRuns) {
        throw new Error(
          `La connexion « ${found.label} » n'autorise pas les runs autonomes — activez le flag dans le panneau Activité IA de GTrace.`
        )
      }
      config = (await store.resolve(found.id)).config
    } else if (values.server && values.database && values.user && values.password !== undefined) {
      config = {
        server: values.server,
        port: values.port ? Number(values.port) : undefined,
        database: values.database,
        user: values.user,
        password: values.password,
        trustServerCertificate: true
      }
    } else {
      throw new Error('Connexion manquante : --connection <id|label> ou --server/--database/--user/--password.')
    }

    const result = await runHeadless(sidecar, sessionsDir, config, {
      proc: values.proc,
      sql: values.sql ?? (values.file ? readFileSync(values.file, 'utf8') : undefined),
      compatLevel: values.compat ? Number(values.compat) : undefined,
      paramValues: values.params
        ? (JSON.parse(readFileSync(values.params, 'utf8')) as Record<string, string | null>)
        : undefined,
      snapshots: values.snapshots
        ? values.snapshots.split(',').map((s) => s.trim()).filter(Boolean)
        : undefined,
      readOnly: values.readonly
    })

    const summaryJson = JSON.stringify(result.summary, null, 2)
    if (values.output) {
      writeFileSync(values.output, summaryJson, 'utf8')
      console.error(`[gtrace-run] résumé écrit : ${values.output}`)
    } else {
      console.log(summaryJson)
    }
    if (values['full-trace']) {
      writeFileSync(values['full-trace'], JSON.stringify(result.entry, null, 2), 'utf8')
      console.error(`[gtrace-run] trace complète : ${values['full-trace']}`)
    }
    console.error(
      `[gtrace-run] session ${result.sessionId} — ${result.status} — interrogeable via MCP (get_session_summary)`
    )
    return result.status === 'ok' ? 0 : 1
  } finally {
    sidecar.dispose()
    await closeAllPools().catch(() => undefined)
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error('[gtrace-run] ERREUR :', e instanceof Error ? e.message : e)
    process.exit(2)
  })
