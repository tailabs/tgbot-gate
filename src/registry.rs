use std::{
    collections::HashSet,
    io,
    sync::{Arc, RwLock},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::db::GateDatabase;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BotRecord {
    pub token_hash: String,
    pub label: String,
    pub created_at: u64,
}

#[derive(Debug)]
pub struct BotRegistry {
    db: Arc<GateDatabase>,
    cache: RwLock<HashSet<String>>,
}

impl BotRegistry {
    pub fn open(db: Arc<GateDatabase>) -> io::Result<Self> {
        let bots = db.list_bots()?;
        let cache = bots.iter().map(|bot| bot.token_hash.clone()).collect();
        Ok(Self { db, cache: RwLock::new(cache) })
    }

    pub fn token_hash(token: &str) -> String {
        let digest = Sha256::digest(token.as_bytes());
        digest.iter().map(|byte| format!("{byte:02x}")).collect()
    }

    pub fn list(&self) -> Vec<BotRecord> {
        self.db.list_bots().unwrap_or_else(|error| {
            eprintln!("failed to list bots: {error}");
            Vec::new()
        })
    }

    pub fn contains_token(&self, token: &str) -> bool {
        self.contains_hash(&Self::token_hash(token))
    }

    pub fn contains_hash(&self, token_hash: &str) -> bool {
        self.cache.read().expect("registry cache lock poisoned").contains(token_hash)
    }

    pub fn add_token(&self, label: String, token: &str) -> io::Result<BotRecord> {
        let token_hash = Self::token_hash(token);
        let record = self.db.add_bot(label, token_hash.clone(), now_unix())?;
        self.cache.write().expect("registry cache lock poisoned").insert(token_hash);
        Ok(record)
    }

    pub fn delete_hash(&self, token_hash: &str) -> io::Result<bool> {
        let deleted = self.db.delete_bot(token_hash)?;
        if deleted {
            self.cache.write().expect("registry cache lock poisoned").remove(token_hash);
        }
        Ok(deleted)
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
    use crate::db::GateDatabase;

    #[test]
    fn hashes_tokens_stably() {
        assert_eq!(BotRegistry::token_hash("123:abc"), BotRegistry::token_hash("123:abc"));
        assert_ne!(BotRegistry::token_hash("123:abc"), BotRegistry::token_hash("456:def"));
    }

    #[test]
    fn stores_hash_without_raw_token() {
        let dir = tempfile::tempdir().unwrap();
        let db = Arc::new(GateDatabase::open(dir.path().join("gate.db")).unwrap());
        let registry = BotRegistry::open(db).unwrap();
        registry.add_token("test bot".to_string(), "123456:secret-token").unwrap();
        assert!(registry.contains_token("123456:secret-token"));
    }

    #[test]
    fn loads_cache_from_disk_and_deletes_hash() {
        let dir = tempfile::tempdir().unwrap();
        let db = Arc::new(GateDatabase::open(dir.path().join("gate.db")).unwrap());
        let registry = BotRegistry::open(db.clone()).unwrap();
        let record = registry.add_token("bot".to_string(), "token-one").unwrap();
        let reloaded = BotRegistry::open(db).unwrap();
        assert!(reloaded.contains_token("token-one"));
        assert!(reloaded.delete_hash(&record.token_hash).unwrap());
        assert!(!reloaded.contains_token("token-one"));
    }
}
