//! Backup files in a folder the user chose (local disk / USB / synced folder).
//! Plain std::fs so the daily auto-backup keeps working after restarts without fs-plugin scopes.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

const PREFIX: &str = "ScholarDesk_";

fn safe_name(name: &str) -> Result<&str, String> {
    if name.starts_with(PREFIX) && name.ends_with(".json") && !name.contains(['/', '\\']) && !name.contains("..") {
        Ok(name)
    } else {
        Err("Invalid backup file name".into())
    }
}

fn folder(path: &str) -> Result<PathBuf, String> {
    let p = Path::new(path);
    if !p.is_dir() {
        return Err(format!("Backup folder not found: {path}. Plug in the drive or choose the folder again."));
    }
    Ok(p.to_path_buf())
}

#[derive(Serialize)]
pub struct BackupFile {
    name: String,
    size: u64,
    modified: u64,
}

pub fn write(dir: &str, name: &str, content: &str) -> Result<String, String> {
    let target = folder(dir)?.join(safe_name(name)?);
    let tmp = target.with_extension("json.part");
    fs::write(&tmp, content).map_err(|e| format!("Could not write backup: {e}"))?;
    fs::rename(&tmp, &target).map_err(|e| format!("Could not save backup: {e}"))?;
    Ok(target.to_string_lossy().into_owned())
}

pub fn list(dir: &str) -> Result<Vec<BackupFile>, String> {
    let mut out = Vec::new();
    for entry in fs::read_dir(folder(dir)?).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !(name.starts_with(PREFIX) && name.ends_with(".json")) {
            continue;
        }
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        out.push(BackupFile { name, size: meta.len(), modified });
    }
    out.sort_by(|a, b| b.name.cmp(&a.name));
    Ok(out)
}

pub fn read(dir: &str, name: &str) -> Result<String, String> {
    fs::read_to_string(folder(dir)?.join(safe_name(name)?)).map_err(|e| format!("Could not read backup: {e}"))
}

/// Keeps the newest `keep` automatic daily backups (ScholarDesk_*_YYYY-MM-DD.json); manual ones are never removed.
pub fn prune(dir: &str, keep: usize) -> Result<usize, String> {
    let daily: Vec<BackupFile> = list(dir)?
        .into_iter()
        .filter(|f| f.name.len() > 15 && f.name.as_bytes()[f.name.len() - 8] == b'-' && !f.name.contains("_manual"))
        .collect();
    let mut removed = 0;
    for f in daily.iter().skip(keep) {
        if fs::remove_file(folder(dir)?.join(&f.name)).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

/// Saves a photo (data URL from the app) as a JPEG/PNG file, e.g. "260512_Sadia_Rahman.jpg".
pub fn write_photo(dir: &str, name: &str, data_url: &str) -> Result<String, String> {
    use base64::Engine;
    let ok_name = !name.is_empty()
        && name.len() <= 120
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
        && !name.contains("..")
        && (name.ends_with(".jpg") || name.ends_with(".png"));
    if !ok_name {
        return Err("Invalid photo file name".into());
    }
    let b64 = data_url.split_once(";base64,").map(|x| x.1).ok_or("Photo is not a data URL")?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(b64).map_err(|e| e.to_string())?;
    let target = folder(dir)?.join(name);
    fs::write(&target, bytes).map_err(|e| format!("Could not save photo: {e}"))?;
    Ok(target.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn write_list_read_prune() {
        let dir = std::env::temp_dir().join(format!("sdtest-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let d = dir.to_str().unwrap();
        for day in 1..=35 {
            write(d, &format!("ScholarDesk_Test_2026-01-{:02}.json", day.min(31)), "{}").unwrap();
            if day <= 31 { continue; }
            write(d, &format!("ScholarDesk_Test_2026-02-{:02}.json", day - 31), "{}").unwrap();
        }
        write(d, "ScholarDesk_Test_2026-02-04_manual_10-30.json", "{\"m\":1}").unwrap();
        assert!(write(d, "../evil.json", "x").is_err());
        assert!(write(d, "notes.txt", "x").is_err());
        assert_eq!(read(d, "ScholarDesk_Test_2026-02-04_manual_10-30.json").unwrap(), "{\"m\":1}");
        let before = list(d).unwrap().len();
        let removed = prune(d, 30).unwrap();
        let after = list(d).unwrap();
        assert_eq!(before - removed, after.len());
        assert_eq!(after.iter().filter(|f| !f.name.contains("_manual")).count(), 30);
        assert!(after.iter().any(|f| f.name.contains("_manual")), "manual backups are never pruned");
        assert_eq!(after[0].name, "ScholarDesk_Test_2026-02-04_manual_10-30.json");
        std::fs::remove_dir_all(&dir).unwrap();
        assert!(write(d, "ScholarDesk_x_2026-01-01.json", "{}").is_err(), "missing folder is an error");
    }
}
