// Sync with the Fuse app on the phone through fuse.json in the user's GitHub repo (docs/SYNC.md). One sync at a time:
// GET, merge, PUT if anything changed (a conflict starts again from GET, at most 3 tries), then the result is merged
// into the data as it is *now*, so an edit made while the requests were out survives on its stamps.
// The repo and token live in localStorage under 'fuse.sync', never in settings, backups or the synced file.

import type { Box, Store } from '../store';
import { getFile, isConflict, putFile, SyncError } from './github';
import { merge, sameFile } from './merge';

export const SYNC_KEY = 'fuse.sync';
export const STATUS_KEY = 'fuse.sync.status';
export const DEFAULT_REPO = 'catcreature/fuse-data';
/** Tries of GET, merge, PUT before a run of conflicts is shown as an error. */
export const TRIES = 3;
/** How long after a change the sync waits, so a burst of changes goes up as one. */
export const AFTER_CHANGE = 5_000;

export interface SyncConfig {
  /** 'owner/name'. */
  repo: string;
  /** '' = sync is off. */
  token: string;
}

export function readConfig(box: Box): SyncConfig {
  try {
    const o = JSON.parse(box.getItem(SYNC_KEY) ?? '{}');
    return {
      repo: typeof o.repo === 'string' && o.repo.trim() ? o.repo.trim() : DEFAULT_REPO,
      token: typeof o.token === 'string' ? o.token.trim() : '',
    };
  } catch {
    return { repo: DEFAULT_REPO, token: '' };
  }
}

export function writeConfig(box: Box, c: SyncConfig) {
  box.setItem(SYNC_KEY, JSON.stringify({ repo: c.repo.trim() || DEFAULT_REPO, token: c.token.trim() }));
}

export interface SyncDeps {
  store: Store;
  /** Where the config and the status line live: localStorage, or a Map in tests. */
  box: Box;
  /** After the store took a sync's result: sweep, alerts, redraw (main.ts's refresh() + render()). */
  apply: () => void;
  /** '14:20' for a time: the status line's clock. */
  time: (t: number) => string;
  now?: () => number;
  fetch?: typeof fetch;
  /** A failed save (storage full or blocked) is the page's to tell. */
  onSaveError?: () => void;
}

export class Sync {
  private running: Promise<void> | null = null;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private listeners = new Set<(status: string) => void>();

  constructor(private deps: SyncDeps) {}

  private get now() {
    return this.deps.now ?? Date.now;
  }

  get config(): SyncConfig {
    return readConfig(this.deps.box);
  }

  set config(c: SyncConfig) {
    writeConfig(this.deps.box, c);
  }

  /** 'Synced 14:20', the last error's text, or '' before the first sync. */
  get status(): string {
    return this.deps.box.getItem(STATUS_KEY) ?? '';
  }

  private setStatus(s: string) {
    this.deps.box.setItem(STATUS_KEY, s);
    for (const l of this.listeners) l(s);
  }

  clearStatus() {
    this.setStatus('');
  }

  /** Told the status line after every sync; returns the unsubscribe. */
  listen(l: (status: string) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** Whether a sync is out now. */
  get busy() {
    return this.running !== null;
  }

  /** A sync AFTER_CHANGE from now; another change before then moves it on. */
  schedule(ms = AFTER_CHANGE) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.syncNow(), ms);
  }

  /** Syncs now, or, while one is out, once more after it. Never throws: failures go to the status line. */
  syncNow(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          await this.once();
        } while (this.again);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async once() {
    const { repo, token } = this.config;
    if (!token) return;
    const { store } = this.deps;
    const f = this.deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
    try {
      for (let tries = 1; ; tries++) {
        const remote = await getFile(repo, token, f);
        const merged = merge(store.snapshot(), remote.file, this.now());
        if (remote.file === null || !sameFile(merged, remote.file)) {
          try {
            await putFile(repo, token, merged, remote.sha, f);
          } catch (e) {
            if (isConflict(e) && tries < TRIES) continue;
            throw e;
          }
        }
        // What changed here while the requests were out wins by its stamps.
        const result = merge(store.snapshot(), merged, this.now());
        try {
          store.replace(result);
        } catch {
          this.deps.onSaveError?.();
        }
        this.setStatus(`Synced ${this.deps.time(this.now())}`);
        this.deps.apply();
        return;
      }
    } catch (e) {
      this.setStatus(e instanceof SyncError ? e.message : 'Sync failed.');
    }
  }
}
