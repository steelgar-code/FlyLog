const {
  test, expect, CONTEXT_OPTIONS, makeFixture, openApp, chartData, dayAt,
  expectedMonthly, expectedWeekly, expectedDaily, fmt,
} = require('./support/app');

test.use(CONTEXT_OPTIONS);

const now = new Date();

test.describe('stat tiles', () => {
  test('match the fixture', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('#statTotalHours')).toHaveText('2h 50m');
    await expect(page.locator('#statTotalFlights')).toHaveText('5');
    await expect(page.locator('#statActiveDrones')).toHaveText('2'); // Alpha + Charlie are Ready
    await expect(page.locator('#statBatteriesCount')).toHaveText('3');
    await expect(page.locator('#badgeFlightCount')).toHaveText('5');
    await expect(page.locator('#sidebarReadiness')).toContainText('50%'); // 2 of 4 drones ready
  });

  test('tiles for an empty app', async ({ page }) => {
    await openApp(page, { fixture: { ...makeFixture(), flights: [], drones: [], batteries: [] } });
    await expect(page.locator('#statTotalHours')).toHaveText('0h 0m');
    await expect(page.locator('#statTotalFlights')).toHaveText('0');
    await expect(page.locator('#statActiveDrones')).toHaveText('0');
    await expect(page.locator('#statBatteriesCount')).toHaveText('0');
    await expect(page.locator('#dashboardRecentTable tr')).toHaveCount(1); // empty-state row
    await expect(page.locator('#dashboardRecentTable button')).toHaveCount(0);
  });

  test('recent flights table: newest first, at most five', async ({ page }) => {
    const fx = makeFixture();
    // two more, older than every existing flight (Delta has none, so lifespans are unaffected)
    for (const [id, daysAgo] of [['f6', 25], ['f7', 27]]) {
      const start = dayAt(now, daysAgo, 12);
      fx.flights.push({
        id, droneId: 'uav-delta', droneName: 'Delta Spare', batteryId: null, batteryName: '',
        startTime: fmt(start), endTime: fmt(dayAt(now, daysAgo, 12, 0, 10)), duration: 10, notes: `old ${id}`, customValues: {},
      });
    }
    await openApp(page, { fixture: fx });
    const rows = page.locator('#dashboardRecentTable tr');
    await expect(rows).toHaveCount(5);
    // f5 (1d), f1 (2d), f4 (5d), f2 (10d), f3 (20d)
    await expect(rows.nth(0)).toContainText('Charlie Mini');
    await expect(rows.nth(1)).toContainText('Roof inspection');
    await expect(rows.nth(2)).toContainText('Battery swap test');
    await expect(rows.nth(3)).toContainText('north');
    await expect(rows.nth(4)).toContainText('Training');
    await expect(page.locator('#dashboardRecentTable')).not.toContainText('old f6');
    await expect(page.locator('#statTotalFlights')).toHaveText('7');
  });
});

test.describe('Flight Hours Trend', () => {
  const fx = makeFixture(now);

  const active = (page, period) => page.locator(`[data-hours-period="${period}"]`);

  test('switches between weekly, monthly and 30-day views', async ({ page }) => {
    await openApp(page, { fixture: fx });

    // default: monthly, last 6 months
    await expect(active(page, 'monthly')).toHaveClass(/text-cyan-400/);
    await expect(active(page, 'weekly')).not.toHaveClass(/text-cyan-400/);
    const monthly = expectedMonthly(fx.flights, now);
    expect(await chartData(page, 'chartFlightHours')).toEqual(monthly);
    expect(monthly.labels).toHaveLength(6);

    // weekly: 8 weeks
    await active(page, 'weekly').click();
    await expect(active(page, 'weekly')).toHaveClass(/text-cyan-400/);
    await expect(active(page, 'monthly')).not.toHaveClass(/text-cyan-400/);
    const weekly = expectedWeekly(fx.flights, now);
    await expect.poll(() => chartData(page, 'chartFlightHours')).toEqual(weekly);
    expect(weekly.labels).toHaveLength(8);

    // 30 days: one bucket per day
    await active(page, '30d').click();
    await expect(active(page, '30d')).toHaveClass(/text-cyan-400/);
    await expect(active(page, 'weekly')).not.toHaveClass(/text-cyan-400/);
    const daily = expectedDaily(fx.flights, now);
    await expect.poll(() => chartData(page, 'chartFlightHours')).toEqual(daily);
    expect(daily.labels).toHaveLength(30);
    // yesterday's 30-minute Charlie flight shows as 0.5 h in the (second to last) daily bucket
    expect(daily.data.at(-2)).toBe(0.5);

    // and back to monthly
    await active(page, 'monthly').click();
    await expect.poll(() => chartData(page, 'chartFlightHours')).toEqual(monthly);
  });

  test('every view accounts for all logged hours', async ({ page }) => {
    await openApp(page, { fixture: fx });
    const total = (d) => Math.round(d.data.reduce((a, b) => a + b, 0) * 10) / 10;
    // 20 days ago is inside all three windows, so each view sums every flight
    // (per-bucket rounding to 0.1h can shift the sum slightly, hence the tolerance)
    for (const period of ['monthly', 'weekly', '30d']) {
      await active(page, period).click();
      await expect(active(page, period)).toHaveClass(/text-cyan-400/);
      const d = await chartData(page, 'chartFlightHours');
      expect(Math.abs(total(d) - 170 / 60)).toBeLessThan(0.35);
    }
  });

  test('chart updates when a flight is logged', async ({ page }) => {
    await openApp(page, { fixture: fx });
    await active(page, '30d').click();
    const before = await chartData(page, 'chartFlightHours');
    await page.locator('#btnNewFlightHeader').click();
    await page.locator('#flightDrone').selectOption({ label: 'Alpha Quad' });
    await page.locator('#flightStartTime').fill(fmt(dayAt(now, 3, 12)));
    await page.locator('#flightDuration').fill('120');
    await page.locator('#formLogFlight button[type="submit"]').click();
    await expect(page.locator('#modalLogFlight')).toBeHidden();
    // 3 days ago is the 27th of the 30 buckets (index 26)
    await expect.poll(async () => (await chartData(page, 'chartFlightHours')).data[26]).toBe(before.data[26] + 2);
  });

  test('airframe usage chart shows flights per drone', async ({ page }) => {
    await openApp(page, { fixture: fx });
    expect(await chartData(page, 'chartMissionTypes')).toEqual({
      labels: ['Alpha Quad', 'Bravo Hex', 'Charlie Mini', 'Delta Spare'],
      data: [2, 2, 1, 0],
    });
  });
});

test.describe('Fleet Lifespan', () => {
  test('shows min / average / max across drones with flights', async ({ page }) => {
    await openApp(page);
    // Alpha 7d 20h 30m, Bravo 15d 20m, Charlie 30m (Delta has no flights and is ignored)
    await expect(page.locator('#statLifespanMin')).toHaveText('30m');
    await expect(page.locator('#statLifespanMax')).toHaveText('15d 20m');
    await expect(page.locator('#statLifespanAvg')).toHaveText('7d 15h 7m');
  });

  test('shows dashes when there are no flights', async ({ page }) => {
    await openApp(page, { fixture: { ...makeFixture(), flights: [] } });
    for (const id of ['statLifespanMin', 'statLifespanAvg', 'statLifespanMax']) {
      await expect(page.locator('#' + id)).toHaveText('–');
    }
  });

  test('a single drone makes min, average and max equal; updates after logging', async ({ page }) => {
    const fx = makeFixture();
    await openApp(page, { fixture: { ...fx, flights: [fx.flights[0]] } }); // Alpha, 30 min flight
    for (const id of ['statLifespanMin', 'statLifespanAvg', 'statLifespanMax']) {
      await expect(page.locator('#' + id)).toHaveText('30m');
    }
    // a second Alpha flight 1 day after the first extends the span to 1d 30m
    const first = fx.flights[0];
    const nextDay = new Date(Date.parse(first.startTime + ':00Z') + 86400000);
    await page.locator('#btnNewFlightHeader').click();
    await page.locator('#flightDrone').selectOption({ label: 'Alpha Quad' });
    await page.locator('#flightStartTime').fill(fmt(nextDay));
    await page.locator('#flightDuration').fill('30');
    await page.locator('#formLogFlight button[type="submit"]').click();
    await expect(page.locator('#statLifespanMax')).toHaveText('1d 30m');
    await expect(page.locator('#statLifespanMin')).toHaveText('1d 30m');
  });
});

test('numeric custom-field chart totals fixture values', async ({ page }) => {
  const fx = makeFixture();
  fx.customFields = [{ id: 'cf-pts', label: 'Points', type: 'number' }];
  fx.flights[0].customValues = { 'cf-pts': 3 };
  fx.flights[1].customValues = { 'cf-pts': 4.5 };
  fx.flights[2].customValues = { 'cf-pts': 1 };
  await openApp(page, { fixture: fx });
  await expect.poll(async () => (await chartData(page, 'cfChart-cf-pts'))?.data.reduce((a, b) => a + b, 0)).toBe(8.5);
});
