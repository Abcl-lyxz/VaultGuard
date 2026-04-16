import { useEffect, useState } from "react";
import { api, type Folder as FolderT } from "../lib/ipc";
import {
  emptyPayload,
  ItemKindSchema,
  KIND_LABELS,
  type ItemKind,
  type ItemPayload,
} from "../lib/schemas";
import { PasswordGenerator } from "./PasswordGenerator";
import { TotpBadge } from "./TotpBadge";

type Props = {
  itemId: string | "new" | null;
  folders: FolderT[];
  onSaved: () => void;
  onDeleted: () => void;
  onCancel: () => void;
};

type Draft = {
  id: string | null;
  kind: ItemKind;
  name: string;
  favorite: boolean;
  folder_id: string | null;
  payload: ItemPayload;
};

function newDraft(kind: ItemKind = "login"): Draft {
  return { id: null, kind, name: "", favorite: false, folder_id: null, payload: emptyPayload(kind) };
}

export function ItemEditor({ itemId, folders, onSaved, onDeleted, onCancel }: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showGen, setShowGen] = useState(false);
  const [genTarget, setGenTarget] = useState<string | null>(null);

  useEffect(() => {
    if (itemId === null) {
      setDraft(null);
      return;
    }
    if (itemId === "new") {
      setDraft(newDraft());
      return;
    }
    (async () => {
      const item = await api.itemGet(itemId);
      if (!item) {
        setError("Item not found");
        return;
      }
      setDraft({
        id: item.id,
        kind: item.kind,
        name: item.name,
        favorite: item.favorite,
        folder_id: item.folder_id,
        payload: item.payload,
      });
    })();
  }, [itemId]);

  if (draft === null) {
    return <div className="editor empty"><p>Select an item or create a new one.</p></div>;
  }

  function updatePayload(patch: Partial<ItemPayload>) {
    setDraft((d) => (d ? { ...d, payload: { ...d.payload, ...patch } as ItemPayload } : d));
  }

  function changeKind(kind: ItemKind) {
    setDraft((d) => (d ? { ...d, kind, payload: emptyPayload(kind) } : d));
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      if (draft.id === null) {
        await api.itemCreate({
          kind: draft.kind,
          name: draft.name,
          favorite: draft.favorite,
          folder_id: draft.folder_id,
          payload: draft.payload,
        });
      } else {
        await api.itemUpdate({
          id: draft.id,
          kind: draft.kind,
          name: draft.name,
          favorite: draft.favorite,
          folder_id: draft.folder_id,
          payload: draft.payload,
        });
      }
      onSaved();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!draft?.id) return;
    if (!confirm("Delete this item? This cannot be undone.")) return;
    setBusy(true);
    try {
      await api.itemDelete(draft.id);
      onDeleted();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  function copy(text: string) {
    api.clipboardCopy(text, 20).catch(() => {});
  }

  function openGen(field: string) {
    setGenTarget(field);
    setShowGen(true);
  }

  function applyGen(pw: string) {
    if (!draft || !genTarget) return;
    updatePayload({ [genTarget]: pw } as any);
    setGenTarget(null);
  }

  return (
    <div className="editor">
      <div className="editor-head">
        <input
          className="name-input"
          placeholder="Item name"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
        <label className="fav">
          <input
            type="checkbox"
            checked={draft.favorite}
            onChange={(e) => setDraft({ ...draft, favorite: e.target.checked })}
          />
          ★
        </label>
      </div>

      <div className="row-2">
        {draft.id === null && (
          <label className="field">
            <span>Kind</span>
            <select value={draft.kind} onChange={(e) => changeKind(e.target.value as ItemKind)}>
              {ItemKindSchema.options.map((k) => (
                <option key={k} value={k}>{KIND_LABELS[k]}</option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span>Folder</span>
          <select
            value={draft.folder_id ?? ""}
            onChange={(e) => setDraft({ ...draft, folder_id: e.target.value || null })}
          >
            <option value="">— Unfiled —</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </label>
      </div>

      <PayloadFields
        payload={draft.payload}
        onChange={updatePayload}
        onCopy={copy}
        onGenerate={openGen}
      />

      {error && <p className="error">{error}</p>}
      <div className="editor-actions">
        <button className="ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        {draft.id !== null && (
          <button className="danger" onClick={remove} disabled={busy}>Delete</button>
        )}
        <button onClick={save} disabled={busy || !draft.name.trim()}>
          {busy ? "Saving…" : draft.id ? "Save" : "Create"}
        </button>
      </div>

      {showGen && (
        <PasswordGenerator
          onUse={applyGen}
          onClose={() => { setShowGen(false); setGenTarget(null); }}
        />
      )}
    </div>
  );
}

type FieldsProps = {
  payload: ItemPayload;
  onChange: (p: Partial<ItemPayload>) => void;
  onCopy: (text: string) => void;
  onGenerate: (field: string) => void;
};

function SecretField({
  label,
  value,
  onChange,
  onCopy,
  onGenerate,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onCopy?: () => void;
  onGenerate?: () => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <label className="field">
      <span>{label}</span>
      <div className="secret-row">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button type="button" className="ghost small" onClick={() => setShow((s) => !s)}>
          {show ? "hide" : "show"}
        </button>
        {onCopy && (
          <button type="button" className="ghost small" onClick={onCopy}>copy</button>
        )}
        {onGenerate && (
          <button type="button" className="ghost small" onClick={onGenerate}>gen</button>
        )}
      </div>
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
  textarea,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  textarea?: boolean;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {textarea ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={4} />
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}

function nullable(v: string | null | undefined): string {
  return v ?? "";
}
function orNull(v: string): string | null {
  return v.trim() === "" ? null : v;
}

function PayloadFields({ payload, onChange, onCopy, onGenerate }: FieldsProps) {
  switch (payload.kind) {
    case "login":
      return (
        <>
          <TextField label="Username" value={payload.username} onChange={(v) => onChange({ username: v })} />
          <SecretField
            label="Password"
            value={payload.password}
            onChange={(v) => onChange({ password: v })}
            onCopy={() => onCopy(payload.password)}
            onGenerate={() => onGenerate("password")}
          />
          <TextField label="URL" value={nullable(payload.url)} onChange={(v) => onChange({ url: orNull(v) })} />
          <TextField label="TOTP secret" value={nullable(payload.totp_secret)} onChange={(v) => onChange({ totp_secret: orNull(v) })} />
          {payload.totp_secret && payload.totp_secret.trim().length >= 8 && (
            <div className="field">
              <span>TOTP code</span>
              <TotpBadge
                spec={{ secret: payload.totp_secret, algorithm: "SHA1", digits: 6, period: 30 }}
                onCopy={(c) => onCopy(c.replace(/\s/g, ""))}
              />
            </div>
          )}
          <TextField label="Notes" value={nullable(payload.notes)} onChange={(v) => onChange({ notes: orNull(v) })} textarea />
        </>
      );
    case "card":
      return (
        <>
          <TextField label="Cardholder" value={payload.cardholder} onChange={(v) => onChange({ cardholder: v })} />
          <SecretField label="Number" value={payload.number} onChange={(v) => onChange({ number: v })} onCopy={() => onCopy(payload.number)} />
          <SecretField label="CVV" value={payload.cvv} onChange={(v) => onChange({ cvv: v })} onCopy={() => onCopy(payload.cvv)} />
          <div className="row-2">
            <label className="field">
              <span>Expiry month</span>
              <input type="number" min={1} max={12} value={payload.expiry_month} onChange={(e) => onChange({ expiry_month: Number(e.target.value) })} />
            </label>
            <label className="field">
              <span>Expiry year</span>
              <input type="number" min={2000} max={2099} value={payload.expiry_year} onChange={(e) => onChange({ expiry_year: Number(e.target.value) })} />
            </label>
          </div>
          <TextField label="Notes" value={nullable(payload.notes)} onChange={(v) => onChange({ notes: orNull(v) })} textarea />
        </>
      );
    case "pin_note":
      return (
        <>
          <TextField label="Title" value={payload.title} onChange={(v) => onChange({ title: v })} />
          <TextField label="Body" value={payload.body} onChange={(v) => onChange({ body: v })} textarea />
        </>
      );
    case "crypto_wallet":
      return (
        <>
          <TextField label="Wallet name" value={payload.wallet_name} onChange={(v) => onChange({ wallet_name: v })} />
          <SecretField label="Seed phrase" value={payload.seed_phrase} onChange={(v) => onChange({ seed_phrase: v })} onCopy={() => onCopy(payload.seed_phrase)} />
          <TextField label="Chain" value={nullable(payload.chain)} onChange={(v) => onChange({ chain: orNull(v) })} />
          <TextField label="Address" value={nullable(payload.address)} onChange={(v) => onChange({ address: orNull(v) })} />
          <TextField label="Notes" value={nullable(payload.notes)} onChange={(v) => onChange({ notes: orNull(v) })} textarea />
        </>
      );
    case "identity":
      return (
        <>
          <TextField label="Full name" value={payload.full_name} onChange={(v) => onChange({ full_name: v })} />
          <TextField label="National ID" value={nullable(payload.national_id)} onChange={(v) => onChange({ national_id: orNull(v) })} />
          <TextField label="Passport" value={nullable(payload.passport)} onChange={(v) => onChange({ passport: orNull(v) })} />
          <TextField label="Email" value={nullable(payload.email)} onChange={(v) => onChange({ email: orNull(v) })} />
          <TextField label="Phone" value={nullable(payload.phone)} onChange={(v) => onChange({ phone: orNull(v) })} />
          <TextField label="Address" value={nullable(payload.address)} onChange={(v) => onChange({ address: orNull(v) })} textarea />
          <TextField label="Notes" value={nullable(payload.notes)} onChange={(v) => onChange({ notes: orNull(v) })} textarea />
        </>
      );
    case "ssh_key":
      return (
        <>
          <TextField label="Label" value={payload.label} onChange={(v) => onChange({ label: v })} />
          <SecretField label="Private key" value={payload.private_key} onChange={(v) => onChange({ private_key: v })} onCopy={() => onCopy(payload.private_key)} />
          <TextField label="Public key" value={nullable(payload.public_key)} onChange={(v) => onChange({ public_key: orNull(v) })} textarea />
          <SecretField label="Passphrase" value={nullable(payload.passphrase)} onChange={(v) => onChange({ passphrase: orNull(v) })} />
        </>
      );
    case "api_key":
      return (
        <>
          <TextField label="Service" value={payload.service} onChange={(v) => onChange({ service: v })} />
          <SecretField label="Key" value={payload.key} onChange={(v) => onChange({ key: v })} onCopy={() => onCopy(payload.key)} />
          <SecretField label="Secret" value={nullable(payload.secret)} onChange={(v) => onChange({ secret: orNull(v) })} onCopy={() => onCopy(payload.secret ?? "")} />
          <TextField label="Notes" value={nullable(payload.notes)} onChange={(v) => onChange({ notes: orNull(v) })} textarea />
        </>
      );
    case "totp":
      return (
        <>
          <TextField label="Label" value={payload.label} onChange={(v) => onChange({ label: v })} />
          <SecretField label="Secret (Base32)" value={payload.secret} onChange={(v) => onChange({ secret: v })} onCopy={() => onCopy(payload.secret)} />
          <TextField label="Issuer" value={nullable(payload.issuer)} onChange={(v) => onChange({ issuer: orNull(v) })} />
          <div className="row-2">
            <label className="field"><span>Algorithm</span><select value={payload.algorithm} onChange={(e) => onChange({ algorithm: e.target.value })}><option>SHA1</option><option>SHA256</option><option>SHA512</option></select></label>
            <label className="field"><span>Digits</span><input type="number" min={6} max={8} value={payload.digits} onChange={(e) => onChange({ digits: Number(e.target.value) })} /></label>
            <label className="field"><span>Period (s)</span><input type="number" min={10} max={120} value={payload.period} onChange={(e) => onChange({ period: Number(e.target.value) })} /></label>
          </div>
          {payload.secret && payload.secret.trim().length >= 8 && (
            <div className="field">
              <span>Current code</span>
              <TotpBadge
                spec={{ secret: payload.secret, algorithm: payload.algorithm, digits: payload.digits, period: payload.period }}
                onCopy={(c) => onCopy(c.replace(/\s/g, ""))}
              />
            </div>
          )}
        </>
      );
  }
}
