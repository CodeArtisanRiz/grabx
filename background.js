// GrabX — background service worker
// Handles icon click: toggles recording state per domain, reloads tab.

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.url || !tab.url.startsWith("http")) return;

  try {
    const url = new URL(tab.url);
    const domain = url.hostname;
    const { activeDomains = {} } = await chrome.storage.local.get("activeDomains");

    if (activeDomains[domain]) {
      // Second click — deactivate, clear badge
      delete activeDomains[domain];
      await chrome.storage.local.set({ activeDomains });
      chrome.action.setBadgeText({ tabId: tab.id, text: "" });
    } else {
      // First click — activate, show REC badge, reload to capture frame-0
      activeDomains[domain] = true;
      await chrome.storage.local.set({ activeDomains });
      await chrome.action.setBadgeText({ tabId: tab.id, text: "REC" });
      await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#10b981" });
      chrome.tabs.reload(tab.id);
    }
  } catch (err) {
    console.error("[GrabX] Action error:", err);
  }
});

// Clear badge on tab navigation away (new URL on same tab)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) return;
  try {
    const url = new URL(tab.url);
    // Re-apply badge if domain is still active (post-reload)
    chrome.storage.local.get("activeDomains", ({ activeDomains = {} }) => {
      if (activeDomains[url.hostname]) {
        chrome.action.setBadgeText({ tabId, text: "REC" });
        chrome.action.setBadgeBackgroundColor({ tabId, color: "#10b981" });
      } else {
        chrome.action.setBadgeText({ tabId, text: "" });
      }
    });
  } catch (_) {}
});
