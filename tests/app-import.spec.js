const {
  test, expect, CONTEXT_OPTIONS, KEYS, makeFixture, openApp, ready, store, goTo, logFlight,
  fleetCard, batteryCard, flightRow, editBtn, deleteBtn, expand, confirmDialog, downloadText,
} = require('./support/app');

test.use(CONTEXT_OPTIONS);

const now = new Date();
const DATA_PROPS = Object.keys(KEYS);

function backupOf(fx) {
  return {
    app: 'FlyLog Pro', backupVersion: 1, exportedAt: new Date().toISOString(),
    flights: fx.flights, drones: fx.drones, batteries: fx.batteries,
    droneStatuses: fx.droneStatuses, droneStatusColors: fx.droneStatusColors, customFields: fx.customFields,
  };
}

// Raw localStorage text of all six data keys.
async function rawSnapshot(page) {
  return page.evaluate((keys) => Object.fromEntries(keys.map((k) => [k, localStorage.getItem(k)])), Object.values(KEYS));
}

// Parsed data of all six keys, by fixture property name.
async function data(page) {
  const out = {};
  for (const prop of DATA_PROPS) out[prop] = await store(page, prop);
  return out;
}

const modal = (page) => page.locator('#modalImportChoice');

// Select a file in the hidden import input. `content` is an object (JSON-encoded) or raw text.
async function pickFile(page, content, name = 'flylog_backup.json') {
  const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  await page.locator('#importFileInput').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text, 'utf8') });
}

// Import a backup and answer the Replace/Merge dialog.
async function importAs(page, content, mode) {
  await pickFile(page, content);
  await expect(modal(page)).toBeVisible();
  await page.locator(mode === 'replace' ? '#btnImportReplace' : '#btnImportMerge').click();
  await expect(modal(page)).toBeHidden();
}

async function exportBackup(page) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#btnExportBackup').click()]);
  return JSON.parse(await downloadText(dl));
}

const toasts = (page) => page.locator('#toastContainer');

test.describe('choice dialog', () => {
  test('asks Replace or Merge, says plainly that Replace removes current data, and Cancel changes nothing', async ({ page }) => {
    const fx = makeFixture(now);
    await openApp(page, { fixture: fx });
    const before = await rawSnapshot(page);

    await pickFile(page, backupOf(fx));
    await expect(modal(page)).toBeVisible();
    await expect(modal(page)).toHaveAttribute('data-modal', /.*/);
    await expect(page.locator('#importChoiceContents')).toHaveText('This backup contains drones: 4, batteries: 3, flights: 5.');
    await expect(page.locator('#btnImportMerge')).toContainText('Merge');
    await expect(page.locator('#btnImportReplace')).toContainText('Replace');
    await expect(page.locator('#btnImportReplace')).toContainText('Remove all current drones, batteries, flights, statuses and custom fields from this device');
    await expect(page.locator('#btnImportReplace')).toContainText('This cannot be undone.');

    await page.locator('#btnImportCancel').click();
    await expect(modal(page)).toBeHidden();
    expect(await rawSnapshot(page)).toEqual(before);
    await expect(page.locator('#statTotalFlights')).toHaveText('5');
  });

  test('Escape closes the dialog without importing', async ({ page }) => {
    const fx = makeFixture(now);
    await openApp(page, { fixture: { ...fx, flights: [], drones: [], batteries: [] } });
    const before = await rawSnapshot(page);
    await pickFile(page, backupOf(fx));
    await expect(modal(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(modal(page)).toBeHidden();
    expect(await rawSnapshot(page)).toEqual(before);
    await expect(page.locator('#statTotalFlights')).toHaveText('0');
  });

  test('is translated', async ({ page }) => {
    const fx = makeFixture(now);
    await openApp(page, { fixture: fx, lang: 'uk' });
    await pickFile(page, backupOf(fx));
    await expect(page.locator('#importChoiceContents')).toHaveText('У резервній копії: дронів — 4, батарей — 3, польотів — 5.');
    await expect(page.locator('#btnImportReplace')).toContainText('Цю дію не можна скасувати.');
    await page.locator('#btnImportCancel').click();
  });
});

test.describe('Merge', () => {
  test('restoring a backup on the device it came from does not duplicate anything', async ({ page }) => {
    const fx = makeFixture(now);
    fx.customFields = [{ id: 'cf-pts', label: 'Points', type: 'number' }];
    fx.flights[0].customValues = { 'cf-pts': 3 };
    fx.droneStatusColors = { Maintenance: '#112233' };
    await openApp(page, { fixture: fx });
    const backup = await exportBackup(page);
    const before = await rawSnapshot(page);

    await importAs(page, backup, 'merge');
    await expect(toasts(page)).toContainText('Merge complete: 0 added, 12 skipped as already present');
    expect(await rawSnapshot(page)).toEqual(before);
    await expect(page.locator('#statTotalFlights')).toHaveText('5');
    await goTo(page, 'fleet');
    await expect(page.locator('#fleetGrid > div h3')).toHaveCount(4);
  });

  test('adds what is missing, and merging the same backup again changes nothing', async ({ page }) => {
    const fx = makeFixture(now);
    // The device has only part of the data plus a flight of its own.
    const local = makeFixture(now);
    local.drones = local.drones.slice(0, 2);
    local.batteries = local.batteries.slice(0, 1);
    local.flights = [local.flights[0], { ...local.flights[3], id: 'local-only', notes: 'Only on this device' }];
    await openApp(page, { fixture: local });

    await importAs(page, backupOf(fx), 'merge');
    // added: Charlie, Delta, Pack B, Pack C, f2, f3, f4, f5 = 8; skipped: Alpha, Bravo, Pack A, f1 = 4
    await expect(toasts(page)).toContainText('Merge complete: 8 added, 4 skipped as already present');
    const first = await rawSnapshot(page);
    const merged = await data(page);
    expect(merged.drones.map((d) => d.name)).toEqual(['Alpha Quad', 'Bravo Hex', 'Charlie Mini', 'Delta Spare']);
    expect(merged.batteries.map((b) => b.name)).toEqual(['Pack A', 'Pack B', 'Pack C']);
    expect(merged.flights.map((f) => f.notes).sort()).toEqual(
      ['', 'Battery swap test', 'Only on this device', 'Roof inspection', 'Survey, "north" field', 'Training\nsecond line'].sort(),
    );

    await importAs(page, backupOf(fx), 'merge');
    await expect(toasts(page)).toContainText('Merge complete: 0 added, 12 skipped as already present');
    expect(await rawSnapshot(page)).toEqual(first);

    await page.reload();
    await ready(page);
    expect(await rawSnapshot(page)).toEqual(first);
    await expect(page.locator('#statTotalFlights')).toHaveText('6');
  });

  test('a same-name drone, battery, field and status is the existing one, and flights attach to it', async ({ page }) => {
    const local = makeFixture(now);
    local.flights = [];
    local.customFields = [{ id: 'cf-local-pts', label: 'Points', type: 'number' }];
    await openApp(page, { fixture: local });

    const backup = {
      app: 'FlyLog Pro', backupVersion: 1,
      drones: [{ id: 'other-device-drone', name: '  alpha QUAD ', model: 'X', flightHours: 99, status: 'ready' }],
      batteries: [{ id: 'other-device-bat', name: 'PACK a', cycles: 1, flightHours: 0, status: 'Good' }],
      droneStatuses: ['READY', 'Maintenance'],
      droneStatusColors: {},
      customFields: [{ id: 'cf-remote', label: ' points ', type: 'number' }],
      flights: [{
        id: 'remote-1', droneId: 'other-device-drone', droneName: '  alpha QUAD ',
        batteryId: 'other-device-bat', batteryName: 'PACK a',
        startTime: '2026-01-05T10:00', endTime: '2026-01-05T10:20', duration: 20,
        notes: 'From the other device', customValues: { 'cf-remote': 7 },
      }],
    };
    await importAs(page, backup, 'merge');
    await expect(toasts(page)).toContainText('Merge complete: 1 added, 2 skipped as already present');

    const d = await data(page);
    expect(d.drones).toEqual(local.drones);
    expect(d.batteries).toEqual(local.batteries);
    expect(d.droneStatuses).toEqual(local.droneStatuses);
    expect(d.customFields).toEqual(local.customFields);
    expect(d.flights).toHaveLength(1);
    expect(d.flights[0]).toMatchObject({
      droneId: 'uav-alpha', batteryId: 'bat-a', duration: 20, notes: 'From the other device',
      customValues: { 'cf-local-pts': 7 },
    });

    await goTo(page, 'flights');
    await expect(flightRow(page, 'From the other device')).toContainText('Alpha Quad');
  });

  test('flights differing in any identity field are added, identical ones are skipped', async ({ page }) => {
    const fx = makeFixture(now);
    await openApp(page, { fixture: fx });
    const f1 = fx.flights[0];
    const backup = backupOf(fx);
    backup.flights = [
      { ...f1, id: 'copy' }, // identical apart from the id: skipped
      { ...f1, id: 'n', notes: 'Roof inspection 2' },
      { ...f1, id: 'd', duration: 31 },
      { ...f1, id: 'b', batteryId: 'bat-b', batteryName: 'Pack B' },
      { ...f1, id: 'a', droneId: 'uav-bravo', droneName: 'Bravo Hex' },
    ];
    await importAs(page, backup, 'merge');
    await expect(toasts(page)).toContainText('Merge complete: 4 added, 8 skipped as already present');
    expect(await store(page, 'flights')).toHaveLength(9);
  });
});

test.describe('Replace', () => {
  test('makes the data exactly the backup: export, change, Replace reproduces the same data', async ({ page }) => {
    const fx = makeFixture(now);
    fx.customFields = [{ id: 'cf-pts', label: 'Points', type: 'number' }, { id: 'cf-pilot', label: 'Pilot', type: 'text' }];
    fx.flights[0].customValues = { 'cf-pts': 3.5, 'cf-pilot': 'Sam' };
    fx.droneStatuses = ['Ready', 'Maintenance', 'Retired', 'Calibration'];
    fx.droneStatusColors = { Maintenance: '#112233', Calibration: '#abcdef' };
    fx.drones.reverse(); // custom order is part of the data
    await openApp(page, { fixture: fx });
    const backup = await exportBackup(page);
    const original = await rawSnapshot(page);

    await logFlight(page, { drone: 'Delta Spare', start: '2026-01-02T03:04', duration: 15, notes: 'Added after the backup' });
    await expect(page.locator('#statTotalFlights')).toHaveText('6');

    await importAs(page, backup, 'replace');
    await expect(toasts(page)).toContainText('Backup restored: 12 items loaded');
    expect(await rawSnapshot(page)).toEqual(original);
    expect(await exportBackup(page)).toMatchObject({
      flights: backup.flights, drones: backup.drones, batteries: backup.batteries,
      droneStatuses: backup.droneStatuses, droneStatusColors: backup.droneStatusColors, customFields: backup.customFields,
    });
    await expect(page.locator('#statTotalFlights')).toHaveText('5');
  });

  test('removes data that is not in the backup', async ({ page }) => {
    const fx = makeFixture(now);
    const local = makeFixture(now);
    local.drones.push({ id: 'uav-local', name: 'Local Only', model: '', flightHours: 0, status: 'Ready' });
    local.customFields = [{ id: 'cf-local', label: 'Local field', type: 'text' }];
    local.droneStatuses.push('Local status');
    await openApp(page, { fixture: local });

    await importAs(page, backupOf(fx), 'replace');
    expect(await data(page)).toEqual(fx);
    await goTo(page, 'fleet');
    await expect(fleetCard(page, 'Local Only')).toHaveCount(0);
  });
});

test.describe('validation', () => {
  test('malformed records and wrong types are dropped and counted; the rest imports and the app keeps working', async ({ page }) => {
    const fx = makeFixture(now);
    await openApp(page, { fixture: { ...fx, flights: [], drones: [], batteries: [] } });
    const good = fx.flights[0];
    const backup = backupOf(fx);
    backup.drones = [null, { id: 'x', name: 5 }, 'Alpha', { id: 'y', name: 'Bad hours', flightHours: 'lots' }, fx.drones[0]];
    backup.batteries = [42, fx.batteries[0], { id: 'z', name: 'Bad cycles', cycles: {} }];
    backup.flights = [
      null,
      { ...good, id: 'num-start', startTime: 1700000000000, notes: 'Numeric start' },
      { ...good, id: 'bad-date', startTime: 'yesterday', notes: 'Text start' },
      { ...good, id: 'bad-end', endTime: ['2026-01-01T10:00'], notes: 'Array end' },
      { ...good, id: 'bad-notes', notes: { text: 'object notes' } },
      { ...good, id: 'bad-duration', duration: 'long', notes: 'Bad duration' },
      { ...good, id: 'bad-cv', customValues: 'oops', notes: 'Bad custom values' },
      [1, 2, 3],
      good,
    ];
    backup.droneStatuses = ['Ready', 7, null, 'Maintenance'];
    // 4 drones + 2 batteries + 8 flights + 2 statuses = 16 malformed
    await importAs(page, backup, 'replace');
    await expect(toasts(page)).toContainText('Backup restored: 3 items loaded. 16 damaged records were ignored');

    const d = await data(page);
    expect(d.drones).toEqual([fx.drones[0]]);
    expect(d.batteries).toEqual([fx.batteries[0]]);
    expect(d.flights).toEqual([good]);
    expect(d.droneStatuses).toEqual(['Ready', 'Maintenance']);

    // Rendering and sorting still work (the fixture fails on any page error).
    await goTo(page, 'flights');
    await expect(flightRow(page, 'Roof inspection')).toHaveCount(1);
    await logFlight(page, { drone: 'Alpha Quad', start: '2026-01-02T03:04', duration: 15, notes: 'After import' });
    await expect(page.locator('#flightsTableBody tr')).toHaveCount(2);
    await page.reload();
    await ready(page);
    await expect(page.locator('#statTotalFlights')).toHaveText('2');
  });

  test('Merge of a backup whose only new flights are malformed adds nothing and leaves storage untouched', async ({ page }) => {
    const fx = makeFixture(now);
    await openApp(page, { fixture: fx });
    const before = await rawSnapshot(page);
    const backup = backupOf(fx);
    backup.flights = [null, { startTime: 5 }];
    await importAs(page, backup, 'merge');
    await expect(toasts(page)).toContainText('Merge complete: 0 added, 7 skipped as already present. 2 damaged records were ignored');
    expect(await rawSnapshot(page)).toEqual(before);
  });

  for (const [what, content, toast] of [
    ['not JSON', '{"flights": [', 'That file is not valid JSON'],
    ['a JSON array', '[1, 2, 3]', "That file doesn't look like a FlyLog backup"],
    ['an unrelated object', '{"hello": "world"}', "That file doesn't look like a FlyLog backup"],
    ['a backup with flights not a list', JSON.stringify({ app: 'FlyLog Pro', drones: [], batteries: [], flights: { a: 1 } }), "That file doesn't look like a FlyLog backup"],
  ]) {
    test(`a file that is ${what} is rejected with nothing changed`, async ({ page }) => {
      await openApp(page);
      const before = await rawSnapshot(page);
      await pickFile(page, content);
      await expect(toasts(page)).toContainText(toast);
      await expect(modal(page)).toBeHidden();
      expect(await rawSnapshot(page)).toEqual(before);
      await expect(page.locator('#statTotalFlights')).toHaveText('5');
    });
  }

  for (const mode of ['merge', 'replace']) {
    test(`${mode}: a drone status missing from the status list is added and shown on the card`, async ({ page }) => {
      const fx = makeFixture(now);
      await openApp(page, { fixture: fx });
      const backup = backupOf({
        ...fx,
        drones: [...fx.drones, { id: 'uav-echo', name: 'Echo Wing', model: '', flightHours: 0, status: 'Calibration' }],
      });
      await importAs(page, backup, mode);
      expect(await store(page, 'droneStatuses')).toEqual([...fx.droneStatuses, 'Calibration']);
      expect((await store(page, 'drones')).find((d) => d.name === 'Echo Wing').status).toBe('Calibration');
      await goTo(page, 'fleet');
      await expect(fleetCard(page, 'Echo Wing').locator('select')).toHaveValue('Calibration');
    });
  }
});

// A backup is untrusted: record ids are rendered into inline handlers
// (onclick="editFlight('<id>')"), option values and element ids, so an id
// that is not plainly safe must be replaced on import, in either mode.
test.describe('hostile ids in a backup', () => {
  const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
  const P = 'window.__pwned=1';
  // Short: every status is an option in every card's select, which sizes the card header.
  const STATUS_HTML = '<i>"s"</i>';
  const ids = {
    droneQuote: `x');${P};//`,
    droneHtml: `"><img src=x onerror="${P}">`,
    droneJs: `javascript:${P}`,
    droneLong: 'd'.repeat(5000),
    batQuote: `');${P};('`,
    batHtml: `<b>"x"</b><script>${P}</script>`,
    fieldNum: `cf');${P};//`,
    fieldText: `"><svg onload="${P}">`,
    ghostDrone: `ghost');${P};//`,
    ghostBat: `<ghost onmouseover="${P}">`,
  };
  const t0 = new Date(Date.UTC(2026, 0, 5, 10, 0));
  const at = (h) => `2026-01-05T${String(h).padStart(2, '0')}:00`;
  const fl = (o) => ({ startTime: at(o.h), endTime: at(o.h + 1), duration: 60, batteryId: null, batteryName: '', customValues: {}, ...o, h: undefined });

  function hostileBackup() {
    return {
      app: 'FlyLog Pro', backupVersion: 1, exportedAt: t0.toISOString(),
      droneStatuses: ['Ready', STATUS_HTML, 'constructor'],
      droneStatusColors: { constructor: '#123456', Ready: `red;background:url(javascript:${P})` },
      customFields: [
        { id: ids.fieldNum, label: 'Inj Num', type: 'number' },
        { id: ids.fieldText, label: 'Inj Text', type: 'text' },
        { id: [1], label: 'Inj Arr', type: 'text' },
        { id: '__proto__', label: 'Inj Proto', type: 'text' },
      ],
      drones: [
        { id: ids.droneQuote, name: 'Inj Quote', model: '', flightHours: 1, status: 'Ready' },
        { id: ids.droneHtml, name: 'Inj Html', model: `<img src=x onerror="${P}">`, flightHours: 0, status: STATUS_HTML },
        { id: ids.droneJs, name: 'Inj Js', model: '', flightHours: 0, status: 'constructor' },
        { id: ids.droneLong, name: 'Inj Long', model: '', flightHours: 0, status: 'Ready' },
        { id: { a: 1 }, name: 'Inj Obj', model: '', flightHours: 0, status: 'Ready' },
        { id: 1.5, name: 'Inj Float', model: '', flightHours: 0, status: 'Ready' },
      ],
      batteries: [
        { id: ids.batQuote, name: 'Inj Bat Quote', cycles: 1, flightHours: 0, status: 'Good' },
        { id: ids.batHtml, name: 'Inj Bat Html', cycles: 2, flightHours: 0, status: 'Warning' },
        { id: true, name: 'Inj Bat Bool', cycles: 3, flightHours: 0, status: 'Good' },
      ],
      flights: [
        fl({ id: `f');${P};//`, h: 1, droneId: ids.droneQuote, droneName: 'Inj Quote', batteryId: ids.batQuote, batteryName: 'Inj Bat Quote',
          notes: 'Inj flight one', customValues: { [ids.fieldNum]: 7, [ids.fieldText]: 'hello', ['__proto__']: 'x' } }),
        fl({ id: `"><img src=x onerror="${P}">`, h: 3, droneId: ids.droneHtml, droneName: 'Inj Html', batteryId: ids.batHtml, batteryName: 'Inj Bat Html',
          notes: `Inj flight two <img src=x onerror="${P}">`, customValues: { [ids.fieldText]: `<img src=x onerror="${P}">` } }),
        fl({ id: 'f'.repeat(5000), h: 5, droneId: ids.droneLong, droneName: 'Inj Long', notes: 'Inj flight three' }),
        fl({ id: { x: 1 }, h: 7, droneId: ids.droneJs, droneName: 'Inj Js', notes: 'Inj flight four' }),
        fl({ id: `javascript:${P}`, h: 9, droneId: ids.ghostDrone, droneName: 'Ghost Drone', batteryId: ids.ghostBat, batteryName: 'Ghost Pack', notes: 'Inj flight five' }),
        fl({ id: '<script>', h: 11, droneId: ids.ghostDrone, droneName: 'Ghost Drone', batteryId: ids.ghostBat, batteryName: 'Ghost Pack', notes: 'Inj flight six' }),
      ],
    };
  }

  async function expectNotPwned(page, dialogs) {
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
    expect(dialogs).toEqual([]);
  }

  for (const mode of ['replace', 'merge']) {
    test(`${mode}: no id from the file can run script; every stored id is safe and records stay linked and usable`, async ({ page }) => {
      const dialogs = [];
      page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
      await openApp(page, { fixture: makeFixture(now) });
      await importAs(page, hostileBackup(), mode);
      await expect(toasts(page)).toContainText(mode === 'replace' ? 'Backup restored' : 'Merge complete');

      const d = await data(page);
      const allIds = [
        ...d.drones.map((x) => x.id), ...d.batteries.map((x) => x.id), ...d.customFields.map((x) => x.id),
        ...d.flights.map((x) => x.id),
        ...d.flights.map((x) => x.droneId).filter((x) => x != null),
        ...d.flights.map((x) => x.batteryId).filter((x) => x != null),
        ...d.flights.flatMap((x) => Object.keys(x.customValues || {})),
      ];
      for (const id of allIds) expect(id, `stored id ${JSON.stringify(id).slice(0, 80)}`).toMatch(SAFE_ID);
      for (const list of [d.drones, d.batteries, d.flights, d.customFields]) {
        expect(new Set(list.map((x) => x.id)).size).toBe(list.length);
      }

      const byName = (list, name) => list.find((x) => x.name === name || x.label === name);
      const flightBy = (notes) => d.flights.find((f) => f.notes.startsWith(notes));
      const one = flightBy('Inj flight one');
      expect(one.droneId).toBe(byName(d.drones, 'Inj Quote').id);
      expect(one.batteryId).toBe(byName(d.batteries, 'Inj Bat Quote').id);
      expect(one.customValues).toEqual({
        [byName(d.customFields, 'Inj Num').id]: 7, [byName(d.customFields, 'Inj Text').id]: 'hello', [byName(d.customFields, 'Inj Proto').id]: 'x',
      });
      const two = flightBy('Inj flight two');
      expect(two.droneId).toBe(byName(d.drones, 'Inj Html').id);
      expect(two.batteryId).toBe(byName(d.batteries, 'Inj Bat Html').id);
      expect(two.customValues).toEqual({ [byName(d.customFields, 'Inj Text').id]: `<img src=x onerror="${P}">` });
      expect(flightBy('Inj flight three').droneId).toBe(byName(d.drones, 'Inj Long').id);
      expect(flightBy('Inj flight four').droneId).toBe(byName(d.drones, 'Inj Js').id);
      for (const name of ['Inj Arr', 'Inj Proto']) expect(byName(d.customFields, name)).toBeTruthy();
      for (const name of ['Inj Obj', 'Inj Float']) expect(byName(d.drones, name)).toBeTruthy();
      expect(byName(d.batteries, 'Inj Bat Bool')).toBeTruthy();
      // Statuses keep their names; a colour that is not '#rrggbb' is dropped.
      expect(d.droneStatusColors.Ready).not.toBe(hostileBackup().droneStatusColors.Ready);

      const five = flightBy('Inj flight five');
      const six = flightBy('Inj flight six');
      if (mode === 'replace') {
        // References to items not in the backup are kept, under one safe id each.
        expect(five.droneId).toBeTruthy();
        expect(six.droneId).toBe(five.droneId);
        expect(six.batteryId).toBe(five.batteryId);
        expect(d.drones.some((x) => x.id === five.droneId)).toBe(false);
        expect(d.batteries.some((x) => x.id === five.batteryId)).toBe(false);
      }
      expect(five.droneName).toBe('Ghost Drone');

      // Render every list that carries ids, then use the injected records' buttons.
      await goTo(page, 'flights');
      await expect(flightRow(page, 'Inj flight one')).toHaveCount(1);
      await expect(flightRow(page, 'Inj flight two')).toContainText('<img src=x');
      await editBtn(flightRow(page, 'Inj flight one')).click();
      await expect(page.locator('#modalLogFlight')).toBeVisible();
      await expect(page.locator('#flightDrone')).toHaveValue(one.droneId);
      await expect(page.locator('#flightBattery')).toHaveValue(one.batteryId);
      await expect(page.locator('#customFieldsFormContainer').getByLabel('Inj Num', { exact: true })).toHaveValue('7');
      await expect(page.locator('#customFieldsFormContainer').getByLabel('Inj Text', { exact: true })).toHaveValue('hello');
      await page.keyboard.press('Escape');
      await expect(page.locator('#modalLogFlight')).toBeHidden();
      if (mode === 'replace') {
        await editBtn(flightRow(page, 'Inj flight five')).click();
        await expect(page.locator('#flightDrone')).toHaveValue(five.droneId);
        await page.keyboard.press('Escape');
        await expect(page.locator('#modalLogFlight')).toBeHidden();
      }
      await deleteBtn(flightRow(page, 'Inj flight two')).click();
      await confirmDialog(page);
      await expect(flightRow(page, 'Inj flight two')).toHaveCount(0);
      expect((await store(page, 'flights')).some((f) => f.notes.startsWith('Inj flight two'))).toBe(false);

      await goTo(page, 'fleet');
      for (const name of ['Inj Quote', 'Inj Html', 'Inj Js', 'Inj Long', 'Inj Obj', 'Inj Float']) await expand(fleetCard(page, name));
      await fleetCard(page, 'Inj Quote').locator('[data-edit]').click();
      await expect(page.locator('#modalDrone')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('#modalDrone')).toBeHidden();
      await fleetCard(page, 'Inj Html').locator('[data-delete]').click();
      await confirmDialog(page);
      await expect(fleetCard(page, 'Inj Html')).toHaveCount(0);

      await goTo(page, 'batteries');
      await expand(batteryCard(page, 'Inj Bat Quote'));
      await batteryCard(page, 'Inj Bat Quote').locator('[data-delete]').click();
      await confirmDialog(page);
      await expect(batteryCard(page, 'Inj Bat Quote')).toHaveCount(0);

      await page.evaluate(() => openStatusesModal());
      await expect(page.locator('#modalManageStatuses')).toBeVisible();
      await expect(page.locator('#statusListContainer')).toContainText(STATUS_HTML);
      await page.keyboard.press('Escape');
      await expect(page.locator('#modalManageStatuses')).toBeHidden();
      await page.evaluate(() => openFieldsModal());
      const fieldRow = page.locator('#fieldsListContainer > div').filter({ hasText: 'Inj Text' });
      await fieldRow.locator('button').click();
      await confirmDialog(page);
      await expect(fieldRow).toHaveCount(0);
      expect((await store(page, 'customFields')).some((f) => f.label === 'Inj Text')).toBe(false);
      await page.keyboard.press('Escape');
      await expect(page.locator('#modalManageFields')).toBeHidden();

      await goTo(page, 'dashboard');
      await expectNotPwned(page, dialogs);
    });
  }

  test('ids the app itself generates, and the demo ids, survive Replace unchanged', async ({ page }) => {
    const fx = makeFixture(now);
    fx.drones[0].id = 'uav-1';
    fx.drones[1].id = 'uav-1700000000000';
    fx.batteries[0].id = 'bat-1700000000000';
    fx.customFields = [{ id: 'cf-1700000000000-ab12c', label: 'Points', type: 'number' }, { id: 'cf-1700000000000-x9y8z7w', label: 'Pilot', type: 'text' }];
    fx.flights.forEach((f) => {
      if (f.droneId === 'uav-alpha') f.droneId = 'uav-1';
      if (f.droneId === 'uav-bravo') f.droneId = 'uav-1700000000000';
      if (f.batteryId === 'bat-a') f.batteryId = 'bat-1700000000000';
    });
    fx.flights[0].id = '1';
    fx.flights[1].id = '1700000000000';
    fx.flights[2].id = 'flt-1700000000000-k3j4h5g';
    fx.flights[0].customValues = { 'cf-1700000000000-ab12c': 2, 'cf-1700000000000-x9y8z7w': 'Sam' };
    await openApp(page, { fixture: makeFixture(now) });
    await importAs(page, backupOf(fx), 'replace');
    expect(await data(page)).toEqual(fx);
  });
});
