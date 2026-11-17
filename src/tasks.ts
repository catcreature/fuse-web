// The model and all the pure logic: a line-for-line port of the Android app's Tasks.kt (fuse 0.38.2).
// A fix here likely belongs there too, and the other way round. test/tasks.test.ts is TasksTest.kt ported.
// Where it now differs, for sync (docs/SYNC.md; the Android side gets the same change): Task.updated, revived()
// stamps it, and sweep() gives a repeating task's next copy a predictable id (repeatStart + freeId), not newId().

import { DAY, HOUR, MINUTE, type Zone, dayOfWeek, epoch, epochDay, local } from './time';

export { HOUR, MINUTE };
/** How long a task gets from the moment it's added, unless Custom is picked when adding it. */
export const LIFE = 24 * HOUR;
/** The range a custom length can take. */
export const MIN_LENGTH = 5 * MINUTE;
export const MAX_LENGTH = 7 * LIFE;
/** Strict 24 h (Settings): one extension and no Custom length. */
export const Strict = { on: false };
export const maxExtensions = () => (Strict.on ? 1 : 3);
export const EXTEND_HOURS = [1, 3, 6, 12, 24];
/** Minutes before a task burns out to warn; 0 = no warning. */
export const WARN_CHOICES = [0, 15, 30, 60, 120, 180, 360];
export const DEFAULT_WARN = 60;
/** Days history keeps a task; 0 = forever. */
export const KEEP_CHOICES = [7, 30, 90, 365, 0];
export const DEFAULT_KEEP = 30;
export const SNOOZE = 15 * MINUTE;
/** Focus round lengths in minutes; the last one picked is remembered. */
export const ROUND_CHOICES = [10, 25, 45, 60];
export const DEFAULT_ROUND = 25;

export const LOW = 0;
export const NORMAL = 1;
export const HIGH = 2;

/** One task: on the list while endedAt is 0, in history after. Times are epoch ms. */
export interface Task {
  id: number;
  title: string;
  notes: string;
  priority: number;
  created: number;
  expires: number;
  extensions: number;
  /** When it was ticked; 0 = open. */
  doneAt: number;
  /** Minutes before expires to warn; -1 = the app's default, 0 = never. */
  warn: number;
  /** A reminder time the user picked; 0 = none. */
  remindAt: number;
  warned: boolean;
  reminded: boolean;
  /** Comes back by itself with a fresh 24 hours each time it ends. */
  repeat: boolean;
  /** A one-off nudge from an alert's Snooze; 0 = none. */
  snoozeAt: number;
  endedAt: number;
  /** A missed task brought back or dismissed from the list's "Burned out recently" strip. */
  cleared: boolean;
  /** Its length was picked when it was added instead of the usual 24 hours. It can't repeat. */
  custom: boolean;
  /** Sync: when the user last changed it (time's own doings don't count); the newer copy wins. 0 = never stamped. */
  updated: number;
}

export function newTask(id: number, title: string, created: number, over: Partial<Task> = {}): Task {
  return {
    id, title, notes: '', priority: NORMAL, created, expires: created + LIFE, extensions: 0, doneAt: 0, warn: -1,
    remindAt: 0, warned: false, reminded: false, repeat: false, snoozeAt: 0, endedAt: 0, cleared: false, custom: false,
    updated: 0, ...over,
  };
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
/** Kotlin's `x in 1..now`. */
const dueBy = (x: number, now: number) => x >= 1 && x <= now;

export const isDone = (t: Task) => t.doneAt > 0;

/** Share of its time still to burn, 0..1. A ticked task's stops where it was saved: that's where its gold seam sits. */
export function burnLeft(t: Task, now: number): number {
  return clamp((t.expires - (isDone(t) ? t.doneAt : now)) / (t.expires - t.created), 0, 1);
}

/** When the warning is due, or 0 for none. */
export function warnAt(t: Task, defaultWarn: number): number {
  const m = t.warn < 0 ? defaultWarn : t.warn;
  return m === 0 ? 0 : t.expires - m * MINUTE;
}

/** In its last stretch: open, past its warning time, not yet burned out. */
export const lastCall = (t: Task, now: number, defaultWarn: number) =>
  !isDone(t) && dueBy(warnAt(t, defaultWarn), now) && t.expires > now;

export const warningDue = (t: Task, now: number, defaultWarn: number) =>
  !isDone(t) && !t.warned && dueBy(warnAt(t, defaultWarn), now);
export const reminderDue = (t: Task, now: number) => !isDone(t) && !t.reminded && dueBy(t.remindAt, now);
export const snoozeDue = (t: Task, now: number) => !isDone(t) && dueBy(t.snoozeAt, now);

/** After the clock or the warning time changes: a warning time already past is skipped, not sent late. */
export function rearm(t: Task, now: number, defaultWarn: number) {
  t.warned = warnAt(t, defaultWarn) <= now;
}

export function extend(t: Task, hours: number, now: number, defaultWarn: number) {
  if (t.extensions >= maxExtensions()) throw new Error('no extensions left');
  t.expires += hours * HOUR;
  t.extensions++;
  rearm(t, now, defaultWarn);
}

/**
 * A copy back on the list from history: a fresh 24 hours (even after a custom length) and fresh extensions. It doesn't
 * repeat. Bringing back is the user's doing, so the copy is stamped updated = now.
 */
export function revived(t: Task, newId: number, now: number): Task {
  return {
    ...t, id: newId, created: now, expires: now + LIFE, extensions: 0, doneAt: 0, remindAt: 0, warned: false,
    reminded: false, repeat: false, snoozeAt: 0, endedAt: 0, cleared: false, custom: false, updated: now,
  };
}

/** When the next copy of a repeating task that ended starts: see nextDay. */
export const repeatStart = (t: Task, now: number) => t.expires + Math.trunc((now - t.expires) / LIFE) * LIFE;

/** The first id from start up that taken doesn't hold: a repeating task's next copy gets the same id on every device. */
export function freeId(start: number, taken: ReadonlySet<number>): number {
  let id = start;
  while (taken.has(id)) id++;
  return id;
}

/**
 * The next copy of a repeating task that just ended. It starts when this one ended, or, after days with the
 * app closed, at the latest such 24-hour step not yet over. A reminder keeps its place in the day. The copy keeps
 * the old record's updated: it's time's doing, not the user's.
 */
export function nextDay(t: Task, newId: number, now: number): Task {
  const start = repeatStart(t, now);
  const remind = t.remindAt > 0 ? start + (t.remindAt - t.created) : 0;
  return {
    ...t, id: newId, created: start, expires: start + LIFE, extensions: 0, doneAt: 0, remindAt: remind,
    warned: false, reminded: dueBy(remind, now), snoozeAt: 0, endedAt: 0,
  };
}

/**
 * Moves every task whose time is up into history (a repeating one is replaced in place by its next copy) and drops
 * history older than keepDays (0 = keep), telling gone how many of those dropped were done (Ember counts them for
 * good). True if anything changed.
 *
 * Sync (SYNC.md, "Repeating tasks get a predictable id"): the next copy's id is its start, or the first id above it
 * not held by any task in tasks, history or matches (pass the Matchbox). Ids are handed out in old-id order, so two
 * devices holding the list in different orders still agree. _newId is no longer used (it was the copy's id before
 * sync); it stays only so existing callers compile until they drop it.
 */
export function sweep(
  tasks: Task[], history: Task[], now: number, keepDays: number, _newId?: () => number,
  gone: (n: number) => void = () => {}, matches: readonly Task[] = [],
): boolean {
  let changed = false;
  const taken = new Set([...tasks, ...history, ...matches].map((t) => t.id));
  const ids = new Map<Task, number>();
  for (const t of tasks.filter((t) => t.expires <= now && t.repeat).sort((a, b) => a.id - b.id)) {
    const id = freeId(repeatStart(t, now), taken);
    taken.add(id);
    ids.set(t, id);
  }
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    if (t.expires > now) continue;
    t.endedAt = t.expires;
    history.push(t);
    if (t.repeat) tasks[i] = nextDay(t, ids.get(t)!, now);
    else tasks.splice(i--, 1);
    changed = true;
  }
  if (keepDays > 0) {
    const cut = now - keepDays * 24 * HOUR;
    const lost = history.filter((t) => t.endedAt < cut && isDone(t)).length;
    if (lost > 0) gone(lost);
    const kept = history.filter((t) => t.endedAt >= cut);
    if (kept.length !== history.length) {
      history.splice(0, history.length, ...kept);
      changed = true;
    }
  }
  return changed;
}

/** The next moment anything is due: a task burns out, a warning, a reminder or a snooze. 0 = nothing on the list. */
export function nextEvent(tasks: Task[], defaultWarn: number): number {
  let min = 0;
  const take = (x: number) => {
    if (x > 0 && (min === 0 || x < min)) min = x;
  };
  for (const t of tasks) {
    take(t.expires);
    if (isDone(t)) continue;
    if (!t.warned) take(warnAt(t, defaultWarn));
    if (!t.reminded) take(t.remindAt);
    take(t.snoozeAt);
  }
  return min;
}

export type Sort = 'MINE' | 'EXPIRING' | 'PRIORITY' | 'NEWEST' | 'OLDEST';
export const SORTS: Sort[] = ['MINE', 'EXPIRING', 'PRIORITY', 'NEWEST', 'OLDEST'];

/** Done tasks sit under the open ones in every order; MINE keeps the list's own (dragged) order. */
export function sorted(tasks: Task[], sort: Sort): Task[] {
  const by: Record<Sort, (a: Task, b: Task) => number> = {
    MINE: () => 0,
    EXPIRING: (a, b) => a.expires - b.expires,
    PRIORITY: (a, b) => b.priority - a.priority || a.expires - b.expires,
    NEWEST: (a, b) => b.created - a.created,
    OLDEST: (a, b) => a.created - b.created,
  };
  // Array.sort is stable, so MINE keeps the given order.
  return [...tasks].sort((a, b) => Number(isDone(a)) - Number(isDone(b)) || by[sort](a, b));
}

/** What the quick-add bar read from a line: "Call mom at 5pm !" is "Call mom", high, a reminder at 17:00. */
export interface Quick {
  title: string;
  high: boolean;
  /** -1 = no clock time. */
  hour: number;
  minute: number;
  /** null = no am/pm given. */
  pm: boolean | null;
  inMs: number;
}

/** The reminder time, or 0 for none. "at 5" with no am/pm means whichever 5 o'clock comes first. */
export function quickRemindAt(q: Quick, now: number, zone: Zone): number {
  if (q.inMs > 0) return now + q.inMs;
  if (q.hour < 0) return 0;
  if (q.pm !== null) return nextTime((q.hour % 12) + (q.pm ? 12 : 0), q.minute, now, zone);
  if (q.hour >= 1 && q.hour <= 11) {
    return Math.min(nextTime(q.hour, q.minute, now, zone), nextTime(q.hour + 12, q.minute, now, zone));
  }
  return nextTime(q.hour, q.minute, now, zone);
}

const BANG = /(?:^|\s)!+(?=\s|$)/;
// "Morning walk" stays a title: morning / afternoon / evening need "this" or "in the" in front.
const WORD = /(?:^|\s)(?:(?:at\s+)?(noon|midday)|(tonight)|(?:this|in\s+the)\s+(morning|afternoon|evening))(?=\s|$|[,.!?])/i;
const AT = /(?:^|\s)(?:at\s+|@\s*)(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?(?=\s|$|[,.!?])/i;
const IN = /(?:^|\s)in\s+(\d{1,3})\s*(minutes?|mins?|m|hours?|hrs?|h)(?=\s|$|[,.!?])/i;

const cut = (s: string, m: RegExpExecArray) => s.slice(0, m.index) + s.slice(m.index + m[0].length);

export function parseQuick(text: string): Quick {
  let s = text;
  let high = false;
  let hour = -1;
  let minute = 0;
  let pm: boolean | null = null;
  let inMs = 0;
  let m = BANG.exec(s);
  if (m) {
    high = true;
    s = cut(s, m);
  }
  m = AT.exec(s);
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2] ?? '0');
    const ampm = (m[3] ?? '').toLowerCase();
    if (min < 60 && (ampm === '' ? h < 24 : h >= 1 && h <= 12)) {
      hour = h;
      minute = min;
      pm = ampm === '' ? null : ampm === 'pm';
      s = cut(s, m);
    }
  }
  if (hour < 0 && (m = WORD.exec(s))) {
    const word = (m[1] ?? m[2] ?? m[3]).toLowerCase();
    hour = word === 'morning' ? 9 : word === 'afternoon' ? 3 : word === 'evening' ? 6 : word === 'tonight' ? 8 : 12;
    pm = word !== 'morning';
    s = cut(s, m);
  }
  if (hour < 0 && (m = IN.exec(s))) {
    const n = Number(m[1]);
    const ms = n * (m[2].toLowerCase().startsWith('h') ? HOUR : MINUTE);
    if (n > 0 && ms < LIFE) {
      inMs = ms;
      s = cut(s, m);
    }
  }
  return { title: s.replace(/\s+/g, ' ').trim() || text.trim(), high, hour, minute, pm, inMs };
}

export interface DayCount {
  /** Epoch day. */
  day: number;
  done: number;
  missed: number;
}

/** Done (by the day it was ticked) and missed (by the day it burned out) for each of the last days days, today first. */
export function dailyCounts(all: Task[], today: number, zone: Zone, days: number): DayCount[] {
  const done = new Map<number, number>();
  const missed = new Map<number, number>();
  const bump = (m: Map<number, number>, t: number) => {
    const d = epochDay(t, zone);
    m.set(d, (m.get(d) ?? 0) + 1);
  };
  for (const t of all) {
    if (isDone(t)) bump(done, t.doneAt);
    else if (t.endedAt > 0) bump(missed, t.endedAt);
  }
  return Array.from({ length: days }, (_, i) => today - i).map((day) => ({
    day, done: done.get(day) ?? 0, missed: missed.get(day) ?? 0,
  }));
}

/**
 * Current and best streak: days in a row with something done and nothing missed. days is today first. Today
 * doesn't break the current streak while it has nothing yet, done or missed.
 */
export function streaks(days: DayCount[]): [number, number] {
  const good = (d: DayCount) => d.done > 0 && d.missed === 0;
  let best = 0;
  let run = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    run = good(days[i]) ? run + 1 : 0;
    best = Math.max(best, run);
  }
  const open = days.length > 0 && days[0].done === 0 && days[0].missed === 0;
  let current = 0;
  for (let i = open ? 1 : 0; i < days.length && good(days[i]); i++) current++;
  return [current, best];
}

export function minuteOfDay(t: number, zone: Zone): number {
  const l = local(t, zone);
  return l.hour * 60 + l.minute;
}

/** Inside quiet hours start..end (minutes of the day; a span past midnight wraps). */
export function quiet(now: number, zone: Zone, start: number, end: number): boolean {
  const m = minuteOfDay(now, zone);
  return start <= end ? m >= start && m < end : m >= start || m < end;
}

/**
 * A daily summary set for at (minute of the day) is due once that time has come today, unless today's was already
 * sent (lastDay, an epoch day) or it's more than 3 hours late (the app was closed): stale news isn't sent.
 */
export function summaryDue(now: number, zone: Zone, at: number, lastDay: number): boolean {
  const today = epochDay(now, zone);
  const time = epoch(today, Math.floor(at / 60), at % 60, zone);
  return lastDay !== today && now >= time && now < time + 3 * HOUR;
}

/** The next time the clock shows hour:minute after now: today, or tomorrow if that's passed. */
export function nextTime(hour: number, minute: number, now: number, zone: Zone): number {
  const day = epochDay(now, zone);
  const at = epoch(day, hour, minute, zone);
  return at > now ? at : epoch(day + 1, hour, minute, zone);
}

/** "2 d 3 h" (over 24 h), "5 h 12 m", "45 m": rounded up, so it never shows 0 m while time is left. */
export function hm(ms: number): string {
  const m = Math.floor((Math.max(ms, 0) + MINUTE - 1) / MINUTE);
  if (m > 24 * 60) return `${Math.floor(m / (24 * 60))} d ${Math.floor((m % (24 * 60)) / 60)} h`;
  if (m >= 60) return `${Math.floor(m / 60)} h ${m % 60} m`;
  return `${m} m`;
}

/** A focus round of minutes lit at now ends then, or when the task itself burns out, whichever is first. */
export const roundEnd = (t: Task, minutes: number, now: number) => Math.min(now + minutes * MINUTE, t.expires);

/** A countdown: "24:59", "1:00:00". Rounded up, so it shows 0:00 only once time is up. */
export function mmss(ms: number): string {
  const s = Math.floor((Math.max(ms, 0) + 999) / 1000);
  const two = (n: number) => String(n).padStart(2, '0');
  return s >= 3600
    ? `${Math.floor(s / 3600)}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`
    : `${Math.floor(s / 60)}:${two(s % 60)}`;
}

/** Mixes two 0xAARRGGBB colours: t = 0 is a, 1 is b. */
export function mix(a: number, b: number, t: number): number {
  const f = clamp(t, 0, 1);
  const ch = (shift: number) => {
    const x = (a >>> shift) & 0xff;
    const y = (b >>> shift) & 0xff;
    return Math.trunc(x + (y - x) * f) << shift;
  };
  return (ch(24) | ch(16) | ch(8) | ch(0)) >>> 0;
}

/** The fuse's colour by the share of time left: fresh when new, amber halfway, red at the end. */
export const fuseColor = (left: number, fresh: number, amber: number, red: number) =>
  left >= 0.5 ? mix(amber, fresh, (left - 0.5) * 2) : mix(red, amber, left * 2);

/** A 0xAARRGGBB colour as CSS. */
export function css(argb: number): string {
  const a = ((argb >>> 24) & 0xff) / 255;
  return `rgba(${(argb >>> 16) & 0xff}, ${(argb >>> 8) & 0xff}, ${argb & 0xff}, ${a.toFixed(3)})`;
}

/** Open tasks with no reminder still to ring, soonest to burn out first: the cards Plan my day deals. */
export const unplanned = (tasks: Task[], now: number) =>
  tasks
    .filter((t) => !isDone(t) && t.expires > now && !(t.remindAt > now && !t.reminded))
    .sort((a, b) => a.expires - b.expires);

/** The day's usual times to get something done, as hours: what Plan my day offers after the next whole hour. */
const ANCHORS = [9, 12, 15, 18, 20];

/**
 * Up to three times to suggest for doing t: the first whole hour at least 30 minutes away, then the next of 9:00,
 * noon, 15:00, 18:00 and 20:00, each at least 90 minutes after the one before, all before the task's last 15 minutes.
 */
export function slots(t: Task, now: number, zone: Zone): number[] {
  const z = now + 30 * MINUTE;
  const l = local(z, zone);
  const hourStart = epoch(l.day, l.hour, 0, zone);
  const soon = hourStart < z ? hourStart + HOUR : hourStart;
  const out: number[] = [];
  const anchors = ANCHORS.map((h) => nextTime(h, 0, now, zone)).sort((a, b) => a - b);
  for (const at of [soon, ...anchors]) {
    if (at < t.expires - 15 * MINUTE && (out.length === 0 || at >= out[out.length - 1] + 90 * MINUTE)) out.push(at);
    if (out.length === 3) break;
  }
  return out;
}

/** What was ticked on day, on the list or in history, first done first: the logs for that day's bonfire. */
export const doneOn = (all: Task[], day: number, zone: Zone) =>
  all.filter((t) => isDone(t) && epochDay(t.doneAt, zone) === day).sort((a, b) => a.doneAt - b.doneAt);

/** How long a chain stays lit after a task is done: finish another inside it and the chain grows. */
export const CHAIN_WINDOW = 30 * MINUTE;

/**
 * The chain burning at now: tasks done one after another, each within CHAIN_WINDOW of the one before, the last
 * within it of now. Its length and when it goes out; [0, 0] when there's none. Read from the done times alone, so
 * an undone tick takes its link back.
 */
export function chain(all: Task[], now: number): [number, number] {
  const times = all.filter((t) => isDone(t) && t.doneAt <= now).map((t) => t.doneAt).sort((a, b) => b - a);
  if (times.length === 0 || now - times[0] > CHAIN_WINDOW) return [0, 0];
  let n = 1;
  while (n < times.length && times[n - 1] - times[n] <= CHAIN_WINDOW) n++;
  return [n, times[0] + CHAIN_WINDOW];
}

/**
 * Pick for me: one of open at random, weighted by priority (low 1, normal 2, high 4) times urgency (1 when fresh up
 * to 4 as its time runs out), so what matters and what's burning down come up most, but anything can.
 * rnd gives a number in [0, 1), like Math.random.
 */
export function pick(open: Task[], now: number, rnd: () => number = Math.random): Task | null {
  if (open.length === 0) return null;
  const weight = (t: Task) => {
    const used = 1 - clamp((t.expires - now) / Math.max(t.expires - t.created, 1), 0, 1);
    return (t.priority === HIGH ? 4 : t.priority === LOW ? 1 : 2) * (1 + 3 * used);
  };
  const weights = open.map(weight);
  let r = rnd() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < open.length; i++) {
    r -= weights[i];
    if (r < 0) return open[i];
  }
  return open[open.length - 1];
}

/** A list marker at the start of a pasted line: "- ", "* ", "• ", "1. ", "2) ", "[ ] ", "- [x] ". */
const MARKER = /^\s*(?:[-*•·–]\s+)?(?:\[[ xX]?\]\s*)?(?:\d{1,3}[.)]\s+)?/;

/**
 * Empty your head's input: every finished line of text (up to its last line break) as a task title, list markers
 * and blank lines dropped, and what's still being typed after the last break.
 */
export function dumpLines(text: string): [string[], string] {
  const at = text.lastIndexOf('\n');
  if (at < 0) return [[], text];
  const lines = text.slice(0, at).split('\n').map((l) => l.replace(MARKER, '').trim()).filter((l) => l !== '');
  return [lines, text.slice(at + 1)];
}

/** How Ember, the flame on the top card, feels. */
export type Mood = 'SLEEPY' | 'WORRIED' | 'SAD' | 'HAPPY' | 'CALM';

/**
 * Ember's mood: asleep in quiet hours; worried while an open task is in its last call; sad when more burned out today
 * than got done; happy once something's done; calm otherwise.
 */
export function mood(today: DayCount, open: Task[], now: number, defaultWarn: number, quietNow: boolean): Mood {
  if (quietNow) return 'SLEEPY';
  if (open.some((t) => lastCall(t, now, defaultWarn))) return 'WORRIED';
  if (today.missed > today.done) return 'SAD';
  if (today.done > 0) return 'HAPPY';
  return 'CALM';
}

/** The week's recap: days oldest first (today last), its brightest day, the hour most got done (-1: none) and the longest chain. */
export interface WeekReport {
  days: DayCount[];
  done: number;
  missed: number;
  best: DayCount | null;
  hour: number;
  chain: number;
}

/** Your week: the 7 days up to today, from everything done or burned out in all. */
export function weekReport(all: Task[], today: number, zone: Zone): WeekReport {
  const days = dailyCounts(all, today, zone, 7).reverse();
  const from = epoch(today - 6, 0, 0, zone);
  const times = all.filter((t) => isDone(t) && t.doneAt >= from).map((t) => t.doneAt).sort((a, b) => a - b);
  // The busiest hour; a tie goes to the earlier one.
  const perHour = new Array<number>(24).fill(0);
  for (const t of times) perHour[local(t, zone).hour]++;
  let hour = -1;
  perHour.forEach((n, h) => {
    if (n > 0 && (hour < 0 || n > perHour[hour])) hour = h;
  });
  let longest = 0;
  let run = 0;
  times.forEach((t, i) => {
    run = i > 0 && t - times[i - 1] <= CHAIN_WINDOW ? run + 1 : 1;
    longest = Math.max(longest, run);
  });
  // A tie goes to the later day: the more recent memory.
  let best: DayCount | null = null;
  for (const d of days) if (d.done > 0 && (!best || d.done >= best.done)) best = d;
  return {
    days, done: days.reduce((n, d) => n + d.done, 0), missed: days.reduce((n, d) => n + d.missed, 0), best, hour,
    chain: longest,
  };
}

/** When the weekly recap is sent: Sundays at this minute of the day. */
export const WEEKLY_AT = 19 * 60;

/** The next Sunday WEEKLY_AT after now. */
export function nextWeekly(now: number, zone: Zone): number {
  for (let d = epochDay(now, zone); ; d++) {
    const at = epoch(d, Math.floor(WEEKLY_AT / 60), WEEKLY_AT % 60, zone);
    if (dayOfWeek(d) === 0 && at > now) return at;
  }
}

/** Tasks ever done at which Ember becomes a Spark, a Flame, a Blaze, a Bonfire and a Phoenix. */
export const STAGE_AT = [0, 10, 50, 150, 400];

/** Ember's form for doneEver tasks done: 0 (Spark) to 4 (Phoenix). */
export const stageOf = (doneEver: number) => STAGE_AT.reduce((at, n, i) => (doneEver >= n ? i : at), -1);

export { DAY };
