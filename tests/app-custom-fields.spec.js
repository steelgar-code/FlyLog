const {
  test, expect, CONTEXT_OPTIONS, makeFixture, openApp, store, goTo, logFlight, fillFlightForm,
  flightRow, editBtn, fleetCard, expand, confirmDialog, chartData, fmt,
} = require('./support/app');

test.use(CONTEXT_OPTIONS);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

async function addField(page, label, type) {
  await page.locator('#newFieldLabel').fill(label);
  await page.locator('#newFieldType').selectOption(type);
  await page.locator('#formAddField button[type="submit"]').click();
  await expect(page.locator('#fieldsListContainer > div').filter({ hasText: label })).toHaveCount(1);
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test('adds a numeric and a text field and they appear on the flight form', async ({ page }) => {
  await page.locator('#btnManageFieldsModal').click();
  await expect(page.locator('#modalManageFields')).toBeVisible();
  await addField(page, 'Points Scored', 'number');
  await addField(page, 'Pilot Remarks', 'text');
  await page.locator('#btnCloseFields').click();
  await expect(page.locator('#modalManageFields')).toBeHidden();

  const fields = await store(page, 'customFields');
  expect(fields).toHaveLength(2);
  expect(fields[0]).toMatchObject({ label: 'Points Scored', type: 'number' });
  expect(fields[1]).toMatchObject({ label: 'Pilot Remarks', type: 'text' });
  expect(fields[0].id).not.toBe(fields[1].id);

  await page.locator('#btnNewFlightHeader').click();
  const numInput = page.locator('#customFieldsFormContainer').getByLabel('Points Scored', { exact: true });
  const textInput = page.locator('#customFieldsFormContainer').getByLabel('Pilot Remarks', { exact: true });
  await expect(numInput).toHaveAttribute('type', 'number');
  await expect(textInput).toHaveAttribute('type', 'text');
});

test('duplicate field names are rejected', async ({ page }) => {
  await page.locator('#btnManageFieldsModal').click();
  await addField(page, 'Altitude', 'number');
  await page.locator('#newFieldLabel').fill('altitude');
  await page.locator('#formAddField button[type="submit"]').click();
  expect(await store(page, 'customFields')).toHaveLength(1);
});

test('field values are saved, shown in the log and on the fleet card, and prefilled on edit', async ({ page }) => {
  await page.locator('#btnManageFieldsModal').click();
  await addField(page, 'Points Scored', 'number');
  await addField(page, 'Pilot Remarks', 'text');
  await page.locator('#btnCloseFields').click();
  const [numField, textField] = await store(page, 'customFields');

  await logFlight(page, {
    drone: 'Charlie Mini', start: fmt(new Date(Date.now() - 3 * 3600000)), duration: 20, notes: 'Custom run',
    custom: { 'Points Scored': '7.5', 'Pilot Remarks': 'Windy <b>gusts</b>' },
  });

  const saved = (await store(page, 'flights'))[0];
  expect(saved.customValues).toEqual({ [numField.id]: 7.5, [textField.id]: 'Windy <b>gusts</b>' });

  // log: extra columns with the field labels, values in the new row ("-" for older flights)
  await goTo(page, 'flights');
  const headers = await page.locator('#flightsTableHeaderRow th').allTextContents();
  expect(headers).toContain('Points Scored');
  expect(headers).toContain('Pilot Remarks');
  expect(headers.at(-1)).toMatch(/Actions/i);
  const row = flightRow(page, 'Custom run');
  await expect(row.locator('td').nth(6)).toHaveText('7.5');
  await expect(row.locator('td').nth(7)).toHaveText('Windy <b>gusts</b>'); // escaped, not rendered as HTML
  await expect(row.locator('b')).toHaveCount(0);
  await expect(flightRow(page, 'Roof inspection').locator('td').nth(6)).toHaveText('-');

  // numeric totals per airframe on the expanded card
  await goTo(page, 'fleet');
  const charlie = await expand(fleetCard(page, 'Charlie Mini'));
  await expect(charlie).toContainText('Total Points Scored');
  await expect(charlie.locator('span', { hasText: /^7\.5$/ })).toHaveCount(1);
  await expect(charlie).not.toContainText('Total Pilot Remarks');

  // editing prefills the stored values, and changes persist
  await goTo(page, 'flights');
  await editBtn(row).click();
  const numInput = page.locator('#customFieldsFormContainer').getByLabel('Points Scored', { exact: true });
  const textInput = page.locator('#customFieldsFormContainer').getByLabel('Pilot Remarks', { exact: true });
  await expect(numInput).toHaveValue('7.5');
  await expect(textInput).toHaveValue('Windy <b>gusts</b>');
  await fillFlightForm(page, { custom: { 'Points Scored': '12', 'Pilot Remarks': 'Calm' } });
  await page.locator('#formLogFlight button[type="submit"]').click();
  await expect(page.locator('#modalLogFlight')).toBeHidden();
  await expect(row.locator('td').nth(6)).toHaveText('12');
  await expect(row.locator('td').nth(7)).toHaveText('Calm');
  expect((await store(page, 'flights'))[0].customValues).toEqual({ [numField.id]: 12, [textField.id]: 'Calm' });

  await page.reload();
  await goTo(page, 'flights');
  await expect(row.locator('td').nth(6)).toHaveText('12');
});

test('a blank numeric field is saved as 0', async ({ page }) => {
  await page.locator('#btnManageFieldsModal').click();
  await addField(page, 'Points Scored', 'number');
  await page.locator('#btnCloseFields').click();
  const [numField] = await store(page, 'customFields');
  await logFlight(page, { drone: 'Alpha Quad', duration: 5, notes: 'blank number' });
  expect((await store(page, 'flights'))[0].customValues).toEqual({ [numField.id]: 0 });
});

test('a numeric field gets a dashboard chart (text fields do not); removing the field removes it', async ({ page }) => {
  await page.locator('#btnManageFieldsModal').click();
  await addField(page, 'Points Scored', 'number');
  await addField(page, 'Pilot Remarks', 'text');
  await page.locator('#btnCloseFields').click();
  const [numField] = await store(page, 'customFields');

  const container = page.locator('#customFieldChartsContainer');
  await expect(container.locator('canvas')).toHaveCount(1);
  await expect(container).toContainText('Points Scored Trend');

  const start = new Date(Date.now() - 3 * 3600000);
  await logFlight(page, {
    drone: 'Alpha Quad', start: fmt(start), duration: 15, notes: 'chart run', custom: { 'Points Scored': '7.5' },
  });
  await logFlight(page, {
    drone: 'Bravo Hex', start: fmt(start), duration: 15, notes: 'chart run 2', custom: { 'Points Scored': '2.25' },
  });

  const canvasId = `cfChart-${numField.id}`;
  await expect.poll(async () => {
    const d = await chartData(page, canvasId);
    return d && d.data.reduce((a, b) => a + b, 0);
  }).toBe(9.75);
  const d = await chartData(page, canvasId);
  expect(d.labels).toHaveLength(6);
  expect(d.data[d.labels.indexOf(MONTHS[start.getUTCMonth()])]).toBe(9.75);

  // remove the field: confirm dialog, chart and column go away, values are dropped from flights
  await page.locator('#btnManageFieldsModal').click();
  await page.locator('#fieldsListContainer > div').filter({ hasText: 'Points Scored' }).locator('button').click();
  await expect(page.locator('#modalConfirmMessage')).toContainText('Points Scored');
  await confirmDialog(page, true);
  await expect(container.locator('canvas')).toHaveCount(0);
  const fields = await store(page, 'customFields');
  expect(fields.map((f) => f.label)).toEqual(['Pilot Remarks']);
  const flights = await store(page, 'flights');
  expect(flights.every((f) => !(numField.id in (f.customValues || {})))).toBe(true);
});
