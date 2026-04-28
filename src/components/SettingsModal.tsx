import { useState } from "react";
import { Download, Upload } from "lucide-react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { api, type ImportReport, type ImportStrategy } from "../lib/ipc";
import { Modal } from "./ui/Modal";
import { useTheme } from "../contexts/ThemeContext";
import { usePrefs } from "../contexts/PrefsContext";

type Props = { onClose: () => void };
type Tab = "backup" | "prefs" | "help";

export function SettingsModal({ onClose }: Props) {
  const [tab, setTab] = useState<Tab>("backup");
  const [backupView, setBackupView] = useState<"menu" | "export" | "import">("menu");

  return (
    <Modal open title="Settings" onClose={onClose} width="480px">
      <div className="settings-tabs">
        {(["backup", "prefs", "help"] as Tab[]).map(t => (
          <button key={t} className={"settings-tab" + (tab === t ? " active" : "")} onClick={() => { setTab(t); setBackupView("menu"); }}>
            {t === "backup" ? "Backup" : t === "prefs" ? "Preferences" : "Help"}
          </button>
        ))}
      </div>

      {tab === "backup" && (
        <>
          {backupView === "menu" && (
            <div className="settings-menu">
              <button className="settings-menu-btn" onClick={() => setBackupView("export")}>
                <Download size={18} className="settings-menu-btn-icon" />
                Export encrypted backup…
              </button>
              <button className="settings-menu-btn" onClick={() => setBackupView("import")}>
                <Upload size={18} className="settings-menu-btn-icon" />
                Import backup…
              </button>
            </div>
          )}
          {backupView === "export" && <ExportPanel onDone={onClose} onBack={() => setBackupView("menu")} />}
          {backupView === "import" && <ImportPanel onDone={onClose} onBack={() => setBackupView("menu")} />}
        </>
      )}

      {tab === "prefs" && <PrefsPanel />}
      {tab === "help"  && <HelpPanel />}
    </Modal>
  );
}

function PrefsPanel() {
  const { mode, setMode } = useTheme();
  const { prefs, setPref } = usePrefs();

  return (
    <div className="prefs-group">
      <div className="pref-row">
        <div className="pref-row-label">
          <span className="pref-row-title">Theme</span>
          <span className="pref-row-desc">Light, dark, or follow system</span>
        </div>
        <select className="pref-select" value={mode} onChange={e => setMode(e.target.value as "light"|"dark"|"system")}>
          <option value="system">System</option>
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </div>

      <div className="prefs-divider" />

      <div className="pref-row">
        <div className="pref-row-label">
          <span className="pref-row-title">Auto-lock after</span>
          <span className="pref-row-desc">Idle timeout before vault locks</span>
        </div>
        <select className="pref-select" value={prefs.idle_minutes} onChange={e => setPref("idle_minutes", Number(e.target.value))}>
          {[1,3,5,10,15,30].map(m => <option key={m} value={m}>{m} min</option>)}
        </select>
      </div>

      <div className="pref-row">
        <div className="pref-row-label">
          <span className="pref-row-title">Lock on window blur</span>
          <span className="pref-row-desc">Lock when VaultGuard loses focus</span>
        </div>
        <label className="pref-toggle">
          <input type="checkbox" checked={prefs.lock_on_blur} onChange={e => setPref("lock_on_blur", e.target.checked)} />
          <span className="pref-toggle-track" />
        </label>
      </div>

      <div className="prefs-divider" />

      <div className="pref-row">
        <div className="pref-row-label">
          <span className="pref-row-title">Clipboard clear after</span>
          <span className="pref-row-desc">Seconds before copied secret is cleared</span>
        </div>
        <select className="pref-select" value={prefs.clipboard_ttl_secs} onChange={e => setPref("clipboard_ttl_secs", Number(e.target.value))}>
          {[10,20,30,60].map(s => <option key={s} value={s}>{s}s</option>)}
        </select>
      </div>

      <div className="prefs-divider" />

      <div className="pref-row">
        <div className="pref-row-label">
          <span className="pref-row-title">Native autofill hotkey</span>
          <span className="pref-row-desc">Keyboard shortcut for desktop autofill</span>
        </div>
        <kbd>{prefs.autofill_hotkey}</kbd>
      </div>
    </div>
  );
}

function HelpPanel() {
  return (
    <div className="help-section">
      <p className="help-note">
        <strong>Native autofill (desktop apps):</strong> Focus any password field in a Windows app,
        then press <kbd>Ctrl+Shift+\</kbd> to open the quick picker. Select a login and VaultGuard
        will type the credentials into the focused field using UI Automation.
      </p>

      <div className="help-section-title">Keyboard shortcuts</div>

      {[
        ["Lock vault",         ["Ctrl", "L"]],
        ["New item",           ["Ctrl", "N"]],
        ["Search",             ["Ctrl", "F"]],
        ["Command palette",    ["Ctrl", "K"]],
        ["Settings",           ["Ctrl", ","]],
        ["Native autofill",    ["Ctrl", "Shift", "\\"]],
        ["Close / Cancel",     ["Esc"]],
        ["Navigate list",      ["↑ / ↓"]],
      ].map(([desc, keys]) => (
        <div key={desc as string} className="shortcut-row">
          <span className="shortcut-desc">{desc as string}</span>
          <span className="shortcut-keys">
            {(keys as string[]).map(k => <kbd key={k}>{k}</kbd>)}
          </span>
        </div>
      ))}
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
    if (passphrase.length < 12) { setError("Passphrase must be at least 12 characters."); return; }
    if (passphrase !== confirm)  { setError("Passphrases do not match."); return; }
    const path = await save({ title: "Save encrypted backup", defaultPath: "vaultguard-backup.vgx", filters: [{ name: "VaultGuard export", extensions: ["vgx"] }] });
    if (!path) return;
    setBusy(true);
    try {
      await api.vaultExport(path, passphrase);
      setPassphrase(""); setConfirm("");
      setSuccess(`Backup saved to ${path}`);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally { setBusy(false); }
  }

  return (
    <div className="settings-panel">
      <p className="modal-subtitle">
        Encrypted with Argon2id + XChaCha20-Poly1305. Your master password is <strong>not</strong> used — set a separate passphrase.
      </p>
      <div className="field">
        <label htmlFor="exp-pw">Backup passphrase</label>
        <input id="exp-pw" type="password" value={passphrase} onChange={e => setPassphrase(e.target.value)} autoFocus />
      </div>
      <div className="field">
        <label htmlFor="exp-conf">Confirm passphrase</label>
        <input id="exp-conf" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} />
      </div>
      {error && <p className="error">{error}</p>}
      {success && <p className="success">{success}</p>}
      <div className="modal-actions">
        <button className="ghost" onClick={onBack} disabled={busy}>Back</button>
        {success ? <button onClick={onDone}>Done</button> : (
          <button onClick={run} disabled={busy || !passphrase}>{busy ? "Exporting…" : "Choose file & export"}</button>
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
    const path = await open({ title: "Open encrypted backup", multiple: false, filters: [{ name: "VaultGuard export", extensions: ["vgx"] }] });
    if (!path || typeof path !== "string") return;
    setBusy(true);
    try {
      const rep = await api.vaultImport(path, passphrase, strategy);
      setReport(rep); setPassphrase("");
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally { setBusy(false); }
  }

  return (
    <div className="settings-panel">
      <p className="modal-subtitle">Import items from a previously-exported <code>.vgx</code> file.</p>
      <div className="field">
        <label htmlFor="imp-pw">Backup passphrase</label>
        <input id="imp-pw" type="password" value={passphrase} onChange={e => setPassphrase(e.target.value)} autoFocus />
      </div>
      <div className="field">
        <label htmlFor="imp-strat">On duplicate IDs</label>
        <select id="imp-strat" value={strategy} onChange={e => setStrategy(e.target.value as ImportStrategy)}>
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
        {report ? <button onClick={onDone}>Done</button> : (
          <button onClick={run} disabled={busy || !passphrase}>{busy ? "Importing…" : "Choose file & import"}</button>
        )}
      </div>
    </div>
  );
}
