//! Native-app autofill for Windows.
//!
//! Two pieces:
//! - `hotkey`: registers a global hotkey (default Ctrl+Shift+\) and emits a
//!   Tauri event `autofill:open_picker` whenever the user presses it. The
//!   frontend shows a quick-picker overlay listing logins.
//! - `uia`:    on user pick, uses Windows UI Automation to set the focused
//!   element's value to the password (and the previous text-like sibling to
//!   the username) via the `Value` pattern. Fallback: clipboard paste.
//!
//! On non-Windows targets these are no-ops so the rest of the app still builds.

#[cfg(windows)]
pub mod hotkey;
#[cfg(windows)]
pub mod uia;

#[cfg(not(windows))]
pub mod hotkey {
    use tauri::AppHandle;
    pub fn start(_app: AppHandle) -> Result<(), String> {
        Ok(())
    }
}

#[cfg(not(windows))]
pub mod uia {
    pub fn fill_focused(_username: Option<&str>, _password: &str) -> Result<(), String> {
        Err("autofill is Windows-only".into())
    }
}
