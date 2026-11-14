const { test, expect } = require('@playwright/test');
const { expectStyledApp, expectChart, expectIconFont } = require('./support/checks');

test('app loads over http with no errors and no external requests', async ({ page, baseURL }) => {
  const pageErrors = [];
  const consoleErrors = [];
  const origins = new Set();
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('request', (r) => { if (/^https?:/.test(r.url())) origins.add(new URL(r.url()).origin); });

  await page.goto('/index.html');
  await page.waitForLoadState('networkidle');
  await expectStyledApp(page);
  await expectChart(page);
  await expectIconFont(page);

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect([...origins]).toEqual([new URL(baseURL).origin]);
});
