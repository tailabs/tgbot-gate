use std::{
    io,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
};

use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::registry::BotRecord;

const SETTINGS_ADMIN_PASSWORD: &str = "admin_password_sha256";

pub fn gate_db_path(legacy_data_path: &Path) -> PathBuf {
    std::env::var("GATE_DB_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            legacy_data_path
                .parent()
                .map(|parent| parent.join("gate.db"))
                .unwrap_or_else(|| PathBuf::from("data/gate.db"))
        })
}

pub fn password_hash(password: &str) -> String {
    let digest = Sha256::digest(password.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[derive(Debug)]
pub struct GateDatabase {
    path: PathBuf,
    conn: Mutex<Connection>,
}

impl GateDatabase {
    pub fn open(path: PathBuf) -> io::Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let conn = Connection::open(&path).map_err(io::Error::other)?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;",
        )
        .map_err(io::Error::other)?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS bots (
                token_hash TEXT PRIMARY KEY,
                label TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_bots_created_at ON bots(created_at DESC);
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );",
        )
        .map_err(io::Error::other)?;

        Ok(Self {
            path,
            conn: Mutex::new(conn),
        })
    }

    /// Import `bots.json` once when SQLite has no bots yet (upgrade from file storage).
    pub fn migrate_legacy_bots_json(&self, legacy_path: &Path) -> io::Result<usize> {
        if self.bot_count()? > 0 {
            return Ok(0);
        }
        if !legacy_path.is_file() {
            return Ok(0);
        }

        let text = std::fs::read_to_string(legacy_path)?;
        let payload: LegacyBotsFile = serde_json::from_str(&text).map_err(io::Error::other)?;
        let before = self.bot_count()?;
        for bot in payload.bots {
            self.add_bot(bot.label, bot.token_hash, bot.created_at)?;
        }
        Ok(self.bot_count()?.saturating_sub(before))
    }

    fn bot_count(&self) -> io::Result<usize> {
        let conn = self.conn();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM bots", [], |row| row.get(0))
            .map_err(io::Error::other)?;
        Ok(count as usize)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    fn conn(&self) -> MutexGuard<'_, Connection> {
        self.conn.lock().expect("gate db mutex poisoned")
    }

    pub fn get_admin_password_hash(&self) -> io::Result<Option<String>> {
        let conn = self.conn();
        conn.query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![SETTINGS_ADMIN_PASSWORD],
            |row| row.get(0),
        )
        .optional()
        .map_err(io::Error::other)
    }

    pub fn set_admin_password_hash(&self, hash: &str) -> io::Result<()> {
        let conn = self.conn();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![SETTINGS_ADMIN_PASSWORD, hash],
        )
        .map_err(io::Error::other)?;
        Ok(())
    }

    pub fn list_bots(&self) -> io::Result<Vec<BotRecord>> {
        let conn = self.conn();
        let mut stmt = conn
            .prepare("SELECT token_hash, label, created_at FROM bots ORDER BY created_at DESC")
            .map_err(io::Error::other)?;
        let rows = stmt
            .query_map([], |row| {
                Ok(BotRecord {
                    token_hash: row.get(0)?,
                    label: row.get(1)?,
                    created_at: row.get::<_, i64>(2)? as u64,
                })
            })
            .map_err(io::Error::other)?;

        rows.collect::<Result<Vec<_>, _>>().map_err(io::Error::other)
    }

    pub fn add_bot(&self, label: String, token_hash: String, created_at: u64) -> io::Result<BotRecord> {
        let conn = self.conn();
        if let Some(existing) = conn
            .query_row(
                "SELECT token_hash, label, created_at FROM bots WHERE token_hash = ?1",
                params![token_hash],
                |row| {
                    Ok(BotRecord {
                        token_hash: row.get(0)?,
                        label: row.get(1)?,
                        created_at: row.get::<_, i64>(2)? as u64,
                    })
                },
            )
            .optional()
            .map_err(io::Error::other)?
        {
            return Ok(existing);
        }

        conn.execute(
            "INSERT INTO bots (token_hash, label, created_at) VALUES (?1, ?2, ?3)",
            params![token_hash, label, created_at as i64],
        )
        .map_err(io::Error::other)?;

        Ok(BotRecord {
            token_hash,
            label,
            created_at,
        })
    }

    pub fn delete_bot(&self, token_hash: &str) -> io::Result<bool> {
        let conn = self.conn();
        let deleted = conn
            .execute("DELETE FROM bots WHERE token_hash = ?1", params![token_hash])
            .map_err(io::Error::other)?;
        Ok(deleted > 0)
    }
}

#[derive(Debug, Deserialize)]
struct LegacyBotsFile {
    #[serde(default)]
    bots: Vec<LegacyBotRecord>,
}

#[derive(Debug, Deserialize)]
struct LegacyBotRecord {
    token_hash: String,
    label: String,
    created_at: u64,
}
