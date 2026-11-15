const {
  test, expect, CONTEXT_OPTIONS, makeFixture, openApp, store, goTo, flightRow,
  fleetCard, expand, confirmDialog, cardNames, optionLabels,
} = require('./support/app');

test.use(CONTEXT_OPTIONS);

const header = (c) => c.locator('[role="button"]').first();

async function openFleet(page, fixture) {
  await openApp(page, fixture ? { fixture } : undefined);
  await goTo(page, 'fleet');
}

test.describe('add / edit / delete drones', () => {
  test('adds a drone (top of the list) and persists it', async ({ page }) => {
    await openFleet(page);
    await page.locator('#btnAddDroneModal').click();
    await expect(page.locator('#modalDrone')).toBeVisible();
    await page.locator('#droneName').fill('Echo Scout');
    await page.locator('#droneModel').fill('ES-9');
    await page.locator('#droneHours').fill('12.5');
    await page.locator('#droneStatus').selectOption('Maintenance');
    await page.locator('#formDrone button[type="submit"]').click();
    await expect(page.locator('#modalDrone')).toBeHidden();

    expect(await cardNames(page, 'fleetGrid')).toEqual(['Echo Scout', 'Alpha Quad', 'Bravo Hex', 'Charlie Mini', 'Delta Spare']);
    const c = fleetCard(page, 'Echo Scout');
    await expect(c).toContainText('ES-9');
    await expect(c.locator('select')).toHaveValue('Maintenance');

    const drones = await store(page, 'drones');
    expect(drones).toHaveLength(5);
    expect(drones[0]).toMatchObject({ name: 'Echo Scout', model: 'ES-9', flightHours: 12.5, status: 'Maintenance' });
    expect(drones[0].id).toMatch(/^uav-/);

    // available in the Log Flight airframe list, and in the log filter
    await page.locator('#btnNewFlightHeader').click();
    expect(await optionLabels(page.locator('#flightDrone'))).toContain('Echo Scout');
    await page.locator('#btnCancelFlight').click();
    expect(await optionLabels(page.locator('#filterDrone'))).toContain('Echo Scout');

    await page.reload();
    expect(await cardNames(page, 'fleetGrid')).toContain('Echo Scout');
  });

  test('name is required', async ({ page }) => {
    await openFleet(page);
    await page.locator('#btnAddDroneModal').click();
    await page.locator('#droneModel').fill('no name');
    await page.locator('#formDrone button[type="submit"]').click();
    await expect(page.locator('#modalDrone')).toBeVisible();
    expect(await store(page, 'drones')).toHaveLength(4);
  });

  test('edits a drone; its flights show the new name', async ({ page }) => {
    await openFleet(page);
    const c = await expand(fleetCard(page, 'Alpha Quad'));
    await c.locator('[data-edit]').click();
    await expect(page.locator('#modalDrone')).toBeVisible();
    await expect(page.locator('#droneName')).toHaveValue('Alpha Quad');
    await expect(page.locator('#droneModel')).toHaveValue('AQ-1');
    await expect(page.locator('#droneHours')).toHaveValue('10');
    await expect(page.locator('#droneStatus')).toHaveValue('Ready');

    await page.locator('#droneName').fill('Alpha Prime');
    await page.locator('#droneModel').fill('AQ-2');
    await page.locator('#droneHours').fill('20');
    await page.locator('#droneStatus').selectOption('In Inspection');
    await page.locator('#formDrone button[type="submit"]').click();
    await expect(page.locator('#modalDrone')).toBeHidden();

    const renamed = fleetCard(page, 'Alpha Prime');
    await expect(renamed).toHaveCount(1);
    await expect(fleetCard(page, 'Alpha Quad')).toHaveCount(0);
    await expect(renamed.locator('select')).toHaveValue('In Inspection');
    await expect(renamed).toContainText('AQ-2');
    await expect(page.locator('#statActiveDrones')).toHaveText('1'); // Charlie only

    const drones = await store(page, 'drones');
    expect(drones.find((d) => d.id === 'uav-alpha')).toMatchObject({ name: 'Alpha Prime', model: 'AQ-2', flightHours: 20, status: 'In Inspection' });
    const flights = await store(page, 'flights');
    expect(flights.filter((f) => f.droneId === 'uav-alpha').map((f) => f.droneName)).toEqual(['Alpha Prime', 'Alpha Prime']);

    await goTo(page, 'flights');
    await expect(flightRow(page, 'Roof inspection')).toContainText('Alpha Prime');
  });

  test('deletes an unused drone after confirming', async ({ page }) => {
    await openFleet(page);
    const c = await expand(fleetCard(page, 'Delta Spare'));
    await c.locator('[data-delete]').click();
    await expect(page.locator('#modalConfirmMessage')).toContainText('Delete "Delta Spare"?');
    await confirmDialog(page, false);
    await expect(fleetCard(page, 'Delta Spare')).toHaveCount(1);

    await c.locator('[data-delete]').click();
    await confirmDialog(page, true);
    await expect(fleetCard(page, 'Delta Spare')).toHaveCount(0);
    expect((await store(page, 'drones')).map((d) => d.id)).toEqual(['uav-alpha', 'uav-bravo', 'uav-charlie']);
    await page.locator('#btnNewFlightHeader').click();
    expect(await optionLabels(page.locator('#flightDrone'))).not.toContain('Delta Spare');
  });

  test('deleting a drone with flights keeps its flights in the logbook', async ({ page }) => {
    await openFleet(page);
    const c = await expand(fleetCard(page, 'Bravo Hex'));
    await c.locator('[data-delete]').click();
    await expect(page.locator('#modalConfirmMessage')).toContainText('2 logged flights will be kept');
    await confirmDialog(page, true);
    await expect(fleetCard(page, 'Bravo Hex')).toHaveCount(0);
    await expect(page.locator('#statTotalFlights')).toHaveText('5');
    expect(await store(page, 'flights')).toHaveLength(5);
    await goTo(page, 'flights');
    await expect(flightRow(page, 'Battery swap test')).toContainText('Bravo Hex');
  });
});

test.describe('drone statuses', () => {
  test('adds a custom status with a colour and uses it on a card', async ({ page }) => {
    await openFleet(page);
    await page.locator('#btnManageStatusesModal').click();
    await expect(page.locator('#modalManageStatuses')).toBeVisible();
    await page.locator('#newStatusColor').fill('#ff0000');
    await page.locator('#newStatusInput').fill('Standby');
    await page.locator('#formAddStatus button[type="submit"]').click();

    await expect(page.locator('#statusListContainer > div').filter({ hasText: 'Standby' })).toHaveCount(1);
    expect(await store(page, 'droneStatuses')).toEqual(['Ready', 'Maintenance', 'In Inspection', 'Repairing', 'Retired', 'Standby']);
    expect((await store(page, 'droneStatusColors')).Standby).toBe('#ff0000');
    await page.locator('#btnCloseStatuses').click();
    await expect(page.locator('#modalManageStatuses')).toBeHidden();

    // change a drone's status from its card
    const select = fleetCard(page, 'Charlie Mini').locator('select');
    expect(await optionLabels(select)).toContain('Standby');
    await select.selectOption('Standby');
    await expect(select).toHaveValue('Standby');
    await expect(select).toHaveCSS('color', 'rgb(255, 0, 0)');
    expect((await store(page, 'drones')).find((d) => d.id === 'uav-charlie').status).toBe('Standby');
    await expect(page.locator('#statActiveDrones')).toHaveText('1');

    await page.reload();
    await goTo(page, 'fleet');
    await expect(fleetCard(page, 'Charlie Mini').locator('select')).toHaveValue('Standby');
  });

  test('a duplicate status name is not added twice', async ({ page }) => {
    await openFleet(page);
    await page.locator('#btnManageStatusesModal').click();
    await page.locator('#newStatusInput').fill('Retired');
    await page.locator('#formAddStatus button[type="submit"]').click();
    expect((await store(page, 'droneStatuses')).filter((s) => s === 'Retired')).toHaveLength(1);
  });

  test('changes a status on a card and the drone keeps it after reload', async ({ page }) => {
    await openFleet(page);
    const select = fleetCard(page, 'Alpha Quad').locator('select');
    await select.selectOption('Repairing');
    await expect(page.locator('#statActiveDrones')).toHaveText('1');
    expect((await store(page, 'drones')).find((d) => d.id === 'uav-alpha').status).toBe('Repairing');
    await page.reload();
    await goTo(page, 'fleet');
    await expect(fleetCard(page, 'Alpha Quad').locator('select')).toHaveValue('Repairing');
  });

  test('recolours a status', async ({ page }) => {
    await openFleet(page);
    await page.locator('#btnManageStatusesModal').click();
    const row = page.locator('#statusListContainer > div').filter({ hasText: 'Maintenance' });
    await row.locator('[data-status-color-input]').fill('#00ff00');
    await expect.poll(async () => (await store(page, 'droneStatusColors')).Maintenance).toBe('#00ff00');
    await page.locator('#btnCloseStatuses').click();
    // Bravo Hex is in Maintenance
    await expect(fleetCard(page, 'Bravo Hex').locator('select')).toHaveCSS('color', 'rgb(0, 255, 0)');
    // Ready keeps its default colour
    await expect(fleetCard(page, 'Alpha Quad').locator('select')).toHaveCSS('color', 'rgb(52, 211, 153)');
  });

  test('removes an unused status; refuses used and required ones', async ({ page }) => {
    await openFleet(page);
    await page.locator('#btnManageStatusesModal').click();
    const rows = page.locator('#statusListContainer > div');
    const rowFor = (name) => rows.filter({ hasText: name });

    // Ready can never be removed
    await expect(rowFor('Ready').locator('button')).toBeDisabled();

    // Maintenance is used by Bravo Hex: refused with a warning, status stays
    await rowFor('Maintenance').locator('button').click();
    await expect(page.locator('#toastContainer')).toContainText('Maintenance');
    expect(await store(page, 'droneStatuses')).toContain('Maintenance');

    // Repairing is unused: removed (and its colour with it)
    await rowFor('Repairing').locator('[data-status-color-input]').fill('#123456');
    await expect.poll(async () => (await store(page, 'droneStatusColors')).Repairing).toBe('#123456');
    await rowFor('Repairing').locator('button').click();
    await expect(rowFor('Repairing')).toHaveCount(0);
    expect(await store(page, 'droneStatuses')).toEqual(['Ready', 'Maintenance', 'In Inspection', 'Retired']);
    expect(await store(page, 'droneStatusColors')).not.toHaveProperty('Repairing');
    await page.locator('#btnCloseStatuses').click();
    expect(await optionLabels(fleetCard(page, 'Alpha Quad').locator('select'))).toEqual(['Ready', 'Maintenance', 'In Inspection', 'Retired']);
  });
});

test.describe('expand / collapse and details', () => {
  test('cards start collapsed and toggle open and closed', async ({ page }) => {
    await openFleet(page);
    const c = fleetCard(page, 'Alpha Quad');
    await expect(header(c)).toHaveAttribute('aria-expanded', 'false');
    await expect(c.locator('[data-edit]')).toHaveCount(0);

    await c.locator('h3').click();
    await expect(header(c)).toHaveAttribute('aria-expanded', 'true');
    await expect(c.locator('[data-edit]')).toBeVisible();
    // other cards are unaffected
    await expect(header(fleetCard(page, 'Bravo Hex'))).toHaveAttribute('aria-expanded', 'false');

    await c.locator('h3').click();
    await expect(header(c)).toHaveAttribute('aria-expanded', 'false');
    await expect(c.locator('[data-edit]')).toHaveCount(0);

    // changing the status dropdown does not toggle the card
    await c.locator('h3').click();
    await c.locator('select').selectOption('Retired');
    await expect(header(fleetCard(page, 'Alpha Quad'))).toHaveAttribute('aria-expanded', 'true');
  });

  test('collapsed again after a reload', async ({ page }) => {
    await openFleet(page);
    await expand(fleetCard(page, 'Alpha Quad'));
    await page.reload();
    await goTo(page, 'fleet');
    await expect(header(fleetCard(page, 'Alpha Quad'))).toHaveAttribute('aria-expanded', 'false');
  });

  test('expanded card shows hours, flight count, maiden / latest flight and lifespan', async ({ page }) => {
    await openApp(page);
    const fx = makeFixture();
    const f = (id) => fx.flights.find((x) => x.id === id);
    await goTo(page, 'fleet');

    const alpha = await expand(fleetCard(page, 'Alpha Quad'));
    await expect(alpha).toContainText('11.0 hrs'); // 10 base + 60 min logged
    await expect(alpha).toContainText('2 flights');
    await expect(alpha).toContainText(f('f2').startTime.replace('T', ' ')); // maiden: earliest start
    await expect(alpha).toContainText(f('f1').endTime.replace('T', ' ')); // latest: end of newest flight
    await expect(alpha).toContainText('7d 20h 30m');

    const bravo = await expand(fleetCard(page, 'Bravo Hex'));
    await expect(bravo).toContainText('6.8 hrs');
    await expect(bravo).toContainText(f('f3').startTime.replace('T', ' '));
    await expect(bravo).toContainText(f('f4').endTime.replace('T', ' '));
    await expect(bravo).toContainText('15d 20m');

    const charlie = await expand(fleetCard(page, 'Charlie Mini'));
    await expect(charlie).toContainText('1 flight');
    await expect(charlie).toContainText(f('f5').startTime.replace('T', ' '));
    await expect(charlie).toContainText(f('f5').endTime.replace('T', ' '));
    await expect(charlie).toContainText('30m');

    // a drone with no flights has no maiden / latest / lifespan
    const delta = await expand(fleetCard(page, 'Delta Spare'));
    await expect(delta).toContainText('2.0 hrs');
    await expect(delta).toContainText('0 flights');
    await expect(delta.locator('.font-mono').filter({ hasText: /^–$/ })).toHaveCount(3);
  });
});

test.describe('reordering', () => {
  test('up/down buttons reorder the cards, persist, and drive the Log Flight dropdown', async ({ page }) => {
    await openFleet(page);
    expect(await cardNames(page, 'fleetGrid')).toEqual(['Alpha Quad', 'Bravo Hex', 'Charlie Mini', 'Delta Spare']);

    // first card cannot move up, last cannot move down
    const alpha = await expand(fleetCard(page, 'Alpha Quad'));
    await expect(alpha.locator('[data-move-up]')).toBeDisabled();
    const delta = await expand(fleetCard(page, 'Delta Spare'));
    await expect(delta.locator('[data-move-down]')).toBeDisabled();

    // Charlie up -> A, C, B, D
    const charlie = await expand(fleetCard(page, 'Charlie Mini'));
    await charlie.locator('[data-move-up]').click();
    expect(await cardNames(page, 'fleetGrid')).toEqual(['Alpha Quad', 'Charlie Mini', 'Bravo Hex', 'Delta Spare']);
    // Alpha down -> C, A, B, D
    await fleetCard(page, 'Alpha Quad').locator('[data-move-down]').click();
    expect(await cardNames(page, 'fleetGrid')).toEqual(['Charlie Mini', 'Alpha Quad', 'Bravo Hex', 'Delta Spare']);
    // expansion state survives the moves
    await expect(header(fleetCard(page, 'Charlie Mini'))).toHaveAttribute('aria-expanded', 'true');

    const order = ['uav-charlie', 'uav-alpha', 'uav-bravo', 'uav-delta'];
    expect((await store(page, 'drones')).map((d) => d.id)).toEqual(order);

    await page.locator('#btnNewFlightHeader').click();
    await expect(page.locator('#flightDrone option')).toHaveText(['Charlie Mini', 'Alpha Quad', 'Bravo Hex', 'Delta Spare', 'Add from FlyStock…']);
    await page.locator('#btnCancelFlight').click();

    await page.reload();
    expect(await cardNames(page, 'fleetGrid')).toEqual(['Charlie Mini', 'Alpha Quad', 'Bravo Hex', 'Delta Spare']);
    await page.locator('#btnNewFlightHeader').click();
    await expect(page.locator('#flightDrone option')).toHaveText(['Charlie Mini', 'Alpha Quad', 'Bravo Hex', 'Delta Spare', 'Add from FlyStock…']);
  });
});
