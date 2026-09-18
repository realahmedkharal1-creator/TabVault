# TabVault — Lite Link & Tab Saver

A Chrome extension for saving links, tabs and whole browsing sessions with a name and a note — built to be fast and light on low-end PCs and small screens (no frameworks, no build step, tiny footprint).

## Features

- **Save the current tab** in one click, with an editable name and note.
- **Add any link manually** — paste a URL, give it a name, a note, and tags.
- **Save & close** — save a tab and immediately close it to free up RAM. Ideal for low-memory machines where keeping 30 tabs open isn't an option.
- **Save all open tabs at once** (a whole "session"), optionally across all windows, with one checkbox to close them all afterward — hibernate your tabs, restore them later.
- **Right-click context menu**: save any link, the current page, or a text selection as a note, from anywhere.
- **Folders** to organize saved items, plus **tags** and full-text search across titles, notes, tags and URLs.
- **Pin** important items to the top.
- Keyboard shortcuts (customizable at `chrome://extensions/shortcuts`):
  - `Ctrl+Shift+S` — save current tab
  - `Ctrl+Shift+X` — save current tab and close it
- **Light / dark / system theme**, compact popup UI tuned for small screens.
- **Backup & restore**: export everything to a `.json` file, import it back (merge or replace).
- Everything is stored locally (`chrome.storage.local`) — no accounts, no network requests, no tracking.

## Install (load unpacked)

1. Open `chrome://extensions` in Chrome (or any Chromium browser — Edge, Brave, etc.).
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select this `tabvault-extension` folder.
4. Pin the TabVault icon to the toolbar for one-click access.

## Project layout

```
manifest.json     Manifest V3 config, permissions, commands, context menus
background.js     Service worker: context menus, keyboard shortcuts, bulk save/close
storage.js        Shared data layer (chrome.storage.local) + small utilities
popup.html/.css/.js   Main popup UI — save, search, filter, edit, pin, delete
options.html/.css/.js Settings page — theme, folders, default behavior, backup/restore
icons/            Generated PNG icons (see scripts/generate-icons.js)
```

No build tools, no dependencies, no bundler — every file is plain HTML/CSS/JS so it stays cheap to run on low-end hardware.
