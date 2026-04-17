import { useEffect, useMemo, useState } from "react";
import {
  CreditCard,
  FolderPlus,
  Globe,
  Key,
  Lock,
  Pencil,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  StickyNote,
  Star,
  Terminal,
  UserRound,
  Vault,
  Wallet,
  X,
} from "lucide-react";
import { api, type Folder as FolderT } from "../lib/ipc";
import { KIND_LABELS, type ItemKind, type ItemSummary } from "../lib/schemas";
import { ItemEditor } from "./ItemEditor";
import { SettingsModal } from "./SettingsModal";
import { BridgeApprovals } from "./BridgeApprovals";
import { AutofillPicker } from "./AutofillPicker";
import { fuzzyScore } from "../lib/fuzzy";
import { useIdleLock } from "../lib/useIdleLock";

type Props = { onLock: () => void };
type FolderFilter = "all" | "favorites" | string;

const KIND_ICONS: Record<ItemKind, React.ReactNode> = {
  login:         <Globe size={15} />,
  card:          <CreditCard size={15} />,
  pin_note:      <StickyNote size={15} />,
  crypto_wallet: <Wallet size={15} />,
  identity:      <UserRound size={15} />,
  ssh_key:       <Terminal size={15} />,
  api_key:       <Key size={15} />,
  totp:          <ShieldCheck size={15} />,
};

export function VaultView({ onLock }: Props) {
  const [items, setItems]               = useState<ItemSummary[]>([]);
  const [folders, setFolders]           = useState<FolderT[]>([]);
  const [selected, setSelected]         = useState<string | "new" | null>(null);
  const [query, setQuery]               = useState("");
  const [filter, setFilter]             = useState<FolderFilter>("all");
  const [error, setError]               = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  // Inline folder modals (replace prompt/confirm)
  const [renameFolder, setRenameFolder]           = useState<{ id: string; name: string } | null>(null);
  const [deleteFolderConfirm, setDeleteFolderConfirm] = useState<{ id: string; name: string } | null>(null);
  const [addFolderOpen, setAddFolderOpen]         = useState(false);

  useIdleLock(5, 30, onLock);

  async function refresh() {
    try {
      const [its, fs] = await Promise.all([api.itemList(), api.folderList()]);
      setItems(its);
      setFolders(fs);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  useEffect(() => { refresh(); }, []);

  const visible = useMemo(() => {
    let pool = items;
    if (filter === "favorites") pool = pool.filter((i) => i.favorite);
    else if (filter === "none") pool = pool.filter((i) => i.folder_id === null);
    else if (filter !== "all") pool = pool.filter((i) => i.folder_id === filter);

    const q = query.trim();
    if (!q) return pool;
    return pool
      .map((i) => ({ item: i, score: fuzzyScore(i.name, q) }))
      .filter((x): x is { item: ItemSummary; score: number } => x.score !== null)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.item);
  }, [items, query, filter]);

  const grouped = useMemo(() => {
    const g: Record<ItemKind, ItemSummary[]> = {
      login: [], card: [], pin_note: [], crypto_wallet: [],
      identity: [], ssh_key: [], api_key: [], totp: [],
    };
    for (const i of visible) g[i.kind].push(i);
    return g;
  }, [visible]);

  return (
    <div className="app-layout">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-head">
          <Vault size={18} style={{ color: "var(--accent)", flexShrink: 0 }} />
          <span className="sidebar-title">VaultGuard</span>
          <div className="head-actions">
            <button
              className="btn-icon"
              onClick={() => setShowSettings(true)}
              title="Settings"
            >
              <Settings size={16} />
            </button>
            <button
              className="btn-icon"
              onClick={onLock}
              title="Lock vault"
            >
              <Lock size={16} />
            </button>
          </div>
        </div>

        <div className="search-wrapper">
          <Search size={13} className="search-icon" />
          <input
            className="search"
            placeholder="Search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <button className="new-btn" onClick={() => setSelected("new")}>
          <Plus size={14} />
          New item
        </button>

        <div className="folders">
          <div className="folder-section-head">
            <span className="folder-section-label">Filters</span>
            <button
              className="btn-icon"
              title="New folder"
              onClick={() => setAddFolderOpen(true)}
            >
              <FolderPlus size={14} />
            </button>
          </div>
          <div className="folder-pills">
            <FolderPill active={filter === "all"} onClick={() => setFilter("all")}>
              All items
            </FolderPill>
            <FolderPill active={filter === "favorites"} onClick={() => setFilter("favorites")}>
              <Star size={12} fill={filter === "favorites" ? "var(--yellow)" : "none"} color={filter === "favorites" ? "var(--yellow)" : undefined} />
              Favorites
            </FolderPill>
            <FolderPill active={filter === "none"} onClick={() => setFilter("none")}>
              Unfiled
            </FolderPill>
            {folders.map((f) => (
              <div key={f.id} className="folder-row">
                <FolderPill active={filter === f.id} onClick={() => setFilter(f.id)}>
                  {f.name}
                </FolderPill>
                <button
                  className="btn-icon"
                  title="Rename folder"
                  onClick={() => setRenameFolder({ id: f.id, name: f.name })}
                >
                  <Pencil size={12} />
                </button>
                <button
                  className="btn-icon danger-icon"
                  title="Delete folder"
                  onClick={() => setDeleteFolderConfirm({ id: f.id, name: f.name })}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="sidebar-divider" />

        <div className="item-list">
          {(Object.keys(grouped) as ItemKind[]).map((kind) => {
            const rows = grouped[kind];
            if (rows.length === 0) return null;
            return (
              <div key={kind}>
                <div className="item-kind-header">
                  {KIND_LABELS[kind]} ({rows.length})
                </div>
                {rows.map((it) => (
                  <button
                    key={it.id}
                    className={"item-row" + (selected === it.id ? " active" : "")}
                    onClick={() => setSelected(it.id)}
                  >
                    <span className="item-row-icon">{KIND_ICONS[it.kind]}</span>
                    <span className="item-row-name">{it.name}</span>
                    {it.favorite && (
                      <Star size={10} className="item-row-fav" fill="var(--yellow)" />
                    )}
                  </button>
                ))}
              </div>
            );
          })}
          {visible.length === 0 && (
            <p className="empty-list">
              {query ? "No results." : "No items yet."}
            </p>
          )}
        </div>

        {error && <p className="error" style={{ margin: "0 12px 12px" }}>{error}</p>}
      </aside>

      {/* ── Main ── */}
      <main className="main">
        <ItemEditor
          itemId={selected}
          folders={folders}
          onSaved={() => { setSelected(null); refresh(); }}
          onDeleted={() => { setSelected(null); refresh(); }}
          onCancel={() => setSelected(null)}
        />
      </main>

      {/* ── Modals ── */}
      {showSettings && (
        <SettingsModal onClose={() => { setShowSettings(false); refresh(); }} />
      )}

      {addFolderOpen && (
        <AddFolderModal
          onConfirm={async (name) => {
            await api.folderCreate(name);
            setAddFolderOpen(false);
            refresh();
          }}
          onClose={() => setAddFolderOpen(false)}
        />
      )}

      {renameFolder && (
        <RenameFolderModal
          current={renameFolder.name}
          onConfirm={async (name) => {
            await api.folderRename(renameFolder.id, name);
            setRenameFolder(null);
            refresh();
          }}
          onClose={() => setRenameFolder(null)}
        />
      )}

      {deleteFolderConfirm && (
        <DeleteFolderModal
          name={deleteFolderConfirm.name}
          onConfirm={async () => {
            await api.folderDelete(deleteFolderConfirm.id);
            if (filter === deleteFolderConfirm.id) setFilter("all");
            setDeleteFolderConfirm(null);
            refresh();
          }}
          onClose={() => setDeleteFolderConfirm(null)}
        />
      )}

      <BridgeApprovals />
      <AutofillPicker />
    </div>
  );
}

/* ── Sub-components ── */

function FolderPill({
  active, onClick, children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={"folder-pill" + (active ? " active" : "")}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function AddFolderModal({
  onConfirm, onClose,
}: {
  onConfirm: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try { await onConfirm(name.trim()); }
    finally { setBusy(false); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">New folder</span>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <form className="folder-modal-form" onSubmit={submit}>
          <div className="field">
            <span>Folder name</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Work"
              disabled={busy}
            />
          </div>
          <div className="modal-actions">
            <button type="button" className="ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" disabled={busy || !name.trim()}>Create</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RenameFolderModal({
  current, onConfirm, onClose,
}: {
  current: string;
  onConfirm: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(current);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || name.trim() === current) { onClose(); return; }
    setBusy(true);
    try { await onConfirm(name.trim()); }
    finally { setBusy(false); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Rename folder</span>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <form className="folder-modal-form" onSubmit={submit}>
          <div className="field">
            <span>Folder name</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
            />
          </div>
          <div className="modal-actions">
            <button type="button" className="ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" disabled={busy || !name.trim()}>Rename</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteFolderModal({
  name, onConfirm, onClose,
}: {
  name: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try { await onConfirm(); }
    finally { setBusy(false); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Delete folder</span>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <p className="modal-subtitle">
          Delete <strong style={{ color: "var(--text-primary)" }}>{name}</strong>?
          Items inside will become unfiled.
        </p>
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="danger" onClick={confirm} disabled={busy}>Delete</button>
        </div>
      </div>
    </div>
  );
}
