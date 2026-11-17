import { expect, test } from 'vitest';
import { RECENT, burnedRecently, dayHeading, groupByDay, searchHistory } from '../src/history';
import { HOUR, MINUTE, type Task, newTask } from '../src/tasks';
import { dayOf } from '../src/time';
import { routeOf } from '../src/views';

const zone = 'Asia/Kolkata';
const now = Date.UTC(2026, 10, 17, 12, 0); // 17:30 IST, Tue 17 Nov 2026
/** A record that ended at endedAt: missed unless done is given. */
const rec = (id: number, endedAt: number, over: Partial<Task> = {}) =>
  newTask(id, `t${id}`, endedAt - 24 * HOUR, { expires: endedAt, endedAt, ...over });
const ids = (ts: Task[]) => ts.map((t) => t.id);

test('burned recently: missed within the last 12 h, newest first, 12 h exactly still in', () => {
  const h = [
    rec(1, now - RECENT - 1),
    rec(2, now - RECENT),
    rec(3, now - 2 * HOUR),
    rec(4, now - 5 * MINUTE),
    rec(5, now - 11 * HOUR),
  ];
  expect(ids(burnedRecently(h, now))).toEqual([4, 3, 5, 2]);
});

test('burned recently leaves out done, repeating and cleared records', () => {
  const h = [
    rec(1, now - HOUR, { doneAt: now - 3 * HOUR }),
    rec(2, now - HOUR, { repeat: true }),
    rec(3, now - HOUR, { cleared: true }),
    rec(4, now - HOUR),
  ];
  expect(ids(burnedRecently(h, now))).toEqual([4]);
  expect(burnedRecently([], now)).toEqual([]);
});

test('search matches title and notes, ignoring case', () => {
  const h = [
    rec(1, now, { title: 'Call Mom' }),
    rec(2, now, { title: 'Rent', notes: 'Pay by noon\nto the LANDLORD' }),
    rec(3, now, { title: 'Stretch' }),
  ];
  expect(ids(searchHistory(h, 'mom'))).toEqual([1]);
  expect(ids(searchHistory(h, 'landlord'))).toEqual([2]);
  expect(ids(searchHistory(h, '  CALL '))).toEqual([1]);
  expect(ids(searchHistory(h, 'zzz'))).toEqual([]);
});

test('an empty or blank query shows everything, as a copy', () => {
  const h = [rec(1, now), rec(2, now)];
  expect(ids(searchHistory(h, ''))).toEqual([1, 2]);
  expect(ids(searchHistory(h, '   '))).toEqual([1, 2]);
  expect(searchHistory(h, '')).not.toBe(h);
});

test('day headings: today, yesterday, then weekday, date and month', () => {
  const today = dayOf(2026, 11, 17);
  expect(dayHeading(today, today)).toBe('Today');
  expect(dayHeading(today - 1, today)).toBe('Yesterday');
  expect(dayHeading(today - 7, today)).toBe('Tue 10 Nov');
});

test('day headings across a month and a year boundary', () => {
  const dec2 = dayOf(2026, 12, 2);
  expect(dayHeading(dayOf(2026, 12, 1), dec2)).toBe('Yesterday');
  expect(dayHeading(dayOf(2026, 11, 30), dec2)).toBe('Mon 30 Nov');
  expect(dayHeading(dayOf(2026, 11, 29), dec2)).toBe('Sun 29 Nov');
  const jan1 = dayOf(2027, 1, 1);
  expect(dayHeading(dayOf(2026, 12, 31), jan1)).toBe('Yesterday');
  expect(dayHeading(dayOf(2026, 12, 30), jan1)).toBe('Wed 30 Dec');
});

test('grouped by the day each ended in the zone, newest day and record first', () => {
  // 18:30 UTC is midnight in Kolkata: 18:29 is still the 16th there, 18:31 the 17th.
  const h = [
    rec(1, Date.UTC(2026, 10, 15, 6, 0)),
    rec(2, Date.UTC(2026, 10, 16, 18, 29)),
    rec(3, Date.UTC(2026, 10, 16, 18, 31)),
    rec(4, Date.UTC(2026, 10, 16, 2, 0)),
    rec(5, Date.UTC(2026, 10, 17, 10, 0)),
  ];
  const g = groupByDay(h, zone);
  expect(g.map((d) => d.day)).toEqual([dayOf(2026, 11, 17), dayOf(2026, 11, 16), dayOf(2026, 11, 15)]);
  expect(g.map((d) => ids(d.tasks))).toEqual([[5, 3], [2, 4], [1]]);
  expect(groupByDay([], zone)).toEqual([]);
});

test('routes: #/history and #/stats name views, anything else is the list', () => {
  expect(routeOf('#/history')).toBe('history');
  expect(routeOf('#/stats')).toBe('stats');
  expect(routeOf('#/')).toBe('');
  expect(routeOf('')).toBe('');
  expect(routeOf('#history')).toBe('');
});
