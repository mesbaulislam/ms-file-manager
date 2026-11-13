# MS File Manager

A real file manager for KaiOS feature phones — not a UI mockup. Version 1.1.0.

MS File Manager lists and manipulates actual files through the KaiOS Device Storage API on a small keypad phone, with honest fallbacks wherever the platform does not allow something.

> **Platform:** KaiOS 2.5.x (240×320 keypad phones, e.g. Energizer E241S)
> **Developer:** MS Apps by FS — Mesbaul Islam ([@mesbaulislam](https://github.com/mesbaulislam))

> **On-device status — please read:** v1.1.0 was built from findings of testing on the Energizer E241S, including fixes for file opening. However, the final build has **not** been confirmed working on the phone — the last on-device report said it still did not work after a manifest correction, and the cause was never identified. Treat this as a code release, not a device-verified one. The automated tests below all pass in Node; they do not replace a test on the real phone.

## Features

- **Browse Internal Storage / SD Card** — real `enumerate()` data with virtual folders; the `sdcard1/` volume prefix is hidden for display, so Internal Storage looks like the built-in manager (DCIM/, Download/, …)
- **Home dashboard** — storage cards, categories, and quick actions (SD-card stats only; see Limitations)
- **Sort** — by name / size / date / type
- **Recent Files** — most-recently-modified, bounded scan
- **Categories** — Images / Videos / Music / Documents / Downloads / Archives, by extension and path filters over real scans
- **Open file** — via the system handler (`MozActivity` "open"); text files open in a built-in viewer; ZIP files open in the archive view
- **Rename file / folder** — emulated safely as copy + verify + delete (KaiOS has no native rename); folder rename is a batch prefix rewrite (≤ 300 files) with progress
- **Copy / Move file / folder** — with overwrite confirmation, self-copy guard, descendant guard, conflict scan, and verify-before-delete
- **New folder** — create-on-write (KaiOS has no mkdir): app Menu → New folder shows a pending row; the folder materializes when the first file is copied, moved, or extracted into it. Also available in the Copy/Move/Extract destination picker
- **Delete (file / folder)** — with confirmation (toggleable) and progress
- **Properties** — real metadata; image thumbnail when readable
- **Destination picker** — per-store roots, folder drill-down, Cancel / Select
- **Search** — this folder or all storage; bounded, case-insensitive, cancellable
- **ZIP list / extract** — pure-JS DEFLATE, no dependencies; stored + deflated entries, path-traversal rejected, per-file 64 MB cap, max 500 listed entries. **ZIP creation is not implemented.**
- **Settings** — sort order, default storage, delete confirmation, Show Hidden Files toggle (see Limitations), persisted in `localStorage`
- **Keypad-only navigation** — D-pad / OK / Back / softkeys; no touch or mouse needed. Softkeys: Left "Menu" (app menu), Center "Open", Right "Option" (file/folder actions)

## Key map

| Key | Action |
| --- | --- |
| Up/Down | Move focus |
| Left/Right | Tiles: move sideways · Dialogs: switch button · Settings: change value |
| OK (Enter) | Open / activate |
| Back | Up one level / previous screen (at Home: exits the app) |
| Left softkey | "Menu" — app menu (Sort, New folder, Recent, Search, Settings, Exit) · Menus/dialogs: Select/Cancel |
| Right softkey | "Option" — actions for the focused file/folder · "Back"/"Select" where context demands |

## Technologies used

- **Vanilla HTML, CSS, and ES5 JavaScript** — no framework, no build step
- **KaiOS 2.5, privileged app type** — `manifest.webapp` with `device-storage:music`, `device-storage:pictures`, `device-storage:sdcard`, `device-storage:videos` (read/write)
- **DeviceStorage API** — `enumerate()`, `get()`, `addNamed()`, `delete()`, `freeSpace()` / `usedSpace()` (all storage access in `js/filesystem.js`)
- **MozActivity** — "open" and "share" for handing files to other apps
- **Pure-JS DEFLATE** — ZIP listing and extraction in `js/archive.js` (no dependencies)
- **localStorage** — settings persistence
- **Node.js** — automated tests under `tests/`

## Project structure

```text
ms-file-manager/
├── manifest.webapp            # KaiOS manifest (v1.1.0, privileged, storage permissions)
├── index.html                 # App shell, SVG icon sprite, screen containers
├── README.md
├── css/
│   └── style.css              # Dark navy + electric blue, 240x320 layout
├── js/
│   ├── app.js                 # Screens, keypad navigation, search, settings
│   ├── filesystem.js          # DeviceStorage adapter (verified APIs only)
│   ├── operations.js          # Safe copy / move / rename / delete with verify-before-delete
│   └── archive.js             # ZIP listing + extraction (pure-JS DEFLATE)
├── icons/
│   └── icon-128.png           # App icon (glossy yellow folder on blue)
└── tests/
    ├── archive-test.js        # Node tests for ZIP list/extract (28 checks)
    ├── functional-test.js     # Full app driven through its keydown router (41 checks)
    ├── fake.js                # Stub DeviceStorage + stub DOM for tests
    ├── driver.js              # Test driver helpers
    ├── make-fixtures.py       # Generates ZIP fixtures for archive-test.js
    └── shots.html             # Layout test page
```

## Installation and setup

```bash
git clone https://github.com/mesbaulislam/ms-file-manager.git
cd ms-file-manager
```

1. ZIP the project root (the folder that contains `manifest.webapp` and `index.html` — the manifest must be at the ZIP root).
2. Install with WebIDE (https://developer.kaiostech.com) over USB, or sideload the ZIP with your usual method. Energizer phones are debug-enabled, so WebIDE sideloading a `privileged` app works.
3. On first launch the app requests Device Storage access — allow it. (The default grant is a prompt, so expect a permission dialog on first run.)

## Usage

1. Open **MS File Manager** — the Home dashboard shows storage and categories.
2. Choose **Internal Storage** or **SD Card** to browse folders with the D-pad; press OK to open a file or enter a folder.
3. Press the right softkey (**Option**) on a file or folder for Rename, Copy, Move, Delete, Properties, Share, and more.
4. Press the left softkey (**Menu**) for Sort, New folder, Recent, Search, Settings, and Exit.
5. Open a `.zip` file to list its contents and extract files with the destination picker.

## Tests

```bash
node tests/archive-test.js      # ZIP list + byte-exact extract, traversal rejection, unicode names
node tests/functional-test.js   # full app through its real keydown router with stub storage
```

Both suites pass (verified: archive tests 28/28, functional tests 41/41). `node --check` passes on all four app JS files and the code is ES5-only. The tests run in Node with stubbed DeviceStorage — they verify the logic, not the real phone (see the on-device status note above). Layout at 240×320 was not pixel-rendered; the CSS is hand-built to the 240×320 grid.

## Screenshots

No screenshots are bundled in this repository.

## Honest limitations

1. **No full-filesystem access.** KaiOS grants apps named storages only (`pictures`, `videos`, `music`, `sdcard`). "Internal Storage" is the aggregate of `pictures` + `videos` + `music`; there is no `/` root to browse, and arbitrary paths like `/sdcard/DCIM/…` are unsupported.
2. **No native rename / mkdir.** Both are emulated safely (never delete before verify), but a rename is two storage operations, not one; folders materialize only on write.
3. **No hidden files.** `enumerate()` never yields dot-prefixed entries on KaiOS 2.5, so the Show Hidden Files setting cannot reveal anything the platform hides. The setting is kept but documented as non-functional on this platform.
4. **No ZIP creation.** Listing and extraction only. Also no zip64, no multi-disk, no encrypted entries, no archives with more than 500 listed entries, no single file over 64 MB.
5. **No storage statistics guarantee.** Used/total numbers appear only when `freeSpace()` / `usedSpace()` actually respond. On the E241S the `pictures`-area stats are wrong (verified against Settings), so the UI shows SD-card stats only and hides internal numbers.
6. **Large files are risky.** Copy/move loads whole Blobs; files over 50 MB show a warning first. No streaming.
7. **SD Card** appears only when the store actually enumerates.

## Capability audit (KaiOS 2.5.3.2, Energizer E241S)

| Capability | Status |
|---|---|
| `navigator.getDeviceStorage(name)` | Supported and verified (same API family as MS Gallery on this phone) |
| `enumerate()` file listing | Supported; `.name` may carry a leading `/` and a volume prefix like `sdcard1/`; folders are virtual path prefixes |
| `get(name)` read file | Supported; requires the verbatim `enumerate()` name (leading `/` and volume prefix included) — v1.0.0 stripped the slash and every read failed on-device; v1.1.0 preserves it |
| `addNamed(blob, name)` write file | Supported; overwrites silently if the name exists — the app always checks first and asks before replacing |
| `delete(name)` | Supported |
| `freeSpace()` / `usedSpace()` | Device-tested: unreliable for the `pictures` area on the E241S; correct for the `sdcard` area |
| `MozActivity` "open" / "share" | Supported as documented |
| Arbitrary filesystem paths | Unsupported |
| Native rename / mkdir | Unsupported (emulated) |
| Hidden (dot-prefixed) files via `enumerate()` | Restricted by platform |
| ZIP reading | Supported (pure JS) |
| ZIP creation | Not implemented |
| Streaming large files | Unsupported |

## Developer

**MS Apps by FS** — Mesbaul Islam ([@mesbaulislam](https://github.com/mesbaulislam))

© 2026 MS File Manager
