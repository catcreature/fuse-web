// TasksTest.kt from the Android app, test for test, in the same order.
import { expect, test } from 'vitest';
import {
  CHAIN_WINDOW, HIGH, HOUR, LIFE, LOW, MAX_LENGTH, MINUTE, SNOOZE, SORTS, type DayCount, type Task, burnLeft, chain,
  dailyCounts, doneOn, dumpLines, extend, fuseColor, hm, isDone, lastCall, mix, mmss, mood, newTask, nextEvent,
  nextTime, nextWeekly, parseQuick, pick, quickRemindAt, quiet, reminderDue, revived, roundEnd, slots, snoozeDue,
  sorted, stageOf, streaks, summaryDue, sweep, unplanned, warnAt, warningDue, weekReport,
} from '../src/tasks';
import { dayOf, epoch } from '../src/time';
import { WHATS_NEW, whatsNew } from '../src/whatsnew';

const now = 1_800_000_000_000;
const task = (id: number, created = now - HOUR, over: Partial<Task> = {}) => newTask(id, `t${id}`, created, over);
let lastId = 100;
const ids = () => ++lastId;
const india = 'Asia/Kolkata';
const NOV2 = dayOf(2026, 11, 2);
const at = (h: number, m = 0) => epoch(NOV2, h, m, india);
const remind = (text: string, n: number) => quickRemindAt(parseQuick(text), n, india);
const idsOf = (ts: Task[]) => ts.map((t) => t.id);

test('the zone maths agrees with a known instant', () => {
  expect(at(14)).toBe(Date.UTC(2026, 10, 2, 8, 30)); // 14:00 IST is 08:30 UTC
  // Across a clock change: New York went back to standard time on 2026-11-01, so noon that day is 17:00 UTC.
  expect(epoch(dayOf(2026, 11, 1), 12, 0, 'America/New_York')).toBe(Date.UTC(2026, 10, 1, 17, 0));
  expect(epoch(dayOf(2026, 10, 31), 12, 0, 'America/New_York')).toBe(Date.UTC(2026, 9, 31, 16, 0));
});

test('repeating task comes back in its place with a fresh 24 hours', () => {
  lastId = 100;
  const r = task(1, now - LIFE, { repeat: true, doneAt: now - HOUR, remindAt: now - LIFE + 8 * HOUR, extensions: 2 });
  const tasks = [task(2), r, task(3)];
  const history: Task[] = [];
  expect(sweep(tasks, history, now, 30, ids)).toBe(true);
  expect(idsOf(history)).toEqual([1]);
  expect(isDone(history[0])).toBe(true);
  const next = tasks[1];
  expect(idsOf(tasks)).toEqual([2, now, 3]); // sync: the copy's id is its start (SYNC.md), no longer newId()
  expect(next.created).toBe(now);
  expect(next.expires).toBe(now + LIFE);
  expect(next.repeat && !isDone(next) && next.extensions === 0).toBe(true);
  expect(next.remindAt).toBe(now + 8 * HOUR); // the same time of day
  expect(next.reminded).toBe(false);
});

test('repeating task after days off starts in the current day', () => {
  const tasks = [task(1, now - 4 * LIFE - HOUR, { repeat: true })];
  sweep(tasks, [], now, 30, ids);
  expect(tasks[0].created).toBe(now - HOUR);
  expect(tasks[0].expires).toBeGreaterThan(now);
});

test('revived task does not repeat', () => {
  expect(revived(task(1, undefined, { repeat: true }), 2, now).repeat).toBe(false);
});

test('snooze is an event and due once', () => {
  const t = task(1, undefined, { warned: true, snoozeAt: now + SNOOZE });
  expect(nextEvent([t], 60)).toBe(now + SNOOZE);
  expect(snoozeDue(t, now)).toBe(false);
  expect(snoozeDue(t, now + SNOOZE)).toBe(true);
  t.doneAt = now;
  expect(snoozeDue(t, now + SNOOZE)).toBe(false);
});

test('quick reads times, priority and title', () => {
  const q = parseQuick('Call mom at 5pm !');
  expect(q.title).toBe('Call mom');
  expect(q.high).toBe(true);
  expect(quickRemindAt(q, at(14), india)).toBe(at(17));
  expect(parseQuick('Pay rent at 9:30 am please').title).toBe('Pay rent please');
  expect(remind('Pay rent at 9:30 am please', at(14))).toBe(at(9, 30) + LIFE);
  expect(remind('Standup @10:15', at(14))).toBe(at(22, 15)); // "10:15" with no am/pm: the next one
  expect(remind('Gym at 18', at(14))).toBe(at(18));
  expect(parseQuick('Stretch in 30 min').title).toBe('Stretch');
  expect(remind('Stretch in 30 min', at(14))).toBe(at(14, 30));
  expect(remind('Check oven in 2h', at(14))).toBe(at(16));
});

test('quick reads time words', () => {
  expect(parseQuick('Call dad this evening').title).toBe('Call dad');
  expect(remind('Call dad this evening', at(14))).toBe(at(18));
  expect(remind('Pack bag tonight', at(14))).toBe(at(20));
  expect(remind('Lunch at noon', at(14))).toBe(at(12) + LIFE); // noon has passed: tomorrow's
  expect(remind('Email Sam in the morning', at(14))).toBe(at(9) + LIFE);
  expect(remind('Nap this afternoon', at(14))).toBe(at(15));
  expect(parseQuick('Morning walk').title).toBe('Morning walk'); // no "this": just a title
  expect(remind('Morning walk', at(6))).toBe(0);
  expect(remind('Gym tonight at 5pm', at(14))).toBe(at(17)); // a clock time wins
});

test('quiet hours wrap past midnight', () => {
  expect(quiet(at(23, 30), india, 23 * 60, 7 * 60)).toBe(true);
  expect(quiet(at(2), india, 23 * 60, 7 * 60)).toBe(true);
  expect(quiet(at(7), india, 23 * 60, 7 * 60)).toBe(false);
  expect(quiet(at(14), india, 23 * 60, 7 * 60)).toBe(false);
  expect(quiet(at(14), india, 13 * 60, 15 * 60)).toBe(true);
  expect(quiet(at(16), india, 13 * 60, 15 * 60)).toBe(false);
});

test('summary is due once a day and not stale', () => {
  expect(summaryDue(at(7, 59), india, 8 * 60, -1)).toBe(false);
  expect(summaryDue(at(8), india, 8 * 60, -1)).toBe(true);
  expect(summaryDue(at(10, 59), india, 8 * 60, NOV2 - 1)).toBe(true);
  expect(summaryDue(at(9), india, 8 * 60, NOV2)).toBe(false); // already sent today
  expect(summaryDue(at(11, 30), india, 8 * 60, -1)).toBe(false); // over 3 hours late
});

test("what's new shows everything newer than the last dismissed", () => {
  expect(whatsNew(WHATS_NEW[0][0])).toEqual([]);
  expect(whatsNew('')).toEqual(WHATS_NEW.flatMap(([, lines]) => lines));
  expect(whatsNew('not a version')).toEqual(WHATS_NEW.flatMap(([, lines]) => lines));
});

test('quick leaves ordinary text alone', () => {
  const q = parseQuick('Buy 2 in 1 shampoo!');
  expect(q.title).toBe('Buy 2 in 1 shampoo!');
  expect(q.high).toBe(false);
  expect(quickRemindAt(q, now, india)).toBe(0);
  expect(parseQuick('Meet at home').title).toBe('Meet at home');
  expect(parseQuick('at 25').title).toBe('at 25');
  expect(remind('at 25', now)).toBe(0);
  expect(remind('in 30h', now)).toBe(0); // past the task's 24 hours
  expect(parseQuick('at 5pm').title).toBe('at 5pm'); // nothing left for a title: keep what was typed
});

test('streaks count days with something done and nothing missed', () => {
  const d = (...dm: [number, number][]): DayCount[] => dm.map(([done, missed], i) => ({ day: NOV2 - i, done, missed }));
  expect(streaks(d([1, 0], [2, 0], [0, 1], [1, 0], [1, 0], [1, 0]))).toEqual([2, 3]);
  expect(streaks(d([0, 0], [1, 0], [3, 0]))).toEqual([2, 2]); // today has nothing yet: it doesn't break the streak
  expect(streaks(d([1, 1], [1, 0], [1, 0]))).toEqual([0, 2]);
  expect(streaks([])).toEqual([0, 0]);
});

test('fuse goes from fresh through amber to red', () => {
  const fresh = 0xff0000ff;
  const amber = 0xffffaa00;
  const red = 0xffff0000;
  expect(fuseColor(1, fresh, amber, red)).toBe(fresh);
  expect(fuseColor(0.5, fresh, amber, red)).toBe(amber);
  expect(fuseColor(0, fresh, amber, red)).toBe(red);
  expect(mix(0xff000000, 0xffffffff, 0.5)).toBe(0xff7f7f7f);
});

test('sweep moves ended tasks to history as done or missed', () => {
  const tasks = [task(1, now - LIFE, { doneAt: now - HOUR }), task(2, now - LIFE - 1), task(3)];
  const history: Task[] = [];
  expect(sweep(tasks, history, now, 30, ids)).toBe(true);
  expect(idsOf(tasks)).toEqual([3]);
  expect(idsOf(history)).toEqual([1, 2]);
  expect(isDone(history[0])).toBe(true);
  expect(isDone(history[1])).toBe(false);
  expect(history.every((t) => t.endedAt === t.expires)).toBe(true);
  expect(sweep(tasks, history, now, 30, ids)).toBe(false);
});

test('sweep drops history older than keep days unless forever', () => {
  const old = task(1, now - 40 * 24 * HOUR);
  old.endedAt = old.expires;
  const history = [old];
  expect(sweep([], history, now, 0, ids)).toBe(false);
  expect(history.length).toBe(1);
  expect(sweep([], history, now, 30, ids)).toBe(true);
  expect(history.length).toBe(0);
});

test('next event is the earliest of warning, reminder and burn-out', () => {
  const t = task(1);
  expect(nextEvent([t], 60)).toBe(t.expires - HOUR);
  t.remindAt = now + HOUR;
  expect(nextEvent([t], 60)).toBe(now + HOUR);
  t.reminded = true;
  t.warned = true;
  expect(nextEvent([t], 60)).toBe(t.expires);
  expect(nextEvent([], 60)).toBe(0);
});

test('done tasks get no warning or reminder', () => {
  const t = task(1, undefined, { remindAt: now + HOUR, doneAt: now });
  expect(nextEvent([t], 60)).toBe(t.expires);
  expect(warningDue(t, t.expires - 1, 60)).toBe(false);
  expect(reminderDue(t, now + 2 * HOUR)).toBe(false);
});

test('own warning time beats the default and zero is off', () => {
  expect(warnAt(task(1, undefined, { warn: 15 }), 60)).toBe(now + 23 * HOUR - 15 * MINUTE);
  expect(warnAt(task(2, undefined, { warn: 0 }), 60)).toBe(0);
  expect(warnAt(task(3), 0)).toBe(0);
  expect(nextEvent([task(4, undefined, { warn: 0 })], 60)).toBe(task(4).expires);
});

test('extend adds time three times only', () => {
  const t = task(1);
  const e = t.expires;
  extend(t, 1, now, 60);
  extend(t, 6, now, 60);
  extend(t, 24, now, 60);
  expect(t.expires).toBe(e + 31 * HOUR);
  expect(t.extensions).toBe(3);
  expect(() => extend(t, 1, now, 60)).toThrow();
});

test("extend re-arms the warning only when its time is still ahead", () => {
  // 30 min left, the 1 h warning already sent. +1 h: 1 h 30 left, so the warning is due again in 30 min.
  const t = task(1, now - LIFE + 30 * MINUTE, { warned: true });
  extend(t, 1, now, 60);
  expect(t.warned).toBe(false);
  // With a 3 h warning the new warning time is already past: not sent again.
  const u = task(2, now - LIFE + 30 * MINUTE, { warned: true });
  extend(u, 1, now, 180);
  expect(u.warned).toBe(true);
});

test('done tasks sit below open ones in every order', () => {
  const a = task(1, now - 3 * HOUR, { priority: LOW });
  const b = task(2, now - 2 * HOUR, { doneAt: now });
  const c = task(3, now - HOUR, { priority: HIGH });
  const list = [b, a, c];
  for (const s of SORTS) expect(sorted(list, s).at(-1), s).toBe(b);
  expect(sorted(list, 'MINE')).toEqual([a, c, b]);
  expect(sorted(list, 'PRIORITY')).toEqual([c, a, b]);
  expect(sorted(list, 'EXPIRING')).toEqual([a, c, b]);
  expect(sorted(list, 'NEWEST')).toEqual([c, a, b]);
  expect(sorted(list, 'OLDEST')).toEqual([a, c, b]);
});

test('same priority falls back to time left', () => {
  const a = task(1, now - HOUR, { priority: HIGH });
  const b = task(2, now - 2 * HOUR, { priority: HIGH });
  expect(sorted([a, b], 'PRIORITY')).toEqual([b, a]);
});

test('revived gets a fresh 24 hours and extensions', () => {
  const t = task(1, now - 2 * LIFE, {
    extensions: 3, doneAt: now - LIFE, warned: true, endedAt: now - LIFE, notes: 'n', custom: true,
  });
  const r = revived(t, 9, now);
  expect(r.id).toBe(9);
  expect(r.expires).toBe(now + LIFE);
  expect(r.extensions).toBe(0);
  expect(isDone(r) || r.warned || r.endedAt > 0 || r.custom).toBe(false);
  expect(r.notes).toBe('n');
});

test('daily counts: done by tick day, missed by burn-out day', () => {
  const noon = epoch(NOV2, 12, 0, 'UTC');
  const all = [
    task(1, noon - LIFE, { doneAt: noon - LIFE + HOUR, endedAt: noon }), // ticked yesterday, ended today
    task(2, noon - LIFE, { endedAt: noon }),
    task(3, noon, { doneAt: noon }), // ticked, still on the list
  ];
  const d = dailyCounts(all, NOV2, 'UTC', 7);
  expect(d.length).toBe(7);
  expect(d[0]).toEqual({ day: NOV2, done: 1, missed: 1 });
  expect(d[1]).toEqual({ day: NOV2 - 1, done: 1, missed: 0 });
});

test('next time is today or tomorrow', () => {
  expect(nextTime(14, 30, at(14), india)).toBe(at(14) + 30 * MINUTE);
  expect(nextTime(13, 0, at(14), india)).toBe(at(14) + LIFE - HOUR);
  expect(nextTime(14, 0, at(14), india)).toBe(at(14) + LIFE);
});

test('hm rounds up and never goes negative', () => {
  expect(hm(1)).toBe('1 m');
  expect(hm(HOUR)).toBe('1 h 0 m');
  expect(hm(LIFE - MINUTE)).toBe('23 h 59 m');
  expect(hm(LIFE)).toBe('24 h 0 m');
  expect(hm(LIFE + 90 * MINUTE)).toBe('1 d 1 h'); // a custom task, up to 7 days
  expect(hm(MAX_LENGTH)).toBe('7 d 0 h');
  expect(hm(-5)).toBe('0 m');
});

test('focus round never outlives its task', () => {
  const t = task(1, now - LIFE + 10 * MINUTE);
  expect(roundEnd(task(2), 25, now)).toBe(now + 25 * MINUTE);
  expect(roundEnd(t, 25, now)).toBe(t.expires);
});

test('mmss counts down', () => {
  expect(mmss(25 * MINUTE)).toBe('25:00');
  expect(mmss(1)).toBe('0:01');
  expect(mmss(-3)).toBe('0:00');
  expect(mmss(HOUR)).toBe('1:00:00');
});

test('plan suggests the next whole hour, then spread-out times before the end', () => {
  const n = at(10, 10);
  expect(slots(newTask(1, 't', n, { expires: at(23) }), n, india)).toEqual([at(11), at(15), at(18)]);
  expect(slots(newTask(2, 't', n, { expires: at(12, 30) }), n, india)).toEqual([at(11)]);
  expect(slots(newTask(3, 't', n, { expires: at(11, 10) }), n, india)).toEqual([]);
});

test('plan deals open tasks without a reminder to come, soonest first', () => {
  const late = task(1, undefined, { expires: now + 5 * HOUR });
  const soon = task(2, undefined, { expires: now + HOUR, remindAt: now - MINUTE, reminded: true });
  const booked = task(3, undefined, { remindAt: now + HOUR });
  const done = task(4, undefined, { doneAt: now });
  expect(idsOf(unplanned([late, soon, booked, done], now))).toEqual([2, 1]);
});

test('bonfire burns what was ticked that day, in order', () => {
  const all = [
    task(1, undefined, { doneAt: at(18) }),
    task(2, undefined, { doneAt: at(9) }),
    task(3, undefined, { doneAt: at(23, 59) + 2 * MINUTE }), // the next day
    task(4, undefined, { endedAt: at(12) }), // missed
  ];
  expect(idsOf(doneOn(all, NOV2, india))).toEqual([2, 1]);
});

test('Ember grows at ten, fifty, a hundred and fifty and four hundred', () => {
  expect([0, 9, 10, 49, 50, 150, 400, 5000].map(stageOf)).toEqual([0, 0, 1, 1, 2, 3, 4, 4]);
});

test('history letting go of done tasks is counted', () => {
  const history = [
    task(1, undefined, { doneAt: now - 40 * LIFE, endedAt: now - 40 * LIFE }),
    task(2, undefined, { endedAt: now - 40 * LIFE }), // missed: not counted
    task(3, undefined, { doneAt: now - LIFE, endedAt: now - LIFE }), // still kept
  ];
  let gone = 0;
  sweep([], history, now, 30, ids, (n) => (gone += n));
  expect(gone).toBe(1);
  expect(idsOf(history)).toEqual([3]);
});

test('your week finds the brightest day, the busiest hour and the longest chain', () => {
  const day = (n: number, h: number, m = 0) => at(h, m) - n * LIFE;
  const all = [
    task(1, undefined, { doneAt: day(0, 10) }),
    task(2, undefined, { doneAt: day(0, 10, 20) }),
    task(3, undefined, { doneAt: day(0, 10, 45) }), // three in a chain
    task(4, undefined, { doneAt: day(2, 10, 5) }),
    task(5, undefined, { doneAt: day(2, 18) }),
    task(6, undefined, { doneAt: day(2, 19) }),
    task(7, undefined, { doneAt: day(3, 9) }),
    task(8, undefined, { endedAt: day(1, 12) }), // burned out
    task(9, undefined, { doneAt: day(7, 10) }), // a week ago: not in it
  ];
  const w = weekReport(all, NOV2, india);
  expect(w.days.length).toBe(7);
  expect(w.days.at(-1)!.day).toBe(NOV2);
  expect(w.done).toBe(7);
  expect(w.missed).toBe(1);
  expect(w.best!.day).toBe(NOV2); // 3 and 3: the later day
  expect(w.hour).toBe(10);
  expect(w.chain).toBe(3);
  expect(weekReport([], NOV2, india).best).toBe(null);
  expect(weekReport([], NOV2, india).hour).toBe(-1);
});

test('the weekly recap comes Sunday evening', () => {
  // 2026-11-02 is a Monday.
  expect(nextWeekly(at(9), india)).toBe(at(19) + 6 * LIFE);
  expect(nextWeekly(at(19) - LIFE + 1, india)).toBe(at(19) + 6 * LIFE); // Sunday the 1st, just past 19:00
});

test('Ember sleeps, worries, sulks and glows', () => {
  const calm = task(1, undefined, { expires: now + 5 * HOUR });
  const nearlyOut = task(2, undefined, { expires: now + 20 * MINUTE });
  const count = (done: number, missed: number): DayCount => ({ day: NOV2, done, missed });
  expect(mood(count(0, 3), [nearlyOut], now, 60, true)).toBe('SLEEPY');
  expect(mood(count(5, 0), [calm, nearlyOut], now, 60, false)).toBe('WORRIED');
  expect(mood(count(1, 2), [calm], now, 60, false)).toBe('SAD');
  expect(mood(count(2, 2), [calm], now, 60, false)).toBe('HAPPY');
  expect(mood(count(0, 0), [], now, 60, false)).toBe('CALM');
});

test('a brain dump takes finished lines and keeps the one being typed', () => {
  expect(dumpLines('Call mo')).toEqual([[], 'Call mo']);
  expect(dumpLines('Call mom\n')).toEqual([['Call mom'], '']);
  // A list pasted from notes: markers and blank lines go, "at 5pm" stays for the quick-add words.
  expect(dumpLines('- Milk\n\n* Pay rent at 5pm\n1. Email Sam\n• Gym\n- [ ] Book flights\nWat')).toEqual([
    ['Milk', 'Pay rent at 5pm', 'Email Sam', 'Gym', 'Book flights'], 'Wat',
  ]);
  expect(dumpLines('2024 taxes\n')).toEqual([['2024 taxes'], '']);
});

test("pick for me favours what matters and what's burning down", () => {
  const urgent = task(1, now - 23 * HOUR, { priority: HIGH });
  const fresh = task(2, now, { priority: LOW });
  // mulberry32: a small seeded generator, so the test is the same every run.
  let seed = 7;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  let urgentPicks = 0;
  for (let i = 0; i < 2000; i++) if (pick([urgent, fresh], now, rnd)!.id === 1) urgentPicks++;
  // Weights 4 x (1 + 3 x 23/24) = 15.5 and 1 x 1 = 1: about 94% urgent, and the fresh one still comes up.
  const share = urgentPicks / 2000;
  expect(share).toBeGreaterThanOrEqual(0.91);
  expect(share).toBeLessThanOrEqual(0.97);
  expect(pick([], now, rnd)).toBe(null);
  expect(pick([fresh], now, rnd)!.id).toBe(2);
});

test('last call is open, past its warning and not yet burned out', () => {
  const t = task(1, undefined, { expires: now + 30 * MINUTE });
  expect(lastCall(t, now, 60)).toBe(true);
  expect(lastCall(t, now, 15)).toBe(false);
  expect(lastCall(t, now, 0)).toBe(false); // warnings off
  expect(lastCall(t, now + 31 * MINUTE, 60)).toBe(false);
  t.doneAt = now;
  expect(lastCall(t, now, 60)).toBe(false);
});

test('a chain counts dones each within half an hour of the last', () => {
  const all = [
    task(1, undefined, { doneAt: now - 100 * MINUTE }), // too long before the next: not a link
    task(2, undefined, { doneAt: now - 50 * MINUTE }),
    task(3, undefined, { doneAt: now - 25 * MINUTE }),
    task(4, undefined, { doneAt: now - 5 * MINUTE }),
    task(5),
  ];
  expect(chain(all, now)).toEqual([3, now + 25 * MINUTE]);
  expect(chain(all, now + 26 * MINUTE)).toEqual([0, 0]);
  expect(chain([task(6)], now)).toEqual([0, 0]);
  expect(CHAIN_WINDOW).toBe(30 * MINUTE);
});

test("a tick's burn stops where it was saved", () => {
  const open = task(1, now - 12 * HOUR);
  expect(burnLeft(open, now)).toBeCloseTo(0.5, 4);
  expect(burnLeft(open, now + 13 * HOUR)).toBe(0);
  const done = task(2, now - 6 * HOUR, { doneAt: now - 6 * HOUR + (6 * HOUR) / 2 });
  expect(burnLeft(done, now + 10 * HOUR)).toBe(burnLeft(done, now));
  expect(burnLeft(done, now)).toBeCloseTo(1 - 3 / 24, 4);
});
