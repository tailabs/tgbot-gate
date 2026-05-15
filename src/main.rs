mod app;
mod audit;
mod auth;
mod registry;

use std::{env, net::SocketAddr, path::PathBuf, sync::Arc};

use app::{AppState, TelegramProxy};
use auth::AdminAuth;
use registry::BotRegistry;
use tokio::net::TcpListener;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let port = env::var("PORT").unwrap_or_else(|_| "8080".to_string());
    let data_path = env::var("DATA_PATH").unwrap_or_else(|_| "data/bots.json".to_string());
    let admin_password = env::var("ADMIN_PASSWORD").ok();

    let auth = match admin_password {
        Some(password) if !password.trim().is_empty() => AdminAuth::configured(password),
        Some(_) => {
            return Err("ADMIN_PASSWORD must not be empty".into());
        }
        None => {
            let (auth, password) = AdminAuth::generated();
            println!("ADMIN_PASSWORD was not set. Generated admin password: {password}");
            auth
        }
    };

    let registry = BotRegistry::load_or_create(PathBuf::from(data_path))?;
    let state = AppState::new(registry, auth, TelegramProxy::default());
    let router = app::router(Arc::new(state));
    let addr: SocketAddr = format!("0.0.0.0:{port}").parse()?;
    let listener = TcpListener::bind(addr).await?;

    println!("tgbot-gate listening on {addr}");
    axum::serve(listener, router).await?;
    Ok(())
}
