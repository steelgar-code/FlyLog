const {
  test, expect, CONTEXT_OPTIONS, KEYS, makeFixture, openApp, ready, store, logFlight,
} = require('./support/app');

test.use(CONTEXT_OPTIONS);

const now = new Date();

async function rawSnapshot(page) {
  return page.evaluate((keys) => Object.fromEntries(keys.map((k) => [k, localStorage.getItem(k)])), Object.values(KEYS));
}

// Make localStorage.setItem throw a QuotaExceededError for one key (in this
// page only, until reload).
async function failWritesTo(page, failKey) {
  await page.evaluate((failKey) => {
    const real = Storage.prototype.setItem;
    window.__setItemCalls = [];
    Storage.prototype.setItem = function (key, value) {
      window.__setItemCalls.push(key);
      if (key === failKey) throw new DOMException('Quota exceeded (test stub)', 'QuotaExceededError');
      return real.call(this, key, value);
    };
  }, failKey);
}

const toasts = (page) => page.locator('#toastContainer');

test.describe('saving is all-or-nothing', () => {
  test('a quota failure partway through a save puts back the keys already written', async ({ page }) => {
    await openApp(page);
    const before = await rawSnapshot(page);
    await failWritesTo(page, KEYS.droneStatuses); // the fourth of the six keys

    // Change data behind all six keys, then save.
    const ok = await page.evaluate(() => {
      state.flights = [];
      state.drones = [{ id: 'n', name: 'New', model: '', flightHours: 0, status: 'Ready' }];
      state.batteries = [];
      state.droneStatuses = ['Ready'];
      state.droneStatusColors = { Ready: '#000000' };
      state.customFields = [{ id: 'cf', label: 'F', type: 'text' }];
      return saveState();
    });
    expect(ok).toBe(false);
    // The save really did get partway: the first three keys were written before the failure.
    expect(await page.evaluate(() => window.__setItemCalls.slice(0, 4))).toEqual(
      [KEYS.flights, KEYS.drones, KEYS.batteries, KEYS.droneStatuses],
    );
    expect(await rawSnapshot(page)).toEqual(before);
    await expect(toasts(page)).toContainText('Could not save changes locally — storage may be full');
  });

  test('a key that did not exist before a failed save is removed again', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => localStorage.removeItem('flylog_custom_fields'));
    const before = await rawSnapshot(page);
    expect(before[KEYS.customFields]).toBeNull();
    await failWritesTo(page, KEYS.customFields);
    const ok = await page.evaluate(() => {
      state.flights = [];
      state.customFields = [{ id: 'cf', label: 'F', type: 'text' }];
      return saveState();
    });
    expect(ok).toBe(false);
    expect(await rawSnapshot(page)).toEqual(before);
  });

  test('a Replace import that cannot be saved leaves storage and the app as they were', async ({ page }) => {
    await openApp(page);
    const before = await rawSnapshot(page);
    await failWritesTo(page, KEYS.droneStatusColors);
    const fx = makeFixture(now);
    const backup = {
      app: 'FlyLog Pro', backupVersion: 1,
      flights: fx.flights.slice(0, 1), drones: [fx.drones[0]], batteries: [], droneStatuses: ['Ready'],
      droneStatusColors: { Ready: '#123456' }, customFields: [],
    };
    await page.locator('#importFileInput').setInputFiles({ name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    await page.locator('#btnImportReplace').click();
    await expect(toasts(page)).toContainText('Import failed, nothing was changed');
    expect(await rawSnapshot(page)).toEqual(before);
    await expect(page.locator('#statTotalFlights')).toHaveText('5');
    expect(await page.evaluate(() => state.drones.length)).toBe(4);
  });

  test('normal saves still write every key', async ({ page }) => {
    await openApp(page);
    await logFlight(page, { drone: 'Alpha Quad', start: '2026-01-02T03:04', duration: 15, notes: 'Saved' });
    expect((await store(page, 'flights')).map((f) => f.notes)).toContain('Saved');
  });
});

test.describe('damaged stored data', () => {
  test('unparseable JSON is preserved under a backup key and the pilot is warned once', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => localStorage.setItem('flylog_flights', '[{"id":"1", "notes": "half-writ'));
    await page.reload();
    await ready(page);

    await expect(toasts(page)).toContainText('Some saved data could not be read. A copy of it was kept on this device');
    expect(await page.evaluate(() => localStorage.getItem('flylog_corrupt_flights'))).toBe('[{"id":"1", "notes": "half-writ');
    // The app went on with defaults and saved them, but the damaged value survives.
    expect(Array.isArray(await store(page, 'flights'))).toBe(true);

    // Next start: nothing is damaged any more, so no warning, and the copy is still there.
    await page.reload();
    await ready(page);
    await expect(toasts(page)).not.toContainText('could not be read');
    expect(await page.evaluate(() => localStorage.getItem('flylog_corrupt_flights'))).toBe('[{"id":"1", "notes": "half-writ');
  });

  test('a value of the wrong shape is treated as damaged too', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => localStorage.setItem('flylog_drones', '{"not":"a list"}'));
    await page.reload();
    await ready(page);
    await expect(toasts(page)).toContainText('Some saved data could not be read');
    expect(await page.evaluate(() => localStorage.getItem('flylog_corrupt_drones'))).toBe('{"not":"a list"}');
  });

  test('a second, different damaged value does not overwrite the first preserved copy', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      localStorage.setItem('flylog_corrupt_flights', 'older damage');
      localStorage.setItem('flylog_flights', 'newer damage');
    });
    await page.reload();
    await ready(page);
    const copies = await page.evaluate(() => Object.keys(localStorage)
      .filter((k) => k.startsWith('flylog_corrupt_flights')).sort()
      .map((k) => localStorage.getItem(k)));
    expect(copies.sort()).toEqual(['newer damage', 'older damage']);
  });

  test('if the damaged value cannot be copied, nothing is saved over it this session', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => localStorage.setItem('flylog_flights', 'not json'));
    await page.addInitScript(() => {
      const real = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (String(key).startsWith('flylog_corrupt_')) throw new DOMException('Quota exceeded (test stub)', 'QuotaExceededError');
        return real.call(this, key, value);
      };
    });
    await page.reload();
    await ready(page);
    await expect(toasts(page)).toContainText('FlyLog will not save changes in this session');
    await logFlight(page, { drone: 'Alpha Quad', start: '2026-01-02T03:04', duration: 15, notes: 'Not saved' });
    expect(await page.evaluate(() => localStorage.getItem('flylog_flights'))).toBe('not json');
  });
});
