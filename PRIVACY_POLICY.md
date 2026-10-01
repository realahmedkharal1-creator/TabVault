# TabVault Privacy Policy

**Last updated: October 1, 2026**

TabVault is a browser extension that lets you save links, tabs, and browsing
sessions with a name, a note, tags, and a folder.

## The short version

**TabVault collects, transmits, and sells nothing.** There are no servers,
no analytics, and no third parties involved. Everything you save stays on
your own device, inside your browser's local storage, for as long as you
keep it there.

## What TabVault stores, and where

When you save a link, tab, or session, TabVault stores the following
**locally in your browser** (via the standard `chrome.storage.local` API):

- The URL, page title, and favicon of the page you chose to save
- Any name, note, tags, or folder you typed in yourself
- Your extension settings (theme, default folder, how links open)

This data:

- **Never leaves your device.** TabVault makes no network requests to any
  server operated by us or anyone else.
- **Is never sold, shared, or transmitted** to any third party.
- **Is not used for advertising, tracking, or analytics** of any kind.
- Can be deleted at any time from the extension's Settings page
  ("Clear all TabVault data"), or by uninstalling the extension.

## Permissions TabVault requests, and why

| Permission | Why it's needed |
|---|---|
| `storage` | Saves your links, notes, tags, and folders locally in your browser. |
| `tabs` | Reads the URL/title of the tab(s) you choose to save, and closes tabs you choose to save-and-close. |
| `contextMenus` | Adds the right-click menu items ("Save this link/page to TabVault"). |
| `notifications` | Shows a brief local confirmation after a save completes. |
| `favicon` | Fetches each saved page's icon from your browser's own local favicon cache, to display it in your list. |

None of these permissions are used to collect, read, or transmit data beyond
what's described above.

## Changes to this policy

If this policy ever changes, the updated version will be posted at this
same URL with a new "Last updated" date.

## Contact

Questions about this policy or the extension can be opened as an issue on
the project's GitHub repository:
https://github.com/realahmedkharal1-creator/TabVault/issues
