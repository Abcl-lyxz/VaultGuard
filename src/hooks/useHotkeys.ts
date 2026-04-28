import { useEffect } from "react";

type HotkeyHandler = (e: KeyboardEvent) => void;

interface HotkeyDef {
  key: string;          // e.g. "k", "n", ","
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  handler: HotkeyHandler;
  enabled?: boolean;
}

export function useHotkeys(hotkeys: HotkeyDef[], deps?: unknown[]) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      for (const hk of hotkeys) {
        if (hk.enabled === false) continue;
        const target = e.target as HTMLElement;
        const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
        // allow Esc and Ctrl+ combos even inside inputs
        if (isInput && e.key !== "Escape" && !e.ctrlKey && !e.metaKey) continue;
        if (e.key.toLowerCase() !== hk.key.toLowerCase()) continue;
        const ctrlOk  = (hk.ctrl  ?? false) === (e.ctrlKey || e.metaKey);
        const shiftOk = (hk.shift ?? false) === e.shiftKey;
        const altOk   = (hk.alt   ?? false) === e.altKey;
        if (ctrlOk && shiftOk && altOk) {
          e.preventDefault();
          hk.handler(e);
          return;
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps ?? [hotkeys]);
}
