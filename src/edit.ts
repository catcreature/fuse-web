// The task editor's pure maths (no DOM): lengths as days/hours/minutes, datetime-local text in a named zone,
// clock text for times further out, and whether a reminder fits inside a task's time.

import { LIFE, MAX_LENGTH, MIN_LENGTH } from './tasks';
import { DAY, HOUR, MINUTE, type Zone, dayOf, dayOfWeek, epoch, local } from './time';

const STEP = 5 * MINUTE;

/** A length as days, hours and minutes, the minutes rounded to the nearest 5. */
export function forParts(ms: number): { d: number; h: number; m: number } {
  const min = Math.round(Math.max(ms, 0) / STEP) * 5;
  return { d: Math.floor(min / (24 * 60)), h: Math.floor((min % (24 * 60)) / 60), m: min % 60 };
}

export const fromParts = (d: number, h: number, m: number) => d * DAY + h * HOUR + m * MINUTE;

/** A custom length kept between MIN_LENGTH and MAX_LENGTH (5 minutes to 7 days); clamped says it had to move. */
export function clampLength(ms: number): { ms: number; clamped: boolean } {
  const c = Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, ms));
  return { ms: c, clamped: c !== ms };
}

const two = (n: number) => String(n).padStart(2, '0');

/** The instant t as an `<input type="datetime-local">` value, 'YYYY-MM-DDTHH:MM', on the wall clock of zone. */
export function toLocalInput(t: number, zone: Zone): string {
  const l = local(t, zone);
  const date = new Date(l.day * DAY).toISOString().slice(0, 10);
  return `${date}T${two(l.hour)}:${two(l.minute)}`;
}

const INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d{1,3})?)?$/;

/** A datetime-local value read on the wall clock of zone, as epoch ms; 0 for '' or anything not a real date and time. */
export function fromLocalInput(s: string, zone: Zone): number {
  const m = INPUT.exec(s);
  if (!m) return 0;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || h > 23 || mi > 59) return 0;
  const day = dayOf(y, mo, d);
  // Date.UTC rolls 31 April over to 1 May: a day that doesn't exist reads back as a different date.
  if (new Date(day * DAY).getUTCDate() !== d) return 0;
  return epoch(day, h, mi, zone);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "21:40" within the next 24 hours, "Tue 9:30" further out (a custom task can last up to 7 days). */
export function clockAhead(t: number, now: number, zone: Zone): string {
  const l = local(t, zone);
  const clock = `${l.hour}:${two(l.minute)}`;
  return t - now < LIFE ? clock : `${WEEKDAYS[dayOfWeek(l.day)]} ${clock}`;
}

/** No reminder (0), or one still to come that rings no later than the task burns out. */
export const reminderOk = (remindAt: number, now: number, expires: number) =>
  remindAt === 0 || (remindAt > now && remindAt <= expires);

/** A warning lead in words: "off", "15 min", "1 h". */
export const warnLabel = (minutes: number) =>
  minutes === 0 ? 'off' : minutes < 60 ? `${minutes} min` : `${minutes / 60} h`;
