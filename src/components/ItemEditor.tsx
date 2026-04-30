import { useEffect, useState } from "react";
import { Copy, Eye, EyeOff, Star, StarOff, Vault, Wand2 } from "lucide-react";
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
import { Modal } from "./ui/Modal";
import { EmptyState } from "./ui/EmptyState";
import { useToast } from "../contexts/ToastContext";
import { usePasswordStrength } from "../hooks/usePasswordStrength";
import { usePrefs } from "../contexts/PrefsContext";

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
  const { toast } = useToast();
  const { prefs } = usePrefs();
  const [draft, setDraft]           = useState<Draft | null>(null);
  const [busy, setBusy]             = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [showGen, setShowGen]       = useState(false);
  const [genTarget, setGenTarget]   = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  useEffect(() => {
    if (itemId === null) { setDraft(null); return; }
    if (itemId === "new") { setDraft(newDraft()); return; }
    (async () => {
      const item = await api.itemGet(itemId);
      if (!item) { setError("Item not found"); return; }
      setDraft({ id: item.id, kind: item.kind, name: item.name, favorite: item.favorite, folder_id: item.folder_id, payload: item.payload });
    })();
  }, [itemId]);

  if (draft === null) {
    return (
      <EmptyState
        icon={<Vault size={48} color="var(--border)" />}
        title="Select an item"
        description="Choose an item from the sidebar or create a new one."
      />
    );
  }

  function updatePayload(patch: Partial<ItemPayload>) {
    setDraft((d) => (d ? { ...d, payload: { ...d.payload, ...patch } as ItemPayload } : d));
  }

  function changeKind(kind: ItemKind) {
    setDraft((d) => (d ? { ...d, kind, payload: emptyPayload(kind) } : d));
  }

  async function save() {
    if (!draft) return;
    setBusy(true); setError(null);
    try {
      if (draft.id === null) {
        await api.itemCreate({ kind: draft.kind, name: draft.name, favorite: draft.favorite, folder_id: draft.folder_id, payload: draft.payload });
      } else {
        await api.itemUpdate({ id: draft.id, kind: draft.kind, name: draft.name, favorite: draft.favorite, folder_id: draft.folder_id, payload: draft.payload });
      }
      toast("Saved successfully", "success");
      onSaved();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally { setBusy(false); }
  }

  async function remove() {
    if (!draft?.id) return;
    setBusy(true);
    try {
      await api.itemDelete(draft.id);
      toast("Item deleted", "info");
      onDeleted();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally { setBusy(false); setDeleteConfirm(false); }
  }

  function copy(text: string, label = "Copied") {
    api.clipboardCopy(text, prefs.clipboard_ttl_secs).catch(() => {});
    toast(`${label} — clears in ${prefs.clipboard_ttl_secs}s`, "success", 2500);
  }

  function openGen(field: string) { setGenTarget(field); setShowGen(true); }

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
          aria-label="Item name"
        />
        <button
          type="button"
          className={"fav-btn" + (draft.favorite ? " active" : "")}
          title={draft.favorite ? "Remove from favorites" : "Add to favorites"}
          aria-label={draft.favorite ? "Remove from favorites" : "Add to favorites"}
          onClick={() => setDraft({ ...draft, favorite: !draft.favorite })}
        >
          {draft.favorite
            ? <Star size={18} fill="var(--yellow)" color="var(--yellow)" />
            : <StarOff size={18} />}
        </button>
      </div>

      <div className="editor-meta">
        {draft.id === null && (
          <div className="field">
            <label htmlFor="item-kind">Kind</label>
            <select id="item-kind" value={draft.kind} onChange={(e) => changeKind(e.target.value as ItemKind)}>
              {ItemKindSchema.options.map((k) => (
                <option key={k} value={k}>{KIND_LABELS[k]}</option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor="item-folder">Folder</label>
          <select id="item-folder" value={draft.folder_id ?? ""} onChange={(e) => setDraft({ ...draft, folder_id: e.target.value || null })}>
            <option value="">— Unfiled —</option>
            {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
      </div>

      <PayloadFields payload={draft.payload} onChange={updatePayload} onCopy={copy} onGenerate={openGen} />

      {error && <p className="error">{error}</p>}

      <div className="editor-actions">
        <button className="ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        <span className="spacer" />
        {draft.id !== null && (
          <button className="danger" onClick={() => setDeleteConfirm(true)} disabled={busy} aria-label="Delete item">
            Delete
          </button>
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

      <Modal open={deleteConfirm} onClose={() => setDeleteConfirm(false)} title="Delete item">
        <p className="modal-subtitle">
          Delete <strong style={{ color: "var(--text-primary)" }}>{draft.name}</strong>? This cannot be undone.
        </p>
        <div className="modal-actions">
          <button className="ghost" onClick={() => setDeleteConfirm(false)} disabled={busy}>Cancel</button>
          <button className="danger" onClick={remove} disabled={busy}>Delete</button>
        </div>
      </Modal>
    </div>
  );
}

/* ── Field components ── */

type FieldsProps = {
  payload: ItemPayload;
  onChange: (p: Partial<ItemPayload>) => void;
  onCopy: (text: string, label?: string) => void;
  onGenerate: (field: string) => void;
};

function StrengthMeter({ value }: { value: string }) {
  const { score, label, color } = usePasswordStrength(value);
  if (!value) return null;
  return (
    <div>
      <div className="strength-bar">
        <div className="strength-fill" style={{ width: `${(score + 1) * 20}%`, background: color }} />
      </div>
      <span className="strength-label" style={{ color }}>{label}</span>
    </div>
  );
}

function SecretField({ label, value, onChange, onCopy, onGenerate, showStrength }: {
  label: string; value: string; onChange: (v: string) => void;
  onCopy?: () => void; onGenerate?: () => void; showStrength?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="field">
      <span>{label}</span>
      <div className="secret-row">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
        />
        <button type="button" className="btn-icon-sm" title={show ? "Hide" : "Show"} aria-label={show ? "Hide value" : "Show value"} onClick={() => setShow(s => !s)}>
          {show ? <EyeOff size={13} /> : <Eye size={13} />}
        </button>
        {onCopy && (
          <button type="button" className="btn-icon-sm" title="Copy" aria-label={`Copy ${label}`} onClick={onCopy}>
            <Copy size={13} />
          </button>
        )}
        {onGenerate && (
          <button type="button" className="btn-icon-sm" title="Generate" aria-label="Generate password" onClick={onGenerate}>
            <Wand2 size={13} />
          </button>
        )}
      </div>
      {showStrength && <StrengthMeter value={value} />}
    </div>
  );
}

function TextField({ label, value, onChange, textarea }: { label: string; value: string; onChange: (v: string) => void; textarea?: boolean }) {
  return (
    <div className="field">
      <label>{label}</label>
      {textarea
        ? <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={4} aria-label={label} />
        : <input value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} />}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="editor-section-title">{children}</div>;
}

function nullable(v: string | null | undefined): string { return v ?? ""; }
function orNull(v: string): string | null { return v.trim() === "" ? null : v; }

function PayloadFields({ payload, onChange, onCopy, onGenerate }: FieldsProps) {
  switch (payload.kind) {
    case "login":
      return (
        <div className="editor-section">
          <SectionTitle>Account details</SectionTitle>
          <TextField label="Username" value={payload.username} onChange={v => onChange({ username: v })} />
          <SecretField label="Password" value={payload.password} onChange={v => onChange({ password: v })}
            onCopy={() => onCopy(payload.password, "Password copied")}
            onGenerate={() => onGenerate("password")} showStrength />
          <TextField label="URL" value={nullable(payload.url)} onChange={v => onChange({ url: orNull(v) })} />
          <SectionTitle>Two-factor authentication</SectionTitle>
          <TextField label="TOTP secret" value={nullable(payload.totp_secret)} onChange={v => onChange({ totp_secret: orNull(v) })} />
          {payload.totp_secret && payload.totp_secret.trim().length >= 8 && (
            <div className="field">
              <span>Current code</span>
              <TotpBadge spec={{ secret: payload.totp_secret, algorithm: "SHA1", digits: 6, period: 30 }} onCopy={c => onCopy(c.replace(/\s/g, ""), "TOTP code copied")} />
            </div>
          )}
          <SectionTitle>Notes</SectionTitle>
          <TextField label="Notes" value={nullable(payload.notes)} onChange={v => onChange({ notes: orNull(v) })} textarea />
        </div>
      );
    case "card":
      return (
        <div className="editor-section">
          <SectionTitle>Card details</SectionTitle>
          <TextField label="Cardholder" value={payload.cardholder} onChange={v => onChange({ cardholder: v })} />
          <SecretField label="Number" value={payload.number} onChange={v => onChange({ number: v })} onCopy={() => onCopy(payload.number, "Card number copied")} />
          <SecretField label="CVV" value={payload.cvv} onChange={v => onChange({ cvv: v })} onCopy={() => onCopy(payload.cvv, "CVV copied")} />
          <div className="row-2">
            <div className="field">
              <label htmlFor="card-exp-month">Expiry month</label>
              <select id="card-exp-month" value={payload.expiry_month} onChange={e => onChange({ expiry_month: parseInt(e.target.value) })}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                  <option key={m} value={m}>{String(m).padStart(2, "0")}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="card-exp-year">Expiry year</label>
              <select id="card-exp-year" value={payload.expiry_year} onChange={e => onChange({ expiry_year: parseInt(e.target.value) })}>
                {Array.from({ length: 15 }, (_, i) => new Date().getFullYear() + i).map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          </div>
          <SectionTitle>Notes</SectionTitle>
          <TextField label="Notes" value={nullable(payload.notes)} onChange={v => onChange({ notes: orNull(v) })} textarea />
        </div>
      );
    case "pin_note":
      return (
        <div className="editor-section">
          <SectionTitle>Content</SectionTitle>
          <TextField label="Title" value={payload.title} onChange={v => onChange({ title: v })} />
          <TextField label="Body" value={payload.body} onChange={v => onChange({ body: v })} textarea />
        </div>
      );
    case "crypto_wallet":
      return (
        <div className="editor-section">
          <SectionTitle>Wallet details</SectionTitle>
          <TextField label="Wallet name" value={payload.wallet_name} onChange={v => onChange({ wallet_name: v })} />
          <SecretField label="Seed phrase" value={payload.seed_phrase} onChange={v => onChange({ seed_phrase: v })} onCopy={() => onCopy(payload.seed_phrase, "Seed phrase copied")} />
          <TextField label="Chain" value={nullable(payload.chain)} onChange={v => onChange({ chain: orNull(v) })} />
          <TextField label="Address" value={nullable(payload.address)} onChange={v => onChange({ address: orNull(v) })} />
          <SectionTitle>Notes</SectionTitle>
          <TextField label="Notes" value={nullable(payload.notes)} onChange={v => onChange({ notes: orNull(v) })} textarea />
        </div>
      );
    case "identity":
      return (
        <div className="editor-section">
          <SectionTitle>Personal details</SectionTitle>
          <TextField label="Full name" value={payload.full_name} onChange={v => onChange({ full_name: v })} />
          <TextField label="National ID" value={nullable(payload.national_id)} onChange={v => onChange({ national_id: orNull(v) })} />
          <TextField label="Passport" value={nullable(payload.passport)} onChange={v => onChange({ passport: orNull(v) })} />
          <SectionTitle>Contact</SectionTitle>
          <TextField label="Email" value={nullable(payload.email)} onChange={v => onChange({ email: orNull(v) })} />
          <TextField label="Phone" value={nullable(payload.phone)} onChange={v => onChange({ phone: orNull(v) })} />
          <TextField label="Address" value={nullable(payload.address)} onChange={v => onChange({ address: orNull(v) })} textarea />
          <SectionTitle>Notes</SectionTitle>
          <TextField label="Notes" value={nullable(payload.notes)} onChange={v => onChange({ notes: orNull(v) })} textarea />
        </div>
      );
    case "ssh_key":
      return (
        <div className="editor-section">
          <SectionTitle>SSH key</SectionTitle>
          <TextField label="Label" value={payload.label} onChange={v => onChange({ label: v })} />
          <SecretField label="Private key" value={payload.private_key} onChange={v => onChange({ private_key: v })} onCopy={() => onCopy(payload.private_key, "Private key copied")} />
          <TextField label="Public key" value={nullable(payload.public_key)} onChange={v => onChange({ public_key: orNull(v) })} textarea />
          <SecretField label="Passphrase" value={nullable(payload.passphrase)} onChange={v => onChange({ passphrase: orNull(v) })} />
        </div>
      );
    case "api_key":
      return (
        <div className="editor-section">
          <SectionTitle>API credentials</SectionTitle>
          <TextField label="Service" value={payload.service} onChange={v => onChange({ service: v })} />
          <SecretField label="Key" value={payload.key} onChange={v => onChange({ key: v })} onCopy={() => onCopy(payload.key, "API key copied")} />
          <SecretField label="Secret" value={nullable(payload.secret)} onChange={v => onChange({ secret: orNull(v) })} onCopy={() => onCopy(payload.secret ?? "", "Secret copied")} />
          <SectionTitle>Notes</SectionTitle>
          <TextField label="Notes" value={nullable(payload.notes)} onChange={v => onChange({ notes: orNull(v) })} textarea />
        </div>
      );
    case "totp":
      return (
        <div className="editor-section">
          <SectionTitle>TOTP authenticator</SectionTitle>
          <TextField label="Label" value={payload.label} onChange={v => onChange({ label: v })} />
          <SecretField label="Secret (Base32)" value={payload.secret} onChange={v => onChange({ secret: v })} onCopy={() => onCopy(payload.secret, "TOTP secret copied")} />
          <TextField label="Issuer" value={nullable(payload.issuer)} onChange={v => onChange({ issuer: orNull(v) })} />
          <div className="row-3">
            <div className="field">
              <label htmlFor="totp-algo">Algorithm</label>
              <select id="totp-algo" value={payload.algorithm} onChange={e => onChange({ algorithm: e.target.value })}>
                <option>SHA1</option><option>SHA256</option><option>SHA512</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="totp-digits">Digits</label>
              <select id="totp-digits" value={payload.digits} onChange={e => onChange({ digits: parseInt(e.target.value) })}>
                <option value={6}>6</option><option value={8}>8</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="totp-period">Period (s)</label>
              <select id="totp-period" value={payload.period} onChange={e => onChange({ period: parseInt(e.target.value) })}>
                <option value={30}>30</option><option value={60}>60</option>
              </select>
            </div>
          </div>
          {payload.secret && payload.secret.trim().length >= 8 && (
            <div className="field">
              <span>Current code</span>
              <TotpBadge spec={{ secret: payload.secret, algorithm: payload.algorithm, digits: payload.digits, period: payload.period }} onCopy={c => onCopy(c.replace(/\s/g, ""), "TOTP code copied")} />
            </div>
          )}
        </div>
      );
  }
}
