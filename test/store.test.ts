import { expect, test } from 'vitest';
import { type Box, Store } from '../src/store';
import { LIFE, NORMAL, newTask } from '../src/tasks';
import { readFile } from '../src/sync/merge';

function box(seed: Record<string, string> = {}): Box & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

test('what is saved comes back', () => {
  const b = box();
  const s = new Store(b, () => 5000);
  s.tasks.push(newTask(1, 'Milk', 1000, { notes: 'two', priority: 2 }));
  s.matches.push(newTask(2, 'Later', 1000));
  s.settings.warn = 30;
  s.save();
  s.saveSettings();
  const again = new Store(b);
  expect(again.tasks).toEqual(s.tasks);
  expect(again.matches).toEqual(s.matches);
  expect(again.settings.warn).toBe(30);
});

test("an Android file from before the newer fields loads with their defaults", () => {
  // The shape 0.1.0 of the Android app wrote: no repeat, snoozeAt, cleared, custom, and no matches.
  const old = { tasks: [{ id: 7, title: 'Old', created: 1000, expires: 1000 + LIFE }], history: [] };
  const s = new Store(box({ 'fuse.json': JSON.stringify(old) }));
  expect(s.tasks).toEqual([newTask(7, 'Old', 1000)]);
  expect(s.tasks[0].priority).toBe(NORMAL);
  expect(s.matches).toEqual([]);
});

test('settings saved before Settings existed load with the new defaults', () => {
  const old = { warn: 30, keep: 90, doneGone: 2, seenNotes: '0.1.0', welcomed: true };
  const s = new Store(box({ 'fuse.settings': JSON.stringify(old) }));
  expect(s.settings).toEqual({
    ...old, theme: 'system', accent: 0, quiet: true, quietStart: 1380, quietEnd: 420, strict: false, calm: false,
  });
});

test('data that cannot be read is set aside, not overwritten', () => {
  const b = box({ 'fuse.json': '{"tasks": [{"id": 1}], "history": []}' });
  const s = new Store(b, () => 42);
  expect(s.tasks).toEqual([]);
  expect(b.data.get('fuse-unreadable-42.json')).toBe('{"tasks": [{"id": 1}], "history": []}');
});

test('a backup restores, and something that is not a backup changes nothing', () => {
  const a = new Store(box(), () => 5000);
  a.tasks.push(newTask(1, 'Milk', 1000));
  a.history.push(newTask(2, 'Done', 500, { doneAt: 600, endedAt: 500 + LIFE }));
  a.settings.doneGone = 4;
  const b = new Store(box(), () => 7000);
  b.tasks.push(newTask(9, 'Mine', 1000));
  expect(b.restore('hello')).toBe(false);
  expect(b.restore('{"tasks": []}')).toBe(false);
  expect(b.tasks.map((t) => t.id)).toEqual([9]);
  expect(b.restore(a.backupText())).toBe(true);
  // Restoring is the user's doing: every record comes back stamped now (7000).
  expect(b.tasks).toEqual(a.tasks.map((t) => ({ ...t, updated: 7000 })));
  expect(b.history).toEqual(a.history.map((t) => ({ ...t, updated: 7000 })));
  expect(b.doneEver()).toBe(5);
});

test('a new id is never one already used', () => {
  const s = new Store(box(), () => 5000);
  expect(s.newId()).toBe(5000);
  s.history.push(newTask(9000, 'x', 1));
  expect(s.newId()).toBe(9001);
});

test('the save is a format-2 sync file, and it all comes back', () => {
  const b = box();
  let now = 5000;
  const s = new Store(b, () => now);
  s.tasks.push(s.stamp(newTask(1, 'Milk', 1000)));
  s.history.push(newTask(2, 'Gone', 500, { endedAt: 900 }));
  s.tombstone(3);
  now = 6000;
  s.tombstone(3); // a second delete keeps the later time
  s.touchOrder();
  s.settings.doneGone = 4;
  s.saveSettings();
  s.save();
  const saved = JSON.parse(b.data.get('fuse.json')!);
  expect(saved.format).toBe(2);
  expect(saved.deleted).toEqual([{ id: 3, at: 6000 }]);
  expect(saved.orderAt).toBe(6000);
  expect(saved.doneGone).toBe(4);
  expect(readFile(saved)).toEqual(s.snapshot());
  const again = new Store(b);
  expect(again.snapshot()).toEqual(s.snapshot());
  expect(again.tasks[0].updated).toBe(5000);
});

test('a save from before format 2 loads, doneGone from settings kept', () => {
  const old = { tasks: [{ id: 7, title: 'Old', created: 1000, expires: 1000 + LIFE }], history: [], matches: [] };
  const s = new Store(box({ 'fuse.json': JSON.stringify(old), 'fuse.settings': JSON.stringify({ doneGone: 3 }) }));
  expect(s.snapshot()).toEqual({
    format: 2, tasks: [newTask(7, 'Old', 1000)], history: [], matches: [], deleted: [], orderAt: 0, doneGone: 3,
  });
});

test('a newer format is set aside, never overwritten', () => {
  const text = JSON.stringify({ format: 3, tasks: [], history: [] });
  const b = box({ 'fuse.json': text });
  const s = new Store(b, () => 42);
  expect(s.tasks).toEqual([]);
  expect(b.data.get('fuse-unreadable-42.json')).toBe(text);
});

test('the snapshot is a copy: later changes do not reach it', () => {
  const s = new Store(box(), () => 5000);
  s.tasks.push(newTask(1, 'Milk', 1000));
  const snap = s.snapshot();
  s.tasks[0].title = 'Bread';
  expect(snap.tasks[0].title).toBe('Milk');
});

test('replace keeps the objects already held, saves, and does not call onChange', () => {
  const b = box();
  const s = new Store(b, () => 5000);
  const milk = newTask(1, 'Milk', 1000);
  s.tasks.push(milk, newTask(2, 'Gone soon', 1000));
  let changes = 0;
  s.onChange = () => changes++;
  const file = s.snapshot();
  file.tasks = [{ ...file.tasks[0], title: 'Oat milk', updated: 4000 }, newTask(3, 'New', 2000)];
  file.deleted = [{ id: 2, at: 4500 }];
  file.orderAt = 4000;
  file.doneGone = 2;
  s.replace(file);
  expect(changes).toBe(0);
  expect(s.tasks[0]).toBe(milk);
  expect(milk.title).toBe('Oat milk');
  expect(s.tasks.map((t) => t.id)).toEqual([1, 3]);
  expect(s.settings.doneGone).toBe(2);
  expect(new Store(b).snapshot()).toEqual(s.snapshot());
});

test('restore keeps the tombstones already here, and a backup is the sync format', () => {
  const a = new Store(box(), () => 5000);
  a.tasks.push(newTask(1, 'Milk', 1000));
  a.tombstone(8);
  const b = new Store(box(), () => 7000);
  b.tombstone(9);
  expect(JSON.parse(a.backupText()).format).toBe(2);
  expect(b.restore(a.backupText())).toBe(true);
  expect(b.deleted).toEqual([{ id: 9, at: 7000 }, { id: 8, at: 5000 }]);
  expect(b.tasks[0].updated).toBe(7000);
});
