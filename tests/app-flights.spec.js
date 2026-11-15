const {
  test, expect, CONTEXT_OPTIONS, makeFixture, openApp, store, goTo, logFlight, fillFlightForm,
  flightRow, editBtn, deleteBtn, confirmDialog, fmt,
} = require('./support/app');

test.use(CONTEXT_OPTIONS);

const now = new Date();
const hoursAgo = (h) => new Date(now.getTime() - h * 3600000);

test.describe('log a flight', () => {
  test('saves a flight, shows it in the log and recent table, updates dashboard totals, persists', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('#statTotalHours')).toHaveText('2h 50m');

    const start = fmt(hoursAgo(3));
    const end = fmt(new Date(hoursAgo(3).getTime() + 90 * 60000));
    await page.locator('#btnNewFlightHeader').click();
    await fillFlightForm(page, {
      drone: 'Bravo Hex', battery: 'Pack B', start, duration: 90, notes: 'Night mapping run',
    });
    // end time was derived from start + duration
    await expect(page.locator('#flightEndTime')).toHaveValue(end);
    await page.locator('#formLogFlight button[type="submit"]').click();
    await expect(page.locator('#modalLogFlight')).toBeHidden();

    // dashboard totals: 170 + 90 = 260 min, 6 flights
    await expect(page.locator('#statTotalHours')).toHaveText('4h 20m');
    await expect(page.locator('#statTotalFlights')).toHaveText('6');
    await expect(page.locator('#badgeFlightCount')).toHaveText('6');
    // newest flight first in the dashboard "recent" table
    const firstRecent = page.locator('#dashboardRecentTable tr').first();
    await expect(firstRecent).toContainText('Bravo Hex');
    await expect(firstRecent).toContainText('Night mapping run');
    await expect(firstRecent).toContainText('90');

    // log view
    await goTo(page, 'flights');
    const row = flightRow(page, 'Night mapping run');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Bravo Hex');
    await expect(row).toContainText('Pack B');
    await expect(row).toContainText(start.replace('T', ' '));
    await expect(page.locator('#flightsTableBody tr')).toHaveCount(6);

    // persisted
    const flights = await store(page, 'flights');
    expect(flights).toHaveLength(6);
    expect(flights[0]).toMatchObject({
      droneId: 'uav-bravo', droneName: 'Bravo Hex', batteryId: 'bat-b', batteryName: 'Pack B',
      startTime: start, endTime: end, duration: 90, notes: 'Night mapping run',
    });
    expect(typeof flights[0].id).toBe('string');
  });

  test('data survives a reload', async ({ page }) => {
    await openApp(page);
    await logFlight(page, { drone: 'Alpha Quad', start: fmt(hoursAgo(5)), duration: 12, notes: 'Reload check' });
    await page.reload();
    await expect(page.locator('#statTotalFlights')).toHaveText('6');
    await expect(page.locator('#statTotalHours')).toHaveText('3h 2m');
    await goTo(page, 'flights');
    await expect(flightRow(page, 'Reload check')).toHaveCount(1);
    await expect(page.locator('#flightsTableBody tr')).toHaveCount(6);
  });

  test('airframe is required: cannot save without a drone', async ({ page }) => {
    await openApp(page, { fixture: { ...makeFixture(), drones: [], flights: [] } });
    await page.locator('#btnNewFlightHeader').click();
    await expect(page.locator('#flightDrone option')).toHaveText(['—', 'Add from FlyStock…']);
    await expect(page.locator('#flightDrone')).toHaveValue('');
    await page.locator('#flightNotes').fill('no drone');
    await page.locator('#formLogFlight button[type="submit"]').click();
    await expect(page.locator('#modalLogFlight')).toBeVisible();
    expect(await page.locator('#flightDrone').evaluate((el) => el.validity.valueMissing)).toBe(true);
    expect(await store(page, 'flights')).toEqual([]);
  });

  test('cancel closes the modal without saving', async ({ page }) => {
    await openApp(page);
    await page.locator('#btnNewFlightHeader').click();
    await page.locator('#flightNotes').fill('discard me');
    await page.locator('#btnCancelFlight').click();
    await expect(page.locator('#modalLogFlight')).toBeHidden();
    expect(await store(page, 'flights')).toHaveLength(5);
  });

  test('airframe and battery dropdowns list fleet items; battery is optional', async ({ page }) => {
    await openApp(page);
    await page.locator('#btnNewFlightHeader').click();
    await expect(page.locator('#flightDrone option')).toHaveText(['Alpha Quad', 'Bravo Hex', 'Charlie Mini', 'Delta Spare', 'Add from FlyStock…']);
    await expect(page.locator('#flightBattery option')).toHaveCount(4); // none + 3
    await fillFlightForm(page, { drone: 'Delta Spare', start: fmt(hoursAgo(2)), duration: 10, notes: 'no battery' });
    await page.locator('#formLogFlight button[type="submit"]').click();
    await expect(page.locator('#modalLogFlight')).toBeHidden();
    const saved = (await store(page, 'flights'))[0];
    expect(saved).toMatchObject({ droneId: 'uav-delta', batteryId: null, batteryName: '' });
  });
});

test.describe('start / end / duration auto-calculator', () => {
  const S = '2026-05-10T10:00';
  const E = '2026-05-10T10:45';

  test.beforeEach(async ({ page }) => {
    await openApp(page);
    await page.locator('#btnNewFlightHeader').click();
  });

  test('start + end fills duration', async ({ page }) => {
    await page.locator('#flightStartTime').fill(S);
    await page.locator('#flightEndTime').fill(E);
    await expect(page.locator('#flightDuration')).toHaveValue('45.0');
  });

  test('start + duration fills end', async ({ page }) => {
    await page.locator('#flightStartTime').fill(S);
    await page.locator('#flightDuration').fill('45');
    await expect(page.locator('#flightEndTime')).toHaveValue(E);
  });

  test('end + duration fills start', async ({ page }) => {
    await page.locator('#flightEndTime').fill(E);
    await page.locator('#flightDuration').fill('45');
    await expect(page.locator('#flightStartTime')).toHaveValue(S);
  });

  test('duration typed first, then start, fills end', async ({ page }) => {
    await page.locator('#flightDuration').fill('30');
    await page.locator('#flightStartTime').fill(S);
    await expect(page.locator('#flightEndTime')).toHaveValue('2026-05-10T10:30');
  });

  test('end before start shows an error and blocks saving', async ({ page }) => {
    await page.locator('#flightStartTime').fill(E);
    await page.locator('#flightEndTime').fill(S);
    await expect(page.locator('#flightTimeOrderError')).toBeVisible();
    await page.locator('#flightNotes').fill('bad order');
    await page.locator('#formLogFlight button[type="submit"]').click();
    await expect(page.locator('#modalLogFlight')).toBeVisible();
    expect(await store(page, 'flights')).toHaveLength(5);
    // fixing the order clears the error
    await page.locator('#flightEndTime').fill('2026-05-10T11:00');
    await expect(page.locator('#flightTimeOrderError')).toBeHidden();
  });
});

test.describe('edit and delete', () => {
  test('edits a saved flight and persists the change', async ({ page }) => {
    await openApp(page);
    await goTo(page, 'flights');
    await editBtn(flightRow(page, 'Roof inspection')).click();
    await expect(page.locator('#modalLogFlight')).toBeVisible();
    // form is pre-filled from the stored flight
    const f1 = (await store(page, 'flights')).find((f) => f.id === 'f1');
    await expect(page.locator('#flightDrone')).toHaveValue('uav-alpha');
    await expect(page.locator('#flightBattery')).toHaveValue('bat-a');
    await expect(page.locator('#flightStartTime')).toHaveValue(f1.startTime);
    await expect(page.locator('#flightEndTime')).toHaveValue(f1.endTime);
    await expect(page.locator('#flightDuration')).toHaveValue('30');
    await expect(page.locator('#flightNotes')).toHaveValue('Roof inspection');

    const newEnd = fmt(new Date(Date.parse(f1.startTime + ':00Z') + 75 * 60000));
    await fillFlightForm(page, { drone: 'Charlie Mini', battery: 'Pack B', end: newEnd, notes: 'Roof inspection (revised)' });
    await expect(page.locator('#flightDuration')).toHaveValue('75.0');
    await page.locator('#formLogFlight button[type="submit"]').click();
    await expect(page.locator('#modalLogFlight')).toBeHidden();

    const row = flightRow(page, 'Roof inspection (revised)');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Charlie Mini');
    await expect(row).toContainText('Pack B');
    await expect(row).toContainText('75');
    await expect(page.locator('#flightsTableBody tr')).toHaveCount(5);
    await expect(page.locator('#statTotalFlights')).toHaveText('5');
    await expect(page.locator('#statTotalHours')).toHaveText('3h 35m'); // 170 - 30 + 75

    const flights = await store(page, 'flights');
    expect(flights).toHaveLength(5);
    const saved = flights.find((f) => f.id === 'f1');
    expect(saved).toMatchObject({
      droneId: 'uav-charlie', droneName: 'Charlie Mini', batteryId: 'bat-b', batteryName: 'Pack B',
      startTime: f1.startTime, endTime: newEnd, duration: 75, notes: 'Roof inspection (revised)',
    });
  });

  test('deletes a flight only after confirming', async ({ page }) => {
    await openApp(page);
    await goTo(page, 'flights');
    const row = flightRow(page, 'Survey, "north" field');
    await deleteBtn(row).click();
    await expect(page.locator('#modalConfirmMessage')).toContainText('Delete this flight log');

    // cancel keeps it
    await confirmDialog(page, false);
    await expect(row).toHaveCount(1);
    expect(await store(page, 'flights')).toHaveLength(5);

    // confirm removes it
    await deleteBtn(row).click();
    await confirmDialog(page, true);
    await expect(row).toHaveCount(0);
    await expect(page.locator('#flightsTableBody tr')).toHaveCount(4);
    await expect(page.locator('#statTotalFlights')).toHaveText('4');
    await expect(page.locator('#badgeFlightCount')).toHaveText('4');
    await expect(page.locator('#statTotalHours')).toHaveText('2h 20m');
    const flights = await store(page, 'flights');
    expect(flights.map((f) => f.id).sort()).toEqual(['f1', 'f3', 'f4', 'f5']);

    // still gone after reload
    await page.reload();
    await expect(page.locator('#statTotalFlights')).toHaveText('4');
    expect(await store(page, 'flights')).toHaveLength(4);
  });

  test('deleting the last flight shows the empty state', async ({ page }) => {
    const fx = makeFixture();
    await openApp(page, { fixture: { ...fx, flights: [fx.flights[0]] } });
    await goTo(page, 'flights');
    await deleteBtn(flightRow(page, 'Roof inspection')).click();
    await confirmDialog(page);
    await expect(page.locator('#statTotalFlights')).toHaveText('0');
    await expect(page.locator('#statTotalHours')).toHaveText('0h 0m');
    await expect(page.locator('#flightsTableBody tr')).toHaveCount(1);
    await expect(page.locator('#flightsTableBody tr button')).toHaveCount(0);
    expect(await store(page, 'flights')).toEqual([]);
  });
});
