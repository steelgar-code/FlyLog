const {
  test, expect, CONTEXT_OPTIONS, openApp, store, goTo, flightRow,
  batteryCard, expand, confirmDialog, cardNames, optionLabels,
} = require('./support/app');

test.use(CONTEXT_OPTIONS);

const header = (c) => c.locator('[role="button"]').first();

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await goTo(page, 'batteries');
});

test('lists the batteries with status badges and totals on expand', async ({ page }) => {
  expect(await cardNames(page, 'batteriesGrid')).toEqual(['Pack A', 'Pack B', 'Pack C']);
  await expect(batteryCard(page, 'Pack A')).toContainText('Good');
  await expect(batteryCard(page, 'Pack B')).toContainText('Warning');
  await expect(batteryCard(page, 'Pack C')).toContainText('Retired');
  await expect(header(batteryCard(page, 'Pack A'))).toHaveAttribute('aria-expanded', 'false');

  // Pack A: 1.5 base + (30 + 60) min logged; 10 cycles
  const a = await expand(batteryCard(page, 'Pack A'));
  await expect(a).toContainText('10 cycles');
  await expect(a).toContainText('3.0 hrs');
  // Pack B: 3 base + 30 min; 50 cycles
  const b = await expand(batteryCard(page, 'Pack B'));
  await expect(b).toContainText('50 cycles');
  await expect(b).toContainText('3.5 hrs');
  // Pack C: 1 cycle (singular), 30 min
  const c = await expand(batteryCard(page, 'Pack C'));
  await expect(c).toContainText('1 cycle');
  await expect(c).not.toContainText('1 cycles');
  await expect(c).toContainText('0.5 hrs');

  await a.locator('h3').click();
  await expect(header(a)).toHaveAttribute('aria-expanded', 'false');
});

test('adds a battery (top of the list), persists it and offers it in Log Flight', async ({ page }) => {
  await page.locator('#btnAddBatteryModal').click();
  await expect(page.locator('#modalBattery')).toBeVisible();
  await page.locator('#batteryName').fill('Pack D');
  await page.locator('#batteryCycles').fill('7');
  await page.locator('#batteryHours').fill('2.5');
  await page.locator('#batteryStatus').selectOption('Warning');
  await page.locator('#formBattery button[type="submit"]').click();
  await expect(page.locator('#modalBattery')).toBeHidden();

  expect(await cardNames(page, 'batteriesGrid')).toEqual(['Pack D', 'Pack A', 'Pack B', 'Pack C']);
  await expect(page.locator('#statBatteriesCount')).toHaveText('4');
  const d = await expand(batteryCard(page, 'Pack D'));
  await expect(d).toContainText('Warning');
  await expect(d).toContainText('7 cycles');
  await expect(d).toContainText('2.5 hrs');

  const stored = await store(page, 'batteries');
  expect(stored).toHaveLength(4);
  expect(stored[0]).toMatchObject({ name: 'Pack D', cycles: 7, flightHours: 2.5, status: 'Warning' });
  expect(stored[0].id).toMatch(/^bat-/);

  await page.locator('#btnNewFlightHeader').click();
  expect(await optionLabels(page.locator('#flightBattery'))).toContain('Pack D');

  await page.reload();
  expect(await cardNames(page, 'batteriesGrid')).toContain('Pack D');
});

test('name is required', async ({ page }) => {
  await page.locator('#btnAddBatteryModal').click();
  await page.locator('#batteryCycles').fill('3');
  await page.locator('#formBattery button[type="submit"]').click();
  await expect(page.locator('#modalBattery')).toBeVisible();
  expect(await store(page, 'batteries')).toHaveLength(3);
});

test('edits a battery; flights show the new name', async ({ page }) => {
  const c = await expand(batteryCard(page, 'Pack A'));
  await c.locator('[data-edit]').click();
  await expect(page.locator('#modalBattery')).toBeVisible();
  await expect(page.locator('#batteryName')).toHaveValue('Pack A');
  await expect(page.locator('#batteryCycles')).toHaveValue('10');
  await expect(page.locator('#batteryHours')).toHaveValue('1.5');
  await expect(page.locator('#batteryStatus')).toHaveValue('Good');

  await page.locator('#batteryName').fill('Pack A2');
  await page.locator('#batteryCycles').fill('99');
  await page.locator('#batteryHours').fill('4');
  await page.locator('#batteryStatus').selectOption('Retired');
  await page.locator('#formBattery button[type="submit"]').click();
  await expect(page.locator('#modalBattery')).toBeHidden();

  const edited = batteryCard(page, 'Pack A2');
  await expect(edited).toHaveCount(1);
  await expect(batteryCard(page, 'Pack A')).toHaveCount(0);
  await expect(edited).toContainText('Retired');
  await expect(edited).toContainText('99 cycles');
  await expect(edited).toContainText('5.5 hrs'); // 4 + 90 min

  const stored = (await store(page, 'batteries')).find((b) => b.id === 'bat-a');
  expect(stored).toMatchObject({ name: 'Pack A2', cycles: 99, flightHours: 4, status: 'Retired' });
  const flights = await store(page, 'flights');
  expect(flights.filter((f) => f.batteryId === 'bat-a').map((f) => f.batteryName)).toEqual(['Pack A2', 'Pack A2']);

  await goTo(page, 'flights');
  await expect(flightRow(page, 'Roof inspection')).toContainText('Pack A2');
});

test('deletes a battery after confirming; its flights are kept', async ({ page }) => {
  const c = await expand(batteryCard(page, 'Pack A'));
  await c.locator('[data-delete]').click();
  await expect(page.locator('#modalConfirmMessage')).toContainText('Delete "Pack A"?');
  await expect(page.locator('#modalConfirmMessage')).toContainText('2 logged flights will be kept');
  await confirmDialog(page, false);
  await expect(batteryCard(page, 'Pack A')).toHaveCount(1);

  await c.locator('[data-delete]').click();
  await confirmDialog(page, true);
  await expect(batteryCard(page, 'Pack A')).toHaveCount(0);
  await expect(page.locator('#statBatteriesCount')).toHaveText('2');
  expect((await store(page, 'batteries')).map((b) => b.id)).toEqual(['bat-b', 'bat-c']);
  expect(await store(page, 'flights')).toHaveLength(5);
  await page.locator('#btnNewFlightHeader').click();
  expect(await optionLabels(page.locator('#flightBattery'))).not.toContain('Pack A');
  await page.locator('#btnCancelFlight').click();
  await goTo(page, 'flights');
  await expect(flightRow(page, 'Roof inspection')).toContainText('Pack A');
});

test('up/down buttons reorder the batteries, persist, and drive the Log Flight dropdown', async ({ page }) => {
  const a = await expand(batteryCard(page, 'Pack A'));
  await expect(a.locator('[data-move-up]')).toBeDisabled();
  const c = await expand(batteryCard(page, 'Pack C'));
  await expect(c.locator('[data-move-down]')).toBeDisabled();

  await c.locator('[data-move-up]').click();
  expect(await cardNames(page, 'batteriesGrid')).toEqual(['Pack A', 'Pack C', 'Pack B']);
  await batteryCard(page, 'Pack A').locator('[data-move-down]').click();
  expect(await cardNames(page, 'batteriesGrid')).toEqual(['Pack C', 'Pack A', 'Pack B']);
  expect((await store(page, 'batteries')).map((b) => b.id)).toEqual(['bat-c', 'bat-a', 'bat-b']);

  await page.locator('#btnNewFlightHeader').click();
  expect(await optionLabels(page.locator('#flightBattery'))).toEqual(['-- None / Standard --', 'Pack C', 'Pack A', 'Pack B']);
  await page.locator('#btnCancelFlight').click();

  await page.reload();
  expect(await cardNames(page, 'batteriesGrid')).toEqual(['Pack C', 'Pack A', 'Pack B']);
});
