pub mod autofill;
pub mod bridge;
pub mod clipboard;
pub mod crypto;
pub mod export;
pub mod generator;
pub mod ipc;
pub mod totp;
pub mod vault;

use std::sync::Mutex;

use ipc::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let h = app.handle().clone();
            if let Err(e) = autofill::hotkey::start(h) {
                tracing::warn!("hotkey registration failed: {e}");
            }
            Ok(())
        })
        .manage(Mutex::new(AppState::default()))
        .invoke_handler(tauri::generate_handler![
            ipc::vault_exists,
            ipc::vault_create,
            ipc::vault_unlock,
            ipc::vault_lock,
            ipc::vault_is_locked,
            ipc::item_list,
            ipc::item_get,
            ipc::item_create,
            ipc::item_update,
            ipc::item_delete,
            ipc::gen_password,
            ipc::clipboard_copy,
            ipc::totp_now,
            ipc::folder_list,
            ipc::folder_create,
            ipc::folder_rename,
            ipc::folder_delete,
            ipc::vault_export,
            ipc::vault_import,
            ipc::bridge_pair_complete,
            ipc::bridge_creds_complete,
            ipc::autofill_fill,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
