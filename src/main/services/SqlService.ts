import sql from 'mssql'
import type {
  ColumnInfo,
  ConnectionConfig,
  DatabaseInfo,
  DbObjectInfo,
  DbObjects,
  ProcSource,
  ProcSummary,
  ResultSetData,
  TestResult
} from '@shared/types'

export function buildSqlConfig(cfg: ConnectionConfig): sql.config {
  return {
    server: cfg.server,
    port: cfg.port ?? 1433,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    options: {
      encrypt: cfg.encrypt ?? true,
      trustServerCertificate: cfg.trustServerCertificate ?? true
    },
    pool: { max: 4, min: 0, idleTimeoutMillis: 30_000 },
    connectionTimeout: 15_000,
    requestTimeout: 5 * 60_000
  }
}

// ─── Pools partagés (un par connexion effective) ─────────────────────────────

const pools = new Map<string, sql.ConnectionPool>()
/** Connexions en cours d'établissement, mémoïsées pour éviter les pools orphelins. */
const connecting = new Map<string, Promise<sql.ConnectionPool>>()

function poolKey(cfg: ConnectionConfig): string {
  return JSON.stringify([cfg.server, cfg.port ?? 1433, cfg.database, cfg.user, cfg.password])
}

export function getPool(cfg: ConnectionConfig): Promise<sql.ConnectionPool> {
  const key = poolKey(cfg)
  const existing = pools.get(key)
  if (existing?.connected) return Promise.resolve(existing)
  if (existing) pools.delete(key)

  // Mémoïsation de la promesse : deux appels concurrents pour la même config
  // attendent la MÊME connexion (sinon la 2e écrasait la 1re → pool orphelin
  // jamais fermé par closeAllPools).
  const inFlight = connecting.get(key)
  if (inFlight) return inFlight

  const promise = new sql.ConnectionPool(buildSqlConfig(cfg))
    .connect()
    .then((pool) => {
      pool.on('error', () => pools.delete(key))
      pools.set(key, pool)
      connecting.delete(key)
      return pool
    })
    .catch((e) => {
      connecting.delete(key)
      throw e
    })
  connecting.set(key, promise)
  return promise
}

export async function closeAllPools(): Promise<void> {
  const open = [...pools.values()]
  pools.clear()
  connecting.clear()
  await Promise.allSettled(open.map((p) => p.close()))
}

// ─── Opérations ───────────────────────────────────────────────────────────────

export async function testConnection(cfg: ConnectionConfig): Promise<TestResult> {
  try {
    const pool = await getPool(cfg)
    const result = await pool.request().query<{ v: string }>('SELECT @@VERSION AS v')
    return { ok: true, serverVersion: result.recordset[0]?.v }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Toutes les bases du serveur (arbre de l'explorateur, comme SSMS). */
export async function listDatabases(cfg: ConnectionConfig): Promise<DatabaseInfo[]> {
  const pool = await getPool(cfg)
  const result = await pool.request().query<{
    name: string
    state_desc: string
    database_id: number
  }>(
    `SELECT name, state_desc, database_id FROM sys.databases ORDER BY
       CASE WHEN database_id <= 4 THEN 1 ELSE 0 END, name`
  )
  return result.recordset.map((r) => ({
    name: r.name,
    online: r.state_desc === 'ONLINE',
    system: r.database_id <= 4
  }))
}

/** Tables, vues, procédures et fonctions d'une base (explorateur d'objets). */
export async function listObjects(cfg: ConnectionConfig): Promise<DbObjects> {
  const pool = await getPool(cfg)
  const result = await pool.request().query<{
    objectId: number
    schemaName: string
    name: string
    type: string
    modifiedAt: Date
  }>(
    `SELECT o.object_id AS objectId, s.name AS schemaName, o.name, RTRIM(o.type) AS type,
            o.modify_date AS modifiedAt
     FROM sys.objects o
     JOIN sys.schemas s ON s.schema_id = o.schema_id
     WHERE o.is_ms_shipped = 0 AND o.type IN ('U', 'V', 'P', 'FN', 'IF', 'TF')
     ORDER BY s.name, o.name`
  )
  const objects: DbObjects = { tables: [], views: [], procedures: [], functions: [] }
  for (const r of result.recordset) {
    const info: DbObjectInfo = {
      objectId: r.objectId,
      schema: r.schemaName,
      name: r.name,
      modifiedAt: r.modifiedAt.toISOString()
    }
    if (r.type === 'U') objects.tables.push(info)
    else if (r.type === 'V') objects.views.push(info)
    else if (r.type === 'P') objects.procedures.push(info)
    else objects.functions.push(info)
  }
  return objects
}

/** Colonnes d'une table/vue (nœud enfant de l'explorateur + script SELECT TOP). */
export async function listColumns(cfg: ConnectionConfig, objectId: number): Promise<ColumnInfo[]> {
  const pool = await getPool(cfg)
  const result = await pool.request().input('id', sql.Int, objectId).query<{
    name: string
    typeName: string
    max_length: number
    precision: number
    scale: number
    is_nullable: boolean
    is_identity: boolean
    is_pk: number
  }>(
    `SELECT c.name, t.name AS typeName, c.max_length, c.precision, c.scale,
            c.is_nullable, c.is_identity,
            CASE WHEN EXISTS (
              SELECT 1 FROM sys.index_columns ic
              JOIN sys.indexes i ON i.object_id = ic.object_id AND i.index_id = ic.index_id
              WHERE i.is_primary_key = 1 AND ic.object_id = c.object_id AND ic.column_id = c.column_id
            ) THEN 1 ELSE 0 END AS is_pk
     FROM sys.columns c
     JOIN sys.types t ON t.user_type_id = c.user_type_id
     WHERE c.object_id = @id
     ORDER BY c.column_id`
  )
  return result.recordset.map((r) => ({
    name: r.name,
    dataType: formatDataType(r.typeName, r.max_length, r.precision, r.scale),
    isNullable: r.is_nullable,
    isIdentity: r.is_identity,
    isPrimaryKey: r.is_pk === 1
  }))
}

/** Noms de colonnes distincts des tables/vues utilisateur (pour l'auto-complétion). */
export async function listColumnNames(cfg: ConnectionConfig): Promise<string[]> {
  const pool = await getPool(cfg)
  const result = await pool.request().query<{ name: string }>(
    `SELECT DISTINCT c.name
     FROM sys.columns c
     JOIN sys.objects o ON o.object_id = c.object_id
     WHERE o.is_ms_shipped = 0 AND o.type IN ('U', 'V')
     ORDER BY c.name`
  )
  return result.recordset.map((r) => r.name)
}

function formatDataType(name: string, maxLength: number, precision: number, scale: number): string {
  const lower = name.toLowerCase()
  if (['varchar', 'char', 'varbinary', 'binary'].includes(lower)) {
    return `${lower}(${maxLength === -1 ? 'max' : maxLength})`
  }
  if (['nvarchar', 'nchar'].includes(lower)) {
    return `${lower}(${maxLength === -1 ? 'max' : maxLength / 2})`
  }
  if (['decimal', 'numeric'].includes(lower)) return `${lower}(${precision},${scale})`
  if (['datetime2', 'time', 'datetimeoffset'].includes(lower)) return `${lower}(${scale})`
  return lower
}

export async function listProcedures(cfg: ConnectionConfig): Promise<ProcSummary[]> {
  const pool = await getPool(cfg)
  const result = await pool.request().query<{
    objectId: number
    schemaName: string
    procName: string
    modifiedAt: Date
  }>(
    `SELECT p.object_id AS objectId, s.name AS schemaName, p.name AS procName, p.modify_date AS modifiedAt
     FROM sys.procedures p
     JOIN sys.schemas s ON s.schema_id = p.schema_id
     WHERE p.is_ms_shipped = 0
     ORDER BY s.name, p.name`
  )
  return result.recordset.map((r) => ({
    objectId: r.objectId,
    schema: r.schemaName,
    name: r.procName,
    modifiedAt: r.modifiedAt.toISOString()
  }))
}

/** Variante par nom qualifié (mode headless : `gtrace run --proc dbo.X`). */
export async function loadProcedureByName(
  cfg: ConnectionConfig,
  name: string
): Promise<ProcSource> {
  const pool = await getPool(cfg)
  const result = await pool
    .request()
    .input('n', sql.NVarChar(400), name)
    .query<{ id: number | null }>('SELECT OBJECT_ID(@n) AS id')
  const objectId = result.recordset[0]?.id
  if (objectId === null || objectId === undefined) {
    throw new Error(`Procédure introuvable : ${name}`)
  }
  return loadProcedure(cfg, objectId)
}

export async function loadProcedure(cfg: ConnectionConfig, objectId: number): Promise<ProcSource> {
  const pool = await getPool(cfg)
  const result = await pool
    .request()
    .input('id', sql.Int, objectId)
    .query<{ definition: string | null; schemaName: string; procName: string }>(
      `SELECT sm.definition,
              OBJECT_SCHEMA_NAME(sm.object_id) AS schemaName,
              OBJECT_NAME(sm.object_id) AS procName
       FROM sys.sql_modules sm
       WHERE sm.object_id = @id`
    )
  const row = result.recordset[0]
  if (!row) throw new Error(`Procédure introuvable (object_id ${objectId})`)
  if (row.definition === null) {
    throw new Error(`Définition indisponible pour ${row.schemaName}.${row.procName} (chiffrée ?)`)
  }
  return {
    objectId,
    schema: row.schemaName,
    name: row.procName,
    definition: row.definition
  }
}

const INSPECT_MAX_ROWS = 500

/**
 * Requête ad hoc d'inspection (Phase 2/4) — connexion séparée du debug.
 * Attention : peut être bloquée par les locks de la session déboguée ;
 * l'option READ UNCOMMITTED contourne au prix de lectures sales (assumé, spec §11).
 */
export async function inspectQuery(
  cfg: ConnectionConfig,
  sqlText: string,
  readUncommitted: boolean
): Promise<ResultSetData[]> {
  const pool = await getPool(cfg)
  // Niveau d'isolation posé EXPLICITEMENT dans les deux cas : le pool est partagé
  // (getPool met en cache par config) et mssql/tedious ne réinitialisent pas la
  // connexion au checkout — sans ce SET explicite, un READ UNCOMMITTED laissé par
  // un appel précédent fuiterait vers les lectures « propres » suivantes.
  const isolation = readUncommitted ? 'READ UNCOMMITTED' : 'READ COMMITTED'
  const batch = `SET TRANSACTION ISOLATION LEVEL ${isolation};\n${sqlText}`
  const result = await pool.request().batch(batch)
  const recordsets = (result.recordsets as sql.IRecordSet<Record<string, unknown>>[]) ?? []
  return recordsets.map((rs, index) => {
    const columns = Object.keys(rs.columns ?? {})
    return {
      index,
      columns,
      rows: rs.slice(0, INSPECT_MAX_ROWS).map((row) => columns.map((c) => row[c])),
      stepIndex: null
    }
  })
}

/** Mappe un type T-SQL déclaré (ex. "decimal(18,2)") vers un type mssql + coercition de la valeur saisie. */
export function coerceParam(
  typeText: string,
  raw: string | null
): { type: sql.ISqlType | (() => sql.ISqlType); value: unknown } {
  const match = typeText.trim().toLowerCase().match(/^(\w+)\s*(?:\(\s*([^)]+)\s*\))?/)
  const name = match?.[1] ?? 'nvarchar'
  const args = (match?.[2] ?? '')
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean)
  const num = (i: number, fallback: number): number =>
    args[i] === 'max' ? sql.MAX : Number.isFinite(Number(args[i])) ? Number(args[i]) : fallback

  const empty = raw === null || raw === ''
  switch (name) {
    case 'int':
      return { type: sql.Int, value: empty ? null : Number(raw) }
    case 'bigint':
      return { type: sql.BigInt, value: empty ? null : raw }
    case 'smallint':
      return { type: sql.SmallInt, value: empty ? null : Number(raw) }
    case 'tinyint':
      return { type: sql.TinyInt, value: empty ? null : Number(raw) }
    case 'bit':
      return { type: sql.Bit, value: empty ? null : raw === '1' || raw!.toLowerCase() === 'true' }
    case 'decimal':
    case 'numeric':
      return { type: sql.Decimal(num(0, 18), num(1, 0)), value: empty ? null : Number(raw) }
    case 'money':
      return { type: sql.Money, value: empty ? null : Number(raw) }
    case 'smallmoney':
      return { type: sql.SmallMoney, value: empty ? null : Number(raw) }
    case 'float':
      return { type: sql.Float, value: empty ? null : Number(raw) }
    case 'real':
      return { type: sql.Real, value: empty ? null : Number(raw) }
    case 'date':
    case 'datetime':
    case 'datetime2':
    case 'smalldatetime':
    case 'datetimeoffset':
      return { type: sql.DateTime2, value: empty ? null : new Date(raw!) }
    case 'time':
      return { type: sql.NVarChar(20), value: empty ? null : raw }
    case 'uniqueidentifier':
      return { type: sql.UniqueIdentifier, value: empty ? null : raw }
    case 'char':
      return { type: sql.Char(num(0, 1)), value: empty ? null : raw }
    case 'nchar':
      return { type: sql.NChar(num(0, 1)), value: empty ? null : raw }
    case 'varchar':
      return { type: sql.VarChar(num(0, 4000)), value: empty ? null : raw }
    case 'nvarchar':
      return { type: sql.NVarChar(num(0, 4000)), value: empty ? null : raw }
    default:
      return { type: sql.NVarChar(4000), value: empty ? null : raw }
  }
}

/** Convertit un littéral SQL de valeur par défaut ("N'abc'", "0.05", "NULL") en texte brut. */
export function defaultLiteralToRaw(literal: string | null): string | null {
  if (literal === null) return null
  const trimmed = literal.trim()
  if (/^null$/i.test(trimmed)) return null
  const str = trimmed.match(/^N?'([\s\S]*)'$/)
  if (str) return str[1].replace(/''/g, "'")
  return trimmed
}
