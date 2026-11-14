const { test, expect, CONTEXT_OPTIONS, makeFixture, openApp, goTo } = require('./support/app');

test.use(CONTEXT_OPTIONS);

const L = {
  uk: { agg: 'Місячні підсумки', ds: 'Години польоту', p7: '7д', p30: '30д', ph: 'напр. 25', locale: 'uk' },
  'pt-BR': { agg: 'Totais mensais', ds: 'Horas de voo', p7: '7d', p30: '30d', ph: 'ex.: 25', locale: 'pt-BR' },
};

function fixtureWithNumberField() {
  const fx = makeFixture();
  fx.customFields = [{ id: 'cf1', label: 'Score', type: 'number' }];
  return fx;
}

const chart = (page, id) => page.evaluate((id) => {
  const c = window.Chart.getChart(document.getElementById(id));
  return { labels: [...c.data.labels], ds: c.data.datasets[0].label };
}, id);

async function expectedLabels(page, locale) {
  return page.evaluate((loc) => {
    const now = new Date();
    const months = [];
    for (let i = 5; i >= 0; i--) months.push(new Date(now.getFullYear(), now.getMonth() - i, 1).toLocaleDateString(loc, { month: 'short' }));
    const days = [];
    for (let i = 29; i >= 0; i--) days.push(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i).toLocaleDateString(loc, { month: 'numeric', day: 'numeric' }));
    return { months, days };
  }, locale);
}

async function check(page, l) {
  await expect(page.locator('#btnPreset7d')).toHaveText(l.p7);
  await expect(page.locator('#btnPreset30d')).toHaveText(l.p30);
  await expect(page.locator('#flightDuration')).toHaveAttribute('placeholder', l.ph);
  await expect(page.locator('#customFieldChartsContainer')).toContainText(l.agg);
  await expect(page.locator('#customFieldChartsContainer')).not.toContainText('Monthly Aggregates');
  const exp = await expectedLabels(page, l.locale);
  await expect.poll(() => chart(page, 'chartFlightHours')).toEqual({ labels: exp.months, ds: l.ds });
  await page.locator('[data-hours-period="30d"]').click();
  await expect.poll(() => chart(page, 'chartFlightHours')).toEqual({ labels: exp.days, ds: l.ds });
  await page.locator('[data-hours-period="monthly"]').click();
}

for (const [code, l] of Object.entries(L)) {
  test(`[${code}] chart, preset and placeholder strings follow the language`, async ({ page }) => {
    await openApp(page, { fixture: fixtureWithNumberField(), lang: code });
    await check(page, l);
  });

  test(`[${code}] strings update when switching language at runtime`, async ({ page }) => {
    await openApp(page, { fixture: fixtureWithNumberField(), lang: 'en' });
    await expect(page.locator('#btnPreset7d')).toHaveText('7D');
    await expect(page.locator('#customFieldChartsContainer')).toContainText('Monthly Aggregates');
    expect((await chart(page, 'chartFlightHours')).ds).toBe('Flight Hours');
    await page.locator('.lang-select').first().selectOption(code);
    await check(page, l);
    await page.locator('.lang-select').first().selectOption('en');
    await expect(page.locator('#btnPreset7d')).toHaveText('7D');
    await expect(page.locator('#flightDuration')).toHaveAttribute('placeholder', 'e.g. 25');
    await expect(page.locator('#customFieldChartsContainer')).toContainText('Monthly Aggregates');
    await expect.poll(async () => (await chart(page, 'chartFlightHours')).ds).toBe('Flight Hours');
  });
}
