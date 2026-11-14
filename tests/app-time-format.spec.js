const { test, expect, CONTEXT_OPTIONS, makeFixture, openApp } = require('./support/app');

test.use(CONTEXT_OPTIONS);

test('total of 119.5 minutes shows 2h 0m, not 1h 60m', async ({ page }) => {
  const fx = makeFixture();
  fx.flights = fx.flights.slice(0, 2);
  fx.flights[0].duration = 59.5;
  fx.flights[1].duration = 60;
  await openApp(page, { fixture: fx });
  await expect(page.locator('#statTotalHours')).toHaveText('2h 0m');
});

test('lifespan helpers round minutes before splitting', async ({ page }) => {
  await openApp(page);
  const out = await page.evaluate(() => ({
    approx: formatApproxDuration(119.5 * 60000),
    calendar: formatCalendarLifespan(new Date(0), new Date(119.5 * 60000)),
  }));
  expect(out).toEqual({ approx: '2h', calendar: '2h' });
});
