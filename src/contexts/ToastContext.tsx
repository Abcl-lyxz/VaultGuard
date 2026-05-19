import { createContext, useCallback, useContext, useRef, useState } from "react";

export type ToastKind = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  message: string;
  kind: ToastKind;
  duration?: number;
  closing?: boolean;
}

interface ToastContextValue {
  toasts: Toast[];
  toast: (message: string, kind?: ToastKind, duration?: number) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue>({
  toasts: [],
  toast: () => {},
  dismiss: () => {},
});

const EXIT_MS = 120; // matches @keyframes toastOut

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    const t = timers.current.get(id);
    if (t) { clearTimeout(t); timers.current.delete(id); }
    setToasts(prev => prev.map(x => x.id === id ? { ...x, closing: true } : x));
    const t2 = setTimeout(() => {
      setToasts(prev => prev.filter(x => x.id !== id));
      timers.current.delete(id);
    }, EXIT_MS);
    timers.current.set(id, t2);
  }, []);

  const toast = useCallback((message: string, kind: ToastKind = "info", duration = 3500) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev.slice(-4), { id, message, kind, duration }]);
    const timer = setTimeout(() => dismiss(id), duration);
    timers.current.set(id, timer);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={{ toasts, toast, dismiss }}>
      {children}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
