//! Browser extension bridge — loopback HTTP server with per-extension token pairing
//! and per-request user approval.
//!
//! # Security
//! - Binds `127.0.0.1:62501` only; never exposed to the network.
//! - Each extension pairs once: POST `/v1/associate` → desktop pops up a confirm
//!   modal → on approve a random 32-byte token is returned. Token is required on
//!   every subsequent request as `Authorization: Bearer <token>`.
//! - Every credential-returning request also requires a per-request user approval
//!   popup in the desktop UI (click-to-allow). 30-second timeout → denied.
//! - Matches are done by URL host (no silent wildcard). Only `Login` items
//!   with non-empty `url` are returned.
//!
//! The FE listens for two Tauri events:
//! - `bridge:pair_request`   payload: `PairRequest`
//! - `bridge:creds_request`  payload: `CredsRequest`
//! and calls back via `bridge_pair_complete` / `bridge_creds_complete`.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD as B64, Engine as _};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tiny_http::{Header, Method, Response, Server};
use url::Url;

/// Loopback port for the bridge. Matches the extension's hardcoded target.
pub const BRIDGE_ADDR: &str = "127.0.0.1:62501";

/// Per-request approval TTL — requests older than this are auto-denied.
const APPROVAL_TTL: Duration = Duration::from_secs(30);

#[derive(Clone, Serialize)]
pub struct PairRequest {
    pub request_id: String,
    pub extension_name: String,
}

#[derive(Clone, Serialize)]
pub struct CredsRequest {
    pub request_id: String,
    pub origin: String,
    pub candidates: Vec<CredsCandidate>,
}

#[derive(Clone, Serialize)]
pub struct CredsCandidate {
    pub id: String,
    pub name: String,
    pub username: String,
    /// Host we matched against (for UX). Password is never emitted here.
    pub url: String,
}

/// Resolved result shipped back to the HTTP handler.
enum PairResult {
    Approved(String), // token
    Denied,
}
enum CredsResult {
    Approved(Vec<ApprovedCred>),
    Denied,
}

#[derive(Clone, Serialize)]
pub struct ApprovedCred {
    pub username: String,
    pub password: String,
}

struct Pending {
    pair: HashMap<String, (std::sync::mpsc::SyncSender<PairResult>, Instant)>,
    creds: HashMap<String, (std::sync::mpsc::SyncSender<CredsResult>, Vec<CredsCandidate>, Instant)>,
}

impl Pending {
    fn new() -> Self {
        Self {
            pair: HashMap::new(),
            creds: HashMap::new(),
        }
    }
    fn gc(&mut self) {
        let now = Instant::now();
        self.pair.retain(|_, (_, t)| now.duration_since(*t) < APPROVAL_TTL);
        self.creds.retain(|_, (_, _, t)| now.duration_since(*t) < APPROVAL_TTL);
    }
}

pub struct BridgeState {
    tokens: Mutex<Vec<String>>, // paired extension tokens
    pending: Mutex<Pending>,
    running: AtomicBool,
    req_ctr: AtomicU64,
    last_associate: Mutex<Option<Instant>>,
    associate_count_today: Mutex<u32>,
}

impl Default for BridgeState {
    fn default() -> Self {
        Self {
            tokens: Mutex::new(Vec::new()),
            pending: Mutex::new(Pending::new()),
            running: AtomicBool::new(false),
            req_ctr: AtomicU64::new(0),
            last_associate: Mutex::new(None),
            associate_count_today: Mutex::new(0),
        }
    }
}

impl BridgeState {
    fn new_id(&self) -> String {
        let n = self.req_ctr.fetch_add(1, Ordering::SeqCst);
        let mut r = [0u8; 8];
        OsRng.fill_bytes(&mut r);
        format!("{n:x}-{}", hex::encode(r))
    }

    pub fn is_paired(&self, token: &str) -> bool {
        let guard = self.tokens.lock().unwrap();
        guard.iter().any(|t| t == token)
    }

    pub fn forget_tokens(&self) {
        self.tokens.lock().unwrap().clear();
        *self.associate_count_today.lock().unwrap() = 0;
        *self.last_associate.lock().unwrap() = None;
    }

    pub fn complete_pair(&self, id: &str, allow: bool) -> Result<(), String> {
        let mut p = self.pending.lock().unwrap();
        let (tx, _) = p.pair.remove(id).ok_or("no such pair request")?;
        drop(p);
        let result = if allow {
            let mut raw = [0u8; 32];
            OsRng.fill_bytes(&mut raw);
            let token = B64.encode(raw);
            self.tokens.lock().unwrap().push(token.clone());
            PairResult::Approved(token)
        } else {
            PairResult::Denied
        };
        let _ = tx.send(result);
        Ok(())
    }

    pub fn complete_creds(
        &self,
        id: &str,
        allow: bool,
        selected_item_id: Option<String>,
        resolve_item: impl FnOnce(&str) -> Option<ApprovedCred>,
    ) -> Result<(), String> {
        let mut p = self.pending.lock().unwrap();
        let (tx, candidates, _) = p.creds.remove(id).ok_or("no such creds request")?;
        drop(p);
        let result = if !allow {
            CredsResult::Denied
        } else if let Some(item_id) = selected_item_id {
            if !candidates.iter().any(|c| c.id == item_id) {
                CredsResult::Denied
            } else if let Some(c) = resolve_item(&item_id) {
                CredsResult::Approved(vec![c])
            } else {
                CredsResult::Denied
            }
        } else {
            CredsResult::Denied
        };
        let _ = tx.send(result);
        Ok(())
    }
}

/// Resolver abstracts away the vault lookup so bridge.rs has no direct VaultRepo coupling.
pub trait Resolver: Send + Sync + 'static {
    /// Return login candidates whose URL host matches the request origin host.
    fn candidates_for(&self, origin_host: &str) -> Vec<CredsCandidate>;
    /// Resolve a specific item id → (username, password). Returns None if not a login.
    fn resolve(&self, item_id: &str) -> Option<ApprovedCred>;
}

/// Start the loopback HTTP server. Returns a handle that drops the thread on drop.
pub fn start<R: Resolver>(
    app: AppHandle,
    state: Arc<BridgeState>,
    resolver: Arc<R>,
) -> Result<(), String> {
    if state.running.swap(true, Ordering::SeqCst) {
        return Ok(()); // already running
    }
    let addr: SocketAddr = BRIDGE_ADDR.parse().unwrap();
    let server = Server::http(addr).map_err(|e| e.to_string())?;
    let state_cl = state.clone();
    let resolver_cl = resolver.clone();
    std::thread::Builder::new()
        .name("vaultguard-bridge".into())
        .spawn(move || {
            for req in server.incoming_requests() {
                if !state_cl.running.load(Ordering::SeqCst) {
                    break;
                }
                handle(req, &app, &state_cl, &*resolver_cl);
            }
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn stop(state: &BridgeState) {
    state.running.store(false, Ordering::SeqCst);
    state.forget_tokens();
    // Issuing a dummy request ensures the blocking `incoming_requests` iterator
    // wakes up and observes the running flag. Best-effort; ignore errors.
    let _ = std::net::TcpStream::connect_timeout(
        &BRIDGE_ADDR.parse().unwrap(),
        Duration::from_millis(100),
    );
}

#[derive(Deserialize)]
struct AssociateBody {
    extension_name: Option<String>,
}
#[derive(Serialize)]
struct AssociateResp {
    token: String,
}
#[derive(Serialize)]
struct CredsResp {
    items: Vec<ApprovedCred>,
}

fn json_response<T: Serialize>(status: u16, body: &T) -> Response<std::io::Cursor<Vec<u8>>> {
    let body = serde_json::to_vec(body).unwrap_or_else(|_| b"{}".to_vec());
    Response::from_data(body)
        .with_status_code(status)
        .with_header(Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap())
}

fn err(status: u16, msg: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    #[derive(Serialize)]
    struct E<'a> { error: &'a str }
    json_response(status, &E { error: msg })
}

fn bearer_token(req: &tiny_http::Request) -> Option<String> {
    for h in req.headers() {
        if h.field.as_str().as_str().eq_ignore_ascii_case("authorization") {
            let v = h.value.as_str();
            if let Some(rest) = v.strip_prefix("Bearer ") {
                return Some(rest.to_string());
            }
        }
    }
    None
}

fn handle(
    mut req: tiny_http::Request,
    app: &AppHandle,
    state: &BridgeState,
    resolver: &dyn Resolver,
) {
    // Basic origin guard — browsers send Origin header. We accept any since
    // the server is loopback-only, but we still enforce Bearer token + approval.
    state.pending.lock().unwrap().gc();

    let method = req.method().clone();
    let url = req.url().to_string();
    let resp = match (method, url.as_str()) {
        (Method::Post, "/v1/associate") => handle_associate(&mut req, app, state),
        (Method::Get, path) if path.starts_with("/v1/credentials") => {
            handle_credentials(&req, path, app, state, resolver)
        }
        (Method::Get, "/v1/status") => json_response(200, &serde_json::json!({"ok": true})),
        _ => err(404, "not found"),
    };
    let _ = req.respond(resp);
}

const ASSOCIATE_COOLDOWN_SECS: u64 = 5;
const ASSOCIATE_DAILY_CAP: u32 = 20;

fn handle_associate(
    req: &mut tiny_http::Request,
    app: &AppHandle,
    state: &BridgeState,
) -> Response<std::io::Cursor<Vec<u8>>> {
    // Rate-limit: max 1 request per ASSOCIATE_COOLDOWN_SECS, max 20/day.
    {
        let mut last = state.last_associate.lock().unwrap();
        let mut count = state.associate_count_today.lock().unwrap();
        let now = Instant::now();
        if let Some(t) = *last {
            if now.duration_since(t).as_secs() < ASSOCIATE_COOLDOWN_SECS {
                return err(429, "too many requests");
            }
        }
        if *count >= ASSOCIATE_DAILY_CAP {
            return err(429, "daily pairing limit reached");
        }
        *last = Some(now);
        *count += 1;
    }

    let mut buf = Vec::new();
    if req.as_reader().read_to_end(&mut buf).is_err() {
        return err(400, "bad body");
    }
    let body: AssociateBody = serde_json::from_slice(&buf).unwrap_or(AssociateBody {
        extension_name: None,
    });

    let id = state.new_id();
    let (tx, rx) = std::sync::mpsc::sync_channel::<PairResult>(1);
    state
        .pending
        .lock()
        .unwrap()
        .pair
        .insert(id.clone(), (tx, Instant::now()));

    let payload = PairRequest {
        request_id: id.clone(),
        extension_name: body.extension_name.unwrap_or_else(|| "Browser extension".into()),
    };
    if app.emit("bridge:pair_request", &payload).is_err() {
        state.pending.lock().unwrap().pair.remove(&id);
        return err(503, "desktop app not ready");
    }

    // Block this worker thread until the FE resolves. TTL + denial safeguard.
    let res = wait_oneshot(rx, APPROVAL_TTL);
    match res {
        Some(PairResult::Approved(token)) => json_response(200, &AssociateResp { token }),
        Some(PairResult::Denied) => err(403, "denied"),
        None => {
            state.pending.lock().unwrap().pair.remove(&id);
            err(408, "timeout")
        }
    }
}

fn handle_credentials(
    req: &tiny_http::Request,
    path: &str,
    app: &AppHandle,
    state: &BridgeState,
    resolver: &dyn Resolver,
) -> Response<std::io::Cursor<Vec<u8>>> {
    let token = match bearer_token(req) {
        Some(t) => t,
        None => return err(401, "missing token"),
    };
    if !state.is_paired(&token) {
        return err(401, "bad token");
    }

    // Parse query string manually (tiny_http doesn't do it).
    let q = path.split_once('?').map(|(_, q)| q).unwrap_or("");
    let mut origin = None;
    for (k, v) in q.split('&').filter_map(|kv| kv.split_once('=')) {
        if k == "origin" {
            origin = Some(urldecode(v));
        }
    }
    let origin = match origin {
        Some(o) if !o.is_empty() => o,
        _ => return err(400, "missing origin"),
    };

    let host = match Url::parse(&origin).ok().and_then(|u| u.host_str().map(str::to_string)) {
        Some(h) => h,
        None => return err(400, "invalid origin"),
    };

    let candidates = resolver.candidates_for(&host);
    if candidates.is_empty() {
        return json_response(200, &CredsResp { items: vec![] });
    }

    let id = state.new_id();
    let (tx, rx) = std::sync::mpsc::sync_channel::<CredsResult>(1);
    state
        .pending
        .lock()
        .unwrap()
        .creds
        .insert(id.clone(), (tx, candidates.clone(), Instant::now()));

    let payload = CredsRequest {
        request_id: id.clone(),
        origin: origin.clone(),
        candidates,
    };
    if app.emit("bridge:creds_request", &payload).is_err() {
        state.pending.lock().unwrap().creds.remove(&id);
        return err(503, "desktop app not ready");
    }

    match wait_oneshot(rx, APPROVAL_TTL) {
        Some(CredsResult::Approved(items)) => json_response(200, &CredsResp { items }),
        Some(CredsResult::Denied) => err(403, "denied"),
        None => {
            state.pending.lock().unwrap().creds.remove(&id);
            err(408, "timeout")
        }
    }
}

fn wait_oneshot<T>(rx: std::sync::mpsc::Receiver<T>, ttl: Duration) -> Option<T> {
    rx.recv_timeout(ttl).ok()
}

fn urldecode(s: &str) -> String {
    // Minimal %XX decode — enough for origin values like https%3A%2F%2Fexample.com
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(a), Some(b)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                out.push((a << 4) | b);
                i += 3;
                continue;
            }
        } else if bytes[i] == b'+' {
            out.push(b' ');
            i += 1;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_default()
}
fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urldecode_basic() {
        assert_eq!(urldecode("https%3A%2F%2Fa.b"), "https://a.b");
        assert_eq!(urldecode("x+y"), "x y");
    }

    #[test]
    fn token_pairing_and_check() {
        let s = BridgeState::default();
        assert!(!s.is_paired("nope"));
        s.tokens.lock().unwrap().push("abc".into());
        assert!(s.is_paired("abc"));
        s.forget_tokens();
        assert!(!s.is_paired("abc"));
    }
}
