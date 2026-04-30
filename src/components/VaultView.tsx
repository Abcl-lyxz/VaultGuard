import { useEffect, useMemo, useState } from "react";
import {
  FolderPlus, Key, Lock, Plus, Settings, ShieldCheck,
  StickyNote, Terminal, UserRound, Wallet, Globe, CreditCard,
} from "lucide-react";
import { api, type Folder as FolderT } from "../lib/ipc";
import { KIND_LABELS, type ItemKind, type ItemSummary } from "../lib/schemas";
import { ItemEditor } from "./ItemEditor";
import { SettingsModal } from "./SettingsModal";
import { BridgeApprovals } from "./BridgeApprovals";
import { AutofillPicker } from "./AutofillPicker";
import { Modal } from "./ui/Modal";
import { CommandPalette, type PaletteCommand } from "./ui/CommandPalette";
import { fuzzyScore } from "../lib/fuzzy";
import { useIdleLock } from "../lib/useIdleLock";
import { useHotkeys } from "../hooks/useHotkeys";
import { usePrefs } from "../contexts/PrefsContext";
import { AppShell } from "./layout/AppShell";
import { NavSidebar } from "./layout/NavSidebar";
import { ItemListPanel } from "./layout/ItemListPanel";

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
  const [loading, setLoading] = useState(true);
  const [showSettings, setShowSettings]         = useState(false);
  const [renameFolder, setRenameFolder]         = useState<{ id: string; name: string } | null>(null);
  const [deleteFolderConfirm, setDeleteFolderConfirm] = useState<{ id: string; name: string } | null>(null);
  const [addFolderOpen, setAddFolderOpen]       = useState(false);
  const [showPalette, setShowPalette]           = useState(false);
  const [cursor, setCursor]                     = useState(0);

  useIdleLock(prefs.idle_minutes, prefs.lock_on_blur ? 30 : 999999, onLock);

  async function refresh() {
    try {
      const [its, fs] = await Promise.all([api.itemList(), api.folderList()]);
      setItems(its);
      setFolders(fs);
    } catch {
      /* errors surfaced in ItemEditor */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  const visible = useMemo(() => {
    let pool = items;
    if (filter === "favorites") pool = pool.filter(i => i.favorite);
    else if (filter === "none") pool = pool.filter(i => i.folder_id === null);
    else if (filter.startsWith("__kind__")) pool = pool.filter(i => i.kind === (filter.slice(8) as ItemKind));
    else if (filter !== "all") pool = pool.filter(i => i.folder_id === filter);
    const q = query.trim();
    if (!q) return pool;
    return pool
      .map(i => ({ item: i, score: fuzzyScore(i.name, q) }))
      .filter((x): x is { item: ItemSummary; score: number } => x.score !== null)
      .sort((a, b) => b.score - a.score)
      .map(x => x.item);
  }, [items, query, filter]);

  useHotkeys([
    { key: "l", ctrl: true, handler: onLock },
    { key: "n", ctrl: true, handler: () => setSelected("new") },
    { key: ",", ctrl: true, handler: () => setShowSettings(true) },
    { key: "k", ctrl: true, handler: () => setShowPalette(true) },
    {
      key: "ArrowDown", handler: () => {
        const nextIdx = Math.min(cursor + 1, visible.length - 1);
        setCursor(nextIdx);
        if (visible[nextIdx]) setSelected(visible[nextIdx].id);
      },
    },
    {
      key: "ArrowUp", handler: () => {
        const nextIdx = Math.max(cursor - 1, 0);
        setCursor(nextIdx);
        if (visible[nextIdx]) setSelected(visible[nextIdx].id);
      },
    },
  ], [onLock, cursor, visible]);

  const paletteCommands: PaletteCommand[] = useMemo(() => [
    { id: "new",      label: "New item",   icon: <Plus size={14} />,       onSelect: () => setSelected("new") },
    { id: "settings", label: "Settings",   icon: <Settings size={14} />,   onSelect: () => setShowSettings(true) },
    { id: "lock",     label: "Lock vault", icon: <Lock size={14} />,       onSelect: onLock },
    { id: "folder",   label: "New folder", icon: <FolderPlus size={14} />, onSelect: () => setAddFolderOpen(true) },
    ...items.map(i => ({
      id: i.id,
      label: i.name,
      keywords: KIND_LABELS[i.kind],
      icon: KIND_ICONS[i.kind],
      onSelect: () => setSelected(i.id),
    })),
  ], [items, onLock]);

  return (
    <AppShell>
      <NavSidebar
        filter={filter}
        onFilter={setFilter}
        folders={folders}
        items={items}
        onAddFolder={() => setAddFolderOpen(true)}
        onRenameFolder={setRenameFolder}
        onDeleteFolder={setDeleteFolderConfirm}
        onSettings={() => setShowSettings(true)}
        onLock={onLock}
      />

      <ItemListPanel
        items={visible}
        loading={loading}
        selected={selected}
        onSelect={id => { setSelected(id); setCursor(visible.findIndex(i => i.id === id)); }}
        onNew={() => setSelected("new")}
        query={query}
        onQuery={setQuery}
        totalItems={items.length}
      />

      <div className="editor-panel-wrap">
        <ItemEditor
          itemId={selected}
          folders={folders}
          onSaved={() => { setSelected(null); refresh(); }}
          onDeleted={() => { setSelected(null); refresh(); }}
          onCancel={() => setSelected(null)}
        />
      </div>

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
    </AppShell>
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
