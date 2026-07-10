import sql from 'mssql'
import type { ConnectionConfig, ControlStatus } from '@shared/types'
import { getPool } from './SqlService'

export const CONTROL_TABLE = 'GTraceDB.dbo.ControlSignal'

/**
 * Base de contrôle des breakpoints simulés (spec §9.3) : GTraceDB n'est créée
 * qu'après confirmation explicite de l'utilisateur, jamais dans la base cible.
 */
export async function controlStatus(cfg: ConnectionConfig): Promise<ControlStatus> {
  const pool = await getPool(cfg)
  const result = await pool.request().query<{ db: number | null; tbl: number | null }>(
    `SELECT DB_ID('GTraceDB') AS db, OBJECT_ID('${CONTROL_TABLE}') AS tbl`
  )
  const row = result.recordset[0]
  return { databaseExists: row.db !== null, tableExists: row.tbl !== null }
}

export async function createControl(cfg: ConnectionConfig): Promise<void> {
  const pool = await getPool(cfg)
  await pool.request().batch(`IF DB_ID('GTraceDB') IS NULL CREATE DATABASE GTraceDB;`)
  await pool.request().batch(
    `IF OBJECT_ID('${CONTROL_TABLE}') IS NULL
     CREATE TABLE ${CONTROL_TABLE} (
       SessionId       uniqueidentifier NOT NULL PRIMARY KEY,
       GoUntilSeq      int              NOT NULL,
       RunToBreakpoint bit              NOT NULL
     );`
  )
}

export async function initSignal(
  cfg: ConnectionConfig,
  sessionId: string,
  runToBreakpoint: boolean
): Promise<void> {
  const pool = await getPool(cfg)
  await pool
    .request()
    .input('sid', sql.UniqueIdentifier, sessionId)
    .input('rtb', sql.Bit, runToBreakpoint)
    .query(
      `DELETE FROM ${CONTROL_TABLE} WHERE SessionId = @sid;
       INSERT INTO ${CONTROL_TABLE} (SessionId, GoUntilSeq, RunToBreakpoint) VALUES (@sid, 0, @rtb);`
    )
}

export async function updateSignal(
  cfg: ConnectionConfig,
  sessionId: string,
  goUntilSeq: number,
  runToBreakpoint: boolean
): Promise<void> {
  const pool = await getPool(cfg)
  await pool
    .request()
    .input('sid', sql.UniqueIdentifier, sessionId)
    .input('seq', sql.Int, goUntilSeq)
    .input('rtb', sql.Bit, runToBreakpoint)
    .query(
      `UPDATE ${CONTROL_TABLE} SET GoUntilSeq = @seq, RunToBreakpoint = @rtb WHERE SessionId = @sid`
    )
}

export async function clearSignal(cfg: ConnectionConfig, sessionId: string): Promise<void> {
  const pool = await getPool(cfg)
  await pool
    .request()
    .input('sid', sql.UniqueIdentifier, sessionId)
    .query(`DELETE FROM ${CONTROL_TABLE} WHERE SessionId = @sid`)
}

const ISOLATION_LEVELS: Record<number, string> = {
  0: 'Unspecified',
  1: 'READ UNCOMMITTED',
  2: 'READ COMMITTED',
  3: 'REPEATABLE READ',
  4: 'SERIALIZABLE',
  5: 'SNAPSHOT'
}

/** État transactionnel d'une session (via DMV, connexion séparée — ne bloque pas). */
export async function sessionTransactionState(
  cfg: ConnectionConfig,
  spid: number
): Promise<{ isolationLevel: string | null; lockCount: number | null }> {
  try {
    const pool = await getPool(cfg)
    const result = await pool.request().input('spid', sql.Int, spid).query<{
      iso: number
      locks: number
    }>(
      `SELECT s.transaction_isolation_level AS iso,
              (SELECT COUNT(*) FROM sys.dm_tran_locks l WHERE l.request_session_id = s.session_id) AS locks
       FROM sys.dm_exec_sessions s
       WHERE s.session_id = @spid`
    )
    const row = result.recordset[0]
    if (!row) return { isolationLevel: null, lockCount: null }
    return { isolationLevel: ISOLATION_LEVELS[row.iso] ?? String(row.iso), lockCount: row.locks }
  } catch {
    return { isolationLevel: null, lockCount: null }
  }
}
