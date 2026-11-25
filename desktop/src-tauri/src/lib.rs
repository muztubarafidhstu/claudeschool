mod db;
mod license;
mod oauth;

use db::{Db, ExecResult, Stmt};
use serde_json::{Map, Value};
use tauri::{Manager, State};

type CmdResult<T> = Result<T, String>;

#[tauri::command]
async fn db_select(db: State<'_, Db>, sql: String, params: Vec<Value>) -> CmdResult<Vec<Map<String, Value>>> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    db::select(&conn, &sql, &params).map_err(|e| e.to_string())
}

#[tauri::command]
async fn db_execute(db: State<'_, Db>, sql: String, params: Vec<Value>) -> CmdResult<ExecResult> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    db::execute(&conn, &sql, &params).map_err(|e| e.to_string())
}

#[tauri::command]
async fn db_batch(db: State<'_, Db>, statements: Vec<Stmt>) -> CmdResult<usize> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    db::batch(&mut conn, &statements).map_err(|e| e.to_string())
}

#[tauri::command]
fn machine_id() -> String {
    license::machine_id()
}

#[tauri::command]
fn verify_grace_token(token: String) -> CmdResult<license::GraceClaims> {
    license::verify(&token)
}

#[tauri::command]
fn start_oauth_listener(app: tauri::AppHandle) -> CmdResult<u16> {
    oauth::start(app)
}

pub fn run() {
    tauri::Builder::default()
        // Grant the webcam to our own app window (student/staff photo capture) instead of
        // relying on the WebView2/WKWebView prompt, which can be hidden or remembered as "Block".
        .on_permission_request(|_, kind| match kind {
            tauri::webview::PermissionKind::Camera => tauri::webview::PermissionResponse::Allow,
            _ => tauri::webview::PermissionResponse::Default,
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let conn = db::open(&dir.join("scholardesk.db")).map_err(|e| format!("Database error: {e}"))?;
            app.manage(Db(std::sync::Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db_select,
            db_execute,
            db_batch,
            machine_id,
            verify_grace_token,
            start_oauth_listener
        ])
        .run(tauri::generate_context!())
        .expect("error while running ScholarDesk Pro");
}
