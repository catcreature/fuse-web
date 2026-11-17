// The GitHub Contents API client and syncNow, against a fake GitHub (a mocked fetch).
import { expect, test, vi } from 'vitest';
import { type Box, Store } from '../src/store';
import { newTask } from '../src/tasks';
import { type SyncFile, canonical, emptyFile, readFile } from '../src/sync/merge';
import {
  BAD_TOKEN, OFFLINE, TOO_BIG, fromBase64, getFile, noRepo, putFile, toBase64,
} from '../src/sync/github';
import { STATUS_KEY, Sync, SYNC_KEY } from '../src/sync/sync';

const REPO = 'catcreature/fuse-data';
const FILE_URL = `https://api.github.com/repos/${REPO}/contents/fuse.json`;
const REPO_URL = `https://api.github.com/repos/${REPO}`;

const json = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A fake GitHub holding one repo (or none) and maybe fuse.json; records every request. */
function github(opts: { repo?: boolean; file?: SyncFile | null; conflicts?: number; status?: number } = {}) {
  const state = {
    repo: opts.repo ?? true,
    text: opts.file ? canonical(opts.file) : null as string | null,
    sha: opts.file ? 'sha0' : '',
    conflicts: opts.conflicts ?? 0,
    puts: [] as { message: string; content: string; sha?: string }[],
    gets: 0,
    /** Runs while a PUT is out, before GitHub answers it. */
    duringPut: null as (() => void) | null,
  };
  let n = 0;
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    if (opts.status) return json(opts.status, { message: 'nope' });
    if (u === REPO_URL && method === 'GET') return state.repo ? json(200, { full_name: REPO }) : json(404);
    if (u !== FILE_URL || !state.repo) return json(404);
    if (method === 'GET') {
      state.gets++;
      if (state.text === null) return json(404);
      return json(200, { encoding: 'base64', size: state.text.length, sha: state.sha, content: toBase64(state.text) });
    }
    const body = JSON.parse(String(init!.body));
    state.puts.push(body);
    state.duringPut?.();
    if (state.conflicts > 0) {
      state.conflicts--;
      return json(409, { message: 'conflict' });
    }
    if ((body.sha ?? '') !== state.sha) return json(409, { message: 'stale sha' });
    state.text = fromBase64(body.content);
    state.sha = `sha${++n}`;
    return json(200, { content: { sha: state.sha } });
  });
  const remote = () => (state.text === null ? null : readFile(JSON.parse(state.text)));
  return { state, f: f as unknown as typeof fetch, mock: f, remote };
}

function box(seed: Record<string, string> = {}): Box & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

function setup(gh: ReturnType<typeof github>, start = 1_800_000_000_000) {
  let now = start;
  const b = box({ [SYNC_KEY]: JSON.stringify({ repo: REPO, token: 'tok' }) });
  const store = new Store(b, () => now);
  let applied = 0;
  const sync = new Sync({
    store, box: b, fetch: gh.f, now: () => now, time: () => '14:20', apply: () => applied++,
  });
  return { store, sync, b, tick: (ms = 1000) => (now += ms), now: () => now, applied: () => applied };
}

// getFile

test('getFile 200: the file and its sha, with the headers SYNC.md names', async () => {
  const file = { ...emptyFile(), tasks: [newTask(1, 'Milk', 1000)] };
  const gh = github({ file });
  const r = await getFile(REPO, 'tok', gh.f);
  expect(r).toEqual({ file, sha: 'sha0' });
  const [url, init] = gh.mock.mock.calls[0];
  expect(url).toBe(FILE_URL);
  expect(init?.headers).toEqual({
    Authorization: 'Bearer tok', Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
  });
  expect(init?.cache).toBe('no-store');
});

test('getFile 404 with the repo there: no file yet', async () => {
  const gh = github({ file: null });
  expect(await getFile(REPO, 'tok', gh.f)).toEqual({ file: null });
  expect(gh.mock.mock.calls.map((c) => String(c[0]))).toEqual([FILE_URL, REPO_URL]);
});

test('getFile 404 with no repo: the repo error', async () => {
  const gh = github({ repo: false });
  await expect(getFile(REPO, 'tok', gh.f)).rejects.toThrow(noRepo(REPO));
  expect(noRepo(REPO)).toBe("Can't find catcreature/fuse-data (check the repo name and the token's access).");
});

test('getFile 401 and 403: the token error; others: the HTTP status', async () => {
  await expect(getFile(REPO, 'tok', github({ status: 401 }).f)).rejects.toThrow(BAD_TOKEN);
  await expect(getFile(REPO, 'tok', github({ status: 403 }).f)).rejects.toThrow(BAD_TOKEN);
  await expect(getFile(REPO, 'tok', github({ status: 500 }).f)).rejects.toThrow('Sync failed (HTTP 500).');
});

test('getFile with no network: offline', async () => {
  const f = (async () => {
    throw new TypeError('Failed to fetch');
  }) as unknown as typeof fetch;
  await expect(getFile(REPO, 'tok', f)).rejects.toThrow(OFFLINE);
});

test('getFile over 1 MB: too big', async () => {
  const f = (async () => json(200, { encoding: 'none', size: 2_000_000, sha: 's', content: '' })) as unknown as typeof fetch;
  await expect(getFile(REPO, 'tok', f)).rejects.toThrow(TOO_BIG);
});

// putFile

test('putFile sends base64 of the canonical JSON and the sha', async () => {
  const gh = github({ file: emptyFile() });
  const file = { ...emptyFile(), tasks: [newTask(1, 'चाय ☕', 1000)] };
  expect(await putFile(REPO, 'tok', file, 'sha0', gh.f)).toBe('sha1');
  const [url, init] = gh.mock.mock.calls[0];
  expect(url).toBe(FILE_URL);
  expect(init?.method).toBe('PUT');
  const body = JSON.parse(String(init!.body));
  expect(body).toEqual({ message: 'Sync from web', content: toBase64(canonical(file)), sha: 'sha0' });
  expect(fromBase64(body.content)).toBe(canonical(file));
});

test('putFile with no sha creates the file', async () => {
  const gh = github({ file: null });
  await putFile(REPO, 'tok', emptyFile(), undefined, gh.f);
  expect('sha' in gh.state.puts[0]).toBe(false);
  expect(gh.remote()).toEqual(emptyFile());
});

test('base64 is UTF-8 safe', () => {
  for (const s of ['', 'plain', 'चाय ☕', '😀 emoji, "quotes" and \\ back']) expect(fromBase64(toBase64(s))).toBe(s);
  expect(toBase64('☕')).toBe('4piV');
});

// syncNow

test('the first sync creates the file from the list here', async () => {
  const gh = github({ file: null });
  const { store, sync, b, applied } = setup(gh);
  store.tasks.push(newTask(1, 'Milk', 1000, { updated: 5 }));
  await sync.syncNow();
  expect(gh.state.puts).toHaveLength(1);
  expect(gh.remote()!.tasks.map((t) => t.title)).toEqual(['Milk']);
  expect(b.data.get(STATUS_KEY)).toBe('Synced 14:20');
  expect(applied()).toBe(1);
});

test('no PUT when the merge equals the file on GitHub', async () => {
  const file = { ...emptyFile(), tasks: [newTask(1, 'Milk', 1000, { updated: 5 })] };
  const gh = github({ file });
  const { sync, store, b } = setup(gh);
  await sync.syncNow();
  expect(gh.state.puts).toHaveLength(0);
  expect(store.tasks.map((t) => t.title)).toEqual(['Milk']);
  expect(b.data.get(STATUS_KEY)).toBe('Synced 14:20');
});

test('a PUT when they differ, and both sides end up with both', async () => {
  const gh = github({ file: { ...emptyFile(), tasks: [newTask(1, 'From phone', 1000, { updated: 5 })] } });
  const { sync, store } = setup(gh);
  store.tasks.push(newTask(2, 'From web', 1000, { updated: 6 }));
  await sync.syncNow();
  expect(gh.state.puts).toHaveLength(1);
  expect(gh.state.puts[0].sha).toBe('sha0');
  expect(gh.remote()!.tasks.map((t) => t.id).sort()).toEqual([1, 2]);
  expect(store.tasks.map((t) => t.id).sort()).toEqual([1, 2]);
  expect(store.snapshot()).toEqual(gh.remote());
});

test('a 409 starts again from GET, then succeeds', async () => {
  const gh = github({ file: emptyFile(), conflicts: 1 });
  const { sync, store, b } = setup(gh);
  store.tasks.push(newTask(2, 'From web', 1000, { updated: 6 }));
  await sync.syncNow();
  expect(gh.state.gets).toBe(2);
  expect(gh.state.puts).toHaveLength(2);
  expect(gh.remote()!.tasks.map((t) => t.id)).toEqual([2]);
  expect(b.data.get(STATUS_KEY)).toBe('Synced 14:20');
});

test('three 409s in a row: the error on the status line, nothing lost here', async () => {
  const gh = github({ file: emptyFile(), conflicts: 3 });
  const { sync, store, b, applied } = setup(gh);
  store.tasks.push(newTask(2, 'From web', 1000, { updated: 6 }));
  await sync.syncNow();
  expect(gh.state.puts).toHaveLength(3);
  expect(b.data.get(STATUS_KEY)).toBe('Sync failed (HTTP 409).');
  expect(store.tasks.map((t) => t.id)).toEqual([2]);
  expect(applied()).toBe(0);
});

test('a failure is a status line, never thrown', async () => {
  const gh = github({ status: 401 });
  const { sync, b } = setup(gh);
  await expect(sync.syncNow()).resolves.toBeUndefined();
  expect(b.data.get(STATUS_KEY)).toBe(BAD_TOKEN);
});

test('no token: no requests', async () => {
  const gh = github();
  const b = box();
  const sync = new Sync({ store: new Store(b), box: b, fetch: gh.f, time: () => '', apply: () => {} });
  await sync.syncNow();
  expect(gh.mock).not.toHaveBeenCalled();
});

test('non-ASCII titles round-trip', async () => {
  const gh = github({ file: null });
  const a = setup(gh);
  a.store.tasks.push(newTask(1, 'चाय ☕', 1000, { notes: 'अदरक 🫚', updated: 5 }));
  await a.sync.syncNow();
  const other = setup(gh);
  await other.sync.syncNow();
  expect(other.store.tasks[0].title).toBe('चाय ☕');
  expect(other.store.tasks[0].notes).toBe('अदरक 🫚');
});

test('an edit made while a sync is out survives it', async () => {
  const gh = github({ file: { ...emptyFile(), tasks: [newTask(1, 'Milk', 1000, { updated: 5 })] } });
  const { sync, store, tick } = setup(gh);
  store.tasks.push(newTask(2, 'Bread', 1000, { updated: 6 }));
  gh.state.duringPut = () => {
    // The user edits Bread and adds Eggs while the PUT is out.
    tick();
    const bread = store.tasks.find((t) => t.id === 2)!;
    bread.title = 'Rye bread';
    store.stamp(bread);
    store.tasks.unshift(store.stamp(newTask(3, 'Eggs', 2000)));
    gh.state.duringPut = null;
  };
  await sync.syncNow();
  const titles = new Map(store.tasks.map((t) => [t.id, t.title]));
  expect(titles).toEqual(new Map([[1, 'Milk'], [2, 'Rye bread'], [3, 'Eggs']]));
  // What went up was the list as it was when the sync began; the edit goes up with the next sync.
  expect(gh.remote()!.tasks.find((t) => t.id === 2)!.title).toBe('Bread');
  await sync.syncNow();
  expect(gh.remote()!.tasks.find((t) => t.id === 2)!.title).toBe('Rye bread');
  expect(gh.remote()!.tasks.map((t) => t.id).sort()).toEqual([1, 2, 3]);
});

test('a delete on one side reaches the other through its tombstone', async () => {
  const gh = github({ file: null });
  const a = setup(gh);
  a.store.tasks.push(newTask(1, 'Milk', 1000, { updated: 5 }));
  await a.sync.syncNow();
  const b = setup(gh);
  await b.sync.syncNow();
  expect(b.store.tasks).toHaveLength(1);
  a.tick();
  a.store.tasks.splice(0);
  a.store.tombstone(1);
  await a.sync.syncNow();
  await b.sync.syncNow();
  expect(b.store.tasks).toHaveLength(0);
  expect(b.store.deleted.map((d) => d.id)).toEqual([1]);
});

test('a trigger during a sync queues one more, not one each', async () => {
  const gh = github({ file: emptyFile() });
  const { sync } = setup(gh);
  const first = sync.syncNow();
  void sync.syncNow();
  void sync.syncNow();
  await first;
  expect(gh.state.gets).toBe(2);
  expect(sync.busy).toBe(false);
});
