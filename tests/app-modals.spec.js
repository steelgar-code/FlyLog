const { test, expect, CONTEXT_OPTIONS, openApp, goTo, flightRow, deleteBtn } = require('./support/app');
test.use(CONTEXT_OPTIONS);

test('Escape with no modal open does not hide titles or confirm message', async ({ page }) => {
  await openApp(page);
  await page.keyboard.press('Escape');
  for (const id of ['modalLogFlightTitle', 'modalDroneTitle', 'modalBatteryTitle', 'modalConfirmMessage']) {
    await expect(page.locator('#' + id)).not.toHaveClass(/hidden/);
  }
  await page.locator('#btnNewFlightHeader').click();
  await expect(page.locator('#modalLogFlightTitle')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#modalLogFlight')).toBeHidden();
  await goTo(page, 'flights');
  await deleteBtn(flightRow(page, 'Roof inspection')).click();
  await expect(page.locator('#modalConfirmMessage')).toBeVisible();
  await expect(page.locator('#modalConfirmMessage')).not.toBeEmpty();
});

test('clicking a modal title does not hide it; backdrop click closes', async ({ page }) => {
  await openApp(page);
  await page.locator('#btnNewFlightHeader').click();
  await page.locator('#modalLogFlightTitle').click();
  await expect(page.locator('#modalLogFlightTitle')).toBeVisible();
  await page.locator('#modalLogFlight').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('#modalLogFlight')).toBeHidden();
});

test('drag from inside the dialog to the backdrop keeps the modal open', async ({ page }) => {
  await openApp(page);
  await page.locator('#btnNewFlightHeader').click();
  const notes = page.locator('#flightNotes');
  await notes.fill('keep me');
  const box = await notes.boundingBox();
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(3, 3);
  await page.mouse.up();
  await expect(page.locator('#modalLogFlight')).toBeVisible();
  await expect(notes).toHaveValue('keep me');
});
