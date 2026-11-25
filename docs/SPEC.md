# Swipah: Build Brief (v1 / MVP)

> **Wicked fast sorting.**
> Swipe through a folder one file at a time. Each direction sends the file to a tag/folder. When you finish, you get a recap reel.

This brief has everything needed to build the first version. It comes from a planning session (research, decisions, requirements). **In the first PR, commit this file as `docs/SPEC.md`** so the decisions live in the repo.

---

## 1. Context

- **Owner:** yeomanscholar. Agentic work runs through the collaborator account `metis-repo-bot`, which opens PRs to `yeomanscholar/swipah`. The owner merges from the main account.
- **Repo:** `yeomanscholar/swipah` (MIT license, currently empty apart from LICENSE).
- **Product:** a free app, with a donation link (Ko-fi; URL to come, use a placeholder).
- **Domain:** `swipah.app` is planned but not bought. Launch at `https://yeomanscholar.github.io/swipah/`. The app must work under a sub-path (relative URLs everywhere).
- **First real user:** the owner, sorting memes on an **Android phone** (Chrome). Desktop Chrome/Edge comes second.

### Roadmap (build only Phase 1 now, but keep the architecture ready for the rest)
1. **Phase 1, MVP (this build):** a web app/PWA for phones first, on GitHub Pages. Touch swipe, mouse drag, arrow keys.
2. **Phase 2 (about a month later, if people use it):** Android app via Trusted Web Activity / Capacitor wrapper for the Play Store. iOS only if people ask for it, since it needs a native Photos-library storage layer.
3. **Phase 3 (about a month after that):** AI features. Export your tag log + images to Claude/Gemini so it learns your tagging. Later: AI-suggested tags and **AI-suggested filenames** based on the image, any text in it, and your past renames and tags.

---

## 2. Research findings that shape the design

**Competitors:** many iOS "Tinder for photos" apps exist: Furiwake (5-way swipe to custom folders, closest match), Culla, SwipeSort, ImageSwiper, Slidebox. Keyboard-only desktop sorters exist too: PhotoSift, Sift, Image Sort, Picsort. Browser sorters exist (PhotoSo, Sortino) but only do accept/reject or click-to-move.

**Swipah's gap (nobody combines these):**
1. Works on **any local folder, in a browser**, on Android + desktop, with swipe, drag and keys.
2. **Multiple tags per item** (multi-tag mode, explicit dismiss).
3. **Any file type**: images, GIFs, video, audio (songs) in one tool.
4. **Recap reel** at the end.
5. **Rename-as-you-go** to make files searchable.
6. **AI-ready tag log** (Phase 3 groundwork).

**Platform constraints (important):**
- **File System Access API** (`showDirectoryPicker`) works in Chrome/Edge desktop and, per recent compatibility data, **Chrome for Android**. **Firefox and Safari/iOS do not support it.**
- **Android Chrome does not keep folder permission between visits** (open Chromium/Google issue). The user picks the folder again each session. Resume must handle this (match by relative path + size).
- **Android folder picker limits:** Android blocks picking some roots (storage root, the `Download` root itself on Android 11+). Tell users to pick a subfolder like `Pictures/Memes`.
- **The folder feature needs a secure context.** It must be served over HTTPS (GitHub Pages), not opened as a local HTML file.
- **Google Photos cannot be used.** Since March 31, 2025, the Google Photos Library API only manages media the app itself uploaded. No third-party app can reorganize existing albums. Swipah works on the **device folders** (memes saved to `Pictures/`, `Download/…`, `DCIM/`). Google Photos backs those folders up and shows them.
- **Never hard-delete.** "Trash" = move to `_trash/` inside the chosen folder. Deleting through the file system wouldn't remove the Google Photos cloud copy anyway, and a recoverable trash is safer.
- File moves: use `FileSystemFileHandle.move()` where it exists. **Fall back to copy + `removeEntry`** when it doesn't. Detect support at runtime.

---

## 3. Decisions already made

| Topic | Decision |
|---|---|
| Name | **Swipah** (Boston-accent "swiper"). Repo/package name `swipah`. |
| License | MIT (already in repo) |
| Tagline (landing) | "Wicked fast sorting." |
| Milestone toast | After N swipes (e.g. 50): **"My boy got mad organized."** Add a few more original Boston-flavored lines at later milestones (e.g. 10, 100, 250, 500) so long sessions stay fun. Write original lines; don't quote song lyrics. |
| Example filenames in UI/docs | Kendrick-flavored, e.g. `not-like-us.jpg`. **No Drake references.** |
| Default directions | ← Left = `_trash` · → Right / ↑ Up / ↓ Down = user-named tags (prefill suggestions like `funny`, `reaction`, `wholesome`) |
| Default dismiss mode | **Single swipe** (tag → move → next). Multi-tag mode is a setting. |
| Analytics | **None.** No trackers, no cookies, no network calls with user data. |
| Donations | Ko-fi link on the recap screen + about/footer (placeholder URL in one config constant). |
| Privacy pitch | "Your files never leave your device." Must be literally true. |

---

## 4. MVP requirements

### 4.1 Landing / start
- Logo/wordmark "Swipah", tagline, one-line explainer, **Pick a folder** button.
- If the browser lacks `showDirectoryPicker`: friendly message (supported browsers: Chrome/Edge on desktop & Android) plus a **Try the demo** button (see 4.15).
- Hint on Android: "Pick a subfolder like Pictures/Memes. Android won't let apps open the top of Downloads."
- Option to **include subfolders** (default off). Always skip Swipah's own tag folders, `_trash/` and `.swipah/` when scanning.

### 4.2 Direction / tag setup
- Directions: **Left, Right, Up, Down.** Each gets a tag name (or "unused"). A **tap** on the card (or Space) = **Skip**.
- Tag name = destination folder name (sanitized: lowercase, spaces → hyphens, strip characters unsafe on Android/Windows).
- Color per direction (auto-assigned, editable optional).
- Save as **presets** in localStorage (e.g. "Memes", "Music"). Last used preset loads automatically.
- Settings on this screen: dismiss mode, rename box on/off, include subfolders, file types to include, sort order (name / date modified / random).

### 4.3 The card view (one item at a time)
- Large centered card showing the current file. A progress indicator (`37 / 412`) and the 4 direction labels at the screen edges, colored.
- **Images:** jpg, jpeg, png, webp, gif (animated), avif, bmp, svg. HEIC: Chrome can't render it, so show a placeholder card with the filename but still allow sorting.
- **Video:** mp4, webm, mov (where playable). Autoplay muted, loop, tap-to-unmute control.
- **Audio:** mp3, m4a, aac, ogg, opus, wav, flac. Show a player card (filename, duration, play/pause, scrubber). **Autoplay when the card appears** (after the first user gesture). Stop when the card leaves.
- **Other files:** generic card (icon, name, size, type). Sortable.
- Preload the next 2 items for snappy transitions. Revoke object URLs to avoid memory leaks (phones will run out on large folders otherwise).

### 4.4 Input
- **Touch & mouse:** Pointer Events drag. The card follows the finger/cursor with a slight tilt. The target edge label lights up as you approach the threshold (≈25% of viewport or a quick flick by speed). Release past the threshold = commit to that direction; otherwise snap back.
- **Keyboard:** ← → ↑ ↓ = directions; Space = skip; Z or Ctrl/Cmd+Z = undo; Enter = dismiss/commit (multi-tag mode); `/` or R = focus the rename box; Esc = blur the rename box.
- **On-screen buttons** for each direction + skip + undo (accessibility, and for people who don't like gestures).
- Don't let the page scroll or pull-to-refresh during a drag (`touch-action: none` on the card area; `overscroll-behavior: none`).
- Respect `prefers-reduced-motion`.

### 4.5 Dismiss modes
- **Single swipe (default):** swipe → file goes to that tag → next card.
- **Multi-tag:** swipes **toggle** tags on the current card (show tag chips on the card). The card stays. **Double-tap, Enter, or a "Done" button** commits and moves to the next card. Commit behavior: the file is **moved** into the first-applied tag's folder and **copied** into each additional tag's folder. If `_trash` is among the tags, trash wins (no copies). Zero tags + Done = skip.

### 4.6 Skip
- Skipped files stay where they are. They're logged as `skipped` and can be revisited at the end ("Review 12 skipped?").

### 4.7 Undo
- Multi-level undo stack for the session. Each entry stores the exact file operations performed (move/copy/rename) so they can be reversed: move back, delete copies, restore the original name. The undone card returns to the front. Log the undo as an event (don't delete history).

### 4.8 Rename box (optional, toggle in settings)
- A text field under the card. If filled when the card is committed, the file is saved under that name. **Keep the original extension.** Sanitize: trim, spaces → hyphens, strip unsafe characters, max length ~80.
- **Autocomplete** from names used before (stored locally), so recurring meme formats get consistent names.
- While the field is focused: **swipe/arrow keys are disabled** and the card shrinks so the phone keyboard doesn't cover it. Enter commits the name (in single-swipe mode Enter just confirms the text; the swipe still decides the tag).
- The log records `original_name → new_name` (this is valuable Phase 3 training data).

### 4.9 Name collisions
- If the destination already has that name: append `-1`, `-2`, … before the extension (`not-like-us.jpg` → `not-like-us-1.jpg`). Never overwrite.

### 4.10 Resume
- Save session state in **IndexedDB**: preset, queue order, cursor position, per-file decisions, undo stack, folder name.
- **Desktop:** also store the `FileSystemDirectoryHandle` in IndexedDB and re-request permission on return ("Resume sorting *Memes*? 37/412 done").
- **Android:** the handle may not survive, so prompt to re-pick the same folder, then reconcile by relative path + size and continue where it left off.

### 4.11 Recap reel (end of queue, or "Finish now" at any time)
- Headline stats: items sorted, time taken, swipes/minute, renames, skipped, trashed.
- **Gallery grouped by tag** (a horizontal reel/strip per tag with thumbnails; audio shows as a tile with the name). Tap a thumbnail to view it full size.
- Actions: "Review skipped", "Undo last", "Sort another folder", **Export for AI** (4.13), **Download log**, **Support Swipah ☕** (Ko-fi).

### 4.12 Tag log (AI-ready, written from day one)
- Stored at `<chosen folder>/.swipah/log.jsonl` (append-only, one JSON object per line) **and** mirrored in IndexedDB. Downloadable from the recap.
- One `session_start` record per session: `{type, session_id, app_version, started_at, folder_name, preset: {directions → tags}, dismiss_mode}`.
- One record per action:
```json
{
  "type": "action",
  "session_id": "…",
  "ts": "2026-11-25T14:03:22.123Z",
  "action": "tag | skip | undo",
  "file": {
    "original_path": "Screenshot_20260301.png",
    "final_paths": ["reaction/not-like-us.png"],
    "size": 183422,
    "mime": "image/png",
    "last_modified": "2026-03-01T18:22:10Z",
    "fingerprint": "sha256:…"
  },
  "tags": ["reaction", "funny"],
  "directions": ["up", "right"],
  "renamed_from": "Screenshot_20260301.png",
  "renamed_to": "not-like-us.png",
  "dwell_ms": 1840
}
```
- **Fingerprint:** SHA-256 via `crypto.subtle` of the file bytes. For files > 8 MB, hash the first 4 MB + last 4 MB + size (prefix `sha256p:`), to keep phones fast. This lets the same image be recognized after renames/moves.
- Log schema version field (`"schema": 1`) on every record.

### 4.13 Export for AI
- Button on the recap and in settings. Writes a folder `<chosen folder>/.swipah/export-YYYYMMDD-HHMM/` containing:
  - `log.jsonl`: the actions for the chosen scope (this session / all sessions).
  - `contact-sheet-01.jpg`, `-02`, …: canvas-rendered grids (e.g. 5×6) of **numbered** thumbnails. Each tile is labeled with its number, the final tags and the name. Video = poster frame; audio = text tile.
  - `index.json`: maps sheet + tile number → log entry/fingerprint.
  - `PROMPT.md`: a ready-to-paste prompt explaining the format, e.g. "These contact sheets show files I sorted with Swipah. Each number maps to a log entry with my tags and renames. Learn my tagging and naming style, summarize the rules you infer, and tell me how you'd tag/name new items."
- Also offer the same bundle as individual downloads if writing to the folder fails.
- **Nothing is uploaded.** The user carries the files to an AI chat themselves.

### 4.14 Milestone toasts & personality
- Small celebratory toasts at swipe milestones (see Decisions). Include **"My boy got mad organized."**
- Copy tone: friendly, light Boston flavor, never in the way. A setting to turn toasts off.

### 4.15 Demo mode (for unsupported browsers & sharing)
- In-memory adapter with ~15 bundled sample files: **original generated placeholder images** (simple SVG/PNG art, colorful shapes with captions; no copyrighted memes), plus one short generated audio tone. The full flow works, including the recap and export (export downloads the files instead of writing them to a folder).
- Lets Firefox/iOS visitors try the app and lets the owner demo it.

### 4.16 PWA
- `manifest.webmanifest` (name, short_name "Swipah", icons 192/512 + maskable, `display: standalone`, theme color, `start_url` and `scope` relative for the GitHub Pages sub-path).
- Service worker: cache the app shell for offline use; version-bumped cache name; never cache user files.
- Installable from Chrome on Android ("Add to Home screen").

### 4.17 Android capability test page
- `test.html` (linked from the About section): pick a folder → run each step and show ✅/❌ with the error text:
  1. list entries, 2. read a file, 3. create subfolder `_swipah_test/`, 4. `move()` a temp file into it, 5. copy + remove fallback, 6. rename, 7. write `.swipah/test.jsonl`, 8. clean up.
- Also report: user agent, `showDirectoryPicker` presence, `FileSystemFileHandle.prototype.move` presence, storage persistence.
- Purpose: the owner checks this on their phone **first**. If moves fail on Android, the app switches to "tag-only" mode: files stay in place, and tags/renames go to the log, with an export.

---

## 5. Architecture

- **Vanilla HTML/CSS/JS, ES modules, no build step, no runtime dependencies.** Deployable by GitHub Pages straight from the repo. (Dev-only tooling like Playwright is fine in `package.json`.)
- **Storage adapter interface.** The UI never touches files directly. Every file operation goes through one adapter so Phase 2/3 can swap in Capacitor/Android or iOS Photos:
  ```
  listItems({recursive, types}) → [{id, path, name, size, mime, lastModified}]
  getBlob(id) / getObjectURL(id)
  ensureFolder(name)
  move(id, folder, newName?) → newPath
  copy(id, folder, newName?) → newPath
  rename(id, newName) → newPath
  exists(folder, name) → bool
  appendLog(line) / writeFile(path, blob)
  capabilities → {move, copy, rename, writeLog, persistentHandle}
  ```
  Implementations: `FsAccessAdapter` (Chrome/Edge/Android) and `MemoryAdapter` (demo + tests).
- Other modules: `gestures.js` (pointer/keyboard → direction events), `session.js` (queue, decisions, undo stack, IndexedDB persistence), `log.js` (schema, fingerprinting), `recap.js`, `export.js` (contact sheets), `settings.js` (presets), `toasts.js`, `ui/*`.
- Suggested layout:
  ```
  index.html
  test.html
  manifest.webmanifest
  sw.js
  css/app.css
  js/main.js, js/adapters/{fs-access,memory}.js, js/*.js
  assets/icons/*, assets/demo/*
  docs/SPEC.md   (this file)
  tests/         (Playwright, run against MemoryAdapter/demo mode)
  README.md
  ```
- Small, readable files. Comment the non-obvious bits (Android quirks, move() fallback).

---

## 6. Quality bar & testing

- **Playwright** end-to-end tests in demo mode (use the pre-installed Playwright; run with `--trace off`):
  swipe each direction (mouse drag + keys), single vs multi-tag commit, skip, undo restores the file and the card, rename + collision suffix, resume after reload, recap counts, export bundle contents, milestone toast at N.
- Unit-ish tests for filename sanitizing, collision naming, log record shape.
- Manual checklist in the PR for the owner: Android Chrome via `test.html`, then a real 20-meme session; desktop Chrome drag + keys.
- Mobile layout first (360×740 baseline); also check 1280×800 desktop. Large touch targets. Works one-handed.
- Performance: smooth at 60fps dragging on a mid-range phone; a 2,000-file folder must not freeze (list lazily, thumbnails only when needed).

---

## 7. Deliverables for the first PR

1. The working app (all of section 4).
2. `docs/SPEC.md` (this brief).
3. `README.md`: what it is, tagline, live link (GitHub Pages URL), supported browsers, privacy statement, how to run locally (`npx serve` or `python3 -m http.server`), Android tips (pick a subfolder; re-pick each visit), roadmap, Ko-fi placeholder, MIT.
4. Pages setup notes: serve from `main` / root (or a GitHub Actions Pages workflow). Tell the owner which setting to flip.
5. Draft PR from a `claude/…` branch, pushed by `metis-repo-bot`, with screenshots (phone + desktop) and the manual test checklist.

## 8. Out of scope for v1
- Google Photos integration (blocked by the API, see §2).
- Native Android/iOS apps (Phase 2).
- Any AI calls or uploads (Phase 3, export only for now).
- Writing tags into EXIF/ID3 metadata (later; folders + log cover v1).
- Accounts, sync, analytics.

## 9. Open items for the owner
- Ko-fi URL.
- Buy `swipah.app` (CNAME can be added later).
- Confirm milestone toast lines once drafted.
