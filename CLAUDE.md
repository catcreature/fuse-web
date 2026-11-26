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
  Since 0.3.1 the art is the Android app's launcher icon (see 0.3.1).
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

## 0.3.1: simpler, fits every window

- The user asked for "simpler and more like browser dimension compatible". Header is just "Fuse" + summary with
  History and Settings as SVG icon buttons; Sort moved to a slim toolbar above the list ("3 open" · Sort); Save /
  Restore a backup and the version line (7-tap egg) moved into Settings' last section, Backup (`settings.ts` gets
  `backup`, `restore`, `version` from `main.ts`; Restore closes the sheet first, since a restore replaces settings).
  No page footer. The hidden `#file` input sits outside `<main>`.
- Layout, mobile first: one column `min(100% - 32px, 680px)` with safe-area insets (`viewport-fit=cover`). In
  `index.html`, `#rail` (`#cards`, `#burned`, `#sync-card`) comes before `.col` (banner, add bar, `#list-bar`,
  `#list`); below 1024 px `.layout` is a flex column, `.col` is `display: contents` and `order` puts the rail between
  the banner and the add bar (Sync card hidden). From 1024 px `.layout` is a grid `minmax(0, 680px) 300px` with a
  32 px gap, the rail sticky. `syncCard()` in `main.ts` redraws on every `render()` and on `sync.listen`.
- Sheets: a bottom sheet below 640 px, a centred modal from 640 px. Touch targets 44 px, one `:focus-visible` ring,
  reduced motion honoured. Keys: `n` focuses the add bar, `/` the History search (never while typing or in a sheet).
- Fixed on the way: `#list li > *` had made `.burn` `position: relative`, a grid item of its own.
- The icon is the Android app's (`fuse/.../drawable/ic_launcher_foreground.xml`: white fuse, ember spark, rays on
  #1B1C20), replacing the flame. `icons/maskable.svg` is it full-bleed; `icons/icon.svg` and `favicon.svg` round the
  square (rx 24 of 108) and scale the art 1.35x round the centre; the header carries an inline copy (28 px).
  `scripts/icons.py` draws the PNGs from the same art (4x, LANCZOS; segments + vertex discs, since Pillow's curve
  joints leave gaps).

## 0.4.0: Palette, Emberr's look (the user's request, 2026-11-17)

Not phase 4 of the plan below (that is still the burn styles on canvas): the user asked for "a theme like this"
from **emberr-app/Emberr** (AGPL-3.0, Compose Multiplatform, not ours), taken from the repository itself, then
"make ember and soft only, do not make others", and then the Android app and this one. So the same port as
`fuse/` 0.40.0 + 0.40.1 — keep the two in step if either changes.

Settings, Look, **Palette**: **Emberr** (the new default) | **Soft** | **Fuse** (the look up to 0.3.1).
`Settings.palette` (a key, not an index, so a hand-edited save can't point at nothing; `paletteKey()` guards it),
applied by `applyLook` as `data-palette` on `<html>`, like `data-theme` and `data-accent`. It is not in the sync
file: settings live in their own `fuse.settings` key, so `docs/SYNC.md` is untouched and the fixtures still pass.

- **Colours** (`src/style.css`): `--bg`, `--card`, `--chip`, `--line`, `--ink`, `--dim` per palette, from Emberr's
  `ColorThemePreference.EMBERR` and `.SOFT` (its `ColorThemes.kt`): bg ← `background`, card ← `surface`,
  chip ← `surfaceContainerHigh`, line ← `outlineVariant`, ink ← `onSurface`, dim ← `onSurfaceVariant`. **Emberr's
  surface is darker than its background in light mode**, so cards sit grey on a white page: that is the look.
  Each palette's dark half is repeated twice, as the base tokens are: once under `prefers-color-scheme: dark`
  with `:not([data-theme='light'])`, once under `[data-theme='dark']`. The palette blocks sit **after** the base
  dark blocks, because they match at the same specificity and source order decides.
- **Monochrome**: Emberr has no accent colour — its `primary` and `secondary` are both CharcoalNoir (CloudVeil in
  the dark). Each palette carries `--mono` / `--on-mono`, and a rule placed **after** the `[data-accent=…]` rules
  points `--accent` / `--on-accent` at them, so chips, buttons, headings and rings go black or white. `accentColor()`
  does the same for the canvas-side fuse colour. The five Fuse accents still apply to the Fuse palette, and
  Settings hides or shows a note saying so as the palette changes. The fuse still burns accent → amber → red.
- **The hairline**: `--ring` (`none` by default, `0 0 0 1px var(--hairline)` under a palette) on `#list li`, the
  quiet cards and `.h-row`. A `box-shadow`, not a border, because `#list li`'s left border is the priority stripe.
  Radii needed nothing: the web app was already on Emberr's 12 px.
- **Type**: Poppins, Emberr's default, self-hosted from `src/fonts` (two weights: 400, and 700 for the CSS's
  `font-weight: 600`; no CDN, and Vite hashes them into `assets/` where the worker caches them offline). `--font`
  carries it; the Fuse palette keeps `system-ui`. See `NOTICE`. Body stays 16 px (Emberr's 15 sp is its own scale).
- Built and unit-tested only (154 tests); **not opened in a browser**, and not deployed — `npm run deploy` is the
  user's call.

## 0.4.1: the done group folds (the user's request, 2026-11-17)

"defaullt folded for completed oncs in web version is missing." The Android app has a done row
(`MainActivity`'s `DONE_ROW` sentinel, `KEY_SHOW_DONE`) and this one never got it: finished tasks simply sat on
at the bottom of the list. Now `render()` splits the two groups it already had — `sorted()` puts done after open,
which `order.ts` relies on — and puts `doneRow(n)` between them: an `<li class="done-row">` holding a button that
reads "3 done ▸" / "3 done ▾", with `aria-expanded`. The done cards are only built when it is open.

- `Settings.showDone`, **false by default**: they start folded, which is what the user asked for. **Note the Android
  app defaults to shown** (`KEY_SHOW_DONE` is `true`); the two differ on purpose until the user says otherwise.
- The row carries **no `data-id`**, so `order.ts` skips it: it picks rows with `li[data-id]` and groups them by the
  `done` class, so neither a drag nor Alt+Arrow can see it, and a folded done group simply has nothing to drag.
- `#list li.done-row` opts out of the card look the way `li.empty` does (no background, border, ring or padding).
- 154 tests pass; the defaults test in `test/store.test.ts` asserts the whole settings shape, so it names the new
  field. Built and tested only, then deployed: not opened in a browser.

## 0.4.2: Glass (the user's request, 2026-11-17)

"glass like theme and blurr effect is missing in fuse." Right — Emberr does have a glass system and the
palette port had left it out. Ported from its
`shared/.../presentation/shared/components/EmberrBlur.kt`, which has two styles and gives both exact numbers:

- **Regular**, "chrome floating over content — icon buttons, pills, top bars": the background colour at
  **alpha 0.45**, **blur radius 32 dp**, `noiseFactor` 0. Here: `#undo` (fixed, over the list) and `#quick`.
- **Thick**, "heavier separation — sheets, dialogs, anything that must hold long-form text": the surface
  colour at **alpha 0.82**, **blur radius 40 dp**. Here: `dialog.sheet`.

Settings, Look, **Glass** (`Settings.glass`, **true** by default), applied by `applyLook` as `data-glass` on
`<html>`, the same switch the Android app's 0.41.0 has.

- The web gets the real thing for free: `backdrop-filter: blur(32px | 40px)` with a `color-mix` tint, which the
  Android app cannot do inside its own window (see `fuse/CLAUDE.md` 0.41.0).
- `dialog.sheet::backdrop` drops from a 0.45 scrim to **0.18** under glass: the dialog's `backdrop-filter`
  samples whatever is painted behind it, and the old scrim was nearly all it could see, so the blur was invisible.
- Everything sits inside `@supports` for backdrop-filter **and** `color-mix`. Both are needed: a browser with the
  filter but not the function would have kept the opaque background and blurred nothing visible. Without either,
  the surfaces stay solid, which is Emberr's own `fallbackTint`. `-webkit-backdrop-filter` is paired with each.
- 154 tests pass (the defaults test names the new field). Built, tested and deployed; not opened in a browser.

## 0.4.3: Emberr's smaller type (the user's request, 2026-11-17)

The same change as the Android app's 0.42.0. Emberr's `MobileFontSizesDefault` is bodyLarge **15 sp** over
labelSmall **13 sp**; the web ran 16 px over 14 px.

- **Every** `font-size` in the CSS (23 of them, across four files) is now `calc(<px> * var(--type-scale))`,
  including the `clamp()` one, and `body`'s `font:` shorthand was split so its size could take a calc.
  `--type-scale` is `calc(var(--type-base) * var(--type-step))`: the palette's own scale times the picked step.
- `--type-base` is **0.9** under the Emberr and Soft palettes (16 x 0.9 = 14.4, 14 x 0.9 = 12.6), 1 under Fuse.
- `--type-step` comes from `data-text` on `<html>`: Emberr's five `FontSizePreference` steps as factors of its
  Default (0.8667, 0.9333, 1, 1.0667, 1.1333). `Settings.textSize` is a key ('xs'…'xl'), guarded by `textKey()`,
  shown as Settings, Look, **Text size**.
- Line height stays 1.4; Emberr's body is 1.5 and its titles 1.25, but changing it app-wide moves every layout,
  so it was left alone deliberately.
- 154 tests pass. **Trap met twice now:** writing an apostrophe into a TS or XML string through a Python
  heredoc collapses the escape and breaks the file — word around it instead.

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
