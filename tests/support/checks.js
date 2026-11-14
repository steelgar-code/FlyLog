// Shared assertions for rendering checks (used over http and file://).
const { expect } = require('@playwright/test');

async function expectStyledApp(page) {
  // Tailwind applied: `hidden` => display none, html bg-slate-950, bg-brand-600 from tailwind.config.
  // (#importFileInput is always hidden; #offlineBadge shows whenever the browser is offline.)
  const hidden = await page.locator('#importFileInput').evaluate((el) => getComputedStyle(el).display);
  expect(hidden).toBe('none');
  const htmlBg = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
  expect(htmlBg).toBe('rgb(2, 6, 23)');
  const brand = await page.locator('#installBtn').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(brand).toBe('rgb(13, 148, 136)');
}

async function expectChart(page) {
  expect(await page.evaluate(() => typeof window.Chart)).toBe('function');
  for (const id of ['chartFlightHours', 'chartMissionTypes']) {
    await expect.poll(() => page.evaluate((i) => {
      const c = document.getElementById(i);
      return !!(c && window.Chart.getChart(c) && c.width > 0 && c.height > 0);
    }, id), { message: `canvas #${id} rendered` }).toBe(true);
  }
}

async function expectIconFont(page) {
  const icon = page.locator('i.fa-solid').first();
  await expect(icon).toHaveCount(1);
  const info = await icon.evaluate((el) => ({
    family: getComputedStyle(el).fontFamily,
    weight: getComputedStyle(el).fontWeight,
  }));
  expect(info.family).toContain('Font Awesome 6 Free');
  expect(info.weight).toBe('900');
  await expect.poll(() => page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].some((f) => f.family.includes('Font Awesome 6 Free') && f.status === 'loaded');
  })).toBe(true);
  expect(await page.evaluate(() => document.fonts.check('900 16px "Font Awesome 6 Free"'))).toBe(true);
}

module.exports = { expectStyledApp, expectChart, expectIconFont };
