// fuse.json in the user's private GitHub repo, through the Contents API (docs/SYNC.md, "The protocol"). Plain fetch,
// no library. Every failure is a SyncError whose message is the text the Sync section shows.

import { type SyncFile, canonical, readFile } from './merge';

const API = 'https://api.github.com';
const PATH = 'fuse.json';
/** The Contents API hands out file content up to 1 MB. */
export const MAX_BYTES = 1024 * 1024;
/** A request that hangs this long counts as no network. */
const TIMEOUT = 30_000;

export const OFFLINE = 'Offline: will sync when back.';
export const BAD_TOKEN = "GitHub didn't accept the token.";
export const TOO_BIG = 'Your list is too big to sync (over 1 MB).';
export const UNREADABLE = "The fuse.json on GitHub isn't one this version of Fuse can read. Nothing was changed.";
export const noRepo = (repo: string) => `Can't find ${repo} (check the repo name and the token's access).`;
export const failed = (status: number) => `Sync failed (HTTP ${status}).`;

/** A failed request; message is the user's text, status the HTTP status (0: no response). */
export class SyncError extends Error {
  constructor(message: string, readonly status = 0) {
    super(message);
    this.name = 'SyncError';
  }
}

/** Someone wrote the file between our GET and PUT: start again from GET. */
export const isConflict = (e: unknown) => e instanceof SyncError && (e.status === 409 || e.status === 422);

type Fetch = typeof fetch;

const headers = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
});

/** 'owner/name' split, or a SyncError naming it when it isn't one. */
function parts(repo: string): [string, string] {
  const m = /^\s*([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)\s*$/.exec(repo);
  if (!m) throw new SyncError(noRepo(repo.trim() || 'the repo'));
  return [m[1], m[2]];
}

async function call(f: Fetch, url: string, init: RequestInit): Promise<Response> {
  const signal = typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(TIMEOUT) : undefined;
  try {
    // no-store: GitHub lets browsers cache a contents GET for 60 s, which would hand back a stale sha after a PUT.
    return await f(url, { ...init, cache: 'no-store', signal });
  } catch {
    throw new SyncError(OFFLINE);
  }
}

/** The text of a non-OK response that isn't a special case. */
function httpError(status: number): SyncError {
  return new SyncError(status === 401 || status === 403 ? BAD_TOKEN : failed(status), status);
}

/** UTF-8 text as base64 (btoa alone takes only Latin-1). */
export function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** base64 (GitHub wraps it in lines) back to UTF-8 text. */
export function fromBase64(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export interface Remote {
  /** null: no fuse.json in the repo yet. */
  file: SyncFile | null;
  /** The file's blob sha, to PUT over it; absent when there's no file. */
  sha?: string;
}

/** Reads fuse.json from repo ('owner/name'). A missing file is {file: null}; a missing repo is an error. */
export async function getFile(repo: string, token: string, f: Fetch = fetch): Promise<Remote> {
  const [owner, name] = parts(repo);
  const base = `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  const res = await call(f, `${base}/contents/${PATH}`, { method: 'GET', headers: headers(token) });
  if (res.status === 404) {
    // 404 means no file or no repo (or a token that can't see it); asking for the repo tells them apart.
    const r = await call(f, base, { method: 'GET', headers: headers(token) });
    if (r.ok) return { file: null };
    if (r.status === 404) throw new SyncError(noRepo(`${owner}/${name}`), 404);
    throw httpError(r.status);
  }
  if (!res.ok) throw httpError(res.status);
  let body: { content?: unknown; encoding?: unknown; size?: unknown; sha?: unknown };
  try {
    body = await res.json();
  } catch {
    throw new SyncError(failed(res.status), res.status);
  }
  // Over 1 MB the API sends no content (encoding "none").
  if ((typeof body.size === 'number' && body.size > MAX_BYTES) || body.encoding !== 'base64') throw new SyncError(TOO_BIG);
  if (typeof body.content !== 'string' || typeof body.sha !== 'string') throw new SyncError(failed(res.status), res.status);
  try {
    return { file: readFile(JSON.parse(fromBase64(body.content))), sha: body.sha };
  } catch {
    // Not a fuse file, or a newer format: never written over.
    throw new SyncError(UNREADABLE);
  }
}

/**
 * Writes file as fuse.json (its canonical JSON), over the blob sha (none: creating it). Returns the new sha.
 * A 409 or 422 means someone wrote in between (isConflict).
 */
export async function putFile(
  repo: string, token: string, file: SyncFile, sha?: string, f: Fetch = fetch, from = 'web',
): Promise<string | undefined> {
  const [owner, name] = parts(repo);
  const text = canonical(file);
  if (new TextEncoder().encode(text).length > MAX_BYTES) throw new SyncError(TOO_BIG);
  const body: Record<string, string> = { message: `Sync from ${from}`, content: toBase64(text) };
  if (sha) body.sha = sha;
  const url = `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${PATH}`;
  const res = await call(f, url, {
    method: 'PUT',
    headers: { ...headers(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 404) throw new SyncError(noRepo(`${owner}/${name}`), 404);
  if (!res.ok) throw httpError(res.status);
  try {
    const out = await res.json();
    return typeof out?.content?.sha === 'string' ? out.content.sha : undefined;
  } catch {
    return undefined;
  }
}
