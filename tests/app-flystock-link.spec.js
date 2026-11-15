const {
  test, expect, CONTEXT_OPTIONS, makeFixture, openApp, store, goTo, fleetCard, expand, confirmDialog,
} = require('./support/app');

test.use(CONTEXT_OPTIONS);

const KEY = 'stockroom_inventory_v1';
const item = (id, description, extra = {}) => ({ id, type: 'Quad', description, status: 'active', dateAdded: '2026-01-01', dateRemoved: null, notes: [], ...extra });
const inv = (items) => ({ types: ['Quad'], items });
const raw = (page) => page.evaluate((k) => localStorage.getItem(k), KEY);
const badge = (page, name) => fleetCard(page, name).locator('[data-stock-badge]');

// Alpha Quad linked to s-a (name == stockName); Bravo Hex linked to s-b (pilot-renamed airframe).
function linkedFixture() {
  const fx = makeFixture();
  Object.assign(fx.drones[0], { stockId: 's-a', stockName: 'Alpha Quad' });
  Object.assign(fx.drones[1], { stockId: 's-b', stockName: 'Bravo Stock' });
  return fx;
}
const ACTIVE = () => inv([item('s-a', 'Alpha Quad'), item('s-b', 'Bravo Stock')]);

async function openFleet(page, opts) {
  await openApp(page, opts);
  await goTo(page, 'fleet');
}

test.describe('link upkeep', () => {
  test('rename in FlyStock updates stockName and name (when untouched) and flights; pilot-renamed name stays', async ({ page }) => {
    const stock = inv([item('s-a', 'Alpha Renamed'), item('s-b', 'Bravo Renamed')]);
    const before = JSON.stringify(stock);
    await openFleet(page, { fixture: linkedFixture(), stock });
    const drones = await store(page, 'drones');
    expect(drones[0]).toMatchObject({ name: 'Alpha Renamed', stockName: 'Alpha Renamed' });
    expect(drones[1]).toMatchObject({ name: 'Bravo Hex', stockName: 'Bravo Renamed' });
    const flights = await store(page, 'flights');
    expect(flights.filter((f) => f.droneId === 'uav-alpha').every((f) => f.droneName === 'Alpha Renamed')).toBe(true);
    expect(flights.filter((f) => f.droneId === 'uav-bravo').every((f) => f.droneName === 'Bravo Hex')).toBe(true);
    await expect(fleetCard(page, 'Alpha Renamed')).toBeVisible();
    expect(await raw(page)).toBe(before);
  });

  test('unchanged description saves nothing', async ({ page }) => {
    await openFleet(page, { fixture: linkedFixture(), stock: ACTIVE() });
    expect(await store(page, 'drones')).toEqual(linkedFixture().drones);
  });

  test('removed item: Removed badge, drone data unchanged', async ({ page }) => {
    const stock = inv([item('s-a', 'Alpha Quad', { status: 'removed' }), item('s-b', 'Bravo New Name', { status: 'removed' })]);
    await openFleet(page, { fixture: linkedFixture(), stock });
    await expect(badge(page, 'Alpha Quad')).toHaveText('Removed in FlyStock');
    await expect(badge(page, 'Bravo Hex')).toHaveText('Removed in FlyStock');
    expect(await store(page, 'drones')).toEqual(linkedFixture().drones);
    expect(await store(page, 'flights')).toEqual(linkedFixture().flights);
  });

  for (const [name, stock] of [
    ['item missing', inv([item('other', 'Other')])],
    ['key absent', undefined],
    ['unreadable key', '{nope'],
  ]) {
    test(`${name}: Not found badge, nothing persisted`, async ({ page }) => {
      await openFleet(page, { fixture: linkedFixture(), stock });
      await expect(badge(page, 'Alpha Quad')).toHaveText('Not found in FlyStock');
      await expect(badge(page, 'Bravo Hex')).toHaveText('Not found in FlyStock');
      expect(await store(page, 'drones')).toEqual(linkedFixture().drones);
      expect(await page.evaluate(() => localStorage.getItem('flylog_drones'))).not.toContain('Not found');
    });
  }

  test('a storage event updates badge and names without reload', async ({ page }) => {
    await openFleet(page, { fixture: linkedFixture(), stock: ACTIVE() });
    await expect(badge(page, 'Alpha Quad')).toHaveText('FlyStock');
    await page.evaluate((k) => {
      localStorage.setItem(k, JSON.stringify({ types: ['Quad'], items: [
        { id: 's-a', type: 'Quad', description: 'Alpha Quad', status: 'removed' },
        { id: 's-b', type: 'Quad', description: 'Bravo Stock 2', status: 'active' },
      ] }));
      window.dispatchEvent(new StorageEvent('storage', { key: k }));
    }, KEY);
    await expect(badge(page, 'Alpha Quad')).toHaveText('Removed in FlyStock');
    await expect.poll(async () => (await store(page, 'drones'))[1].stockName).toBe('Bravo Stock 2');
  });

  test('a write from a second page in the same context is picked up', async ({ page, context }) => {
    await openFleet(page, { fixture: linkedFixture(), stock: ACTIVE() });
    const other = await context.newPage();
    await other.goto(page.url());
    await other.evaluate((k) => localStorage.setItem(k, JSON.stringify({ types: [], items: [] })), KEY);
    await expect(badge(page, 'Alpha Quad')).toHaveText('Not found in FlyStock');
    await other.close();
  });

  test('FlyLog never writes the FlyStock key', async ({ page }) => {
    const stock = ACTIVE();
    const before = JSON.stringify(stock);
    await openFleet(page, { fixture: linkedFixture(), stock });
    const c = await expand(fleetCard(page, 'Alpha Quad'));
    await c.locator('[data-edit]').click();
    await page.locator('#formDrone button[type="submit"]').click();
    expect(await raw(page)).toBe(before);
  });

  test('crafted description renders as text on the card and in the edit dialog', async ({ page }) => {
    const evil = '<img src=x onerror=window.__xss=1>';
    await openFleet(page, { fixture: linkedFixture(), stock: inv([item('s-a', evil), item('s-b', 'Bravo Stock')]) });
    await expect(fleetCard(page, evil)).toBeVisible();
    expect(await page.locator('#fleetGrid img').count()).toBe(0);
    const c = await expand(fleetCard(page, evil));
    await c.locator('[data-edit]').click();
    await expect(page.locator('#droneName')).toHaveValue(evil);
    await expect(page.locator('#droneStockLinkText')).toContainText(evil);
    expect(await page.locator('#modalDrone img').count()).toBe(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });
});

test.describe('edit dialog and unlink', () => {
  test('unlinked airframe shows no link section', async ({ page }) => {
    await openFleet(page, { fixture: linkedFixture(), stock: ACTIVE() });
    const c = await expand(fleetCard(page, 'Charlie Mini'));
    await c.locator('[data-edit]').click();
    await expect(page.locator('#droneStockLink')).toBeHidden();
  });

  test('editing and saving a linked airframe keeps the link', async ({ page }) => {
    await openFleet(page, { fixture: linkedFixture(), stock: ACTIVE() });
    const c = await expand(fleetCard(page, 'Alpha Quad'));
    await c.locator('[data-edit]').click();
    await expect(page.locator('#droneStockLink')).toBeVisible();
    await expect(page.locator('#droneStockLinkText')).toContainText('Alpha Quad');
    await page.locator('#droneModel').fill('Changed');
    await page.locator('#formDrone button[type="submit"]').click();
    expect((await store(page, 'drones'))[0]).toMatchObject({ model: 'Changed', stockId: 's-a', stockName: 'Alpha Quad' });
  });

  test('Cancel on the confirm keeps the link; Unlink removes both fields and the item is offered again', async ({ page }) => {
    const stock = ACTIVE();
    const before = JSON.stringify(stock);
    await openFleet(page, { fixture: linkedFixture(), stock });
    await page.locator('#btnAddFromStock').click();
    await expect(page.locator('#stockPickerEmptyMsg')).toContainText('Nothing to add');
    await page.locator('#btnCancelStockPicker').click();

    const c = await expand(fleetCard(page, 'Alpha Quad'));
    await c.locator('[data-edit]').click();
    await page.locator('#btnUnlinkStock').click();
    await confirmDialog(page, false);
    expect((await store(page, 'drones'))[0].stockId).toBe('s-a');

    await page.locator('#btnUnlinkStock').click();
    await expect(page.locator('#btnConfirmOk')).toHaveText('Unlink');
    await confirmDialog(page, true);
    const d = (await store(page, 'drones'))[0];
    expect(d).not.toHaveProperty('stockId');
    expect(d).not.toHaveProperty('stockName');
    expect(d.name).toBe('Alpha Quad');
    await expect(page.locator('#droneStockLink')).toBeHidden();
    await expect(badge(page, 'Alpha Quad')).toHaveCount(0);

    await page.locator('#formDrone button[type="submit"]').click();
    await page.locator('#btnAddFromStock').click();
    await expect(page.locator('#stockPickerList label')).toHaveText([/Alpha Quad/]);
    expect(await raw(page)).toBe(before);
  });

  test('link section is translated', async ({ page }) => {
    await openFleet(page, { fixture: linkedFixture(), stock: ACTIVE(), lang: 'pt-BR' });
    const c = await expand(fleetCard(page, 'Alpha Quad'));
    await c.locator('[data-edit]').click();
    await expect(page.locator('#btnUnlinkStock')).toHaveText('Desvincular');
    await expect(page.locator('#droneStockLinkText')).toContainText('Vinculado ao item do FlyStock');
  });
});

const BASE = 'https://steelgar-code.github.io/FlyStock/';
const openEditDialog = async (page, name) => {
  const c = await expand(fleetCard(page, name));
  await c.locator('[data-edit]').click();
};

test.describe('deep links into FlyStock', () => {
  test('active item: card link and both dialog links have exact hrefs', async ({ page }) => {
    await openFleet(page, { fixture: linkedFixture(), stock: ACTIVE() });
    const b = badge(page, 'Alpha Quad');
    await expect(b).toHaveAttribute('href', `${BASE}#edit=s-a`);
    await expect(b).toHaveAttribute('target', '_blank');
    expect(await b.getAttribute('rel')).toContain('noopener');
    await openEditDialog(page, 'Alpha Quad');
    const open = page.locator('#stockOpenItem');
    const rem = page.locator('#stockRemoveItem');
    await expect(open).toBeVisible();
    await expect(rem).toBeVisible();
    await expect(open).toHaveAttribute('href', `${BASE}#edit=s-a`);
    await expect(rem).toHaveAttribute('href', `${BASE}#remove=s-a`);
    for (const l of [open, rem]) {
      await expect(l).toHaveAttribute('target', '_blank');
      expect(await l.getAttribute('rel')).toContain('noopener');
      expect(await l.getAttribute('title')).toBeTruthy();
    }
  });

  test('removed item: edit link only', async ({ page }) => {
    const stock = inv([item('s-a', 'Alpha Quad', { status: 'removed' }), item('s-b', 'Bravo Stock')]);
    await openFleet(page, { fixture: linkedFixture(), stock });
    await expect(badge(page, 'Alpha Quad')).toHaveAttribute('href', `${BASE}#edit=s-a`);
    await openEditDialog(page, 'Alpha Quad');
    await expect(page.locator('#stockOpenItem')).toBeVisible();
    await expect(page.locator('#stockRemoveItem')).toBeHidden();
  });

  for (const [name, stock] of [
    ['item missing', inv([item('other', 'Other')])],
    ['key absent', undefined],
    ['unreadable key', '{nope'],
  ]) {
    test(`${name}: no links, badge is not an anchor`, async ({ page }) => {
      await openFleet(page, { fixture: linkedFixture(), stock });
      await expect(badge(page, 'Alpha Quad')).toHaveText('Not found in FlyStock');
      expect(await badge(page, 'Alpha Quad').evaluate((e) => e.tagName)).toBe('SPAN');
      await openEditDialog(page, 'Alpha Quad');
      await expect(page.locator('#droneStockLinkText')).toBeVisible();
      await expect(page.locator('#stockOpenItem')).toBeHidden();
      await expect(page.locator('#stockRemoveItem')).toBeHidden();
    });
  }

  test('unlinked airframe shows no links', async ({ page }) => {
    await openFleet(page, { fixture: linkedFixture(), stock: ACTIVE() });
    await openEditDialog(page, 'Charlie Mini');
    await expect(page.locator('#stockOpenItem')).toBeHidden();
    await expect(page.locator('#stockRemoveItem')).toBeHidden();
  });

  test('after Unlink the links disappear', async ({ page }) => {
    await openFleet(page, { fixture: linkedFixture(), stock: ACTIVE() });
    await openEditDialog(page, 'Alpha Quad');
    await expect(page.locator('#stockOpenItem')).toBeVisible();
    await page.locator('#btnUnlinkStock').click();
    await confirmDialog(page, true);
    await expect(page.locator('#stockOpenItem')).toBeHidden();
    await expect(page.locator('#stockRemoveItem')).toBeHidden();
    await expect(badge(page, 'Alpha Quad')).toHaveCount(0);
  });

  test('clicking the card link does not toggle the card', async ({ page }) => {
    await openFleet(page, { fixture: linkedFixture(), stock: ACTIVE() });
    await page.evaluate(() => document.addEventListener('click', (e) => { if (e.target.closest('a[data-stock-badge]')) e.preventDefault(); }));
    const c = fleetCard(page, 'Alpha Quad');
    const header = c.locator('[role="button"][aria-expanded]').first();
    const before = await header.getAttribute('aria-expanded');
    await badge(page, 'Alpha Quad').click();
    expect(await header.getAttribute('aria-expanded')).toBe(before);
    await badge(page, 'Alpha Quad').focus();
    await page.keyboard.press('Enter');
    expect(await header.getAttribute('aria-expanded')).toBe(before);
  });

  test('unsafe stored stockId renders no link and injects nothing', async ({ page }) => {
    const fx = makeFixture();
    Object.assign(fx.drones[0], { stockId: 'x"onmouseover=alert(1)', stockName: 'Evil' });
    await openFleet(page, { fixture: fx, stock: ACTIVE() });
    const b = badge(page, 'Alpha Quad');
    await expect(b).toBeVisible();
    expect(await b.evaluate((e) => e.tagName)).toBe('SPAN');
    expect(await page.locator('#fleetGrid [onmouseover]').count()).toBe(0);
    expect(await page.locator('#fleetGrid a[href*="FlyStock"]').count()).toBe(0);
    await openEditDialog(page, 'Alpha Quad');
    await expect(page.locator('#stockOpenItem')).toBeHidden();
    await expect(page.locator('#stockRemoveItem')).toBeHidden();
  });

  test('labels are translated (uk)', async ({ page }) => {
    await openFleet(page, { fixture: linkedFixture(), stock: ACTIVE(), lang: 'uk' });
    await openEditDialog(page, 'Alpha Quad');
    await expect(page.locator('#stockOpenItem')).toHaveText('Відкрити у FlyStock');
    await expect(page.locator('#stockRemoveItem')).toHaveText('Видалити у FlyStock');
    expect(await page.locator('#stockOpenItem').getAttribute('title')).toContain('FlyStock');
  });
});
