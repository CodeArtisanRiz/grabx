// GrabX v2.0.0 — background service worker
// Toggles recording per domain, manages badge state.

// ── Serialized storage access (prevents read-modify-write races) ────────────
let lock = Promise.resolve();
function withLock(fn) {
  lock = lock.then(fn, fn);
  return lock;
}

// ── Icon click: toggle domain ───────────────────────────────────────────────
chrome.action.onClicked.addListener((tab) => {
  if (!tab.url || !tab.url.startsWith("http")) return;

  withLock(async () => {
    try {
      const url = new URL(tab.url);
      const domain = url.hostname;
      const { activeDomains = {} } = await chrome.storage.local.get("activeDomains");

      if (activeDomains[domain]) {
        // Deactivate
        delete activeDomains[domain];
        await chrome.storage.local.set({ activeDomains });
        await chrome.action.setBadgeText({ tabId: tab.id, text: "" });
      } else {
        // Activate — badge will be applied by onUpdated after reload
        activeDomains[domain] = true;
        await chrome.storage.local.set({ activeDomains });
        await chrome.tabs.reload(tab.id).catch(() => {});
      }
    } catch (err) {
      console.error("[GrabX] Action error:", err);
    }
  });
});

// ── Badge state: single source of truth on tab load ─────────────────────────
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  if (!tab.url || !tab.url.startsWith("http")) return;

  try {
    const url = new URL(tab.url);
    const { activeDomains = {} } = await chrome.storage.local.get("activeDomains");
    const domains = activeDomains || {};

    if (domains[url.hostname]) {
      await chrome.action.setBadgeText({ tabId, text: "REC" });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: "#10b981" });
    } else {
      await chrome.action.setBadgeText({ tabId, text: "" });
    }
  } catch (err) {
    console.warn("[GrabX] Badge update:", err);
  }
});

// ── Message handler: content script can request state ───────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "grabx:getState" && sender.tab) {
    const domain = new URL(sender.tab.url).hostname;
    chrome.storage.local.get("activeDomains", ({ activeDomains = {} }) => {
      sendResponse({ active: !!(activeDomains || {})[domain] });
    });
    return true; // async sendResponse
  }
});
