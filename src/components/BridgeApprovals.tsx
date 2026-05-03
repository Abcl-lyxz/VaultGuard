import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, type CredsRequest, type PairRequest } from "../lib/ipc";
import { Modal } from "./ui/Modal";

export function BridgeApprovals() {
  const [pairQueue, setPairQueue]   = useState<PairRequest[]>([]);
  const [credsQueue, setCredsQueue] = useState<CredsRequest[]>([]);
  const [selected, setSelected]     = useState<string | null>(null);

  const pair  = pairQueue[0]  ?? null;
  const creds = credsQueue[0] ?? null;

  useEffect(() => {
    const unlistens: Array<() => void> = [];
    listen<PairRequest>("bridge:pair_request", (e) => {
      setPairQueue(q => q.some(p => p.request_id === e.payload.request_id) ? q : [...q, e.payload]);
    }).then((u) => unlistens.push(u));
    listen<CredsRequest>("bridge:creds_request", (e) => {
      setCredsQueue(q => {
        if (q.some(p => p.request_id === e.payload.request_id)) return q;
        if (q.length === 0) setSelected(e.payload.candidates[0]?.id ?? null);
        return [...q, e.payload];
      });
    }).then((u) => unlistens.push(u));
    return () => { for (const u of unlistens) u(); };
  }, []);

  async function decidePair(allow: boolean) {
    if (!pair) return;
    try { await api.bridgePairComplete(pair.request_id, allow); }
    finally { setPairQueue(q => q.slice(1)); }
  }

  async function decideCreds(allow: boolean) {
    if (!creds) return;
    try { await api.bridgeCredsComplete(creds.request_id, allow, allow ? selected : null); }
    finally {
      setCredsQueue(q => {
        const next = q.slice(1);
        setSelected(next[0]?.candidates[0]?.id ?? null);
        return next;
      });
    }
  }

  return (
    <>
      <Modal open={!!pair} onClose={() => decidePair(false)} title="Pair browser extension?">
        <p className="modal-subtitle">
          <strong style={{ color: "var(--text-primary)" }}>{pair?.extension_name}</strong>{" "}
          wants to connect to VaultGuard. Once paired it can request credentials,
          and you will be asked to approve each request.
        </p>
        <div className="modal-actions">
          <button className="ghost" onClick={() => decidePair(false)}>Deny</button>
          <button onClick={() => decidePair(true)}>Allow</button>
        </div>
      </Modal>

      <Modal open={!!creds} onClose={() => decideCreds(false)} title={credsQueue.length > 1 ? `Send credentials? (${credsQueue.length} pending)` : "Send credentials?"}>
        <p className="modal-subtitle">
          The browser is requesting a login for{" "}
          <strong style={{ color: "var(--text-primary)" }}>{creds?.origin}</strong>.
        </p>
        {creds && (
          creds.candidates.length === 0 ? (
            <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
              No matching items in your vault for this site.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {creds.candidates.map((c) => (
                <label key={c.id} className="creds-candidate">
                  <input
                    type="radio"
                    name="cred"
                    checked={selected === c.id}
                    onChange={() => setSelected(c.id)}
                    style={{ accentColor: "var(--accent)", flexShrink: 0 }}
                  />
                  <span className="creds-candidate-info">
                    <div className="creds-candidate-name">{c.name}</div>
                    <div className="creds-candidate-meta">{c.username} · {c.url}</div>
                  </span>
                </label>
              ))}
            </div>
          )
        )}
        <div className="modal-actions">
          <button className="ghost" onClick={() => decideCreds(false)}>Deny</button>
          <button
            onClick={() => decideCreds(true)}
            disabled={!selected || (creds?.candidates.length ?? 0) === 0}
          >
            Send
          </button>
        </div>
      </Modal>
    </>
  );
}
