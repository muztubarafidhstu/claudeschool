mod backupfs;
mod db;
mod emergency;
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
fn emergency_available() -> bool {
    emergency::enabled()
}

#[tauri::command]
fn verify_emergency_code(lock_id: String, code: String) -> bool {
    emergency::verify(&license::machine_id(), &lock_id, &code)
}

#[tauri::command]
fn backup_write(dir: String, name: String, content: String) -> CmdResult<String> {
    backupfs::write(&dir, &name, &content)
}

#[tauri::command]
fn backup_list(dir: String) -> CmdResult<Vec<backupfs::BackupFile>> {
    backupfs::list(&dir)
}

#[tauri::command]
fn backup_read(dir: String, name: String) -> CmdResult<String> {
    backupfs::read(&dir, &name)
}

/// Folder for automatic safety backups (e.g. before a remote reset): <AppData>/safety-backups
#[tauri::command]
fn safety_backup_dir(app: tauri::AppHandle) -> CmdResult<String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("safety-backups");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
fn photo_write(dir: String, name: String, data_url: String) -> CmdResult<String> {
    backupfs::write_photo(&dir, &name, &data_url)
}

#[tauri::command]
fn backup_prune(dir: String, keep: usize) -> CmdResult<usize> {
    backupfs::prune(&dir, keep)
}

/// Generic HTTP call for SMS gateways (paid SMS APIs or the owner's ESP32 GSM gateway on the LAN).
/// Done in Rust so any gateway URL works without widening the webview's HTTP allow-list.
#[tauri::command]
async fn http_request(method: String, url: String, content_type: Option<String>, body: Option<String>) -> CmdResult<(u16, String)> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("Gateway URL must start with http:// or https://".into());
    }
    let client = tauri_plugin_http::reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(25))
        .build()
        .map_err(|e| e.to_string())?;
    let mut req = if method.eq_ignore_ascii_case("POST") { client.post(&url) } else { client.get(&url) };
    if let Some(ct) = content_type.filter(|c| !c.is_empty()) {
        req = req.header("content-type", ct);
    }
    if let Some(b) = body.filter(|b| !b.is_empty()) {
        req = req.body(b);
    }
    let res = req.send().await.map_err(|e| format!("Could not reach the SMS gateway: {e}"))?;
    let status = res.status().as_u16();
    let text = res.text().await.unwrap_or_default();
    Ok((status, text.chars().take(2000).collect()))
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
            emergency_available,
            verify_emergency_code,
            backup_write,
            backup_list,
            backup_read,
            backup_prune,
            photo_write,
            safety_backup_dir,
            http_request,
            start_oauth_listener
        ])
        .run(tauri::generate_context!())
        .expect("error while running ScholarDesk Pro");
}
