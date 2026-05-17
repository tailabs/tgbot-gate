use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
};

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

const INSERTS_BETWEEN_CLEANUP: usize = 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuditKind {
    Proxy,
    /// Legacy shards only; new captures are proxy-only.
    #[allow(dead_code)]
    Api,
}

impl AuditKind {
    fn as_str(self) -> &'static str {
        match self {
            AuditKind::Proxy => "proxy",
            AuditKind::Api => "api",
        }
    }

    fn table_prefix(self) -> &'static str {
        match self {
            AuditKind::Proxy => "audit_proxy_",
            AuditKind::Api => "audit_api_",
        }
    }
}

#[derive(Debug, Clone)]
pub struct CaptureEntry {
    pub kind: AuditKind,
    pub ts_ms: i64,
    pub method: String,
    pub path: String,
    pub status: u16,
    pub latency_ms: u128,
    pub client_ip: String,
    pub request_body: Option<String>,
    pub response_body: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AuditListItem {
    pub shard: String,
    pub id: i64,
    pub ts_ms: i64,
    pub method: String,
    pub path: String,
    pub kind: String,
    pub status: u16,
    pub latency_ms: i64,
    pub client_ip: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AuditPage {
    pub entries: Vec<AuditListItem>,
    pub total: u64,
    pub page: u32,
    pub page_size: u32,
    pub total_pages: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct AuditDetail {
    pub shard: String,
    pub id: i64,
    pub ts_ms: i64,
    pub method: String,
    pub path: String,
    pub kind: String,
    pub status: u16,
    pub latency_ms: i64,
    pub client_ip: String,
    pub request_body: Option<String>,
    pub response_body: Option<String>,
}

#[derive(Debug)]
pub struct AuditStore {
    db_path: PathBuf,
    retention_days: u32,
    conn: Mutex<Connection>,
    inserts_since_cleanup: AtomicUsize,
}

pub fn capture_enabled() -> bool {
    match std::env::var("AUDIT_CAPTURE") {
        Ok(value) => {
            let value = value.trim().to_ascii_lowercase();
            value == "1" || value == "true" || value == "yes" || value == "on"
        }
        Err(_) => false,
    }
}

pub fn retention_days_from_env() -> u32 {
    std::env::var("AUDIT_RETENTION_DAYS")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(7)
}

impl AuditStore {
    pub fn open(db_path: PathBuf, retention_days: u32) -> Result<Self, rusqlite::Error> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                rusqlite::Error::ToSqlConversionFailure(Box::new(error))
            })?;
        }

        let conn = Connection::open(&db_path)?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;",
        )?;
        conn.execute(
            "CREATE TABLE IF NOT EXISTS audit_meta (
                shard_name TEXT PRIMARY KEY,
                kind TEXT NOT NULL,
                ym INTEGER NOT NULL,
                created_at_ms INTEGER NOT NULL
            )",
            [],
        )?;

        let store = Self {
            db_path,
            retention_days,
            conn: Mutex::new(conn),
            inserts_since_cleanup: AtomicUsize::new(0),
        };
        store.cleanup_old_shards()?;
        Ok(store)
    }

    pub fn record(self: &Arc<Self>, entry: CaptureEntry) {
        let db_path = self.db_path.clone();
        let retention_days = self.retention_days;
        let inserts = Arc::clone(self);
        std::thread::spawn(move || {
            let handle = StoreHandle {
                db_path,
                retention_days,
            };
            if let Err(error) = handle.record_sync(entry) {
                eprintln!("audit capture error: {error}");
            }
            if inserts.inserts_since_cleanup.fetch_add(1, Ordering::Relaxed) + 1
                >= INSERTS_BETWEEN_CLEANUP
            {
                inserts.inserts_since_cleanup.store(0, Ordering::Relaxed);
                if let Err(error) = handle.cleanup_old_shards() {
                    eprintln!("audit cleanup error: {error}");
                }
            }
        });
    }

    fn with_conn<T, F>(&self, f: F) -> Result<T, rusqlite::Error>
    where
        F: FnOnce(&Connection) -> Result<T, rusqlite::Error>,
    {
        let guard = self.conn.lock().expect("audit db mutex poisoned");
        f(&guard)
    }

    pub fn list(
        &self,
        page: u32,
        page_size: u32,
        kind: Option<&str>,
        min_status: Option<u16>,
        search: Option<&str>,
    ) -> Result<AuditPage, rusqlite::Error> {
        self.with_conn(|conn| list_page(conn, page, page_size, kind, min_status, search))
    }

    pub fn get(&self, shard: &str, id: i64) -> Result<Option<AuditDetail>, rusqlite::Error> {
        self.with_conn(|conn| get_row(conn, shard, id))
    }

    fn cleanup_old_shards(&self) -> Result<(), rusqlite::Error> {
        self.with_conn(|conn| cleanup_old_shards(conn, self.retention_days))
    }
}

struct StoreHandle {
    db_path: PathBuf,
    retention_days: u32,
}

impl StoreHandle {
    fn record_sync(&self, entry: CaptureEntry) -> Result<(), rusqlite::Error> {
        let conn = Connection::open(&self.db_path)?;
        let ym = ym_from_ms(entry.ts_ms);
        let table = ensure_shard(&conn, entry.kind, ym)?;
        conn.execute(
            &format!(
                "INSERT INTO {table} (ts_ms, method, path, status, latency_ms, client_ip, request_body, response_body)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"
            ),
            params![
                entry.ts_ms,
                entry.method,
                entry.path,
                entry.status,
                entry.latency_ms as i64,
                entry.client_ip,
                entry.request_body,
                entry.response_body,
            ],
        )?;
        Ok(())
    }

    fn cleanup_old_shards(&self) -> Result<(), rusqlite::Error> {
        let conn = Connection::open(&self.db_path)?;
        cleanup_old_shards(&conn, self.retention_days)
    }
}

fn shard_name(kind: AuditKind, ym: i32) -> String {
    format!("{}{}", kind.table_prefix(), ym)
}

fn ensure_shard(conn: &Connection, kind: AuditKind, ym: i32) -> Result<String, rusqlite::Error> {
    let name = shard_name(kind, ym);
    conn.execute(
        &format!(
            "CREATE TABLE IF NOT EXISTS {name} (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts_ms INTEGER NOT NULL,
                method TEXT NOT NULL,
                path TEXT NOT NULL,
                status INTEGER NOT NULL,
                latency_ms INTEGER NOT NULL,
                client_ip TEXT NOT NULL,
                request_body TEXT,
                response_body TEXT
            )"
        ),
        [],
    )?;
    let now = unix_ms() as i64;
    conn.execute(
        "INSERT OR IGNORE INTO audit_meta (shard_name, kind, ym, created_at_ms) VALUES (?1, ?2, ?3, ?4)",
        params![name, kind.as_str(), ym, now],
    )?;
    Ok(name)
}

const MAX_SCAN_ROWS: usize = 10_000;

fn list_page(
    conn: &Connection,
    page: u32,
    page_size: u32,
    kind_filter: Option<&str>,
    min_status: Option<u16>,
    search: Option<&str>,
) -> Result<AuditPage, rusqlite::Error> {
    let page = page.max(1);
    let page_size = page_size.clamp(1, 100);
    let mut items = list_shards(conn, MAX_SCAN_ROWS, kind_filter, min_status, search)?;
    items.sort_by(|left, right| right.ts_ms.cmp(&left.ts_ms));
    let total = items.len() as u64;
    let total_pages = ((total + u64::from(page_size) - 1) / u64::from(page_size)).max(1) as u32;
    let offset = ((page - 1) as usize) * page_size as usize;
    let entries = items.into_iter().skip(offset).take(page_size as usize).collect();
    Ok(AuditPage {
        entries,
        total,
        page,
        page_size,
        total_pages,
    })
}

fn list_shards(
    conn: &Connection,
    limit: usize,
    kind_filter: Option<&str>,
    min_status: Option<u16>,
    search: Option<&str>,
) -> Result<Vec<AuditListItem>, rusqlite::Error> {
    let mut shards: Vec<(String, String)> = Vec::new();
    let mut stmt = conn.prepare(
        "SELECT shard_name, kind FROM audit_meta ORDER BY ym DESC, shard_name DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    for row in rows {
        let (shard, kind) = row?;
        if let Some(filter) = kind_filter {
            if kind != filter {
                continue;
            }
        }
        shards.push((shard, kind));
    }

    let pattern = search.map(|query| format!("%{query}%"));
    let mut out = Vec::new();
    for (shard, kind) in shards {
        if out.len() >= limit {
            break;
        }
        let remaining = limit - out.len();
        let batch = fetch_shard_rows(
            conn,
            &shard,
            &kind,
            remaining,
            min_status,
            pattern.as_deref(),
        )?;
        out.extend(batch);
    }
    Ok(out)
}

fn search_clause(start_index: usize) -> String {
    let fields = [
        "path",
        "method",
        "client_ip",
        "COALESCE(request_body,'')",
        "COALESCE(response_body,'')",
    ];
    let predicates = fields
        .iter()
        .enumerate()
        .map(|(offset, field)| format!("{field} LIKE ?{}", start_index + offset))
        .collect::<Vec<_>>()
        .join(" OR ");
    format!(" AND ({predicates})")
}

fn fetch_shard_rows(
    conn: &Connection,
    shard: &str,
    kind: &str,
    remaining: usize,
    min_status: Option<u16>,
    pattern: Option<&str>,
) -> Result<Vec<AuditListItem>, rusqlite::Error> {
    let sql = match (min_status, pattern.is_some()) {
        (Some(_), true) => {
            let search = search_clause(2);
            format!(
                "SELECT id, ts_ms, method, path, status, latency_ms, client_ip
                 FROM {shard} WHERE status >= ?1{search} ORDER BY ts_ms DESC LIMIT ?7"
            )
        }
        (Some(_), false) => format!(
            "SELECT id, ts_ms, method, path, status, latency_ms, client_ip
             FROM {shard} WHERE status >= ?1 ORDER BY ts_ms DESC LIMIT ?2"
        ),
        (None, true) => {
            let search = search_clause(1);
            format!(
                "SELECT id, ts_ms, method, path, status, latency_ms, client_ip
                 FROM {shard} WHERE 1 = 1{search} ORDER BY ts_ms DESC LIMIT ?6"
            )
        }
        (None, false) => format!(
            "SELECT id, ts_ms, method, path, status, latency_ms, client_ip
             FROM {shard} ORDER BY ts_ms DESC LIMIT ?1"
        ),
    };

    let mut stmt = conn.prepare(&sql)?;
    let map_row = |row: &rusqlite::Row<'_>| {
        Ok(AuditListItem {
            shard: shard.to_string(),
            id: row.get(0)?,
            ts_ms: row.get(1)?,
            method: row.get(2)?,
            path: row.get(3)?,
            kind: kind.to_string(),
            status: row.get::<_, i64>(4)? as u16,
            latency_ms: row.get(5)?,
            client_ip: row.get(6)?,
        })
    };

    let limit = remaining as i64;
    let rows = match (min_status, pattern) {
        (Some(min), Some(pat)) => {
            stmt.query_map(params![min, pat, pat, pat, pat, pat, limit], map_row)?
        }
        (Some(min), None) => stmt.query_map(params![min, limit], map_row)?,
        (None, Some(pat)) => stmt.query_map(params![pat, pat, pat, pat, pat, limit], map_row)?,
        (None, None) => stmt.query_map(params![limit], map_row)?,
    };

    rows.collect()
}

fn get_row(conn: &Connection, shard: &str, id: i64) -> Result<Option<AuditDetail>, rusqlite::Error> {
    if !is_valid_shard_name(shard) {
        return Ok(None);
    }
    let kind: String = conn
        .query_row(
            "SELECT kind FROM audit_meta WHERE shard_name = ?1",
            params![shard],
            |row| row.get(0),
        )
        .optional()?
        .unwrap_or_else(|| {
            if shard.starts_with("audit_proxy_") {
                "proxy".to_string()
            } else {
                "api".to_string()
            }
        });

    let sql = format!(
        "SELECT ts_ms, method, path, status, latency_ms, client_ip, request_body, response_body
         FROM {shard} WHERE id = ?1"
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query(params![id])?;
    if let Some(row) = rows.next()? {
        return Ok(Some(AuditDetail {
            shard: shard.to_string(),
            id,
            ts_ms: row.get(0)?,
            method: row.get(1)?,
            path: row.get(2)?,
            kind,
            status: row.get::<_, i64>(3)? as u16,
            latency_ms: row.get(4)?,
            client_ip: row.get(5)?,
            request_body: row.get(6)?,
            response_body: row.get(7)?,
        }));
    }
    Ok(None)
}

fn is_valid_shard_name(shard: &str) -> bool {
    shard.starts_with("audit_proxy_") || shard.starts_with("audit_api_")
}

fn cleanup_old_shards(conn: &Connection, retention_days: u32) -> Result<(), rusqlite::Error> {
    let cutoff_ms = unix_ms() as i64 - i64::from(retention_days) * 86_400_000;
    let cutoff_ym = ym_from_ms(cutoff_ms);
    let mut stmt = conn.prepare("SELECT shard_name, ym FROM audit_meta")?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i32>(1)?))
    })?;
    for row in rows {
        let (shard, ym) = row?;
        if ym < cutoff_ym {
            conn.execute(&format!("DROP TABLE IF EXISTS {shard}"), [])?;
            conn.execute(
                "DELETE FROM audit_meta WHERE shard_name = ?1",
                params![shard],
            )?;
        }
    }
    Ok(())
}


fn unix_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

/// Year-month (YYYYMM) from UTC milliseconds using a civil-day algorithm.
pub fn ym_from_ms(ts_ms: i64) -> i32 {
    let days = ts_ms.div_euclid(86_400_000);
    let (year, month, _) = civil_from_days(days);
    year * 100 + month
}

fn civil_from_days(days: i64) -> (i32, i32, i32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    let year = y + if m <= 2 { 1 } else { 0 };
    (year as i32, m as i32, d as i32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ym_from_unix_epoch() {
        assert_eq!(ym_from_ms(0), 197001);
    }

    #[test]
    fn shard_name_format() {
        assert_eq!(shard_name(AuditKind::Proxy, 202505), "audit_proxy_202505");
    }

    #[test]
    fn list_page_search_binds_parameters() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("audit.db");
        let store = std::sync::Arc::new(AuditStore::open(db_path, 7).unwrap());
        let entry = CaptureEntry {
            kind: AuditKind::Proxy,
            ts_ms: 1_700_000_000_000,
            method: "POST".to_string(),
            path: "/bot***/sendMessage".to_string(),
            status: 200,
            latency_ms: 12,
            client_ip: "127.0.0.1".to_string(),
            request_body: Some("告警测试 body".to_string()),
            response_body: Some(r#"{"ok":true}"#.to_string()),
        };
        AuditStore::record(&store, entry);

        std::thread::sleep(std::time::Duration::from_millis(50));

        let page = store
            .list(1, 10, None, None, Some("告警测试"))
            .expect("search should not fail binding SQL parameters");
        assert_eq!(page.total, 1);
        assert_eq!(page.entries.len(), 1);
    }
}
