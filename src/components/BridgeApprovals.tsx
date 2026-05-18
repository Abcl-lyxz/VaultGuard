import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, type CredsRequest, type PairRequest, type SaveRequest, type UpdateRequest } from "../lib/ipc";
import { Modal } from "./ui/Modal";

export function BridgeApprovals() {
  const [pairQueue, setPairQueue]     = useState<PairRequest[]>([]);
  const [credsQueue, setCredsQueue]   = useState<CredsRequest[]>([]);
  const [saveQueue, setSaveQueue]     = useState<SaveRequest[]>([]);
  const [updateQueue, setUpdateQueue] = useState<UpdateRequest[]>([]);
  const [selected, setSelected]       = useState<string | null>(null);
  const [saveName, setSaveName]       = useState<string>("");

  const pair    = pairQueue[0]    ?? null;
  const creds   = credsQueue[0]   ?? null;
  const save    = saveQueue[0]    ?? null;
  const upd     = updateQueue[0]  ?? null;

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
    listen<SaveRequest>("bridge:save_request", (e) => {
      setSaveQueue(q => {
        if (q.some(p => p.request_id === e.payload.request_id)) return q;
        if (q.length === 0) setSaveName(e.payload.host);
        return [...q, e.payload];
      });
    }).then((u) => unlistens.push(u));
    listen<UpdateRequest>("bridge:update_request", async (e) => {
      // Hydrate name + username from the vault on receipt — the bridge sends item_id only.
      let payload = e.payload;
      try {
        const item = await api.itemGet(payload.item_id);
        if (item && item.kind === "login") {
          const pl: any = item.payload;
          payload = { ...payload, item_name: item.name, username: pl.username ?? "" };
        }
      } catch {}
      setUpdateQueue(q => q.some(p => p.request_id === payload.request_id) ? q : [...q, payload]);
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

  async function decideSave(allow: boolean) {
    if (!save) return;
    const nm = (saveName || save.host).trim() || save.host;
    try { await api.bridgeSaveComplete(save.request_id, allow, allow ? nm : null); }
    finally {
      setSaveQueue(q => {
        const next = q.slice(1);
        setSaveName(next[0]?.host ?? "");
        return next;
      });
    }
  }

  async function decideUpdate(allow: boolean) {
    if (!upd) return;
    try { await api.bridgeUpdateComplete(upd.request_id, allow); }
    finally { setUpdateQueue(q => q.slice(1)); }
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

      <Modal open={!!save} onClose={() => decideSave(false)} title={saveQueue.length > 1 ? `Save new login? (${saveQueue.length} pending)` : "Save new login?"}>
        <p className="modal-subtitle">
          The browser captured a sign-in for{" "}
          <strong style={{ color: "var(--text-primary)" }}>{save?.host}</strong>{" "}
          (user <strong style={{ color: "var(--text-primary)" }}>{save?.username}</strong>).
          Add it to your vault?
        </p>
        <div className="field" style={{ marginTop: 8 }}>
          <label htmlFor="vg-save-name">Item name</label>
          <input
            id="vg-save-name"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder={save?.host ?? ""}
          />
        </div>
        <div className="modal-actions">
          <button className="ghost" onClick={() => decideSave(false)}>Not now</button>
          <button onClick={() => decideSave(true)} disabled={!(saveName.trim() || save?.host)}>Save</button>
        </div>
      </Modal>

      <Modal open={!!upd} onClose={() => decideUpdate(false)} title="Update password?">
        <p className="modal-subtitle">
          The browser saw a new password for{" "}
          <strong style={{ color: "var(--text-primary)" }}>{upd?.item_name || "this item"}</strong>
          {upd?.username ? <> (user <strong style={{ color: "var(--text-primary)" }}>{upd.username}</strong>)</> : null}.
          Replace the stored password in your vault?
        </p>
        <div className="modal-actions">
          <button className="ghost" onClick={() => decideUpdate(false)}>Keep old</button>
          <button onClick={() => decideUpdate(true)}>Update</button>
        </div>
      </Modal>
    </>
  );
}
