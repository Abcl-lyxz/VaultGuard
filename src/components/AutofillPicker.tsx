import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Star } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { api } from "../lib/ipc";
import type { ItemSummary } from "../lib/schemas";
import { fuzzyScore } from "../lib/fuzzy";
import { Modal } from "./ui/Modal";

export function AutofillPicker() {
  const [open, setOpen]       = useState(false);
  const [items, setItems]     = useState<ItemSummary[]>([]);
  const [query, setQuery]     = useState("");
  const [cursor, setCursor]   = useState(0);
  const [error, setError]     = useState<string | null>(null);
  const [hwnd, setHwnd]       = useState(0);
  const inputRef              = useRef<HTMLInputElement>(null);
  const listRef               = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<number>("autofill:open_picker", async (e) => {
      const targetHwnd = e.payload ?? 0;
      setHwnd(targetHwnd);
      try {
        const list = await api.itemList();
        setItems(list.filter((i) => i.kind === "login"));
        setQuery("");
        setCursor(0);
        setError(null);
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 50);
      } catch (err: any) {
        setError(err?.message ?? String(err));
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

  useEffect(() => { setCursor(0); }, [query]);

  useEffect(() => {
    const el = listRef.current?.children[cursor] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  async function pick(id: string) {
    setError(null);
    setOpen(false);
    try {
      await api.autofillFill(id, hwnd);
    } catch (err: any) {
      setError(err?.message ?? String(err));
      setOpen(true);
    }
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor(c => Math.min(c + 1, visible.length - 1)); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
    if (e.key === "Enter" && visible[cursor]) pick(visible[cursor].id);
  }

  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Quick autofill" width="480px">
      <p className="modal-subtitle">
        Press <kbd>Ctrl+Shift+\</kbd> in any app to open this. Focus the password field first,
        then pick a login — credentials will be typed via UI Automation.
      </p>

      <div style={{ position: "relative" }}>
        <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
        <input
          ref={inputRef}
          className="search"
          placeholder="Search logins…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
          style={{ paddingLeft: 30 }}
          aria-label="Search logins for autofill"
          aria-controls="autofill-list"
          aria-activedescendant={visible[cursor] ? `af-opt-${visible[cursor].id}` : undefined}
        />
      </div>

      <div ref={listRef} id="autofill-list" className="autofill-list" role="listbox" aria-label="Login items">
        {visible.length === 0 ? (
          <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", padding: "var(--sp-3) var(--sp-2)" }}>
            No logins found.
          </p>
        ) : (
          visible.map((i, idx) => (
            <button
              key={i.id}
              id={`af-opt-${i.id}`}
              className={"item-row" + (idx === cursor ? " active" : "")}
              role="option"
              aria-selected={idx === cursor}
              onClick={() => pick(i.id)}
              onMouseEnter={() => setCursor(idx)}
            >
              <span className="item-row-name">{i.name}</span>
              {i.favorite && <Star size={10} className="item-row-fav" fill="var(--yellow)" />}
            </button>
          ))
        )}
      </div>

      {error && <p className="error">{error}</p>}

      <div className="modal-actions">
        <button className="ghost" onClick={() => setOpen(false)}>Close</button>
      </div>
    </Modal>
  );
}
