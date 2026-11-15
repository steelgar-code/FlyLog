# FlyLog handoff: FlyStock exchange and storage migration

Written 15 Nov 2026. Describes FlyLog `main` at `99f8604`, FlyStock at `cbd12f9`.
FlySky was cloned but not analysed.

Nothing in sections 4 to 6 is implemented yet. This document is the agreed design and plan
for whoever picks the work up next.

## 1. Where things stand

Shipped to `main` on 14 Nov 2026:

- Tailwind 3.4.17 (Play CDN runtime script), Chart.js 4.6.1 and Font Awesome 6.4.0 are self-hosted
  under `vendor/`. The app makes no third-party requests and works from `file://`.
- `sw.js` is offline-first: the whole app is cached at install, app navigations are answered from
  cache, and a background check compares `index.html` byte for byte with the cached copy. There is
  no version stamp to bump. The page shows an "Update available" prompt and an "Offline Use"
  status line in the sidebar.
- Backup import asks Replace or Merge, validates every record before committing anything, and
  keeps a record ID from a file only if it matches `SAFE_ID_RE`.
- Saving is all-or-nothing across the six data keys; unreadable stored data is copied to a
  `flylog_corrupt_*` key instead of being overwritten.
- Bug fixes from the code review (modals, flight form, date presets, time formatting, lifespan
  across DST, translations). The fake weather/GPS box in the header is commented out until it can
  show real data.
- 149 Playwright tests, Chromium only.

Decisions still needed from the owner are in section 7.

## 2. FlyLog as it is now

### Files

| Path | Role |
|---|---|
| `index.html` | All HTML, CSS and JS (about 4,400 lines) |
| `sw.js` | Service worker; lists every file the page needs in `SHELL_URLS` and `VENDOR_URLS` |
| `vendor/` | Third-party libraries, file names carry the version |
| `tests/` | Playwright specs; `tests/support/app.js` has fixtures and helpers |
| `tests/support/server.js` | Static server; `startServer({root, mount, port})` can mount an app under a sub-path |

### Storage (localStorage, origin `steelgar-code.github.io`, shared with the sibling apps)

| Key | Content |
|---|---|
| `flylog_flights` | Array of flight records |
| `flylog_drones` | Array of airframes, in display order |
| `flylog_batteries` | Array of batteries, in display order |
| `flylog_drone_statuses` | Array of status names (user-defined) |
| `flylog_drone_status_colors` | Map of status name to `#rrggbb` |
| `flylog_custom_fields` | Array of `{id, label, type}` |
| `flylog-lang` | UI language (`en`, `uk`, `pt-BR`) |
| `flylog_install_dismissed`, `flylog_offline_ready_notified` | UI flags |
| `flylog_corrupt_<name>` | Copy of a stored value that could not be parsed |

### Record shapes

```
drone   { id, name, model, flightHours, status }
battery { id, name, cycles, flightHours, status }        status: Good | Warning | Retired
flight  { id, droneId, droneName, batteryId, batteryName,
          startTime, endTime, duration, notes, customValues }
          startTime/endTime: "YYYY-MM-DDTHH:mm" local time; duration in minutes
          customValues: map of custom field id to value
```

Default drone statuses: Ready, Maintenance, In Inspection, Repairing, Retired.

### Rules the code and tests rely on

- No build step. A file the page loads must be listed in `sw.js`; a static test enforces it.
- Every UI string exists in all three translation tables; a static test checks key parity.
- Record IDs are interpolated into inline `onclick` handlers, so any ID that enters from outside
  must match `SAFE_ID_RE` (`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`) or be regenerated.
- `renderAll()` calls `saveState()`, which writes only the keys whose JSON changed and rolls back
  on failure.
- Import Replace keeps only the fields it knows. A new field on a record must be added to
  `parseBackup` and the `plan*Import` functions or it is dropped on restore.
- Tests: `npm install`, then `npm test`. Fixtures seed localStorage before load and pin the
  browser to UTC. Never run `playwright install` in the cloud environment; `@playwright/test`
  is pinned to the pre-installed 1.63.0.

## 3. FlyStock facts

From a read-only analysis of FlyStock `index.html` at `cbd12f9`.

- **Storage:** localStorage only. One key, `stockroom_inventory_v1`, holds
  `{ types: [name, ...], items: [...] }`. Language is under `flystock-lang`.
- **Item:** `{ id, type, description, status, dateAdded, dateRemoved, notes: [{id, date, text}] }`.
  `id` is `crypto.randomUUID()` (fallback `id-<time>-<hex>`) and stays the same for the life of
  the item. `type` is one free-text name. One record is one physical unit; there is no quantity.
- **No airframe marker:** types are a flat, user-defined list of names. Nothing distinguishes an
  airframe from any other item.
- **Status:** only `active` or `removed`. There is no condition field. The `notes` array is the
  item's dated history.
- **Load and save:** data is read once at startup and the whole dataset is rewritten on every
  change. There is no `storage`, focus or visibility listener. A write made by another app while
  FlyStock is open is lost on FlyStock's next save.
- **Import/export:** a plain-text format without item IDs; import is additive and assigns new
  IDs. A raw-storage JSON download also exists.
- **Cross-app hooks:** none, apart from footer links to the sibling apps.
- **Tests:** the repository has no test suite.

## 4. Feature: airframes from FlyStock, condition reports from FlyLog

### What the owner asked for

A new airframe is added to FlyStock first. When logging a flight in FlyLog, the pilot wants to
pull the list of FlyStock items and add selected ones as airframes. If the airframe needs repair
after the flight, the pilot wants to set its status and add a comment from FlyLog while entering
the flight, and have that reach FlyStock. Everything stays serverless and happens on demand.

### Workflow

1. Add the airframe in FlyStock as an ordinary item, under any type.
2. In FlyLog choose "Add from FlyStock…", offered in the Fleet tab and as the last entry of the
   airframe dropdown in Log Flight. The picker lists active FlyStock items that are not linked
   yet, with search, a type filter that remembers the last choice, and multi-select.
3. Log the flight. A new "Airframe after flight" block offers a status (FlyLog's own list,
   default "No change") and an optional comment.
4. On save, FlyLog stores the flight and the new status. If the airframe is linked and the status
   changed or a comment was entered, FlyLog leaves a message for FlyStock.
5. FlyStock applies the message as a dated note on the item, immediately if it is open and
   otherwise the next time it opens. Each linked item shows a badge with FlyLog's current status
   and flight hours.

### Design rules

- Each app is the only writer of its own data. Reads across apps are direct; writes across apps
  go through messages.
- Everything read from another app is untrusted input: check types and lengths, apply
  `SAFE_ID_RE` to IDs, render through `escapeHtml` or `textContent`.
- Nothing may break when the other app has never been used on the device. The picker shows an
  empty state with a link to FlyStock.
- FlyStock owns an item's identity and removal. FlyLog owns condition status and flight hours.
  FlyStock gets no status field; it shows FlyLog's status live.
- Everything works offline.

### Data contract

New fields on a FlyLog drone:

| Field | Meaning |
|---|---|
| `stockId` | FlyStock item ID. Absent on airframes created by hand. One item links to at most one airframe. |
| `stockName` | FlyStock description as last seen, used to detect a rename |

New optional fields on a FlyLog flight:

| Field | Meaning |
|---|---|
| `statusAfter` | Status chosen in the after-flight block. Absent means no change. |
| `airframeNote` | The comment |

Messages use one localStorage key per message, named `fly_x1:<recipient>:<message id>`:

```json
{
  "v": 1,
  "id": "msg-1731600000000-ab12cd",
  "from": "flylog",
  "to": "flystock",
  "type": "item-note",
  "itemId": "<FlyStock item id>",
  "date": "2026-11-15T09:30:00.000Z",
  "text": "FlyLog: Ready → Repairing. Motor 3 vibration. (Flight 2026-11-15 09:10, 12 min)"
}
```

- The sender only creates keys and the recipient only deletes them, so no shared value is ever
  read, changed and written back. Two open apps cannot lose each other's messages.
- The recipient processes its keys at startup, on a `storage` event and on `visibilitychange`.
- Applying a message appends `{ id: message id, date, text }` to the item's notes unless a note
  with that ID already exists. This makes a repeat harmless if the app stops between saving and
  deleting the key.
- A message for an item that no longer exists, or one that fails validation, is deleted. A
  message with an unknown `v` or `type` is left alone, and any message older than 90 days is
  deleted.
- The text is written by the sender in its current UI language, as plain text of at most
  1,000 characters.

FlyStock reads `flylog_drones` to find the record whose `stockId` equals the item ID, and
`flylog_drone_status_colors` for the badge colour (accept `#rrggbb` only).

### FlyLog requirements

- **L1 Picker.** Read `stockroom_inventory_v1`, validate, list active unlinked items. Name comes
  from the description, model from the type. The type filter is remembered in a `flylog_` key.
- **L2 Link upkeep.** At startup and when the Fleet tab opens, re-read FlyStock. An item that is
  missing or removed puts a "Removed in FlyStock" badge on the card and changes nothing else. If
  the description changed, update `stockName`, and update `name` too when it still equalled the
  old `stockName`.
- **L3 After-flight block** in the Log Flight form, for new flights. Editing a saved flight does
  not send another message.
- **L4 Message writer.** The flight save must succeed even if the message cannot be written;
  warn the pilot and retry at the next start.
- **L5 Unlink** action in the airframe edit dialog.
- **L6 Backup.** Carry the new fields through export, Replace and Merge. Decide whether Merge
  treats `stockId` as an identity match ahead of the name.
- **L7** All strings in en, uk and pt-BR.

### FlyStock requirements

- **S1 Message processor** as described in the contract.
- **S2 Badge** on linked items showing FlyLog status and hours, refreshed on a `storage` event
  for `flylog_drones`.
- **S3 IDs in export and import.** Add the item ID to the text format and keep it on import when
  it is valid and unused. Without this, a FlyStock export and re-import gives every item a new ID
  and breaks all links.
- **S4 Test harness.** Add a Playwright setup like FlyLog's; the static server can be copied.

### Edge cases to cover

- FlyStock never opened on the device, or its data unreadable.
- Linked item removed or deleted in FlyStock.
- FlyLog restored from a backup made on another device: `stockId` points at nothing here.
- Storage full when the message is written.
- Both apps open at once, in either order of actions.
- A flight deleted after its note was sent: the note stays in FlyStock.
- iOS installed apps: as far as known, each has separate storage, so the feature would only work
  between Safari tabs there. See decision 3.

### Tests

FlyLog-side behaviour is tested in FlyLog's suite against a seeded `stockroom_inventory_v1`
fixture, and FlyStock-side behaviour in FlyStock's suite against seeded FlyLog keys and
messages. A true two-app test can mount both checkouts under one server with
`startServer({mount})` when both repositories are present.

Acceptance: the workflow above passes end to end with both apps on one origin; applying the same
message twice adds one note; no message is lost with both apps open; a crafted FlyStock value
cannot inject markup or script into FlyLog, and the reverse.

## 5. Moving storage to IndexedDB

Not required for the exchange feature, and not urgent on size: a flight record is a few hundred
bytes, so the shared 5 MB localStorage quota holds on the order of 10,000 flights.

### What it changes

- The 5 MB quota shared by all apps on the origin is replaced by a share of free disk space.
- Load and save become asynchronous. Startup must wait for the load before rendering.
- One record can be written in an atomic transaction, instead of rewriting whole arrays.
- Attachments (photos, files) and indexed queries become possible.
- There is no `storage` event; live updates between open apps need a BroadcastChannel.
- Eviction rules are the same as for localStorage, so persistent storage and backups still
  matter. iOS isolation of installed apps is unchanged.

### Options considered

| Option | Effort | Result |
|---|---|---|
| Stay on localStorage | None | Fine until size or attachments are needed |
| IndexedDB as a blob store | Low | Removes the size limit only |
| **One database per app, one record per item** (chosen) | Medium per app | Atomic record writes, safe cross-app access, attachments |
| One shared database for the suite | High | A single airframe record for all apps, but releases become coupled through the shared schema |

### Target design

Database `flylog`, version 1:

| Store | Key | Indexes |
|---|---|---|
| `flights` | `id` | `droneId`, `startTime` |
| `drones` | `id` | `stockId` |
| `batteries` | `id` | |
| `customFields` | `id` | |
| `meta` | name | holds `droneStatuses`, `droneStatusColors`, `droneOrder`, `batteryOrder`, `migratedAt` |

Database `flystock`, version 1: `items` (key `id`, indexes `type`, `status`), `notes` (key `id`,
index `itemId`) and `meta` (holds `types`). Notes become their own records so that adding one is
a single write.

These stay in localStorage: language and UI flags, because they are needed before first paint,
and the exchange messages, because they are tiny and the `storage` event delivers them for free.

Rules:

- Only the owning app creates and upgrades its database.
- Another app must never call `indexedDB.open(name, version)` on a database it does not own:
  opening a missing database creates an empty one and can break the owner's upgrade. Check
  `indexedDB.databases()` first, open without a version, read in a read-only transaction and
  close at once. Close on `versionchange` so the owner's upgrade is not blocked.
- After each commit, post `{app, stores}` on a BroadcastChannel so other open pages refresh.

### Steps

1. **Storage layer first, no behaviour change.** Put all persistence behind one object per app
   (`load`, per-record put and delete, `replaceAll`). `renderAll()` stops calling `saveState()`;
   each mutation saves explicitly and rolls back memory on failure.
2. **Readers.** Make every cross-app reader try IndexedDB first and fall back to the
   localStorage key, and ship that before any app migrates.
3. **Migrate one app at a time.** On start, if the database has no `migratedAt` and the
   localStorage keys exist, pass them through the same validation as a backup import and write
   everything in one transaction.
4. **Keep the old keys** untouched for at least two releases, then remove them.
5. **Fallback.** If IndexedDB cannot be opened, keep using the localStorage backend.
6. **Persistence.** Call `navigator.storage.persist()` after the first save made by the pilot.

Backup files keep their format.

### Risks

- A tab still running the old code after migration writes to the old keys. Detect legacy keys
  that changed after `migratedAt` and offer them through the existing Merge import.
- Test fixtures seed localStorage. That keeps working and exercises the migration, but direct
  IndexedDB seeding helpers are needed too.
- Tests to add: data identical before and after migration, migration run twice, migration
  interrupted, IndexedDB unavailable, sibling database absent, two tabs open.

## 6. Plan

Each phase is a small batch with its own tests.

| Phase | Repository | Content |
|---|---|---|
| 1 | FlyLog | FlyStock reader, picker, `stockId` link, backup support (L1, L2, L5, L6) |
| 2 | FlyLog | After-flight block and message writer (L3, L4) |
| 3 | FlyStock | Message processor, badge, IDs in export/import, test harness (S1 to S4) |
| 4 | Both | Storage layer refactor, no behaviour change |
| 5 | Both | IndexedDB-aware readers, then migrate FlyLog, then FlyStock, then drop legacy keys |
| 6 | FlySky, FlyLog | Analyse FlySky; publish last known weather and bring back FlyLog's header box |
| 7 | All | File, clipboard or QR packets for devices that do not share storage, if needed |

Phase 1 needs no change in FlyStock and can start at once. Phase 3 needs push access to FlyStock.

## 7. Decisions needed from the owner

1. **FlyStock access.** Phase 3 needs a session that can push to `steelgar-code/FlyStock`.
2. **Write-off.** Should a FlyLog status such as "written off" also mark the item removed in
   FlyStock? Recommended: no, send a note only.
3. **iPhone.** Does the feature have to work between installed apps on iOS? If yes, phase 7 is
   required.
4. **CSV export.** Add "Status After" and "Airframe Note" columns at the end? Recommended: yes.
5. **Timing of the IndexedDB migration.** Recommended: after phase 3.

## 8. Other improvements suggested

- Ask the browser for persistent storage and show a "last backup N days ago" reminder.
- Download a safety backup automatically before a Replace import.
- Require a duration or both times when saving a flight; today it can be stored as 0 minutes.
- Run the tests in GitHub Actions on every push, and add Firefox and WebKit.
- Replace inline `onclick` handlers with event delegation, which allows a Content-Security-Policy.
- Split the JS and CSS out of `index.html`; no build step is needed for that.
- Make a real 192px icon and a small favicon; all four image files are the same 512px picture.
- Self-host Inter and JetBrains Mono, or remove them from the font list.
- Check for updates when an app left open for days is brought back to the foreground.
- Replace the static "v2.5 TAC-OPS" header label with a real version.
- The phone drawer covers the menu button when open and can only be closed through the overlay.
- Existing users see the "Update available" prompt once when moving from the old service worker,
  although the page is already current.

## 9. How the owner wants the work done

- The lead session plans and reviews; implementation goes to subagents, with the model chosen to
  fit the difficulty of each task.
- Small batches, each with tests. Run a risk-based subset while working and the full suite at
  milestones.
- Be economical with tokens.
- Ask when a decision is unclear instead of guessing.
- Replies to the owner should be short.
