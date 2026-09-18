// Shared storage + utility layer, usable from the popup, options page and the
// background service worker (loaded there via importScripts).
// Exposes everything under the global `TV` namespace — no bundler needed.
(function (global) {
  const KEYS = { ITEMS: "tv_items", FOLDERS: "tv_folders", SETTINGS: "tv_settings" };

  const DEFAULT_SETTINGS = {
    theme: "system", // system | light | dark
    openTarget: "current", // current | new-tab
    defaultFolder: null,
  };

  function uuid() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function hostFromUrl(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  }

  function faviconFor(url, size = 32) {
    try {
      const u = new URL(chrome.runtime.getURL("/_favicon/"));
      u.searchParams.set("pageUrl", url);
      u.searchParams.set("size", String(size));
      return u.toString();
    } catch {
      return "";
    }
  }

  function get(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  }
  function set(obj) {
    return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
  }

  // Every mutation below is a non-atomic "read the whole array, modify it,
  // write the whole array back" — chrome.storage has no compare-and-swap.
  // Two mutations firing close together in the same JS context (e.g. a
  // double-clicked save button, or a bulk-save racing a quick-save) can
  // otherwise interleave their read/write and silently drop one of them.
  // Routing every mutation through this single queue forces them to run
  // one at a time, closing that window.
  let writeQueue = Promise.resolve();
  function serialized(fn) {
    return (...args) => {
      const run = writeQueue.then(() => fn(...args));
      writeQueue = run.then(
        () => {},
        () => {}
      );
      return run;
    };
  }

  async function getItems() {
    const res = await get([KEYS.ITEMS]);
    return Array.isArray(res[KEYS.ITEMS]) ? res[KEYS.ITEMS] : [];
  }

  async function setItems(items) {
    await set({ [KEYS.ITEMS]: items });
    return items;
  }

  async function addItem(partial) {
    const items = await getItems();
    const now = Date.now();
    const item = {
      id: uuid(),
      url: "",
      title: "",
      note: "",
      tags: [],
      folder: null,
      pinned: false,
      createdAt: now,
      updatedAt: now,
      ...partial,
    };
    items.unshift(item);
    await setItems(items);
    return item;
  }

  async function addItems(partials) {
    const items = await getItems();
    const now = Date.now();
    const created = partials.map((partial) => ({
      id: uuid(),
      url: "",
      title: "",
      note: "",
      tags: [],
      folder: null,
      pinned: false,
      createdAt: now,
      updatedAt: now,
      ...partial,
    }));
    await setItems([...created, ...items]);
    return created;
  }

  async function updateItem(id, patch) {
    const items = await getItems();
    const idx = items.findIndex((it) => it.id === id);
    if (idx === -1) return null;
    items[idx] = { ...items[idx], ...patch, updatedAt: Date.now() };
    await setItems(items);
    return items[idx];
  }

  async function deleteItem(id) {
    const items = await getItems();
    const next = items.filter((it) => it.id !== id);
    await setItems(next);
    return next;
  }

  async function deleteItems(ids) {
    const idSet = new Set(ids);
    const items = await getItems();
    const next = items.filter((it) => !idSet.has(it.id));
    await setItems(next);
    return next;
  }

  async function getFolders() {
    const res = await get([KEYS.FOLDERS]);
    return Array.isArray(res[KEYS.FOLDERS]) ? res[KEYS.FOLDERS] : [];
  }

  async function setFolders(folders) {
    await set({ [KEYS.FOLDERS]: folders });
    return folders;
  }

  async function addFolder(name) {
    const folders = await getFolders();
    const folder = { id: uuid(), name: name.trim(), createdAt: Date.now() };
    folders.push(folder);
    await setFolders(folders);
    return folder;
  }

  async function renameFolder(id, name) {
    const folders = await getFolders();
    const idx = folders.findIndex((f) => f.id === id);
    if (idx === -1) return null;
    folders[idx] = { ...folders[idx], name: name.trim() };
    await setFolders(folders);
    return folders[idx];
  }

  async function deleteFolder(id) {
    const folders = (await getFolders()).filter((f) => f.id !== id);
    await setFolders(folders);
    // Un-assign items that were in this folder rather than deleting them.
    const items = await getItems();
    const next = items.map((it) => (it.folder === id ? { ...it, folder: null } : it));
    await setItems(next);
    return folders;
  }

  async function getSettings() {
    const res = await get([KEYS.SETTINGS]);
    return { ...DEFAULT_SETTINGS, ...(res[KEYS.SETTINGS] || {}) };
  }

  async function setSettings(patch) {
    const current = await getSettings();
    const next = { ...current, ...patch };
    await set({ [KEYS.SETTINGS]: next });
    return next;
  }

  async function exportAll() {
    const [items, folders, settings] = await Promise.all([getItems(), getFolders(), getSettings()]);
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      items,
      folders,
      settings,
    };
  }

  async function importAll(data, mode = "merge") {
    if (!data || !Array.isArray(data.items)) throw new Error("Invalid backup file");
    if (mode === "replace") {
      await setItems(data.items);
      await setFolders(Array.isArray(data.folders) ? data.folders : []);
    } else {
      const existingItems = await getItems();
      const existingIds = new Set(existingItems.map((it) => it.id));
      const merged = [...existingItems];
      for (const it of data.items) {
        if (!existingIds.has(it.id)) merged.push(it);
      }
      await setItems(merged);

      const existingFolders = await getFolders();
      const existingFolderIds = new Set(existingFolders.map((f) => f.id));
      const mergedFolders = [...existingFolders];
      for (const f of data.folders || []) {
        if (!existingFolderIds.has(f.id)) mergedFolders.push(f);
      }
      await setFolders(mergedFolders);
    }
    if (data.settings) await setSettings(data.settings);
    return true;
  }

  function timeAgo(ts) {
    const diff = Math.max(0, Date.now() - ts);
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    return `${Math.floor(months / 12)}y ago`;
  }

  global.TV = {
    KEYS,
    DEFAULT_SETTINGS,
    uuid,
    hostFromUrl,
    faviconFor,
    timeAgo,
    storage: {
      getItems,
      setItems: serialized(setItems),
      addItem: serialized(addItem),
      addItems: serialized(addItems),
      updateItem: serialized(updateItem),
      deleteItem: serialized(deleteItem),
      deleteItems: serialized(deleteItems),
      getFolders,
      setFolders: serialized(setFolders),
      addFolder: serialized(addFolder),
      renameFolder: serialized(renameFolder),
      deleteFolder: serialized(deleteFolder),
      getSettings,
      setSettings: serialized(setSettings),
      exportAll,
      importAll: serialized(importAll),
    },
  };
})(typeof self !== "undefined" ? self : window);
