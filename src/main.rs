mod app;
mod audit;
mod auth;
mod db;
mod registry;
mod settings;

use std::{env, net::SocketAddr, path::PathBuf, sync::Arc};

use app::{AppState, TelegramProxy};
use auth::AdminAuth;
use db::{gate_db_path, GateDatabase};
use registry::BotRegistry;
use settings::RuntimeSettings;
use tokio::net::TcpListener;

fn load_auth(
    database: &GateDatabase,
    admin_password: Option<String>,
) -> Result<AdminAuth, Box<dyn std::error::Error>> {
    match admin_password {
        Some(password) if !password.trim().is_empty() => {
            let auth = AdminAuth::configured(password);
            database.set_admin_password_hash(auth.stored_password_hash())?;
            Ok(auth)
        }
        _ => {
            if let Some(hash) = database.get_admin_password_hash()? {
                return Ok(AdminAuth::from_stored_hash(hash));
            }
            let (auth, password) = AdminAuth::generated();
            database.set_admin_password_hash(auth.stored_password_hash())?;
            println!("ADMIN_PASSWORD was not set. Generated admin password: {password}");
            Ok(auth)
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let port = env::var("PORT").unwrap_or_else(|_| "8080".to_string());
    let legacy_data_path = env::var("DATA_PATH").unwrap_or_else(|_| "data/bots.json".to_string());
    let admin_password = env::var("ADMIN_PASSWORD").ok();

    let legacy_path = PathBuf::from(&legacy_data_path);
    let gate_path = gate_db_path(legacy_path.as_path());
    let database = Arc::new(GateDatabase::open(gate_path)?);
    match database.migrate_legacy_bots_json(legacy_path.as_path()) {
        Ok(count) if count > 0 => {
            println!("migrated {count} bot(s) from legacy {}", legacy_path.display());
        }
        Ok(_) => {}
        Err(error) => eprintln!("legacy bots.json migration skipped: {error}"),
    }
    let auth = Arc::new(std::sync::RwLock::new(load_auth(database.as_ref(), admin_password)?));
    let settings = RuntimeSettings::load(database.clone())?;
    let registry = BotRegistry::open(database)?;
    let state = Arc::new(AppState::new(
        registry,
        auth,
        TelegramProxy::default(),
        settings.clone(),
        env::var("ADMIN_DIST_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("admin/dist")),
    ));
    settings.emit_startup_notice();
    let router = app::router(state);
    let addr: SocketAddr = format!("0.0.0.0:{port}").parse()?;
    let listener = TcpListener::bind(addr).await?;

    println!("tgbot-gate listening on {addr}");
    axum::serve(listener, router).await?;
    Ok(())
}
