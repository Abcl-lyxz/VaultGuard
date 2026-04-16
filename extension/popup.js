const status = document.getElementById("status");
const pairBtn = document.getElementById("pair");
const unpairBtn = document.getElementById("unpair");

async function refresh() {
  const r = await chrome.runtime.sendMessage({ type: "vg:status" });
  if (r?.paired) {
    status.textContent = "Paired with desktop app.";
    status.className = "status ok";
    pairBtn.style.display = "none";
    unpairBtn.style.display = "";
  } else {
    status.textContent = "Not paired.";
    status.className = "status";
    pairBtn.style.display = "";
    unpairBtn.style.display = "none";
  }
}

pairBtn.addEventListener("click", async () => {
  status.textContent = "Approve pairing in the desktop app…";
  status.className = "status";
  const r = await chrome.runtime.sendMessage({ type: "vg:pair" });
  if (r?.ok) {
    status.textContent = "Paired!";
    status.className = "status ok";
    refresh();
  } else {
    status.textContent = `Failed: ${r?.error || "unknown error"}`;
    status.className = "status err";
  }
});

unpairBtn.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "vg:unpair" });
  refresh();
});

refresh();
