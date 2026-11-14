const {
  test, expect, CONTEXT_OPTIONS, openApp, store, fmt, fillFlightForm, flightRow,
} = require('./support/app');

test.use({ ...CONTEXT_OPTIONS, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const sidebar = (page) => page.locator('#sidebar');

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test('sidebar drawer is closed at first, opens with the menu button and closes via the overlay', async ({ page }) => {
  await expect(sidebar(page)).not.toBeInViewport();
  await expect(page.locator('#sidebarOverlay')).toBeHidden();

  await page.locator('#mobileMenuBtn').tap();
  await expect(sidebar(page)).toBeInViewport({ ratio: 0.99 });
  await expect(page.locator('#sidebarOverlay')).toBeVisible();
  await expect(sidebar(page).locator('[data-nav="fleet"]')).toBeVisible();

  // tap outside the drawer (right edge of the screen)
  await page.locator('#sidebarOverlay').tap({ position: { x: 370, y: 400 } });
  await expect(sidebar(page)).not.toBeInViewport();
  await expect(page.locator('#sidebarOverlay')).toBeHidden();
});

test('choosing a navigation item switches view and closes the drawer', async ({ page }) => {
  await page.locator('#mobileMenuBtn').tap();
  await expect(sidebar(page)).toBeInViewport({ ratio: 0.99 });
  await sidebar(page).locator('[data-nav="batteries"]').tap();
  await expect(page.locator('#viewBatteries')).toBeVisible();
  await expect(page.locator('#viewDashboard')).toBeHidden();
  await expect(sidebar(page)).not.toBeInViewport();
  await expect(page.locator('#sidebarOverlay')).toBeHidden();
});

test('a sidebar action (Export Backup) closes the drawer too', async ({ page }) => {
  await page.locator('#mobileMenuBtn').tap();
  await expect(sidebar(page)).toBeInViewport({ ratio: 0.99 });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#btnExportBackup').tap()]);
  expect(dl.suggestedFilename()).toMatch(/^flylog_backup_/);
  await expect(sidebar(page)).not.toBeInViewport();
});

test('a flight can be logged on a phone-sized screen', async ({ page }) => {
  const start = fmt(new Date(Date.now() - 4 * 3600000));
  await page.locator('#btnNewFlightHeader').tap();
  await expect(page.locator('#modalLogFlight')).toBeVisible();
  await fillFlightForm(page, { drone: 'Charlie Mini', battery: 'Pack C', start, duration: 25, notes: 'Phone flight' });
  await page.locator('#formLogFlight button[type="submit"]').scrollIntoViewIfNeeded();
  await page.locator('#formLogFlight button[type="submit"]').tap();
  await expect(page.locator('#modalLogFlight')).toBeHidden();

  await expect(page.locator('#statTotalFlights')).toHaveText('6');
  await expect(page.locator('#statTotalHours')).toHaveText('3h 15m');
  expect((await store(page, 'flights'))[0]).toMatchObject({
    droneId: 'uav-charlie', batteryId: 'bat-c', startTime: start, duration: 25, notes: 'Phone flight',
  });

  await page.locator('#mobileMenuBtn').tap();
  await sidebar(page).locator('[data-nav="flights"]').tap();
  await expect(flightRow(page, 'Phone flight')).toHaveCount(1);
  // no horizontal page scroll
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
