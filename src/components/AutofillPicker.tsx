import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "../lib/ipc";
import type { ItemSummary } from "../lib/schemas";
import { fuzzyScore } from "../lib/fuzzy";

export function AutofillPicker() {
  const [open, setOpen] = useState(false);
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
    return () => {
      if (unlisten) unlisten();
    };
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
        <h2>Quick autofill</h2>
        <p className="subtitle">
          Focus a password field in any app, then choose a login. The username +
          password will be typed into the focused control via UI Automation.
        </p>
        <input
          ref={inputRef}
          className="search"
          placeholder="Search logins…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
        />
        <div className="list" style={{ maxHeight: 320 }}>
          {visible.length === 0 ? (
            <p className="empty">No logins.</p>
          ) : (
            visible.map((i) => (
              <button key={i.id} className="row" onClick={() => pick(i.id)}>
                {i.favorite && <span className="star">★</span>}
                <span>{i.name}</span>
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
