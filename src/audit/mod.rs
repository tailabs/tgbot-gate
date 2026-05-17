mod store;

use std::{
    io::{self, Write},
    sync::Arc,
    time::Instant,
};

use axum::{
    body::{to_bytes, Body},
    extract::{Request, State},
    http::HeaderMap,
    middleware::Next,
    response::Response,
};
use bytes::Bytes;

use crate::settings::{GateSettings, RuntimeSettings};
use serde::Serialize;

pub use store::{AuditKind, AuditStore, CaptureEntry};

const AUDIT_PREFIX: &str = "audit";

pub fn emit_startup_notice(settings: &GateSettings, capture_active: bool) {
    if settings.audit_log {
        println!("{AUDIT_PREFIX}: stdout JSON logging enabled (disable in Settings)");
        let _ = io::stdout().flush();
    }
    if capture_active {
        println!(
            "{AUDIT_PREFIX}: SQLite capture enabled (retention {} days)",
            settings.audit_retention_days
        );
    } else if settings.audit_capture {
        eprintln!("{AUDIT_PREFIX}: audit capture requested but store is unavailable");
    } else {
        println!("{AUDIT_PREFIX}: SQLite capture disabled (enable in Settings)");
    }
}

#[derive(Debug, Serialize)]
struct StdoutRecord<'a> {
    ts_ms: u128,
    method: &'a str,
    path: &'a str,
    kind: &'a str,
    status: u16,
    latency_ms: u128,
    client_ip: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    request_body: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    response_body: Option<&'a str>,
}

pub fn is_telegram_proxy_path(path: &str) -> bool {
    path.starts_with("/bot")
}

pub async fn middleware(
    State(settings): State<Arc<RuntimeSettings>>,
    request: Request,
    next: Next,
) -> Response {
    let path_raw = request.uri().path().to_string();
    if !is_telegram_proxy_path(&path_raw) {
        return next.run(request).await;
    }

    let audit = settings.audit_snapshot();
    let method = request.method().as_str().to_owned();
    let path_redacted = redact_path(&path_raw);
    let client_ip = client_ip(request.headers()).to_owned();
    let started = Instant::now();

    let (request, req_body_log) = {
        let (parts, body) = request.into_parts();
        let bytes = match to_bytes(body, audit.max_body_bytes).await {
            Ok(bytes) => bytes,
            Err(_) => Bytes::new(),
        };
        let text = body_preview(&bytes, audit.max_body_bytes);
        let text = text.map(|value| redact_body(&value));
        let rebuilt = Request::from_parts(parts, Body::from(bytes));
        (rebuilt, text)
    };

    let response = next.run(request).await;
    let status = response.status().as_u16();
    let latency_ms = started.elapsed().as_millis();

    let (response, resp_body_log) = {
        let (parts, body) = response.into_parts();
        let bytes = match to_bytes(body, audit.max_body_bytes).await {
            Ok(bytes) => bytes,
            Err(_) => Bytes::new(),
        };
        let text = body_preview(&bytes, audit.max_body_bytes);
        let text = text.map(|value| redact_body(&value));
        let rebuilt = Response::from_parts(parts, Body::from(bytes));
        (rebuilt, text)
    };

    let record = StdoutRecord {
        ts_ms: unix_ms(),
        method: &method,
        path: &path_redacted,
        kind: "proxy",
        status,
        latency_ms,
        client_ip: &client_ip,
        request_body: req_body_log.as_deref(),
        response_body: resp_body_log.as_deref(),
    };

    if audit.stdout_log {
        if let Ok(line) = serde_json::to_string(&record) {
            let mut out = io::stdout().lock();
            let _ = writeln!(out, "{AUDIT_PREFIX} {line}");
            let _ = out.flush();
        }
    }

    let should_capture =
        audit.store.is_some() && (!audit.errors_only || status >= 400);

    if should_capture {
        if let Some(store) = &audit.store {
            store.record(CaptureEntry {
                kind: AuditKind::Proxy,
                ts_ms: record.ts_ms as i64,
                method,
                path: path_redacted,
                status,
                latency_ms,
                client_ip,
                request_body: req_body_log,
                response_body: resp_body_log,
            });
        }
    }

    response
}

fn body_preview(bytes: &Bytes, max: usize) -> Option<String> {
    if bytes.is_empty() {
        return None;
    }
    let slice = if bytes.len() > max {
        &bytes[..max]
    } else {
        bytes.as_ref()
    };
    Some(String::from_utf8_lossy(slice).into_owned())
}

pub fn redact_path(path: &str) -> String {
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

pub fn redact_body(body: &str) -> String {
    let mut out = body.to_string();
    if let Ok(mut value) = serde_json::from_str::<serde_json::Value>(body) {
        redact_json_secrets(&mut value);
        if let Ok(text) = serde_json::to_string(&value) {
            out = text;
        }
    }
    out = redact_bot_tokens_in_text(&out);
    if body.contains("password") {
        out = redact_json_field_literal(&out, "password");
    }
    out
}

fn redact_json_secrets(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(map) => {
            for (key, item) in map.iter_mut() {
                if key.eq_ignore_ascii_case("password")
                    || key.eq_ignore_ascii_case("token")
                    || key.contains("secret")
                {
                    *item = serde_json::Value::String("***".to_string());
                } else {
                    redact_json_secrets(item);
                }
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                redact_json_secrets(item);
            }
        }
        _ => {}
    }
}

fn redact_json_field_literal(body: &str, field: &str) -> String {
    let pattern = format!("\"{field}\":");
    if let Some(start) = body.find(&pattern) {
        let value_start = start + pattern.len();
        let rest = body[value_start..].trim_start();
        if rest.starts_with('"') {
            if let Some(end) = rest[1..].find('"') {
                let mut out = String::new();
                out.push_str(&body[..value_start]);
                out.push_str(" \"***\"");
                out.push_str(&rest[1 + end + 1..]);
                return out;
            }
        }
    }
    body.to_string()
}

fn redact_bot_tokens_in_text(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = String::with_capacity(input.len());
    let mut i = 0;
    while i < bytes.len() {
        if i + 4 <= bytes.len() && &bytes[i..i + 4] == b"/bot" {
            out.push_str("/bot***");
            i += 4;
            while i < bytes.len() && bytes[i] != b'/' && !bytes[i].is_ascii_whitespace() {
                i += 1;
            }
            continue;
        }

        if bytes[i].is_ascii_digit() {
            let start = i;
            while i < bytes.len() && bytes[i].is_ascii_digit() {
                i += 1;
            }
            if i < bytes.len() && bytes[i] == b':' {
                let secret_start = i + 1;
                let mut j = secret_start;
                while j < bytes.len() {
                    let b = bytes[j];
                    if b.is_ascii_alphanumeric() || b == b'_' || b == b'-' {
                        j += 1;
                    } else {
                        break;
                    }
                }
                if j > secret_start && j - start >= 10 {
                    out.push_str("***:***");
                    i = j;
                    continue;
                }
            }
            out.push_str(&input[start..i]);
            continue;
        }

        let ch = input[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

fn unix_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
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
    fn redacts_login_password_in_json() {
        let body = r#"{"password":"secret"}"#;
        let redacted = redact_body(body);
        assert!(!redacted.contains("secret"));
    }

    #[test]
    fn detects_telegram_proxy_paths() {
        assert!(is_telegram_proxy_path("/bot1:ABC/getMe"));
        assert!(!is_telegram_proxy_path("/api/login"));
        assert!(!is_telegram_proxy_path("/healthz"));
        assert!(!is_telegram_proxy_path("/admin"));
    }
}
