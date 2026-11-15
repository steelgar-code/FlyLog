# FlyLog handoff: FlyStock exchange and storage migration

Written 15 Nov 2026, revised the same day after the owner simplified the feature. Describes
branch `ccr-dca4a52c-yl3ehm` in FlyLog and FlyStock (not yet merged to `main`; FlyLog `main` is
at `99f8604`, FlyStock `main` at `cbd12f9`). FlySky was cloned but not analysed.

Section 4 is implemented on the branch. Section 5 (IndexedDB) is a plan only.

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

On branch `ccr-dca4a52c-yl3ehm`, 15 Nov 2026 (see section 4): airframes can be added from
FlyStock and stay linked to their item; linked airframes have deep links into FlyStock's edit
and remove forms; FlyStock handles those links and has its first test suite.

Decisions still needed from the owner are in section 7.

## 2. FlyLog as it is now

### Files

| Path | Role |
|---|---|
| `index.html` | All HTML, CSS and JS (about 4,300 lines) |
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
| `flylog_stock_type_filter` | Last type filter chosen in the FlyStock picker |
| `flylog_corrupt_<name>` | Copy of a stored value that could not be parsed |

### Record shapes

```
drone   { id, name, model, flightHours, status, stockId?, stockName? }
          stockId: FlyStock item id, only on airframes added from FlyStock
          stockName: FlyStock description as last seen (detects a rename)
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
- **Cross-app hooks (at `cbd12f9`):** none, apart from footer links to the sibling apps. The
  branch adds the deep links of section 4.
- **Tests (at `cbd12f9`):** none. The branch adds a Playwright suite set up like FlyLog's.

## 4. Feature: airframes from FlyStock, deep links back (implemented)

### What the owner asked for

A new airframe is added to FlyStock first. In FlyLog the pilot pulls the list of FlyStock items
and adds selected ones as airframes. From a linked airframe the pilot can jump straight to that
item's edit or remove form in FlyStock, for example to note a repair or write the airframe off.
Everything stays serverless.

The first design also had an "Airframe after flight" block in Log Flight and a message queue
that delivered notes to FlyStock. The owner rejected both on 15 Nov 2026: no `statusAfter` or
`airframeNote` fields, no messages, no FlyLog status badge in FlyStock. Do not bring them back
without asking.

### Design rules

- Each app is the only writer of its own data. FlyLog reads `stockroom_inventory_v1` and never
  writes it. Anything the pilot wants changed in FlyStock is done in FlyStock, reached by a link.
- Everything read from the other app, and everything in a deep link, is untrusted: check types
  and lengths, apply `SAFE_ID_RE` to IDs, render through `escapeHtml` or `textContent`.
- Nothing breaks when the other app has never been used on the device.
- FlyStock owns an item's identity, description and removal. FlyLog owns status and hours.

### FlyLog (in `index.html`)

- **Reader** `readFlyStock()`: validates the FlyStock value; returns the active items for the
  picker and a `byId` map of all valid items (with a removed flag) for link upkeep.
- **Picker** "Add from FlyStock…": a button in the Fleet tab and the last entry of the airframe
  list in Log Flight (a sentinel value that is never stored as a `droneId`; with an empty fleet a
  blank placeholder is selected first). Lists active items not linked yet, with search, a
  remembered type filter and multi-select. Name comes from the description, model from the type.
- **Link upkeep** `syncStockLinks()`: runs at startup, when the Fleet tab opens and on a
  `storage` event for the FlyStock key. A changed description updates `stockName`, and `name`
  too when it still equalled the old `stockName`. A removed item shows "Removed in FlyStock", a
  missing item or unreadable FlyStock data shows "Not found in FlyStock"; both badges are
  computed at render time and never stored.
- **Unlink** in the airframe edit dialog. The item is then offered by the picker again.
- **Deep links** `flyStockItemUrl(action, stockId)`: "Open in FlyStock" and "Remove in FlyStock"
  in the edit dialog, and the FlyStock badge on the fleet card is the open link. Active item:
  both; removed item: open only; not found: none.
- **Backup:** `stockId` and `stockName` go through export, Replace and Merge. An invalid
  `stockId` is dropped; within one file the first airframe keeps a duplicated `stockId`. Merge
  matches by `stockId` first, then by name; an existing link wins; no two airframes ever share a
  `stockId`. CSV export is unchanged.

### Deep-link contract

```
https://steelgar-code.github.io/FlyStock/#edit=<item id>
https://steelgar-code.github.io/FlyStock/#remove=<item id>
```

FlyStock handles the hash at startup and on `hashchange`, accepts only these two actions and an
ID matching `SAFE_ID_RE`, opens its existing Edit or Remove panel (`#remove` on an already
removed item opens Edit), shows a notice when the item does not exist, and then clears the hash.
Both repositories test this format; change it in both or not at all.

### Known gaps

- FlyStock's text export has no item IDs and its import assigns new ones, so a FlyStock export
  and re-import (for example onto a new device) breaks every link; the airframes then show
  "Not found in FlyStock". Fix: add the ID to the text format and keep it on import when valid
  and unused. Not done; see decision 2.
- The FlyStock URL is absolute, so the links only reach the published site, not a local copy.
- iOS installed apps have separate storage: the picker sees FlyStock data only between Safari
  tabs there. The owner does not need this now.
- There is no automated test that runs both apps on one origin; the workflow was checked once
  with a throwaway script (add from FlyStock, follow both links). `startServer` in
  `tests/support/server.js` can serve a folder holding both checkouts if a permanent test is
  wanted.

### FlyStock tests

`npm install`, then `npm test` in FlyStock (27 tests: smoke and deep links). The test server
uses port 4174 and FlyLog's uses 4173, so both suites can run at the same time; with the same
port one suite would silently reuse the other app's server.

## 5. Moving storage to IndexedDB

Not urgent on size: a flight record is a few hundred
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

These stay in localStorage: language and UI flags, because they are needed before first paint.

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

| Phase | Repository | Content | State |
|---|---|---|---|
| 1 | FlyLog | FlyStock reader, picker, link upkeep, unlink, backup support | Done on the branch |
| 2 | Both | Deep links from FlyLog into FlyStock's edit and remove forms; FlyStock test suite | Done on the branch |
| 3 | FlyStock | Item IDs in text export and import | Open, decision 2 |
| 4 | Both | Storage layer refactor, no behaviour change | Open |
| 5 | Both | IndexedDB-aware readers, then migrate FlyLog, then FlyStock, then drop legacy keys | Open |
| 6 | FlySky, FlyLog | Analyse FlySky; publish last known weather and bring back FlyLog's header box | Open |

## 7. Decisions needed from the owner

1. **Merging.** The branch `ccr-dca4a52c-yl3ehm` in FlyLog and FlyStock is not merged. Publish
   FlyStock first or together with FlyLog, otherwise the new links open FlyStock without a form.
2. **FlyStock item IDs in export/import** (phase 3). Recommended: yes, it protects the links.
3. **Timing of the IndexedDB migration.** Recommended: only when size or attachments require it.

Decided on 15 Nov 2026: no after-flight block and no messages (section 4); the feature does not
have to work between installed apps on iOS; backup Merge matches by FlyStock link first.

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
