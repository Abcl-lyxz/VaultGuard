// Content script — detects login forms, asks the desktop for credentials when
// the user clicks a small VaultGuard button injected next to a password field.
// We intentionally do NOT auto-fill silently; user must click the badge to
// trigger a desktop approval prompt.

(function () {
  const TAG = "vg-fill-badge";

  // ── Form detection ──────────────────────────────────────────────────────────
  // Returns { user, pw } or null. Uses multiple heuristics in priority order.
  function findLoginPair() {
    const pw = document.querySelector('input[type="password"]:not([disabled])');
    if (!pw) return null;

    // Priority 1: autocomplete attribute (most reliable signal)
    const byAutocomplete = document.querySelector(
      'input[autocomplete="username"], input[autocomplete="email"], input[autocomplete="tel"]'
    );
    if (byAutocomplete && byAutocomplete !== pw) {
      return { user: byAutocomplete, pw };
    }

    const inputs = Array.from(document.querySelectorAll("input:not([disabled])"));
    const pwIdx = inputs.indexOf(pw);

    // Priority 2: name / id / aria-label / placeholder hinting at username
    const nameHint = /user|login|email|account|phone|mobile/i;
    for (let i = pwIdx - 1; i >= 0; i--) {
      const el = inputs[i];
      const attrs = [el.name, el.id, el.getAttribute("aria-label"), el.placeholder]
        .filter(Boolean)
        .join(" ");
      if (nameHint.test(attrs)) return { user: el, pw };
    }

    // Priority 3: nearest preceding text-like input (original heuristic)
    for (let i = pwIdx - 1; i >= 0; i--) {
      const t = (inputs[i].type || "").toLowerCase();
      if (["text", "email", "tel", ""].includes(t)) {
        return { user: inputs[i], pw };
      }
    }

    // No username field found — password-only form
    return { user: null, pw };
  }

  // ── Badge injection ─────────────────────────────────────────────────────────
  function injectBadge(pair) {
    // FIX: was document.querySelector(TAG) — that searches for a custom element
    // tag, not an id. Use getElementById to find the badge by its id attribute.
    if (document.getElementById(TAG)) return;

    const badge = document.createElement("button");
    badge.id = TAG;
    badge.title = "VaultGuard fill";
    badge.setAttribute("aria-label", "VaultGuard fill");

    // Inline SVG shield icon — no emoji rendering dependency
    badge.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14"
      viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>`;

    Object.assign(badge.style, {
      position: "absolute",
      zIndex: 2147483647,
      width: "26px",
      height: "22px",
      padding: "0",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      border: "1px solid rgba(91,140,255,0.4)",
      background: "rgba(13,17,23,0.92)",
      color: "#5b8cff",
      borderRadius: "4px",
      cursor: "pointer",
      boxShadow: "0 2px 6px rgba(0,0,0,0.4)",
      transition: "transform 120ms ease, background 120ms ease",
    });

    badge.addEventListener("mouseenter", () => {
      badge.style.background = "rgba(91,140,255,0.18)";
      badge.style.transform = "scale(1.1)";
    });
    badge.addEventListener("mouseleave", () => {
      badge.style.background = "rgba(13,17,23,0.92)";
      badge.style.transform = "scale(1)";
    });

    document.body.appendChild(badge);

    function position() {
      const r = pair.pw.getBoundingClientRect();
      badge.style.top  = `${window.scrollY + r.top  + (r.height - 22) / 2}px`;
      badge.style.left = `${window.scrollX + r.right - 30}px`;
    }
    position();
    window.addEventListener("scroll", position, { passive: true });
    window.addEventListener("resize", position, { passive: true });

    badge.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const origin = location.origin;
      const resp = await chrome.runtime.sendMessage({ type: "vg:fetch_creds", origin });
      if (!resp?.ok) {
        badge.title = `VaultGuard: ${resp?.error || "error"}`;
        return;
      }
      const cred = (resp.items || [])[0];
      if (!cred) {
        badge.title = "VaultGuard: no match";
        return;
      }
      if (pair.user) setNative(pair.user, cred.username);
      setNative(pair.pw, cred.password);
    });
  }

  // ── React-friendly value setter ─────────────────────────────────────────────
  // Bypasses React's synthetic event system by calling the native setter.
  function setNative(el, value) {
    const proto = Object.getPrototypeOf(el);
    const desc  = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc?.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input",  { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function tick() {
    const pair = findLoginPair();
    if (pair) injectBadge(pair);
  }

  // ── Bootstrap ───────────────────────────────────────────────────────────────
  tick();

  // Debounce the MutationObserver so it doesn't fire on every DOM mutation
  // in high-frequency SPAs (e.g. every keystroke re-render).
  let tickTimer = null;
  const obs = new MutationObserver(() => {
    clearTimeout(tickTimer);
    tickTimer = setTimeout(tick, 150);
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
})();
