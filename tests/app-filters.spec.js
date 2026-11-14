const {
  test, expect, CONTEXT_OPTIONS, makeFixture, openApp, goTo, fmtDate, dayAt,
} = require('./support/app');

test.use(CONTEXT_OPTIONS);

const now = new Date();
const fx = makeFixture(now);
const rows = (page) => page.locator('#flightsTableBody tr');
const noteTexts = async (page) => (await rows(page).locator('td:nth-child(6)').allTextContents()).map((s) => s.trim());

test.beforeEach(async ({ page }) => {
  await openApp(page, { fixture: fx });
  await goTo(page, 'flights');
});

test('lists all flights newest first', async ({ page }) => {
  await expect(rows(page)).toHaveCount(5);
  // f5 (1d, no notes -> "-"), f1 (2d), f4 (5d), f2 (10d), f3 (20d)
  expect(await noteTexts(page)).toEqual(['-', 'Roof inspection', 'Battery swap test', 'Survey, "north" field', 'Training\nsecond line']);
});

test('text search matches notes, case-insensitively', async ({ page }) => {
  await page.locator('#filterSearch').fill('ROOF');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Roof inspection');
});

test('text search matches drone names and battery names', async ({ page }) => {
  await page.locator('#filterSearch').fill('bravo');
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).filter({ hasText: 'Battery swap test' })).toHaveCount(1);
  await expect(rows(page).filter({ hasText: 'Training' })).toHaveCount(1);

  await page.locator('#filterSearch').fill('pack a');
  await expect(rows(page)).toHaveCount(2); // f1 and f3 use Pack A
  await expect(rows(page).filter({ hasText: 'Roof inspection' })).toHaveCount(1);
  await expect(rows(page).filter({ hasText: 'Training' })).toHaveCount(1);
});

test('airframe dropdown filters by drone', async ({ page }) => {
  await expect(page.locator('#filterDrone option')).toHaveText(['All Airframes', 'Alpha Quad', 'Bravo Hex', 'Charlie Mini', 'Delta Spare']);
  await page.locator('#filterDrone').selectOption({ label: 'Alpha Quad' });
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).filter({ hasText: 'Alpha Quad' })).toHaveCount(2);

  await page.locator('#filterDrone').selectOption({ label: 'Delta Spare' });
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first().locator('button')).toHaveCount(0); // empty-state row
});

test('date range filters by flight start date (inclusive)', async ({ page }) => {
  const d = (n) => fmtDate(dayAt(now, n, 0));
  // from 10 days ago .. 2 days ago => f2 (10d), f4 (5d), f1 (2d)
  await page.locator('#filterStartDate').fill(d(10));
  await page.locator('#filterEndDate').fill(d(2));
  await expect(rows(page)).toHaveCount(3);
  expect(await noteTexts(page)).toEqual(['Roof inspection', 'Battery swap test', 'Survey, "north" field']);

  // start only
  await page.locator('#filterEndDate').fill('');
  await expect(rows(page)).toHaveCount(4); // + f5 (1d)

  // end only
  await page.locator('#filterStartDate').fill('');
  await page.locator('#filterEndDate').fill(d(10));
  await expect(rows(page)).toHaveCount(2); // f2 (10d), f3 (20d)
});

test('filters combine, show an empty state, and Reset clears them', async ({ page }) => {
  await page.locator('#filterDrone').selectOption({ label: 'Bravo Hex' });
  await page.locator('#filterSearch').fill('swap');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Battery swap test');

  await page.locator('#filterSearch').fill('roof'); // Roof inspection belongs to Alpha, not Bravo
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first().locator('button')).toHaveCount(0);
  await expect(rows(page).first()).toContainText('No flight logs matched');

  await page.locator('#filterStartDate').fill('2000-01-01');
  await page.locator('#btnResetFilters').click();
  await expect(page.locator('#filterSearch')).toHaveValue('');
  await expect(page.locator('#filterDrone')).toHaveValue('');
  await expect(page.locator('#filterStartDate')).toHaveValue('');
  await expect(page.locator('#filterEndDate')).toHaveValue('');
  await expect(rows(page)).toHaveCount(5);
});

test('filtering does not change the dashboard totals', async ({ page }) => {
  await page.locator('#filterSearch').fill('roof');
  await expect(rows(page)).toHaveCount(1);
  await expect(page.locator('#statTotalFlights')).toHaveText('5');
  await expect(page.locator('#badgeFlightCount')).toHaveText('5');
});
