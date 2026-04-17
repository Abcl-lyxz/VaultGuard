import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Star, X } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { api } from "../lib/ipc";
import type { ItemSummary } from "../lib/schemas";
import { fuzzyScore } from "../lib/fuzzy";

export function AutofillPicker() {
  const [open, setOpen]   = useState(false);
  const [items, setItems] = useState<ItemSummary[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<void>("autofill:open_picker", async () => {
      try {
        const list = await api.itemList();
        setItems(list.filter((i) => i.kind === "login"));
        setQuery("");
        setError(null);
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 50);
      } catch (e: any) {
        setError(e?.message ?? String(e));
        setOpen(true);
      }
    }).then((u) => (unlisten = u));
    return () => { if (unlisten) unlisten(); };
  }, []);

  const visible = useMemo(() => {
    const q = query.trim();
    if (!q) return items.slice(0, 20);
    return items
      .map((i) => ({ item: i, score: fuzzyScore(i.name, q) }))
      .filter((x): x is { item: ItemSummary; score: number } => x.score !== null)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.item)
      .slice(0, 20);
  }, [items, query]);

  async function pick(id: string) {
    setError(null);
    setOpen(false);
    try {
      await api.autofillFill(id);
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setOpen(true);
    }
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") setOpen(false);
    if (e.key === "Enter" && visible[0]) pick(visible[0].id);
  }

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Quick autofill</span>
          <button className="btn-icon" onClick={() => setOpen(false)}>
            <X size={16} />
          </button>
        </div>
        <p className="modal-subtitle">
          Focus a password field in any app, then choose a login. Credentials will be
          typed via UI Automation.
        </p>

        <div style={{ position: "relative" }}>
          <Search
            size={13}
            style={{
              position: "absolute",
              left: 10,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--text-muted)",
              pointerEvents: "none",
            }}
          />
          <input
            ref={inputRef}
            className="search"
            placeholder="Search logins…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            style={{ paddingLeft: 30 }}
          />
        </div>

        <div style={{ maxHeight: 300, overflowY: "auto", display: "flex", flexDirection: "column", gap: 1 }}>
          {visible.length === 0 ? (
            <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", padding: "var(--sp-3) var(--sp-2)" }}>
              No logins found.
            </p>
          ) : (
            visible.map((i) => (
              <button
                key={i.id}
                className="item-row"
                onClick={() => pick(i.id)}
              >
                <span className="item-row-name">{i.name}</span>
                {i.favorite && (
                  <Star size={10} className="item-row-fav" fill="var(--yellow)" />
                )}
              </button>
            ))
          )}
        </div>

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          <button className="ghost" onClick={() => setOpen(false)}>Close</button>
        </div>
      </div>
    </div>
  );
}
