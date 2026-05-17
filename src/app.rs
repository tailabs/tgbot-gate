use std::sync::{Arc, RwLock};
use std::path::PathBuf;

use axum::{
    body::{to_bytes, Body},
    extract::{Path, Query, Request, State},
    middleware,
    http::{header, HeaderMap, HeaderValue, Method, StatusCode, Uri},
    response::{Html, IntoResponse, Response},
    routing::{delete, get, post, put},
    Json, Router,
};
use bytes::Bytes;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tokio::fs;
use tower_http::services::ServeDir;

use crate::{
    audit,
    auth::AdminAuth,
    registry::{BotRecord, BotRegistry},
    settings::{GateSettingsPatch, RuntimeSettings},
};

const SESSION_COOKIE: &str = "gate_session";

#[derive(Debug)]
pub struct AppState {
    registry: BotRegistry,
    auth: Arc<RwLock<AdminAuth>>,
    proxy: TelegramProxy,
    admin_dist_dir: PathBuf,
    pub settings: Arc<RuntimeSettings>,
}

impl AppState {
    pub fn new(
        registry: BotRegistry,
        auth: Arc<RwLock<AdminAuth>>,
        proxy: TelegramProxy,
        settings: Arc<RuntimeSettings>,
        admin_dist_dir: PathBuf,
    ) -> Self {
        Self {
            registry,
            auth,
            proxy,
            admin_dist_dir,
            settings,
        }
    }
}

#[derive(Debug, Clone)]
pub struct TelegramProxy {
    base_url: String,
    client: Client,
}

impl Default for TelegramProxy {
    fn default() -> Self {
        Self {
            base_url: "https://api.telegram.org".to_string(),
            client: Client::new(),
        }
    }
}

impl TelegramProxy {
    #[cfg(test)]
    pub fn with_base_url(base_url: String) -> Self {
        Self {
            base_url,
            client: Client::new(),
        }
    }
}

#[derive(Debug, Deserialize)]
struct LoginRequest {
    password: String,
}

#[derive(Debug, Serialize)]
struct BotsResponse {
    bots: Vec<BotRecord>,
}

#[derive(Debug, Deserialize)]
struct RegisterBotRequest {
    label: String,
    token: String,
}

pub fn router(state: Arc<AppState>) -> Router {
    let assets_dir = state.admin_dist_dir.join("assets");

    Router::new()
        .route("/", get(admin_page))
        .route("/admin", get(admin_page))
        .route("/healthz", get(healthz))
        .route("/api/login", post(login))
        .route("/api/session", get(session_check))
        .route("/api/bots", get(list_bots).post(register_bot))
        .route("/api/bots/{token_hash}", delete(delete_bot))
        .route("/api/settings", get(get_settings).put(update_settings))
        .route("/api/settings/password", put(change_password))
        .route("/api/audit/status", get(audit_status))
        .route("/api/audit", get(list_audit))
        .route("/api/audit/{shard}/{id}", get(get_audit))
        .nest_service("/assets", ServeDir::new(assets_dir))
        .fallback(proxy_or_not_found)
        .layer(middleware::from_fn_with_state(
            state.settings.clone(),
            audit::middleware,
        ))
        .with_state(state)
}



#[derive(Debug, Deserialize)]
struct AuditListQuery {
    page: Option<u32>,
    page_size: Option<u32>,
    kind: Option<String>,
    min_status: Option<u16>,
    q: Option<String>,
}


#[derive(Debug, Serialize)]
struct AuditStatusResponse {
    enabled: bool,
}

async fn get_settings(State(state): State<Arc<AppState>>, headers: HeaderMap) -> impl IntoResponse {
    if !is_authorized(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    Json(state.settings.public()).into_response()
}

async fn update_settings(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(patch): Json<GateSettingsPatch>,
) -> impl IntoResponse {
    if !is_authorized(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    match state.settings.update(patch) {
        Ok(settings) => Json(settings).into_response(),
        Err(error) if error.kind() == std::io::ErrorKind::InvalidInput => {
            (StatusCode::BAD_REQUEST, error.to_string()).into_response()
        }
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("failed to update settings: {error}"),
        )
            .into_response(),
    }
}

#[derive(Debug, Deserialize)]
struct ChangePasswordRequest {
    current_password: String,
    new_password: String,
}

async fn change_password(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<ChangePasswordRequest>,
) -> impl IntoResponse {
    if !is_authorized(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    if body.new_password.trim().len() < 8 {
        return (StatusCode::BAD_REQUEST, "new password must be at least 8 characters").into_response();
    }

    let mut auth = state.auth.write().expect("auth lock poisoned");
    if !auth.verify_password(&body.current_password) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let new_auth = AdminAuth::configured(body.new_password);
    if let Err(error) = state
        .settings
        .db_handle()
        .set_admin_password_hash(new_auth.stored_password_hash())
    {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("failed to persist password: {error}"),
        )
            .into_response();
    }
    *auth = new_auth;

    let mut response = StatusCode::NO_CONTENT.into_response();
    set_session_cookie(&mut response, auth.session_token());
    response
}

async fn audit_status(State(state): State<Arc<AppState>>, headers: HeaderMap) -> impl IntoResponse {
    if !is_authorized(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let snapshot = state.settings.audit_snapshot();
    Json(AuditStatusResponse {
        enabled: snapshot.store.is_some(),
    })
    .into_response()
}

async fn list_audit(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<AuditListQuery>,
) -> impl IntoResponse {
    if !is_authorized(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let Some(store) = state.settings.audit_snapshot().store else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            "audit capture is disabled; enable it in Settings",
        )
            .into_response();
    };

    let page = query.page.unwrap_or(1).max(1);
    let page_size = query.page_size.unwrap_or(20).clamp(1, 100);
    let kind = query.kind.as_deref();
    let search = query.q.as_deref().map(str::trim).filter(|value| !value.is_empty());
    match store.list(page, page_size, kind, query.min_status, search) {
        Ok(page) => Json(page).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("failed to list audit entries: {error}"),
        )
            .into_response(),
    }
}

async fn get_audit(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((shard, id)): Path<(String, i64)>,
) -> impl IntoResponse {
    if !is_authorized(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let Some(store) = state.settings.audit_snapshot().store else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            "audit capture is disabled; enable it in Settings",
        )
            .into_response();
    };

    match store.get(&shard, id) {
        Ok(Some(entry)) => Json(entry).into_response(),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("failed to load audit entry: {error}"),
        )
            .into_response(),
    }
}

async fn healthz() -> &'static str {
    "ok"
}

async fn admin_page(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match fs::read_to_string(state.admin_dist_dir.join("index.html")).await {
        Ok(html) => with_security_headers(Html(html).into_response()),
        Err(_) => (
            StatusCode::SERVICE_UNAVAILABLE,
            "admin UI is not built; run `pnpm install && pnpm run build` in admin/",
        )
            .into_response(),
    }
}

fn with_security_headers(mut response: Response) -> Response {
    let headers = response.headers_mut();
    headers.insert(
        header::HeaderName::from_static("content-security-policy"),
        HeaderValue::from_static(
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
        ),
    );
    headers.insert(
        header::HeaderName::from_static("x-content-type-options"),
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::HeaderName::from_static("referrer-policy"),
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        header::HeaderName::from_static("x-frame-options"),
        HeaderValue::from_static("DENY"),
    );
    response
}

async fn session_check(State(state): State<Arc<AppState>>, headers: HeaderMap) -> impl IntoResponse {
    if is_authorized(&state, &headers) {
        StatusCode::NO_CONTENT.into_response()
    } else {
        StatusCode::UNAUTHORIZED.into_response()
    }
}

async fn login(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<LoginRequest>,
) -> impl IntoResponse {
    let auth = state.auth.read().expect("auth lock poisoned");
    if !auth.verify_password(&payload.password) {
        return (StatusCode::UNAUTHORIZED, "invalid password").into_response();
    }

    let mut response = StatusCode::NO_CONTENT.into_response();
    set_session_cookie(&mut response, auth.session_token());
    response
}

fn set_session_cookie(response: &mut Response, token: &str) {
    let cookie = format!(
        "{SESSION_COOKIE}={token}; HttpOnly; SameSite=Strict; Path=/"
    );
    response.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_str(&cookie).expect("session cookie is valid"),
    );
}

async fn list_bots(State(state): State<Arc<AppState>>, headers: HeaderMap) -> impl IntoResponse {
    if !is_authorized(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    Json(BotsResponse {
        bots: state.registry.list(),
    })
    .into_response()
}

async fn register_bot(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<RegisterBotRequest>,
) -> impl IntoResponse {
    if !is_authorized(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    if payload.token.trim().is_empty() || payload.label.trim().is_empty() {
        return (StatusCode::BAD_REQUEST, "label and token are required").into_response();
    }

    match state
        .registry
        .add_token(payload.label.trim().to_string(), payload.token.trim())
    {
        Ok(record) => (StatusCode::CREATED, Json(record)).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("failed to persist bot: {error}"),
        )
            .into_response(),
    }
}

async fn delete_bot(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(token_hash): Path<String>,
) -> impl IntoResponse {
    if !is_authorized(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    match state.registry.delete_hash(&token_hash) {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => StatusCode::NOT_FOUND.into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("failed to persist bot: {error}"),
        )
            .into_response(),
    }
}

async fn proxy_or_not_found(State(state): State<Arc<AppState>>, request: Request) -> Response {
    let (parts, body) = request.into_parts();
    let uri = parts.uri;
    let method = parts.method;
    let headers = parts.headers;

    let Some(target) = parse_proxy_target(&uri) else {
        return StatusCode::NOT_FOUND.into_response();
    };

    if !state.registry.contains_token(&target.token) {
        return (StatusCode::FORBIDDEN, "bot token is not registered").into_response();
    }

    let body = match to_bytes(body, state.settings.max_proxy_body_bytes()).await {
        Ok(body) => body,
        Err(error) => {
            return (
                StatusCode::PAYLOAD_TOO_LARGE,
                format!("failed to read request body: {error}"),
            )
                .into_response();
        }
    };

    match state.proxy.forward(method, headers, body, target).await {
        Ok(response) => response,
        Err(error) => (
            StatusCode::BAD_GATEWAY,
            format!("telegram upstream request failed: {error}"),
        )
            .into_response(),
    }
}

fn is_authorized(state: &AppState, headers: &HeaderMap) -> bool {
    extract_session(headers)
        .map(|session| {
            state
                .auth
                .read()
                .expect("auth lock poisoned")
                .verify_session(session)
        })
        .unwrap_or(false)
}

fn extract_session(headers: &HeaderMap) -> Option<&str> {
    let cookies = headers.get(header::COOKIE)?.to_str().ok()?;

    cookies.split(';').find_map(|cookie| {
        let (name, value) = cookie.trim().split_once('=')?;
        (name == SESSION_COOKIE).then_some(value)
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ProxyTarget {
    token: String,
    method_path: String,
    query: Option<String>,
}

fn parse_proxy_target(uri: &Uri) -> Option<ProxyTarget> {
    let path = uri.path();
    let rest = path.strip_prefix("/bot")?;
    let (token, method_path) = rest.split_once('/')?;

    if token.is_empty() || method_path.is_empty() {
        return None;
    }

    Some(ProxyTarget {
        token: token.to_string(),
        method_path: method_path.to_string(),
        query: uri.query().map(ToOwned::to_owned),
    })
}

impl TelegramProxy {
    async fn forward(
        &self,
        method: Method,
        headers: HeaderMap,
        body: Bytes,
        target: ProxyTarget,
    ) -> Result<Response, reqwest::Error> {
        let mut url = format!(
            "{}/bot{}/{}",
            self.base_url.trim_end_matches('/'),
            target.token,
            target.method_path
        );

        if let Some(query) = target.query {
            url.push('?');
            url.push_str(&query);
        }

        let mut request = self.client.request(method, url).body(body);
        for (name, value) in headers.iter() {
            if !is_hop_by_hop_header(name) && name != header::HOST && name != header::COOKIE {
                request = request.header(name, value);
            }
        }

        let upstream = request.send().await?;
        let status = upstream.status();
        let mut builder = Response::builder().status(status);

        for (name, value) in upstream.headers() {
            if !is_hop_by_hop_header(name) && name != header::SET_COOKIE {
                builder = builder.header(name, value);
            }
        }

        let bytes = upstream.bytes().await?;
        Ok(builder
            .body(Body::from(bytes))
            .expect("upstream response can be built"))
    }
}

fn is_hop_by_hop_header(name: &header::HeaderName) -> bool {
    matches!(
        name.as_str(),
        "connection"
            | "keep-alive"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "te"
            | "trailer"
            | "transfer-encoding"
            | "upgrade"
            | "content-length"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use tower::ServiceExt;

    fn test_state() -> Arc<AppState> {
        let dir = tempfile::tempdir().unwrap();
        let db = Arc::new(crate::db::GateDatabase::open(dir.path().join("gate.db")).unwrap());
        let settings = RuntimeSettings::load(db.clone()).unwrap();
        Arc::new(AppState::new(
            BotRegistry::open(db).unwrap(),
            Arc::new(RwLock::new(AdminAuth::configured("admin-pass".to_string()))),
            TelegramProxy::with_base_url("http://127.0.0.1:1".to_string()),
            settings,
            PathBuf::from("admin/dist"),
        ))
    }

    #[test]
    fn parses_telegram_compatible_proxy_path() {
        let uri: Uri = "/bot123456:ABC/sendMessage?chat_id=1".parse().unwrap();
        let target = parse_proxy_target(&uri).unwrap();

        assert_eq!(target.token, "123456:ABC");
        assert_eq!(target.method_path, "sendMessage");
        assert_eq!(target.query.as_deref(), Some("chat_id=1"));
    }

    #[tokio::test]
    async fn health_check_returns_ok() {
        let response = router(test_state())
            .oneshot(
                Request::builder()
                    .uri("/healthz")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn admin_page_sets_security_headers() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("index.html"),
            "<!doctype html><div>admin</div>",
        )
        .unwrap();
        let db = Arc::new(crate::db::GateDatabase::open(dir.path().join("gate.db")).unwrap());
        let settings = RuntimeSettings::load(db.clone()).unwrap();
        let state = AppState::new(
            BotRegistry::open(db).unwrap(),
            Arc::new(RwLock::new(AdminAuth::configured("admin-pass".to_string()))),
            TelegramProxy::with_base_url("http://127.0.0.1:1".to_string()),
            settings,
            dir.path().to_path_buf(),
        );

        let response = router(Arc::new(state))
            .oneshot(
                Request::builder()
                    .uri("/admin")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert!(response
            .headers()
            .get(header::HeaderName::from_static("content-security-policy"))
            .is_some());
        assert_eq!(
            response
                .headers()
                .get(header::HeaderName::from_static("x-frame-options"))
                .unwrap(),
            "DENY"
        );
    }

    #[tokio::test]
    async fn login_sets_session_cookie_for_correct_password() {
        let response = router(test_state())
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/login")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(r#"{"password":"admin-pass"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        assert!(response.headers().get(header::SET_COOKIE).is_some());
    }

    #[tokio::test]
    async fn session_check_accepts_valid_cookie() {
        let state = test_state();
        let token = state.auth.read().unwrap().session_token().to_string();

        let response = router(state)
            .oneshot(
                Request::builder()
                    .uri("/api/session")
                    .header(header::COOKIE, format!("{SESSION_COOKIE}={token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NO_CONTENT);
    }

    #[tokio::test]
    async fn rejects_admin_api_without_session() {
        let response = router(test_state())
            .oneshot(
                Request::builder()
                    .uri("/api/bots")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn rejects_unregistered_proxy_before_upstream_call() {
        let response = router(test_state())
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/bot123456:ABC/sendMessage")
                    .body(Body::from("chat_id=1"))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = response.status();
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();

        assert_eq!(status, StatusCode::FORBIDDEN);
        assert!(String::from_utf8_lossy(&body).contains("not registered"));
    }
}
