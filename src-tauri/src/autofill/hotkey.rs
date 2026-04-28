use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use global_hotkey::{
    hotkey::{Code, HotKey, Modifiers},
    GlobalHotKeyEvent, GlobalHotKeyManager,
};
use tauri::{AppHandle, Emitter};
use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

static STARTED: AtomicBool = AtomicBool::new(false);

/// Register Ctrl+Shift+Backslash and emit `autofill:open_picker` on every press.
/// The manager is owned by the spawned thread (it is `!Send`, so it must be
/// created and kept on the same thread that listens for events).
pub fn start(app: AppHandle) -> Result<(), String> {
    if STARTED.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    std::thread::Builder::new()
        .name("vaultguard-hotkey".into())
        .spawn(move || {
            let manager = match GlobalHotKeyManager::new() {
                Ok(m) => m,
                Err(e) => {
                    tracing::warn!("hotkey manager: {e}");
                    return;
                }
            };
            let hotkey = HotKey::new(
                Some(Modifiers::CONTROL | Modifiers::SHIFT),
                Code::Backslash,
            );
            if let Err(e) = manager.register(hotkey) {
                tracing::warn!("hotkey register: {e}");
                return;
            }
            let rx = GlobalHotKeyEvent::receiver();
            loop {
                match rx.recv_timeout(Duration::from_millis(500)) {
                    Ok(_ev) => {
                        // Capture the currently focused window HWND so the
                        // fill command can restore focus before querying UIA.
                        let hwnd_val: u64 = unsafe {
                            GetForegroundWindow().0 as u64
                        };
                        let _ = app.emit("autofill:open_picker", hwnd_val);
                    }
                    Err(e) => {
                        // Disconnected = exit; timeout = keep waiting.
                        if e.to_string().contains("disconnected") {
                            break;
                        }
                        continue;
                    }
                }
            }
            drop(manager);
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}
