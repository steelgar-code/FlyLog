const {
  test, expect, CONTEXT_OPTIONS, makeFixture, openApp, store, goTo, fleetCard, expand, confirmDialog,
} = require('./support/app');

test.use(CONTEXT_OPTIONS);

const KEY = 'stockroom_inventory_v1';
const item = (id, description, extra = {}) => ({ id, type: 'Quad', description, status: 'active', dateAdded: '2026-01-01', dateRemoved: null, notes: [], ...extra });
const inv = (items) => ({ types: ['Quad'], items });
const raw = (page) => page.evaluate((k) => localStorage.getItem(k), KEY);
const badge = (page, name) => fleetCard(page, name).locator('[data-stock-badge]');
const actions = (page) => page.locator('#modalStockActions');
const openActions = async (page, name) => { await badge(page, name).click(); await expect(actions(page)).toBeVisible(); };

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
    await page.locator('#btnAddDroneModal').click();
    await page.locator('#btnDroneFromStock').click();
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
    await page.locator('#btnAddDroneModal').click();
    await page.locator('#btnDroneFromStock').click();
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
  test('active item: both edit-dialog links have exact hrefs', async ({ page }) => {
    await openFleet(page, { fixture: linkedFixture(), stock: ACTIVE() });
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
    await openEditDialog(page, 'Alpha Quad');
    await expect(page.locator('#stockOpenItem')).toBeVisible();
    await expect(page.locator('#stockRemoveItem')).toBeHidden();
  });

  for (const [name, stock] of [
    ['item missing', inv([item('other', 'Other')])],
    ['key absent', undefined],
    ['unreadable key', '{nope'],
  ]) {
    test(`${name}: no links, badge is a button`, async ({ page }) => {
      await openFleet(page, { fixture: linkedFixture(), stock });
      await expect(badge(page, 'Alpha Quad')).toHaveText('Not found in FlyStock');
      expect(await badge(page, 'Alpha Quad').evaluate((e) => e.tagName)).toBe('BUTTON');
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

  test('clicking the card badge does not toggle the card', async ({ page }) => {
    await openFleet(page, { fixture: linkedFixture(), stock: ACTIVE() });
    const c = fleetCard(page, 'Alpha Quad');
    const header = c.locator('[role="button"][aria-expanded]').first();
    const before = await header.getAttribute('aria-expanded');
    await badge(page, 'Alpha Quad').click();
    await expect(actions(page)).toBeVisible();
    expect(await header.getAttribute('aria-expanded')).toBe(before);
    await page.keyboard.press('Escape');
    await badge(page, 'Alpha Quad').focus();
    await page.keyboard.press('Enter');
    await expect(actions(page)).toBeVisible();
    expect(await header.getAttribute('aria-expanded')).toBe(before);
  });

  test('unsafe stored stockId renders no link and injects nothing', async ({ page }) => {
    const fx = makeFixture();
    Object.assign(fx.drones[0], { stockId: 'x"onmouseover=alert(1)', stockName: 'Evil' });
    await openFleet(page, { fixture: fx, stock: ACTIVE() });
    const b = badge(page, 'Alpha Quad');
    await expect(b).toBeVisible();
    expect(await b.evaluate((e) => e.tagName)).toBe('BUTTON');
    await b.click();
    await expect(actions(page)).toBeVisible();
    await expect(page.locator('#stockActionsOpen')).toBeHidden();
    await expect(page.locator('#stockActionsRemove')).toBeHidden();
    await expect(page.locator('#stockActionsUnlink')).toBeVisible();
    await page.keyboard.press('Escape');
    expect(await page.locator('[onmouseover]').count()).toBe(0);
    expect(await page.locator('#fleetGrid a[href*="FlyStock"], #modalStockActions a:visible').count()).toBe(0);
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

test.describe('FlyStock actions popup on the card badge', () => {
  const OPEN = '#stockActionsOpen', REM = '#stockActionsRemove', UNL = '#stockActionsUnlink';

  test('badge is a button; click opens the popup without toggling the card', async ({ page }) => {
    await openFleet(page, { fixture: linkedFixture(), stock: ACTIVE() });
    const b = badge(page, 'Alpha Quad');
    expect(await b.evaluate((e) => e.tagName)).toBe('BUTTON');
    expect(await b.getAttribute('aria-label')).toContain('FlyStock actions');
    await expect(actions(page)).toBeHidden();
    const header = fleetCard(page, 'Alpha Quad').locator('[role="button"][aria-expanded]').first();
    const before = await header.getAttribute('aria-expanded');
    await b.click();
    await expect(actions(page)).toBeVisible();
    await expect(page.locator('#modalStockActionsTitle')).toHaveText('Alpha Quad');
    expect(await header.getAttribute('aria-expanded')).toBe(before);
  });

  test('active item: Open, Remove and Unlink with exact hrefs', async ({ page }) => {
    await openFleet(page, { fixture: linkedFixture(), stock: ACTIVE() });
    await openActions(page, 'Alpha Quad');
    await expect(page.locator(OPEN)).toHaveAttribute('href', `${BASE}#edit=s-a`);
    await expect(page.locator(REM)).toHaveAttribute('href', `${BASE}#remove=s-a`);
    for (const sel of [OPEN, REM]) {
      await expect(page.locator(sel)).toBeVisible();
      await expect(page.locator(sel)).toHaveAttribute('target', '_blank');
      expect(await page.locator(sel).getAttribute('rel')).toContain('noopener');
    }
    await expect(page.locator(UNL)).toBeVisible();
  });

  test('removed item: Open and Unlink only', async ({ page }) => {
    const stock = inv([item('s-a', 'Alpha Quad', { status: 'removed' }), item('s-b', 'Bravo Stock')]);
    await openFleet(page, { fixture: linkedFixture(), stock });
    await openActions(page, 'Alpha Quad');
    await expect(page.locator(OPEN)).toHaveAttribute('href', `${BASE}#edit=s-a`);
    await expect(page.locator(REM)).toBeHidden();
    await expect(page.locator(UNL)).toBeVisible();
    await expect(page.locator('#stockActionsText')).toHaveText('Removed in FlyStock');
  });

  for (const [name, stock] of [
    ['item missing', inv([item('other', 'Other')])],
    ['key absent', undefined],
    ['unreadable key', '{nope'],
  ]) {
    test(`${name}: Unlink only`, async ({ page }) => {
      await openFleet(page, { fixture: linkedFixture(), stock });
      await openActions(page, 'Alpha Quad');
      await expect(page.locator('#stockActionsText')).toHaveText('Not found in FlyStock');
      await expect(page.locator(OPEN)).toBeHidden();
      await expect(page.locator(REM)).toBeHidden();
      await expect(page.locator(UNL)).toBeVisible();
    });
  }

  test('unsafe stored stockId: Unlink only, nothing injected', async ({ page }) => {
    const fx = makeFixture();
    Object.assign(fx.drones[0], { stockId: 'x"onmouseover=alert(1)', stockName: 'Evil' });
    await openFleet(page, { fixture: fx, stock: ACTIVE() });
    await openActions(page, 'Alpha Quad');
    await expect(page.locator(OPEN)).toBeHidden();
    await expect(page.locator(REM)).toBeHidden();
    await expect(page.locator(UNL)).toBeVisible();
    expect(await page.locator('[onmouseover]').count()).toBe(0);
  });

  test('clicking Open closes the popup', async ({ page, context }) => {
    await context.route(`${BASE}**`, (r) => r.abort());
    await openFleet(page, { fixture: linkedFixture(), stock: ACTIVE() });
    await openActions(page, 'Alpha Quad');
    const popup = context.waitForEvent('page').catch(() => null);
    await page.locator(OPEN).click();
    await expect(actions(page)).toBeHidden();
    const p = await popup;
    if (p) await p.close();
  });

  test('clicking Remove closes the popup', async ({ page, context }) => {
    await context.route(`${BASE}**`, (r) => r.abort());
    await openFleet(page, { fixture: linkedFixture(), stock: ACTIVE() });
    await openActions(page, 'Alpha Quad');
    const popup = context.waitForEvent('page').catch(() => null);
    await page.locator(REM).click();
    await expect(actions(page)).toBeHidden();
    const p = await popup;
    if (p) await p.close();
  });

  test('Unlink: confirm label, cancel keeps the link, OK unlinks and closes', async ({ page }) => {
    const stock = ACTIVE();
    const before = JSON.stringify(stock);
    await openFleet(page, { fixture: linkedFixture(), stock });
    await openActions(page, 'Alpha Quad');
    await page.locator(UNL).click();
    await expect(page.locator('#btnConfirmOk')).toHaveText('Unlink');
    await confirmDialog(page, false);
    expect((await store(page, 'drones'))[0].stockId).toBe('s-a');
    await expect(actions(page)).toBeVisible();

    await page.locator(UNL).click();
    await confirmDialog(page, true);
    await expect(actions(page)).toBeHidden();
    const d = (await store(page, 'drones'))[0];
    expect(d).not.toHaveProperty('stockId');
    expect(d).not.toHaveProperty('stockName');
    await expect(badge(page, 'Alpha Quad')).toHaveCount(0);
    await expect(page.locator('#toastContainer, #toast').first()).toContainText('unlinked');
    await page.locator('#btnAddDroneModal').click();
    await page.locator('#btnDroneFromStock').click();
    await expect(page.locator('#stockPickerList label')).toHaveText([/Alpha Quad/]);
    expect(await raw(page)).toBe(before);
  });

  test('Escape closes only the popup; Cancel and backdrop close it', async ({ page }) => {
    await openFleet(page, { fixture: linkedFixture(), stock: ACTIVE() });
    await openActions(page, 'Alpha Quad');
    await page.keyboard.press('Escape');
    await expect(actions(page)).toBeHidden();
    await expect(page.locator('#viewFleet')).toBeVisible();
    await openActions(page, 'Alpha Quad');
    await page.locator('#btnCancelStockActions').click();
    await expect(actions(page)).toBeHidden();
    await openActions(page, 'Alpha Quad');
    await actions(page).click({ position: { x: 3, y: 3 } });
    await expect(actions(page)).toBeHidden();
  });

  test('unlinked airframes have no badge', async ({ page }) => {
    await openFleet(page, { fixture: linkedFixture(), stock: ACTIVE() });
    await expect(badge(page, 'Charlie Mini')).toHaveCount(0);
  });

  test('crafted stockName shows as text in the popup', async ({ page }) => {
    const evil = '<img src=x onerror=window.__xss=1>';
    await openFleet(page, { fixture: linkedFixture(), stock: inv([item('s-a', evil), item('s-b', 'Bravo Stock')]) });
    await openActions(page, evil);
    await expect(page.locator('#modalStockActionsTitle')).toHaveText(evil);
    await expect(page.locator('#stockActionsText')).toContainText(evil);
    expect(await actions(page).locator('img').count()).toBe(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });

  test('uk labels', async ({ page }) => {
    await openFleet(page, { fixture: linkedFixture(), stock: ACTIVE(), lang: 'uk' });
    expect(await badge(page, 'Alpha Quad').getAttribute('aria-label')).toContain('Дії FlyStock');
    await openActions(page, 'Alpha Quad');
    await expect(page.locator(OPEN)).toHaveText('Відкрити у FlyStock');
    await expect(page.locator(REM)).toHaveText('Видалити у FlyStock');
    await expect(page.locator(UNL)).toHaveText('Від’єднати');
  });

  test('no horizontal overflow on a phone; stock key untouched', async ({ page }) => {
    const stock = inv([item('s-a', 'Alpha Quad With A Very Long Description That Keeps Going And Going'), item('s-b', 'Bravo Stock')]);
    const before = JSON.stringify(stock);
    await page.setViewportSize({ width: 390, height: 844 });
    await openApp(page, { fixture: linkedFixture(), stock });
    await page.locator('#mobileMenuBtn').click();
    await page.locator('#sidebar [data-nav="fleet"]').click();
    await expect(page.locator('#viewFleet')).toBeVisible();
    await openActions(page, 'Bravo Hex');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth &&
      [...document.querySelectorAll('#modalStockActions > div')].every((d) => d.scrollWidth <= d.clientWidth))).toBe(true);
    await page.keyboard.press('Escape');
    expect(await raw(page)).toBe(before);
  });
});

// ---- Link an existing airframe to a FlyStock item (single-select picker mode) ----
const picker = (page) => page.locator('#modalStockPicker');
const rows = (page) => page.locator('#stockPickerList label');
const rowTexts = (page) => rows(page).locator('span.font-medium').allTextContents();
const pickRow = (page, text) => rows(page).filter({ hasText: text }).locator('input').check();
const linkBtn = (page) => page.locator('#btnLinkStock');
const confirmBtn = (page) => page.locator('#btnStockAddSelected');
const CHARLIE = () => inv([item('s-c', 'Charlie Stock'), item('s-d', 'Delta Stock'), item('s-x', 'Gone Stock', { status: 'removed' }), item('s-a', 'Alpha Quad')]);
const fx2 = () => { const fx = makeFixture(); Object.assign(fx.drones[0], { stockId: 's-a', stockName: 'Alpha Quad' }); return fx; };

test.describe('link existing airframe', () => {
  test('action only for unlinked airframes in edit, never in New Airframe', async ({ page }) => {
    await openFleet(page, { fixture: fx2(), stock: CHARLIE() });
    await openEditDialog(page, 'Alpha Quad');
    await expect(linkBtn(page)).toBeHidden();
    await page.locator('#btnCancelDrone').click();
    await openEditDialog(page, 'Charlie Mini');
    await expect(linkBtn(page)).toBeVisible();
    await expect(linkBtn(page)).toContainText('Link to FlyStock item');
    await page.locator('#btnCancelDrone').click();
    await page.locator('#btnAddDroneModal').click();
    await expect(linkBtn(page)).toBeHidden();
  });

  test('single selection, disabled until chosen, title names the airframe, items offered correctly', async ({ page }) => {
    await openFleet(page, { fixture: fx2(), stock: CHARLIE() });
    await openEditDialog(page, 'Charlie Mini');
    await linkBtn(page).click();
    await expect(picker(page)).toBeVisible();
    await expect(page.locator('#modalDrone')).toBeVisible();
    await expect(page.locator('#modalStockPickerTitle')).toHaveText('Link "Charlie Mini" to a FlyStock item');
    await expect(confirmBtn(page)).toHaveText('Link');
    await expect(confirmBtn(page)).toBeDisabled();
    expect((await rowTexts(page)).sort()).toEqual(['Charlie Stock', 'Delta Stock']);
    expect(await rows(page).locator('input').first().getAttribute('type')).toBe('radio');
    await pickRow(page, 'Charlie Stock');
    await expect(confirmBtn(page)).toBeEnabled();
    await pickRow(page, 'Delta Stock');
    await expect(rows(page).locator('input:checked')).toHaveCount(1);
    await expect(rows(page).filter({ hasText: 'Delta Stock' }).locator('input')).toBeChecked();
    await page.locator('#stockSearch').fill('delta');
    expect(await rowTexts(page)).toEqual(['Delta Stock']);
  });

  test('linking stores only stockId/stockName, refreshes the dialog, badge, hrefs; stock untouched', async ({ page }) => {
    const stock = CHARLIE();
    const before = JSON.stringify(stock);
    await openFleet(page, { fixture: fx2(), stock });
    const flightsBefore = await store(page, 'flights');
    const dBefore = (await store(page, 'drones'))[2];
    await openEditDialog(page, 'Charlie Mini');
    await linkBtn(page).click();
    await pickRow(page, 'Delta Stock');
    await confirmBtn(page).click();
    await expect(picker(page)).toBeHidden();
    await expect(page.locator('#modalDrone')).toBeVisible();
    await expect(page.locator('#droneStockLinkText')).toContainText('Delta Stock');
    await expect(page.locator('#stockOpenItem')).toHaveAttribute('href', `${BASE}#edit=s-d`);
    await expect(page.locator('#stockRemoveItem')).toHaveAttribute('href', `${BASE}#remove=s-d`);
    await expect(page.locator('#btnUnlinkStock')).toBeVisible();
    await expect(linkBtn(page)).toBeHidden();
    const dAfter = (await store(page, 'drones'))[2];
    expect(dAfter).toEqual({ ...dBefore, stockId: 's-d', stockName: 'Delta Stock' });
    expect(await store(page, 'flights')).toEqual(flightsBefore);
    await expect(badge(page, 'Charlie Mini')).toBeVisible();
    expect(await raw(page)).toBe(before);
    // no longer offered
    await page.locator('#btnCancelDrone').click();
    await page.locator('#btnAddDroneModal').click();
    await page.locator('#btnDroneFromStock').click();
    expect(await rowTexts(page)).toEqual(['Charlie Stock']);
  });

  test('cancel changes nothing; Escape and backdrop close only the picker', async ({ page }) => {
    await openFleet(page, { fixture: fx2(), stock: CHARLIE() });
    const dBefore = await store(page, 'drones');
    await openEditDialog(page, 'Charlie Mini');
    await linkBtn(page).click();
    await pickRow(page, 'Charlie Stock');
    await page.locator('#btnCancelStockPicker').click();
    await expect(picker(page)).toBeHidden();
    await expect(page.locator('#modalDrone')).toBeVisible();
    await expect(linkBtn(page)).toBeVisible();
    await linkBtn(page).click();
    await page.keyboard.press('Escape');
    await expect(picker(page)).toBeHidden();
    await expect(page.locator('#modalDrone')).toBeVisible();
    await linkBtn(page).click();
    await picker(page).click({ position: { x: 3, y: 3 } });
    await expect(picker(page)).toBeHidden();
    await expect(page.locator('#modalDrone')).toBeVisible();
    expect(await store(page, 'drones')).toEqual(dBefore);
  });

  test('unsaved form text survives linking and is only persisted on Save', async ({ page }) => {
    await openFleet(page, { fixture: fx2(), stock: CHARLIE() });
    await openEditDialog(page, 'Charlie Mini');
    await page.locator('#droneName').fill('Typed Name');
    await page.locator('#droneHours').fill('9.5');
    await linkBtn(page).click();
    await pickRow(page, 'Charlie Stock');
    await confirmBtn(page).click();
    await expect(page.locator('#droneName')).toHaveValue('Typed Name');
    await expect(page.locator('#droneHours')).toHaveValue('9.5');
    let d = (await store(page, 'drones'))[2];
    expect(d).toMatchObject({ name: 'Charlie Mini', flightHours: makeFixture().drones[2].flightHours, stockId: 's-c' });
    await page.locator('#formDrone button[type="submit"]').click();
    d = (await store(page, 'drones'))[2];
    expect(d).toMatchObject({ name: 'Typed Name', flightHours: 9.5, stockId: 's-c', stockName: 'Charlie Stock' });
  });

  test('unlink then link again; add flow is multi-select afterwards', async ({ page }) => {
    await openFleet(page, { fixture: fx2(), stock: CHARLIE() });
    await openEditDialog(page, 'Alpha Quad');
    await page.locator('#btnUnlinkStock').click();
    await confirmDialog(page, true);
    await expect(linkBtn(page)).toBeVisible();
    await linkBtn(page).click();
    expect((await rowTexts(page)).sort()).toEqual(['Alpha Quad', 'Charlie Stock', 'Delta Stock']);
    await pickRow(page, 'Alpha Quad');
    await confirmBtn(page).click();
    expect((await store(page, 'drones'))[0]).toMatchObject({ stockId: 's-a', stockName: 'Alpha Quad' });
    await page.locator('#btnCancelDrone').click();
    await page.locator('#btnAddDroneModal').click();
    await page.locator('#btnDroneFromStock').click();
    await expect(page.locator('#modalStockPickerTitle')).toHaveText('Add airframes from FlyStock');
    await expect(confirmBtn(page)).toContainText('Add selected');
    expect(await rows(page).locator('input').first().getAttribute('type')).toBe('checkbox');
    await pickRow(page, 'Charlie Stock');
    await pickRow(page, 'Delta Stock');
    await expect(rows(page).locator('input:checked')).toHaveCount(2);
  });

  test('refuses if the item got linked, or removed, meanwhile', async ({ page }) => {
    await openFleet(page, { fixture: fx2(), stock: CHARLIE() });
    await openEditDialog(page, 'Charlie Mini');
    await linkBtn(page).click();
    await pickRow(page, 'Delta Stock');
    await page.evaluate((k) => {
      const v = JSON.parse(localStorage.getItem(k));
      v.items.find((i) => i.id === 's-d').status = 'removed';
      localStorage.setItem(k, JSON.stringify(v));
    }, KEY);
    await confirmBtn(page).click();
    await expect(picker(page)).toBeHidden();
    await expect(page.locator('#toastContainer')).toContainText('no longer available');
    expect((await store(page, 'drones'))[2]).not.toHaveProperty('stockId');
    await expect(linkBtn(page)).toBeVisible();
  });

  test('empty state when FlyStock has no data', async ({ page }) => {
    await openFleet(page, { fixture: fx2() });
    await openEditDialog(page, 'Charlie Mini');
    await linkBtn(page).click();
    await expect(page.locator('#stockPickerEmpty')).toBeVisible();
    await expect(page.locator('#stockPickerEmptyMsg')).toContainText('No FlyStock inventory');
    await expect(confirmBtn(page)).toBeDisabled();
    expect(await raw(page)).toBeNull();
  });

  test('crafted description is text in the picker, title and dialog after linking', async ({ page }) => {
    const evil = '<img src=x onerror=window.__xss=1>';
    const stock = inv([item('s-e', evil)]);
    const before = JSON.stringify(stock);
    const fx = makeFixture();
    fx.drones[2].name = evil;
    await openFleet(page, { fixture: fx, stock });
    await openEditDialog(page, evil);
    await linkBtn(page).click();
    await expect(page.locator('#modalStockPickerTitle')).toContainText(evil);
    await expect(rows(page).first()).toContainText(evil);
    await pickRow(page, evil);
    await confirmBtn(page).click();
    await expect(page.locator('#droneStockLinkText')).toContainText(evil);
    expect(await page.locator('#modalDrone img, #modalStockPicker img, #fleetGrid img').count()).toBe(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    expect(await raw(page)).toBe(before);
  });

  test('uk labels for both new actions', async ({ page }) => {
    await openFleet(page, { fixture: fx2(), stock: CHARLIE(), lang: 'uk' });
    await page.locator('#btnAddDroneModal').click();
    await expect(page.locator('#btnDroneFromStock')).toContainText('Додати з FlyStock…');
    await page.locator('#btnCancelDrone').click();
    await openEditDialog(page, 'Charlie Mini');
    await expect(linkBtn(page)).toContainText('Пов’язати з позицією FlyStock…');
    await linkBtn(page).click();
    await expect(confirmBtn(page)).toContainText('Пов’язати');
  });

  test('modals do not overflow horizontally on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openApp(page, { fixture: fx2(), stock: CHARLIE() });
    await page.locator('#mobileMenuBtn').click();
    await page.locator('#sidebar [data-nav="fleet"]').click();
    await expect(page.locator('#viewFleet')).toBeVisible();
    const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth &&
      [...document.querySelectorAll('#modalDrone > div, #modalStockPicker > div')].every((d) => d.scrollWidth <= d.clientWidth));
    await page.locator('#btnAddDroneModal').click();
    expect(await noOverflow()).toBe(true);
    await page.locator('#btnCancelDrone').click();
    await openEditDialog(page, 'Charlie Mini');
    expect(await noOverflow()).toBe(true);
    await linkBtn(page).click();
    await pickRow(page, 'Charlie Stock');
    expect(await noOverflow()).toBe(true);
    await confirmBtn(page).click();
    expect(await noOverflow()).toBe(true);
  });
});
