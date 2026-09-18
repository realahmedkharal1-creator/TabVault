importScripts("storage.js");

const MENU_SAVE_LINK = "tv-save-link";
const MENU_SAVE_PAGE = "tv-save-page";
const MENU_SAVE_SELECTION = "tv-save-selection";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_SAVE_PAGE,
    title: "Save this page to TabVault",
    contexts: ["page"],
  });
  chrome.contextMenus.create({
    id: MENU_SAVE_LINK,
    title: "Save this link to TabVault",
    contexts: ["link"],
  });
  chrome.contextMenus.create({
    id: MENU_SAVE_SELECTION,
    title: 'Save "%s" as a note in TabVault',
    contexts: ["selection"],
  });
  refreshBadge();
});

chrome.runtime.onStartup?.addListener(refreshBadge);

async function refreshBadge() {
  try {
    const items = await TV.storage.getItems();
    const count = items.length;
    await chrome.action.setBadgeBackgroundColor({ color: "#6d5bd0" });
    await chrome.action.setBadgeText({ text: count > 0 ? String(count > 999 ? "999+" : count) : "" });
  } catch {
    // storage not ready yet — ignore
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[TV.KEYS.ITEMS]) refreshBadge();
});

function notify(title, message) {
  chrome.notifications?.create({
    type: "basic",
    iconUrl: "icons/icon128.png",
    title,
    message,
  });
}

async function saveTabObject(tab, { close = false, note = "" } = {}) {
  if (!tab || !tab.url || /^chrome(-extension)?:\/\//.test(tab.url)) {
    notify("TabVault", "This page can't be saved (browser-internal page).");
    return null;
  }
  const settings = await TV.storage.getSettings();
  const item = await TV.storage.addItem({
    url: tab.url,
    title: tab.title || TV.hostFromUrl(tab.url) || tab.url,
    note,
    favicon: TV.faviconFor(tab.url),
    folder: settings.defaultFolder || null,
  });
  if (close && tab.id != null) {
    try {
      await chrome.tabs.remove(tab.id);
    } catch {
      /* tab may already be closed */
    }
  }
  return item;
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === MENU_SAVE_LINK && info.linkUrl) {
    await TV.storage.addItem({
      url: info.linkUrl,
      title: info.linkUrl,
      note: "",
      favicon: TV.faviconFor(info.linkUrl),
    });
    notify("Saved to TabVault", info.linkUrl);
  } else if (info.menuItemId === MENU_SAVE_PAGE && tab) {
    const item = await saveTabObject(tab);
    if (item) notify("Saved to TabVault", item.title);
  } else if (info.menuItemId === MENU_SAVE_SELECTION && tab) {
    await TV.storage.addItem({
      url: tab.url,
      title: tab.title || tab.url,
      note: info.selectionText || "",
      favicon: TV.faviconFor(tab.url),
    });
    notify("Saved to TabVault", "Note attached to " + (tab.title || tab.url));
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  if (command === "save-current-tab") {
    const item = await saveTabObject(tab, { close: false });
    if (item) notify("Saved to TabVault", item.title);
  } else if (command === "save-current-tab-and-close") {
    const item = await saveTabObject(tab, { close: true });
    if (item) notify("Saved & closed", item.title);
  }
});

// Messages from the popup. Tab create/remove calls can shift window focus,
// which closes the popup (and kills its JS) mid-flight — so anything that
// touches tabs.remove runs here in the persistent service worker instead.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "SAVE_CURRENT_TAB" || msg?.type === "SAVE_CURRENT_TAB_CLOSE") {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const item = await saveTabObject(tab, { close: msg.type === "SAVE_CURRENT_TAB_CLOSE" });
      sendResponse({ ok: !!item, item });
    })();
    return true;
  }
  if (msg?.type === "SAVE_TABS_BULK") {
    (async () => {
      const settings = await TV.storage.getSettings();
      const partials = msg.tabs
        .filter((t) => t.url && !/^chrome(-extension)?:\/\//.test(t.url))
        .map((t) => ({
          url: t.url,
          title: t.title || TV.hostFromUrl(t.url) || t.url,
          note: "",
          favicon: TV.faviconFor(t.url),
          folder: msg.folder || settings.defaultFolder || null,
        }));
      const created = await TV.storage.addItems(partials);
      if (msg.closeAfter) {
        const ids = msg.tabs.filter((t) => t.id != null).map((t) => t.id);
        if (ids.length) {
          try {
            await chrome.tabs.remove(ids);
          } catch {
            /* ignore */
          }
        }
      }
      sendResponse({ ok: true, created: created.length });
    })();
    return true; // keep the message channel open for the async response
  }
  return false;
});
