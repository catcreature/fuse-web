// Drag to reorder (My order only) and Alt+Arrow to move a task by keyboard. The list is the shown one: open tasks
// first, then done ones, and a task only ever moves within its own group, as in the Android app.

import './order.css';
import { type Task, isDone } from './tasks';

/**
 * The shown list with task id moved to index to of the whole list, clamped into its own group (open tasks come
 * before done ones, and shown is already in that shape). An unknown id gives the list back unchanged.
 */
export function moveWithin(shown: Task[], id: number, to: number): Task[] {
  const from = shown.findIndex((t) => t.id === id);
  if (from < 0) return shown;
  const firstDone = shown.findIndex(isDone);
  const split = firstDone < 0 ? shown.length : firstDone;
  const [lo, hi] = isDone(shown[from]) ? [split, shown.length - 1] : [0, split - 1];
  const at = Math.min(hi, Math.max(lo, Number.isFinite(to) ? Math.trunc(to) : from));
  const out = shown.slice();
  out.splice(from, 1);
  out.splice(at, 0, shown[from]);
  return out;
}

export interface OrderDeps {
  list: HTMLElement;
  /** Only in My order. */
  enabled: () => boolean;
  /** The list as shown: open group, then done group. */
  shown: () => Task[];
  /** Makes order the list and saves it (which redraws). */
  apply: (order: Task[]) => void;
  render: () => void;
}

const HOLD = 350;
const TOUCH_SLOP = 8;
const MOUSE_SLOP = 6;
const EDGE = 48;

interface Drag {
  id: number;
  pointerId: number;
  touch: boolean;
  x0: number;
  y0: number;
  scroll0: number;
  /** Last pointer position (client y). */
  y: number;
  started: boolean;
  timer: number;
  raf: number;
  li: HTMLLIElement | null;
  done: boolean;
  group: HTMLLIElement[];
  centers: number[];
  step: number;
  from: number;
  to: number;
}

let drag: Drag | null = null;

/** A drag is live: the list must not be rebuilt under it. */
export const isDragging = () => drag?.started === true;

export function initOrder(deps: OrderDeps) {
  const { list } = deps;
  const live = document.createElement('div');
  live.className = 'sr-only';
  live.setAttribute('aria-live', 'polite');
  document.body.append(live);
  const announce = (text: string) => {
    live.textContent = '';
    setTimeout(() => (live.textContent = text), 50);
  };

  // A drag that started swallows the click after it, so the editor doesn't open.
  let swallowUntil = 0;
  document.addEventListener('click', (e) => {
    if (performance.now() < swallowUntil) {
      swallowUntil = 0;
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  const byId = (id: number) => list.querySelector<HTMLLIElement>(`li[data-id="${id}"]`);

  function begin(d: Drag) {
    clearTimeout(d.timer);
    const li = byId(d.id);
    if (!li || !deps.enabled()) {
      drag = null;
      return;
    }
    d.started = true;
    d.li = li;
    d.done = li.classList.contains('done');
    d.group = [...list.querySelectorAll<HTMLLIElement>('li[data-id]')].filter((e) => e.classList.contains('done') === d.done);
    d.from = d.to = d.group.indexOf(li);
    d.centers = d.group.map((e) => {
      const r = e.getBoundingClientRect();
      return r.top + window.scrollY + r.height / 2;
    });
    d.step = li.getBoundingClientRect().height + (parseFloat(getComputedStyle(li).marginBottom) || 0);
    getSelection()?.removeAllRanges();
    list.classList.add('dragging');
    li.classList.add('lifted');
    if (d.touch) navigator.vibrate?.(10);
    layout(d);
    d.raf = requestAnimationFrame(() => scroll(d));
  }

  function layout(d: Drag) {
    if (!d.li) return;
    const dy = d.y - d.y0 + (window.scrollY - d.scroll0);
    d.li.style.transform = `translateY(${dy}px) scale(1.02)`;
    const c = d.centers[d.from] + dy;
    let up = 0;
    let down = 0;
    d.centers.forEach((x, i) => {
      if (i > d.from && x < c) up++;
      if (i < d.from && x > c) down++;
    });
    d.to = d.from + up - down;
    d.group.forEach((e, i) => {
      if (i === d.from) return;
      const shift = i > d.from && i <= d.to ? -d.step : i < d.from && i >= d.to ? d.step : 0;
      e.style.transform = shift ? `translateY(${shift}px)` : '';
    });
  }

  function scroll(d: Drag) {
    if (drag !== d || !d.started) return;
    const v = d.y < EDGE ? -Math.ceil((EDGE - d.y) / 4) : d.y > innerHeight - EDGE ? Math.ceil((d.y - innerHeight + EDGE) / 4) : 0;
    if (v !== 0) {
      window.scrollBy(0, v);
      layout(d);
    }
    d.raf = requestAnimationFrame(() => scroll(d));
  }

  /** Ends the drag (or the wait for one) and puts every card back; true if a drag had started. */
  function finish(d: Drag): boolean {
    clearTimeout(d.timer);
    cancelAnimationFrame(d.raf);
    drag = null;
    if (!d.started) return false;
    for (const e of d.group) e.style.transform = '';
    d.li?.classList.remove('lifted');
    list.classList.remove('dragging');
    swallowUntil = performance.now() + 400;
    return true;
  }

  function drop(d: Drag) {
    if (!finish(d)) return;
    if (d.to === d.from) {
      deps.render();
      return;
    }
    const shown = deps.shown();
    const base = d.done ? shown.filter((t) => !isDone(t)).length : 0;
    deps.apply(moveWithin(shown, d.id, base + d.to));
  }

  function cancel(d: Drag) {
    if (finish(d)) deps.render();
  }

  list.addEventListener('pointerdown', (e) => {
    if (drag || !deps.enabled() || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const target = e.target as HTMLElement;
    if (target.closest('input, button')) return;
    const li = target.closest<HTMLLIElement>('li[data-id]');
    if (!li) return;
    const d: Drag = {
      id: Number(li.dataset.id), pointerId: e.pointerId, touch: e.pointerType === 'touch', x0: e.clientX, y0: e.clientY,
      scroll0: window.scrollY, y: e.clientY, started: false, timer: 0, raf: 0, li: null, done: false, group: [],
      centers: [], step: 0, from: 0, to: 0,
    };
    drag = d;
    if (d.touch) d.timer = window.setTimeout(() => drag === d && begin(d), HOLD);
  });

  window.addEventListener('pointermove', (e) => {
    const d = drag;
    if (!d || e.pointerId !== d.pointerId) return;
    if (!d.started) {
      const far = Math.hypot(e.clientX - d.x0, e.clientY - d.y0);
      if (d.touch) {
        if (far > TOUCH_SLOP) finish(d); // a scroll or a swipe, not a hold
        return;
      }
      if (far <= MOUSE_SLOP) return;
      d.y = e.clientY;
      begin(d);
      return;
    }
    e.preventDefault();
    d.y = e.clientY;
    layout(d);
  });

  window.addEventListener('pointerup', (e) => {
    if (drag && e.pointerId === drag.pointerId) drop(drag);
  });
  window.addEventListener('pointercancel', (e) => {
    if (drag && e.pointerId === drag.pointerId) cancel(drag);
  });
  // Once dragging, the finger moves the card, not the page.
  window.addEventListener('touchmove', (e) => {
    if (drag?.started && e.cancelable) e.preventDefault();
  }, { passive: false });
  // A long press would open the browser's menu on the card instead.
  list.addEventListener('contextmenu', (e) => {
    if (drag?.touch) e.preventDefault();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drag) {
      e.preventDefault();
      cancel(drag);
    }
  });

  // Alt+ArrowUp / Alt+ArrowDown on a card's text moves it one place within its group.
  list.addEventListener('keydown', (e) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    const target = e.target as HTMLElement;
    if (!target.classList.contains('card-text') || !deps.enabled() || drag) return;
    const li = target.closest<HTMLLIElement>('li[data-id]');
    if (!li) return;
    e.preventDefault();
    const id = Number(li.dataset.id);
    const shown = deps.shown();
    const from = shown.findIndex((t) => t.id === id);
    if (from < 0) return;
    const next = moveWithin(shown, id, from + (e.key === 'ArrowUp' ? -1 : 1));
    if (next.indexOf(shown[from]) === from) return; // already at the edge of its group
    deps.apply(next);
    byId(id)?.querySelector<HTMLElement>('.card-text')?.focus();
    const group = next.filter((t) => isDone(t) === isDone(shown[from]));
    announce(`Moved to ${group.indexOf(shown[from]) + 1} of ${group.length}`);
  });
}
