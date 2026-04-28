const status   = document.getElementById('status');
const pairBtn  = document.getElementById('pair');
const unpairBtn = document.getElementById('unpair');
const fillBtn  = document.getElementById('fill-btn');
const subtitle = document.getElementById('site-subtitle');

// ── Show current tab origin as subtitle ───────────────────────────────────────
(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) {
      try {
        subtitle.textContent = new URL(tab.url).hostname;
      } catch {
        subtitle.textContent = '';
      }
    }
  } catch {
    subtitle.textContent = '';
  }
})();

// ── Refresh paired state ──────────────────────────────────────────────────────
async function refresh() {
  const r = await chrome.runtime.sendMessage({ type: 'vg:status' });
  if (r?.paired) {
    status.textContent = 'Paired with desktop app.';
    status.className = 'status ok';
    pairBtn.style.display = 'none';
    unpairBtn.style.display = '';
    fillBtn.disabled = false;
  } else {
    status.textContent = 'Not paired.';
    status.className = 'status';
    pairBtn.style.display = '';
    unpairBtn.style.display = 'none';
    fillBtn.disabled = true;
  }
}

// ── Pair ──────────────────────────────────────────────────────────────────────
pairBtn.addEventListener('click', async () => {
  status.textContent = 'Approve pairing in the desktop app…';
  status.className = 'status';
  const r = await chrome.runtime.sendMessage({ type: 'vg:pair' });
  if (r?.ok) {
    status.textContent = 'Paired!';
    status.className = 'status ok';
    refresh();
  } else {
    status.textContent = `Failed: ${r?.error || 'unknown error'}`;
    status.className = 'status err';
  }
});

// ── Unpair ────────────────────────────────────────────────────────────────────
unpairBtn.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'vg:unpair' });
  refresh();
});

// ── Fill credentials ──────────────────────────────────────────────────────────
fillBtn.addEventListener('click', async () => {
  if (fillBtn.disabled) return;
  fillBtn.classList.add('filling');
  fillBtn.textContent = 'Filling…';
  fillBtn.disabled = true;

  try {
    await chrome.runtime.sendMessage({ type: 'vg:fill_now' });
  } catch {
    // content script may not be injected on this page — ignore
  }

  // Brief "Filling…" state, then reset
  setTimeout(() => {
    fillBtn.classList.remove('filling');
    fillBtn.disabled = false;
    fillBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14"
        viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="8" cy="15" r="4"/>
        <path d="M12 15h8"/>
        <path d="M16 11v8"/>
        <path d="M20 8V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v3"/>
      </svg>
      Fill credentials`;
  }, 1200);
});

refresh();
