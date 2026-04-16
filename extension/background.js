// VaultGuard MV3 service worker — talks to the desktop bridge over loopback HTTP.
// Stores the per-extension Bearer token in chrome.storage.local. Pairing happens
// once via the popup; thereafter the worker forwards credential requests from
// content scripts to the desktop, which prompts the user for per-request approval.

const BRIDGE = "http://127.0.0.1:62501";

async function getToken() {
  const { vg_token } = await chrome.storage.local.get("vg_token");
  return vg_token || null;
}

async function setToken(t) {
  await chrome.storage.local.set({ vg_token: t });
}

async function clearToken() {
  await chrome.storage.local.remove("vg_token");
}

async function pair() {
  const r = await fetch(`${BRIDGE}/v1/associate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ extension_name: "VaultGuard Browser Extension" }),
  });
  if (!r.ok) throw new Error(`pair failed: ${r.status}`);
  const j = await r.json();
  if (!j.token) throw new Error("no token in response");
  await setToken(j.token);
  return j.token;
}

async function fetchCreds(origin) {
  const token = await getToken();
  if (!token) throw new Error("not paired");
  const url = `${BRIDGE}/v1/credentials?origin=${encodeURIComponent(origin)}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (r.status === 401) {
    await clearToken();
    throw new Error("token rejected — please pair again");
  }
  if (r.status === 403) throw new Error("denied by user");
  if (r.status === 408) throw new Error("approval timed out");
  if (!r.ok) throw new Error(`bridge error ${r.status}`);
  return r.json();
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "vg:pair") {
        const token = await pair();
        sendResponse({ ok: true, token });
      } else if (msg?.type === "vg:status") {
        sendResponse({ ok: true, paired: !!(await getToken()) });
      } else if (msg?.type === "vg:unpair") {
        await clearToken();
        sendResponse({ ok: true });
      } else if (msg?.type === "vg:fetch_creds") {
        const j = await fetchCreds(msg.origin);
        sendResponse({ ok: true, items: j.items || [] });
      } else {
        sendResponse({ ok: false, error: "unknown message" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
  })();
  return true; // async response
});
