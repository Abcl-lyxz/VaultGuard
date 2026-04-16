//! Clipboard with auto-clear. Every write schedules a zero-out after `ttl_secs`.
//! If another write happens first, the previous clear is superseded (generation counter).

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use arboard::Clipboard;

static GEN: AtomicU64 = AtomicU64::new(0);

fn global_clipboard() -> &'static Arc<Mutex<Clipboard>> {
    use std::sync::OnceLock;
    static CELL: OnceLock<Arc<Mutex<Clipboard>>> = OnceLock::new();
    CELL.get_or_init(|| {
        Arc::new(Mutex::new(
            Clipboard::new().expect("failed to init clipboard"),
        ))
    })
}

/// Copy `text` and schedule a zero-out after `ttl_secs` seconds.
/// Returns the generation id of this copy (useful for tests; UI can ignore).
pub fn copy_with_ttl(text: &str, ttl_secs: u64) -> Result<u64, String> {
    let cb = global_clipboard();
    {
        let mut g = cb.lock().map_err(|e| e.to_string())?;
        g.set_text(text.to_string()).map_err(|e| e.to_string())?;
    }
    let my_gen = GEN.fetch_add(1, Ordering::SeqCst).wrapping_add(1);
    let cb2 = cb.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(ttl_secs));
        if GEN.load(Ordering::SeqCst) != my_gen {
            return; // another copy happened; leave it to its own timer
        }
        if let Ok(mut g) = cb2.lock() {
            let _ = g.set_text(String::new());
            let _ = g.clear();
        }
    });
    Ok(my_gen)
}
