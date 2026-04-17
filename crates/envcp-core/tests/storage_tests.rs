use envcp_core::storage::{StorageManager, Variable};
use std::path::Path;
use tempfile::TempDir;

fn tmp() -> TempDir {
    tempfile::tempdir().unwrap()
}

fn var(name: &str, value: &str) -> Variable {
    let now = chrono::Utc::now().to_rfc3339();
    Variable {
        name: name.to_string(),
        value: value.to_string(),
        encrypted: true,
        tags: None,
        description: None,
        created: now.clone(),
        updated: now,
        accessed: None,
        sync_to_env: true,
        protected: None,
        password_hash: None,
        protected_value: None,
    }
}

// --- basic CRUD (encrypted) ---

#[test]
fn set_and_get_encrypted() {
    let dir = tmp();
    let path = dir.path().join("store.enc");
    let mut sm = StorageManager::new(&path, true);
    sm.set_password("test123");
    sm.set("API_KEY", var("API_KEY", "secret-value")).unwrap();
    let result = sm.get("API_KEY").unwrap().unwrap();
    assert_eq!(result.value, "secret-value");
}

#[test]
fn list_returns_all_names() {
    let dir = tmp();
    let path = dir.path().join("store.enc");
    let mut sm = StorageManager::new(&path, true);
    sm.set_password("test123");
    sm.set("A", var("A", "1")).unwrap();
    sm.set("B", var("B", "2")).unwrap();
    let mut names = sm.list().unwrap();
    names.sort();
    assert_eq!(names, vec!["A", "B"]);
}

#[test]
fn delete_removes_variable() {
    let dir = tmp();
    let path = dir.path().join("store.enc");
    let mut sm = StorageManager::new(&path, true);
    sm.set_password("test123");
    sm.set("X", var("X", "v")).unwrap();
    assert!(sm.delete("X").unwrap());
    assert!(sm.get("X").unwrap().is_none());
    assert!(!sm.delete("X").unwrap());
}

#[test]
fn load_nonexistent_returns_empty() {
    let dir = tmp();
    let path = dir.path().join("store.enc");
    let mut sm = StorageManager::new(&path, true);
    sm.set_password("test123");
    assert!(sm.load().unwrap().is_empty());
}

// --- wrong password ---

#[test]
fn wrong_password_fails() {
    let dir = tmp();
    let path = dir.path().join("store.enc");
    let mut sm = StorageManager::new(&path, true);
    sm.set_password("correct");
    sm.set("KEY", var("KEY", "v")).unwrap();

    let mut sm2 = StorageManager::new(&path, true);
    sm2.set_password("wrong");
    assert!(sm2.load().is_err());
}

// --- cache behaviour ---

#[test]
fn set_password_clears_cache_on_change() {
    let dir = tmp();
    let path = dir.path().join("store.enc");
    let mut sm = StorageManager::new(&path, true);
    sm.set_password("pass1");
    sm.set("A", var("A", "1")).unwrap();
    sm.set_password("pass2");
    // After password change the load will fail (wrong pw for existing file),
    // confirming cache was cleared and it tried to re-read.
    assert!(sm.load().is_err());
}

#[test]
fn invalidate_cache_forces_reload() {
    let dir = tmp();
    let path = dir.path().join("store.enc");
    let mut sm = StorageManager::new(&path, false);
    sm.set("A", var("A", "1")).unwrap();
    let _ = sm.load().unwrap(); // populate cache
    sm.invalidate_cache();
    let vars = sm.load().unwrap();
    assert!(vars.contains_key("A"));
}

// --- exists ---

#[test]
fn exists_true_after_save() {
    let dir = tmp();
    let path = dir.path().join("store.enc");
    let mut sm = StorageManager::new(&path, false);
    assert!(!sm.exists());
    sm.set("A", var("A", "1")).unwrap();
    assert!(sm.exists());
}

// --- backup rotation ---

#[test]
fn backup_files_created_on_subsequent_saves() {
    let dir = tmp();
    let path = dir.path().join("store.enc");
    let mut sm = StorageManager::new(&path, false);
    sm.set("A", var("A", "1")).unwrap();
    sm.set("B", var("B", "2")).unwrap();
    sm.set("C", var("C", "3")).unwrap();
    assert!(Path::new(&format!("{}.bak.1", path.display())).exists());
    assert!(Path::new(&format!("{}.bak.2", path.display())).exists());
}

#[test]
fn symlink_rejected_on_load() {
    let dir = tmp();
    let path = dir.path().join("store.enc");
    // Create a symlink at the store path
    std::os::unix::fs::symlink("/nonexistent/target", &path).unwrap();
    let mut sm = StorageManager::new(&path, false);
    assert!(sm.load().is_err());
}

// --- plaintext mode ---

#[test]
fn plaintext_mode_stores_readable_json() {
    let dir = tmp();
    let path = dir.path().join("store.json");
    let mut sm = StorageManager::new(&path, false);
    sm.set("KEY", var("KEY", "value123")).unwrap();
    let raw = std::fs::read_to_string(&path).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(parsed["KEY"]["value"], "value123");
}
