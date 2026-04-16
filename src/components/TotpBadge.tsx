import { useEffect, useRef, useState } from "react";
import { api, type TotpSnapshot, type TotpSpec } from "../lib/ipc";

type Props = {
  spec: TotpSpec;
  onCopy?: (code: string) => void;
};

export function TotpBadge({ spec, onCopy }: Props) {
  const [snap, setSnap] = useState<TotpSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const s = await api.totpNow(spec);
        if (!cancelled) {
          setSnap(s);
          setError(null);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? String(e));
      }
    }
    tick();
    timer.current = window.setInterval(tick, 1000);
    return () => {
      cancelled = true;
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [spec.secret, spec.algorithm, spec.digits, spec.period]);

  if (error) return <span className="totp-err">{error}</span>;
  if (!snap) return <span className="totp-loading">…</span>;

  const pct = (snap.remaining / snap.period) * 100;
  return (
    <div className="totp">
      <button
        type="button"
        className="totp-code"
        title="Click to copy"
        onClick={() => onCopy?.(snap.code)}
      >
        {formatCode(snap.code)}
      </button>
      <div className="totp-bar">
        <div className="totp-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="totp-remaining">{snap.remaining}s</span>
    </div>
  );
}

function formatCode(c: string): string {
  if (c.length === 6) return c.slice(0, 3) + " " + c.slice(3);
  if (c.length === 8) return c.slice(0, 4) + " " + c.slice(4);
  return c;
}
