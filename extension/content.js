// VaultGuard content script v0.5.0
// Detects login forms, injects a badge over the password field, fills credentials
// from the desktop app on click. Now also: fills TOTP codes if the saved login has
// a totp_secret, and captures form submissions to offer save-new / update-password.

// Guard: run once per frame
if (window.__vgLoaded) {
  // already injected in this frame — skip
} else {
window.__vgLoaded = true;

(function () {
  const BADGE_ID  = 'vg-fill-badge';
  const CHOOSER_ID = 'vg-chooser-host';
  const TOAST_ID  = 'vg-toast-host';

  // ── In-page error/info toast (Shadow DOM isolated) ────────────────────────
  let toastTimeout = null;
  function showToast(msg, durationMs = 3000) {
    let host = document.getElementById(TOAST_ID);
    if (!host) {
      host = document.createElement('div');
      host.id = TOAST_ID;
      Object.assign(host.style, {
        position: 'fixed',
        top: '16px',
        right: '16px',
        zIndex: '2147483646',
        pointerEvents: 'none',
      });
      document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = `
        <style>
          #toast {
            background: rgba(13,17,23,0.95);
            color: #e8e8ea;
            border: 1px solid rgba(91,140,255,0.35);
            border-radius: 8px;
            padding: 10px 14px;
            font: 13px/1.4 system-ui, sans-serif;
            box-shadow: 0 4px 16px rgba(0,0,0,0.5);
            max-width: 280px;
            word-break: break-word;
            opacity: 1;
            transition: opacity 400ms ease;
          }
          #toast.hide { opacity: 0; }
        </style>
        <div id="toast"></div>
      `;
    }
    const toastEl = host.shadowRoot.getElementById('toast');
    toastEl.classList.remove('hide');
    toastEl.textContent = msg;
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      toastEl.classList.add('hide');
    }, durationMs);
  }

  // ── Improved native value setter (framework-compatible) ───────────────────
  function setNativeValue(el, value) {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const nativeDesc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
      if (nativeDesc && nativeDesc.set) {
        nativeDesc.set.call(el, value);
      } else {
        el.value = value;
      }
    } else if (el.isContentEditable) {
      el.textContent = value;
    }
  }

  // ── Full event sequence for framework compatibility ────────────────────────
  function dispatchInputEvents(el, value, { skipBlur = false } = {}) {
    el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true, cancelable: true, key: 'a', inputType: 'insertText',
    }));
    el.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true, cancelable: true, inputType: 'insertText', data: value,
    }));
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true, inputType: 'insertText', data: value,
    }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', {
      bubbles: true, cancelable: true, key: 'a',
    }));
    if (!skipBlur) {
      el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    }
  }

  // ── Shadow DOM recursive password field collector ─────────────────────────
  function collectPasswordInputs(root) {
    const results = [];
    root.querySelectorAll('input[type="password"]').forEach(el => results.push(el));
    root.querySelectorAll('*').forEach(el => {
      if (el.shadowRoot) {
        collectPasswordInputs(el.shadowRoot).forEach(pw => results.push(pw));
      }
    });
    return results;
  }

  function isVisible(el) {
    if (!el) return false;
    const cs = window.getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && !el.disabled && el.type !== 'hidden';
  }

  // ── Improved findLoginPair with shadow DOM + signup detection ─────────────
  function findLoginPair(root = document) {
    // Collect all password inputs (including shadow DOM)
    const pwInputs = collectPasswordInputs(root).filter(isVisible);
    if (pwInputs.length === 0) return null;

    // Signup detection: ≥2 password inputs or any autocomplete="new-password"
    if (pwInputs.length >= 2) return null;
    const hasNewPw = (root.querySelector || root.querySelectorAll.bind(root))
      ? !!root.querySelector('input[autocomplete="new-password"]')
      : false;
    if (hasNewPw) return null;

    const pw = pwInputs[0];

    // Collect all visible enabled non-hidden inputs from the same root
    const allInputs = Array.from(root.querySelectorAll('input:not([disabled])')).filter(isVisible);
    const pwIdx = allInputs.indexOf(pw);

    // Priority 0: <label> text matching
    let labelMatch = null;
    if (pw.id) {
      const lbl = root.querySelector(`label[for="${CSS.escape(pw.id)}"]`);
      if (lbl && /user|login|email|username/i.test(lbl.textContent)) {
        // find the input that label points to — we're looking for the *user* field label
        // (this block just confirms pattern; we still need to find the user field below)
      }
    }
    // Walk all labels, find one wrapping or pointing-to a user input
    const labels = Array.from(root.querySelectorAll('label'));
    for (const lbl of labels) {
      if (!/user|login|email|username/i.test(lbl.textContent)) continue;
      let target = null;
      if (lbl.htmlFor) {
        target = root.getElementById(lbl.htmlFor);
      } else {
        target = lbl.querySelector('input');
      }
      if (target && isVisible(target) && target !== pw) {
        labelMatch = target;
        break;
      }
    }
    if (labelMatch) return { user: labelMatch, pw };

    // Priority 1: autocomplete attribute
    const byAutocomplete = root.querySelector(
      'input[autocomplete="username"], input[autocomplete="email"], input[autocomplete="tel"]'
    );
    if (byAutocomplete && byAutocomplete !== pw && isVisible(byAutocomplete)) {
      return { user: byAutocomplete, pw };
    }

    // Priority 2: name/id/aria-label/placeholder hinting
    const nameHint = /user|login|email|account|phone|mobile/i;
    for (let i = pwIdx - 1; i >= 0; i--) {
      const el = allInputs[i];
      if (!isVisible(el)) continue;
      const attrs = [el.name, el.id, el.getAttribute('aria-label'), el.placeholder]
        .filter(Boolean).join(' ');
      if (nameHint.test(attrs)) return { user: el, pw };
    }

    // Priority 3: nearest preceding text-like input
    for (let i = pwIdx - 1; i >= 0; i--) {
      const el = allInputs[i];
      if (!isVisible(el)) continue;
      const t = (el.type || '').toLowerCase();
      if (['text', 'email', 'tel', ''].includes(t)) return { user: el, pw };
    }

    // No username field — password-only form
    return { user: null, pw };
  }

  // ── Fill a pair with username + password ──────────────────────────────────
  async function fillPair(pair, username, password) {
    // Re-resolve stale references
    if (pair.user && !pair.user.isConnected) {
      const fresh = findLoginPair();
      if (fresh) pair = fresh;
    }

    if (pair.user && isVisible(pair.user)) {
      pair.user.focus();
      setNativeValue(pair.user, username);
      dispatchInputEvents(pair.user, username, { skipBlur: false });
    }

    if (pair.pw && pair.pw.isConnected && isVisible(pair.pw)) {
      pair.pw.focus();
      setNativeValue(pair.pw, password);
      dispatchInputEvents(pair.pw, password, { skipBlur: true }); // leave password focused
    }
  }

  // ── Multi-credential chooser (Shadow DOM) ─────────────────────────────────
  function showChooser(items, onSelect) {
    // Remove any existing chooser
    removeChooser();

    const host = document.createElement('div');
    host.id = CHOOSER_ID;
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });

    const itemsHtml = items.map((item, i) => `
      <div class="item" data-idx="${i}" tabindex="0" role="button" aria-label="${escapeHtml(item.username)}">
        <span class="user">${escapeHtml(item.username)}</span>
        ${item.name ? `<span class="site">${escapeHtml(item.name)}</span>` : ''}
      </div>
    `).join('');

    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        #overlay {
          position: fixed;
          inset: 0;
          z-index: 2147483645;
          background: rgba(0,0,0,0.25);
        }
        #panel {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: #0f1115;
          border: 1px solid rgba(91,140,255,0.35);
          border-radius: 10px;
          padding: 12px;
          min-width: 220px;
          max-width: 320px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.6);
          font: 14px/1.4 system-ui, sans-serif;
          color: #e8e8ea;
        }
        h3 {
          margin: 0 0 10px;
          font-size: 13px;
          color: #a0a4ad;
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .item {
          display: flex;
          flex-direction: column;
          padding: 8px 10px;
          border-radius: 6px;
          cursor: pointer;
          gap: 2px;
          outline: none;
          transition: background 100ms;
        }
        .item:hover, .item:focus { background: rgba(91,140,255,0.14); }
        .user { font-weight: 600; font-size: 14px; }
        .site { font-size: 12px; color: #a0a4ad; }
        .close {
          position: absolute;
          top: 10px;
          right: 12px;
          background: none;
          border: none;
          color: #a0a4ad;
          cursor: pointer;
          font-size: 16px;
          line-height: 1;
          padding: 2px 4px;
        }
        .close:hover { color: #e8e8ea; }
      </style>
      <div id="overlay"></div>
      <div id="panel" role="dialog" aria-label="Choose credential">
        <button class="close" id="close-btn" aria-label="Close">&times;</button>
        <h3>Choose account</h3>
        ${itemsHtml}
      </div>
    `;

    function cleanup() { removeChooser(); }

    shadow.getElementById('overlay').addEventListener('click', cleanup);
    shadow.getElementById('close-btn').addEventListener('click', cleanup);

    shadow.querySelectorAll('.item').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.idx, 10);
        cleanup();
        onSelect(items[idx]);
      });
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          const idx = parseInt(el.dataset.idx, 10);
          cleanup();
          onSelect(items[idx]);
        }
      });
    });

    // Close on Escape
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') { cleanup(); document.removeEventListener('keydown', escHandler); }
    });

    // Focus first item
    const firstItem = shadow.querySelector('.item');
    if (firstItem) setTimeout(() => firstItem.focus(), 50);
  }

  function removeChooser() {
    const existing = document.getElementById(CHOOSER_ID);
    if (existing) existing.remove();
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Badge lifecycle ───────────────────────────────────────────────────────
  let pwRef = null;
  let scrollHandler = null;
  let resizeHandler = null;
  let currentBadge = null;

  function removeBadge() {
    const existing = document.getElementById(BADGE_ID);
    if (existing) existing.remove();
    if (scrollHandler) { window.removeEventListener('scroll', scrollHandler); scrollHandler = null; }
    if (resizeHandler) { window.removeEventListener('resize', resizeHandler); resizeHandler = null; }
    pwRef = null;
    currentBadge = null;
  }

  function badgeSuccessFeedback(badge) {
    // Show checkmark, scale animation, then reset after 1.5s
    badge.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14"
      viewBox="0 0 24 24" fill="none" stroke="#4ade80"
      stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>`;
    badge.title = 'Filled!';
    badge.style.color = '#4ade80';
    badge.style.borderColor = 'rgba(74,222,128,0.5)';
    badge.style.transform = 'scale(1.1)';
    setTimeout(() => { badge.style.transform = 'scale(1.0)'; }, 150);
    setTimeout(() => {
      if (badge.isConnected) {
        badge.innerHTML = SHIELD_SVG;
        badge.title = 'VaultGuard fill';
        badge.style.color = '#5b8cff';
        badge.style.borderColor = 'rgba(91,140,255,0.4)';
      }
    }, 1500);
  }

  const SHIELD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14"
    viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
  </svg>`;

  let fillInFlight = false;

  async function handleFillRequest(badge) {
    if (fillInFlight) return;
    fillInFlight = true;
    if (badge) badge.style.opacity = "0.5";
    try { await _handleFillRequest(badge); }
    finally { fillInFlight = false; if (badge) badge.style.opacity = ""; }
  }

  async function _handleFillRequest(badge) {
    // Always find pair fresh at click time — fixes orphan-node stale closure bug
    let pair = findLoginPair();

    // Check for multi-step login: password-only page + cached username
    if (pair && pair.user === null) {
      const cachedUser = sessionStorage.getItem('vg_cached_username');
      if (!cachedUser) {
        // Pure pw-only page, no cached user — proceed but username will be empty
      }
    }

    // Check for username-only page (pw is null) — cache and show toast
    if (!pair || !pair.pw) {
      // Maybe username-only step
      const freshPair = findLoginPair();
      if (freshPair && freshPair.pw === null && freshPair.user) {
        sessionStorage.setItem('vg_cached_username', freshPair.user.value || '');
        showToast('VaultGuard: username cached for next step');
        return;
      }
      showToast('ไม่พบช่อง login บนหน้านี้');
      return;
    }

    // Verify pw is still connected
    if (!pair.pw.isConnected) {
      pair = findLoginPair();
      if (!pair || !pair.pw || !pair.pw.isConnected) {
        showToast('ไม่พบช่อง login บนหน้านี้');
        return;
      }
    }

    const origin = location.origin;
    let resp;
    try {
      resp = await chrome.runtime.sendMessage({ type: 'vg:fetch_creds', origin });
    } catch (e) {
      showToast('Connection error');
      return;
    }

    if (!resp?.ok) {
      badge.title = `VaultGuard: ${resp?.error || 'error'}`;
      showToast(`VaultGuard: ${resp?.error || 'Connection error'}`);
      return;
    }

    const items = resp.items || [];
    if (items.length === 0) {
      badge.title = 'VaultGuard: no match';
      showToast('VaultGuard: no credentials found');
      return;
    }

    if (items.length === 1) {
      await applyCred(pair, items[0], badge);
    } else {
      // Multiple credentials — show chooser
      showChooser(items, async (cred) => { await applyCred(pair, cred, badge); });
    }
  }

  async function applyCred(pair, cred, badge) {
    let username = cred.username;
    if (pair.user === null) {
      const cached = sessionStorage.getItem('vg_cached_username');
      if (cached && !username) username = cached;
    }
    await fillPair(pair, username, cred.password);
    badgeSuccessFeedback(badge);
    rememberLastFill(cred, username);
    if (cred.has_totp && cred.id) {
      await fillTotpIfPresent(cred.id);
    }
  }

  // ── TOTP field detector ───────────────────────────────────────────────────
  function findTotpInput(root = document) {
    // Strong signal first: explicit autocomplete=one-time-code
    const ac = root.querySelector('input[autocomplete="one-time-code"]');
    if (ac && isVisible(ac)) return ac;
    // Numeric / pattern + short maxlength, with otp-like hints
    const hint = /code|otp|2fa|token|verif|auth|onetime|one-time/i;
    const candidates = Array.from(root.querySelectorAll('input')).filter(isVisible);
    for (const el of candidates) {
      if (el.type === 'password') continue;
      const t = (el.type || '').toLowerCase();
      if (!['text', 'tel', 'number', ''].includes(t)) continue;
      const ml = parseInt(el.getAttribute('maxlength') || '0', 10);
      const im = (el.getAttribute('inputmode') || '').toLowerCase();
      const pattern = el.getAttribute('pattern') || '';
      const attrs = [el.name, el.id, el.getAttribute('aria-label'), el.placeholder,
                     el.getAttribute('autocomplete')].filter(Boolean).join(' ');
      const isOtpAttr = hint.test(attrs);
      const isShortNumeric =
        (ml > 0 && ml <= 8) || im === 'numeric' || /^\d+\$/.test(pattern) || /[0-9]/.test(pattern);
      if (isOtpAttr && isShortNumeric) return el;
      if (isOtpAttr && ml === 0 && !im) {
        // weaker fallback: otp-labeled field with no length constraint
        return el;
      }
    }
    return null;
  }

  async function fillTotpIfPresent(itemId) {
    const otp = findTotpInput();
    if (!otp) return; // no field visible right now; that's OK
    let resp;
    try {
      resp = await chrome.runtime.sendMessage({ type: 'vg:totp_fetch', item_id: itemId });
    } catch { return; }
    if (!resp?.ok || !resp.totp?.code) return;
    otp.focus();
    setNativeValue(otp, resp.totp.code);
    dispatchInputEvents(otp, resp.totp.code, { skipBlur: false });
    showToast('VaultGuard: 2FA code filled');
  }

  // ── Submit capture for save-new / update-password ─────────────────────────
  let lastFill = null;       // { origin, item_id, username, password, ts }
  let lastSubmitKey = null;  // dedup repeated submissions of the same creds

  function rememberLastFill(cred, username) {
    lastFill = {
      origin: location.origin,
      item_id: cred.id || null,
      username: username || '',
      password: cred.password || '',
      ts: Date.now(),
    };
  }

  function snapshotLogin(form) {
    const pwInputs = collectPasswordInputs(form).filter(isVisible);
    if (pwInputs.length !== 1) return null;          // skip signup / multi-pw
    if (form.querySelector && form.querySelector('input[autocomplete="new-password"]')) return null;
    const pw = pwInputs[0];
    const password = pw.value || '';
    if (!password) return null;

    const allInputs = Array.from(form.querySelectorAll('input:not([disabled])')).filter(isVisible);
    const pwIdx = allInputs.indexOf(pw);
    let userField = form.querySelector(
      'input[autocomplete="username"], input[autocomplete="email"], input[autocomplete="tel"]'
    );
    if (!userField || !isVisible(userField) || userField === pw) {
      for (let i = pwIdx - 1; i >= 0; i--) {
        const t = (allInputs[i].type || '').toLowerCase();
        if (['text', 'email', 'tel', ''].includes(t)) { userField = allInputs[i]; break; }
      }
    }
    const username = (userField?.value?.trim()) || sessionStorage.getItem('vg_cached_username') || '';
    if (!username) return null;
    return { username, password };
  }

  async function offerSaveOrUpdate(snap) {
    const origin = location.origin;
    const key = origin + '|' + snap.username + '|' + snap.password;
    if (key === lastSubmitKey) return;
    lastSubmitKey = key;

    // If we just filled these exact creds, nothing to save.
    if (lastFill && lastFill.origin === origin &&
        lastFill.username === snap.username && lastFill.password === snap.password) {
      return;
    }

    // Same item, password changed → update.
    if (lastFill && lastFill.origin === origin && lastFill.username === snap.username &&
        lastFill.item_id && lastFill.password !== snap.password) {
      try {
        await chrome.runtime.sendMessage({
          type: 'vg:update_password', item_id: lastFill.item_id, new_password: snap.password,
        });
      } catch {}
      return;
    }

    // Otherwise try to save. The bridge replies 409 with item_id if it already
    // exists — fall back to update flow in that case.
    let r;
    try {
      r = await chrome.runtime.sendMessage({
        type: 'vg:save_new', origin, username: snap.username, password: snap.password,
      });
    } catch { return; }
    if (!r) return;
    if (r.exists && r.item_id) {
      try {
        await chrome.runtime.sendMessage({
          type: 'vg:update_password', item_id: r.item_id, new_password: snap.password,
        });
      } catch {}
    }
  }

  // Capture-phase listener so we see submits even when the page calls
  // stopPropagation. Also handle SPAs that block submit and use Enter/button click.
  document.addEventListener('submit', (e) => {
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    const snap = snapshotLogin(form);
    if (snap) offerSaveOrUpdate(snap);
  }, true);

  // SPA fallback: when password field is connected and user presses Enter inside it,
  // snapshot from the nearest form (or the whole document if formless).
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const t = e.target;
    if (!(t instanceof HTMLInputElement)) return;
    if (t.type !== 'password' && t.getAttribute('autocomplete') !== 'username' &&
        t.type !== 'email' && t.type !== 'text') return;
    const form = t.form || document;
    const snap = snapshotLogin(form);
    if (snap) offerSaveOrUpdate(snap);
  }, true);

  function injectBadge(pair) {
    if (document.getElementById(BADGE_ID)) return;

    const badge = document.createElement('button');
    badge.id = BADGE_ID;
    badge.title = 'VaultGuard fill';
    badge.setAttribute('aria-label', 'VaultGuard fill');
    badge.innerHTML = SHIELD_SVG;

    Object.assign(badge.style, {
      position: 'absolute',
      zIndex: '2147483647',
      width: '26px',
      height: '22px',
      padding: '0',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      border: '1px solid rgba(91,140,255,0.4)',
      background: 'rgba(13,17,23,0.92)',
      color: '#5b8cff',
      borderRadius: '4px',
      cursor: 'pointer',
      boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
      transition: 'transform 120ms ease, background 120ms ease, color 120ms ease, border-color 120ms ease',
    });

    badge.addEventListener('mouseenter', () => {
      badge.style.background = 'rgba(91,140,255,0.18)';
      badge.style.transform = 'scale(1.1)';
    });
    badge.addEventListener('mouseleave', () => {
      badge.style.background = 'rgba(13,17,23,0.92)';
      badge.style.transform = 'scale(1)';
    });

    document.body.appendChild(badge);
    currentBadge = badge;

    // Store WeakRef for mutation observer monitoring
    pwRef = new WeakRef(pair.pw);

    function position() {
      const pwEl = pwRef ? pwRef.deref() : null;
      if (!pwEl || !pwEl.isConnected) { removeBadge(); return; }
      const r = pwEl.getBoundingClientRect();
      badge.style.top  = `${window.scrollY + r.top  + (r.height - 22) / 2}px`;
      badge.style.left = `${window.scrollX + r.right - 30}px`;
    }

    position();
    scrollHandler = () => position();
    resizeHandler = () => position();
    window.addEventListener('scroll', scrollHandler, { passive: true });
    window.addEventListener('resize', resizeHandler, { passive: true });

    badge.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await handleFillRequest(badge);
    });
  }

  // ── Multi-step login: detect username-only pages and cache ─────────────────
  function checkUsernameOnlyPage() {
    const pair = findLoginPair();
    // If there's a visible text/email input but no password → cache on form submit
    if (!pair) {
      const userInput = document.querySelector(
        'input[autocomplete="username"], input[autocomplete="email"], ' +
        'input[type="email"], input[type="text"]'
      );
      if (userInput && isVisible(userInput)) {
        userInput.form && userInput.form.addEventListener('submit', () => {
          sessionStorage.setItem('vg_cached_username', userInput.value || '');
        }, { once: true });
      }
    }
  }

  // ── Main scan + badge lifecycle ───────────────────────────────────────────
  function tick() {
    const pair = findLoginPair();
    if (pair && pair.pw) {
      injectBadge(pair);
    } else {
      removeBadge();
      checkUsernameOnlyPage();
    }
  }

  // ── MutationObserver: watch for DOM changes, manage badge lifecycle ────────
  let tickTimer = null;
  const obs = new MutationObserver(() => {
    // Check if pw reference is still valid
    if (pwRef) {
      const pwEl = pwRef.deref();
      if (!pwEl || !pwEl.isConnected) {
        removeBadge();
      }
    }
    clearTimeout(tickTimer);
    tickTimer = setTimeout(tick, 150);
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });

  // ── Cleanup on page hide/unload ───────────────────────────────────────────
  window.addEventListener('pagehide', removeBadge);
  window.addEventListener('beforeunload', removeBadge);

  // ── Message handler: vg:fill_now (from popup / keyboard shortcut) ─────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'vg:fill_now') {
      const pair = findLoginPair();
      if (!pair || !pair.pw) {
        showToast('ไม่พบช่อง login บนหน้านี้');
        sendResponse({ ok: false, error: 'no login pair found' });
        return;
      }
      // Ensure badge exists for feedback, or use currentBadge
      if (!document.getElementById(BADGE_ID)) injectBadge(pair);
      const badge = document.getElementById(BADGE_ID);
      handleFillRequest(badge).then(() => sendResponse({ ok: true })).catch(e => {
        sendResponse({ ok: false, error: String(e?.message || e) });
      });
      return true; // async
    }
  });

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  tick();

})();
} // end __vgLoaded guard
