const { test, expect, CONTEXT_OPTIONS, openApp, store, goTo } = require('./support/app');

test.use(CONTEXT_OPTIONS);

const LANGS = [
  {
    code: 'uk', htmlLang: 'uk',
    nav: 'Флот і дрони', logbookTitle: 'Журнал польотів', readiness: '50% готовності', unitMin: 'хв',
    search: 'Пошук за нотатками, дронами, мітками батарей...', lifespan: 'Термін служби флоту',
  },
  {
    code: 'pt-BR', htmlLang: 'pt-BR',
    nav: 'Frota e drones', logbookTitle: 'Registro de voos', readiness: '50% pronta', unitMin: 'min',
    search: 'Buscar notas, drones, etiquetas de bateria...', lifespan: 'Tempo de vida da frota',
  },
];

test('starts in English', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#langSelect')).toHaveValue('en');
  await expect(page.locator('[data-i18n="navFleetDrones"]')).toHaveText('Fleet & Drones');
  await expect(page.locator('#sidebarReadiness')).toContainText('50% Ready');
});

for (const L of LANGS) {
  test(`switching to ${L.code} translates the UI and the choice persists across reload`, async ({ page }) => {
    await openApp(page);
    const nav = page.locator('[data-i18n="navFleetDrones"]');
    await expect(nav).toHaveText('Fleet & Drones');

    await page.locator('#langSelect').selectOption(L.code);
    await expect(nav).toHaveText(L.nav);
    await expect(page.locator('html')).toHaveAttribute('lang', L.htmlLang);
    await expect(page.locator('#sidebarReadiness')).toContainText(L.readiness); // dynamic text
    await expect(page.locator('[data-i18n="fleetLifespanTitle"]')).toHaveText(L.lifespan);
    await expect(page.locator('#filterSearch')).toHaveAttribute('placeholder', L.search); // attribute translation
    expect(await page.evaluate(() => localStorage.getItem('flylog-lang'))).toBe(L.code);

    // dynamic tables are re-rendered in the new language; user data is untouched
    await goTo(page, 'flights');
    await expect(page.locator('[data-i18n="flightLogbookTitle"]')).toHaveText(L.logbookTitle);
    const row = page.locator('#flightsTableBody tr').filter({ hasText: 'Roof inspection' });
    await expect(row).toContainText(`30 ${L.unitMin}`);
    await expect(row).toContainText('Alpha Quad');
    expect((await store(page, 'drones')).map((d) => d.name)).toEqual(['Alpha Quad', 'Bravo Hex', 'Charlie Mini', 'Delta Spare']);
    expect(await store(page, 'flights')).toHaveLength(5);

    // persists across reload
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', L.htmlLang);
    await expect(page.locator('#langSelect')).toHaveValue(L.code);
    await expect(page.locator('[data-i18n="navFleetDrones"]')).toHaveText(L.nav);
    await expect(page.locator('#sidebarReadiness')).toContainText(L.readiness);
  });
}

test('can switch back to English', async ({ page }) => {
  await openApp(page, { lang: 'uk' });
  await expect(page.locator('[data-i18n="navFleetDrones"]')).toHaveText('Флот і дрони');
  await page.locator('#langSelect').selectOption('en');
  await expect(page.locator('[data-i18n="navFleetDrones"]')).toHaveText('Fleet & Drones');
  await page.reload();
  await expect(page.locator('#langSelect')).toHaveValue('en');
  await expect(page.locator('[data-i18n="navFleetDrones"]')).toHaveText('Fleet & Drones');
});

test('dynamic fleet text follows the language, including Ukrainian plural forms', async ({ page }) => {
  await openApp(page, { lang: 'uk' });
  await goTo(page, 'fleet');
  // Alpha has 2 flights ("few" form), Charlie has 1 ("one" form), Delta 0 ("many" form)
  const text = async (name) => {
    await page.locator('#fleetGrid > div').filter({ has: page.locator('h3', { hasText: new RegExp(`^${name}$`) }) }).locator('h3').click();
    return page.locator('#fleetGrid > div').filter({ has: page.locator('h3', { hasText: new RegExp(`^${name}$`) }) }).innerText();
  };
  expect(await text('Alpha Quad')).toMatch(/2 польоти/);
  expect(await text('Charlie Mini')).toMatch(/1 політ(\s|$)/);
  expect(await text('Delta Spare')).toMatch(/0 польотів/);
});
