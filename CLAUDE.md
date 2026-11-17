# CLAUDE.md

**Fuse for the web**: the Android app `fuse/` (`com.fuse`, 0.38.2) as a web application, at the user's word
("I want this multiplatform", then "web application", 2026-11-17). TypeScript + Vite, no framework, no runtime
dependencies. No server: tasks live in the browser's `localStorage`, and since 0.3.0 sync with the Android app
through `fuse.json` in the user's private GitHub repo (`docs/SYNC.md`). Not Playo. Added 2026-11-17, 0.3.0.

`fuse/` keeps shipping APKs and is untouched. **A fix in one is not in the other**: `src/tasks.ts` is a line-for-line
port of `fuse/app/src/main/java/com/fuse/Tasks.kt`, and `test/tasks.test.ts` of `TasksTest.kt`, test for test.

## Build and test

```powershell
npm install; npm test; npm run build    # dist/ is the whole site, static files only
npm run dev                             # localhost
```

## Hosting

- Site: https://catcreature.github.io/fuse-web/ (GitHub Pages, served from the `gh-pages` branch of the public repo
  `catcreature/fuse-web`; `main` holds the source). Not from Actions: the gh token has no `workflow` scope.
- Deploy with `npm run deploy`: tests, builds, then `scripts/deploy.mjs` force-pushes `dist/` (plus `.nojekyll`) as
  a one-commit `gh-pages`. Pushing `main` does not deploy.
- Every release must bump `CACHE` in `public/sw.js`, or installed copies keep the old page.
- Sync data: `fuse.json` in the private repo `catcreature/fuse-data` (created empty; the apps write it on first sync).

## How it works

- `src/time.ts`: wall-clock maths in a named zone via `Intl` (stands in for `java.time`). Days are epoch days.
  `epoch()` takes two passes so a clock change lands right (tested against New York's 2026-11-01).
- `src/tasks.ts`: the model and every pure function of `Tasks.kt`, same names. Kotlin's `Pair` is a tuple,
  `Random` is a `() => number`, ARGB colours are unsigned numbers (`css()` turns one into CSS).
- `src/store.ts`: `Store.kt` over a `Box` (localStorage, or a Map in tests). **The saved JSON is the sync file,
  format 2** (`src/sync/merge.ts`'s `SyncFile`, a superset of the Android fuse.json / backup shape), so a backup made
  by either app restores in the other; older saves and backups load through `readFile`. Unreadable data is set aside (`fuse-unreadable-<ms>.json` key), never overwritten. `save()` throws when the
  browser refuses the write; `main.ts` shows that in a banner.
- `src/main.ts`: the page. `refresh()` is the one place time moves, as on Android: sweep, then due warnings,
  reminders, snoozes. A 1 s timer calls it when `nextEvent` is due; it also runs on load and when the tab is shown.
- `src/pwa.ts` + `public/sw.js` + `public/manifest.webmanifest`: installable and offline. `vite.config.ts` sets
  `base: './'` so `dist/` works under a subpath (GitHub Pages `/fuse/`); keep every public path relative. The
  worker (hand-written, registered only in production builds) precaches `./` + `./index.html`, serves pages
  network-first with the cached page offline, and everything else stale-while-revalidate (hashed `assets/*` work
  offline after the first visit). **Bump `CACHE` in `sw.js` every release.** Icons: `public/icons/*.svg` by hand;
  the PNGs (`icon-192`, `icon-512`, `maskable-512`, `apple-touch-icon`) come from `python scripts/icons.py` (Pillow).
- `src/whatsnew.ts`: every release adds its lines (newest first) and bumps `package.json`'s version. A fresh start
  sees the first-run guide instead, never What's new.

## The web's hard limit: alerts

A web page can't wake itself. Warnings and reminders fire only while a tab of the app is open (or on reopening:
`sweep` and `warningDue` catch up, and a late warning is still shown). Alerts go out as system notifications through
the service worker's `showNotification` (`pwa.ts` `notify`, tagged per task and kind so a repeat replaces rather than
stacks), which works on Android Chrome once installed or with permission; `new Notification()` is only the fallback
where no worker is registered (dev). The banner always shows too. Notification Triggers are not used: they never
shipped in Chrome. Push would be the only way to alert with the tab closed, and it needs a server, which Fuse has
never had (ask before adding one).

## 0.1.0 (phase 1, done): the foundation

Logic + store ported with all 41 Android tests (plus 5 store tests, 1 zone test), all green. The page: list in
the user's order, quick-add bar with `parseQuick` preview and random example hint, tick/untick, delete with Undo,
the card burning from the right in the fuse colour (a CSS stand-in for `Burn`, gold edge once ticked), alerts while
open, Save / Restore a backup (Android-compatible), first-run guide, What's new, the "Created by catcreature" egg
(7 taps on the version line). Light/dark follow the system. Built and unit-tested only; not opened in a browser.

## 0.2.0 (phase 2, done)

- Editor sheet: `src/editor.ts`, its pure maths in `src/edit.ts`. Add time stays pending until Save; an untouched
  reminder is kept exactly; a task that burns out while its sheet is open is not edited.
- PWA: manifest, `public/sw.js`, `src/pwa.ts`; PNG icons from `scripts/icons.py` (Pillow from a scratch venv).
- Sort is not saved (always opens in My order). Drag to reorder: `src/order.ts`; `render()` skips while dragging;
  groups never cross. Built and unit-tested only; not opened in a browser.

## 0.3.0 (phase 3 without Stats, plus sync)

- Settings sheet (`src/settings.ts`): theme, accent, warning default, history keep, Strict 24 h, quiet hours,
  Calm mode, system notifications, and Sync. Nothing applies until Save, except Sync now and Remove.
- Views (`src/views.ts`, `#/history`): the History page (search, bring back, delete one, Clear all with Undo) and
  the list's Burned out recently strip, both in `src/history.ts`.
- **Sync** (`docs/SYNC.md` is the binding contract, shared with the Android app; `docs/sync-fixtures/` the merge
  tests both run):
  - `src/sync/merge.ts`: the file, `readFile`, `merge`, `sameFile`. Done and fixture-tested; don't change what it does.
  - `src/sync/github.ts`: `getFile` / `putFile` over the Contents API (`fetch`, `cache: 'no-store'` because GitHub
    lets a contents GET be cached 60 s), UTF-8-safe base64, 404 file vs 404 repo told apart, 1 MB limit, every error
    a `SyncError` whose message is SYNC.md's text.
  - `src/sync/sync.ts`: `Sync.syncNow()` = GET, merge(snapshot, remote), PUT unless `sameFile` (409/422 starts again
    from GET, 3 tries), then `merge(snapshot now, result)` into the store (`Store.replace`, no onChange; edits made
    while it was out win by their stamps), then `refresh()` + `render()`. One at a time; a trigger meanwhile queues one
    more. Triggers (`main.ts`): load, 5 s after every `commit()` (debounced), every 2 min while the tab is shown,
    `visibilitychange` to visible, `online`. Status line in localStorage `fuse.sync.status`.
  - **The token and repo live in localStorage `fuse.sync`** (`{repo, token}`): never in settings, backups or the
    synced file.
  - Stamps (`Store.stamp` / `tombstone` / `touchOrder`) as SYNC.md's "what bumps what": every user change to a record
    stamps `updated`; every deletion leaves a tombstone, and its Undo stamps the record back; a drag or Alt+Arrow
    sets `orderAt`; the keep-days rule's drops get tombstones (`refresh()`); restore stamps every record. Time's own
    changes (sweep, warned, reminded, a due snooze) never stamp. **Any new place that changes a record must stamp.**
  - `Store.replace` keeps the objects it already holds (fields overwritten), so an open editor or a pending Undo
    still points at the live record after a sync.
- Built and unit-tested only (fake GitHub in `test/github.test.ts`); not opened in a browser, never run against
  the real repo.

## The plan, phase by phase (one at a time; each its own release)

2. **Installable (PWA)** (done, 0.2.0): manifest, icons, service worker for offline, system notifications from the worker,
   Notification Triggers where supported. Editor sheet (notes, priority, Custom length, warning, reminder, repeat),
   Add time (`extend`), sort button, drag to reorder.
3. **Settings + history** (done, 0.3.0, except Stats): theme/accent, warning default, history keep, quiet hours,
   strict 24 h, Calm mode; history page (search, bring back, clear), Burned out recently. Stats (streaks, 7-day
   chart) is parked.
3b. **Sync** (done, 0.3.0): one list with the Android app through `fuse.json` in `catcreature/fuse-data` (see 0.3.0).
4. **The look**: the 11 burn styles on `<canvas>` (port `Views.kt`'s `Burn`), Ember with its moods and forms,
   Firelight, Gold mend, Ashes, the opening burn-in; sound styles (the `res/raw` WAVs play as-is via Web Audio).
5. **The rooms**: Focus, Last call, Plan my day, Bonfire, Pick for me, Empty your head (`dumpLines` is ready),
   Your week (share via the Web Share API), Grow, Matchbox, Chain reaction, Pull to strike, Rekindle.
6. **Hosting**: `dist/` is static; the user picked GitHub Pages (2026-11-17).

Not on the web at all: the home-screen widget, the always-there notification, adding from a notification, Live
Updates, launcher shortcuts beyond a PWA's own.
