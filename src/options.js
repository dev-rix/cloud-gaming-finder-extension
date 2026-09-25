const button = document.querySelector("#refresh");
const status = document.querySelector("#status");

button.addEventListener("click", async () => {
  button.disabled = true;
  status.textContent = "Refreshing…";
  const result = await chrome.runtime.sendMessage({ type: "getCatalog", force: true });
  status.textContent = result?.ok ? `Loaded ${result.games.length} games.` : `Failed: ${result?.error || "unknown error"}`;
  button.disabled = false;
});
