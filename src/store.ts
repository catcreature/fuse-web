// The list, history and Matchbox, held in memory and written whole on every change: the Android app's Store.kt,
// with the browser's localStorage in place of files/fuse.json and SharedPreferences.
// The saved JSON is the sync file (format 2, docs/SYNC.md, src/sync/merge.ts): a superset of the Android app's
// fuse.json and backup file, so a backup made by either restores in the other, and older saves still load.

import { DEFAULT_KEEP, DEFAULT_WARN, NORMAL, type Task, isDone } from './tasks';
import { type SyncFile, type Tombstone, canonical, copyTask, readFile } from './sync/merge';

/** The part of localStorage the store needs; tests pass a Map-backed one. */
export interface Box {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const DATA = 'fuse.json';
const SETTINGS = 'fuse.settings';

export interface Settings {
  /** Minutes before burn-out to warn by default; 0 = never. */
  warn: number;
  /** Days history is kept; 0 = forever. */
  keep: number;
  /** Done tasks history has since let go: Ember never shrinks for a tidy history. */
  doneGone: number;
  /** The newest What's new entry dismissed; '' = none yet. */
  seenNotes: string;
  welcomed: boolean;
  /** 'system' follows the device. */
  theme: 'system' | 'light' | 'dark';
  /** 0..4: Ember, Ocean, Forest, Grape, Rose. */
  accent: number;
  /** Quiet hours: alerts in quietStart..quietEnd (minutes of the day) show only on the page. */
  quiet: boolean;
  quietStart: number;
  quietEnd: number;
  /** Strict 24 h: one extension, no custom lengths. */
  strict: boolean;
  /** Calm mode: no animations. */
  calm: boolean;
}

const DEFAULTS: Settings = {
  warn: DEFAULT_WARN, keep: DEFAULT_KEEP, doneGone: 0, seenNotes: '', welcomed: false,
  theme: 'system', accent: 0, quiet: true, quietStart: 23 * 60, quietEnd: 7 * 60, strict: false, calm: false,
};

export class Store {
  // shortcut: the whole list is rewritten on every change, and localStorage holds about 5 MB (some 20,000 tasks);
  // move to IndexedDB if "keep forever" ever fills it.
  tasks: Task[] = [];
  history: Task[] = [];
  /** The Matchbox: unlit tasks kept for later; nothing about them burns until one is struck. */
  matches: Task[] = [];
  /** Sync tombstones: what was deleted here, and when (docs/SYNC.md). */
  deleted: Tombstone[] = [];
  /** When the user last reordered the list (drag or keyboard move); 0 = never. */
  orderAt = 0;
  settings: Settings = { ...DEFAULTS };
  /** The page on screen, told after every save. */
  onChange: (() => void) | null = null;

  constructor(private box: Box, private clock: () => number = Date.now) {
    try {
      this.settings = { ...DEFAULTS, ...JSON.parse(box.getItem(SETTINGS) ?? '{}') };
    } catch {
      // Unreadable settings: start from the defaults.
    }
    const text = box.getItem(DATA);
    if (text === null) return;
    try {
      const f = readFile(JSON.parse(text));
      this.load(f);
      // doneGone lives in settings too; a save from before format 2 has none in the file.
      this.settings.doneGone = Math.max(this.settings.doneGone, f.doneGone);
    } catch {
      // Never let the next save overwrite data that couldn't be read: set it aside first.
      box.setItem(`fuse-unreadable-${clock()}.json`, text);
    }
  }

  private load(f: SyncFile) {
    this.tasks = f.tasks;
    this.history = f.history;
    this.matches = f.matches;
    this.deleted = f.deleted;
    this.orderAt = f.orderAt;
  }

  /** Throws if the browser refuses the write (storage full or blocked): the caller must tell the user. */
  save() {
    this.box.setItem(DATA, canonical(this.snapshot()));
    this.onChange?.();
  }

  saveSettings() {
    this.box.setItem(SETTINGS, JSON.stringify(this.settings));
  }

  /** Marks t as changed by the user now: the newer copy wins a sync. */
  stamp(t: Task): Task {
    t.updated = this.clock();
    return t;
  }

  /** Records that the record id was deleted now, so a sync deletes it everywhere. */
  tombstone(id: number) {
    const at = this.clock();
    const had = this.deleted.find((d) => d.id === id);
    if (had) had.at = Math.max(had.at, at);
    else this.deleted.push({ id, at });
  }

  /** The user reordered the list now. */
  touchOrder() {
    this.orderAt = this.clock();
  }

  /** Everything as a sync file: fresh copies, so later changes here don't reach it. */
  snapshot(): SyncFile {
    return {
      format: 2,
      tasks: this.tasks.map(copyTask),
      history: this.history.map(copyTask),
      matches: this.matches.map(copyTask),
      deleted: this.deleted.map((d) => ({ id: d.id, at: d.at })),
      orderAt: this.orderAt,
      doneGone: this.settings.doneGone,
    };
  }

  /**
   * Makes file the data here (a sync's result) and saves it, without telling onChange: the caller redraws. A record
   * already held keeps its object (its fields are overwritten), so an open editor or a pending undo still holds it.
   * Throws like save().
   */
  replace(file: SyncFile) {
    const held = new Map<number, Task>();
    for (const t of [...this.tasks, ...this.history, ...this.matches]) held.set(t.id, t);
    const keep = (list: Task[]) => list.map((t) => {
      const mine = held.get(t.id);
      return mine ? Object.assign(mine, copyTask(t)) : copyTask(t);
    });
    const tasks = keep(file.tasks);
    const history = keep(file.history);
    const matches = keep(file.matches);
    this.tasks.splice(0, this.tasks.length, ...tasks);
    this.history.splice(0, this.history.length, ...history);
    this.matches.splice(0, this.matches.length, ...matches);
    this.deleted = file.deleted.map((d) => ({ id: d.id, at: d.at }));
    this.orderAt = file.orderAt;
    this.settings.doneGone = file.doneGone;
    this.saveSettings();
    this.box.setItem(DATA, canonical(this.snapshot()));
  }

  /** The whole list, history and Matchbox as the text of a backup file: the sync file (format 2). */
  backupText(): string {
    return canonical(this.snapshot());
  }

  /**
   * Replaces everything with a backup's contents (the Android app's backup or fuse.json, any age, or this format);
   * false (and nothing touched) when the text isn't one. Restoring is the user's doing: every record is stamped now,
   * so it beats older copies and tombstones on the next sync. Tombstones already here stay.
   */
  restore(text: string): boolean {
    let f: SyncFile;
    try {
      f = readFile(JSON.parse(text));
    } catch {
      return false;
    }
    for (const t of [...f.tasks, ...f.history, ...f.matches]) this.stamp(t);
    const dead = new Map(this.deleted.map((d) => [d.id, d.at]));
    for (const d of f.deleted) dead.set(d.id, Math.max(dead.get(d.id) ?? d.at, d.at));
    this.load({ ...f, deleted: [...dead].map(([id, at]) => ({ id, at })) });
    this.settings.doneGone = f.doneGone;
    this.saveSettings();
    return true;
  }

  newId(): number {
    let max = 0;
    for (const t of [...this.tasks, ...this.history, ...this.matches]) max = Math.max(max, t.id + 1);
    return Math.max(this.clock(), max);
  }

  /** Tasks ever done: those on the list or in history, and those history has let go. */
  doneEver(): number {
    return this.settings.doneGone + this.history.filter(isDone).length + this.tasks.filter(isDone).length;
  }
}

// Defaults for the fields older files lack (repeat, snoozeAt: 0.2.0; cleared: 0.3.0; custom: 0.4.0 of the Android app;
// updated: sync, docs/SYNC.md). Unknown fields are dropped. Also the sync file's reader (src/sync/merge.ts).
export function readTasks(a: unknown): Task[] {
  if (!Array.isArray(a)) throw new Error('not a list');
  return a.map((o) => {
    const need = (k: string, type: string) => {
      if (typeof o?.[k] !== type) throw new Error(`task without ${k}`);
      return o[k];
    };
    const num = (k: string, or = 0): number => (typeof o[k] === 'number' ? o[k] : or);
    const flag = (k: string): boolean => o[k] === true;
    return {
      id: need('id', 'number'), title: need('title', 'string'), notes: typeof o.notes === 'string' ? o.notes : '',
      priority: num('priority', NORMAL), created: need('created', 'number'), expires: need('expires', 'number'),
      extensions: num('extensions'), doneAt: num('doneAt'), warn: num('warn', -1), remindAt: num('remindAt'),
      warned: flag('warned'), reminded: flag('reminded'), repeat: flag('repeat'), snoozeAt: num('snoozeAt'),
      endedAt: num('endedAt'), cleared: flag('cleared'), custom: flag('custom'), updated: num('updated'),
    };
  });
}
