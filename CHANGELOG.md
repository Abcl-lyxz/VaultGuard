# Changelog

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
