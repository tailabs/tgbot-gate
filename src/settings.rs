use std::{
    io,
    path::{Path, PathBuf},
    sync::{Arc, RwLock},
};

use serde::{Deserialize, Serialize};

use crate::{
    audit::AuditStore,
    db::GateDatabase,
};

pub const DEFAULT_MAX_BODY_BYTES: usize = 50 * 1024 * 1024;
pub const MIN_BODY_BYTES: usize = 1024;
pub const MAX_BODY_BYTES: usize = 100 * 1024 * 1024;
pub const MIN_RETENTION_DAYS: u32 = 1;
pub const MAX_RETENTION_DAYS: u32 = 365;

const KEY_AUDIT_LOG: &str = "audit_log";
const KEY_AUDIT_CAPTURE: &str = "audit_capture";
const KEY_AUDIT_RETENTION_DAYS: &str = "audit_retention_days";
const KEY_AUDIT_ERRORS_ONLY: &str = "audit_errors_only";
const KEY_AUDIT_MAX_BODY_BYTES: &str = "audit_max_body_bytes";
const KEY_MAX_PROXY_BODY_BYTES: &str = "max_proxy_body_bytes";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct GateSettings {
    pub audit_log: bool,
    pub audit_capture: bool,
    pub audit_retention_days: u32,
    pub audit_errors_only: bool,
    pub audit_max_body_bytes: usize,
    pub max_proxy_body_bytes: usize,
}

impl Default for GateSettings {
    fn default() -> Self {
        Self {
            audit_log: true,
            audit_capture: false,
            audit_retention_days: 7,
            audit_errors_only: false,
            audit_max_body_bytes: DEFAULT_MAX_BODY_BYTES,
            max_proxy_body_bytes: DEFAULT_MAX_BODY_BYTES,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct GateSettingsPatch {
    pub audit_log: Option<bool>,
    pub audit_capture: Option<bool>,
    pub audit_retention_days: Option<u32>,
    pub audit_errors_only: Option<bool>,
    pub audit_max_body_bytes: Option<usize>,
    pub max_proxy_body_bytes: Option<usize>,
}

#[derive(Debug, Clone)]
pub struct AuditSnapshot {
    pub stdout_log: bool,
    pub errors_only: bool,
    pub max_body_bytes: usize,
    pub store: Option<Arc<AuditStore>>,
}

#[derive(Debug)]
struct Inner {
    values: GateSettings,
    audit_store: Option<Arc<AuditStore>>,
}

pub struct RuntimeSettings {
    db: Arc<GateDatabase>,
    gate_db_path: PathBuf,
    inner: RwLock<Inner>,
}

impl std::fmt::Debug for RuntimeSettings {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RuntimeSettings")
            .field("values", &self.public())
            .finish_non_exhaustive()
    }
}

impl RuntimeSettings {
    pub fn load(db: Arc<GateDatabase>) -> io::Result<Arc<Self>> {
        let gate_db_path = db.path().to_path_buf();
        let values = load_values(db.as_ref())?;
        let mut audit_store = None;
        if values.audit_capture {
            audit_store = open_audit_store(&gate_db_path, values.audit_retention_days);
        }
        Ok(Arc::new(Self {
            db,
            gate_db_path,
            inner: RwLock::new(Inner {
                values,
                audit_store,
            }),
        }))
    }

    pub fn public(&self) -> GateSettings {
        self.inner.read().expect("settings lock poisoned").values.clone()
    }

    pub fn audit_snapshot(&self) -> AuditSnapshot {
        let inner = self.inner.read().expect("settings lock poisoned");
        AuditSnapshot {
            stdout_log: inner.values.audit_log,
            errors_only: inner.values.audit_errors_only,
            max_body_bytes: inner.values.audit_max_body_bytes,
            store: inner.audit_store.clone(),
        }
    }

    pub fn max_proxy_body_bytes(&self) -> usize {
        self.inner
            .read()
            .expect("settings lock poisoned")
            .values
            .max_proxy_body_bytes
    }

    pub fn update(&self, patch: GateSettingsPatch) -> io::Result<GateSettings> {
        let mut inner = self.inner.write().expect("settings lock poisoned");
        let previous = inner.values.clone();
        let next = merge_settings(&previous, patch)?;
        persist_values(self.db.as_ref(), &next)?;
        apply_audit_store(
            &mut inner.audit_store,
            &self.gate_db_path,
            &previous,
            &next,
        );
        inner.values = next;
        Ok(inner.values.clone())
    }

    pub fn emit_startup_notice(&self) {
        let inner = self.inner.read().expect("settings lock poisoned");
        crate::audit::emit_startup_notice(&inner.values, inner.audit_store.is_some());
    }

    pub fn db_handle(&self) -> Arc<GateDatabase> {
        Arc::clone(&self.db)
    }
}

fn merge_settings(current: &GateSettings, patch: GateSettingsPatch) -> io::Result<GateSettings> {
    let mut next = current.clone();
    if let Some(value) = patch.audit_log {
        next.audit_log = value;
    }
    if let Some(value) = patch.audit_capture {
        next.audit_capture = value;
    }
    if let Some(value) = patch.audit_retention_days {
        next.audit_retention_days = clamp_retention_days(value);
    }
    if let Some(value) = patch.audit_errors_only {
        next.audit_errors_only = value;
    }
    if let Some(value) = patch.audit_max_body_bytes {
        next.audit_max_body_bytes = clamp_body_bytes(value)?;
    }
    if let Some(value) = patch.max_proxy_body_bytes {
        next.max_proxy_body_bytes = clamp_body_bytes(value)?;
    }
    Ok(next)
}

fn apply_audit_store(
    store: &mut Option<Arc<AuditStore>>,
    db_path: &Path,
    previous: &GateSettings,
    next: &GateSettings,
) {
    if !next.audit_capture {
        *store = None;
        return;
    }

    let retention_changed = previous.audit_retention_days != next.audit_retention_days;
    if store.is_none() || retention_changed {
        *store = open_audit_store(db_path, next.audit_retention_days);
    }
}

fn open_audit_store(db_path: &Path, retention_days: u32) -> Option<Arc<AuditStore>> {
    match AuditStore::open(db_path.to_path_buf(), retention_days) {
        Ok(store) => Some(Arc::new(store)),
        Err(error) => {
            eprintln!("audit capture disabled: failed to open db: {error}");
            None
        }
    }
}

fn load_values(db: &GateDatabase) -> io::Result<GateSettings> {
    let defaults = GateSettings::default();
    let values = GateSettings {
        audit_log: load_bool(db, KEY_AUDIT_LOG, "AUDIT_LOG", defaults.audit_log)?,
        audit_capture: load_bool(db, KEY_AUDIT_CAPTURE, "AUDIT_CAPTURE", defaults.audit_capture)?,
        audit_retention_days: load_u32(
            db,
            KEY_AUDIT_RETENTION_DAYS,
            "AUDIT_RETENTION_DAYS",
            defaults.audit_retention_days,
        )?,
        audit_errors_only: load_bool(
            db,
            KEY_AUDIT_ERRORS_ONLY,
            "AUDIT_ERRORS_ONLY",
            defaults.audit_errors_only,
        )?,
        audit_max_body_bytes: load_usize(
            db,
            KEY_AUDIT_MAX_BODY_BYTES,
            "AUDIT_MAX_BODY_BYTES",
            defaults.audit_max_body_bytes,
        )?,
        max_proxy_body_bytes: load_usize(
            db,
            KEY_MAX_PROXY_BODY_BYTES,
            "MAX_PROXY_BODY_BYTES",
            defaults.max_proxy_body_bytes,
        )?,
    };
    persist_values(db, &values)?;
    Ok(values)
}

fn persist_values(db: &GateDatabase, values: &GateSettings) -> io::Result<()> {
    db.set_setting(KEY_AUDIT_LOG, if values.audit_log { "1" } else { "0" })?;
    db.set_setting(
        KEY_AUDIT_CAPTURE,
        if values.audit_capture { "1" } else { "0" },
    )?;
    db.set_setting(
        KEY_AUDIT_RETENTION_DAYS,
        &values.audit_retention_days.to_string(),
    )?;
    db.set_setting(
        KEY_AUDIT_ERRORS_ONLY,
        if values.audit_errors_only { "1" } else { "0" },
    )?;
    db.set_setting(
        KEY_AUDIT_MAX_BODY_BYTES,
        &values.audit_max_body_bytes.to_string(),
    )?;
    db.set_setting(
        KEY_MAX_PROXY_BODY_BYTES,
        &values.max_proxy_body_bytes.to_string(),
    )?;
    Ok(())
}

fn load_bool(db: &GateDatabase, key: &str, env_key: &str, default: bool) -> io::Result<bool> {
    if let Some(raw) = db.get_setting(key)? {
        return Ok(parse_bool(&raw, default));
    }
    let value = env_bool(env_key).unwrap_or(default);
    Ok(value)
}

fn load_u32(db: &GateDatabase, key: &str, env_key: &str, default: u32) -> io::Result<u32> {
    if let Some(raw) = db.get_setting(key)? {
        return Ok(clamp_retention_days(
            raw.parse::<u32>().unwrap_or(default),
        ));
    }
    let value = env_parse(env_key).unwrap_or(default);
    Ok(clamp_retention_days(value))
}

fn load_usize(db: &GateDatabase, key: &str, env_key: &str, default: usize) -> io::Result<usize> {
    if let Some(raw) = db.get_setting(key)? {
        let parsed = raw.parse::<usize>().unwrap_or(default);
        return clamp_body_bytes(parsed);
    }
    let value = env_parse(env_key).unwrap_or(default);
    clamp_body_bytes(value)
}

fn parse_bool(raw: &str, default: bool) -> bool {
    match raw.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => true,
        "0" | "false" | "no" | "off" => false,
        _ => default,
    }
}

fn env_bool(key: &str) -> Option<bool> {
    std::env::var(key).ok().map(|value| {
        let value = value.trim().to_ascii_lowercase();
        value == "1" || value == "true" || value == "yes" || value == "on"
    })
}

fn env_parse<T: std::str::FromStr>(key: &str) -> Option<T> {
    std::env::var(key).ok().and_then(|value| value.parse().ok())
}

fn clamp_retention_days(value: u32) -> u32 {
    value.clamp(MIN_RETENTION_DAYS, MAX_RETENTION_DAYS)
}

fn clamp_body_bytes(value: usize) -> io::Result<usize> {
    if (MIN_BODY_BYTES..=MAX_BODY_BYTES).contains(&value) {
        Ok(value)
    } else {
        Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!(
                "body size must be between {MIN_BODY_BYTES} and {MAX_BODY_BYTES} bytes"
            ),
        ))
    }
}
