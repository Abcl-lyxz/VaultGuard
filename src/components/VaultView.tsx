import { useEffect, useMemo, useRef, useState } from "react";
import {
  CreditCard, FolderPlus, Globe, Key, Lock, Pencil, Plus, Search,
  Settings, ShieldCheck, StickyNote, Star, Terminal, UserRound, Vault, Wallet, X,
} from "lucide-react";
import { api, type Folder as FolderT } from "../lib/ipc";
import { KIND_LABELS, type ItemKind, type ItemSummary } from "../lib/schemas";
import { ItemEditor } from "./ItemEditor";
import { SettingsModal } from "./SettingsModal";
import { BridgeApprovals } from "./BridgeApprovals";
import { AutofillPicker } from "./AutofillPicker";
import { Modal } from "./ui/Modal";
import { ItemRowSkeleton } from "./ui/Skeleton";
import { CommandPalette, type PaletteCommand } from "./ui/CommandPalette";
import { fuzzyScore } from "../lib/fuzzy";
import { useIdleLock } from "../lib/useIdleLock";
import { useHotkeys } from "../hooks/useHotkeys";
import { usePrefs } from "../contexts/PrefsContext";

type Props = { onLock: () => void };
type FolderFilter = "all" | "favorites" | "none" | string;

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
  const { prefs } = usePrefs();
  const [items, setItems]     = useState<ItemSummary[]>([]);
  const [folders, setFolders] = useState<FolderT[]>([]);
  const [selected, setSelected] = useState<string | "new" | null>(null);
  const [query, setQuery]     = useState("");
  const [filter, setFilter]   = useState<FolderFilter>("all");
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSettings, setShowSettings]   = useState(false);
  const [renameFolder, setRenameFolder]   = useState<{ id: string; name: string } | null>(null);
  const [deleteFolderConfirm, setDeleteFolderConfirm] = useState<{ id: string; name: string } | null>(null);
  const [addFolderOpen, setAddFolderOpen] = useState(false);
  const [showPalette, setShowPalette]     = useState(false);
  const [cursor, setCursor]               = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  useIdleLock(prefs.idle_minutes, prefs.lock_on_blur ? 30 : 999999, onLock);

  async function refresh() {
    try {
      const [its, fs] = await Promise.all([api.itemList(), api.folderList()]);
      setItems(its);
      setFolders(fs);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  const visible = useMemo(() => {
    let pool = items;
    if (filter === "favorites") pool = pool.filter(i => i.favorite);
    else if (filter === "none") pool = pool.filter(i => i.folder_id === null);
    else if (filter !== "all") pool = pool.filter(i => i.folder_id === filter);
    const q = query.trim();
    if (!q) return pool;
    return pool
      .map(i => ({ item: i, score: fuzzyScore(i.name, q) }))
      .filter((x): x is { item: ItemSummary; score: number } => x.score !== null)
      .sort((a, b) => b.score - a.score)
      .map(x => x.item);
  }, [items, query, filter]);

  const grouped = useMemo(() => {
    const g: Record<ItemKind, ItemSummary[]> = { login: [], card: [], pin_note: [], crypto_wallet: [], identity: [], ssh_key: [], api_key: [], totp: [] };
    for (const i of visible) g[i.kind].push(i);
    return g;
  }, [visible]);

  // Flat ordered list for keyboard navigation
  const flatList = useMemo(() => {
    const order: ItemKind[] = ["login","card","pin_note","crypto_wallet","identity","ssh_key","api_key","totp"];
    return order.flatMap(k => grouped[k]);
  }, [grouped]);

  // Global keyboard shortcuts
  useHotkeys([
    { key: "l", ctrl: true, handler: onLock },
    { key: "n", ctrl: true, handler: () => setSelected("new") },
    { key: "f", ctrl: true, handler: () => searchRef.current?.focus() },
    { key: ",", ctrl: true, handler: () => setShowSettings(true) },
    { key: "k", ctrl: true, handler: () => setShowPalette(true) },
    {
      key: "ArrowDown", handler: () => {
        const nextIdx = Math.min(cursor + 1, flatList.length - 1);
        setCursor(nextIdx);
        if (flatList[nextIdx]) setSelected(flatList[nextIdx].id);
      },
    },
    {
      key: "ArrowUp", handler: () => {
        const nextIdx = Math.max(cursor - 1, 0);
        setCursor(nextIdx);
        if (flatList[nextIdx]) setSelected(flatList[nextIdx].id);
      },
    },
  ], [onLock, cursor, flatList]);

  // Command palette commands
  const paletteCommands: PaletteCommand[] = useMemo(() => [
    { id: "new",      label: "New item",       icon: <Plus size={14} />,     onSelect: () => setSelected("new") },
    { id: "settings", label: "Settings",       icon: <Settings size={14} />, onSelect: () => setShowSettings(true) },
    { id: "lock",     label: "Lock vault",     icon: <Lock size={14} />,     onSelect: onLock },
    { id: "folder",   label: "New folder",     icon: <FolderPlus size={14} />, onSelect: () => setAddFolderOpen(true) },
    ...flatList.map(i => ({
      id: i.id,
      label: i.name,
      keywords: KIND_LABELS[i.kind],
      icon: KIND_ICONS[i.kind],
      onSelect: () => setSelected(i.id),
    })),
  ], [flatList, onLock]);

  return (
    <div className="app-layout">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-head">
          <Vault size={18} style={{ color: "var(--accent)", flexShrink: 0 }} />
          <span className="sidebar-title">VaultGuard</span>
          <div className="head-actions">
            <button className="btn-icon" onClick={() => setShowPalette(true)} title="Command palette (Ctrl+K)" aria-label="Open command palette">
              <Search size={15} />
            </button>
            <button className="btn-icon" onClick={() => setShowSettings(true)} title="Settings (Ctrl+,)" aria-label="Open settings">
              <Settings size={16} />
            </button>
            <button className="btn-icon" onClick={onLock} title="Lock vault (Ctrl+L)" aria-label="Lock vault">
              <Lock size={16} />
            </button>
          </div>
        </div>

        <div className="search-wrapper">
          <Search size={13} className="search-icon" />
          <input
            ref={searchRef}
            className="search"
            placeholder="Search… (Ctrl+F)"
            value={query}
            onChange={e => setQuery(e.target.value)}
            aria-label="Search items"
          />
        </div>

        <button className="new-btn" onClick={() => setSelected("new")} aria-label="New item (Ctrl+N)">
          <Plus size={14} />
          New item
        </button>

        <div className="folders">
          <div className="folder-section-head">
            <span className="folder-section-label">Filters</span>
            <button className="btn-icon" title="New folder" aria-label="Create new folder" onClick={() => setAddFolderOpen(true)}>
              <FolderPlus size={14} />
            </button>
          </div>
          <div className="folder-pills" role="listbox" aria-label="Folder filters">
            <FolderPill active={filter === "all"} onClick={() => setFilter("all")}>All items</FolderPill>
            <FolderPill active={filter === "favorites"} onClick={() => setFilter("favorites")}>
              <Star size={12} fill={filter === "favorites" ? "var(--yellow)" : "none"} color={filter === "favorites" ? "var(--yellow)" : undefined} />
              Favorites
            </FolderPill>
            <FolderPill active={filter === "none"} onClick={() => setFilter("none")}>Unfiled</FolderPill>
            {folders.map(f => (
              <div key={f.id} className="folder-row">
                <FolderPill active={filter === f.id} onClick={() => setFilter(f.id)}>{f.name}</FolderPill>
                <button className="btn-icon" title="Rename folder" aria-label={`Rename folder ${f.name}`} onClick={() => setRenameFolder({ id: f.id, name: f.name })}>
                  <Pencil size={12} />
                </button>
                <button className="btn-icon danger-icon" title="Delete folder" aria-label={`Delete folder ${f.name}`} onClick={() => setDeleteFolderConfirm({ id: f.id, name: f.name })}>
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="sidebar-divider" />

        <div className="item-list" role="listbox" aria-label="Vault items">
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => <ItemRowSkeleton key={i} />)
          ) : (Object.keys(grouped) as ItemKind[]).map(kind => {
            const rows = grouped[kind];
            if (rows.length === 0) return null;
            return (
              <div key={kind}>
                <div className="item-kind-header">{KIND_LABELS[kind]} ({rows.length})</div>
                {rows.map((it) => (
                  <ItemRow
                    key={it.id}
                    item={it}
                    active={selected === it.id}
                    onClick={() => { setSelected(it.id); setCursor(flatList.indexOf(it)); }}
                  />
                ))}
              </div>
            );
          })}
          {!loading && visible.length === 0 && (
            <div className="empty-list">
              {items.length === 0
                ? "No items yet. Press Ctrl+N to create one."
                : query ? "No results." : "No items in this filter."}
            </div>
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

      {/* ── Overlays ── */}
      {showSettings && (
        <SettingsModal onClose={() => { setShowSettings(false); refresh(); }} />
      )}

      <CommandPalette
        open={showPalette}
        onClose={() => setShowPalette(false)}
        commands={paletteCommands}
      />

      <Modal open={addFolderOpen} onClose={() => setAddFolderOpen(false)} title="New folder">
        <AddFolderForm
          onConfirm={async name => { await api.folderCreate(name); setAddFolderOpen(false); refresh(); }}
          onClose={() => setAddFolderOpen(false)}
        />
      </Modal>

      {renameFolder && (
        <Modal open onClose={() => setRenameFolder(null)} title="Rename folder">
          <RenameFolderForm
            current={renameFolder.name}
            onConfirm={async name => { await api.folderRename(renameFolder.id, name); setRenameFolder(null); refresh(); }}
            onClose={() => setRenameFolder(null)}
          />
        </Modal>
      )}

      {deleteFolderConfirm && (
        <Modal open onClose={() => setDeleteFolderConfirm(null)} title="Delete folder">
          <p className="modal-subtitle">
            Delete <strong style={{ color: "var(--text-primary)" }}>{deleteFolderConfirm.name}</strong>?
            Items inside will become unfiled.
          </p>
          <div className="modal-actions">
            <button className="ghost" onClick={() => setDeleteFolderConfirm(null)}>Cancel</button>
            <button className="danger" onClick={async () => {
              await api.folderDelete(deleteFolderConfirm.id);
              if (filter === deleteFolderConfirm.id) setFilter("all");
              setDeleteFolderConfirm(null);
              refresh();
            }}>Delete</button>
          </div>
        </Modal>
      )}

      <BridgeApprovals />
      <AutofillPicker />
    </div>
  );
}

/* ── Sub-components ── */

function ItemRow({ item, active, onClick }: { item: ItemSummary; active: boolean; onClick: () => void }) {
  return (
    <button
      className={"item-row" + (active ? " active" : "")}
      onClick={onClick}
      role="option"
      aria-selected={active}
    >
      <span className="item-row-icon">{KIND_ICONS[item.kind]}</span>
      <span className="item-row-name">{item.name}</span>
      {item.favorite && <Star size={10} className="item-row-fav" fill="var(--yellow)" />}
    </button>
  );
}

function FolderPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className={"folder-pill" + (active ? " active" : "")} onClick={onClick} role="option" aria-selected={active}>
      {children}
    </button>
  );
}

function AddFolderForm({ onConfirm, onClose }: { onConfirm: (name: string) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try { await onConfirm(name.trim()); } finally { setBusy(false); }
  }
  return (
    <form className="folder-modal-form" onSubmit={submit}>
      <div className="field">
        <label htmlFor="folder-name">Folder name</label>
        <input id="folder-name" autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Work" disabled={busy} />
      </div>
      <div className="modal-actions">
        <button type="button" className="ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="submit" disabled={busy || !name.trim()}>Create</button>
      </div>
    </form>
  );
}

function RenameFolderForm({ current, onConfirm, onClose }: { current: string; onConfirm: (name: string) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState(current);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || name.trim() === current) { onClose(); return; }
    setBusy(true);
    try { await onConfirm(name.trim()); } finally { setBusy(false); }
  }
  return (
    <form className="folder-modal-form" onSubmit={submit}>
      <div className="field">
        <label htmlFor="rename-folder">Folder name</label>
        <input id="rename-folder" autoFocus value={name} onChange={e => setName(e.target.value)} disabled={busy} />
      </div>
      <div className="modal-actions">
        <button type="button" className="ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="submit" disabled={busy || !name.trim()}>Rename</button>
      </div>
    </form>
  );
}
