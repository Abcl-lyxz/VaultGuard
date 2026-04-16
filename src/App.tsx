import { useEffect, useState } from "react";
import { api, type CmdError } from "./lib/ipc";
import { VaultView } from "./components/VaultView";
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

  if (mode === "loading") {
    return <div className="screen"><p>Loading…</p></div>;
  }

  if (mode === "unlocked") {
    return <VaultView onLock={onLock} />;
  }

  return (
    <div className="screen">
      <h1>VaultGuard</h1>
      <p className="subtitle">
        {mode === "create"
          ? "Set a master password to create your vault."
          : "Enter your master password to unlock."}
      </p>
      <form onSubmit={mode === "create" ? onCreate : onUnlock}>
        <input
          type="password"
          placeholder="Master password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          disabled={busy}
        />
        {mode === "create" && (
          <input
            type="password"
            placeholder="Confirm master password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={busy}
          />
        )}
        <button type="submit" disabled={busy || !password}>
          {busy ? "Working…" : mode === "create" ? "Create vault" : "Unlock"}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function formatError(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    return (e as CmdError).message;
  }
  return String(e);
}

export default App;
