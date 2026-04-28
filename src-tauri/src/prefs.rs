use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Prefs {
    #[serde(default = "default_idle_minutes")]
    pub idle_minutes: u32,
    #[serde(default)]
    pub lock_on_blur: bool,
    #[serde(default = "default_clipboard_ttl_secs")]
    pub clipboard_ttl_secs: u32,
    #[serde(default = "default_autofill_hotkey")]
    pub autofill_hotkey: String,
}

impl Default for Prefs {
    fn default() -> Self {
        Self {
            idle_minutes: default_idle_minutes(),
            lock_on_blur: false,
            clipboard_ttl_secs: default_clipboard_ttl_secs(),
            autofill_hotkey: default_autofill_hotkey(),
        }
    }
}

fn default_idle_minutes() -> u32 { 5 }
fn default_clipboard_ttl_secs() -> u32 { 20 }
fn default_autofill_hotkey() -> String { "Ctrl+Shift+\\".into() }

pub fn prefs_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    Ok(dir.join("prefs.json"))
}
