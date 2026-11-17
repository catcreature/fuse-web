// The sync file and its merge: docs/SYNC.md, "The file (format 2)" and "merge(local, remote, now)". Pure and
// deterministic; the Android app implements the same merge, and docs/sync-fixtures/ is the contract both pass.

import { type Task } from '../tasks';
import { readTasks } from '../store';

export interface Tombstone {
  id: number;
  at: number;
}

export interface SyncFile {
  format: 2;
  /** The list, in the user's order. */
  tasks: Task[];
  history: Task[];
  /** The Matchbox. */
  matches: Task[];
  deleted: Tombstone[];
  /** When the list order was last changed by a drag or move; 0 = never. */
  orderAt: number;
  doneGone: number;
}

/** How long a tombstone is kept. */
export const TOMBSTONE_DAYS = 30;
const TOMBSTONE_MS = TOMBSTONE_DAYS * 24 * 60 * 60 * 1000;

export function emptyFile(): SyncFile {
  return { format: 2, tasks: [], history: [], matches: [], deleted: [], orderAt: 0, doneGone: 0 };
}

const isObject = (o: unknown): o is Record<string, unknown> => typeof o === 'object' && o !== null && !Array.isArray(o);

/**
 * A parsed fuse.json: format 2, or the Android app's older fuse.json / backup shape (no format, deleted, orderAt;
 * maybe no matches or doneGone). Missing fields default, a task without updated reads 0, unknown fields are dropped.
 * Throws when it isn't one, or when it's a newer format than this code knows (so its extra data is never dropped by
 * a write).
 */
export function readFile(json: unknown): SyncFile {
  if (!isObject(json)) throw new Error('not a fuse file');
  const format = json.format;
  if (format !== undefined && (typeof format !== 'number' || !Number.isInteger(format) || format < 1)) {
    throw new Error('bad format');
  }
  if (typeof format === 'number' && format > 2) throw new Error(`format ${format} is newer than this app`);
  const deleted = json.deleted === undefined ? [] : json.deleted;
  if (!Array.isArray(deleted)) throw new Error('deleted is not a list');
  const count = (k: string): number => {
    const v = json[k];
    if (v === undefined) return 0;
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`bad ${k}`);
    return v;
  };
  return {
    format: 2,
    tasks: readTasks(json.tasks),
    history: readTasks(json.history),
    matches: json.matches === undefined ? [] : readTasks(json.matches),
    deleted: deleted.map((d) => {
      if (!isObject(d) || typeof d.id !== 'number' || typeof d.at !== 'number') throw new Error('bad tombstone');
      return { id: d.id, at: d.at };
    }),
    orderAt: count('orderAt'),
    doneGone: count('doneGone'),
  };
}

/** A deep copy with the fields in Task's own order: what the merge writes, and the canonical form for sameFile. */
export function copyTask(t: Task): Task {
  return {
    id: t.id, title: t.title, notes: t.notes, priority: t.priority, created: t.created, expires: t.expires,
    extensions: t.extensions, doneAt: t.doneAt, warn: t.warn, remindAt: t.remindAt, warned: t.warned,
    reminded: t.reminded, repeat: t.repeat, snoozeAt: t.snoozeAt, endedAt: t.endedAt, cleared: t.cleared,
    custom: t.custom, updated: t.updated,
  };
}

type Place = 'tasks' | 'history' | 'matches';
/** On a tie in updated: history beats tasks beats matches. */
const RANK: Record<Place, number> = { history: 3, tasks: 2, matches: 1 };

interface Held {
  task: Task;
  place: Place;
}

/** Every record of a side by id. An id twice on one side (never written by the apps) keeps the merge's own winner. */
function byId(f: SyncFile): Map<number, Held> {
  const m = new Map<number, Held>();
  for (const place of ['tasks', 'history', 'matches'] as const) {
    for (const task of f[place]) {
      const had = m.get(task.id);
      if (!had || beats({ task, place }, had)) m.set(task.id, { task, place });
    }
  }
  return m;
}

/** a beats b outright: newer, or as new and in a stronger list. False on a full tie. */
const beats = (a: Held, b: Held) =>
  a.task.updated > b.task.updated || (a.task.updated === b.task.updated && RANK[a.place] > RANK[b.place]);

/**
 * Merges the local data with the file on GitHub (null: no file yet). Never touches its inputs; every record in the
 * result is a fresh copy. Steps as numbered in SYNC.md.
 */
export function merge(local: SyncFile, remote: SyncFile | null, now: number): SyncFile {
  const r = remote ?? emptyFile();

  // 1. Tombstones: union by id, the larger at; those older than 30 days go.
  const dead = new Map<number, number>();
  for (const d of [...local.deleted, ...r.deleted]) dead.set(d.id, Math.max(dead.get(d.id) ?? d.at, d.at));
  const deleted = [...dead.entries()]
    .filter(([, at]) => now - at <= TOMBSTONE_MS)
    .sort(([a], [b]) => a - b)
    .map(([id, at]) => ({ id, at }));
  const killedAt = new Map(deleted.map((d) => [d.id, d.at]));

  // 2-4. Records: the winner of each id, flags its loser already sent folded in, unless a tombstone outlives it.
  const mine = byId(local);
  const theirs = byId(r);
  const won = new Map<number, Held>();
  for (const id of new Set([...mine.keys(), ...theirs.keys()])) {
    const a = mine.get(id);
    const b = theirs.get(id);
    let w: Held;
    if (!a || !b) w = { task: copyTask((a ?? b)!.task), place: (a ?? b)!.place };
    else {
      const [win, lose] = beats(a, b) ? [a, b] : [b, a]; // a full tie: remote wins
      const t = copyTask(win.task);
      if (lose.task.expires === t.expires) t.warned ||= lose.task.warned;
      if (lose.task.remindAt === t.remindAt) t.reminded ||= lose.task.reminded;
      // A due snooze one side has cleared stays cleared: clearing it isn't stamped, so the two are as new.
      if (lose.task.updated === t.updated && lose.task.snoozeAt === 0) t.snoozeAt = 0;
      w = { task: t, place: win.place };
    }
    const at = killedAt.get(id);
    if (at !== undefined && at >= w.task.updated) continue;
    won.set(id, w);
  }

  // 5-6. Order: the side whose order changed last (tie: remote) gives it.
  const [base, other] = local.orderAt > r.orderAt ? [local, r] : [r, local];
  const ordered = (place: 'tasks' | 'matches', newOnTop: boolean): Task[] => {
    const inBase = new Set(base[place].map((t) => t.id));
    const seen = new Set<number>();
    const take = (list: Task[]) => {
      const out: Task[] = [];
      for (const t of list) {
        const w = won.get(t.id);
        if (w && w.place === place && !seen.has(t.id)) {
          seen.add(t.id);
          out.push(w.task);
        }
      }
      return out;
    };
    const kept = take(base[place]);
    const added = take(other[place].filter((t) => !inBase.has(t.id)));
    return newOnTop ? [...added, ...kept] : [...kept, ...added];
  };
  const history = [...won.values()]
    .filter((w) => w.place === 'history')
    .map((w) => w.task)
    .sort((a, b) => a.endedAt - b.endedAt || a.id - b.id);

  return {
    format: 2,
    tasks: ordered('tasks', true),
    history,
    matches: ordered('matches', false),
    deleted,
    orderAt: Math.max(local.orderAt, r.orderAt),
    doneGone: Math.max(local.doneGone, r.doneGone),
  };
}

/** The file as text, fields in a fixed order and tombstones by id: two equal files give the same text. */
export function canonical(f: SyncFile): string {
  return JSON.stringify({
    format: 2,
    tasks: f.tasks.map(copyTask),
    history: f.history.map(copyTask),
    matches: f.matches.map(copyTask),
    deleted: [...f.deleted].sort((a, b) => a.id - b.id || a.at - b.at).map((d) => ({ id: d.id, at: d.at })),
    orderAt: f.orderAt,
    doneGone: f.doneGone,
  });
}

/** Whether two files hold the same data (list order counts, key order doesn't): if merged equals remote, no PUT. */
export const sameFile = (a: SyncFile, b: SyncFile) => canonical(a) === canonical(b);
