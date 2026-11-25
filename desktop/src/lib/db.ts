/**
 * Database adapter.
 *  - Desktop: Rust/rusqlite commands (db_select / db_execute / db_batch) on a WAL SQLite file in AppData.
 *  - Browser demo: sql.js (WASM SQLite) persisted to IndexedDB, running the very same migration file.
 * All SQL uses `?` positional parameters.
 */
import { isTauri, invoke } from './platform';
import migration001 from '../../src-tauri/migrations/001_init.sql?raw';

export type Param = string | number | null | boolean;
export type Row = Record<string, any>;
export interface Stmt { sql: string; params?: Param[] }

interface Driver {
  select<T = Row>(sql: string, params?: Param[]): Promise<T[]>;
  execute(sql: string, params?: Param[]): Promise<{ rows_affected: number; last_insert_id: number }>;
  batch(stmts: Stmt[]): Promise<number>;
}

const tauriDriver: Driver = {
  select: (sql, params = []) => invoke('db_select', { sql, params }),
  execute: (sql, params = []) => invoke('db_execute', { sql, params }),
  batch: (statements) => invoke('db_batch', { statements: statements.map((s) => ({ sql: s.sql, params: s.params ?? [] })) }),
};

// ---------------- Browser (sql.js) ----------------
const IDB_NAME = 'scholardesk', IDB_STORE = 'db', IDB_KEY = 'main';
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(IDB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(IDB_STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet(): Promise<Uint8Array | undefined> {
  const d = await idb();
  return new Promise((res) => { const g = d.transaction(IDB_STORE).objectStore(IDB_STORE).get(IDB_KEY); g.onsuccess = () => res(g.result); g.onerror = () => res(undefined); });
}
async function idbPut(data: Uint8Array) {
  const d = await idb();
  d.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).put(data, IDB_KEY);
}

async function makeBrowserDriver(): Promise<Driver> {
  const initSqlJs = (await import('sql.js')).default;
  const wasmUrl = (await import('sql.js/dist/sql-wasm.wasm?url')).default;
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const saved = await idbGet();
  const db = saved ? new SQL.Database(saved) : new SQL.Database();
  db.exec('PRAGMA foreign_keys = ON;');
  const v = (db.exec('PRAGMA user_version')[0]?.values[0]?.[0] as number) ?? 0;
  if (v < 1) db.exec(`BEGIN; ${migration001}; PRAGMA user_version = 1; COMMIT;`);
  let timer: number | undefined;
  const persist = () => { clearTimeout(timer); timer = window.setTimeout(() => idbPut(db.export()), 400); };
  const norm = (p: Param[]) => p.map((x) => (typeof x === 'boolean' ? (x ? 1 : 0) : x));
  return {
    async select<T>(sql: string, params: Param[] = []) {
      const st = db.prepare(sql);
      st.bind(norm(params) as any);
      const out: T[] = [];
      while (st.step()) out.push(st.getAsObject() as T);
      st.free();
      return out;
    },
    async execute(sql, params = []) {
      db.run(sql, norm(params) as any);
      const id = db.exec('SELECT last_insert_rowid()')[0].values[0][0] as number;
      const n = db.getRowsModified();
      persist();
      return { rows_affected: n, last_insert_id: id };
    },
    async batch(stmts) {
      let n = 0;
      db.exec('BEGIN');
      try {
        for (const s of stmts) { db.run(s.sql, norm(s.params ?? []) as any); n += db.getRowsModified(); }
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      persist();
      return n;
    },
  };
}

let driverP: Promise<Driver> | null = null;
const driver = () => (driverP ??= isTauri ? Promise.resolve(tauriDriver) : makeBrowserDriver());

export const db = {
  select: async <T = Row>(sql: string, params: Param[] = []) => (await driver()).select<T>(sql, params),
  one: async <T = Row>(sql: string, params: Param[] = []) => ((await (await driver()).select<T>(sql, params))[0] ?? null) as T | null,
  execute: async (sql: string, params: Param[] = []) => (await driver()).execute(sql, params),
  /** Runs all statements inside ONE transaction (all-or-nothing). */
  batch: async (stmts: Stmt[]) => (stmts.length ? (await driver()).batch(stmts) : 0),
};

export const TABLES = ['students', 'fee_ledger', 'attendance_logs', 'exam_results', 'staff', 'salary_ledger'] as const;
