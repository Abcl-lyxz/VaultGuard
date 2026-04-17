import { useState } from "react";
import { Download, Upload, X } from "lucide-react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { api, type ImportReport, type ImportStrategy } from "../lib/ipc";

type Props = { onClose: () => void };
type Mode = "menu" | "export" | "import";

export function SettingsModal({ onClose }: Props) {
  const [mode, setMode] = useState<Mode>("menu");

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Settings</span>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>

        {mode === "menu" && (
          <div className="settings-menu">
            <button
              className="settings-menu-btn"
              onClick={() => setMode("export")}
            >
              <Download size={18} className="settings-menu-btn-icon" />
              Export encrypted backup…
            </button>
            <button
              className="settings-menu-btn"
              onClick={() => setMode("import")}
            >
              <Upload size={18} className="settings-menu-btn-icon" />
              Import backup…
            </button>
          </div>
        )}

        {mode === "export" && <ExportPanel onDone={onClose} onBack={() => setMode("menu")} />}
        {mode === "import" && <ImportPanel onDone={onClose} onBack={() => setMode("menu")} />}
      </div>
    </div>
  );
}

function ExportPanel({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm]       = useState("");
  const [busy, setBusy]             = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [success, setSuccess]       = useState<string | null>(null);

  async function run() {
    setError(null);
    if (passphrase.length < 12) {
      setError("Passphrase must be at least 12 characters.");
      return;
    }
    if (passphrase !== confirm) {
      setError("Passphrases do not match.");
      return;
    }
    const path = await save({
      title: "Save encrypted backup",
      defaultPath: "vaultguard-backup.vgx",
      filters: [{ name: "VaultGuard export", extensions: ["vgx"] }],
    });
    if (!path) return;
    setBusy(true);
    try {
      await api.vaultExport(path, passphrase);
      setPassphrase("");
      setConfirm("");
      setSuccess(`Backup saved to ${path}`);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-panel">
      <p className="modal-subtitle">
        Encrypted with Argon2id + XChaCha20-Poly1305. Your master password is{" "}
        <strong>not</strong> used — set a separate passphrase for this backup.
      </p>
      <div className="field">
        <span>Backup passphrase</span>
        <input
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          autoFocus
        />
      </div>
      <div className="field">
        <span>Confirm passphrase</span>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>
      {error && <p className="error">{error}</p>}
      {success && <p className="success">{success}</p>}
      <div className="modal-actions">
        <button className="ghost" onClick={onBack} disabled={busy}>Back</button>
        {success ? (
          <button onClick={onDone}>Done</button>
        ) : (
          <button onClick={run} disabled={busy || !passphrase}>
            {busy ? "Exporting…" : "Choose file & export"}
          </button>
        )}
      </div>
    </div>
  );
}

function ImportPanel({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const [passphrase, setPassphrase] = useState("");
  const [strategy, setStrategy]     = useState<ImportStrategy>("skip");
  const [busy, setBusy]             = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [report, setReport]         = useState<ImportReport | null>(null);

  async function run() {
    setError(null);
    const path = await open({
      title: "Open encrypted backup",
      multiple: false,
      filters: [{ name: "VaultGuard export", extensions: ["vgx"] }],
    });
    if (!path || typeof path !== "string") return;
    setBusy(true);
    try {
      const rep = await api.vaultImport(path, passphrase, strategy);
      setReport(rep);
      setPassphrase("");
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-panel">
      <p className="modal-subtitle">
        Import items from a previously-exported <code>.vgx</code> file.
      </p>
      <div className="field">
        <span>Backup passphrase</span>
        <input
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          autoFocus
        />
      </div>
      <div className="field">
        <span>On duplicate IDs</span>
        <select value={strategy} onChange={(e) => setStrategy(e.target.value as ImportStrategy)}>
          <option value="skip">Skip — keep existing (safest)</option>
          <option value="overwrite">Overwrite — replace existing</option>
          <option value="keep_both">Keep both — import as new copies</option>
        </select>
      </div>
      {error && <p className="error">{error}</p>}
      {report && (
        <div className="import-report">
          <p><b>Imported:</b> {report.imported}</p>
          <p><b>Skipped:</b> {report.skipped}</p>
          <p><b>Overwritten:</b> {report.overwritten}</p>
          <p><b>Folders added:</b> {report.folders_added}</p>
        </div>
      )}
      <div className="modal-actions">
        <button className="ghost" onClick={onBack} disabled={busy}>Back</button>
        {report ? (
          <button onClick={onDone}>Done</button>
        ) : (
          <button onClick={run} disabled={busy || !passphrase}>
            {busy ? "Importing…" : "Choose file & import"}
          </button>
        )}
      </div>
    </div>
  );
}
