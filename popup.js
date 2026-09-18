(function () {
  const { storage } = TV;

  // Inline SVG (not the 🗑️ emoji, which renders as a pale/blank glyph on
  // some Windows font configurations) so the delete icon always looks crisp
  // and picks up the button's currentColor for hover/theme states.
  const TRASH_ICON_SVG =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<polyline points="3 6 5 6 21 6"></polyline>' +
    '<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>' +
    '<path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>' +
    '<path d="M10 11v6"></path>' +
    '<path d="M14 11v6"></path>' +
    "</svg>";

  const STAR_ICON_SVG =
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="{{fill}}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<polygon points="12 2 15 8.5 22 9.5 17 14.5 18.5 21.5 12 18 5.5 21.5 7 14.5 2 9.5 9 8.5 12 2"></polygon>' +
    "</svg>";

  function starIcon(filled) {
    return STAR_ICON_SVG.replace("{{fill}}", filled ? "currentColor" : "none");
  }

  const PLAY_ICON_SVG =
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg>';

  function isVideoUrl(url) {
    const host = TV.hostFromUrl(url);
    return host === "youtu.be" || /(^|\.)youtube\.com$/.test(host) || /(^|\.)vimeo\.com$/.test(host);
  }

  // ---- state ----
  let items = [];
  let folders = [];
  let settings = TV.DEFAULT_SETTINGS;
  let viewMode = "all"; // 'all' | 'pinned' — driven by the segmented control
  let folderId = ""; // '' (all folders) | folder id — driven by the folder select
  let searchQuery = "";
  let sortBy = "recent";
  let editingItemId = null;
  const pendingDeletes = new Map(); // itemId -> timeoutId

  // ---- DOM refs ----
  const $ = (id) => document.getElementById(id);
  const listEl = $("list");
  const emptyState = $("emptyState");
  const countLabel = $("countLabel");
  const searchInput = $("search");
  const filterFolderSel = $("filterFolder");
  const sortBySel = $("sortBy");

  const heroCount = $("heroCount");
  const heroTodayBadge = $("heroTodayBadge");
  const heroSparkline = $("heroSparkline");
  const heroStorage = $("heroStorage");

  const modalOverlay = $("modalOverlay");
  const modalIcon = $("modalIcon");
  const modalTitle = $("modalTitle");
  const modalSubtitle = $("modalSubtitle");
  const fUrl = $("fUrl");
  const fTitle = $("fTitle");
  const fNote = $("fNote");
  const fTags = $("fTags");
  const fFolder = $("fFolder");
  const btnDelete = $("btnDelete");
  const btnSave = $("btnSave");
  const btnCancel = $("btnCancel");
  const modalClose = $("modalClose");
  const newFolderRow = $("newFolderRow");
  const newFolderTrigger = $("newFolderTrigger");
  const newFolderName = $("newFolderName");

  const bulkOverlay = $("bulkOverlay");
  const bulkList = $("bulkList");
  const bulkFolder = $("bulkFolder");
  const bulkAllWindows = $("bulkAllWindows");
  const bulkCloseAfter = $("bulkCloseAfter");

  const toastEl = $("toast");

  // ---- init ----
  async function init() {
    settings = await storage.getSettings();
    applyTheme(settings.theme);
    folders = await storage.getFolders();
    items = await storage.getItems();
    refreshFolderSelects();
    render();
    renderHeroStats();
    bindEvents();
  }

  function applyTheme(theme) {
    let effective = theme;
    if (theme === "system" || !theme) {
      effective = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    document.documentElement.setAttribute("data-theme", effective);
  }

  function startOfDay(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function renderHeroStats() {
    const todayStart = startOfDay(Date.now());
    const dayMs = 86400000;
    const weekStart = todayStart - 6 * dayMs;

    let todayCount = 0;
    let weekCount = 0;
    const dayBuckets = new Array(7).fill(0); // oldest -> newest, index 6 = today

    for (const it of items) {
      const created = it.createdAt || 0;
      if (created >= weekStart) {
        const dayIdx = Math.floor((startOfDay(created) - weekStart) / dayMs);
        if (dayIdx >= 0 && dayIdx < 7) dayBuckets[dayIdx]++;
        weekCount++;
      }
      if (created >= todayStart) todayCount++;
    }

    heroCount.textContent = `${weekCount} saved`;
    heroTodayBadge.textContent = `+${todayCount} today`;

    const max = Math.max(1, ...dayBuckets);
    heroSparkline.innerHTML = "";
    const frag = document.createDocumentFragment();
    dayBuckets.forEach((count, idx) => {
      const bar = document.createElement("div");
      bar.className = "bar" + (idx === 6 ? " today" : "");
      const pct = Math.max(14, Math.round((count / max) * 100));
      bar.style.height = pct + "%";
      frag.appendChild(bar);
    });
    heroSparkline.appendChild(frag);

    if (chrome.storage.local.getBytesInUse) {
      chrome.storage.local.getBytesInUse(null, (bytes) => {
        const kb = Math.round(bytes / 1024);
        const quota = chrome.storage.local.QUOTA_BYTES || 5 * 1024 * 1024;
        const quotaMb = Math.round(quota / (1024 * 1024));
        const used = kb < 1024 ? `${kb} KB` : `${(kb / 1024).toFixed(1)} MB`;
        heroStorage.textContent = `${used} of ${quotaMb} MB used`;
      });
    }
  }

  function toast(msg, ms = 1800) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (toastEl.hidden = true), ms);
  }

  // ---- folder selects ----
  function refreshFolderSelects() {
    fillFolderOptions(filterFolderSel, { fixedCount: 1 });
    fillFolderOptions(fFolder, { fixedCount: 1 });
    fillFolderOptions(bulkFolder, { fixedCount: 1 });
    filterFolderSel.value = folderId;
  }

  function fillFolderOptions(selectEl, { fixedCount }) {
    while (selectEl.options.length > fixedCount) selectEl.remove(fixedCount);
    for (const f of folders) {
      const opt = document.createElement("option");
      opt.value = f.id;
      opt.textContent = f.name;
      selectEl.appendChild(opt);
    }
  }

  // ---- rendering ----
  function render() {
    const q = searchQuery.trim().toLowerCase();
    let filtered = items.filter((it) => {
      if (viewMode === "pinned" && !it.pinned) return false;
      if (folderId && it.folder !== folderId) return false;
      if (q) {
        const hay = [it.title, it.note, it.url, ...(it.tags || [])].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    filtered.sort((a, b) => {
      if (viewMode !== "pinned") {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
      }
      switch (sortBy) {
        case "title":
          return (a.title || "").localeCompare(b.title || "");
        case "site":
          return TV.hostFromUrl(a.url).localeCompare(TV.hostFromUrl(b.url));
        case "oldest":
          return a.createdAt - b.createdAt;
        case "recent":
        default:
          return (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt);
      }
    });

    listEl.innerHTML = "";
    if (!filtered.length) {
      emptyState.hidden = false;
      const titleEl = emptyState.querySelector(".empty-title");
      const subEl = emptyState.querySelector(".empty-sub");
      if (items.length === 0) {
        titleEl.textContent = "Nothing saved yet";
        subEl.innerHTML =
          "Click <strong>Save current tab</strong>, or right-click any link and choose <strong>Save this link to TabVault</strong>.";
      } else {
        titleEl.textContent = "No matches";
        subEl.textContent = "Try a different search or filter.";
      }
    } else {
      emptyState.hidden = true;
      const frag = document.createDocumentFragment();
      for (const it of filtered) frag.appendChild(buildItemNode(it));
      listEl.appendChild(frag);
    }

    countLabel.textContent = `${items.length} item${items.length === 1 ? "" : "s"}`;
  }

  function buildItemNode(item) {
    const el = document.createElement("div");
    el.className = "item" + (item.pinned ? " pinned" : "");
    el.dataset.id = item.id;

    const faviconWrap = document.createElement("div");
    faviconWrap.className = "item-favicon-wrap";
    if (isVideoUrl(item.url)) {
      faviconWrap.classList.add("video");
      faviconWrap.innerHTML = PLAY_ICON_SVG;
    } else {
      const favicon = document.createElement("img");
      favicon.className = "item-favicon";
      favicon.src = item.favicon || TV.faviconFor(item.url);
      favicon.alt = "";
      favicon.loading = "lazy";
      favicon.addEventListener("error", () => (favicon.style.visibility = "hidden"));
      faviconWrap.appendChild(favicon);
    }
    el.appendChild(faviconWrap);

    const main = document.createElement("div");
    main.className = "item-main";

    const titleRow = document.createElement("div");
    titleRow.className = "item-title-row";
    const a = document.createElement("a");
    a.className = "item-title";
    a.href = item.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = item.title || item.url;
    titleRow.appendChild(a);
    if (item.pinned) {
      const pin = document.createElement("span");
      pin.className = "item-pin";
      pin.innerHTML = starIcon(true);
      titleRow.appendChild(pin);
    }
    main.appendChild(titleRow);

    const meta = document.createElement("div");
    meta.className = "item-meta";
    const folderName = item.folder ? folders.find((f) => f.id === item.folder)?.name : null;
    meta.textContent = [TV.hostFromUrl(item.url), TV.timeAgo(item.updatedAt || item.createdAt), folderName]
      .filter(Boolean)
      .join(" • ");
    main.appendChild(meta);

    if (item.note) {
      const note = document.createElement("div");
      note.className = "item-note";
      note.textContent = item.note;
      main.appendChild(note);
    }

    if (item.tags && item.tags.length) {
      const tagsWrap = document.createElement("div");
      tagsWrap.className = "item-tags";
      for (const tag of item.tags) {
        const chip = document.createElement("span");
        chip.className = "tag-chip";
        chip.textContent = "#" + tag;
        chip.dataset.tag = tag;
        tagsWrap.appendChild(chip);
      }
      main.appendChild(tagsWrap);
    }

    el.appendChild(main);

    const actions = document.createElement("div");
    actions.className = "item-actions";

    const pinBtn = document.createElement("button");
    pinBtn.dataset.action = "pin";
    pinBtn.title = item.pinned ? "Unpin" : "Pin to top";
    pinBtn.innerHTML = starIcon(item.pinned);
    if (item.pinned) pinBtn.classList.add("active");
    actions.appendChild(pinBtn);

    const editBtn = document.createElement("button");
    editBtn.dataset.action = "edit";
    editBtn.title = "Edit";
    editBtn.textContent = "✎";
    actions.appendChild(editBtn);

    const delBtn = document.createElement("button");
    delBtn.dataset.action = "delete";
    delBtn.title = "Delete (click twice to confirm)";
    delBtn.innerHTML = TRASH_ICON_SVG;
    actions.appendChild(delBtn);

    el.appendChild(actions);
    return el;
  }

  // ---- item actions ----
  // storage.onChanged and an explicit post-action reload can both fire for
  // the same write, so overlapping reloadItems() calls are routine. Guard
  // against them resolving out of order (which would briefly render a
  // stale, shorter list) by only applying the result of the most recent call.
  let reloadToken = 0;
  async function reloadItems() {
    const token = ++reloadToken;
    const latest = await storage.getItems();
    if (token !== reloadToken) return; // a newer reload finished first — discard this one
    items = latest;
    render();
    renderHeroStats();
  }

  // A newly saved/edited item can silently fail to match whatever search or
  // filter is currently active (e.g. leftover search text from a moment
  // ago), which reads as "the item I just added disappeared". Reset to the
  // unfiltered view whenever we know an item just changed so it's always
  // immediately visible.
  function resetFiltersToShowAll() {
    searchQuery = "";
    searchInput.value = "";
    viewMode = "all";
    folderId = "";
    document.querySelectorAll(".seg-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.view === "all");
      b.setAttribute("aria-selected", String(b.dataset.view === "all"));
    });
    filterFolderSel.value = "";
  }

  async function togglePin(id) {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    await storage.updateItem(id, { pinned: !item.pinned });
    await reloadItems();
  }

  function handleDeleteClick(id, btn) {
    if (pendingDeletes.has(id)) {
      clearTimeout(pendingDeletes.get(id));
      pendingDeletes.delete(id);
      doDelete(id);
      return;
    }
    btn.textContent = "✔";
    btn.title = "Click again to confirm delete";
    btn.classList.add("active");
    const t = setTimeout(() => {
      pendingDeletes.delete(id);
      render();
    }, 2500);
    pendingDeletes.set(id, t);
  }

  async function doDelete(id) {
    await storage.deleteItem(id);
    await reloadItems();
    toast("Deleted");
  }

  async function openItem(id) {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    if (settings.openTarget === "new-tab") {
      await chrome.tabs.create({ url: item.url });
    } else {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) await chrome.tabs.update(tab.id, { url: item.url });
      else await chrome.tabs.create({ url: item.url });
    }
    window.close();
  }

  // ---- add/edit modal ----
  function showOverlay(el) {
    el.hidden = false;
  }
  function hideOverlay(el) {
    el.hidden = true;
  }

  function openAddModal(prefill = {}) {
    editingItemId = null;
    modalTitle.textContent = "Add link";
    modalIcon.hidden = false;
    modalSubtitle.hidden = false;
    btnDelete.hidden = true;
    fUrl.value = prefill.url || "";
    fTitle.value = prefill.title || "";
    fNote.value = "";
    fTags.value = "";
    fFolder.value = settings.defaultFolder || "";
    resetNewFolderRow();
    showOverlay(modalOverlay);
    (prefill.url ? fTitle : fUrl).focus();
  }

  function openEditModal(id) {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    editingItemId = id;
    modalTitle.textContent = "Edit link";
    modalIcon.hidden = true;
    modalSubtitle.hidden = true;
    btnDelete.hidden = false;
    btnDelete.textContent = "Delete";
    fUrl.value = item.url;
    fTitle.value = item.title || "";
    fNote.value = item.note || "";
    fTags.value = (item.tags || []).join(", ");
    fFolder.value = item.folder || "";
    resetNewFolderRow();
    showOverlay(modalOverlay);
    fTitle.focus();
  }

  function closeModal() {
    hideOverlay(modalOverlay);
    editingItemId = null;
  }

  function resetNewFolderRow() {
    newFolderRow.hidden = true;
    newFolderTrigger.hidden = false;
    newFolderName.value = "";
  }

  function normalizeUrl(raw) {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      return new URL(trimmed).toString();
    } catch {
      try {
        return new URL("https://" + trimmed).toString();
      } catch {
        return null;
      }
    }
  }

  async function submitModal() {
    const normalized = normalizeUrl(fUrl.value);
    if (!normalized) {
      toast("Please enter a valid URL");
      fUrl.focus();
      return;
    }
    const title = fTitle.value.trim() || TV.hostFromUrl(normalized) || normalized;
    const note = fNote.value.trim();
    const tags = fTags.value
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const folder = fFolder.value || null;

    if (editingItemId) {
      await storage.updateItem(editingItemId, { url: normalized, title, note, tags, folder });
      toast("Updated");
    } else {
      await storage.addItem({ url: normalized, title, note, tags, folder, favicon: TV.faviconFor(normalized) });
      toast("Saved");
    }
    resetFiltersToShowAll();
    await reloadItems();
    closeModal();
  }

  // ---- bulk save modal ----
  async function openBulkModal() {
    fillFolderOptions(bulkFolder, { fixedCount: 1 });
    bulkFolder.value = settings.defaultFolder || "";
    bulkAllWindows.checked = false;
    await loadBulkTabs();
    showOverlay(bulkOverlay);
  }

  async function loadBulkTabs() {
    const queryOpts = bulkAllWindows.checked ? {} : { currentWindow: true };
    const tabs = await chrome.tabs.query(queryOpts);
    bulkList.innerHTML = "";
    const frag = document.createDocumentFragment();
    for (const tab of tabs) {
      const unsavable = !tab.url || /^chrome(-extension)?:\/\//.test(tab.url);
      const row = document.createElement("label");
      row.className = "bulk-row";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !unsavable;
      cb.disabled = unsavable;
      cb.dataset.tabId = String(tab.id);
      cb.dataset.url = tab.url || "";
      cb.dataset.title = tab.title || tab.url || "";
      row.appendChild(cb);

      const img = document.createElement("img");
      img.src = tab.favIconUrl || (tab.url ? TV.faviconFor(tab.url) : "");
      img.alt = "";
      row.appendChild(img);

      const span = document.createElement("span");
      span.textContent = unsavable ? `${tab.title || tab.url || "Untitled"} (can't be saved)` : tab.title || tab.url;
      row.appendChild(span);

      frag.appendChild(row);
    }
    bulkList.appendChild(frag);
  }

  async function submitBulkSave() {
    const checked = Array.from(bulkList.querySelectorAll("input[type=checkbox]:checked"));
    if (!checked.length) {
      toast("Select at least one tab");
      return;
    }
    const tabs = checked.map((cb) => ({
      id: Number(cb.dataset.tabId),
      url: cb.dataset.url,
      title: cb.dataset.title,
    }));
    const folder = bulkFolder.value || null;
    const closeAfter = bulkCloseAfter.checked;
    const bulkSaveBtn = $("bulkSave");
    bulkSaveBtn.disabled = true;
    bulkSaveBtn.textContent = "Saving…";
    chrome.runtime.sendMessage({ type: "SAVE_TABS_BULK", tabs, folder, closeAfter }, async (resp) => {
      bulkSaveBtn.disabled = false;
      bulkSaveBtn.textContent = "Save selected";
      if (chrome.runtime.lastError || !resp?.ok) {
        toast("Something went wrong saving those tabs");
        return;
      }
      toast(`Saved ${resp.created} tab${resp.created === 1 ? "" : "s"}${closeAfter ? " and closed them" : ""}`);
      resetFiltersToShowAll();
      await reloadItems();
      hideOverlay(bulkOverlay);
    });
  }

  // ---- events ----
  function bindEvents() {
    searchInput.addEventListener("input", () => {
      searchQuery = searchInput.value;
      render();
    });

    filterFolderSel.addEventListener("change", () => {
      folderId = filterFolderSel.value;
      render();
    });

    document.querySelectorAll(".seg-btn").forEach((segBtn) => {
      segBtn.addEventListener("click", () => {
        viewMode = segBtn.dataset.view;
        document.querySelectorAll(".seg-btn").forEach((b) => {
          b.classList.toggle("active", b === segBtn);
          b.setAttribute("aria-selected", String(b === segBtn));
        });
        render();
      });
    });

    sortBySel.addEventListener("change", () => {
      sortBy = sortBySel.value;
      render();
    });

    $("btnTheme").addEventListener("click", async () => {
      const current = document.documentElement.getAttribute("data-theme");
      const next = current === "dark" ? "light" : "dark";
      settings = await storage.setSettings({ theme: next });
      applyTheme(next);
    });

    $("btnSettings").addEventListener("click", () => chrome.runtime.openOptionsPage());

    $("btnSaveCurrent").addEventListener("click", async () => {
      chrome.runtime.sendMessage({ type: "SAVE_CURRENT_TAB" }, async (resp) => {
        if (resp?.ok) {
          toast(`Saved "${resp.item.title}"`);
          resetFiltersToShowAll();
          await reloadItems();
        } else {
          toast("Couldn't save this page");
        }
      });
    });

    $("btnSaveCurrentClose").addEventListener("click", async () => {
      chrome.runtime.sendMessage({ type: "SAVE_CURRENT_TAB_CLOSE" }, async (resp) => {
        if (resp?.ok) {
          toast(`Saved & closed "${resp.item.title}"`);
          resetFiltersToShowAll();
          await reloadItems();
        } else {
          toast("Couldn't save this page");
        }
      });
    });

    $("btnAddManual").addEventListener("click", async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      openAddModal(tab && !/^chrome(-extension)?:\/\//.test(tab.url || "") ? { url: tab.url, title: tab.title } : {});
    });

    $("btnBulkSave").addEventListener("click", openBulkModal);

    // add/edit modal
    modalClose.addEventListener("click", closeModal);
    btnCancel.addEventListener("click", closeModal);
    btnSave.addEventListener("click", submitModal);
    modalOverlay.addEventListener("click", (e) => {
      if (e.target === modalOverlay) closeModal();
    });
    fUrl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitModal();
    });

    btnDelete.addEventListener("click", () => {
      if (!editingItemId) return;
      if (btnDelete.dataset.confirm === "1") {
        doDelete(editingItemId);
        closeModal();
        return;
      }
      btnDelete.dataset.confirm = "1";
      btnDelete.textContent = "Confirm delete?";
      setTimeout(() => {
        btnDelete.dataset.confirm = "";
        if (!btnDelete.hidden) btnDelete.textContent = "Delete";
      }, 2500);
    });

    newFolderTrigger.addEventListener("click", () => {
      newFolderRow.hidden = false;
      newFolderTrigger.hidden = true;
      newFolderName.focus();
    });
    $("newFolderCancel").addEventListener("click", resetNewFolderRow);
    $("newFolderConfirm").addEventListener("click", async () => {
      const name = newFolderName.value.trim();
      if (!name) return;
      const folder = await storage.addFolder(name);
      folders = await storage.getFolders();
      refreshFolderSelects();
      fFolder.value = folder.id;
      resetNewFolderRow();
      toast(`Folder "${folder.name}" created`);
    });
    newFolderName.addEventListener("keydown", (e) => {
      if (e.key === "Enter") $("newFolderConfirm").click();
    });

    // bulk modal
    $("bulkClose").addEventListener("click", () => hideOverlay(bulkOverlay));
    $("bulkCancel").addEventListener("click", () => hideOverlay(bulkOverlay));
    bulkOverlay.addEventListener("click", (e) => {
      if (e.target === bulkOverlay) hideOverlay(bulkOverlay);
    });
    bulkAllWindows.addEventListener("change", loadBulkTabs);
    $("bulkSelectAll").addEventListener("click", () => {
      bulkList.querySelectorAll("input[type=checkbox]:not(:disabled)").forEach((cb) => (cb.checked = true));
    });
    $("bulkSelectNone").addEventListener("click", () => {
      bulkList.querySelectorAll("input[type=checkbox]").forEach((cb) => (cb.checked = false));
    });
    $("bulkSave").addEventListener("click", submitBulkSave);

    // list delegation
    listEl.addEventListener("click", (e) => {
      const actionBtn = e.target.closest("button[data-action]");
      const itemEl = e.target.closest(".item");
      if (!itemEl) return;
      const id = itemEl.dataset.id;

      if (actionBtn) {
        e.preventDefault();
        e.stopPropagation();
        const action = actionBtn.dataset.action;
        if (action === "pin") togglePin(id);
        else if (action === "edit") openEditModal(id);
        else if (action === "delete") handleDeleteClick(id, actionBtn);
        return;
      }

      const chip = e.target.closest(".tag-chip");
      if (chip) {
        e.preventDefault();
        searchInput.value = chip.dataset.tag;
        searchQuery = chip.dataset.tag;
        render();
        return;
      }

      const anchor = e.target.closest("a.item-title");
      if (anchor && (e.metaKey || e.ctrlKey || e.shiftKey)) return; // let native new-tab/window behavior happen

      e.preventDefault();
      openItem(id);
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (!modalOverlay.hidden) closeModal();
        if (!bulkOverlay.hidden) hideOverlay(bulkOverlay);
      }
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes[TV.KEYS.ITEMS]) reloadItems();
      if (changes[TV.KEYS.FOLDERS]) {
        storage.getFolders().then((f) => {
          folders = f;
          refreshFolderSelects();
          render();
        });
      }
    });
  }

  init();
})();
