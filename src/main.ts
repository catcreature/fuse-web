// The page: the list, the quick-add bar, alerts while the page is open, backup in and out.
// 0.1.0 is the foundation only; see CLAUDE.md for what of the Android app is still to come.

import { notify, registerWorker } from './pwa';
import { openEditor } from './editor';
import { initHistory, renderBurned, renderHistory } from './history';
import { initOrder, isDragging } from './order';
import { accentColor, applyLook, isDark, openSettings } from './settings';
import { Store } from './store';
import { Sync } from './sync/sync';
import {
  HIGH, SORTS, type Sort, type Task, burnLeft, css, fuseColor, hm, isDone, newTask, nextEvent, parseQuick, quickRemindAt, reminderDue,
  quiet, rearm, snoozeDue, sorted, sweep, warningDue,
} from './tasks';
import { here, local } from './time';
import { currentView, initViews } from './views';
import { WHATS_NEW, whatsNew } from './whatsnew';

const VERSION = WHATS_NEW[0][0];
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

const store = new Store(localStorage);
const zone = here();
const dark = matchMedia('(prefers-color-scheme: dark)');
// The fuse runs accent (the one picked in Settings), amber, red as time runs out (the Android app's colours, light and dark).
const fuse = () => [accentColor(store.settings), ...(isDark() ? [0xfffcc419, 0xffff6b6b] : [0xfff59f00, 0xffe03131])];
/** Not saved: the page always opens in My order, as the Android app does. */
let sort: Sort = 'MINE';

function clock(t: number): string {
  const l = local(t, zone);
  return `${l.hour}:${String(l.minute).padStart(2, '0')}`;
}

function banner(text: string) {
  const b = $('banner');
  b.textContent = text;
  b.hidden = text === '';
}

const SAVE_FAILED = "Fuse couldn't save: this browser's storage is full or blocked. Your last change will be lost when the page closes.";

/** Saves, then syncs a few seconds later; a browser that refuses the write is told to the user, never swallowed. */
function commit() {
  try {
    store.save();
  } catch {
    banner(SAVE_FAILED);
    render();
  }
  sync.schedule();
}

/** An alert: a system notification when allowed and not in quiet hours, and always the banner on the page. */
function alertUser(text: string, tag: string) {
  banner(text);
  const s = store.settings;
  if (s.quiet && quiet(Date.now(), zone, s.quietStart, s.quietEnd)) return;
  void notify(text, tag);
}

/** The one place time moves, as in the Android app's refresh(): sweeps ended tasks and sends what's due. */
function refresh() {
  const now = Date.now();
  const s = store.settings;
  // History the keep-days rule drops gets a tombstone, so a sync drops it on the phone too (SYNC.md).
  const ids = () => new Set([...store.tasks, ...store.history].map((t) => t.id));
  const before = ids();
  let changed = sweep(store.tasks, store.history, now, s.keep, undefined, (n) => {
    s.doneGone += n;
    store.saveSettings();
  }, store.matches);
  if (changed) {
    const after = ids();
    for (const id of before) if (!after.has(id)) store.tombstone(id);
  }
  for (const t of store.tasks) {
    if (warningDue(t, now, s.warn)) {
      t.warned = true;
      changed = true;
      alertUser(`"${t.title}" burns out in ${hm(t.expires - now)}.`, `warn-${t.id}`);
    }
    if (reminderDue(t, now)) {
      t.reminded = true;
      changed = true;
      alertUser(`Reminder: ${t.title}`, `remind-${t.id}`);
    }
    if (snoozeDue(t, now)) {
      t.snoozeAt = 0;
      changed = true;
      alertUser(`Again: ${t.title}`, `snooze-${t.id}`);
    }
  }
  if (changed) commit();
}

/** "3 done ▸" / "3 done ▾": tapping folds or unfolds the done group, and the choice is remembered. */
function doneRow(n: number): HTMLLIElement {
  const li = el('li', 'done-row');
  const open = store.settings.showDone;
  const b = el('button', '', `${n} done ${open ? '▾' : '▸'}`);
  b.type = 'button';
  b.setAttribute('aria-expanded', String(open));
  b.setAttribute('aria-label', open ? `${n} done. Fold them away.` : `${n} done, folded. Show them.`);
  b.onclick = () => {
    store.settings.showDone = !store.settings.showDone;
    store.saveSettings();
    render();
  };
  li.append(b);
  return li;
}

function card(t: Task, now: number): HTMLLIElement {
  const li = el('li', [isDone(t) ? 'done' : '', t.priority === HIGH ? 'high' : ''].join(' ').trim());
  li.dataset.id = String(t.id);
  const left = burnLeft(t, now);
  const [fresh, amber, red] = fuse();
  const burn = el('div', 'burn');
  burn.style.width = `${(1 - left) * 100}%`;
  burn.style.setProperty('--fuse', css(fuseColor(left, fresh, amber, red)));
  const tick = el('input');
  tick.type = 'checkbox';
  tick.checked = isDone(t);
  tick.setAttribute('aria-label', `Done: ${t.title}`);
  tick.onchange = () => {
    t.doneAt = tick.checked ? Date.now() : 0;
    if (!tick.checked) rearm(t, Date.now(), store.settings.warn);
    store.stamp(t);
    commit();
  };
  // A 44 px hit area round the 22 px circle.
  const tickBox = el('label', 'tick');
  tickBox.append(tick);
  const text = el('div', 'card-text');
  text.setAttribute('role', 'button');
  text.tabIndex = 0;
  text.onclick = () => openEditor(t, { store, zone, commit, undo });
  text.onkeydown = (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    openEditor(t, { store, zone, commit, undo });
  };
  text.append(el('div', 'title', t.title));
  const remind = !isDone(t) && !t.reminded && t.remindAt > now ? ` · reminder ${clock(t.remindAt)}` : '';
  text.append(el('div', 'meta', isDone(t) ? 'Done' : `${hm(t.expires - now)} left · burns out ${clock(t.expires)}${remind}`));
  const del = el('button', 'delete', '✕');
  del.type = 'button';
  del.setAttribute('aria-label', `Delete: ${t.title}`);
  del.onclick = () => {
    const at = store.tasks.indexOf(t);
    if (at < 0) return;
    store.tasks.splice(at, 1);
    store.tombstone(t.id);
    commit();
    undo(`Deleted "${t.title}"`, () => {
      if (store.tasks.includes(t)) return;
      store.tasks.splice(Math.min(at, store.tasks.length), 0, store.stamp(t));
      commit();
    });
  };
  li.append(burn, tickBox, text, del);
  return li;
}

let undoTimer = 0;
function undo(text: string, back: () => void) {
  const bar = $('undo');
  bar.querySelector('span')!.textContent = text;
  bar.hidden = false;
  clearTimeout(undoTimer);
  undoTimer = window.setTimeout(() => (bar.hidden = true), 6000);
  bar.querySelector('button')!.onclick = () => {
    bar.hidden = true;
    back();
  };
}

/** The first-run guide, or What's new after an update: one card above the add bar. */
function cards() {
  const box = $('cards');
  box.replaceChildren();
  const s = store.settings;
  const note = (title: string, lines: string[], done: () => void) => {
    const n = el('div', 'note');
    n.append(el('h2', '', title));
    const ul = el('ul');
    for (const line of lines) ul.append(el('li', '', line));
    const ok = el('button', '', 'Got it');
    ok.type = 'button';
    ok.onclick = () => {
      done();
      store.saveSettings();
      cards();
    };
    n.append(ul, ok);
    box.append(n);
  };
  if (!s.welcomed) {
    note('How Fuse works', [
      'Every task you add gets exactly 24 hours. Then it burns out.',
      'Tick it before then. The card burns away from the right as its time runs out.',
      'Type "Call mom at 5pm !" to add a reminder and mark it important.',
      'Your tasks stay in this browser unless you turn on Sync in Settings: it shares one list with the Fuse app on your phone through your GitHub.',
    ], () => {
      s.welcomed = true;
      s.seenNotes = VERSION; // a fresh start never sees What's new: the guide covers it
    });
  } else if (s.seenNotes !== VERSION) {
    const lines = whatsNew(s.seenNotes);
    if (lines.length > 0) note("What's new", lines, () => (s.seenNotes = VERSION));
  }
}

function render() {
  if (isDragging()) return; // order.ts redraws on drop or cancel
  const now = Date.now();
  renderBurned($('burned'), now, { store, zone, commit, undo });
  renderHistory();
  const list = $('list');
  // sorted() already puts the done group after the open one (order.ts counts on it).
  const shown = sorted(store.tasks, sort);
  const doneShown = shown.filter(isDone);
  const rows = shown.filter((t) => !isDone(t)).map((t) => card(t, now));
  // 0.4.1: finished tasks fold away behind a row that counts them, as the Android app's done row does.
  if (doneShown.length > 0) {
    rows.push(doneRow(doneShown.length));
    if (store.settings.showDone) rows.push(...doneShown.map((t) => card(t, now)));
  }
  list.replaceChildren(...rows);
  if (shown.length === 0) list.append(el('li', 'empty', 'Nothing burning. Add a task to light its fuse.'));
  const open = store.tasks.filter((t) => !isDone(t));
  $('list-bar').hidden = shown.length === 0;
  $('open-count').textContent = `${open.length} open`;
  syncCard();
  const next = open.reduce<Task | null>((a, t) => (!a || t.expires < a.expires ? t : a), null);
  $('summary').textContent = next
    ? `${open.length} open · next burns out in ${hm(next.expires - now)}`
    : store.tasks.length > 0 ? 'All done.' : 'Every task lives 24 hours.';
}

// Quick add: the same words the Android app's bar reads.
const quick = $<HTMLInputElement>('quick');
const EXAMPLES = ['Call mom at 5pm', 'Pay rent tonight !', 'Stretch in 30 min', 'Email Sam this afternoon'];
quick.placeholder = EXAMPLES[Math.floor(Math.random() * EXAMPLES.length)];
quick.oninput = () => {
  const q = parseQuick(quick.value);
  const at = quickRemindAt(q, Date.now(), zone);
  const bits = [q.high ? 'High priority' : '', at > 0 ? `reminder at ${clock(at)}` : ''].filter(Boolean);
  $('preview').textContent = quick.value.trim() && bits.length ? `"${q.title}" · ${bits.join(' · ')}` : '';
};
$<HTMLFormElement>('add').onsubmit = (e) => {
  e.preventDefault();
  if (!quick.value.trim()) {
    openEditor(null, { store, zone, commit, undo });
    return;
  }
  const now = Date.now();
  const q = parseQuick(quick.value);
  const remindAt = quickRemindAt(q, now, zone);
  store.tasks.unshift(newTask(store.newId(), q.title, now, { priority: q.high ? HIGH : 1, remindAt, updated: now }));
  quick.value = '';
  $('preview').textContent = '';
  commit();
};

const sortBox = $<HTMLSelectElement>('sort');
sortBox.value = sort;
sortBox.onchange = () => {
  sort = SORTS.includes(sortBox.value as Sort) ? (sortBox.value as Sort) : 'MINE';
  render();
};
initOrder({
  list: $('list'),
  enabled: () => sort === 'MINE',
  shown: () => sorted(store.tasks, sort),
  // Both a drop and Alt+Arrow land here.
  apply: (order) => {
    store.tasks.splice(0, store.tasks.length, ...order);
    store.touchOrder();
    commit();
  },
  render,
});

const settings = () => openSettings({ store, commit, refresh, render, sync, backup, restore, version: VERSION });
$('open-settings').onclick = settings;

/** Save a backup (Settings, Backup). */
function backup() {
  const a = el('a');
  a.href = URL.createObjectURL(new Blob([store.backupText()], { type: 'application/json' }));
  a.download = 'fuse-backup.json';
  a.click();
  URL.revokeObjectURL(a.href);
}
const file = $<HTMLInputElement>('file');
/** Restore a backup (Settings, Backup): the file picker; what's picked lands in file.onchange. */
function restore() {
  file.click();
}
file.onchange = async () => {
  const f = file.files?.[0];
  file.value = '';
  if (!f) return;
  const before = store.backupText();
  if (!store.restore(await f.text())) {
    banner("That file isn't a Fuse backup. Nothing was changed.");
    return;
  }
  commit();
  refresh();
  banner('');
  undo('Backup restored: it replaced what was here', () => {
    store.restore(before);
    commit();
  });
};

/** The rail's Sync card (wide windows only): the status line as Settings shows it, or a way in to set it up. */
function syncCard() {
  const box = $('sync-card');
  if (!sync.config.token) {
    const set = el('button', 'link', 'Set up');
    set.type = 'button';
    set.onclick = settings;
    box.replaceChildren('Sync off · ', set);
    return;
  }
  const status = sync.status || (sync.busy ? 'Syncing…' : 'Not synced yet');
  if (box.textContent !== `Sync: ${status}`) box.textContent = `Sync: ${status}`;
}

// Keys: "n" goes to the add bar on the list, "/" to the search on History; never while typing or in a sheet.
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
  const target = e.target as HTMLElement;
  if (target.closest('input, textarea, select, [contenteditable]') || document.querySelector('dialog[open]')) return;
  if (e.key === 'n' && currentView() === '') {
    e.preventDefault();
    quick.focus();
  } else if (e.key === '/' && currentView() === 'history') {
    const search = document.querySelector<HTMLInputElement>('#history-view .h-search');
    if (!search) return;
    e.preventDefault();
    search.focus();
  }
});

store.onChange = render;
// The sync's own result redraws through apply, so it never sets off another sync by itself.
const sync = new Sync({
  store,
  box: localStorage,
  apply: () => {
    refresh();
    render();
  },
  time: (t) => {
    const l = local(t, zone);
    return `${String(l.hour).padStart(2, '0')}:${String(l.minute).padStart(2, '0')}`;
  },
  onSaveError: () => banner(SAVE_FAILED),
});
sync.listen(syncCard);
initHistory({ store, zone, commit, undo });
initViews(document.querySelector('main')!);
dark.onchange = render;
applyLook(store.settings);
cards();
refresh();
render();
registerWorker();
// Once a second: act the moment something is due; redraw the burn every 10 s.
let beat = 0;
setInterval(() => {
  const due = nextEvent(store.tasks, store.settings.warn);
  if (due > 0 && due <= Date.now()) refresh();
  if (++beat % 10 === 0) render();
}, 1000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    refresh();
    render();
    void sync.syncNow();
  }
});
// Sync: on load, after every change (commit), every 2 minutes while the tab is shown, and when the network is back.
void sync.syncNow();
setInterval(() => {
  if (!document.hidden) void sync.syncNow();
}, 2 * 60_000);
window.addEventListener('online', () => void sync.syncNow());
