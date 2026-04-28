import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { api, type CmdError } from "./lib/ipc";
import { VaultView } from "./components/VaultView";
import { ToastStack } from "./components/ui/Toast";
import "./App.css";

type Mode = "loading" | "create" | "unlock" | "unlocked";

function App() {
  const [mode, setMode] = useState<Mode>("loading");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const exists = await api.vaultExists();
        setMode(exists ? "unlock" : "create");
      } catch (e) {
        setError(formatError(e));
      }
    })();
  }, []);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 12) {
      setError("Master password must be at least 12 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await api.vaultCreate(password);
      setPassword("");
      setConfirm("");
      setMode("unlocked");
    } catch (e) {
      setError(formatError(e));
    } finally {
      setBusy(false);
    }
  }

  async function onUnlock(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.vaultUnlock(password);
      setPassword("");
      setMode("unlocked");
    } catch (e) {
      setError(formatError(e));
    } finally {
      setBusy(false);
    }
  }

  async function onLock() {
    await api.vaultLock();
    setMode("unlock");
  }

  return (
    <>
      {mode === "loading" && (
        <div className="auth-screen">
          <div className="auth-card">
            <div className="auth-logo">
              <ShieldCheck size={28} className="auth-logo-icon" />
              <span className="auth-logo-text">VaultGuard</span>
            </div>
            <p className="auth-subtitle">Loading…</p>
          </div>
        </div>
      )}

      {mode === "unlocked" && <VaultView onLock={onLock} />}

      {(mode === "create" || mode === "unlock") && (
        <div className="auth-screen">
          <div className="auth-card">
            <div className="auth-logo">
              <ShieldCheck size={28} className="auth-logo-icon" />
              <span className="auth-logo-text">VaultGuard</span>
            </div>
            <p className="auth-subtitle">
              {mode === "create"
                ? "Set a master password to create your encrypted vault."
                : "Enter your master password to unlock your vault."}
            </p>
            <form className="auth-form" onSubmit={mode === "create" ? onCreate : onUnlock}>
              <div className="field">
                <label htmlFor="master-pw">Master password</label>
                <input
                  id="master-pw"
                  type="password"
                  placeholder="Enter master password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                  disabled={busy}
                />
              </div>
              {mode === "create" && (
                <div className="field">
                  <label htmlFor="confirm-pw">Confirm password</label>
                  <input
                    id="confirm-pw"
                    type="password"
                    placeholder="Confirm master password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    disabled={busy}
                  />
                </div>
              )}
              {error && <p className="error">{error}</p>}
              <button className="btn-primary" type="submit" disabled={busy || !password}>
                {busy ? "Working…" : mode === "create" ? "Create vault" : "Unlock"}
              </button>
            </form>
          </div>
        </div>
      )}

      <ToastStack />
    </>
  );
}

function formatError(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    return (e as CmdError).message;
  }
  return String(e);
}

export default App;
