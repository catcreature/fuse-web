// The task editor's pure helpers (src/edit.ts).
import { expect, test } from 'vitest';
import {
  clampLength, clockAhead, forParts, fromLocalInput, fromParts, reminderOk, toLocalInput, warnLabel,
} from '../src/edit';
import { HOUR, LIFE, MAX_LENGTH, MIN_LENGTH, MINUTE } from '../src/tasks';
import { dayOf, epoch } from '../src/time';

const india = 'Asia/Kolkata';
// Monday 2026-11-02.
const NOV2 = dayOf(2026, 11, 2);
const at = (h: number, m = 0, day = NOV2) => epoch(day, h, m, india);

test('a length splits into days, hours and minutes and back', () => {
  expect(forParts(HOUR)).toEqual({ d: 0, h: 1, m: 0 });
  expect(forParts(2 * LIFE + 3 * HOUR + 25 * MINUTE)).toEqual({ d: 2, h: 3, m: 25 });
  expect(forParts(MAX_LENGTH)).toEqual({ d: 7, h: 0, m: 0 });
  for (const ms of [MIN_LENGTH, HOUR, 5 * HOUR + 55 * MINUTE, 3 * LIFE + 20 * HOUR + 5 * MINUTE, MAX_LENGTH]) {
    const p = forParts(ms);
    expect(fromParts(p.d, p.h, p.m)).toBe(ms);
  }
});

test('minutes round to the nearest 5', () => {
  expect(forParts(62 * MINUTE)).toEqual({ d: 0, h: 1, m: 0 });
  expect(forParts(63 * MINUTE)).toEqual({ d: 0, h: 1, m: 5 });
  expect(forParts(23 * HOUR + 58 * MINUTE)).toEqual({ d: 1, h: 0, m: 0 });
  expect(forParts(-HOUR)).toEqual({ d: 0, h: 0, m: 0 });
});

test('a custom length is clamped to 5 minutes .. 7 days', () => {
  expect(clampLength(HOUR)).toEqual({ ms: HOUR, clamped: false });
  expect(clampLength(MIN_LENGTH)).toEqual({ ms: MIN_LENGTH, clamped: false });
  expect(clampLength(MAX_LENGTH)).toEqual({ ms: MAX_LENGTH, clamped: false });
  expect(clampLength(0)).toEqual({ ms: MIN_LENGTH, clamped: true });
  expect(clampLength(MIN_LENGTH - 1)).toEqual({ ms: MIN_LENGTH, clamped: true });
  expect(clampLength(MAX_LENGTH + MINUTE)).toEqual({ ms: MAX_LENGTH, clamped: true });
  expect(clampLength(fromParts(7, 23, 55))).toEqual({ ms: MAX_LENGTH, clamped: true });
});

test('datetime-local text is the wall clock of the given zone, both ways', () => {
  expect(toLocalInput(at(9, 5), india)).toBe('2026-11-02T09:05');
  expect(toLocalInput(at(23, 59), india)).toBe('2026-11-02T23:59');
  // 2026-11-02 00:00 UTC is 05:30 in India.
  expect(toLocalInput(NOV2 * LIFE, india)).toBe('2026-11-02T05:30');
  expect(fromLocalInput('2026-11-02T09:05', india)).toBe(at(9, 5));
  expect(fromLocalInput('2026-11-02T09:05:00', india)).toBe(at(9, 5));
  for (const t of [at(0, 0), at(12, 30), at(23, 55, NOV2 + 6), at(7, 0, dayOf(2027, 2, 28))]) {
    expect(fromLocalInput(toLocalInput(t, india), india)).toBe(t);
  }
});

test("an empty or invalid datetime-local text reads as 0", () => {
  expect(fromLocalInput('', india)).toBe(0);
  expect(fromLocalInput('tomorrow', india)).toBe(0);
  expect(fromLocalInput('2026-11-02', india)).toBe(0);
  expect(fromLocalInput('2026-11-02T24:00', india)).toBe(0);
  expect(fromLocalInput('2026-11-02T09:60', india)).toBe(0);
  expect(fromLocalInput('2026-13-02T09:00', india)).toBe(0);
  expect(fromLocalInput('2026-04-31T09:00', india)).toBe(0);
  expect(fromLocalInput('2027-02-29T09:00', india)).toBe(0);
});

test('times more than a day ahead carry the weekday', () => {
  const now = at(10, 0);
  expect(clockAhead(at(21, 40), now, india)).toBe('21:40');
  expect(clockAhead(at(9, 30, NOV2 + 1), now, india)).toBe('9:30');
  expect(clockAhead(at(9, 59, NOV2 + 1), now, india)).toBe('9:59');
  // From a full 24 hours out, as the Android app's clockAhead.
  expect(clockAhead(at(10, 0, NOV2 + 1), now, india)).toBe('Tue 10:00');
  expect(clockAhead(at(9, 30, NOV2 + 2), now, india)).toBe('Wed 9:30');
  expect(clockAhead(at(0, 5, NOV2 + 6), now, india)).toBe('Sun 0:05');
});

test('a reminder must be still to come and no later than the end', () => {
  const now = at(10, 0);
  const end = at(10, 0, NOV2 + 1);
  expect(reminderOk(0, now, end)).toBe(true);
  expect(reminderOk(at(12, 0), now, end)).toBe(true);
  expect(reminderOk(end, now, end)).toBe(true);
  expect(reminderOk(end + MINUTE, now, end)).toBe(false);
  expect(reminderOk(now, now, end)).toBe(false);
  expect(reminderOk(at(9, 0), now, end)).toBe(false);
});

test('warning leads in words', () => {
  expect(warnLabel(0)).toBe('off');
  expect(warnLabel(15)).toBe('15 min');
  expect(warnLabel(60)).toBe('1 h');
  expect(warnLabel(360)).toBe('6 h');
});
