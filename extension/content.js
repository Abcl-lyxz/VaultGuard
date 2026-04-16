// Content script — detects login forms, asks the desktop for credentials when
// the user clicks a small VaultGuard button injected next to a password field.
// We intentionally do NOT auto-fill silently; user must click the badge to
// trigger a desktop approval prompt.

(function () {
  const TAG = "vg-fill-badge";

  function findLoginPair() {
    const pw = document.querySelector('input[type="password"]:not([disabled])');
    if (!pw) return null;
    let user = null;
    const inputs = Array.from(document.querySelectorAll("input"));
    const pwIdx = inputs.indexOf(pw);
    for (let i = pwIdx - 1; i >= 0; i--) {
      const t = (inputs[i].type || "").toLowerCase();
      if (["text", "email", "tel", ""].includes(t)) {
        user = inputs[i];
        break;
      }
    }
    return { user, pw };
  }

  function injectBadge(pair) {
    if (document.querySelector(TAG)) return;
    const badge = document.createElement("button");
    badge.textContent = "🔐";
    badge.title = "VaultGuard fill";
    badge.setAttribute("aria-label", "VaultGuard fill");
    Object.assign(badge.style, {
      position: "absolute",
      zIndex: 2147483647,
      padding: "2px 6px",
      fontSize: "14px",
      lineHeight: "1",
      border: "1px solid #2c313c",
      background: "#181b21",
      color: "#e8e8ea",
      borderRadius: "4px",
      cursor: "pointer",
    });
    badge.id = TAG;
    document.body.appendChild(badge);

    function position() {
      const r = pair.pw.getBoundingClientRect();
      badge.style.top = `${window.scrollY + r.top + (r.height - 22) / 2}px`;
      badge.style.left = `${window.scrollX + r.right - 28}px`;
    }
    position();
    window.addEventListener("scroll", position, { passive: true });
    window.addEventListener("resize", position);

    badge.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const origin = location.origin;
      const resp = await chrome.runtime.sendMessage({
        type: "vg:fetch_creds",
        origin,
      });
      if (!resp?.ok) {
        badge.title = `VaultGuard: ${resp?.error || "error"}`;
        return;
      }
      const cred = (resp.items || [])[0];
      if (!cred) {
        badge.title = "VaultGuard: no match";
        return;
      }
      if (pair.user) {
        setNative(pair.user, cred.username);
      }
      setNative(pair.pw, cred.password);
    });
  }

  // React-friendly value setter: bypass framework getters/setters.
  function setNative(el, value) {
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc?.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function tick() {
    const pair = findLoginPair();
    if (pair) injectBadge(pair);
  }

  // Run now, then watch the DOM for SPAs that mount forms async.
  tick();
  const obs = new MutationObserver(() => tick());
  obs.observe(document.documentElement, { childList: true, subtree: true });
})();
