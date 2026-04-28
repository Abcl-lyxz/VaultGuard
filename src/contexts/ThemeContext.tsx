import { createContext, useContext, useEffect, useState } from "react";

type ThemeMode = "light" | "dark" | "system";

interface ThemeContextValue {
  mode: ThemeMode;
  resolved: "light" | "dark";
  setMode: (m: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: "system",
  resolved: "dark",
  setMode: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(
    () => (localStorage.getItem("vg.theme") as ThemeMode) ?? "system"
  );

  const getResolved = (m: ThemeMode): "light" | "dark" => {
    if (m === "system") {
      return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    }
    return m;
  };

  const [resolved, setResolved] = useState<"light" | "dark">(() => getResolved(mode));

  useEffect(() => {
    const apply = (m: ThemeMode) => {
      const r = getResolved(m);
      setResolved(r);
      document.documentElement.setAttribute("data-theme", r);
    };
    apply(mode);

    if (mode === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: light)");
      const handler = () => apply("system");
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
  }, [mode]);

  const setMode = (m: ThemeMode) => {
    localStorage.setItem("vg.theme", m);
    setModeState(m);
  };

  return (
    <ThemeContext.Provider value={{ mode, resolved, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
