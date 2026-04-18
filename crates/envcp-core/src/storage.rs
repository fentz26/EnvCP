use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

use serde::{Deserialize, Serialize};

use crate::crypto;
use crate::error::{Error, Result};
use zeroize::Zeroize;

fn set_private(p: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        fs::set_permissions(p, fs::Permissions::from_mode(0o600))
    }
    #[cfg(not(unix))]
    {
        let mut perms = fs::metadata(p)?.permissions();
        perms.set_readonly(true);
        fs::set_permissions(p, perms)
    }
}

fn set_private_dir(p: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        fs::set_permissions(p, fs::Permissions::from_mode(0o700))
    }
    #[cfg(not(unix))]
    {
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Variable {
    pub name: String,
    pub value: String,
    pub encrypted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub created: String,
    pub updated: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accessed: Option<String>,
    pub sync_to_env: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub protected: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub protected_value: Option<String>,
}

pub struct StorageManager {
    path: PathBuf,
    pub encrypted: bool,
    password: Option<String>,
    max_backups: usize,
    cache: Option<HashMap<String, Variable>>,
}

impl Drop for StorageManager {
    fn drop(&mut self) {
        if let Some(ref mut pw) = self.password {
            pw.zeroize();
        }
    }
}

impl StorageManager {
    pub fn new(path: &Path, encrypted: bool) -> Self {
        Self {
            path: path.to_path_buf(),
            encrypted,
            password: None,
            max_backups: 3,
            cache: None,
        }
    }

    pub fn set_password(&mut self, password: &str) {
        if self.password.as_deref() != Some(password) {
            self.password = Some(password.to_string());
            self.cache = None;
        }
    }

    pub fn invalidate_cache(&mut self) {
        self.cache = None;
    }

    pub fn load(&mut self) -> Result<&HashMap<String, Variable>> {
        if self.cache.is_some() {
            return Ok(self.cache.as_ref().unwrap());
        }

        // Check symlink/existence before reading
        match fs::symlink_metadata(&self.path) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err(Error::NotAFile(self.path.display().to_string()));
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                self.cache = Some(HashMap::new());
                return Ok(self.cache.as_ref().unwrap());
            }
            Err(e) => return Err(Error::Io(e)),
            Ok(_) => {}
        }

        let raw = match fs::read_to_string(&self.path) {
            Ok(s) => s,
            Err(e) => return Err(Error::Io(e)),
        };

        let json = if self.encrypted {
            if let Some(pw) = &self.password {
                match crypto::decrypt(&raw, pw) {
                    Ok(d) => d,
                    Err(_) => {
                        if let Some(restored) = self.try_restore_from_backup()? {
                            self.cache = Some(restored);
                            return Ok(self.cache.as_ref().unwrap());
                        }
                        return Err(Error::DecryptFailed);
                    }
                }
            } else {
                raw
            }
        } else {
            raw
        };

        let vars: HashMap<String, Variable> = serde_json::from_str(&json)?;
        self.cache = Some(vars);
        Ok(self.cache.as_ref().unwrap())
    }

    pub fn save(&mut self, vars: HashMap<String, Variable>) -> Result<()> {
        let dir = self.path.parent().unwrap_or(Path::new("."));
        fs::create_dir_all(dir)?;
        set_private_dir(dir)?;

        self.rotate_backups()?;

        let json = if self.encrypted {
            serde_json::to_string(&vars)?
        } else {
            serde_json::to_string_pretty(&vars)?
        };

        let content = if self.encrypted {
            if let Some(pw) = &self.password {
                crypto::encrypt(&json, pw)?
            } else {
                json
            }
        } else {
            json
        };

        let tmp = self
            .path
            .with_extension(format!("{}.tmp", std::process::id()));
        if let Err(e) = (|| -> Result<()> {
            fs::write(&tmp, &content)?;
            set_private(&tmp)?;
            fs::rename(&tmp, &self.path)?;
            set_private(&self.path)?;
            Ok(())
        })() {
            let _ = fs::remove_file(&tmp);
            return Err(e);
        }

        self.cache = Some(vars);
        Ok(())
    }

    pub fn get(&mut self, name: &str) -> Result<Option<Variable>> {
        Ok(self.load()?.get(name).cloned())
    }

    pub fn set(&mut self, name: &str, var: Variable) -> Result<()> {
        let mut vars = self.load()?.clone();
        vars.insert(name.to_string(), var);
        self.save(vars)
    }

    pub fn delete(&mut self, name: &str) -> Result<bool> {
        let mut vars = self.load()?.clone();
        if vars.remove(name).is_some() {
            self.save(vars)?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    pub fn list(&mut self) -> Result<Vec<String>> {
        Ok(self.load()?.keys().cloned().collect())
    }

    pub fn exists(&self) -> bool {
        self.path.exists()
    }

    fn rotate_backups(&self) -> Result<()> {
        if self.max_backups == 0 || !self.path.exists() {
            return Ok(());
        }
        for i in (2..=self.max_backups).rev() {
            let from = PathBuf::from(format!("{}.bak.{}", self.path.display(), i - 1));
            let to = PathBuf::from(format!("{}.bak.{}", self.path.display(), i));
            if from.exists() {
                fs::rename(&from, &to)?;
            }
        }
        let bak1 = PathBuf::from(format!("{}.bak.1", self.path.display()));
        fs::copy(&self.path, &bak1)?;
        set_private(&bak1)?;
        Ok(())
    }

    fn try_restore_from_backup(&self) -> Result<Option<HashMap<String, Variable>>> {
        let pw = match &self.password {
            Some(p) => p.clone(),
            None => return Ok(None),
        };
        for i in 1..=self.max_backups {
            let bak = PathBuf::from(format!("{}.bak.{}", self.path.display(), i));
            let raw = match fs::read_to_string(&bak) {
                Ok(s) => s,
                Err(_) => continue,
            };
            if let Ok(decrypted) = crypto::decrypt(&raw, &pw) {
                if let Ok(vars) = serde_json::from_str::<HashMap<String, Variable>>(&decrypted) {
                    // SECURITY: Surface restore loudly so silent recovery
                    // can't mask tampering or corruption.
                    eprintln!(
                        "\n[envcp] WARNING: primary store failed to decrypt; \
                         restored from backup {}.\n\
                         [envcp] If you did not expect this, your store may \
                         have been tampered with or corrupted. Inspect \
                         '{}.bak.*' before continuing.\n",
                        bak.display(),
                        self.path.display()
                    );
                    fs::copy(&bak, &self.path)?;
                    set_private(&self.path)?;
                    return Ok(Some(vars));
                }
            }
        }
        Ok(None)
    }
}
