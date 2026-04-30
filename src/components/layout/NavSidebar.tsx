import {
  CreditCard, FolderPlus, Globe, Key, Lock, Pencil,
  Settings, ShieldCheck, Shield, StickyNote, Star,
  Terminal, UserRound, Wallet, X, Layers,
} from "lucide-react";
import type { Folder as FolderT } from "../../lib/ipc";
import { KIND_LABELS, type ItemKind, type ItemSummary } from "../../lib/schemas";

export type NavFilter = "all" | "favorites" | "none" | string;

type Props = {
  filter: NavFilter;
  onFilter: (f: NavFilter) => void;
  folders: FolderT[];
  items: ItemSummary[];
  onAddFolder: () => void;
  onRenameFolder: (f: { id: string; name: string }) => void;
  onDeleteFolder: (f: { id: string; name: string }) => void;
  onSettings: () => void;
  onLock: () => void;
};

const KIND_ICONS: Record<ItemKind, React.ReactNode> = {
  login:         <Globe size={14} />,
  card:          <CreditCard size={14} />,
  pin_note:      <StickyNote size={14} />,
  crypto_wallet: <Wallet size={14} />,
  identity:      <UserRound size={14} />,
  ssh_key:       <Terminal size={14} />,
  api_key:       <Key size={14} />,
  totp:          <ShieldCheck size={14} />,
};

const KIND_ORDER: ItemKind[] = [
  "login", "card", "pin_note", "crypto_wallet",
  "identity", "ssh_key", "api_key", "totp",
];

export function NavSidebar({
  filter, onFilter, folders, items,
  onAddFolder, onRenameFolder, onDeleteFolder,
  onSettings, onLock,
}: Props) {
  const favCount    = items.filter(i => i.favorite).length;
  const unfiledCount = items.filter(i => i.folder_id === null).length;
  const kindCounts  = KIND_ORDER.reduce<Record<string, number>>((acc, k) => {
    acc[k] = items.filter(i => i.kind === k).length;
    return acc;
  }, {});

  return (
    <nav className="nav-sidebar" aria-label="Vault navigation">
      {/* Brand */}
      <div className="nav-brand">
        <Shield size={16} className="nav-brand-icon" />
        <span className="nav-brand-name">VaultGuard</span>
      </div>

      <div className="nav-scroll">
        {/* Library */}
        <div className="nav-section">
          <div className="nav-section-label">
            <span>Library</span>
          </div>
          <NavItem
            icon={<Layers size={14} />}
            label="All items"
            count={items.length}
            active={filter === "all"}
            onClick={() => onFilter("all")}
          />
          <NavItem
            icon={<Star size={14} />}
            label="Favorites"
            count={favCount}
            active={filter === "favorites"}
            onClick={() => onFilter("favorites")}
          />
          <NavItem
            icon={<Globe size={14} />}
            label="Unfiled"
            count={unfiledCount}
            active={filter === "none"}
            onClick={() => onFilter("none")}
          />
        </div>

        {/* Folders */}
        <div className="nav-section">
          <div className="nav-section-label">
            <span>Folders</span>
            <button
              className="nav-section-btn"
              onClick={onAddFolder}
              title="New folder"
              aria-label="Create new folder"
            >
              <FolderPlus size={12} />
            </button>
          </div>
          {folders.length === 0 && (
            <p style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", padding: "4px 8px" }}>
              No folders yet
            </p>
          )}
          {folders.map(f => (
            <div key={f.id} className="nav-folder-row">
              <NavItem
                icon={<Globe size={14} style={{ opacity: 0 }} />}
                label={f.name}
                count={items.filter(i => i.folder_id === f.id).length}
                active={filter === f.id}
                onClick={() => onFilter(f.id)}
              />
              <div className="nav-folder-actions">
                <button
                  className="nav-folder-act"
                  title={`Rename "${f.name}"`}
                  aria-label={`Rename folder ${f.name}`}
                  onClick={e => { e.stopPropagation(); onRenameFolder({ id: f.id, name: f.name }); }}
                >
                  <Pencil size={11} />
                </button>
                <button
                  className="nav-folder-act danger"
                  title={`Delete "${f.name}"`}
                  aria-label={`Delete folder ${f.name}`}
                  onClick={e => { e.stopPropagation(); onDeleteFolder({ id: f.id, name: f.name }); }}
                >
                  <X size={11} />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Types */}
        <div className="nav-section">
          <div className="nav-section-label"><span>Types</span></div>
          {KIND_ORDER.map(k => {
            const count = kindCounts[k] ?? 0;
            const kindFilterVal = `__kind__${k}`;
            return (
              <NavItem
                key={k}
                icon={KIND_ICONS[k]}
                label={KIND_LABELS[k]}
                count={count}
                active={filter === kindFilterVal}
                onClick={() => onFilter(kindFilterVal)}
              />
            );
          })}
        </div>
      </div>

      {/* Footer */}
      <div className="nav-footer">
        <button
          className="nav-footer-btn"
          onClick={onSettings}
          title="Settings (Ctrl+,)"
          aria-label="Open settings"
        >
          <Settings size={14} />
          <span>Settings</span>
        </button>
        <button
          className="nav-footer-btn danger"
          onClick={onLock}
          title="Lock vault (Ctrl+L)"
          aria-label="Lock vault"
        >
          <Lock size={14} />
          <span>Lock</span>
        </button>
      </div>
    </nav>
  );
}

function NavItem({
  icon, label, count, active, onClick,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`nav-item${active ? " active" : ""}`}
      onClick={onClick}
      role="option"
      aria-selected={active}
    >
      <span className="nav-item-icon">{icon}</span>
      <span className="nav-item-label">{label}</span>
      {count > 0 && <span className="nav-item-count">{count}</span>}
    </button>
  );
}
