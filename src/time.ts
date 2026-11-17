// Clock and calendar maths in a named time zone, standing in for java.time in the Android app's Tasks.kt.
// A calendar day is its epoch day (days since 1970-01-01), so day arithmetic is plain numbers.

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** An IANA zone name, "Asia/Kolkata". */
export type Zone = string;

export interface Local {
  /** Epoch day of the calendar date. */
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formats = new Map<Zone, Intl.DateTimeFormat>();

function format(zone: Zone): Intl.DateTimeFormat {
  let f = formats.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    formats.set(zone, f);
  }
  return f;
}

/** The zone the browser is in. */
export function here(): Zone {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** What the wall clock in [zone] shows at the instant [t]. */
export function local(t: number, zone: Zone): Local {
  const p: Record<string, number> = {};
  for (const part of format(zone).formatToParts(new Date(t))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return { day: Date.UTC(p.year, p.month - 1, p.day) / DAY, hour: p.hour, minute: p.minute, second: p.second };
}

/** The zone's offset from UTC at [t], in ms. */
function offset(t: number, zone: Zone): number {
  const l = local(t, zone);
  return l.day * DAY + l.hour * HOUR + l.minute * MINUTE + l.second * 1000 - Math.floor(t / 1000) * 1000;
}

/** The instant the wall clock in [zone] shows [hour]:[minute] on epoch day [day]. */
export function epoch(day: number, hour: number, minute: number, zone: Zone): number {
  const wall = day * DAY + hour * HOUR + minute * MINUTE;
  // Two passes: the offset at the first guess can differ from the one at the answer across a clock change.
  const guess = wall - offset(wall, zone);
  return wall - offset(guess, zone);
}

export function epochDay(t: number, zone: Zone): number {
  return local(t, zone).day;
}

/** 0 = Sunday .. 6 = Saturday. Epoch day 0 was a Thursday. */
export function dayOfWeek(day: number): number {
  return (((day + 4) % 7) + 7) % 7;
}

/** The epoch day of a calendar date; [month] is 1..12. */
export function dayOf(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day) / DAY;
}
