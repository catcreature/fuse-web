// Settings: a sheet like the editor's (Look, Tasks, Alerts, Extras, Sync, Backup). Nothing applies until Save; Esc or
// Cancel leaves everything as it was, except Sync's own buttons (Sync now, Remove) and Backup's, which act on the tap.
// applyLook() puts theme, accent and Calm mode on <html> for style.css.

import './editor.css';
import './settings.css';
import { warnLabel } from './edit';
import type { Settings, Store } from './store';
import { DEFAULT_REPO, type Sync } from './sync/sync';
import { KEEP_CHOICES, Strict, WARN_CHOICES, isDone, rearm } from './tasks';

export interface SettingsDeps {
  store: Store;
  commit: () => void;
  refresh: () => void;
  render: () => void;
  sync: Sync;
  /** Save a backup: downloads it. */
  backup: () => void;
  /** Restore a backup: opens the file picker (main.ts takes it from there). */
  restore: () => void;
  /** The version line's number. */
  version: string;
}

/** The five accents, light and dark (the Android app's colors.xml and values-night), as 0xAARRGGBB. */
export const ACCENTS = [
  { key: 'ember', name: 'Ember', light: 0xffd9480f, dark: 0xffff7a3d },
  { key: 'ocean', name: 'Ocean', light: 0xff1971c2, dark: 0xff4dabf7 },
  { key: 'forest', name: 'Forest', light: 0xff2f7d3a, dark: 0xff51cf66 },
  { key: 'grape', name: 'Grape', light: 0xff7048e8, dark: 0xff9775fa },
  { key: 'rose', name: 'Rose', light: 0xffc2255c, dark: 0xfff06595 },
];

const accentOf = (i: number) => ACCENTS[Number.isInteger(i) && i >= 0 && i < ACCENTS.length ? i : 0];

/**
 * 0.4.0: the palette. 'emberr' and 'soft' are ported from emberr-app/Emberr's own ColorThemePreference
 * EMBERR and SOFT (its ColorThemes.kt), the only two of its fourteen asked for; the colours live in
 * style.css under data-palette. Both are monochrome — Emberr's primary and secondary are CharcoalNoir,
 * CloudVeil in the dark — so they bring their own accent, light and dark, as 0xAARRGGBB.
 */
export const PALETTES = [
  { key: 'emberr', name: 'Emberr', light: 0xff0d0d0d, dark: 0xffefefef },
  { key: 'soft', name: 'Soft', light: 0xff1c1c1c, dark: 0xffe6e6e6 },
  { key: 'fuse', name: 'Fuse', light: 0, dark: 0 },
] as const;

type PaletteKey = (typeof PALETTES)[number]['key'];

const paletteOf = (k: string) => PALETTES.find((p) => p.key === k) ?? PALETTES[0];

/** The key to store, guarding against an older or hand-edited save. */
export const paletteKey = (k: string): PaletteKey => paletteOf(k).key;

/**
 * 0.4.3: Emberr's five text sizes (its `FontSizePreference`). The factors live in style.css as
 * --type-step; this is only the list and the guard.
 */
export const TEXT_SIZES = [
  { key: 'xs', name: 'Extra small' },
  { key: 's', name: 'Small' },
  { key: 'm', name: 'Default' },
  { key: 'l', name: 'Large' },
  { key: 'xl', name: 'Extra large' },
] as const;

type TextKey = (typeof TEXT_SIZES)[number]['key'];

export const textKey = (k: string): TextKey => (TEXT_SIZES.find((t) => t.key === k) ?? TEXT_SIZES[2]).key;

const darkQuery = matchMedia('(prefers-color-scheme: dark)');

/** Whether the page is dark now: the picked theme, else the device's. */
export function isDark(): boolean {
  const t = document.documentElement.dataset.theme;
  return t === 'dark' || (t !== 'light' && darkQuery.matches);
}

/**
 * The accent as 0xAARRGGBB for the theme on screen: the fuse's fresh colour. A monochrome palette's own
 * primary wins over the five Fuse accents, exactly as its --accent does in the CSS.
 */
export const accentColor = (s: Settings) => {
  const p = paletteOf(s.palette);
  const mono = isDark() ? p.dark : p.light;
  return mono !== 0 ? mono : isDark() ? accentOf(s.accent).dark : accentOf(s.accent).light;
};

/** Palette, theme, accent, Calm mode and Strict 24 h, as settings say. At startup and after Save. */
export function applyLook(s: Settings) {
  const d = document.documentElement.dataset;
  if (s.theme === 'light' || s.theme === 'dark') d.theme = s.theme;
  else delete d.theme;
  d.palette = paletteKey(s.palette);
  if (s.glass) d.glass = '';
  else delete d.glass;
  d.text = textKey(s.textSize);
  d.accent = accentOf(s.accent).key;
  if (s.calm) d.calm = '';
  else delete d.calm;
  Strict.on = s.strict;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

const two = (n: number) => String(n).padStart(2, '0');
const toTime = (m: number) => `${two(Math.floor(m / 60) % 24)}:${two(m % 60)}`;
/** 'HH:MM' as minutes of the day; -1 for anything else. */
const fromTime = (v: string) => {
  const m = /^(\d{2}):(\d{2})/.exec(v);
  if (!m) return -1;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : -1;
};

const keepLabel = (d: number) => (d === 0 ? 'Forever' : d === 365 ? '1 year' : `${d} days`);

let seq = 0;
/** "Created by catcreature": seven taps on the version line, counted across openings. */
let taps = 0;

export function openSettings(deps: SettingsDeps) {
  const { store } = deps;
  const s = store.settings;
  const id = `st${++seq}`;

  const dialog = el('dialog', 'sheet settings');
  dialog.setAttribute('aria-labelledby', `${id}-head`);
  const form = el('form');
  form.noValidate = true;
  dialog.append(form);

  const header = el('header');
  const head = el('h2', '', 'Settings');
  head.id = `${id}-head`;
  header.append(head);
  form.append(header);

  const section = (title: string) => {
    const box = el('section', 'group');
    const h = el('h3', 'section', title);
    h.id = `${id}-${title.toLowerCase()}`;
    box.setAttribute('aria-labelledby', h.id);
    box.append(h);
    form.append(box);
    return box;
  };
  const chips = (parent: HTMLElement, name: string, legend: string, options: [string, string][], checked: string) => {
    const set = el('fieldset', 'chips');
    set.setAttribute('role', 'radiogroup');
    const lg = el('legend', 'label', legend);
    lg.id = `${id}-${name}-legend`;
    set.setAttribute('aria-labelledby', lg.id);
    set.append(lg);
    const inputs = options.map(([value, text]) => {
      const lab = el('label', 'chip');
      const r = el('input');
      r.type = 'radio';
      r.name = `${id}-${name}`;
      r.value = value;
      r.checked = value === checked;
      lab.append(r, el('span', '', text));
      set.append(lab);
      return r;
    });
    parent.append(set);
    return () => inputs.find((i) => i.checked)?.value ?? checked;
  };
  const select = (parent: HTMLElement, name: string, label: string, options: [string, string][], value: string) => {
    const box = el('div', 'field');
    const l = el('label', 'label', label);
    const sel = el('select');
    l.htmlFor = sel.id = `${id}-${name}`;
    for (const [v, t] of options) sel.append(new Option(t, v));
    if (!options.some(([v]) => v === value)) sel.append(new Option(value, value));
    sel.value = value;
    box.append(l, sel);
    parent.append(box);
    return sel;
  };
  const toggle = (parent: HTMLElement, name: string, label: string, on: boolean, hintText = '') => {
    const box = el('div', 'field');
    const row = el('div', 'switch-row');
    const l = el('label', '', label);
    const input = el('input', 'switch');
    input.type = 'checkbox';
    input.setAttribute('role', 'switch');
    input.checked = on;
    l.htmlFor = input.id = `${id}-${name}`;
    row.append(l, input);
    box.append(row);
    if (hintText) {
      const h = el('p', 'hint', hintText);
      h.id = `${id}-${name}-hint`;
      input.setAttribute('aria-describedby', h.id);
      box.append(h);
    }
    parent.append(box);
    return input;
  };

  // Look.
  const look = section('Look');
  const palette = chips(look, 'palette', 'Palette', PALETTES.map((p) => [p.key, p.name]), paletteKey(s.palette));
  const paletteHint = el('p', 'hint',
    'Emberr and Soft come from the Emberr app: its monochrome colours and its Poppins type, flat cards with a hairline edge. Fuse is the look up to 0.3.1.');
  look.append(paletteHint);
  const textSize = chips(look, 'text', 'Text size', TEXT_SIZES.map((t) => [t.key, t.name]), textKey(s.textSize));
  const glass = toggle(look, 'glass', 'Glass', s.glass,
    'Frosted sheets, add bar and Undo, as the Emberr app has. Turn it off for flat, solid ones.');
  const theme = chips(look, 'theme', 'Theme', [['system', 'Like the device'], ['light', 'Light'], ['dark', 'Dark']], s.theme);
  const swatches = el('fieldset', 'swatches');
  swatches.setAttribute('role', 'radiogroup');
  const sl = el('legend', 'label', 'Accent');
  sl.id = `${id}-accent-legend`;
  swatches.setAttribute('aria-labelledby', sl.id);
  swatches.append(sl);
  const accents = ACCENTS.map((a, i) => {
    const lab = el('label', 'swatch');
    lab.title = a.name;
    const r = el('input');
    r.type = 'radio';
    r.name = `${id}-accent`;
    r.value = String(i);
    r.checked = i === ACCENTS.indexOf(accentOf(s.accent));
    r.setAttribute('aria-label', a.name);
    const dot = el('span');
    dot.style.background = `var(--${a.key})`;
    lab.append(r, dot);
    swatches.append(lab);
    return r;
  });
  look.append(swatches);
  // Emberr and Soft have no accent colour of their own, so say so rather than look broken.
  const accentHint = el('p', 'hint', 'Emberr and Soft are monochrome, as the Emberr app is. The accent colours the Fuse palette.');
  const showAccentHint = () => { accentHint.hidden = palette() === 'fuse'; };
  showAccentHint();
  // Radio changes bubble, so picking another palette updates the note at once (nothing applies until Save).
  look.addEventListener('change', showAccentHint);
  look.append(accentHint);

  // Tasks.
  const tasks = section('Tasks');
  const warn = select(tasks, 'warn', 'Warn before burn-out (default)',
    WARN_CHOICES.map((w) => [String(w), w === 0 ? 'Off' : warnLabel(w)]), String(s.warn));
  const keep = select(tasks, 'keep', 'Keep history', KEEP_CHOICES.map((d) => [String(d), keepLabel(d)]), String(s.keep));
  const strict = toggle(tasks, 'strict', 'Strict 24 h', s.strict, 'One extension per task and no custom lengths.');

  // Alerts.
  const alerts = section('Alerts');
  const quiet = toggle(alerts, 'quiet', 'Quiet hours', s.quiet,
    'Alerts in quiet hours show only inside Fuse, no system notification.');
  const times = el('div', 'times');
  const time = (name: string, label: string, minutes: number) => {
    const lab = el('label', 'unit');
    const input = el('input');
    input.type = 'time';
    input.value = toTime(minutes);
    input.id = `${id}-${name}`;
    lab.htmlFor = input.id;
    lab.append(el('span', '', label), input);
    times.append(lab);
    return input;
  };
  const from = time('from', 'From', s.quietStart);
  const to = time('to', 'To', s.quietEnd);
  // The times sit under the switch, before its hint.
  quiet.closest('.field')!.querySelector('.switch-row')!.after(times);
  const showTimes = () => (times.hidden = !quiet.checked);
  quiet.addEventListener('change', showTimes);
  showTimes();

  const perm = el('div', 'field perm');
  const permLabel = el('span', 'label', 'System notifications');
  const permRow = el('div', 'row');
  const permState = el('span', 'perm-state');
  permState.setAttribute('aria-live', 'polite');
  const ask = el('button', 'pill', 'Turn on');
  ask.type = 'button';
  permRow.append(permState, ask);
  perm.append(permLabel, permRow);
  alerts.append(perm);
  const showPerm = () => {
    const has = 'Notification' in window;
    const p = has ? Notification.permission : 'denied';
    permState.textContent = !has ? 'Not available in this browser'
      : p === 'granted' ? 'On' : p === 'denied' ? 'Off: blocked in browser settings' : 'Not asked';
    ask.hidden = !has || p !== 'default';
  };
  // Asking is the browser's own prompt, so it happens on the tap, not on Save.
  ask.onclick = async () => {
    await Notification.requestPermission();
    showPerm();
  };
  showPerm();

  // Extras.
  const extras = section('Extras');
  const calm = toggle(extras, 'calm', 'Calm mode', s.calm, 'Holds every animation still. Tasks still burn by the clock.');

  // Sync (docs/SYNC.md, "Settings: Sync section"). The repo and token are kept in localStorage, not in settings.
  const { sync } = deps;
  const syncBox = section('Sync');
  const cfg = sync.config;
  const repoBox = el('div', 'field');
  const repoLabel = el('label', 'label', 'Repo (owner/name)');
  const repo = el('input');
  repo.type = 'text';
  repo.value = cfg.repo;
  repo.placeholder = DEFAULT_REPO;
  repo.autocomplete = 'off';
  repo.spellcheck = false;
  repoLabel.htmlFor = repo.id = `${id}-repo`;
  repoBox.append(repoLabel, repo);
  syncBox.append(repoBox);

  const tokenBox = el('div', 'field');
  const tokenLabel = el('label', 'label', 'GitHub token');
  const token = el('input');
  token.type = 'password';
  token.autocomplete = 'off';
  token.spellcheck = false;
  tokenLabel.htmlFor = token.id = `${id}-token`;
  const remove = el('button', 'text', 'Remove');
  remove.type = 'button';
  remove.setAttribute('aria-label', 'Remove the token');
  const tokenRow = el('div', 'row');
  tokenRow.append(token, remove);
  const help = el('p', 'hint',
    'Create a fine-grained token at github.com/settings/personal-access-tokens with access to this repo only, Contents: Read and write.');
  const kept = el('p', 'hint', 'Kept in this browser only.');
  help.id = `${id}-token-help`;
  kept.id = `${id}-token-kept`;
  token.setAttribute('aria-describedby', `${help.id} ${kept.id}`);
  tokenBox.append(tokenLabel, tokenRow, help, kept);
  syncBox.append(tokenBox);

  const nowBox = el('div', 'field');
  const nowRow = el('div', 'row');
  const syncNow = el('button', 'pill', 'Sync now');
  syncNow.type = 'button';
  const status = el('span', 'perm-state');
  status.setAttribute('aria-live', 'polite');
  nowRow.append(syncNow, status);
  nowBox.append(nowRow);
  syncBox.append(nowBox);

  /** A saved token shows as dots; typing replaces it. */
  const showToken = () => {
    const has = sync.config.token !== '';
    token.placeholder = has ? '••••' : 'Paste the token';
    remove.hidden = !has;
  };
  const showStatus = (text: string) => (status.textContent = sync.busy && !text ? 'Syncing…' : text);
  /** What's typed in the two fields, kept; a blank token field keeps the saved token. */
  const keepTyped = () => {
    const typed = token.value.trim();
    sync.config = { repo: repo.value.trim() || DEFAULT_REPO, token: typed || sync.config.token };
    if (typed) token.value = '';
    showToken();
  };
  remove.onclick = () => {
    sync.config = { repo: repo.value.trim() || DEFAULT_REPO, token: '' };
    token.value = '';
    sync.clearStatus();
    showToken();
    token.focus();
  };
  syncNow.onclick = async () => {
    keepTyped();
    if (!sync.config.token) {
      status.textContent = 'Paste a token first.';
      token.focus();
      return;
    }
    syncNow.disabled = true;
    status.textContent = 'Syncing…';
    await sync.syncNow();
    syncNow.disabled = false;
    showStatus(sync.status);
  };
  const unlisten = sync.listen(showStatus);
  showToken();
  showStatus(sync.status);

  // Backup (moved here from the page's footer in 0.3.1). Restore closes the sheet first: what it brings back
  // replaces the settings too, which a later Save here would otherwise undo.
  const backupBox = section('Backup');
  const backupRow = el('div', 'row');
  const saveBackup = el('button', 'pill', 'Save a backup');
  saveBackup.type = 'button';
  saveBackup.id = 'backup';
  saveBackup.onclick = () => deps.backup();
  const restore = el('button', 'pill', 'Restore a backup');
  restore.type = 'button';
  restore.id = 'restore';
  restore.onclick = () => {
    dialog.close();
    deps.restore();
  };
  backupRow.append(saveBackup, restore);
  const version = el('p', 'hint version');
  version.id = 'version';
  const showVersion = () => {
    version.textContent = `Fuse for the web ${deps.version}${taps >= 7 ? ' · Created by catcreature' : ''}`;
  };
  version.onclick = () => {
    taps++;
    showVersion();
  };
  showVersion();
  backupBox.append(backupRow, version);

  // Footer.
  const actions = el('div', 'actions');
  const cancel = el('button', 'text', 'Cancel');
  cancel.type = 'button';
  cancel.onclick = () => dialog.close();
  const save = el('button', 'save', 'Save');
  save.type = 'submit';
  actions.append(cancel, save);
  form.append(actions);

  form.onsubmit = (e) => {
    e.preventDefault();
    const now = Date.now();
    const t = theme();
    s.theme = t === 'light' || t === 'dark' ? t : 'system';
    const a = accents.findIndex((r) => r.checked);
    s.accent = a < 0 ? 0 : a;
    s.palette = paletteKey(palette());
    s.glass = glass.checked;
    s.textSize = textKey(textSize());
    const oldWarn = s.warn;
    s.warn = Number(warn.value);
    s.keep = Number(keep.value);
    s.strict = strict.checked;
    s.quiet = quiet.checked;
    const qs = fromTime(from.value);
    const qe = fromTime(to.value);
    if (qs >= 0) s.quietStart = qs;
    if (qe >= 0) s.quietEnd = qe;
    s.calm = calm.checked;
    store.saveSettings();
    const hadToken = sync.config.token !== '';
    keepTyped();
    if (!hadToken && sync.config.token) void sync.syncNow();
    applyLook(s);
    if (s.warn !== oldWarn) {
      // A new default moves every warning that follows it; one already past is skipped, not sent late.
      for (const task of store.tasks) if (!isDone(task) && task.warn === -1) rearm(task, now, s.warn);
      deps.commit();
    }
    dialog.close();
    deps.refresh();
    deps.render();
  };

  // Esc closes (the dialog's own cancel) without saving.
  dialog.addEventListener('close', () => {
    unlisten();
    dialog.remove();
  });
  dialog.autofocus = true;
  document.body.append(dialog);
  dialog.showModal();
}
