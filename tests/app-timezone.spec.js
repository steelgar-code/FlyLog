const { test, expect, makeFixture, openApp, goTo, CONTEXT_OPTIONS } = require('./support/app');

// 2026-12-01 00:30 in Europe/Kyiv (UTC+2) is still 2026-11-30 in UTC.
test.use({ ...CONTEXT_OPTIONS, timezoneId: 'Europe/Kyiv' });

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-30T22:30:00Z') });
  const fx = makeFixture();
  fx.flights = [{
    id: 'today', droneId: 'uav-alpha', droneName: 'Alpha Quad', batteryId: null, batteryName: '',
    startTime: '2026-12-01T00:10', endTime: '2026-12-01T00:20', duration: 10, notes: 'just after midnight', customValues: {},
  }];
  await openApp(page, { fixture: fx });
  await goTo(page, 'flights');
});

test('This Month starts on the 1st and includes today', async ({ page }) => {
  await page.locator('#btnPresetMonth').click();
  await expect(page.locator('#filterStartDate')).toHaveValue('2026-12-01');
  await expect(page.locator('#filterEndDate')).toHaveValue('2026-12-01');
  await expect(page.locator('#flightsTableBody tr')).toHaveCount(1);
});

test('7D and 30D end today and start the right number of days back', async ({ page }) => {
  await page.locator('#btnPreset7d').click();
  await expect(page.locator('#filterEndDate')).toHaveValue('2026-12-01');
  await expect(page.locator('#filterStartDate')).toHaveValue('2026-11-24');
  await expect(page.locator('#flightsTableBody tr')).toHaveCount(1);
  await page.locator('#btnPreset30d').click();
  await expect(page.locator('#filterStartDate')).toHaveValue('2026-11-01');
});
