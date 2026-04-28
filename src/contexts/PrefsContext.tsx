import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface Prefs {
  theme: "light" | "dark" | "system";
  idle_minutes: number;
  lock_on_blur: boolean;
  clipboard_ttl_secs: number;
  autofill_enabled: boolean;
  autofill_hotkey: string;
}

const DEFAULT_PREFS: Prefs = {
  theme: "system",
  idle_minutes: 5,
  lock_on_blur: true,
  clipboard_ttl_secs: 20,
  autofill_enabled: true,
  autofill_hotkey: "Ctrl+Shift+\\",
};

interface PrefsContextValue {
  prefs: Prefs;
  setPref: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
  savePrefs: (p: Prefs) => Promise<void>;
}

const PrefsContext = createContext<PrefsContextValue>({
  prefs: DEFAULT_PREFS,
  setPref: () => {},
  savePrefs: async () => {},
});

export function PrefsProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);

  useEffect(() => {
    invoke<Prefs>("prefs_get").then(p => setPrefs(p)).catch(() => {});
  }, []);

  const savePrefs = useCallback(async (p: Prefs) => {
    await invoke("prefs_set", { prefs: p });
    setPrefs(p);
  }, []);

  const setPref = useCallback(<K extends keyof Prefs>(key: K, value: Prefs[K]) => {
    setPrefs(prev => {
      const next = { ...prev, [key]: value };
      invoke("prefs_set", { prefs: next }).catch(() => {});
      return next;
    });
  }, []);

  return (
    <PrefsContext.Provider value={{ prefs, setPref, savePrefs }}>
      {children}
    </PrefsContext.Provider>
  );
}

export const usePrefs = () => useContext(PrefsContext);
