#![deny(clippy::all)]

use std::path::Path;
use std::sync::{Arc, Mutex};

use napi::bindgen_prelude::*;
use napi::{Env, JsString, JsUnknown, Task};
use napi_derive::napi;

// ---------------------------------------------------------------------------
// Async task helpers for CPU-bound crypto operations
// ---------------------------------------------------------------------------

macro_rules! crypto_task {
    ($name:ident, $output:ty, ($($field:ident : $ft:ty),*), $body:block) => {
        pub struct $name { $($field: $ft),* }

        impl Task for $name {
            type Output = $output;
            type JsValue = JsString;

            fn compute(&mut self) -> napi::Result<$output> {
                let Self { $($field),* } = self;
                $body
            }

            fn resolve(&mut self, env: Env, output: $output) -> napi::Result<JsString> {
                env.create_string(&output)
            }
        }
    };
}

crypto_task!(EncryptTask, String, (plaintext: String, password: String), {
    envcp_core::crypto::encrypt(plaintext, password)
        .map_err(|e| napi::Error::from_reason(e.to_string()))
});

crypto_task!(DecryptTask, String, (ciphertext: String, password: String), {
    envcp_core::crypto::decrypt(ciphertext, password)
        .map_err(|e| napi::Error::from_reason(e.to_string()))
});

crypto_task!(HashPasswordTask, String, (password: String), {
    envcp_core::crypto::hash_password(password)
        .map_err(|e| napi::Error::from_reason(e.to_string()))
});

crypto_task!(CreateRecoveryTask, String, (password: String, recovery_key: String), {
    envcp_core::crypto::create_recovery_data(password, recovery_key)
        .map_err(|e| napi::Error::from_reason(e.to_string()))
});

crypto_task!(RecoverPasswordTask, String, (recovery_data: String, recovery_key: String), {
    envcp_core::crypto::recover_password(recovery_data, recovery_key)
        .map_err(|e| napi::Error::from_reason(e.to_string()))
});

// ---------------------------------------------------------------------------
// Exported crypto free functions (return Promise<string>)
// ---------------------------------------------------------------------------

#[napi]
pub fn encrypt(plaintext: String, password: String) -> AsyncTask<EncryptTask> {
    AsyncTask::new(EncryptTask { plaintext, password })
}

#[napi]
pub fn decrypt(ciphertext: String, password: String) -> AsyncTask<DecryptTask> {
    AsyncTask::new(DecryptTask { ciphertext, password })
}

#[napi]
pub fn hash_password(password: String) -> AsyncTask<HashPasswordTask> {
    AsyncTask::new(HashPasswordTask { password })
}

#[napi]
pub fn verify_password(password: String, hash: String) -> napi::Result<bool> {
    envcp_core::crypto::verify_password(&password, &hash)
        .map_err(|e| napi::Error::from_reason(e.to_string()))
}

#[napi]
pub fn generate_recovery_key() -> String {
    envcp_core::crypto::generate_recovery_key()
}

#[napi]
pub fn create_recovery_data(
    password: String,
    recovery_key: String,
) -> AsyncTask<CreateRecoveryTask> {
    AsyncTask::new(CreateRecoveryTask { password, recovery_key })
}

#[napi]
pub fn recover_password(
    recovery_data: String,
    recovery_key: String,
) -> AsyncTask<RecoverPasswordTask> {
    AsyncTask::new(RecoverPasswordTask { recovery_data, recovery_key })
}

#[napi]
pub fn hmac_sign(key: Buffer, data: String) -> String {
    envcp_core::crypto::hmac_sign(&key, &data)
}

#[napi]
pub fn hmac_verify(key: Buffer, data: String, expected_hex: String) -> bool {
    envcp_core::crypto::hmac_verify(&key, &data, &expected_hex)
}

#[napi]
pub fn generate_id() -> String {
    envcp_core::crypto::generate_id()
}

#[napi]
pub fn generate_session_token() -> String {
    envcp_core::crypto::generate_session_token()
}

// ---------------------------------------------------------------------------
// StorageManager class — I/O + crypto ops run on libuv thread pool via Tasks
// ---------------------------------------------------------------------------

type SharedStorage = Arc<Mutex<envcp_core::storage::StorageManager>>;

// Per-method async tasks that clone the Arc and capture args by value.

pub struct SmGetTask { inner: SharedStorage, name: String }
pub struct SmSetTask { inner: SharedStorage, name: String, var_json: String }
pub struct SmDeleteTask { inner: SharedStorage, name: String }
pub struct SmListTask { inner: SharedStorage }
pub struct SmLoadTask { inner: SharedStorage }

impl Task for SmGetTask {
    type Output = Option<String>;
    type JsValue = JsUnknown;

    fn compute(&mut self) -> napi::Result<Option<String>> {
        let mut sm = lock(&self.inner)?;
        let opt = sm.get(&self.name).map_err(err)?;
        Ok(opt.map(|v| serde_json::to_string(&v).unwrap()))
    }

    fn resolve(&mut self, env: Env, output: Option<String>) -> napi::Result<JsUnknown> {
        match output {
            Some(json) => {
                let obj = env.create_string(&json)?.into_unknown();
                Ok(obj)
            }
            None => Ok(env.get_undefined()?.into_unknown()),
        }
    }
}

impl Task for SmSetTask {
    type Output = ();
    type JsValue = JsUnknown;

    fn compute(&mut self) -> napi::Result<()> {
        let var: envcp_core::storage::Variable =
            serde_json::from_str(&self.var_json).map_err(|e| napi::Error::from_reason(e.to_string()))?;
        let mut sm = lock(&self.inner)?;
        sm.set(&self.name, var).map_err(err)
    }

    fn resolve(&mut self, env: Env, _: ()) -> napi::Result<JsUnknown> {
        Ok(env.get_undefined()?.into_unknown())
    }
}

impl Task for SmDeleteTask {
    type Output = bool;
    type JsValue = napi::JsBoolean;

    fn compute(&mut self) -> napi::Result<bool> {
        let mut sm = lock(&self.inner)?;
        sm.delete(&self.name).map_err(err)
    }

    fn resolve(&mut self, env: Env, output: bool) -> napi::Result<napi::JsBoolean> {
        env.get_boolean(output)
    }
}

impl Task for SmListTask {
    type Output = Vec<String>;
    type JsValue = JsUnknown;

    fn compute(&mut self) -> napi::Result<Vec<String>> {
        let mut sm = lock(&self.inner)?;
        sm.list().map_err(err)
    }

    fn resolve(&mut self, env: Env, output: Vec<String>) -> napi::Result<JsUnknown> {
        let json = serde_json::to_string(&output)
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;
        Ok(env.create_string(&json)?.into_unknown())
    }
}

impl Task for SmLoadTask {
    type Output = String;
    type JsValue = JsUnknown;

    fn compute(&mut self) -> napi::Result<String> {
        let mut sm = lock(&self.inner)?;
        let vars = sm.load().map_err(err)?;
        serde_json::to_string(vars).map_err(|e| napi::Error::from_reason(e.to_string()))
    }

    fn resolve(&mut self, env: Env, output: String) -> napi::Result<JsUnknown> {
        Ok(env.create_string(&output)?.into_unknown())
    }
}

fn lock(inner: &SharedStorage) -> napi::Result<std::sync::MutexGuard<'_, envcp_core::storage::StorageManager>> {
    inner.lock().map_err(|_| napi::Error::from_reason("StorageManager lock poisoned"))
}

fn err(e: envcp_core::Error) -> napi::Error {
    napi::Error::from_reason(e.to_string())
}

#[napi]
pub struct StorageManager {
    inner: SharedStorage,
}

#[napi]
impl StorageManager {
    #[napi(constructor)]
    pub fn new(path: String, encrypted: bool) -> Self {
        Self {
            inner: Arc::new(Mutex::new(envcp_core::storage::StorageManager::new(
                Path::new(&path),
                encrypted,
            ))),
        }
    }

    #[napi]
    pub fn set_password(&self, password: String) -> napi::Result<()> {
        lock(&self.inner)?.set_password(&password);
        Ok(())
    }

    #[napi]
    pub fn invalidate_cache(&self) -> napi::Result<()> {
        lock(&self.inner)?.invalidate_cache();
        Ok(())
    }

    #[napi]
    pub fn exists(&self) -> napi::Result<bool> {
        Ok(lock(&self.inner)?.exists())
    }

    #[napi]
    pub fn load(&self) -> AsyncTask<SmLoadTask> {
        AsyncTask::new(SmLoadTask { inner: Arc::clone(&self.inner) })
    }

    #[napi]
    pub fn get(&self, name: String) -> AsyncTask<SmGetTask> {
        AsyncTask::new(SmGetTask { inner: Arc::clone(&self.inner), name })
    }

    #[napi]
    pub fn set(&self, name: String, var_json: String) -> AsyncTask<SmSetTask> {
        AsyncTask::new(SmSetTask { inner: Arc::clone(&self.inner), name, var_json })
    }

    #[napi]
    pub fn delete(&self, name: String) -> AsyncTask<SmDeleteTask> {
        AsyncTask::new(SmDeleteTask { inner: Arc::clone(&self.inner), name })
    }

    #[napi]
    pub fn list(&self) -> AsyncTask<SmListTask> {
        AsyncTask::new(SmListTask { inner: Arc::clone(&self.inner) })
    }
}
