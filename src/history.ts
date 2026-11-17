// The History page (#/history) and the list's "Burned out recently" strip. The pure helpers come first and are
// tested in test/history.test.ts; the page and the strip are built in code below them.

import './history.css';
import type { Store } from './store';
import { HOUR, type Task, hm, isDone, revived } from './tasks';
import { DAY, type Zone, dayOfWeek, epochDay, local } from './time';
import { currentView, registerView, viewBar } from './views';

/** How long a missed task stays in the list's "Burned out recently" strip. */
export const RECENT = 12 * HOUR;

/** Missed history records (never done) ended within the last 12 h, not repeating, not cleared: newest first. */
export function burnedRecently(history: Task[], now: number): Task[] {
  return history
    .filter((t) => !isDone(t) && !t.repeat && !t.cleared && t.endedAt > 0 && t.endedAt >= now - RECENT)
    .sort((a, b) => b.endedAt - a.endedAt);
}

/** Records whose title or notes hold query, ignoring case; an empty query matches everything. */
export function searchHistory(history: Task[], query: string): Task[] {
  const q = query.trim().toLowerCase();
  if (q === '') return history.slice();
  return history.filter((t) => t.title.toLowerCase().includes(q) || t.notes.toLowerCase().includes(q));
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A day's heading, both epoch days: "Today", "Yesterday", else "Mon 10 Nov". */
export function dayHeading(day: number, today: number): string {
  if (day === today) return 'Today';
  if (day === today - 1) return 'Yesterday';
  const d = new Date(day * DAY);
  return `${DAYS[dayOfWeek(day)]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export interface DayGroup {
  /** Epoch day the records ended on, in the zone. */
  day: number;
  tasks: Task[];
}

/** Records by the day they ended in zone, newest day first and newest first within a day. */
export function groupByDay(history: Task[], zone: Zone): DayGroup[] {
  const out: DayGroup[] = [];
  for (const t of history.slice().sort((a, b) => b.endedAt - a.endedAt)) {
    const day = epochDay(t.endedAt, zone);
    const last = out[out.length - 1];
    if (last && last.day === day) last.tasks.push(t);
    else out.push({ day, tasks: [t] });
  }
  return out;
}

// The page and the strip.

export interface HistoryDeps {
  store: Store;
  zone: Zone;
  commit: () => void;
  undo: (text: string, back: () => void) => void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

const two = (n: number) => String(n).padStart(2, '0');
function clock(t: number, zone: Zone): string {
  const l = local(t, zone);
  return `${two(l.hour)}:${two(l.minute)}`;
}

function button(text: string, cls: string, label: string, onclick: () => void): HTMLButtonElement {
  const b = el('button', cls, text);
  b.type = 'button';
  b.setAttribute('aria-label', label);
  b.onclick = onclick;
  return b;
}

/** A copy of t back on the list with a fresh 24 hours; a missed record is cleared from the strip too. */
function bringBack(t: Task, deps: HistoryDeps) {
  const now = Date.now();
  // revived() stamps the copy; the old record's cleared is the user's change too.
  deps.store.tasks.unshift(revived(t, deps.store.newId(), now));
  if (!isDone(t)) {
    t.cleared = true;
    deps.store.stamp(t);
  }
  deps.commit();
}

/** Fills the list's "Burned out recently" card (box), or hides it when there's nothing to show. */
export function renderBurned(box: HTMLElement, now: number, deps: HistoryDeps) {
  const recent = burnedRecently(deps.store.history, now);
  box.hidden = recent.length === 0;
  box.replaceChildren();
  if (recent.length === 0) return;
  const head = el('h2', '', 'Burned out recently');
  head.id = 'burned-head';
  box.setAttribute('aria-labelledby', head.id);
  const ul = el('ul');
  for (const t of recent) {
    const li = el('li');
    const text = el('div', 'b-text');
    text.append(el('div', 'title', t.title), el('div', 'meta', `${hm(now - t.endedAt)} ago`));
    const back = button('Bring back', 'pill', `Bring back: ${t.title}`, () => bringBack(t, deps));
    const go = button('Let it go', 'pill', `Let it go: ${t.title}`, () => {
      t.cleared = true;
      deps.store.stamp(t);
      deps.commit();
    });
    const actions = el('div', 'b-actions');
    actions.append(back, go);
    li.append(text, actions);
    ul.append(li);
  }
  box.append(head, ul);
}

let page: {
  deps: HistoryDeps;
  search: HTMLInputElement;
  summary: HTMLElement;
  list: HTMLElement;
  clear: HTMLButtonElement;
  /** What the list was last drawn from; the same again draws nothing, so focus and scroll stay put. */
  drawn: string;
} | null = null;
let armed = false;
let armTimer = 0;

/** Builds the History page and registers it as the #/history view. Call once. */
export function initHistory(deps: HistoryDeps) {
  const section = el('section');
  section.id = 'history-view';
  section.setAttribute('aria-labelledby', 'history-head');
  const bar = viewBar('History');
  bar.querySelector('h1')!.id = 'history-head';
  const search = el('input');
  search.type = 'search';
  search.placeholder = 'Search';
  search.setAttribute('aria-label', 'Search history');
  search.autocomplete = 'off';
  search.className = 'h-search';
  const summary = el('p', 'h-summary');
  summary.setAttribute('aria-live', 'polite');
  const list = el('div', 'h-list');
  const clear = el('button', 'h-clear', 'Clear all');
  clear.type = 'button';
  clear.setAttribute('aria-live', 'polite');
  section.append(bar, search, summary, list, clear);
  document.body.insertBefore(section, document.getElementById('undo'));
  page = { deps, search, summary, list, clear, drawn: '' };

  search.oninput = () => renderHistory();
  clear.onclick = () => {
    const { store } = deps;
    if (!armed) {
      armed = true;
      clear.textContent = `Tap again to clear ${store.history.length}`;
      clearTimeout(armTimer);
      armTimer = window.setTimeout(() => {
        armed = false;
        clear.textContent = 'Clear all';
      }, 4000);
      return;
    }
    clearTimeout(armTimer);
    armed = false;
    clear.textContent = 'Clear all';
    const before = store.history.slice();
    const done = before.filter(isDone).length;
    store.history.splice(0);
    for (const t of before) store.tombstone(t.id);
    store.settings.doneGone += done;
    store.saveSettings();
    deps.commit();
    deps.undo('History cleared', () => {
      // Anything that burned out since stays, after the records coming back (history is oldest first). Each comes
      // back stamped now, which beats its tombstone; one a sync has meanwhile put back isn't added twice.
      const back = before.filter((t) => !store.history.includes(t)).map((t) => store.stamp(t));
      store.history.splice(0, store.history.length, ...back, ...store.history);
      store.settings.doneGone = Math.max(0, store.settings.doneGone - done);
      store.saveSettings();
      deps.commit();
    });
  };
  registerView('history', section, () => renderHistory(true));
}

/** Redraws the History page if it's on screen (force: even when nothing it shows has changed). */
export function renderHistory(force = false) {
  if (!page || currentView() !== 'history') return;
  const { deps, search, summary, list, clear } = page;
  const { store, zone } = deps;
  const now = Date.now();
  const today = epochDay(now, zone);
  const key = [search.value, today, ...store.history.map((t) => `${t.id}${t.cleared ? 'c' : ''}`)].join('|');
  if (!force && key === page.drawn) return;
  page.drawn = key;

  const shown = searchHistory(store.history, search.value);
  clear.hidden = store.history.length === 0;
  if (armed) clear.textContent = `Tap again to clear ${store.history.length}`;
  if (shown.length === 0) {
    summary.hidden = true;
    const empty = store.history.length === 0
      ? 'Nothing here yet. Tasks land here when their 24 hours are up.'
      : 'Nothing matches.';
    list.replaceChildren(el('p', 'empty', empty));
    return;
  }
  const done = shown.filter(isDone).length;
  summary.hidden = false;
  summary.textContent = `${done} done · ${shown.length - done} burned out`;

  const out: HTMLElement[] = [];
  for (const g of groupByDay(shown, zone)) {
    out.push(el('h2', 'h-day', dayHeading(g.day, today)));
    const ul = el('ul');
    for (const t of g.tasks) ul.append(row(t, deps));
    out.push(ul);
  }
  list.replaceChildren(...out);
}

function row(t: Task, deps: HistoryDeps): HTMLLIElement {
  const { store, zone } = deps;
  const done = isDone(t);
  const li = el('li', 'h-row');
  const text = el('div', 'h-text');
  text.append(el('div', 'title', t.title));
  const status = el('div', 'h-status');
  const dot = el('span', `dot ${done ? 'done' : 'missed'}`);
  dot.setAttribute('aria-hidden', 'true');
  status.append(dot, done ? `Done ${clock(t.doneAt, zone)}` : `Burned out ${clock(t.endedAt, zone)}`);
  text.append(status);
  const note = t.notes.split('\n')[0].trim();
  if (note) text.append(el('div', 'h-notes', note));
  const back = button('Bring back', 'pill', `Bring back: ${t.title}`, () => bringBack(t, deps));
  const del = button('✕', 'delete', `Delete: ${t.title}`, () => {
    const at = store.history.indexOf(t);
    if (at < 0) return;
    store.history.splice(at, 1);
    store.tombstone(t.id);
    if (done) {
      store.settings.doneGone += 1;
      store.saveSettings();
    }
    deps.commit();
    deps.undo(`Deleted "${t.title}"`, () => {
      if (store.history.includes(t)) return;
      store.history.splice(Math.min(at, store.history.length), 0, store.stamp(t));
      if (done) {
        store.settings.doneGone = Math.max(0, store.settings.doneGone - 1);
        store.saveSettings();
      }
      deps.commit();
    });
  });
  const actions = el('div', 'h-actions');
  actions.append(back, del);
  li.append(text, actions);
  return li;
}
