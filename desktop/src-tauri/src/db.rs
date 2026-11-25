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

const MIGRATIONS: &[(i64, &str)] = &[
    (1, include_str!("../migrations/001_init.sql")),
    (2, include_str!("../migrations/002_coaching.sql")),
];

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
    if MIGRATIONS.iter().all(|(v, _)| *v <= current) {
        return Ok(());
    }
    // Table rebuilds must not cascade-delete related rows: switch FK enforcement off (only possible
    // outside a transaction), migrate, verify integrity, switch it back on.
    conn.execute_batch("PRAGMA foreign_keys = OFF;")?;
    let result = (|| {
        for (version, sql) in MIGRATIONS {
            if *version > current {
                if let Err(e) = conn.execute_batch(&format!("BEGIN; {sql}; PRAGMA user_version = {version}; COMMIT;")) {
                    let _ = conn.execute_batch("ROLLBACK;");
                    return Err(e);
                }
            }
        }
        let broken: i64 = conn.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| r.get(0))?;
        if broken > 0 {
            eprintln!("warning: {broken} foreign key problems after migration");
        }
        Ok(())
    })();
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    result
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

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn v1_data_survives_v2_migration() {
        let dir = std::env::temp_dir().join(format!("sdmig-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("t.db");
        {
            // build a v1 database with related rows
            let c = Connection::open(&path).unwrap();
            c.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
            c.execute_batch(&format!("BEGIN; {}; PRAGMA user_version = 1; COMMIT;", MIGRATIONS[0].1)).unwrap();
            c.execute_batch("INSERT INTO students(id, student_id, admission_year, admission_date, class_no, roll, name_en) VALUES (1,'260501',2026,'2026-01-05',5,1,'Ayesha');
                INSERT INTO fee_ledger(student_id, receipt_no, fee_type, period, regular_amount, paid_amount, paid_on) VALUES (1,'R1','MONTHLY','2026-01',800,800,'2026-01-10');
                INSERT INTO attendance_logs(student_id, date, class_no, section, status) VALUES (1,'2026-01-11',5,'A','P');
                INSERT INTO staff(staff_code, name_en, designation, mobile, monthly_salary) VALUES ('ST-001','T','Teacher','01700000000',15000);").unwrap();
        }
        let c = open(&path).unwrap();
        let v: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, 2);
        let n: i64 = c.query_row("SELECT COUNT(*) FROM fee_ledger", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1, "fee rows must survive the students rebuild");
        let a: i64 = c.query_row("SELECT COUNT(*) FROM attendance_logs", [], |r| r.get(0)).unwrap();
        assert_eq!(a, 1);
        c.execute_batch("INSERT INTO students(student_id, admission_year, admission_date, class_no, roll, name_en) VALUES ('261101',2026,'2026-01-05',11,1,'Batch eleven')").unwrap();
        let pt: String = c.query_row("SELECT pay_type FROM staff", [], |r| r.get(0)).unwrap();
        assert_eq!(pt, "MONTHLY");
        let fk: i64 = c.query_row("PRAGMA foreign_keys", [], |r| r.get(0)).unwrap();
        assert_eq!(fk, 1);
        // cascade still works after the rebuild
        c.execute_batch("DELETE FROM students WHERE id = 1").unwrap();
        let n: i64 = c.query_row("SELECT COUNT(*) FROM fee_ledger", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
