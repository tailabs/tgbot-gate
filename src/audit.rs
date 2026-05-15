use std::{
    io::{self, Write},
    time::Instant,
};

use axum::{
    extract::Request,
    http::HeaderMap,
    middleware::Next,
    response::Response,
};
use serde::Serialize;

const AUDIT_PREFIX: &str = "audit";


pub fn enabled() -> bool {
    #[cfg(test)]
    {
        return false;
    }

    match std::env::var("AUDIT_LOG") {
        Ok(value) => {
            let value = value.trim().to_ascii_lowercase();
            value != "0" && value != "false" && value != "off" && value != "no"
        }
        Err(_) => true,
    }
}

pub fn emit_startup_notice() {
    if enabled() {
        println!("{AUDIT_PREFIX}: request logging enabled (set AUDIT_LOG=0 to disable)");
        let _ = io::stdout().flush();
    }
}

#[derive(Debug, Serialize)]
struct AuditRecord<'a> {
    ts_ms: u128,
    method: &'a str,
    path: &'a str,
    kind: &'a str,
    status: u16,
    latency_ms: u128,
    client_ip: &'a str,
}

pub async fn log_request(request: Request, next: Next) -> Response {
    let audit_on = enabled();
    let method = request.method().as_str().to_owned();
    let path = redact_path(request.uri().path());
    let kind = route_kind(request.uri().path()).to_owned();
    let client_ip = client_ip(request.headers()).to_owned();
    let started = Instant::now();

    let response = next.run(request).await;
    let record = AuditRecord {
        ts_ms: unix_ms(),
        method: &method,
        path: &path,
        kind: &kind,
        status: response.status().as_u16(),
        latency_ms: started.elapsed().as_millis(),
        client_ip: &client_ip,
    };
    if audit_on {
        if let Ok(line) = serde_json::to_string(&record) {
            let mut out = io::stdout().lock();
            let _ = writeln!(out, "{AUDIT_PREFIX} {line}");
            let _ = out.flush();
        }
    }
    response
}

fn unix_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn route_kind(path: &str) -> &'static str {
    if path == "/healthz" {
        "health"
    } else if path.starts_with("/bot") {
        "proxy"
    } else if path.starts_with("/api/") {
        "api"
    } else if path == "/" || path == "/admin" || path.starts_with("/assets/") {
        "admin"
    } else {
        "other"
    }
}

fn redact_path(path: &str) -> String {
    let Some(rest) = path.strip_prefix("/bot") else {
        return path.to_string();
    };

    let Some((token, method_path)) = rest.split_once('/') else {
        return "/bot***".to_string();
    };

    if token.is_empty() || method_path.is_empty() {
        return "/bot***".to_string();
    }

    format!("/bot***/{method_path}")
}

fn client_ip(headers: &HeaderMap) -> &str {
    if let Some(value) = headers.get("x-forwarded-for") {
        if let Ok(forwarded) = value.to_str() {
            if let Some(ip) = forwarded.split(',').next().map(str::trim).filter(|ip| !ip.is_empty())
            {
                return ip;
            }
        }
    }

    headers
        .get("x-real-ip")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("-")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_bot_token_in_proxy_path() {
        assert_eq!(
            redact_path("/bot123456:ABC/sendMessage"),
            "/bot***/sendMessage"
        );
    }

    #[test]
    fn leaves_admin_paths_unchanged() {
        assert_eq!(redact_path("/api/bots"), "/api/bots");
        assert_eq!(redact_path("/api/login"), "/api/login");
    }

    #[test]
    fn classifies_routes() {
        assert_eq!(route_kind("/healthz"), "health");
        assert_eq!(route_kind("/bot1:ABC/getMe"), "proxy");
        assert_eq!(route_kind("/api/login"), "api");
    }
}
