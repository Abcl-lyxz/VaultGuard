import { useToast, type ToastKind } from "../../contexts/ToastContext";

const ICONS: Record<ToastKind, string> = {
  success: "✓",
  error:   "✕",
  warning: "⚠",
  info:    "ℹ",
};

export function ToastStack() {
  const { toasts, dismiss } = useToast();
  if (!toasts.length) return null;
  return (
    <div className="toast-stack" role="region" aria-label="Notifications" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.kind}`} role="status">
          <span className="toast-icon" aria-hidden="true">{ICONS[t.kind]}</span>
          <span className="toast-message">{t.message}</span>
          <button className="toast-close btn-icon" onClick={() => dismiss(t.id)} aria-label="Dismiss notification">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
