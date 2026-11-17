# Fuse sync: one list for the Android app and the website

The user's decision (2026-11-17): the Android app (`d:\catcreature\fuse`, `com.fuse`) and the website
(`d:\catcreature\fuse_web`, GitHub Pages) share one task list, kept as `fuse.json` in the **private** repo
`catcreature/fuse-data`, read and written through the GitHub Contents API with a **fine-grained token** the user
pastes once on each device (access to that one repo, Contents: read and write). No other server.
The app syncs on open, ~5 s after every change, and every 15 min in the background.

Both apps implement this spec. **The merge must give identical results on both**: the fixtures in
`docs/sync-fixtures/` are the shared contract, run by the TypeScript tests and the Kotlin tests alike.

## The file (format 2)

A superset of the Android app's `fuse.json` / backup file, so older files and backups still read:

```json
{
  "format": 2,
  "tasks":   [Task...],          // the list, in the user's order
  "history": [Task...],
  "matches": [Task...],          // the Matchbox
  "deleted": [{ "id": 17, "at": 1800000000000 }],
  "orderAt": 1800000000000,      // when the list order was last changed by a drag / move (0 = never)
  "doneGone": 4
}
```

`Task` is the existing record plus **`updated`** (epoch ms of the last change the user made to it; a missing
`updated` reads as 0). Unknown fields are ignored on read and dropped on write.

## Stamps: what bumps what

- `updated = now` on every change **the user** makes to a record: add, edit (any field in the editor), tick or
  untick, Add time / drag the edge back, bring back (the new copy, and the old record's `cleared`), let it go
  (`cleared`), strike from the Matchbox (the new task), keep in the Matchbox, priority from Select, Done / +1 h /
  Snooze from a notification or widget, a focus round's Done.
- **Not** bumped by what time does on its own: `sweep` moving a task to history (`endedAt`), sending a warning or
  reminder (`warned`, `reminded`), clearing a due `snoozeAt`. The merge handles these (below).
- A deletion adds a tombstone `{ id, at: now }` to `deleted`: delete from the list, delete one from history,
  clear all history, throw away a match, strike a match (the match's id), and history records dropped by the
  keep-days rule. Undo of a deletion re-adds the record with `updated = now`, which beats the tombstone.
- `orderAt = now` when the user reorders the list (drag, keyboard move). Adding a task does **not** change it.
- Restoring a backup replaces local data and stamps every restored record `updated = now`.

## Repeating tasks get a predictable id

Both devices sweep. A repeating task's next copy must get the **same id on both**, so `nextDay`'s new id is
`start` (the new copy's `created`), or the first free id above it if that id is taken by any record in tasks,
history or matches (copies handed out in old-id order). (Before sync this was `newId()`; the Android `sweep` call
and the web one both change. Reference: `repeatStart` / `freeId` / `sweep` in fuse_web `src/tasks.ts`.)

## Clarified by the first implementation (binding for both apps)

- Tombstones older than 30 days are pruned **before** step 3, so a pruned tombstone no longer kills anything.
- Clearing a due `snoozeAt` isn't stamped: when winner and loser have the same `updated` and the loser's
  `snoozeAt` is 0, the result's `snoozeAt` is 0 (fixture 17).
- `deleted` is written sorted by id. `readFile` rejects `format` > 2 (a newer app's file is never overwritten)
  and requires `tasks` and `history`.
- The reference implementation is fuse_web `src/sync/merge.ts`; when this text and the fixtures disagree, the
  fixtures win.

## merge(local, remote, now) → merged

Pure and deterministic. `remote` may be empty (no file yet).

1. **Tombstones**: union by id, keeping the larger `at`; drop those older than 30 days (`now - at > 30 d`).
2. **Records**: every id found in either side's tasks, history or matches. If only one side has it, take it.
   If both: the winner is the one with the larger `updated`; on a tie, the one in history beats the one in
   tasks beats the one in matches; still tied, remote wins. Then from the loser, when it is the same version of
   the task (equal `expires`), OR in `warned`; when equal `remindAt`, OR in `reminded`; if the loser is in
   history and the winner in tasks with the same `expires` and `updated`, take the history one (rule above).
   If the loser has `endedAt > 0` and the winner `endedAt == 0` and the winner's `expires <= now`, the
   winner is still placed where it was; the local sweep that runs after the merge ends it.
3. A record is **dropped** if a tombstone for its id has `at >= record.updated`.
4. Each surviving record goes in the list (tasks / history / matches) it came from on the winning side.
5. **Order of tasks**: the side with the larger `orderAt` (tie: remote) gives the base order; its ids that
   survived keep that order. Surviving ids that are not in it go **at the top**, in the order the other side
   had them. `orderAt` = the larger of the two.
6. **history** sorted by `endedAt` ascending, then id; **matches** in the winning-order side's order then the
   rest at the end (same rule as tasks but appended).
7. `doneGone` = the larger of the two. `format` = 2.

After merging, the device runs its normal `sweep` + refresh on the result (that's where alerts come from).
Each device keeps its own history-keep setting; a record its sweep drops by age gets a tombstone, so the
shortest keep setting wins on both (documented trade-off).

## The protocol (GitHub Contents API)

- `GET https://api.github.com/repos/{owner}/{repo}/contents/fuse.json` with headers
  `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`.
  200 → `content` is base64 (UTF-8 JSON), keep `sha`. 404 → no file yet (remote empty, no sha).
- `merged = merge(local, remote, now)`. If `merged` differs from `remote` (compare parsed values, not text),
  `PUT` the same URL with `{ "message": "Sync from <phone|web>", "content": base64(JSON), "sha": sha }`
  (no `sha` when the file didn't exist). 409 or 422 (someone wrote in between) → start again from GET, at most
  3 times.
- Local data becomes `merged` (saved, then sweep/refresh/redraw). Local changes made while a sync was in flight
  must not be lost: merge the in-flight result into the *current* local data, not the snapshot taken at start.
- Errors shown to the user in Settings' Sync section as a status line, never thrown at them:
  401/403 "GitHub didn't accept the token.", 404 on the repo "Can't find catcreature/fuse-data (check the
  repo name and the token's access).", no network "Offline: will sync when back.", other "Sync failed (HTTP
  nnn)." Success: "Synced 14:20". Failed syncs retry on the next trigger; nothing is ever discarded.
- The Contents API returns file content up to 1 MB; above that sync stops with "Your list is too big to sync
  (over 1 MB)." (thousands of tasks; history keep keeps it far below).

## Settings: Sync section (both apps)

Repo (`owner/name`, default `catcreature/fuse-data`), token (password field, shown as `••••` once saved, with
Remove), Sync now, the status line, and a one-line help: "Create a fine-grained token at github.com/settings/
personal-access-tokens with access to this repo only, Contents: Read and write." Turning sync on with a
non-empty local list and an existing remote file merges them (nothing is lost on either side).
Token storage: Android, encrypted with an Android Keystore AES key (as `game_informer/autoplay` does); web,
localStorage (the browser profile is the trust boundary; say so in the help line under the field).
