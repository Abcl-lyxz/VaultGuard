import { useEffect, useMemo, useState } from "react";
import { api, type Folder as FolderT } from "../lib/ipc";
import { KIND_LABELS, type ItemKind, type ItemSummary } from "../lib/schemas";
import { ItemEditor } from "./ItemEditor";
import { SettingsModal } from "./SettingsModal";
import { BridgeApprovals } from "./BridgeApprovals";
import { AutofillPicker } from "./AutofillPicker";
import { fuzzyScore } from "../lib/fuzzy";
import { useIdleLock } from "../lib/useIdleLock";

type Props = {
  onLock: () => void;
};

type FolderFilter = "all" | "favorites" | string; // string = folder id | "none"

export function VaultView({ onLock }: Props) {
  const [items, setItems] = useState<ItemSummary[]>([]);
  const [folders, setFolders] = useState<FolderT[]>([]);
  const [selected, setSelected] = useState<string | "new" | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FolderFilter>("all");
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

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

  async function addFolder() {
    const name = prompt("Folder name:");
    if (!name?.trim()) return;
    await api.folderCreate(name.trim());
    refresh();
  }

  async function renameFolder(id: string, current: string) {
    const name = prompt("Rename folder:", current);
    if (!name?.trim() || name === current) return;
    await api.folderRename(id, name.trim());
    refresh();
  }

  async function deleteFolder(id: string, name: string) {
    if (!confirm(`Delete folder "${name}"? Items in it will become unfiled.`)) return;
    await api.folderDelete(id);
    if (filter === id) setFilter("all");
    refresh();
  }

  const visible = useMemo(() => {
    let pool = items;
    if (filter === "favorites") pool = pool.filter((i) => i.favorite);
    else if (filter === "none") pool = pool.filter((i) => i.folder_id === null);
    else if (filter !== "all") pool = pool.filter((i) => i.folder_id === filter);

    const q = query.trim();
    if (!q) return pool;
    const scored = pool
      .map((i) => ({ item: i, score: fuzzyScore(i.name, q) }))
      .filter((x): x is { item: ItemSummary; score: number } => x.score !== null)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.item);
    return scored;
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
    <div className="vault">
      <aside className="sidebar">
        <div className="sidebar-head">
          <h2>VaultGuard</h2>
          <div className="head-actions">
            <button className="ghost small" onClick={() => setShowSettings(true)} title="Settings">⚙</button>
            <button className="ghost small" onClick={onLock}>Lock</button>
          </div>
        </div>
        <input
          className="search"
          placeholder="Search…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="new-btn" onClick={() => setSelected("new")}>+ New item</button>

        <div className="folders">
          <div className="folder-head">
            <span>FILTERS</span>
            <button className="ghost small" onClick={addFolder} title="New folder">+</button>
          </div>
          <FolderPill active={filter === "all"} onClick={() => setFilter("all")}>All</FolderPill>
          <FolderPill active={filter === "favorites"} onClick={() => setFilter("favorites")}>★ Favorites</FolderPill>
          <FolderPill active={filter === "none"} onClick={() => setFilter("none")}>Unfiled</FolderPill>
          {folders.map((f) => (
            <div key={f.id} className="folder-row">
              <FolderPill active={filter === f.id} onClick={() => setFilter(f.id)}>{f.name}</FolderPill>
              <button className="ghost small" onClick={() => renameFolder(f.id, f.name)} title="Rename">✎</button>
              <button className="ghost small" onClick={() => deleteFolder(f.id, f.name)} title="Delete">✕</button>
            </div>
          ))}
        </div>

        <div className="list">
          {(Object.keys(grouped) as ItemKind[]).map((kind) => {
            const rows = grouped[kind];
            if (rows.length === 0) return null;
            return (
              <div key={kind} className="group">
                <div className="group-head">{KIND_LABELS[kind]} ({rows.length})</div>
                {rows.map((it) => (
                  <button
                    key={it.id}
                    className={"row" + (selected === it.id ? " active" : "")}
                    onClick={() => setSelected(it.id)}
                  >
                    {it.favorite && <span className="star">★</span>}
                    <span>{it.name}</span>
                  </button>
                ))}
              </div>
            );
          })}
          {visible.length === 0 && <p className="empty">No items.</p>}
        </div>
        {error && <p className="error">{error}</p>}
      </aside>
      <main className="main">
        <ItemEditor
          itemId={selected}
          folders={folders}
          onSaved={() => { setSelected(null); refresh(); }}
          onDeleted={() => { setSelected(null); refresh(); }}
          onCancel={() => setSelected(null)}
        />
      </main>
      {showSettings && (
        <SettingsModal onClose={() => { setShowSettings(false); refresh(); }} />
      )}
      <BridgeApprovals />
      <AutofillPicker />
    </div>
  );
}

function FolderPill({
  active,
  onClick,
  children,
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
