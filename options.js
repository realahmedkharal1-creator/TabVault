(function () {
  const { storage } = TV;
  const $ = (id) => document.getElementById(id);

  // Not the 🗑️ emoji, which renders as a pale/blank glyph on some Windows
  // font configurations.
  const TRASH_ICON_SVG =
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<polyline points="3 6 5 6 21 6"></polyline>' +
    '<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>' +
    '<path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>' +
    '<path d="M10 11v6"></path>' +
    '<path d="M14 11v6"></path>' +
    "</svg>";

  let folders = [];
  let items = [];
  let settings = TV.DEFAULT_SETTINGS;

  const themeSel = $("theme");
  const openTargetSel = $("openTarget");
  const defaultFolderSel = $("defaultFolder");
  const folderListEl = $("folderList");
  const newFolderInput = $("newFolderInput");
  const toastEl = $("toast");

  function toast(msg, ms = 2000) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (toastEl.hidden = true), ms);
  }

  function applyTheme(theme) {
    let effective = theme;
    if (theme === "system" || !theme) {
      effective = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    document.documentElement.setAttribute("data-theme", effective);
  }

  async function init() {
    settings = await storage.getSettings();
    folders = await storage.getFolders();
    items = await storage.getItems();

    applyTheme(settings.theme);
    themeSel.value = settings.theme;
    openTargetSel.value = settings.openTarget;

    renderDefaultFolderOptions();
    defaultFolderSel.value = settings.defaultFolder || "";
    renderFolderList();
    $("itemCount").textContent = `${items.length} saved item${items.length === 1 ? "" : "s"} · ${folders.length} folder${folders.length === 1 ? "" : "s"}`;

    bindEvents();
  }

  function renderDefaultFolderOptions() {
    while (defaultFolderSel.options.length > 1) defaultFolderSel.remove(1);
    for (const f of folders) {
      const opt = document.createElement("option");
      opt.value = f.id;
      opt.textContent = f.name;
      defaultFolderSel.appendChild(opt);
    }
  }

  function renderFolderList() {
    folderListEl.innerHTML = "";
    if (!folders.length) {
      const p = document.createElement("p");
      p.className = "folder-empty";
      p.textContent = "No folders yet. Add one below to start organizing your links.";
      folderListEl.appendChild(p);
      return;
    }
    for (const f of folders) {
      const row = document.createElement("div");
      row.className = "folder-row";

      const input = document.createElement("input");
      input.type = "text";
      input.value = f.name;
      input.addEventListener("change", async () => {
        const name = input.value.trim();
        if (!name || name === f.name) {
          input.value = f.name;
          return;
        }
        await storage.renameFolder(f.id, name);
        f.name = name;
        renderDefaultFolderOptions();
        defaultFolderSel.value = settings.defaultFolder || "";
        toast("Folder renamed");
      });
      row.appendChild(input);

      const count = items.filter((it) => it.folder === f.id).length;
      const countSpan = document.createElement("span");
      countSpan.className = "count";
      countSpan.textContent = `${count} item${count === 1 ? "" : "s"}`;
      row.appendChild(countSpan);

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.innerHTML = TRASH_ICON_SVG;
      delBtn.title = "Delete folder (items move to No folder)";
      delBtn.addEventListener("click", async () => {
        if (delBtn.dataset.confirm === "1") {
          folders = await storage.deleteFolder(f.id);
          items = await storage.getItems();
          renderDefaultFolderOptions();
          renderFolderList();
          toast(`Folder "${f.name}" deleted`);
          return;
        }
        delBtn.dataset.confirm = "1";
        delBtn.textContent = "✔";
        delBtn.title = "Click again to confirm";
        setTimeout(() => {
          delBtn.dataset.confirm = "";
          delBtn.innerHTML = TRASH_ICON_SVG;
          delBtn.title = "Delete folder (items move to No folder)";
        }, 2500);
      });
      row.appendChild(delBtn);

      folderListEl.appendChild(row);
    }
  }

  function bindEvents() {
    themeSel.addEventListener("change", async () => {
      settings = await storage.setSettings({ theme: themeSel.value });
      applyTheme(settings.theme);
    });

    openTargetSel.addEventListener("change", async () => {
      settings = await storage.setSettings({ openTarget: openTargetSel.value });
    });

    defaultFolderSel.addEventListener("change", async () => {
      settings = await storage.setSettings({ defaultFolder: defaultFolderSel.value || null });
    });

    $("openShortcuts").addEventListener("click", () => {
      chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
    });

    $("addFolderBtn").addEventListener("click", async () => {
      const name = newFolderInput.value.trim();
      if (!name) return;
      await storage.addFolder(name);
      folders = await storage.getFolders();
      newFolderInput.value = "";
      renderDefaultFolderOptions();
      renderFolderList();
      toast(`Folder "${name}" created`);
    });
    newFolderInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") $("addFolderBtn").click();
    });

    $("exportBtn").addEventListener("click", async () => {
      const data = await storage.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `tabvault-backup-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast("Backup downloaded");
    });

    let pendingImportData = null;
    const importInput = $("importInput");
    const importModeRow = $("importModeRow");

    importInput.addEventListener("change", async () => {
      const file = importInput.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        pendingImportData = JSON.parse(text);
        if (!Array.isArray(pendingImportData.items)) throw new Error("bad format");
        importModeRow.hidden = false;
      } catch {
        toast("That file doesn't look like a TabVault backup");
        pendingImportData = null;
        importInput.value = "";
      }
    });

    $("importConfirmBtn").addEventListener("click", async () => {
      if (!pendingImportData) return;
      const mode = $("importReplace").checked ? "replace" : "merge";
      await storage.importAll(pendingImportData, mode);
      pendingImportData = null;
      importInput.value = "";
      importModeRow.hidden = true;
      folders = await storage.getFolders();
      items = await storage.getItems();
      settings = await storage.getSettings();
      applyTheme(settings.theme);
      themeSel.value = settings.theme;
      openTargetSel.value = settings.openTarget;
      renderDefaultFolderOptions();
      defaultFolderSel.value = settings.defaultFolder || "";
      renderFolderList();
      $("itemCount").textContent = `${items.length} saved item${items.length === 1 ? "" : "s"} · ${folders.length} folder${folders.length === 1 ? "" : "s"}`;
      toast("Backup imported");
    });

    $("importCancelBtn").addEventListener("click", () => {
      pendingImportData = null;
      importInput.value = "";
      importModeRow.hidden = true;
    });

    const clearBtn = $("clearAllBtn");
    clearBtn.addEventListener("click", async () => {
      if (clearBtn.dataset.confirm === "1") {
        await storage.setItems([]);
        await storage.setFolders([]);
        folders = [];
        items = [];
        renderDefaultFolderOptions();
        renderFolderList();
        $("itemCount").textContent = "0 saved items · 0 folders";
        clearBtn.textContent = "Clear all TabVault data";
        clearBtn.dataset.confirm = "";
        toast("All data cleared");
        return;
      }
      clearBtn.dataset.confirm = "1";
      clearBtn.textContent = "Click again to permanently delete everything";
      setTimeout(() => {
        clearBtn.dataset.confirm = "";
        clearBtn.textContent = "Clear all TabVault data";
      }, 3500);
    });
  }

  init();
})();
