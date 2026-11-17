// Hash routing between the list (<main>) and full-page views: #/history, #/stats (reserved for the Stats view),
// anything else is the list. Hidden views carry the `hidden` attribute; Back in the browser works (hashchange).

interface View {
  el: HTMLElement;
  onShow: () => void;
}

const views = new Map<string, View>();
let list: HTMLElement | null = null;
let shown = '';
/** What had focus on the list before a view opened: it gets it back on return. */
let returnFocus: HTMLElement | null = null;

/** The view a hash names: "#/history" is "history"; "", "#/" and anything else are '' (the list). */
export function routeOf(hash: string): string {
  return /^#\/([a-z]+)\/?$/.exec(hash)?.[1] ?? '';
}

/** The view on screen; '' = the list. */
export const currentView = () => shown;

/** Adds a full-page view shown at #/name; onShow runs every time it comes on screen. */
export function registerView(name: string, el: HTMLElement, onShow: () => void = () => {}) {
  el.hidden = true;
  el.classList.add('view');
  views.set(name, { el, onShow });
  if (list) route();
}

/** A view's top bar: a back button to the list and the title. */
export function viewBar(title: string): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'view-bar';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'icon';
  back.textContent = '←';
  back.setAttribute('aria-label', 'Back');
  back.onclick = () => (location.hash = '#/');
  const h = document.createElement('h1');
  h.textContent = title;
  h.tabIndex = -1;
  bar.append(back, h);
  return bar;
}

function route() {
  const name = routeOf(location.hash);
  const next = views.has(name) ? name : '';
  if (next === shown || !list) return;
  if (shown === '' && document.activeElement instanceof HTMLElement) returnFocus = document.activeElement;
  list.hidden = next !== '';
  for (const [n, v] of views) v.el.hidden = n !== next;
  shown = next;
  window.scrollTo(0, 0);
  if (next === '') {
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
    return;
  }
  const v = views.get(next)!;
  v.onShow();
  v.el.querySelector<HTMLElement>('.view-bar h1')?.focus({ preventScroll: true });
}

/** Starts routing; main is the list's element. Call once, after the views are registered. */
export function initViews(main: HTMLElement) {
  list = main;
  window.addEventListener('hashchange', route);
  route();
}
