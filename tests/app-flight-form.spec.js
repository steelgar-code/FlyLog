const {
  test, expect, CONTEXT_OPTIONS, makeFixture, openApp, goTo, store, flightRow, editBtn, fillFlightForm, optionLabels,
} = require('./support/app');

test.use(CONTEXT_OPTIONS);

const save = (page) => page.locator('#formLogFlight button[type="submit"]').click();

test.describe('duration derived on save', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page, { fixture: makeFixture() });
    await page.locator('#btnNewFlightHeader').click();
  });

  for (const typed of ['', '0']) {
    test(`duration "${typed}" with valid times is computed from start/end`, async ({ page }) => {
      await fillFlightForm(page, { drone: 'Alpha Quad', start: '2026-01-05T10:00', end: '2026-01-05T10:45', notes: 'derived' });
      await page.locator('#flightDuration').fill(typed);
      await save(page);
      await expect(page.locator('#modalLogFlight')).toBeHidden();
      const f = (await store(page, 'flights')).find((x) => x.notes === 'derived');
      expect(f.duration).toBe(45);
    });
  }

  test('end before start still blocks saving', async ({ page }) => {
    await fillFlightForm(page, { drone: 'Alpha Quad', start: '2026-01-05T10:45', end: '2026-01-05T10:00', notes: 'bad' });
    await page.locator('#flightDuration').fill('');
    await save(page);
    await expect(page.locator('#modalLogFlight')).toBeVisible();
    await expect(page.locator('#flightTimeOrderError')).toBeVisible();
    expect((await store(page, 'flights')).some((x) => x.notes === 'bad')).toBe(false);
  });

  test('explicit duration is kept as typed', async ({ page }) => {
    await fillFlightForm(page, { drone: 'Alpha Quad', start: '2026-01-05T10:00', end: '2026-01-05T10:45', notes: 'explicit' });
    await page.locator('#flightDuration').fill('12');
    await save(page);
    await expect(page.locator('#modalLogFlight')).toBeHidden();
    expect((await store(page, 'flights')).find((x) => x.notes === 'explicit').duration).toBe(12);
  });
});

test.describe('editing a flight whose drone/battery was deleted', () => {
  const fx = makeFixture();
  fx.flights[0].droneId = 'uav-gone'; fx.flights[0].droneName = 'Ghost Quad';
  fx.flights[0].batteryId = 'bat-gone'; fx.flights[0].batteryName = 'Ghost Pack';

  test('keeps stored ids and names when only notes change', async ({ page }) => {
    await openApp(page, { fixture: fx });
    await goTo(page, 'flights');
    await editBtn(flightRow(page, 'Roof inspection')).click();
    await expect(page.locator('#flightDrone option:checked')).toHaveText('Ghost Quad (deleted)');
    await expect(page.locator('#flightBattery option:checked')).toHaveText('Ghost Pack (deleted)');
    await page.locator('#flightNotes').fill('Roof inspection edited');
    await save(page);
    await expect(page.locator('#modalLogFlight')).toBeHidden();
    const f = (await store(page, 'flights')).find((x) => x.id === 'f1');
    expect(f).toMatchObject({ droneId: 'uav-gone', droneName: 'Ghost Quad', batteryId: 'bat-gone', batteryName: 'Ghost Pack', notes: 'Roof inspection edited' });
  });

  test('new flights and other edits do not offer deleted items', async ({ page }) => {
    await openApp(page, { fixture: fx });
    await page.locator('#btnNewFlightHeader').click();
    expect((await optionLabels(page.locator('#flightDrone'))).join('|')).not.toContain('Ghost');
    expect((await optionLabels(page.locator('#flightBattery'))).join('|')).not.toContain('Ghost');
    await page.keyboard.press('Escape');
    await goTo(page, 'flights');
    await editBtn(flightRow(page, 'Battery swap test')).click();
    expect((await optionLabels(page.locator('#flightDrone'))).join('|')).not.toContain('Ghost');
  });

  test('marker is translated', async ({ page }) => {
    await openApp(page, { fixture: fx, lang: 'uk' });
    await goTo(page, 'flights');
    await editBtn(flightRow(page, 'Roof inspection')).click();
    await expect(page.locator('#flightDrone option:checked')).toHaveText('Ghost Quad (видалено)');
  });
});
