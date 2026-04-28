import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fuzzyScore } from "../../lib/fuzzy";

export interface PaletteCommand {
  id: string;
  label: string;
  keywords?: string;
  icon?: React.ReactNode;
  onSelect: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commands: PaletteCommand[];
}

export function CommandPalette({ open, onClose, commands }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = query
    ? commands
        .map(c => ({ c, score: fuzzyScore(query, c.label + " " + (c.keywords ?? "")) }))
        .filter((x): x is { c: typeof x.c; score: number } => x.score !== null && x.score > 0)
        .sort((a, b) => b.score - a.score)
        .map(({ c }) => c)
    : commands;

  useEffect(() => { if (open) { setQuery(""); setCursor(0); requestAnimationFrame(() => inputRef.current?.focus()); } }, [open]);
  useEffect(() => { setCursor(0); }, [query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); setCursor(c => Math.min(c + 1, filtered.length - 1)); }
      if (e.key === "ArrowUp")   { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
      if (e.key === "Enter" && filtered[cursor]) { filtered[cursor].onSelect(); onClose(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, cursor, filtered, onClose]);

  useEffect(() => {
    const el = listRef.current?.children[cursor] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (!open) return null;

  return createPortal(
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette-panel" onClick={e => e.stopPropagation()} role="dialog" aria-label="Command palette" aria-modal="true">
        <div className="palette-search">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M10 10l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input
            ref={inputRef}
            className="palette-input"
            placeholder="Search commands and items…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            aria-label="Command palette search"
            aria-autocomplete="list"
            aria-controls="palette-list"
            aria-activedescendant={filtered[cursor] ? `palette-opt-${filtered[cursor].id}` : undefined}
          />
          <kbd className="palette-esc">Esc</kbd>
        </div>
        <ul ref={listRef} id="palette-list" className="palette-list" role="listbox">
          {filtered.length === 0 && (
            <li className="palette-empty">No results for "{query}"</li>
          )}
          {filtered.map((cmd, i) => (
            <li
              key={cmd.id}
              id={`palette-opt-${cmd.id}`}
              className={`palette-item${i === cursor ? " palette-item-active" : ""}`}
              role="option"
              aria-selected={i === cursor}
              onMouseEnter={() => setCursor(i)}
              onClick={() => { cmd.onSelect(); onClose(); }}
            >
              {cmd.icon && <span className="palette-item-icon" aria-hidden="true">{cmd.icon}</span>}
              <span className="palette-item-label">{cmd.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body
  );
}
