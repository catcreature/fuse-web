import { expect, test } from 'vitest';
import { moveWithin } from '../src/order';
import { type Task, newTask } from '../src/tasks';

const now = 1_800_000_000_000;
// Open 1, 2, 3, then done 4, 5: the shape the shown list always has.
const shown = (): Task[] => [
  newTask(1, 't1', now),
  newTask(2, 't2', now),
  newTask(3, 't3', now),
  newTask(4, 't4', now, { doneAt: now }),
  newTask(5, 't5', now, { doneAt: now }),
];
const ids = (ts: Task[]) => ts.map((t) => t.id);

test('moves an open task down and up inside the open group', () => {
  expect(ids(moveWithin(shown(), 1, 2))).toEqual([2, 3, 1, 4, 5]);
  expect(ids(moveWithin(shown(), 3, 0))).toEqual([3, 1, 2, 4, 5]);
  expect(ids(moveWithin(shown(), 2, 1))).toEqual([1, 2, 3, 4, 5]);
});

test('moves a done task inside the done group', () => {
  expect(ids(moveWithin(shown(), 4, 4))).toEqual([1, 2, 3, 5, 4]);
});

test('an open task dropped among done ones stays last of the open group', () => {
  expect(ids(moveWithin(shown(), 1, 4))).toEqual([2, 3, 1, 4, 5]);
});

test('a done task dropped among open ones stays first of the done group', () => {
  expect(ids(moveWithin(shown(), 5, 0))).toEqual([1, 2, 3, 5, 4]);
});

test('out-of-range indices clamp to the group', () => {
  expect(ids(moveWithin(shown(), 2, -5))).toEqual([2, 1, 3, 4, 5]);
  expect(ids(moveWithin(shown(), 4, 99))).toEqual([1, 2, 3, 5, 4]);
  expect(ids(moveWithin(shown(), 2, 99))).toEqual([1, 3, 2, 4, 5]);
});

test('works when one group is empty', () => {
  const open = shown().slice(0, 3);
  expect(ids(moveWithin(open, 1, 99))).toEqual([2, 3, 1]);
  const done = shown().slice(3);
  expect(ids(moveWithin(done, 5, -1))).toEqual([5, 4]);
});

test('an unknown id returns the list unchanged', () => {
  const list = shown();
  expect(moveWithin(list, 42, 0)).toEqual(list);
});

test('never changes the list it was given', () => {
  const list = shown();
  moveWithin(list, 1, 2);
  expect(ids(list)).toEqual([1, 2, 3, 4, 5]);
});
