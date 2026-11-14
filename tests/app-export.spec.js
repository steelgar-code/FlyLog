const {
  test, expect, CONTEXT_OPTIONS, makeFixture, openApp, store, downloadText, parseCsv, logFlight,
} = require('./support/app');

test.use(CONTEXT_OPTIONS);

const now = new Date();

async function download(page, buttonId) {
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.locator(buttonId).click(),
  ]);
  return dl;
}

test.describe('JSON backup', () => {
  test('has the expected structure and the stored data', async ({ page }) => {
    const fx = makeFixture(now);
    fx.customFields = [{ id: 'cf-pts', label: 'Points', type: 'number' }, { id: 'cf-pilot', label: 'Pilot', type: 'text' }];
    fx.flights[0].customValues = { 'cf-pts': 3, 'cf-pilot': 'Sam' };
    fx.droneStatusColors = { Maintenance: '#112233' };
    await openApp(page, { fixture: fx });

    const dl = await download(page, '#btnExportBackup');
    expect(dl.suggestedFilename()).toMatch(/^flylog_backup_\d{4}-\d{2}-\d{2}\.json$/);
    const backup = JSON.parse(await downloadText(dl));

    expect(Object.keys(backup).sort()).toEqual([
      'app', 'backupVersion', 'batteries', 'customFields', 'droneStatusColors', 'droneStatuses', 'drones', 'exportedAt', 'flights',
    ]);
    expect(backup.app).toBe('FlyLog Pro');
    expect(backup.backupVersion).toBe(1);
    expect(new Date(backup.exportedAt).toISOString()).toBe(backup.exportedAt);
    expect(Math.abs(Date.now() - Date.parse(backup.exportedAt))).toBeLessThan(5 * 60 * 1000);

    expect(backup.drones).toEqual(fx.drones);
    expect(backup.batteries).toEqual(fx.batteries);
    expect(backup.flights).toEqual(fx.flights);
    expect(backup.droneStatuses).toEqual(fx.droneStatuses);
    expect(backup.droneStatusColors).toEqual({ Maintenance: '#112233' });
    expect(backup.customFields).toEqual(fx.customFields);
  });

  test('reflects changes made in the app', async ({ page }) => {
    await openApp(page);
    await logFlight(page, { drone: 'Delta Spare', battery: 'Pack C', start: '2026-01-02T03:04', duration: 15, notes: 'Added in test' });
    const backup = JSON.parse(await downloadText(await download(page, '#btnExportBackup')));
    expect(backup.flights).toHaveLength(6);
    expect(backup.flights[0]).toMatchObject({ droneId: 'uav-delta', droneName: 'Delta Spare', batteryName: 'Pack C', duration: 15, notes: 'Added in test' });
    // same as what is in localStorage
    expect(backup.flights).toEqual(await store(page, 'flights'));
    expect(backup.drones).toEqual(await store(page, 'drones'));
  });

  test('backup of an empty app has empty collections', async ({ page }) => {
    await openApp(page, { fixture: { ...makeFixture(), flights: [], drones: [], batteries: [] } });
    const backup = JSON.parse(await downloadText(await download(page, '#btnExportBackup')));
    expect(backup).toMatchObject({ app: 'FlyLog Pro', flights: [], drones: [], batteries: [], customFields: [] });
  });
});

test.describe('CSV export', () => {
  test('has the right header and one correctly escaped row per flight, newest first', async ({ page }) => {
    const fx = makeFixture(now);
    await openApp(page, { fixture: fx });

    const dl = await download(page, '#btnExportCSV');
    expect(dl.suggestedFilename()).toMatch(/^flylog_flights_\d{4}-\d{2}-\d{2}\.csv$/);
    const text = await downloadText(dl);

    // raw text: header line, and escaping of commas / quotes / newlines inside quoted cells
    expect(text.split('\n')[0]).toBe('"Airframe","Battery","Start Time","End Time","Duration (Min)","Notes"');
    const f = (id) => fx.flights.find((x) => x.id === id);
    expect(text).toContain(`"Alpha Quad","Pack B","${f('f2').startTime}","${f('f2').endTime}",30,"Survey, ""north"" field"`);
    expect(text).toContain(`"Bravo Hex","Pack A","${f('f3').startTime}","${f('f3').endTime}",60,"Training\nsecond line"`);
    expect(text.endsWith('\n')).toBe(true);

    // parsed: structure round-trips
    const rows = parseCsv(text);
    expect(rows[0]).toEqual(['Airframe', 'Battery', 'Start Time', 'End Time', 'Duration (Min)', 'Notes']);
    expect(rows).toHaveLength(6);
    expect(rows.slice(1).every((r) => r.length === 6)).toBe(true);
    // newest first: f5, f1, f4, f2, f3
    expect(rows.slice(1)).toEqual([
      ['Charlie Mini', 'Pack C', f('f5').startTime, f('f5').endTime, '30', ''],
      ['Alpha Quad', 'Pack A', f('f1').startTime, f('f1').endTime, '30', 'Roof inspection'],
      ['Bravo Hex', '', f('f4').startTime, f('f4').endTime, '20', 'Battery swap test'],
      ['Alpha Quad', 'Pack B', f('f2').startTime, f('f2').endTime, '30', 'Survey, "north" field'],
      ['Bravo Hex', 'Pack A', f('f3').startTime, f('f3').endTime, '60', 'Training\nsecond line'],
    ]);
  });

  test('includes custom field columns (numeric default 0, text default empty)', async ({ page }) => {
    const fx = makeFixture(now);
    fx.customFields = [{ id: 'cf-pts', label: 'Points, scored', type: 'number' }, { id: 'cf-pilot', label: 'Pilot', type: 'text' }];
    fx.flights[0].customValues = { 'cf-pts': 3.5, 'cf-pilot': 'Sam "the pilot", Jr' };
    await openApp(page, { fixture: fx });
    const text = await downloadText(await download(page, '#btnExportCSV'));
    expect(text.split('\n')[0]).toBe('"Airframe","Battery","Start Time","End Time","Duration (Min)","Notes","Points, scored","Pilot"');
    const rows = parseCsv(text);
    expect(rows.every((r) => r.length === 8)).toBe(true);
    const roof = rows.find((r) => r[5] === 'Roof inspection');
    expect(roof.slice(6)).toEqual(['3.5', 'Sam "the pilot", Jr']);
    const swap = rows.find((r) => r[5] === 'Battery swap test');
    expect(swap.slice(6)).toEqual(['0', '']);
  });

  test('neutralises spreadsheet formulas at the start of a text cell', async ({ page }) => {
    const fx = makeFixture(now);
    fx.flights[0].notes = '=SUM(A1:A2)';
    await openApp(page, { fixture: fx });
    const rows = parseCsv(await downloadText(await download(page, '#btnExportCSV')));
    const row = rows.find((r) => r[5].includes('SUM(A1:A2)'));
    expect(row[5]).toBe("'=SUM(A1:A2)");
  });

  test('exports nothing (no download) when there are no flights', async ({ page }) => {
    await openApp(page, { fixture: { ...makeFixture(), flights: [] } });
    let downloaded = false;
    page.on('download', () => { downloaded = true; });
    await page.locator('#btnExportCSV').click();
    await expect(page.locator('#toastContainer')).toContainText('No flight logs to export');
    expect(downloaded).toBe(false);
  });
});
