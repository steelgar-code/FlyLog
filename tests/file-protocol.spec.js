const path = require('path');
const { pathToFileURL } = require('url');
const { test, expect } = require('@playwright/test');
const { expectStyledApp, expectChart, expectIconFont } = require('./support/checks');

test('index.html works when opened from disk (file://)', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto(pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href);
  await page.waitForLoadState('networkidle');
  await expectStyledApp(page);
  await expectChart(page);
  await expectIconFont(page);
  expect(pageErrors).toEqual([]);
});
