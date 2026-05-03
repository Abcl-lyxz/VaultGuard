# Changelog

## [0.4.1] — 2026-05-03

### Bug fixes
- **White input fields**: `tokens.css` v0.4.0 renamed `--bg-elevated/--bg-surface/--border-subtle/--danger-muted/--success-muted/--accent-muted/--r` but `App.css` still referenced the old names, causing browsers to fall back to white for all inputs, selects, modals, toasts, and secret-row buttons. Legacy alias variables now bridge the gap.
- **Chromium autofill highlight**: added `:-webkit-autofill` override so the browser's yellow autofill paint is replaced with the correct dark surface colour.
- **Create item — silent error**: `save()` caught Tauri `CmdError` objects but read `.message` instead of serialising the full object, showing `[object Object]` (perceived as a silent failure). Error formatter now extracts `.message ?? .error ?? JSON.stringify(e)` and shows it in both the inline error block and a toast.

### UX hardening — idiot-proofing
- **Sensitive-data reveal gate**: card number, CVV, crypto wallet seed phrase, and SSH private key fields now require an explicit **Reveal** click before Copy is enabled. After revealing, the value auto-hides after 10 seconds. Prevents shoulder-surfing and accidental clipboard exposure.
- **Unsaved-changes guard**: switching item kind and clicking Cancel now show a confirmation dialog if the form has been modified, preventing silent data loss.
- **Folder delete impact preview**: the delete confirmation modal now shows how many items are inside the folder and that they will become unfiled (or "The folder is empty" if none).
- **Save button name guard**: `save()` now validates `name.trim()` at the function boundary (in addition to the existing button-disabled check) and shows a clear inline error.

### Autofill single-flight (extension → desktop)
- **Dedup at Rust layer**: `handle_credentials` now rejects duplicate requests from the same token+origin within 1.5 s with HTTP 429, preventing rapid extension clicks from stacking pending approvals.
- **Queue in frontend**: `BridgeApprovals` converts its single-slot `creds` and `pair` state into FIFO queues; each approval/denial shifts the queue and surfaces the next request. Modal title shows "(N pending)" when multiple requests are queued.
- **Window focus**: the Tauri main window is unminimised and focused when a `bridge:pair_request` or `bridge:creds_request` is emitted, so the approval prompt surfaces immediately.
- **Extension in-flight latch**: `content.js::handleFillRequest` sets an `fillInFlight` flag for the duration of the request and ignores further badge clicks until resolved; the badge dims while in-flight.

### Version
- Bumped to `0.4.1` in `package.json`, `Cargo.toml`, and `tauri.conf.json`.

## [0.4.0] — 2026-04-30

### UI — 3-pane layout redesign
- **3-pane shell**: replaced 2-column layout with `NavSidebar (240px) | ItemListPanel (300px) | EditorPanel (flex)` — matches 1Password / Bitwarden conventions
- **NavSidebar**: sectioned navigation with Library (All / Favorites / Unfiled), Folders (hover-reveal edit/delete), and Types (per-kind filter using `__kind__` prefix) — Settings + Lock in pinned footer
- **ItemListPanel**: flat item list with inline search (Ctrl+F), item count, and New button; EmptyState for all empty conditions (no vault, no results, no filter match)
- **Kind filter**: clicking a type in the sidebar filters the item list to that credential type
- **Design tokens**: `tokens.css` now loaded globally — complete set of surface, border, accent, semantic, shadow, scrollbar, radius, and spacing tokens used by all layout components
- **Removed dead CSS**: old `.app-layout`, `.sidebar`, `.item-list`, `.folder-pill` and related 2-pane classes removed from `App.css`
- **TOTP layout fix**: algorithm / digits / period fields now in a proper 3-column `.row-3` grid instead of 2-column overflow

### Bug fixes
- **Create item bug — Prefs mismatch**: Rust `Prefs` struct was missing `theme` and `autofill_enabled` fields; added with `serde(default)` so existing `prefs.json` files deserialize cleanly
- **Create item bug — NaN on numeric fields**: Card expiry month/year and TOTP digits/period changed from `<input type="number">` (which produced `NaN` on empty) to `<select>` dropdowns with safe fixed values — eliminates silent Rust u8/u16 deserialization failures

## [0.3.0] — 2026-04-28

### Extension — Fill reliability overhaul
- **Fix orphan-node fill bug**: badge click now re-resolves `findLoginPair()` fresh instead of using stale closure reference — fixes "fill doesn't work on SPA sites"
- **iframe support**: `all_frames: true` in manifest — Google OAuth, Stripe Checkout, Microsoft login now reachable
- **Shadow DOM traversal**: `collectPasswordInputs` recurses into open shadow roots — web component login forms now supported
- **Full event sequence**: `focus → keydown → beforeinput → input → change → keyup → blur` dispatched on fill — Vue, Svelte, Lit apps now see the change
- **Multi-step login caching**: username-only pages cache to `sessionStorage`; password is filled when the next page appears
- **Multi-credential chooser**: when vault has multiple logins for a site, an in-page Shadow DOM picker appears instead of silently picking the first
- **Signup form detection**: badge suppressed when `autocomplete=new-password` or two password fields are present
- **Badge lifecycle**: `WeakRef` + `MutationObserver` removes the badge when the password field leaves the DOM; scroll/resize listeners cleaned up on teardown
- **Success feedback**: badge turns green checkmark for 1.5 s after successful fill
- **Fill from popup**: "Fill credentials" button added to extension popup
- **Keyboard shortcut**: `Ctrl+Shift+L` triggers fill on the active tab

### Backend — Security & robustness
- **Fix `host_match` security bug**: replaced bidirectional suffix check with `psl` eTLD+1 matching — `evil.example.com` no longer matches `example.com`
- **Rate-limit `/v1/associate`**: 5-second cooldown + 20 pairings/day cap; excess requests get `429 Too Many Requests`
- **Fix busy-poll in bridge**: `wait_oneshot` converted from 100 ms poll loop to `mpsc::recv_timeout` — no longer wastes CPU while waiting for user approval
- **UIA focus restore**: `GetForegroundWindow` captured at hotkey press time; `SetForegroundWindow` called before UIA fill so credentials land in the correct window even when the picker overlay steals focus
- **Preferences backend**: new `prefs_get` / `prefs_set` Tauri commands persist idle timeout, clipboard TTL, lock-on-blur, and autofill hotkey to `prefs.json`

### UI — Component system & UX
- **New component primitives**: `Modal`, `Button`, `Field`, `Toast`, `EmptyState`, `Skeleton`, `CommandPalette` — replaces 6× duplicated modal scaffolding
- **Theme system**: light / dark / system modes, toggled in Settings → Preferences; persisted to `localStorage`
- **Toast notifications**: clipboard copy, export/import, and error states all use non-blocking toasts
- **Keyboard shortcuts**: `Ctrl+L` lock, `Ctrl+N` new item, `Ctrl+F` search, `Ctrl+,` settings, `Ctrl+K` command palette, `Esc` close modal
- **Command palette** (`Ctrl+K`): fuzzy search across items + commands (Lock, New, Export, Import, Theme, Settings)
- **Settings → Preferences tab**: idle timeout, clipboard TTL, theme, lock-on-blur — removes hardcoded `useIdleLock(5, 30)`
- **Settings → Help & Shortcuts tab**: keyboard shortcut reference + native autofill (`Ctrl+Shift+\`) explanation
- **Accessibility**: `role="dialog"` + `aria-modal` + focus trap on all modals via shared `<Modal>` component; `aria-label` on icon buttons; `role="listbox"` on item list

## [0.2.0] — 2026-04-17

- Full UI overhaul with design system CSS variables
- Inline modals replacing `prompt()`/`confirm()`
- TOTP badge, password generator, fuzzy search

## [0.1.0] — 2026-04-16

- Initial release: Tauri + React + Rust, Argon2id + XChaCha20-Poly1305 vault, browser extension + UIA autofill
