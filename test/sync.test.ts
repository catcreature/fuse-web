// The sync merge against the shared fixtures (docs/sync-fixtures/, run by the Android tests too), plus its properties.
import { expect, test } from 'vitest';
import { LIFE, type Task, newTask, sweep } from '../src/tasks';
import { type SyncFile, emptyFile, merge, readFile, sameFile } from '../src/sync/merge';

interface Fixture {
  about: string;
  now: number;
  local: unknown;
  remote: unknown;
  expected: unknown;
}

// Every file in the directory (Vite reads it at test time, no Node types needed for tsc).
const files = import.meta.glob<{ default: Fixture }>('../docs/sync-fixtures/*.json', { eager: true });
const fixtures = Object.entries(files)
  .map(([path, m]) => ({ name: path.split('/').pop()!, ...m.default }))
  .sort((a, b) => a.name.localeCompare(b.name));
const load = (name: string) => {
  const f = fixtures.find((x) => x.name.startsWith(name));
  if (!f) throw new Error(`no fixture ${name}`);
  return { ...f, l: readFile(f.local), r: f.remote === null ? null : readFile(f.remote) };
};

test('there are fixtures', () => {
  expect(fixtures.length).toBeGreaterThanOrEqual(14);
});

test.each(fixtures.map((f) => [f.name, f] as const))('fixture %s', (_, f) => {
  const local = readFile(f.local);
  const remote = f.remote === null ? null : readFile(f.remote);
  const before = JSON.stringify([local, remote]);
  const merged = merge(local, remote, f.now);
  expect(merged).toEqual(readFile(f.expected));
  expect(merged).toEqual(f.expected); // the expected file is already exactly a format-2 file
  expect(JSON.stringify([local, remote])).toBe(before); // inputs untouched
});

test.each(fixtures.map((f) => [f.name, f] as const))('idempotent: %s', (_, f) => {
  const local = readFile(f.local);
  const remote = f.remote === null ? null : readFile(f.remote);
  const once = merge(local, remote, f.now);
  expect(merge(once, remote, f.now)).toEqual(once);
  expect(sameFile(merge(once, once, f.now), once)).toBe(true);
});

test('the merge returns fresh records, never its inputs', () => {
  const { l, r, now } = load('01');
  const m = merge(l, r, now);
  m.tasks[0].title = 'changed';
  expect(l.tasks[0].title).toBe('t1');
  expect(merge(l, r, now).tasks[0].title).toBe('t1');
});

/** Every record by id with the list it is in: the record set and fields, order aside. */
const records = (f: SyncFile) => {
  const m = new Map<number, [string, Task]>();
  for (const place of ['tasks', 'history', 'matches'] as const) for (const t of f[place]) m.set(t.id, [place, t]);
  return m;
};

// Swapping the sides changes only what "remote wins" decides on a full tie (and the order when orderAt ties).
test.each(['02', '03', '05', '06', '07', '08', '10', '11', '16', '17', '19'])('either side first, same records: %s', (n) => {
  const { l, r, now } = load(n);
  const ab = merge(l, r, now);
  const ba = merge(r ?? emptyFile(), l, now);
  expect(records(ba)).toEqual(records(ab));
  expect(ba.deleted).toEqual(ab.deleted);
  expect([ba.orderAt, ba.doneGone]).toEqual([ab.orderAt, ab.doneGone]);
});

test('a full tie is the one place the sides differ: remote wins', () => {
  const { l, r, now } = load('04');
  expect(merge(l, r, now).tasks[0].title).toBe('remote');
  expect(merge(r!, l, now).tasks[0].title).toBe('local');
});

test('the sweep makes the same repeat copy as fixture 16 expects', () => {
  const { r, l, now } = load('16');
  const tasks = r!.tasks.map((t) => ({ ...t }));
  const history: Task[] = [];
  sweep(tasks, history, now, 30);
  expect(tasks).toEqual(l.tasks);
  expect(history.map((t) => [t.id, t.endedAt])).toEqual([[1, l.history[0].endedAt]]);
});

test('a repeat copy whose start is taken gets the next free id, the same whatever the list order', () => {
  const now = 1_800_000_000_000;
  const a = newTask(5, 'a', now - LIFE, { repeat: true });
  const b = newTask(3, 'b', now - LIFE, { repeat: true });
  const match = newTask(now, 'in the matchbox', now - LIFE);
  const run = (order: Task[]) => {
    const tasks = order.map((t) => ({ ...t }));
    sweep(tasks, [], now, 30, undefined, () => {}, [match]);
    return new Map(tasks.map((t) => [t.title, t.id]));
  };
  // now is held by the match, so the lower old id (b) gets now + 1 and a gets now + 2, in either order.
  expect(run([a, b])).toEqual(new Map([['a', now + 2], ['b', now + 1]]));
  expect(run([b, a])).toEqual(run([a, b]));
});

test('readFile takes an old Android fuse.json or backup', () => {
  const old = {
    tasks: [{ id: 1, title: 'old', created: 10, expires: 20, doneAt: 15, somethingNew: 'x' }],
    history: [],
    doneGone: 3,
  };
  const f = readFile(JSON.parse(JSON.stringify(old)));
  expect(f).toEqual({
    format: 2,
    tasks: [newTask(1, 'old', 10, { expires: 20, doneAt: 15 })],
    history: [], matches: [], deleted: [], orderAt: 0, doneGone: 3,
  });
  expect(f.tasks[0].updated).toBe(0);
  expect('somethingNew' in f.tasks[0]).toBe(false);
  expect(readFile({ tasks: [], history: [], matches: [] })).toEqual(emptyFile());
});

test('readFile throws on what is not a fuse file', () => {
  for (const bad of [null, 3, 'x', [], {}, { tasks: [] }, { tasks: 5, history: [] }, { tasks: [{ title: 'x' }], history: [] },
    { tasks: [], history: [], deleted: [{ id: 1 }] }, { tasks: [], history: [], format: 3 },
    { tasks: [], history: [], orderAt: 'soon' }]) {
    expect(() => readFile(bad)).toThrow();
  }
});

test('sameFile ignores key order but not list order', () => {
  const { expected } = load('11');
  const f = readFile(expected);
  const reKeyed: SyncFile = {
    ...(Object.fromEntries(Object.entries(f).reverse()) as unknown as SyncFile),
    tasks: f.tasks.map((t) => Object.fromEntries(Object.entries(t).reverse()) as unknown as Task),
    deleted: [...f.deleted].reverse(),
  };
  expect(sameFile(f, reKeyed)).toBe(true);
  expect(sameFile(f, { ...f, tasks: [...f.tasks].reverse() })).toBe(false);
  expect(sameFile(f, { ...f, orderAt: f.orderAt + 1 })).toBe(false);
});
