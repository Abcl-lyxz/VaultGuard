import { useRef } from "react";
import {
  CreditCard, Globe, Key, Plus, Search, ShieldCheck,
  StickyNote, Star, Terminal, UserRound, Wallet,
} from "lucide-react";
import type { ItemSummary } from "../../lib/schemas";
import { type ItemKind } from "../../lib/schemas";
import { ItemRowSkeleton } from "../ui/Skeleton";
import { EmptyState } from "../ui/EmptyState";
import { useHotkeys } from "../../hooks/useHotkeys";

type Props = {
  items: ItemSummary[];
  loading: boolean;
  selected: string | "new" | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  query: string;
  onQuery: (q: string) => void;
  totalItems: number;
};

const KIND_ICONS: Record<ItemKind, React.ReactNode> = {
  login:         <Globe size={16} />,
  card:          <CreditCard size={16} />,
  pin_note:      <StickyNote size={16} />,
  crypto_wallet: <Wallet size={16} />,
  identity:      <UserRound size={16} />,
  ssh_key:       <Terminal size={16} />,
  api_key:       <Key size={16} />,
  totp:          <ShieldCheck size={16} />,
};

function ItemIcon({ item }: { item: ItemSummary }) {
  return (
    <div className="item-row-icon">
      {KIND_ICONS[item.kind]}
    </div>
  );
}

export function ItemListPanel({
  items, loading, selected, onSelect, onNew,
  query, onQuery, totalItems,
}: Props) {
  const searchRef = useRef<HTMLInputElement>(null);
  useHotkeys([{ key: "f", ctrl: true, handler: () => searchRef.current?.focus() }], []);

  const noItems   = totalItems === 0;
  const noResults = !noItems && items.length === 0 && query.trim() !== "";
  const noFilter  = !noItems && items.length === 0 && query.trim() === "";

  return (
    <div className="item-list-panel">
      <div className="item-list-header">
        <div className="item-search-wrap">
          <Search size={13} />
          <input
            ref={searchRef}
            className="item-search"
            placeholder="Search… (Ctrl+F)"
            value={query}
            onChange={e => onQuery(e.target.value)}
            aria-label="Search items"
          />
        </div>
        <div className="item-list-toolbar">
          <span className="item-list-count">
            {loading ? "" : `${items.length} item${items.length !== 1 ? "s" : ""}`}
          </span>
          <button className="item-new-btn" onClick={onNew} aria-label="New item (Ctrl+N)">
            <Plus size={11} />
            New
          </button>
        </div>
      </div>

      <div className="item-list-scroll" role="listbox" aria-label="Vault items">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => <ItemRowSkeleton key={i} />)
        ) : noItems ? (
          <EmptyState
            icon={<Globe size={32} color="var(--border)" />}
            title="No items yet"
            description="Press Ctrl+N or click New to add your first credential."
          />
        ) : noResults ? (
          <EmptyState
            icon={<Search size={32} color="var(--border)" />}
            title="No results"
            description={`Nothing matched "${query}"`}
          />
        ) : noFilter ? (
          <EmptyState
            icon={<Globe size={32} color="var(--border)" />}
            title="Nothing here"
            description="No items match this filter."
          />
        ) : (
          items.map(item => (
            <ItemRow
              key={item.id}
              item={item}
              active={selected === item.id}
              onClick={() => onSelect(item.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ItemRow({
  item, active, onClick,
}: {
  item: ItemSummary;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className={`item-row-v2${active ? " active" : ""}`}
      onClick={onClick}
      role="option"
      aria-selected={active}
    >
      <ItemIcon item={item} />
      <div className="item-row-body">
        <div className="item-row-name">{item.name}</div>
      </div>
      <div className="item-row-end">
        {item.favorite && <Star size={12} className="item-row-star" fill="currentColor" />}
      </div>
    </div>
  );
}
