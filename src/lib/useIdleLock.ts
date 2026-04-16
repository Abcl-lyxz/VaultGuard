import { useEffect } from "react";

/// Locks the vault after `idleMinutes` of no activity, or when the window loses focus
/// and stays hidden for `blurSeconds`.
export function useIdleLock(
  idleMinutes: number,
  blurSeconds: number,
  onLock: () => void,
) {
  useEffect(() => {
    let idleTimer: number | null = null;
    let blurTimer: number | null = null;

    const fireIdle = () => {
      onLock();
    };

    const armIdle = () => {
      if (idleTimer) window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(fireIdle, idleMinutes * 60_000);
    };

    const reset = () => armIdle();

    const onBlur = () => {
      if (blurTimer) window.clearTimeout(blurTimer);
      blurTimer = window.setTimeout(onLock, blurSeconds * 1000);
    };
    const onFocus = () => {
      if (blurTimer) { window.clearTimeout(blurTimer); blurTimer = null; }
      armIdle();
    };

    const events = ["mousemove", "keydown", "mousedown", "touchstart", "scroll"] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);

    armIdle();

    return () => {
      if (idleTimer) window.clearTimeout(idleTimer);
      if (blurTimer) window.clearTimeout(blurTimer);
      events.forEach((e) => window.removeEventListener(e, reset));
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, [idleMinutes, blurSeconds, onLock]);
}
