//! Tauri command surface.
//!
//! Design: commands take `State<Mutex<AppState>>`, never return raw secrets
//! except by explicit caller request. All errors are stringified at the boundary.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use psl::Psl as _;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

use std::path::PathBuf as StdPathBuf;

use crate::autofill;
use crate::bridge::{self, ApprovedCred, BridgeState, CredsCandidate, Resolver};
use crate::clipboard;
use crate::crypto::DEFAULT_KDF;
use crate::export::{export_to_file, import_from_file, ImportReport, ImportStrategy};
use crate::generator::{generate_password, GenOptions};
use crate::totp::{snapshot as totp_snapshot, TotpSnapshot, TotpSpec};
use crate::vault::{Folder, Item, ItemKind, ItemPayload, ItemSummary, VaultError, VaultRepo};

#[derive(Default)]
pub struct AppState {
    pub repo: Option<VaultRepo>,
    pub bridge: Arc<BridgeState>,
}

/// Resolver implementation backed by the live VaultRepo. Looks up the repo
/// fresh via the Tauri-managed state on each call so it always sees current
/// lock/unlock state.
struct VaultResolver {
    app: AppHandle,
}

fn host_match(saved: &str, requested: &str) -> bool {
    // exact match first
    if saved == requested { return true; }
    // strip leading www. for comparison
    let s = saved.strip_prefix("www.").unwrap_or(saved);
    let r = requested.strip_prefix("www.").unwrap_or(requested);
    if s == r { return true; }
    // saved is a subdomain of requested (e.g. saved=mail.google.com, req=google.com) — OK
    // but NOT the reverse (saved=google.com, req=evil.google.com.attacker.com should not match)
    if s.ends_with(&format!(".{r}")) { return true; }
    // eTLD+1 match using psl
    if let (Some(s_domain), Some(r_domain)) = (psl::List.domain(s), psl::List.domain(r)) {
        return s_domain.to_str() == r_domain.to_str();
    }
    false
}

impl Resolver for VaultResolver {
    fn candidates_for(&self, host: &str) -> Vec<CredsCandidate> {
        let state = self.app.state::<Mutex<AppState>>();
        let s = state.lock().unwrap();
        let Some(repo) = s.repo.as_ref() else { return vec![] };
        let summaries = match repo.list_summaries() {
            Ok(v) => v,
            Err(_) => return vec![],
        };
        let mut out = Vec::new();
        for sum in summaries {
            if sum.kind != ItemKind::Login {
                continue;
            }
            let Ok(Some(item)) = repo.get_item(&sum.id) else { continue };
            if let ItemPayload::Login { username, url: Some(u), .. } = &item.payload {
                let Ok(parsed) = url::Url::parse(u) else { continue };
                let Some(saved_host) = parsed.host_str() else { continue };
                if host_match(saved_host, host) {
                    out.push(CredsCandidate {
                        id: item.id.to_string(),
                        name: item.name.clone(),
                        username: username.clone(),
                        url: saved_host.to_string(),
                    });
                }
            }
        }
        out
    }

    fn resolve(&self, item_id: &str) -> Option<ApprovedCred> {
        let id = Uuid::parse_str(item_id).ok()?;
        let state = self.app.state::<Mutex<AppState>>();
        let s = state.lock().unwrap();
        let repo = s.repo.as_ref()?;
        let item = repo.get_item(&id).ok()??;
        if let ItemPayload::Login { username, password, .. } = item.payload {
            Some(ApprovedCred { username, password })
        } else {
            None
        }
    }
}

#[derive(Debug, Serialize)]
pub struct CmdError {
    code: String,
    message: String,
}

impl From<VaultError> for CmdError {
    fn from(e: VaultError) -> Self {
        let code = match e {
            VaultError::Locked => "locked",
            VaultError::BadPassword => "bad_password",
            VaultError::AlreadyInitialized => "already_initialized",
            VaultError::Crypto => "crypto",
            VaultError::Serde => "serde",
            VaultError::Db(_) => "db",
        }
        .to_string();
        CmdError {
            code,
            message: e.to_string(),
        }
    }
}

fn vault_path(app: &AppHandle) -> Result<PathBuf, CmdError> {
    let dir = app.path().app_data_dir().map_err(|e| CmdError {
        code: "path".into(),
        message: e.to_string(),
    })?;
    std::fs::create_dir_all(&dir).map_err(|e| CmdError {
        code: "path".into(),
        message: e.to_string(),
    })?;
    Ok(dir.join("vault.db"))
}

fn ensure_repo(app: &AppHandle, state: &mut AppState) -> Result<(), CmdError> {
    if state.repo.is_none() {
        let p = vault_path(app)?;
        state.repo = Some(VaultRepo::open(&p).map_err(CmdError::from)?);
    }
    Ok(())
}

#[tauri::command]
pub fn vault_exists(
    app: AppHandle,
    state: State<'_, Mutex<AppState>>,
) -> Result<bool, CmdError> {
    let mut s = state.lock().unwrap();
    ensure_repo(&app, &mut s)?;
    let r = s.repo.as_ref().unwrap();
    r.is_initialized().map_err(CmdError::from)
}

#[tauri::command]
pub fn vault_create(
    app: AppHandle,
    state: State<'_, Mutex<AppState>>,
    password: String,
) -> Result<(), CmdError> {
    let mut s = state.lock().unwrap();
    ensure_repo(&app, &mut s)?;
    s.repo
        .as_mut()
        .unwrap()
        .create(&password, DEFAULT_KDF)
        .map_err(CmdError::from)
}

#[tauri::command]
pub fn vault_unlock(
    app: AppHandle,
    state: State<'_, Mutex<AppState>>,
    password: String,
) -> Result<(), CmdError> {
    let bridge_state = {
        let mut s = state.lock().unwrap();
        ensure_repo(&app, &mut s)?;
        s.repo
            .as_mut()
            .unwrap()
            .unlock(&password)
            .map_err(CmdError::from)?;
        s.bridge.clone()
    };
    let resolver = Arc::new(VaultResolver { app: app.clone() });
    bridge::start(app, bridge_state, resolver).map_err(|m| CmdError {
        code: "bridge".into(),
        message: m,
    })?;
    Ok(())
}

#[tauri::command]
pub fn vault_lock(state: State<'_, Mutex<AppState>>) -> Result<(), CmdError> {
    let mut s = state.lock().unwrap();
    if let Some(r) = s.repo.as_mut() {
        r.lock();
    }
    bridge::stop(&s.bridge);
    Ok(())
}

#[tauri::command]
pub fn vault_is_locked(state: State<'_, Mutex<AppState>>) -> Result<bool, CmdError> {
    let s = state.lock().unwrap();
    Ok(s.repo.as_ref().map(|r| !r.is_unlocked()).unwrap_or(true))
}

fn now_ts() -> i64 {
    time::OffsetDateTime::now_utc().unix_timestamp()
}

#[derive(serde::Deserialize)]
pub struct NewItem {
    pub kind: ItemKind,
    pub name: String,
    pub favorite: Option<bool>,
    pub folder_id: Option<Uuid>,
    pub payload: ItemPayload,
}

#[derive(serde::Deserialize)]
pub struct UpdateItemInput {
    pub id: Uuid,
    pub kind: ItemKind,
    pub name: String,
    pub favorite: bool,
    pub folder_id: Option<Uuid>,
    pub payload: ItemPayload,
}

#[tauri::command]
pub fn item_list(state: State<'_, Mutex<AppState>>) -> Result<Vec<ItemSummary>, CmdError> {
    let s = state.lock().unwrap();
    let r = s.repo.as_ref().ok_or(CmdError {
        code: "locked".into(),
        message: "vault not opened".into(),
    })?;
    r.list_summaries().map_err(CmdError::from)
}

#[tauri::command]
pub fn item_get(
    state: State<'_, Mutex<AppState>>,
    id: Uuid,
) -> Result<Option<Item>, CmdError> {
    let s = state.lock().unwrap();
    let r = s.repo.as_ref().ok_or(CmdError {
        code: "locked".into(),
        message: "vault not opened".into(),
    })?;
    r.get_item(&id).map_err(CmdError::from)
}

#[tauri::command]
pub fn item_create(
    state: State<'_, Mutex<AppState>>,
    input: NewItem,
) -> Result<Uuid, CmdError> {
    let s = state.lock().unwrap();
    let r = s.repo.as_ref().ok_or(CmdError {
        code: "locked".into(),
        message: "vault not opened".into(),
    })?;
    let ts = now_ts();
    let id = Uuid::new_v4();
    let item = Item {
        id,
        kind: input.kind,
        name: input.name,
        favorite: input.favorite.unwrap_or(false),
        folder_id: input.folder_id,
        created_at: ts,
        updated_at: ts,
        payload: input.payload,
    };
    r.insert_item(&item).map_err(CmdError::from)?;
    Ok(id)
}

#[tauri::command]
pub fn item_update(
    state: State<'_, Mutex<AppState>>,
    input: UpdateItemInput,
) -> Result<(), CmdError> {
    let s = state.lock().unwrap();
    let r = s.repo.as_ref().ok_or(CmdError {
        code: "locked".into(),
        message: "vault not opened".into(),
    })?;
    let existing = r.get_item(&input.id).map_err(CmdError::from)?.ok_or(CmdError {
        code: "not_found".into(),
        message: "item not found".into(),
    })?;
    let updated = Item {
        id: input.id,
        kind: input.kind,
        name: input.name,
        favorite: input.favorite,
        folder_id: input.folder_id,
        created_at: existing.created_at,
        updated_at: now_ts(),
        payload: input.payload,
    };
    r.update_item(&updated).map_err(CmdError::from)
}

#[tauri::command]
pub fn item_delete(
    state: State<'_, Mutex<AppState>>,
    id: Uuid,
) -> Result<(), CmdError> {
    let s = state.lock().unwrap();
    let r = s.repo.as_ref().ok_or(CmdError {
        code: "locked".into(),
        message: "vault not opened".into(),
    })?;
    r.delete_item(&id).map_err(CmdError::from)
}

#[tauri::command]
pub fn gen_password(opts: GenOptions) -> Result<String, CmdError> {
    generate_password(&opts).map_err(|m| CmdError {
        code: "gen".into(),
        message: m.into(),
    })
}

#[tauri::command]
pub fn clipboard_copy(text: String, ttl_secs: Option<u64>) -> Result<(), CmdError> {
    clipboard::copy_with_ttl(&text, ttl_secs.unwrap_or(20))
        .map(|_| ())
        .map_err(|m| CmdError {
            code: "clipboard".into(),
            message: m,
        })
}

#[tauri::command]
pub fn totp_now(spec: TotpSpec) -> Result<TotpSnapshot, CmdError> {
    totp_snapshot(&spec).map_err(|m| CmdError {
        code: "totp".into(),
        message: m,
    })
}

#[tauri::command]
pub fn folder_list(state: State<'_, Mutex<AppState>>) -> Result<Vec<Folder>, CmdError> {
    let s = state.lock().unwrap();
    let r = s.repo.as_ref().ok_or(CmdError {
        code: "locked".into(),
        message: "vault not opened".into(),
    })?;
    r.list_folders().map_err(CmdError::from)
}

#[tauri::command]
pub fn folder_create(
    state: State<'_, Mutex<AppState>>,
    name: String,
    parent_id: Option<Uuid>,
) -> Result<Uuid, CmdError> {
    let s = state.lock().unwrap();
    let r = s.repo.as_ref().ok_or(CmdError {
        code: "locked".into(),
        message: "vault not opened".into(),
    })?;
    r.create_folder(&name, parent_id).map_err(CmdError::from)
}

#[tauri::command]
pub fn folder_rename(
    state: State<'_, Mutex<AppState>>,
    id: Uuid,
    name: String,
) -> Result<(), CmdError> {
    let s = state.lock().unwrap();
    let r = s.repo.as_ref().ok_or(CmdError {
        code: "locked".into(),
        message: "vault not opened".into(),
    })?;
    r.rename_folder(&id, &name).map_err(CmdError::from)
}

#[tauri::command]
pub fn folder_delete(state: State<'_, Mutex<AppState>>, id: Uuid) -> Result<(), CmdError> {
    let s = state.lock().unwrap();
    let r = s.repo.as_ref().ok_or(CmdError {
        code: "locked".into(),
        message: "vault not opened".into(),
    })?;
    r.delete_folder(&id).map_err(CmdError::from)
}

#[tauri::command]
pub fn vault_export(
    state: State<'_, Mutex<AppState>>,
    path: String,
    passphrase: String,
) -> Result<(), CmdError> {
    let s = state.lock().unwrap();
    let r = s.repo.as_ref().ok_or(CmdError {
        code: "locked".into(),
        message: "vault not opened".into(),
    })?;
    export_to_file(r, &StdPathBuf::from(path), &passphrase).map_err(CmdError::from)
}

#[tauri::command]
pub fn vault_import(
    state: State<'_, Mutex<AppState>>,
    path: String,
    passphrase: String,
    strategy: ImportStrategy,
) -> Result<ImportReport, CmdError> {
    let s = state.lock().unwrap();
    let r = s.repo.as_ref().ok_or(CmdError {
        code: "locked".into(),
        message: "vault not opened".into(),
    })?;
    import_from_file(r, &StdPathBuf::from(path), &passphrase, strategy).map_err(CmdError::from)
}

#[tauri::command]
pub fn bridge_pair_complete(
    state: State<'_, Mutex<AppState>>,
    id: String,
    allow: bool,
) -> Result<(), CmdError> {
    let s = state.lock().unwrap();
    s.bridge.complete_pair(&id, allow).map_err(|m| CmdError {
        code: "bridge".into(),
        message: m,
    })
}

#[tauri::command]
pub fn bridge_creds_complete(
    state: State<'_, Mutex<AppState>>,
    id: String,
    allow: bool,
    selected_item_id: Option<String>,
) -> Result<(), CmdError> {
    let s = state.lock().unwrap();
    let bridge = s.bridge.clone();
    let repo = s.repo.as_ref();
    let resolve = |item_id: &str| -> Option<ApprovedCred> {
        let id = Uuid::parse_str(item_id).ok()?;
        let item = repo?.get_item(&id).ok()??;
        if let ItemPayload::Login { username, password, .. } = item.payload {
            Some(ApprovedCred { username, password })
        } else {
            None
        }
    };
    bridge
        .complete_creds(&id, allow, selected_item_id, resolve)
        .map_err(|m| CmdError {
            code: "bridge".into(),
            message: m,
        })
}

#[tauri::command]
pub fn autofill_fill(
    state: State<'_, Mutex<AppState>>,
    item_id: Uuid,
    target_hwnd: Option<u64>,
) -> Result<(), CmdError> {
    let item = {
        let s = state.lock().unwrap();
        let r = s.repo.as_ref().ok_or(CmdError {
            code: "locked".into(),
            message: "vault not opened".into(),
        })?;
        r.get_item(&item_id).map_err(CmdError::from)?.ok_or(CmdError {
            code: "not_found".into(),
            message: "item not found".into(),
        })?
    };
    let (user, pw) = match item.payload {
        ItemPayload::Login { username, password, .. } => (Some(username), password),
        _ => {
            return Err(CmdError {
                code: "kind".into(),
                message: "only login items can be autofilled".into(),
            })
        }
    };
    autofill::uia::fill_focused(user.as_deref(), &pw, target_hwnd.unwrap_or(0)).map_err(|m| CmdError {
        code: "uia".into(),
        message: m,
    })
}

#[tauri::command]
pub async fn prefs_get(app: AppHandle) -> Result<crate::prefs::Prefs, String> {
    let path = crate::prefs::prefs_path(&app).map_err(|e| e.to_string())?;
    if !path.exists() { return Ok(crate::prefs::Prefs::default()); }
    let json = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&json).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn prefs_set(app: AppHandle, prefs: crate::prefs::Prefs) -> Result<(), String> {
    let path = crate::prefs::prefs_path(&app).map_err(|e| e.to_string())?;
    if let Some(dir) = path.parent() { std::fs::create_dir_all(dir).map_err(|e| e.to_string())?; }
    let json = serde_json::to_string_pretty(&prefs).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::host_match;
    #[test]
    fn host_match_no_false_positive() {
        assert!(!host_match("evil.example.com", "example.com"));
        assert!(host_match("mail.google.com", "google.com"));
        assert!(host_match("example.com", "example.com"));
        assert!(host_match("www.example.com", "example.com"));
    }
}
