import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, type CredsRequest, type PairRequest } from "../lib/ipc";

export function BridgeApprovals() {
  const [pair, setPair] = useState<PairRequest | null>(null);
  const [creds, setCreds] = useState<CredsRequest | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    const unlistens: Array<() => void> = [];
    listen<PairRequest>("bridge:pair_request", (e) => setPair(e.payload)).then(
      (u) => unlistens.push(u),
    );
    listen<CredsRequest>("bridge:creds_request", (e) => {
      setCreds(e.payload);
      setSelected(e.payload.candidates[0]?.id ?? null);
    }).then((u) => unlistens.push(u));
    return () => {
      for (const u of unlistens) u();
    };
  }, []);

  async function decidePair(allow: boolean) {
    if (!pair) return;
    try {
      await api.bridgePairComplete(pair.request_id, allow);
    } finally {
      setPair(null);
    }
  }

  async function decideCreds(allow: boolean) {
    if (!creds) return;
    try {
      await api.bridgeCredsComplete(creds.request_id, allow, allow ? selected : null);
    } finally {
      setCreds(null);
      setSelected(null);
    }
  }

  return (
    <>
      {pair && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>Pair browser extension?</h2>
            <p className="subtitle">
              <b>{pair.extension_name}</b> wants to connect to VaultGuard. Once paired
              it can request credentials, and you will be asked to approve each request.
            </p>
            <div className="modal-actions">
              <button className="ghost" onClick={() => decidePair(false)}>Deny</button>
              <button onClick={() => decidePair(true)}>Allow</button>
            </div>
          </div>
        </div>
      )}
      {creds && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>Send credentials?</h2>
            <p className="subtitle">
              The browser is requesting a login for <b>{creds.origin}</b>.
            </p>
            {creds.candidates.length === 0 ? (
              <p className="empty">No matching items.</p>
            ) : (
              <div className="settings-menu">
                {creds.candidates.map((c) => (
                  <label key={c.id} className="row" style={{ cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="cred"
                      checked={selected === c.id}
                      onChange={() => setSelected(c.id)}
                      style={{ marginRight: 8 }}
                    />
                    <span style={{ flex: 1 }}>
                      <div>{c.name}</div>
                      <div style={{ color: "#a0a4ad", fontSize: "0.85rem" }}>
                        {c.username} · {c.url}
                      </div>
                    </span>
                  </label>
                ))}
              </div>
            )}
            <div className="modal-actions">
              <button className="ghost" onClick={() => decideCreds(false)}>Deny</button>
              <button
                onClick={() => decideCreds(true)}
                disabled={!selected || creds.candidates.length === 0}
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
