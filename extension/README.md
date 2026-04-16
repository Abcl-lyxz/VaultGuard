# VaultGuard Browser Extension (MV3)

Companion extension for the VaultGuard desktop app. Talks to the desktop over a
loopback HTTP bridge on `127.0.0.1:62501` with per-extension Bearer tokens and
per-request user approval (no silent autofill).

## Install (developer mode)

1. Launch the VaultGuard desktop app and unlock the vault — this starts the bridge.
2. In Chrome/Edge: open `chrome://extensions`, enable **Developer mode**, click
   **Load unpacked**, and select this `extension/` folder.
3. Click the VaultGuard toolbar icon → **Pair with desktop app**. Approve the
   pairing modal in the desktop app.
4. Visit a login form. A small 🔐 badge appears next to the password field;
   click it to request credentials. Approve the request in the desktop popup.

## Security model

- **Origin pinning**: extension only ever talks to `http://127.0.0.1:62501`.
- **Per-extension token**: pairing returns a 32-byte random Bearer token stored
  in `chrome.storage.local`. The desktop verifies it on every request.
- **Per-request approval**: every credential request triggers a desktop modal;
  no silent fill. 30-second timeout = denied.
- **Host match**: only login items whose stored URL host matches the page
  origin are offered.
- **No password ever leaves the desktop unencrypted-in-transit-by-design**:
  loopback is local-only.
