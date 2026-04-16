import { useEffect, useState } from "react";
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
  const [opts, setOpts] = useState<GenOptions>(DEFAULTS);
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
        <h2>Password generator</h2>
        <div className="gen-value">
          <code>{value}</code>
          <button type="button" onClick={() => regen()}>↻</button>
        </div>
        <label>
          Length: {opts.length}
          <input
            type="range"
            min={8}
            max={64}
            value={opts.length}
            onChange={(e) => patch({ length: Number(e.target.value) })}
          />
        </label>
        <div className="gen-checks">
          <label><input type="checkbox" checked={opts.lower} onChange={(e) => patch({ lower: e.target.checked })} /> a–z</label>
          <label><input type="checkbox" checked={opts.upper} onChange={(e) => patch({ upper: e.target.checked })} /> A–Z</label>
          <label><input type="checkbox" checked={opts.digits} onChange={(e) => patch({ digits: e.target.checked })} /> 0–9</label>
          <label><input type="checkbox" checked={opts.symbols} onChange={(e) => patch({ symbols: e.target.checked })} /> !@#$</label>
          <label><input type="checkbox" checked={opts.exclude_ambiguous} onChange={(e) => patch({ exclude_ambiguous: e.target.checked })} /> no O/0/l/1</label>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button type="button" onClick={() => { onUse(value); onClose(); }}>Use this</button>
        </div>
      </div>
    </div>
  );
}
