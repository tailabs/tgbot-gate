use std::{
    collections::HashSet,
    fs, io,
    path::PathBuf,
    sync::RwLock,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BotRecord {
    pub token_hash: String,
    pub label: String,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct RegistryFile {
    bots: Vec<BotRecord>,
}

#[derive(Debug)]
pub struct BotRegistry {
    path: PathBuf,
    inner: RwLock<RegistryFile>,
    cache: RwLock<HashSet<String>>,
}

impl BotRegistry {
    pub fn load_or_create(path: PathBuf) -> io::Result<Self> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }

        if !path.exists() {
            fs::write(
                &path,
                serde_json::to_vec_pretty(&RegistryFile::default()).map_err(io::Error::other)?,
            )?;
        }

        let bytes = fs::read(&path)?;
        let inner: RegistryFile = serde_json::from_slice(&bytes).map_err(io::Error::other)?;
        let cache = inner
            .bots
            .iter()
            .map(|bot| bot.token_hash.clone())
            .collect();

        Ok(Self {
            path,
            inner: RwLock::new(inner),
            cache: RwLock::new(cache),
        })
    }

    pub fn token_hash(token: &str) -> String {
        let digest = Sha256::digest(token.as_bytes());
        digest.iter().map(|byte| format!("{byte:02x}")).collect()
    }

    pub fn list(&self) -> Vec<BotRecord> {
        self.inner
            .read()
            .expect("registry lock poisoned")
            .bots
            .clone()
    }

    pub fn contains_token(&self, token: &str) -> bool {
        let token_hash = Self::token_hash(token);
        self.contains_hash(&token_hash)
    }

    pub fn contains_hash(&self, token_hash: &str) -> bool {
        self.cache
            .read()
            .expect("registry cache lock poisoned")
            .contains(token_hash)
    }

    pub fn add_token(&self, label: String, token: &str) -> io::Result<BotRecord> {
        let token_hash = Self::token_hash(token);
        let mut inner = self.inner.write().expect("registry lock poisoned");

        if let Some(existing) = inner.bots.iter().find(|bot| bot.token_hash == token_hash) {
            return Ok(existing.clone());
        }

        let record = BotRecord {
            token_hash: token_hash.clone(),
            label,
            created_at: now_unix(),
        };
        inner.bots.push(record.clone());
        self.persist(&inner)?;
        self.cache
            .write()
            .expect("registry cache lock poisoned")
            .insert(token_hash);

        Ok(record)
    }

    pub fn delete_hash(&self, token_hash: &str) -> io::Result<bool> {
        let mut inner = self.inner.write().expect("registry lock poisoned");
        let original_len = inner.bots.len();
        inner.bots.retain(|bot| bot.token_hash != token_hash);
        let deleted = inner.bots.len() != original_len;

        if deleted {
            self.persist(&inner)?;
            self.cache
                .write()
                .expect("registry cache lock poisoned")
                .remove(token_hash);
        }

        Ok(deleted)
    }

    fn persist(&self, inner: &RegistryFile) -> io::Result<()> {
        let bytes = serde_json::to_vec_pretty(inner).map_err(io::Error::other)?;
        let tmp_path = self.path.with_extension("json.tmp");
        fs::write(&tmp_path, bytes)?;
        fs::rename(tmp_path, &self.path)
    }
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time before unix epoch")
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashes_tokens_stably() {
        assert_eq!(
            BotRegistry::token_hash("123:abc"),
            BotRegistry::token_hash("123:abc")
        );
        assert_ne!(
            BotRegistry::token_hash("123:abc"),
            BotRegistry::token_hash("456:def")
        );
    }

    #[test]
    fn stores_hash_without_raw_token() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bots.json");
        let registry = BotRegistry::load_or_create(path.clone()).unwrap();

        registry
            .add_token("test bot".to_string(), "123456:secret-token")
            .unwrap();

        let stored = fs::read_to_string(path).unwrap();
        assert!(stored.contains("test bot"));
        assert!(!stored.contains("123456:secret-token"));
        assert!(registry.contains_token("123456:secret-token"));
    }

    #[test]
    fn loads_cache_from_disk_and_deletes_hash() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bots.json");
        let registry = BotRegistry::load_or_create(path.clone()).unwrap();
        let record = registry.add_token("bot".to_string(), "token-one").unwrap();

        let reloaded = BotRegistry::load_or_create(path).unwrap();
        assert!(reloaded.contains_token("token-one"));
        assert!(reloaded.delete_hash(&record.token_hash).unwrap());
        assert!(!reloaded.contains_token("token-one"));
    }

    #[test]
    fn rejects_corrupt_registry_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bots.json");
        fs::write(&path, b"not-json").unwrap();

        let error = BotRegistry::load_or_create(path).unwrap_err();

        assert_eq!(error.kind(), io::ErrorKind::Other);
    }
}
