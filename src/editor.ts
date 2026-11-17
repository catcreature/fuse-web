// The task editor: a bottom sheet for adding a task with everything (notes, priority, Custom length, warning,
// reminder, repeat) or editing one, as the Android app's Editor.kt. Editing never moves the clock except through
// Add time (extend), and Add time is only applied on Save.

import './editor.css';
import {
  clampLength, clockAhead, forParts, fromLocalInput, fromParts, reminderOk, toLocalInput, warnLabel,
} from './edit';
import type { Store } from './store';
import {
  EXTEND_HOURS, HIGH, HOUR, LIFE, LOW, MAX_LENGTH, MIN_LENGTH, NORMAL, Strict, type Task, WARN_CHOICES, extend, hm, isDone, maxExtensions,
  newTask, rearm,
} from './tasks';
import type { Zone } from './time';

export interface EditorDeps {
  store: Store;
  zone: Zone;
  commit: () => void;
  undo: (text: string, back: () => void) => void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

const AFTER_END = 'Reminder removed: it was after the task burns out.';
const PASSED = 'Reminder removed: that time has passed.';
const RANGE = 'Between 5 minutes and 7 days.';

let seq = 0;

/** Opens the sheet for task, or for a new task when task is null. */
export function openEditor(task: Task | null, deps: EditorDeps) {
  const { store, zone } = deps;
  const id = `ed${++seq}`;
  const def = store.settings.warn;
  const open = task !== null && !isDone(task);

  const dialog = el('dialog', 'sheet');
  dialog.setAttribute('aria-labelledby', `${id}-head`);
  const form = el('form');
  form.noValidate = true;
  dialog.append(form);

  // A labelled field: the label above its control.
  const field = (label: string, control: HTMLElement, controlId: string) => {
    const box = el('div', 'field');
    const l = el('label', 'label', label);
    l.htmlFor = controlId;
    control.id = controlId;
    box.append(l, control);
    form.append(box);
    return box;
  };
  // Pills that are radio inputs, so keyboards and screen readers get a real radio group.
  const chips = (name: string, legend: string, options: [string, string][], checked: string, shown = true) => {
    const set = el('fieldset', 'chips');
    set.setAttribute('role', 'radiogroup');
    const lg = el('legend', shown ? 'label' : 'sr', legend);
    lg.id = `${id}-${name}-legend`;
    set.setAttribute('aria-labelledby', lg.id);
    set.append(lg);
    const inputs = options.map(([value, text]) => {
      const lab = el('label', 'chip');
      const r = el('input');
      r.type = 'radio';
      r.name = `${id}-${name}`;
      r.value = value;
      r.checked = value === checked;
      lab.append(r, el('span', '', text));
      set.append(lab);
      return r;
    });
    return { set, value: () => inputs.find((i) => i.checked)?.value ?? checked };
  };
  const hint = (cls = 'hint') => {
    const p = el('p', cls);
    p.setAttribute('aria-live', 'polite');
    return p;
  };

  // Header.
  const head = el('h2', '', task ? 'Edit task' : 'New task');
  head.id = `${id}-head`;
  const meta = el('p', 'meta');
  const header = el('header');
  header.append(head);
  if (task) header.append(meta);
  form.append(header);

  // 1. Title.
  const title = el('input');
  title.type = 'text';
  title.maxLength = 200;
  title.value = task?.title ?? '';
  title.autofocus = task === null;
  const titleError = hint('error');
  titleError.id = `${id}-title-error`;
  title.setAttribute('aria-describedby', titleError.id);
  field('Title', title, `${id}-title`).append(titleError);
  title.addEventListener('input', () => (titleError.textContent = ''));

  // 2. Notes.
  const notes = el('textarea');
  notes.rows = 3;
  notes.value = task?.notes ?? '';
  field('Notes', notes, `${id}-notes`);

  // 3. Priority.
  const priority = chips('priority', 'Priority', [[String(LOW), 'Low'], [String(NORMAL), 'Normal'], [String(HIGH), 'High']],
    String(task?.priority ?? NORMAL));
  form.append(priority.set);

  // 4. Length: new tasks only, never in Strict 24 h.
  let lengthBox: HTMLDivElement | null = null;
  let kind: { value: () => string } = { value: () => 'day' };
  let mode: { value: () => string } = { value: () => 'for' };
  let customBox: HTMLDivElement | null = null;
  let forBox: HTMLDivElement | null = null;
  let untilBox: HTMLDivElement | null = null;
  const unit = (max: number, step: number, text: string, value: number) => {
    const s = el('select');
    for (let v = 0; v <= max; v += step) s.append(new Option(String(v), String(v), false, v === value));
    const lab = el('label', 'unit');
    lab.append(s, el('span', '', text));
    return { s, lab };
  };
  const start = forParts(HOUR);
  const days = unit(7, 1, 'days', start.d);
  const hours = unit(23, 1, 'hours', start.h);
  const mins = unit(55, 5, 'min', start.m);
  const until = el('input');
  until.type = 'datetime-local';
  const rangeNote = hint();
  let lastUntil = Date.now() + HOUR;
  const forMs = () => fromParts(Number(days.s.value), Number(hours.s.value), Number(mins.s.value));
  const isCustom = () => task === null && !Strict.on && kind.value() === 'custom';
  /** The custom length as picked now, before clamping. */
  const rawLength = (now: number) => (mode.value() === 'for' ? forMs() : lastUntil - now);

  if (task === null && !Strict.on) {
    lengthBox = el('div', 'field');
    const k = chips('length', 'Length', [['day', '24 h'], ['custom', 'Custom']], 'day');
    kind = k;
    const m = chips('mode', 'Custom length', [['for', 'For'], ['until', 'Until']], 'for', false);
    mode = m;
    forBox = el('div', 'units');
    forBox.append(days.lab, hours.lab, mins.lab);
    untilBox = el('div');
    const ul = el('label', 'sr', 'Until');
    ul.htmlFor = until.id = `${id}-until`;
    untilBox.append(ul, until);
    customBox = el('div', 'custom');
    customBox.append(m.set, forBox, untilBox, rangeNote);
    lengthBox.append(k.set, customBox);
    form.append(lengthBox);
    // For and Until are two ways to set the same end: switching carries it across.
    m.set.addEventListener('change', () => {
      const now = Date.now();
      if (mode.value() === 'until') {
        lastUntil = now + clampLength(forMs()).ms;
        until.value = toLocalInput(lastUntil, zone);
      } else {
        const p = forParts(clampLength(lastUntil - now).ms);
        days.s.value = String(p.d);
        hours.s.value = String(p.h);
        mins.s.value = String(p.m);
      }
    });
    until.addEventListener('input', () => {
      const v = fromLocalInput(until.value, zone);
      if (v > 0) lastUntil = v;
    });
  }

  // 5. Warning.
  const warn = el('select');
  warn.append(new Option(`Default (${warnLabel(def)})`, '-1'));
  for (const w of WARN_CHOICES) warn.append(new Option(w === 0 ? 'Off' : warnLabel(w), String(w)));
  const warnNow = task?.warn ?? -1;
  if (![-1, ...WARN_CHOICES].includes(warnNow)) warn.append(new Option(warnLabel(warnNow), String(warnNow)));
  warn.value = String(warnNow);
  field('Warn me before it burns out', warn, `${id}-warn`);

  // 6. Reminder.
  const remind = el('input');
  remind.type = 'datetime-local';
  remind.value = task && task.remindAt > 0 ? toLocalInput(task.remindAt, zone) : '';
  const remindFirst = remind.value;
  const clear = el('button', 'text', 'Clear');
  clear.type = 'button';
  clear.setAttribute('aria-label', 'Clear the reminder');
  clear.onclick = () => {
    remind.value = '';
    update();
  };
  const remindRow = el('div', 'row');
  const remindNote = hint();
  const remindBox = field('Reminder', remind, `${id}-remind`);
  remindBox.append(remindRow, remindNote);
  remindRow.append(remind, clear);

  // 7. Repeat.
  const repeat = el('input');
  repeat.type = 'checkbox';
  repeat.checked = task?.repeat ?? false;
  repeat.id = `${id}-repeat`;
  const repeatBox = el('div', 'field check');
  const rl = el('label', '', 'Repeat every day');
  rl.htmlFor = repeat.id;
  repeatBox.append(repeat, rl);
  form.append(repeatBox);

  // 8. Add time: open tasks on the list only; taps wait for Save.
  const pending: number[] = [];
  const pendingHours = () => pending.reduce((a, h) => a + h, 0);
  const left = () => (task ? Math.max(0, maxExtensions() - task.extensions - pending.length) : 0);
  const extendButtons: HTMLButtonElement[] = [];
  const leftLabel = el('span', 'hint');
  if (task && open) {
    const box = el('div', 'field');
    box.setAttribute('role', 'group');
    const lab = el('span', 'label', 'Add time');
    lab.id = `${id}-extend`;
    box.setAttribute('aria-labelledby', lab.id);
    const row = el('div', 'row extend');
    for (const h of EXTEND_HOURS) {
      const b = el('button', 'pill', `+${h} h`);
      b.type = 'button';
      b.onclick = () => {
        if (left() === 0) return;
        pending.push(h);
        update();
      };
      extendButtons.push(b);
      row.append(b);
    }
    box.append(lab, row, leftLabel);
    form.append(box);
  }

  // Footer.
  const actions = el('div', 'actions');
  if (task) {
    const del = el('button', 'text danger', 'Delete');
    del.type = 'button';
    del.onclick = () => {
      const at = store.tasks.indexOf(task);
      dialog.close();
      if (at < 0) return; // it burned out while the sheet was open
      store.tasks.splice(at, 1);
      store.tombstone(task.id);
      deps.commit();
      deps.undo(`Deleted "${task.title}"`, () => {
        if (store.tasks.includes(task)) return;
        store.tasks.splice(Math.min(at, store.tasks.length), 0, store.stamp(task));
        deps.commit();
      });
    };
    actions.append(del);
  }
  const cancel = el('button', 'text', 'Cancel');
  cancel.type = 'button';
  cancel.onclick = () => dialog.close();
  const save = el('button', 'save', 'Save');
  save.type = 'submit';
  actions.append(cancel, save);
  form.append(actions);

  /** When the task would burn out if saved now. */
  const end = (now: number) => {
    if (task) return task.expires + pendingHours() * HOUR;
    return now + (isCustom() ? clampLength(rawLength(now)).ms : LIFE);
  };
  /** The reminder Save would keep, and why one typed in isn't kept. An untouched reminder stays exactly as it was. */
  const reminder = (now: number, endAt: number): { at: number; note: string } => {
    if (task && remind.value === remindFirst) return { at: task.remindAt, note: '' };
    const v = fromLocalInput(remind.value, zone);
    if (v === 0 || reminderOk(v, now, endAt)) return { at: v, note: '' };
    return { at: 0, note: v > endAt ? AFTER_END : PASSED };
  };

  function update() {
    const now = Date.now();
    const endAt = end(now);
    if (customBox && forBox && untilBox) {
      customBox.hidden = !isCustom();
      forBox.hidden = mode.value() !== 'for';
      untilBox.hidden = mode.value() !== 'until';
      until.min = toLocalInput(now + MIN_LENGTH, zone);
      until.max = toLocalInput(now + MAX_LENGTH, zone);
      rangeNote.textContent = isCustom() && clampLength(rawLength(now)).clamped ? RANGE : '';
    }
    repeatBox.hidden = isCustom() || (task?.custom ?? false);
    remind.min = toLocalInput(now, zone);
    remind.max = toLocalInput(endAt, zone);
    remindNote.textContent = reminder(now, endAt).note;
    if (task) {
      const extra = pendingHours() > 0 ? ` (+${pendingHours()} h)` : '';
      meta.textContent = isDone(task) ? 'Done' : `Burns out ${clockAhead(endAt, now, zone)}${extra} · ${hm(endAt - now)} left`;
      leftLabel.textContent = `${left()} of ${maxExtensions()} left`;
      for (const b of extendButtons) b.disabled = left() === 0;
    }
  }

  form.addEventListener('input', update);
  form.addEventListener('change', update);
  form.onsubmit = (e) => {
    e.preventDefault();
    const now = Date.now();
    const name = title.value.trim();
    if (!name) {
      titleError.textContent = 'Give it a name.';
      title.focus();
      return;
    }
    const prio = Number(priority.value());
    const warnAt = Number(warn.value);
    const r = reminder(now, end(now));
    if (task) {
      // It burned out while the sheet was open: it's history now, and history isn't edited here.
      if (!store.tasks.includes(task)) {
        dialog.close();
        return;
      }
      task.title = name;
      task.notes = notes.value.trim();
      task.priority = prio;
      if (task.warn !== warnAt) {
        task.warn = warnAt;
        rearm(task, now, def);
      }
      if (task.remindAt !== r.at) {
        task.remindAt = r.at;
        task.reminded = false;
      }
      task.repeat = repeat.checked && !task.custom;
      for (const h of pending) if (task.extensions < maxExtensions()) extend(task, h, now, def);
      store.stamp(task);
    } else {
      const custom = isCustom();
      const t = newTask(store.newId(), name, now, {
        notes: notes.value.trim(), priority: prio, warn: warnAt, remindAt: r.at, repeat: !custom && repeat.checked,
        expires: end(now), custom, updated: now,
      });
      rearm(t, now, def);
      store.tasks.unshift(t);
    }
    deps.commit();
    dialog.close();
  };

  // Esc closes (the dialog's own cancel); a click on the backdrop does nothing, so nothing typed is lost by accident.
  dialog.addEventListener('close', () => dialog.remove());
  if (task) dialog.autofocus = true;
  update();
  document.body.append(dialog);
  dialog.showModal();
}
