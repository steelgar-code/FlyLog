const { test, expect, CONTEXT_OPTIONS, makeFixture, openApp, goTo, fleetCard, expand } = require('./support/app');

test.use(CONTEXT_OPTIONS);

const UNITS = {
  en: { y: 'y', mo: 'mo', d: 'd', h: 'h', m: 'm' },
  uk: { y: 'р', mo: 'міс', d: 'д', h: 'год', m: 'хв' },
  'pt-BR': { y: 'a', mo: 'mes', d: 'd', h: 'h', m: 'min' },
};

const spans = (page, a, b) => page.evaluate(([a, b]) => formatCalendarLifespan(new Date(a), new Date(b)), [a, b]);

for (const [lang, u] of Object.entries(UNITS)) {
  test(`[${lang}] month and minute labels differ and are translated`, async ({ page }) => {
    await openApp(page, { lang });
    expect(u.mo).not.toBe(u.m);
    expect(await spans(page, '2026-01-01T10:00', '2026-04-01T10:00')).toBe(`3${u.mo}`);
    expect(await spans(page, '2026-01-01T10:00', '2026-01-01T10:03')).toBe(`3${u.m}`);
    expect(await spans(page, '2025-01-01T10:00', '2026-04-27T13:45'))
      .toBe(`1${u.y} 3${u.mo} 26${u.d} 3${u.h} 45${u.m}`);
  });
}

test('multi-unit span reads 1y 3mo 25d 3h 45m on a drone card', async ({ page }) => {
  const fx = makeFixture();
  fx.flights = [
    { id: 'a', droneId: 'uav-alpha', droneName: 'Alpha Quad', batteryId: null, batteryName: '', startTime: '2024-01-10T08:00', endTime: '2024-01-10T08:30', duration: 30, notes: 'x', customValues: {} },
    { id: 'b', droneId: 'uav-alpha', droneName: 'Alpha Quad', batteryId: null, batteryName: '', startTime: '2025-05-05T11:00', endTime: '2025-05-05T11:45', duration: 45, notes: 'y', customValues: {} },
  ];
  // 2024-01-10 08:00 -> 2025-05-05 11:45 = 1y 3mo 25d 3h 45m
  await openApp(page, { fixture: fx });
  await goTo(page, 'fleet');
  const c = await expand(fleetCard(page, 'Alpha Quad'));
  await expect(c).toContainText('1y 3mo 25d 3h 45m');
  await goTo(page, 'dashboard');
  await expect(page.locator('#statLifespanMax')).toHaveText('1y 3mo 25d 3h 45m');
});

test.describe('daylight saving', () => {
  test.use({ timezoneId: 'Europe/Kyiv' });
  test('1 March 10:00 to 30 March 10:00 is 29d, not 28d 23h', async ({ page }) => {
    await openApp(page);
    expect(await spans(page, '2026-03-01T10:00', '2026-03-30T10:00')).toBe('29d');
    expect(await spans(page, '2026-03-01T10:00', '2026-03-30T10:45')).toBe('29d 45m');
    expect(await page.evaluate(() => formatCalendarLifespan(new Date(2026, 2, 1, 10), new Date(2026, 2, 30, 10)))).toBe('29d');
  });
});

test('dashboard total flight time uses translated unit labels', async ({ page }) => {
  await openApp(page, { lang: 'uk' });
  await expect(page.locator('#statTotalHours')).toHaveText('2год 50хв');
  await page.locator('.lang-select').first().selectOption('pt-BR');
  await expect(page.locator('#statTotalHours')).toHaveText('2h 50min');
});
