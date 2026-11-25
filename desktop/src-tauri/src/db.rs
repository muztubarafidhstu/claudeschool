//! Local SQLite layer (rusqlite, bundled SQLite, WAL).
//!
//! A single serialized connection guarded by a mutex gives us real multi-statement
//! transactions (`db_batch`) for promotion, attendance submission, demo import and restore,
//! which a pooled connection cannot guarantee.

use rusqlite::{params_from_iter, types::Value as SqlValue, Connection};
use serde::Deserialize;
use serde_json::{Map, Number, Value};
use std::sync::Mutex;

pub struct Db(pub Mutex<Connection>);

const MIGRATIONS: &[(i64, &str)] = &[(1, include_str!("../migrations/001_init.sql"))];

pub fn open(path: &std::path::Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;",
    )?;
    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    for (version, sql) in MIGRATIONS {
        if *version > current {
            conn.execute_batch(&format!("BEGIN; {sql}; PRAGMA user_version = {version}; COMMIT;"))?;
        }
    }
    Ok(())
}

fn to_sql(v: &Value) -> SqlValue {
    match v {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(*b as i64),
        Value::Number(n) => n.as_i64().map(SqlValue::Integer).unwrap_or_else(|| SqlValue::Real(n.as_f64().unwrap_or(0.0))),
        Value::String(s) => SqlValue::Text(s.clone()),
        other => SqlValue::Text(other.to_string()),
    }
}

fn from_sql(v: rusqlite::types::ValueRef) -> Value {
    use rusqlite::types::ValueRef::*;
    match v {
        Null => Value::Null,
        Integer(i) => Value::Number(i.into()),
        Real(f) => Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null),
        Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        Blob(_) => Value::Null,
    }
}

pub fn select(conn: &Connection, sql: &str, params: &[Value]) -> rusqlite::Result<Vec<Map<String, Value>>> {
    let mut stmt = conn.prepare_cached(sql)?;
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let mut rows = stmt.query(params_from_iter(params.iter().map(to_sql)))?;
    let mut out = Vec::new();
    while let Some(row) = rows.next()? {
        let mut m = Map::with_capacity(names.len());
        for (i, n) in names.iter().enumerate() {
            m.insert(n.clone(), from_sql(row.get_ref(i)?));
        }
        out.push(m);
    }
    Ok(out)
}

#[derive(serde::Serialize)]
pub struct ExecResult {
    pub rows_affected: usize,
    pub last_insert_id: i64,
}

pub fn execute(conn: &Connection, sql: &str, params: &[Value]) -> rusqlite::Result<ExecResult> {
    let n = conn.prepare_cached(sql)?.execute(params_from_iter(params.iter().map(to_sql)))?;
    Ok(ExecResult { rows_affected: n, last_insert_id: conn.last_insert_rowid() })
}

#[derive(Deserialize)]
pub struct Stmt {
    pub sql: String,
    #[serde(default)]
    pub params: Vec<Value>,
}

pub fn batch(conn: &mut Connection, stmts: &[Stmt]) -> rusqlite::Result<usize> {
    let tx = conn.transaction()?;
    let mut total = 0;
    for s in stmts {
        total += tx.prepare_cached(&s.sql)?.execute(params_from_iter(s.params.iter().map(to_sql)))?;
    }
    tx.commit()?;
    Ok(total)
}
