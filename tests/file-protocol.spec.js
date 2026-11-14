const path = require('path');
const { pathToFileURL } = require('url');
const { test, expect } = require('@playwright/test');
const { expectStyledApp, expectChart, expectIconFont } = require('./support/checks');

test('index.html works when opened from disk (file://)', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto(pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href);
  // Not 'networkidle': on file:// it intermittently never settles under parallel load.
  // Every file is local; page.goto already waited for `load`, and the checks below poll.
  await expectStyledApp(page);
  await expectChart(page);
  await expectIconFont(page);
  // No service worker can exist on file://; the indicator says the local copy works offline.
  await expect(page.locator('#offlineStatus')).toHaveAttribute('data-state', 'local');
  await expect(page.locator('#offlineStatus')).toContainText('Local files');
  await expect(page.locator('#updatePrompt')).toBeHidden();
  expect(pageErrors).toEqual([]);
});
