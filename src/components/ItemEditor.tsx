import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Eye, EyeOff, Star, StarOff, Trash2, Vault, Wand2 } from "lucide-react";
import { api, type Folder as FolderT } from "../lib/ipc";
import {
  emptyPayload,
  ItemKindSchema,
  ItemPayloadSchema,
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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const originalRef = useRef<Draft | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (itemId === null) { setDraft(null); originalRef.current = null; setFieldErrors({}); return; }
    if (itemId === "new") {
      const d = newDraft();
      setDraft(d);
      originalRef.current = d;
      setFieldErrors({});
      setTimeout(() => nameInputRef.current?.focus(), 0);
      return;
    }
    (async () => {
      try {
        const item = await api.itemGet(itemId);
        if (!item) { setError("Item not found"); return; }
        const d: Draft = { id: item.id, kind: item.kind, name: item.name, favorite: item.favorite, folder_id: item.folder_id, payload: item.payload };
        setDraft(d);
        originalRef.current = d;
        setFieldErrors({});
      } catch (e: any) {
        console.error("[item_get]", e);
        setError(formatErr(e));
      }
    })();
  }, [itemId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !showGen && !deleteConfirm) {
        if (!isDirty() || window.confirm("Discard changes?")) onCancel();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft, showGen, deleteConfirm]);

  const payloadValidation = useMemo(() => {
    if (!draft) return { ok: true as const };
    const errs = validatePayloadInput(normalizePayload(draft.payload));
    if (Object.keys(errs).length === 0) return { ok: true as const };
    return { ok: false as const, errors: errs };
  }, [draft]);

  if (draft === null) {
    return (
      <EmptyState
        icon={<Vault size={48} color="var(--border)" />}
        title="Select an item"
        description="Choose an item from the sidebar or create a new one."
      />
    );
  }

  function isDirty() {
    return draft !== null && JSON.stringify(draft) !== JSON.stringify(originalRef.current);
  }

  function updatePayload(patch: Partial<ItemPayload>) {
    setDraft((d) => (d ? { ...d, payload: { ...d.payload, ...patch } as ItemPayload } : d));
  }

  function changeKind(kind: ItemKind) {
    if (isDirty() && !window.confirm("Switch kind? Unsaved changes will be discarded.")) return;
    const d: Draft = { id: null, kind, name: draft?.name ?? "", favorite: draft?.favorite ?? false, folder_id: draft?.folder_id ?? null, payload: emptyPayload(kind) };
    originalRef.current = d;
    setDraft(d);
  }

  async function save() {
    if (!draft) return;
    if (!draft.name.trim()) {
      setError("Name is required.");
      toast("Name is required.", "error");
      nameInputRef.current?.focus();
      return;
    }
    const normalized = normalizePayload(draft.payload);
    const errs = validatePayloadInput(normalized);
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      const first = Object.values(errs)[0] ?? "Please fix the highlighted fields.";
      setError(first);
      toast(first, "error");
      return;
    }
    const parsed = ItemPayloadSchema.safeParse(normalized);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Invalid payload";
      console.error("[zod_parse]", parsed.error.issues);
      setError(msg);
      toast(msg, "error");
      return;
    }
    setFieldErrors({});
    setBusy(true); setError(null);
    const finalPayload = parsed.data;
    try {
      if (draft.id === null) {
        await api.itemCreate({ kind: draft.kind, name: draft.name.trim(), favorite: draft.favorite, folder_id: draft.folder_id, payload: finalPayload });
      } else {
        await api.itemUpdate({ id: draft.id, kind: draft.kind, name: draft.name.trim(), favorite: draft.favorite, folder_id: draft.folder_id, payload: finalPayload });
      }
      originalRef.current = { ...draft, payload: finalPayload };
      toast("Saved successfully", "success");
      onSaved();
    } catch (e: any) {
      console.error("[item_save]", e);
      const msg = formatErr(e);
      setError(msg);
      toast(msg, "error");
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
      console.error("[item_delete]", e);
      const msg = formatErr(e);
      setError(msg);
      toast(msg, "error");
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
    <div className="editor" key={draft.id ?? "new"}>
      <div className="editor-head">
        <input
          ref={nameInputRef}
          className="name-input"
          type="text"
          placeholder="Item name"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          aria-label="Item name"
          aria-required="true"
          maxLength={120}
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
        {draft.id !== null && (
          <button
            type="button"
            className="fav-btn danger-icon-btn"
            title="Delete item"
            aria-label="Delete item"
            onClick={() => setDeleteConfirm(true)}
            disabled={busy}
          >
            <Trash2 size={18} />
          </button>
        )}
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

      <PayloadFields payload={draft.payload} onChange={updatePayload} onCopy={copy} onGenerate={openGen} errors={fieldErrors} />

      {error && <p className="error">{error}</p>}

      <div className="editor-actions">
        <button className="ghost" onClick={() => { if (!isDirty() || window.confirm("Discard changes?")) onCancel(); }} disabled={busy}>Cancel</button>
        <span className="spacer" />
        {draft.id !== null && (
          <button className="danger" onClick={() => setDeleteConfirm(true)} disabled={busy} aria-label="Delete item">
            Delete
          </button>
        )}
        <button
          onClick={save}
          disabled={busy || !draft.name.trim() || !payloadValidation.ok}
          title={!payloadValidation.ok ? "Fill required fields correctly" : undefined}
        >
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
  errors: Record<string, string>;
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

type FieldRule = {
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  pattern?: string;
  maxLength?: number;
  type?: string;
  autoCapitalize?: string;
  transform?: (v: string) => string;
};

function SecretField({ label, value, onChange, onCopy, onGenerate, showStrength, requireReveal, required, error, rule, hint }: {
  label: string; value: string; onChange: (v: string) => void;
  onCopy?: () => void; onGenerate?: () => void; showStrength?: boolean;
  requireReveal?: boolean; required?: boolean; error?: string; rule?: FieldRule; hint?: string;
}) {
  const [show, setShow] = useState(false);
  const [revealSecs, setRevealSecs] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function startReveal() {
    setShow(true);
    setRevealSecs(10);
    timerRef.current = setInterval(() => {
      setRevealSecs(s => {
        if (s <= 1) {
          clearInterval(timerRef.current!);
          timerRef.current = null;
          setShow(false);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }

  function hideNow() {
    setShow(false);
    setRevealSecs(0);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const copyEnabled = !requireReveal || (show && revealSecs > 0);

  return (
    <div className="field">
      <span>{label}{required && <span className="field-required"> *</span>}</span>
      <div className="secret-row">
        <input
          type={show ? (rule?.type ?? "text") : "password"}
          value={value}
          onChange={(e) => onChange(rule?.transform ? rule.transform(e.target.value) : e.target.value)}
          aria-label={label}
          aria-invalid={!!error}
          inputMode={rule?.inputMode}
          pattern={rule?.pattern}
          maxLength={rule?.maxLength}
          autoCapitalize={rule?.autoCapitalize}
        />
        {requireReveal ? (
          show ? (
            <button type="button" className="btn-icon-sm" title={`Hide (${revealSecs}s)`} aria-label="Hide value" onClick={hideNow}>
              <EyeOff size={13} />
            </button>
          ) : (
            <button type="button" className="btn-icon-sm" title="Reveal" aria-label="Reveal value" onClick={startReveal}>
              <Eye size={13} />
            </button>
          )
        ) : (
          <button type="button" className="btn-icon-sm" title={show ? "Hide" : "Show"} aria-label={show ? "Hide value" : "Show value"} onClick={() => setShow(s => !s)}>
            {show ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        )}
        {onCopy && (
          <button type="button" className="btn-icon-sm" title={copyEnabled ? "Copy" : "Reveal first"} aria-label={`Copy ${label}`} onClick={onCopy} disabled={!copyEnabled}>
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
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && <span className="field-hint field-hint-error">{error}</span>}
    </div>
  );
}

function TextField({ label, value, onChange, textarea, required, error, rule, hint }: {
  label: string; value: string; onChange: (v: string) => void;
  textarea?: boolean; required?: boolean; error?: string; rule?: FieldRule; hint?: string;
}) {
  return (
    <div className="field">
      <label>{label}{required && <span className="field-required"> *</span>}</label>
      {textarea
        ? <textarea
            value={value}
            onChange={(e) => onChange(rule?.transform ? rule.transform(e.target.value) : e.target.value)}
            rows={4}
            aria-label={label}
            aria-invalid={!!error}
            maxLength={rule?.maxLength}
          />
        : <input
            type={rule?.type ?? "text"}
            value={value}
            onChange={(e) => onChange(rule?.transform ? rule.transform(e.target.value) : e.target.value)}
            aria-label={label}
            aria-invalid={!!error}
            inputMode={rule?.inputMode}
            pattern={rule?.pattern}
            maxLength={rule?.maxLength}
            autoCapitalize={rule?.autoCapitalize}
          />}
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && <span className="field-hint field-hint-error">{error}</span>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="editor-section-title">{children}</div>;
}

function nullable(v: string | null | undefined): string { return v ?? ""; }
function orNull(v: string): string | null { return v.trim() === "" ? null : v; }

function formatErr(e: any): string {
  if (typeof e === "string") return e;
  return e?.message ?? e?.error ?? (() => { try { return JSON.stringify(e); } catch { return "Unknown error"; } })();
}

function normalizeUrl(v: string | null): string | null {
  if (!v) return null;
  const t = v.trim();
  if (!t) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return t;
  return `https://${t}`;
}

function normalizePayload(p: ItemPayload): ItemPayload {
  switch (p.kind) {
    case "login":
      return { ...p, username: p.username.trim(), url: normalizeUrl(p.url), totp_secret: p.totp_secret ? p.totp_secret.toUpperCase().replace(/\s+/g, "") : null };
    case "card":
      return { ...p, cardholder: p.cardholder.trim().toUpperCase(), number: p.number.replace(/\D/g, ""), cvv: p.cvv.replace(/\D/g, "") };
    case "identity":
      return { ...p, full_name: p.full_name.trim(), email: p.email?.trim() || null, phone: p.phone?.trim() || null, national_id: p.national_id?.trim() || null, passport: p.passport?.trim() || null };
    case "crypto_wallet":
      return { ...p, wallet_name: p.wallet_name.trim(), seed_phrase: p.seed_phrase.trim(), address: p.address?.trim() || null };
    case "totp":
      return { ...p, label: p.label.trim(), secret: p.secret.toUpperCase().replace(/\s+/g, "") };
    case "api_key":
      return { ...p, service: p.service.trim(), key: p.key.trim() };
    case "ssh_key":
      return { ...p, label: p.label.trim() };
    case "pin_note":
      return { ...p, title: p.title.trim() };
  }
}

const RULE_DIGITS_19: FieldRule = { inputMode: "numeric", pattern: "\\d*", maxLength: 19, transform: (v) => v.replace(/\D/g, "").slice(0, 19) };
const RULE_DIGITS_CVV: FieldRule = { inputMode: "numeric", pattern: "\\d{3,4}", maxLength: 4, transform: (v) => v.replace(/\D/g, "").slice(0, 4) };
const RULE_PHONE: FieldRule = { inputMode: "tel", pattern: "[\\d+\\-() ]*", maxLength: 20, transform: (v) => v.replace(/[^\d+\-() ]/g, "").slice(0, 20) };
const RULE_EMAIL: FieldRule = { type: "email", inputMode: "email", maxLength: 254 };
const RULE_URL: FieldRule = { inputMode: "url", maxLength: 2000 };
const RULE_CARDHOLDER: FieldRule = { autoCapitalize: "characters", maxLength: 60, transform: (v) => v.toUpperCase() };
const RULE_BASE32: FieldRule = { maxLength: 256, transform: (v) => v.toUpperCase().replace(/[^A-Z2-7=]/g, "") };
const RULE_TEXT_120: FieldRule = { maxLength: 120 };
const RULE_TEXT_200: FieldRule = { maxLength: 200 };

function base32Hint(secret: string): string | undefined {
  if (!secret) return undefined;
  if (!/^[A-Z2-7]+=*$/.test(secret)) return "Must be Base32 (A–Z, 2–7)";
  if (secret.length < 16) return "Most TOTP secrets are at least 16 characters";
  return undefined;
}

function validatePayloadInput(p: ItemPayload): Record<string, string> {
  const errs: Record<string, string> = {};
  const req = (k: string, v: string, msg = "Required") => { if (!v.trim()) errs[k] = msg; };
  switch (p.kind) {
    case "login":
      req("username", p.username);
      req("password", p.password);
      if (p.totp_secret && p.totp_secret.trim() && !/^[A-Z2-7]+=*$/.test(p.totp_secret)) errs["totp_secret"] = "Must be Base32";
      break;
    case "card":
      req("cardholder", p.cardholder);
      req("number", p.number);
      req("cvv", p.cvv);
      if (p.number && p.number.length < 12) errs["number"] = "Card number is too short";
      if (p.cvv && p.cvv.length < 3) errs["cvv"] = "CVV must be 3–4 digits";
      break;
    case "pin_note":
      req("title", p.title);
      req("body", p.body);
      break;
    case "crypto_wallet":
      req("wallet_name", p.wallet_name);
      req("seed_phrase", p.seed_phrase);
      break;
    case "identity":
      req("full_name", p.full_name);
      if (p.email && p.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) errs["email"] = "Invalid email";
      break;
    case "ssh_key":
      req("label", p.label);
      req("private_key", p.private_key);
      break;
    case "api_key":
      req("service", p.service);
      req("key", p.key);
      break;
    case "totp":
      req("label", p.label);
      req("secret", p.secret);
      if (p.secret && !/^[A-Z2-7]+=*$/.test(p.secret)) errs["secret"] = "Must be Base32 (A–Z, 2–7)";
      if (p.secret && /^[A-Z2-7]+=*$/.test(p.secret) && p.secret.length < 16) errs["secret"] = "TOTP secret too short";
      break;
  }
  return errs;
}

function seedPhraseHint(seed: string): string | undefined {
  if (!seed) return undefined;
  const words = seed.trim().split(/\s+/).length;
  if (![12, 15, 18, 21, 24].includes(words)) return `${words} words — BIP39 expects 12/15/18/21/24`;
  return undefined;
}

function PayloadFields({ payload, onChange, onCopy, onGenerate, errors }: FieldsProps) {
  switch (payload.kind) {
    case "login":
      return (
        <div className="editor-section">
          <SectionTitle>Account details</SectionTitle>
          <TextField label="Username" required value={payload.username} onChange={v => onChange({ username: v })} error={errors["username"]} rule={RULE_TEXT_200} />
          <SecretField label="Password" required value={payload.password} onChange={v => onChange({ password: v })}
            onCopy={() => onCopy(payload.password, "Password copied")}
            onGenerate={() => onGenerate("password")} showStrength error={errors["password"]} />
          <TextField label="URL" value={nullable(payload.url)} onChange={v => onChange({ url: orNull(v) })} rule={RULE_URL} hint="https:// is added automatically if omitted" />
          <SectionTitle>Two-factor authentication</SectionTitle>
          <TextField label="TOTP secret" value={nullable(payload.totp_secret)} onChange={v => onChange({ totp_secret: orNull(v) })} rule={RULE_BASE32} hint={base32Hint(nullable(payload.totp_secret))} />
          {payload.totp_secret && payload.totp_secret.trim().length >= 8 && /^[A-Z2-7]+=*$/.test(payload.totp_secret) && (
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
          <TextField label="Cardholder" required value={payload.cardholder} onChange={v => onChange({ cardholder: v })} error={errors["cardholder"]} rule={RULE_CARDHOLDER} />
          <SecretField label="Number" required value={payload.number} onChange={v => onChange({ number: v })} onCopy={() => onCopy(payload.number, "Card number copied")} requireReveal error={errors["number"]} rule={RULE_DIGITS_19} hint="Digits only, up to 19" />
          <SecretField label="CVV" required value={payload.cvv} onChange={v => onChange({ cvv: v })} onCopy={() => onCopy(payload.cvv, "CVV copied")} requireReveal error={errors["cvv"]} rule={RULE_DIGITS_CVV} hint="3 or 4 digits" />
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
          <TextField label="Title" required value={payload.title} onChange={v => onChange({ title: v })} error={errors["title"]} rule={RULE_TEXT_120} />
          <TextField label="Body" required value={payload.body} onChange={v => onChange({ body: v })} textarea error={errors["body"]} />
        </div>
      );
    case "crypto_wallet":
      return (
        <div className="editor-section">
          <SectionTitle>Wallet details</SectionTitle>
          <TextField label="Wallet name" required value={payload.wallet_name} onChange={v => onChange({ wallet_name: v })} error={errors["wallet_name"]} rule={RULE_TEXT_120} />
          <SecretField label="Seed phrase" required value={payload.seed_phrase} onChange={v => onChange({ seed_phrase: v })} onCopy={() => onCopy(payload.seed_phrase, "Seed phrase copied")} requireReveal error={errors["seed_phrase"]} hint={seedPhraseHint(payload.seed_phrase)} />
          <TextField label="Chain" value={nullable(payload.chain)} onChange={v => onChange({ chain: orNull(v) })} rule={RULE_TEXT_120} />
          <TextField label="Address" value={nullable(payload.address)} onChange={v => onChange({ address: orNull(v) })} rule={RULE_TEXT_200} />
          <SectionTitle>Notes</SectionTitle>
          <TextField label="Notes" value={nullable(payload.notes)} onChange={v => onChange({ notes: orNull(v) })} textarea />
        </div>
      );
    case "identity":
      return (
        <div className="editor-section">
          <SectionTitle>Personal details</SectionTitle>
          <TextField label="Full name" required value={payload.full_name} onChange={v => onChange({ full_name: v })} error={errors["full_name"]} rule={RULE_TEXT_120} />
          <TextField label="National ID" value={nullable(payload.national_id)} onChange={v => onChange({ national_id: orNull(v) })} rule={{ maxLength: 30 }} />
          <TextField label="Passport" value={nullable(payload.passport)} onChange={v => onChange({ passport: orNull(v) })} rule={{ maxLength: 30 }} />
          <SectionTitle>Contact</SectionTitle>
          <TextField label="Email" value={nullable(payload.email)} onChange={v => onChange({ email: orNull(v) })} rule={RULE_EMAIL} />
          <TextField label="Phone" value={nullable(payload.phone)} onChange={v => onChange({ phone: orNull(v) })} rule={RULE_PHONE} />
          <TextField label="Address" value={nullable(payload.address)} onChange={v => onChange({ address: orNull(v) })} textarea />
          <SectionTitle>Notes</SectionTitle>
          <TextField label="Notes" value={nullable(payload.notes)} onChange={v => onChange({ notes: orNull(v) })} textarea />
        </div>
      );
    case "ssh_key":
      return (
        <div className="editor-section">
          <SectionTitle>SSH key</SectionTitle>
          <TextField label="Label" required value={payload.label} onChange={v => onChange({ label: v })} error={errors["label"]} rule={RULE_TEXT_120} />
          <SecretField label="Private key" required value={payload.private_key} onChange={v => onChange({ private_key: v })} onCopy={() => onCopy(payload.private_key, "Private key copied")} requireReveal error={errors["private_key"]} hint={payload.private_key && !payload.private_key.startsWith("-----BEGIN") ? "Usually starts with -----BEGIN" : undefined} />
          <TextField label="Public key" value={nullable(payload.public_key)} onChange={v => onChange({ public_key: orNull(v) })} textarea />
          <SecretField label="Passphrase" value={nullable(payload.passphrase)} onChange={v => onChange({ passphrase: orNull(v) })} />
        </div>
      );
    case "api_key":
      return (
        <div className="editor-section">
          <SectionTitle>API credentials</SectionTitle>
          <TextField label="Service" required value={payload.service} onChange={v => onChange({ service: v })} error={errors["service"]} rule={RULE_TEXT_120} />
          <SecretField label="Key" required value={payload.key} onChange={v => onChange({ key: v })} onCopy={() => onCopy(payload.key, "API key copied")} error={errors["key"]} />
          <SecretField label="Secret" value={nullable(payload.secret)} onChange={v => onChange({ secret: orNull(v) })} onCopy={() => onCopy(payload.secret ?? "", "Secret copied")} />
          <SectionTitle>Notes</SectionTitle>
          <TextField label="Notes" value={nullable(payload.notes)} onChange={v => onChange({ notes: orNull(v) })} textarea />
        </div>
      );
    case "totp":
      return (
        <div className="editor-section">
          <SectionTitle>TOTP authenticator</SectionTitle>
          <TextField label="Label" required value={payload.label} onChange={v => onChange({ label: v })} error={errors["label"]} rule={RULE_TEXT_120} />
          <SecretField label="Secret (Base32)" required value={payload.secret} onChange={v => onChange({ secret: v })} onCopy={() => onCopy(payload.secret, "TOTP secret copied")} error={errors["secret"]} rule={RULE_BASE32} hint={base32Hint(payload.secret)} />
          <TextField label="Issuer" value={nullable(payload.issuer)} onChange={v => onChange({ issuer: orNull(v) })} rule={RULE_TEXT_120} />
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
