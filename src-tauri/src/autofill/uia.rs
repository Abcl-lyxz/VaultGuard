//! Windows UI Automation autofill.
//!
//! Strategy: restore focus to the target window, then take the focused element.
//! If it accepts the `Value` pattern, set it to the password. Then, via the
//! control-view tree walker, climb to the parent and walk previous siblings
//! looking for the closest non-password element that also accepts `Value` —
//! that becomes the username target.
//!
//! When ValuePattern is unavailable (some custom controls), fall back to the
//! clipboard helper so the user can paste manually.

use uiautomation::patterns::UIValuePattern;
use uiautomation::{UIAutomation, UIElement, UITreeWalker};
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::SetForegroundWindow;

use crate::clipboard;

pub fn fill_focused(username: Option<&str>, password: &str, target_hwnd: u64) -> Result<(), String> {
    // Restore focus to the window that was focused when the hotkey was pressed,
    // before the autofill picker overlay stole it.
    if target_hwnd != 0 {
        unsafe {
            let _ = SetForegroundWindow(HWND(target_hwnd as *mut core::ffi::c_void));
        }
        // Give the OS time to switch foreground window before querying focus.
        std::thread::sleep(std::time::Duration::from_millis(80));
    }

    let auto = UIAutomation::new().map_err(|e| e.to_string())?;
    let focused = auto.get_focused_element().map_err(|e| e.to_string())?;

    let filled_pw = try_set_value(&focused, password).is_ok();

    if let Some(user) = username {
        if let Ok(walker) = auto.get_control_view_walker() {
            if let Some(user_el) = find_username_target(&walker, &focused) {
                let _ = try_set_value(&user_el, user);
            }
        }
    }

    if !filled_pw {
        clipboard::copy_with_ttl(password, 20).map_err(|e| e.to_string())?;
        return Err(
            "could not set password via UI Automation — copied to clipboard instead".into(),
        );
    }
    Ok(())
}

fn try_set_value(el: &UIElement, value: &str) -> Result<(), String> {
    let pat: UIValuePattern = el.get_pattern().map_err(|e| e.to_string())?;
    pat.set_value(value).map_err(|e| e.to_string())
}

/// Walk previous siblings of `focused` (and, if needed, of its parent) looking
/// for an editable, non-password element. Cheap heuristic — works for the
/// common stacked username/password layout.
fn find_username_target(walker: &UITreeWalker, focused: &UIElement) -> Option<UIElement> {
    let mut cur = focused.clone();
    for _ in 0..16 {
        let prev = match walker.get_previous_sibling(&cur) {
            Ok(p) => p,
            Err(_) => {
                // Move up one and continue from the parent's previous sibling.
                cur = walker.get_parent(&cur).ok()?;
                continue;
            }
        };
        if is_editable_non_password(&prev) {
            return Some(prev);
        }
        cur = prev;
    }
    None
}

fn is_editable_non_password(el: &UIElement) -> bool {
    // Must accept the Value pattern. We deliberately don't filter by
    // IsPassword: in the typical layout the password field IS the focused
    // element, so walking previous siblings finds the username field first
    // anyway. Filtering would require fragile Variant→bool conversion.
    el.get_pattern::<UIValuePattern>().is_ok()
}
