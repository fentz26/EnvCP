use std::path::Path;
use std::sync::Mutex;

use pyo3::exceptions::{PyRuntimeError, PyValueError};
use pyo3::prelude::*;

fn err<E: std::fmt::Display>(e: E) -> PyErr {
    PyRuntimeError::new_err(e.to_string())
}

// ---------------------------------------------------------------------------
// Free crypto functions
// ---------------------------------------------------------------------------

#[pyfunction]
fn encrypt(plaintext: &str, password: &str) -> PyResult<String> {
    envcp_core::crypto::encrypt(plaintext, password).map_err(err)
}

#[pyfunction]
fn decrypt(ciphertext: &str, password: &str) -> PyResult<String> {
    envcp_core::crypto::decrypt(ciphertext, password).map_err(err)
}

#[pyfunction]
fn hash_password(password: &str) -> PyResult<String> {
    envcp_core::crypto::hash_password(password).map_err(err)
}

#[pyfunction]
fn verify_password(password: &str, hash: &str) -> PyResult<bool> {
    envcp_core::crypto::verify_password(password, hash).map_err(err)
}

#[pyfunction]
fn generate_recovery_key() -> String {
    envcp_core::crypto::generate_recovery_key()
}

#[pyfunction]
fn create_recovery_data(password: &str, recovery_key: &str) -> PyResult<String> {
    envcp_core::crypto::create_recovery_data(password, recovery_key).map_err(err)
}

#[pyfunction]
fn recover_password(recovery_data: &str, recovery_key: &str) -> PyResult<String> {
    envcp_core::crypto::recover_password(recovery_data, recovery_key).map_err(err)
}

#[pyfunction]
fn hmac_sign(key: &[u8], data: &str) -> String {
    envcp_core::crypto::hmac_sign(key, data)
}

#[pyfunction]
fn hmac_verify(key: &[u8], data: &str, expected_hex: &str) -> bool {
    envcp_core::crypto::hmac_verify(key, data, expected_hex)
}

#[pyfunction]
fn generate_id() -> String {
    envcp_core::crypto::generate_id()
}

#[pyfunction]
fn generate_session_token() -> String {
    envcp_core::crypto::generate_session_token()
}

// ---------------------------------------------------------------------------
// StorageManager class
// ---------------------------------------------------------------------------

#[pyclass]
struct StorageManager {
    inner: Mutex<envcp_core::storage::StorageManager>,
}

#[pymethods]
impl StorageManager {
    #[new]
    #[pyo3(signature = (path, encrypted=true))]
    fn new(path: &str, encrypted: bool) -> Self {
        Self {
            inner: Mutex::new(envcp_core::storage::StorageManager::new(
                Path::new(path),
                encrypted,
            )),
        }
    }

    fn set_password(&self, password: &str) -> PyResult<()> {
        self.inner.lock().map_err(err)?.set_password(password);
        Ok(())
    }

    fn invalidate_cache(&self) -> PyResult<()> {
        self.inner.lock().map_err(err)?.invalidate_cache();
        Ok(())
    }

    fn exists(&self) -> PyResult<bool> {
        Ok(self.inner.lock().map_err(err)?.exists())
    }

    /// Returns the full vault as a JSON string (map of name → Variable object).
    fn load(&self) -> PyResult<String> {
        let mut sm = self.inner.lock().map_err(err)?;
        let vars = sm.load().map_err(err)?;
        serde_json::to_string(vars).map_err(err)
    }

    /// Returns a single Variable as a JSON string, or None.
    fn get(&self, name: &str) -> PyResult<Option<String>> {
        let mut sm = self.inner.lock().map_err(err)?;
        let opt = sm.get(name).map_err(err)?;
        Ok(opt.map(|v| serde_json::to_string(&v).unwrap()))
    }

    /// Accepts a Variable as a JSON string.
    fn set(&self, name: &str, var_json: &str) -> PyResult<()> {
        let var: envcp_core::storage::Variable =
            serde_json::from_str(var_json).map_err(|e| PyValueError::new_err(e.to_string()))?;
        let mut sm = self.inner.lock().map_err(err)?;
        sm.set(name, var).map_err(err)
    }

    fn delete(&self, name: &str) -> PyResult<bool> {
        let mut sm = self.inner.lock().map_err(err)?;
        sm.delete(name).map_err(err)
    }

    fn list(&self) -> PyResult<Vec<String>> {
        let mut sm = self.inner.lock().map_err(err)?;
        sm.list().map_err(err)
    }
}

// ---------------------------------------------------------------------------
// Module definition
// ---------------------------------------------------------------------------

#[pymodule]
fn _core(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add("__version__", envcp_core::VERSION)?;

    m.add_function(wrap_pyfunction!(encrypt, m)?)?;
    m.add_function(wrap_pyfunction!(decrypt, m)?)?;
    m.add_function(wrap_pyfunction!(hash_password, m)?)?;
    m.add_function(wrap_pyfunction!(verify_password, m)?)?;
    m.add_function(wrap_pyfunction!(generate_recovery_key, m)?)?;
    m.add_function(wrap_pyfunction!(create_recovery_data, m)?)?;
    m.add_function(wrap_pyfunction!(recover_password, m)?)?;
    m.add_function(wrap_pyfunction!(hmac_sign, m)?)?;
    m.add_function(wrap_pyfunction!(hmac_verify, m)?)?;
    m.add_function(wrap_pyfunction!(generate_id, m)?)?;
    m.add_function(wrap_pyfunction!(generate_session_token, m)?)?;

    m.add_class::<StorageManager>()?;

    Ok(())
}
