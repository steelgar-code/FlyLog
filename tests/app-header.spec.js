const { test, expect, CONTEXT_OPTIONS, openApp } = require('./support/app');

test.use({ ...CONTEXT_OPTIONS, viewport: { width: 1440, height: 900 } });

test('header shows no invented weather/GPS readings at desktop width', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('header')).toBeVisible();
  for (const text of ['Clear Sky', 'kts', 'Sats']) {
    await expect(page.getByText(text, { exact: false })).toHaveCount(0);
  }
  await expect(page.locator('[data-i18n="weatherClearSky"], [data-i18n="unitKnots"], [data-i18n="unitSats"]')).toHaveCount(0);
});
