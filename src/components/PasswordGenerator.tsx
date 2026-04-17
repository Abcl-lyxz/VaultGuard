import { useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { api, type GenOptions } from "../lib/ipc";

type Props = {
  onUse: (password: string) => void;
  onClose: () => void;
};

const DEFAULTS: GenOptions = {
  length: 20,
  lower: true,
  upper: true,
  digits: true,
  symbols: true,
  exclude_ambiguous: false,
};

export function PasswordGenerator({ onUse, onClose }: Props) {
  const [opts, setOpts]   = useState<GenOptions>(DEFAULTS);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function regen(next = opts) {
    setError(null);
    try {
      setValue(await api.genPassword(next));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  useEffect(() => {
    regen(DEFAULTS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function patch(p: Partial<GenOptions>) {
    const next = { ...opts, ...p };
    setOpts(next);
    regen(next);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Password generator</span>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="gen-value">
          <code>{value}</code>
          <button type="button" className="btn-icon" onClick={() => regen()} title="Regenerate">
            <RefreshCw size={15} />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-1)" }}>
          <div className="gen-length">
            <span>Length</span>
            <span className="gen-length-val">{opts.length}</span>
          </div>
          <input
            type="range"
            min={8}
            max={64}
            value={opts.length}
            onChange={(e) => patch({ length: Number(e.target.value) })}
          />
        </div>

        <div className="gen-checks">
          <label className="gen-check">
            <input type="checkbox" checked={opts.lower} onChange={(e) => patch({ lower: e.target.checked })} />
            a–z lowercase
          </label>
          <label className="gen-check">
            <input type="checkbox" checked={opts.upper} onChange={(e) => patch({ upper: e.target.checked })} />
            A–Z uppercase
          </label>
          <label className="gen-check">
            <input type="checkbox" checked={opts.digits} onChange={(e) => patch({ digits: e.target.checked })} />
            0–9 digits
          </label>
          <label className="gen-check">
            <input type="checkbox" checked={opts.symbols} onChange={(e) => patch({ symbols: e.target.checked })} />
            !@#$ symbols
          </label>
          <label className="gen-check" style={{ gridColumn: "1 / -1" }}>
            <input type="checkbox" checked={opts.exclude_ambiguous} onChange={(e) => patch({ exclude_ambiguous: e.target.checked })} />
            Exclude ambiguous (O, 0, l, 1)
          </label>
        </div>

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button type="button" onClick={() => { onUse(value); onClose(); }}>
            Use this password
          </button>
        </div>
      </div>
    </div>
  );
}
