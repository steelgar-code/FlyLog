const {
  test, expect, CONTEXT_OPTIONS, openApp, makeFixture, store, goTo, optionLabels, fleetCard, cardNames,
} = require('./support/app');

test.use(CONTEXT_OPTIONS);

const KEY = 'stockroom_inventory_v1';
const item = (id, type, description, extra = {}) => ({ id, type, description, status: 'active', dateAdded: '2026-01-01', dateRemoved: null, notes: [], ...extra });
const inv = (items, types) => ({ types: types || [...new Set(items.map((i) => i && i.type))], items });

const picker = (page) => page.locator('#modalStockPicker');
const rows = (page) => page.locator('#stockPickerList label');
const rowTexts = (page) => rows(page).locator('span.font-medium').allTextContents();

async function openFromFleet(page, opts) {
  await openApp(page, opts);
  await goTo(page, 'fleet');
  await page.locator('#btnAddFromStock').click();
  await expect(picker(page)).toBeVisible();
}
const pick = (page, description) => rows(page).filter({ hasText: description }).locator('input').check();

const sample = () => inv([
  item('s-1', 'Quad', 'Alpha Copy'),
  item('s-2', 'Quad', 'Bravo Copy'),
  item('s-3', 'Plane', 'Cessna Foam'),
  item('s-gone', 'Quad', 'Removed One', { status: 'removed' }),
]);

test.describe('empty states', () => {
  test('key absent: message and FlyStock link', async ({ page }) => {
    await openFromFleet(page);
    await expect(page.locator('#stockPickerEmpty')).toBeVisible();
    await expect(page.locator('#stockPickerEmptyMsg')).toContainText('No FlyStock inventory');
    await expect(page.locator('#stockPickerLink')).toHaveAttribute('href', 'https://steelgar-code.github.io/FlyStock/');
    await expect(page.locator('#btnStockAddSelected')).toBeDisabled();
  });

  for (const [name, raw] of [['unreadable JSON', '{not json'], ['wrong shape', '{"items":5}'], ['null', 'null']]) {
    test(`${name}: same empty state, no crash`, async ({ page }) => {
      await openFromFleet(page, { stock: raw });
      await expect(page.locator('#stockPickerEmptyMsg')).toContainText('No FlyStock inventory');
      await expect(page.locator('#stockPickerLink')).toBeVisible();
    });
  }

  test('all items removed: "nothing to add" state', async ({ page }) => {
    await openFromFleet(page, { stock: inv([item('s-1', 'Quad', 'Gone', { status: 'removed' })]) });
    await expect(page.locator('#stockPickerEmptyMsg')).toContainText('Nothing to add');
  });
});

test.describe('listing and filtering', () => {
  test('lists only active, unlinked, valid, unique items', async ({ page }) => {
    const stock = inv([
      item('s-1', 'Quad', 'Alpha Copy'),
      item('s-dup', 'Quad', 'First Dup'),
      item('s-dup', 'Quad', 'Second Dup'),
      item('s-gone', 'Quad', 'Removed One', { status: 'removed' }),
      item('bad id"', 'Quad', 'Bad Id'),
      item('<b>', 'Quad', 'Bad Id 2'),
      item('s-n1', 5, 'Non-string type'),
      item('s-n2', 'Quad', null),
      item('s-linked', 'Quad', 'Already Linked'),
      null, 7, 'str',
    ]);
    const fixture = (await require('./support/app').makeFixture());
    fixture.drones.push({ id: 'uav-x', name: 'Linked', model: 'Quad', flightHours: 0, status: 'Ready', stockId: 's-linked', stockName: 'Already Linked' });
    await openFromFleet(page, { fixture, stock });
    expect((await rowTexts(page)).sort()).toEqual(['Alpha Copy', 'First Dup']);
  });

  test('search matches description and type', async ({ page }) => {
    await openFromFleet(page, { stock: sample() });
    expect((await rowTexts(page)).sort()).toEqual(['Alpha Copy', 'Bravo Copy', 'Cessna Foam']);
    await page.locator('#stockSearch').fill('bravo');
    expect(await rowTexts(page)).toEqual(['Bravo Copy']);
    await page.locator('#stockSearch').fill('plane');
    expect(await rowTexts(page)).toEqual(['Cessna Foam']);
    await page.locator('#stockSearch').fill('zzz');
    await expect(rows(page)).toHaveCount(0);
    await expect(page.locator('#stockPickerNoMatch')).toBeVisible();
  });

  test('type filter works and persists across reload', async ({ page }) => {
    await openFromFleet(page, { stock: sample() });
    await page.locator('#stockTypeFilter').selectOption('Plane');
    expect(await rowTexts(page)).toEqual(['Cessna Foam']);
    expect(await page.evaluate(() => localStorage.getItem('flylog_stock_type_filter'))).toBe('Plane');
    await page.reload();
    await goTo(page, 'fleet');
    await page.locator('#btnAddFromStock').click();
    await expect(page.locator('#stockTypeFilter')).toHaveValue('Plane');
    expect(await rowTexts(page)).toEqual(['Cessna Foam']);
  });

  test('stale remembered filter falls back to all', async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('flylog_stock_type_filter', 'Gone Type'); } catch (e) {} });
    await openFromFleet(page, { stock: sample() });
    // seeding clears storage once per tab, so set it explicitly and reopen
    await page.evaluate(() => localStorage.setItem('flylog_stock_type_filter', 'Gone Type'));
    await page.locator('#btnCancelStockPicker').click();
    await page.locator('#btnAddFromStock').click();
    await expect(page.locator('#stockTypeFilter')).toHaveValue('all');
    await expect(rows(page)).toHaveCount(3);
  });

  test('Escape closes the picker', async ({ page }) => {
    await openFromFleet(page, { stock: sample() });
    await page.keyboard.press('Escape');
    await expect(picker(page)).toBeHidden();
  });
});

test.describe('adding', () => {
  test('multi-select creates linked drones, persisted; linked items no longer offered', async ({ page }) => {
    await openFromFleet(page, { stock: sample() });
    await expect(page.locator('#btnStockAddSelected')).toBeDisabled();
    await pick(page, 'Alpha Copy');
    await pick(page, 'Cessna Foam');
    await expect(page.locator('#btnStockAddSelected')).toBeEnabled();
    await page.locator('#btnStockAddSelected').click();
    await expect(picker(page)).toBeHidden();

    const drones = await store(page, 'drones');
    expect(drones).toHaveLength(6);
    const added = drones.slice(4);
    expect(added[0]).toMatchObject({ name: 'Alpha Copy', model: 'Quad', flightHours: 0, status: 'Ready', stockId: 's-1', stockName: 'Alpha Copy' });
    expect(added[1]).toMatchObject({ name: 'Cessna Foam', model: 'Plane', stockId: 's-3', stockName: 'Cessna Foam' });
    expect(added[0].id).not.toBe(added[1].id);
    expect(drones[0].stockId).toBeUndefined();
    expect(await cardNames(page, 'fleetGrid')).toEqual(expect.arrayContaining(['Alpha Copy', 'Cessna Foam']));
    await expect(fleetCard(page, 'Alpha Copy').locator('[data-stock-badge]')).toBeVisible();
    await expect(fleetCard(page, 'Alpha Quad').locator('[data-stock-badge]')).toHaveCount(0);

    await page.locator('#btnAddFromStock').click();
    expect(await rowTexts(page)).toEqual(['Bravo Copy']);
  });

  test('empty description falls back to the type for the name', async ({ page }) => {
    await openFromFleet(page, { stock: inv([item('s-1', 'Quad', '  ')]) });
    await pick(page, 'Quad');
    await page.locator('#btnStockAddSelected').click();
    const drones = await store(page, 'drones');
    expect(drones[drones.length - 1]).toMatchObject({ name: 'Quad', model: 'Quad', stockId: 's-1', stockName: '' });
  });

  test('from the Log Flight dropdown: sentinel is last, never stored, new airframe selected', async ({ page }) => {
    await openApp(page, { stock: sample() });
    await page.locator('#btnNewFlightHeader').click();
    const labels = await optionLabels(page.locator('#flightDrone'));
    expect(labels[labels.length - 1]).toBe('Add from FlyStock…');
    await page.locator('#flightDrone').selectOption({ label: 'Add from FlyStock…' });
    await expect(picker(page)).toBeVisible();
    await expect(page.locator('#flightDrone')).not.toHaveValue('__flystock_picker__');
    await pick(page, 'Bravo Copy');
    await pick(page, 'Alpha Copy');
    await page.locator('#btnStockAddSelected').click();
    await expect(picker(page)).toBeHidden();
    await expect(page.locator('#modalLogFlight')).toBeVisible();
    const sel = page.locator('#flightDrone');
    const selectedText = await sel.evaluate((s) => s.selectedOptions[0].textContent);
    expect(selectedText).toBe((await rowsAfter(page))[0]);
    await page.locator('#flightStartTime').fill('2026-01-05T10:00');
    await page.locator('#flightDuration').fill('10');
    await page.locator('#formLogFlight button[type="submit"]').click();
    await expect(page.locator('#modalLogFlight')).toBeHidden();
    const flights = await store(page, 'flights');
    const drones = await store(page, 'drones');
    expect(flights.some((f) => f.droneId === '__flystock_picker__')).toBe(false);
    expect(flights.find((f) => f.droneId === drones[4].id)).toBeTruthy();
  });

  test('cancelling the picker from the dropdown leaves a real airframe selected', async ({ page }) => {
    await openApp(page, { stock: sample() });
    await page.locator('#btnNewFlightHeader').click();
    await page.locator('#flightDrone').selectOption({ label: 'Bravo Hex' });
    await page.locator('#flightDrone').selectOption({ label: 'Add from FlyStock…' });
    await page.locator('#btnCancelStockPicker').click();
    await expect(page.locator('#flightDrone')).toHaveValue('uav-bravo');
  });

  test('with no airframes the dropdown entry still opens the picker and the first flight can be logged', async ({ page }) => {
    await openApp(page, { fixture: { ...makeFixture(), drones: [], flights: [] }, stock: sample() });
    await page.locator('#btnNewFlightHeader').click();
    const sel = page.locator('#flightDrone');
    await expect(sel).toHaveValue('');
    await sel.selectOption({ label: 'Add from FlyStock…' });
    await expect(picker(page)).toBeVisible();
    await page.locator('#btnCancelStockPicker').click();
    await expect(sel).toHaveValue('');
    await sel.selectOption({ label: 'Add from FlyStock…' });
    await pick(page, 'Alpha Copy');
    await page.locator('#btnStockAddSelected').click();
    const drones = await store(page, 'drones');
    expect(drones).toHaveLength(1);
    await expect(sel).toHaveValue(drones[0].id);
    await expect(sel.locator('option')).toHaveText(['Alpha Copy', 'Add from FlyStock…']);
  });
});

// Names of the drones added by the dropdown test, in display order (first = selected).
async function rowsAfter(page) {
  const drones = await store(page, 'drones');
  return drones.slice(4).map((d) => d.name);
}

test.describe('safety', () => {
  const evil1 = '<img src=x onerror=window.__xss=1>';
  const evil2 = '"><script>window.__xss=1</script>';

  test('crafted text is shown as text and never executes; FlyStock key untouched', async ({ page }) => {
    const stock = inv([item('s-1', evil1, evil2), item('s-2', evil2, evil1)]);
    const raw = JSON.stringify(stock);
    await openFromFleet(page, { stock: raw });
    expect(await rowTexts(page)).toEqual(expect.arrayContaining([evil2, evil1]));
    await expect(page.locator('#stockPickerList img, #stockPickerList script')).toHaveCount(0);
    await rows(page).locator('input').first().check();
    await rows(page).locator('input').nth(1).check();
    await page.locator('#btnStockAddSelected').click();

    await expect(page.locator('#fleetGrid img')).toHaveCount(0);
    await expect(page.locator('#fleetGrid h3', { hasText: evil2 })).toBeVisible();
    await page.locator('#btnNewFlightHeader').click();
    expect(await optionLabels(page.locator('#flightDrone'))).toEqual(expect.arrayContaining([evil1, evil2]));
    await expect(page.locator('#flightDrone img')).toHaveCount(0);
    await page.reload();
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe(raw);
  });

  test('FlyStock key is byte-identical after adding and with no key it stays absent', async ({ page }) => {
    const raw = JSON.stringify(sample(), null, 2);
    await openFromFleet(page, { stock: raw });
    await pick(page, 'Alpha Copy');
    await page.locator('#btnStockAddSelected').click();
    expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe(raw);
  });

  test('absent key is not created', async ({ page }) => {
    await openFromFleet(page);
    expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBeNull();
  });
});
