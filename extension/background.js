// VaultGuard MV3 service worker v0.5.0 — talks to the desktop bridge over loopback HTTP.
// Stores the per-extension Bearer token in chrome.storage.local. Pairing happens
// once via the popup; thereafter the worker forwards credential requests from
// content scripts to the desktop, which prompts the user for per-request approval.

const BRIDGE = 'http://127.0.0.1:62501';

async function getToken() {
  const { vg_token } = await chrome.storage.local.get('vg_token');
  return vg_token || null;
}

async function setToken(t) {
  await chrome.storage.local.set({ vg_token: t });
}

async function clearToken() {
  await chrome.storage.local.remove('vg_token');
}

async function pair() {
  const r = await fetch(`${BRIDGE}/v1/associate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ extension_name: 'VaultGuard Browser Extension' }),
  });
  if (!r.ok) throw new Error(`pair failed: ${r.status}`);
  const j = await r.json();
  if (!j.token) throw new Error('no token in response');
  await setToken(j.token);
  return j.token;
}

async function authedFetch(path, init = {}) {
  const token = await getToken();
  if (!token) {
    const e = new Error('Not paired — open the extension popup to pair with VaultGuard');
    e.code = 'not_paired';
    throw e;
  }
  const headers = Object.assign({ Authorization: `Bearer ${token}` }, init.headers || {});
  let r;
  try {
    r = await fetch(`${BRIDGE}${path}`, Object.assign({}, init, { headers }));
  } catch (netErr) {
    // TypeError: Failed to fetch — bridge HTTP server isn't listening.
    const e = new Error('VaultGuard is locked or closed — unlock the desktop app and try again');
    e.code = 'bridge_down';
    throw e;
  }
  if (r.status === 401) {
    await clearToken();
    const e = new Error('Pairing was reset — open the extension popup to pair again');
    e.code = 'token_rejected';
    throw e;
  }
  return r;
}

async function fetchCreds(origin) {
  const r = await authedFetch(`/v1/credentials?origin=${encodeURIComponent(origin)}`);
  if (r.status === 403) throw new Error('denied by user');
  if (r.status === 408) throw new Error('approval timed out');
  if (!r.ok) throw new Error(`bridge error ${r.status}`);
  return r.json();
}

async function fetchTotp(itemId) {
  const r = await authedFetch(`/v1/totp?item_id=${encodeURIComponent(itemId)}`);
  if (r.status === 404) return null; // item has no totp_secret
  if (!r.ok) throw new Error(`totp ${r.status}`);
  return r.json();
}

async function saveNew(origin, username, password) {
  const r = await authedFetch('/v1/save_request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ origin, username, password }),
  });
  if (r.status === 409) {
    // host+username already exists — caller should switch to update flow
    const j = await r.json().catch(() => ({}));
    return { ok: false, exists: true, item_id: j.item_id || null, item_name: j.item_name || '' };
  }
  if (r.status === 403) return { ok: false, error: 'denied' };
  if (r.status === 408) return { ok: false, error: 'timeout' };
  if (!r.ok) return { ok: false, error: `bridge ${r.status}` };
  const j = await r.json();
  return { ok: true, item_id: j.item_id };
}

async function updatePassword(itemId, newPassword) {
  const r = await authedFetch('/v1/update_request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item_id: itemId, new_password: newPassword }),
  });
  if (r.status === 403) return { ok: false, error: 'denied' };
  if (r.status === 408) return { ok: false, error: 'timeout' };
  if (!r.ok) return { ok: false, error: `bridge ${r.status}` };
  return { ok: true };
}

// ── Helper: send fill_now to active tab ──────────────────────────────────────
async function triggerFillOnActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { ok: false, error: 'no active tab' };
  try {
    const resp = await chrome.tabs.sendMessage(tab.id, { type: 'vg:fill_now' });
    return resp || { ok: false, error: 'no response from content script' };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// ── Keyboard command handler ──────────────────────────────────────────────────
chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd === '_execute_fill') {
    await triggerFillOnActiveTab();
  }
});

// ── Message handler ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === 'vg:pair') {
        const token = await pair();
        sendResponse({ ok: true, token });
      } else if (msg?.type === 'vg:status') {
        sendResponse({ ok: true, paired: !!(await getToken()) });
      } else if (msg?.type === 'vg:unpair') {
        await clearToken();
        sendResponse({ ok: true });
      } else if (msg?.type === 'vg:fetch_creds') {
        const j = await fetchCreds(msg.origin);
        sendResponse({ ok: true, items: j.items || [] });
      } else if (msg?.type === 'vg:totp_fetch') {
        const j = await fetchTotp(msg.item_id);
        sendResponse({ ok: true, totp: j });
      } else if (msg?.type === 'vg:save_new') {
        const r = await saveNew(msg.origin, msg.username, msg.password);
        sendResponse(r);
      } else if (msg?.type === 'vg:update_password') {
        const r = await updatePassword(msg.item_id, msg.new_password);
        sendResponse(r);
      } else if (msg?.type === 'vg:fill_now') {
        // From popup: forward to active tab content script
        const result = await triggerFillOnActiveTab();
        sendResponse(result);
      } else {
        sendResponse({ ok: false, error: 'unknown message' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message || e), code: e?.code });
    }
  })();
  return true; // async response
});
