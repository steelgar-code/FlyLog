// Shared helpers for the FlyLog end-to-end tests.
//
// - `test` is Playwright's test with one addition: every test fails if the page
//   throws an uncaught error or logs a console error.
// - `makeFixture()` builds a small, deterministic data set whose dates are
//   relative to "now" (all wall-clock values are UTC; `openApp` pins the browser
//   to the UTC time zone so Node and the page agree and DST never matters).
// - `openApp()` seeds localStorage before the page loads (once per tab, so
//   reloads keep whatever the app saved) and opens the app.
const base = require('@playwright/test');
const { expect } = base;

const test = base.test.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await use(page);
    expect(errors, 'uncaught page/console errors').toEqual([]);
  },
});

// Context options every spec should apply via test.use(CONTEXT_OPTIONS).
const CONTEXT_OPTIONS = { timezoneId: 'UTC', locale: 'en-US', serviceWorkers: 'block', acceptDownloads: true };

const pad = (n) => String(n).padStart(2, '0');

// 'YYYY-MM-DDTHH:mm' using UTC wall-clock fields (what the app stores/shows
// once the browser is pinned to UTC).
function fmt(d) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
function fmtDate(d) { return fmt(d).slice(0, 10); }

// A moment `days` days ago at hh:mm (UTC wall clock), plus `addMin` minutes.
function dayAt(now, days, hh, mm = 0, addMin = 0) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days, hh, mm + addMin));
}

function flight(now, o) {
  const start = dayAt(now, o.daysAgo, o.hh, o.mm || 0);
  const end = dayAt(now, o.daysAgo, o.hh, o.mm || 0, o.dur);
  return {
    id: o.id,
    droneId: o.droneId, droneName: o.droneName,
    batteryId: o.batteryId || null, batteryName: o.batteryName || '',
    startTime: fmt(start), endTime: fmt(end), duration: o.dur,
    notes: o.notes,
    customValues: o.customValues || {},
  };
}

// Known drones/batteries/flights.
//   Alpha Quad   Ready        base 10.0h  flights: 2d ago 10:00 (30m), 10d ago 14:00 (30m)  -> lifespan 7d 20h 30m
//   Bravo Hex    Maintenance  base 5.5h   flights: 20d ago 09:00 (60m), 5d ago 09:00 (20m)  -> lifespan 15d 20m
//   Charlie Mini Ready        base 0h     flights: 1d ago 08:00 (30m)                       -> lifespan 30m
//   Delta Spare  Retired      base 2.0h   no flights
// Total 170 min = 2h 50m over 5 flights; 2 of 4 drones Ready (50%).
function makeFixture(now = new Date()) {
  const drones = [
    { id: 'uav-alpha', name: 'Alpha Quad', model: 'AQ-1', flightHours: 10, status: 'Ready' },
    { id: 'uav-bravo', name: 'Bravo Hex', model: 'BH-2', flightHours: 5.5, status: 'Maintenance' },
    { id: 'uav-charlie', name: 'Charlie Mini', model: '', flightHours: 0, status: 'Ready' },
    { id: 'uav-delta', name: 'Delta Spare', model: 'DS-4', flightHours: 2, status: 'Retired' },
  ];
  const batteries = [
    { id: 'bat-a', name: 'Pack A', cycles: 10, flightHours: 1.5, status: 'Good' },
    { id: 'bat-b', name: 'Pack B', cycles: 50, flightHours: 3, status: 'Warning' },
    { id: 'bat-c', name: 'Pack C', cycles: 1, flightHours: 0, status: 'Retired' },
  ];
  const A = { droneId: 'uav-alpha', droneName: 'Alpha Quad' };
  const B = { droneId: 'uav-bravo', droneName: 'Bravo Hex' };
  const C = { droneId: 'uav-charlie', droneName: 'Charlie Mini' };
  const flights = [
    flight(now, { id: 'f1', ...A, batteryId: 'bat-a', batteryName: 'Pack A', daysAgo: 2, hh: 10, dur: 30, notes: 'Roof inspection' }),
    flight(now, { id: 'f2', ...A, batteryId: 'bat-b', batteryName: 'Pack B', daysAgo: 10, hh: 14, dur: 30, notes: 'Survey, "north" field' }),
    flight(now, { id: 'f3', ...B, batteryId: 'bat-a', batteryName: 'Pack A', daysAgo: 20, hh: 9, dur: 60, notes: 'Training\nsecond line' }),
    flight(now, { id: 'f4', ...B, daysAgo: 5, hh: 9, dur: 20, notes: 'Battery swap test' }),
    flight(now, { id: 'f5', ...C, batteryId: 'bat-c', batteryName: 'Pack C', daysAgo: 1, hh: 8, dur: 30, notes: '' }),
  ];
  return {
    flights, drones, batteries,
    droneStatuses: ['Ready', 'Maintenance', 'In Inspection', 'Repairing', 'Retired'],
    droneStatusColors: {},
    customFields: [],
  };
}

const KEYS = {
  flights: 'flylog_flights',
  drones: 'flylog_drones',
  batteries: 'flylog_batteries',
  droneStatuses: 'flylog_drone_statuses',
  droneStatusColors: 'flylog_drone_status_colors',
  customFields: 'flylog_custom_fields',
};

// Seed localStorage (once per tab) and open the app. `fixture` keys are the
// property names of makeFixture(); pass fixture = {} for a truly empty app
// (empty arrays are stored explicitly so the demo data is NOT seeded).
// `stock`: seeds FlyStock's key (object -> JSON, string -> stored raw, undefined -> absent).
async function openApp(page, { fixture = makeFixture(), lang = 'en', path = '/index.html', stock } = {}) {
  const entries = {};
  for (const [prop, key] of Object.entries(KEYS)) {
    if (fixture[prop] !== undefined) entries[key] = JSON.stringify(fixture[prop]);
  }
  if (stock !== undefined) entries.stockroom_inventory_v1 = typeof stock === 'string' ? stock : JSON.stringify(stock);
  await page.addInitScript(({ entries, lang }) => {
    try {
      if (sessionStorage.getItem('__fixture_seeded')) return;
      sessionStorage.setItem('__fixture_seeded', '1');
      localStorage.clear();
      for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v);
      localStorage.setItem('flylog-lang', lang);
      localStorage.setItem('flylog_install_dismissed', '1');
    } catch (e) { /* storage unavailable */ }
  }, { entries, lang });
  await page.goto(path);
  await ready(page);
}

// Wait until the app has booted and rendered.
async function ready(page) {
  await expect(page.locator('#statTotalFlights')).not.toHaveText('');
  await expect.poll(() => page.evaluate(() => {
    const c = document.getElementById('chartFlightHours');
    return !!(c && window.Chart && window.Chart.getChart(c));
  })).toBe(true);
}

// Parsed localStorage value for one of the app's keys (by KEYS property name).
async function store(page, prop) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEYS[prop]);
}

// Switch tab through the sidebar (desktop viewport).
async function goTo(page, tab) {
  await page.locator(`#sidebar [data-nav="${tab}"]`).click();
  const id = 'view' + tab[0].toUpperCase() + tab.slice(1);
  await expect(page.locator('#' + id)).toBeVisible();
}

// Fill the Log Flight modal and save. `o`: drone (name), battery (name),
// start, end, duration, notes, custom: { label: value }.
async function logFlight(page, o) {
  await page.locator('#btnNewFlightHeader').click();
  await expect(page.locator('#modalLogFlight')).toBeVisible();
  await fillFlightForm(page, o);
  await page.locator('#formLogFlight button[type="submit"]').click();
  await expect(page.locator('#modalLogFlight')).toBeHidden();
}

async function fillFlightForm(page, o) {
  if (o.drone) await page.locator('#flightDrone').selectOption({ label: o.drone });
  if (o.battery !== undefined) await page.locator('#flightBattery').selectOption({ label: o.battery });
  if (o.start !== undefined) await page.locator('#flightStartTime').fill(o.start);
  if (o.end !== undefined) await page.locator('#flightEndTime').fill(o.end);
  if (o.duration !== undefined) await page.locator('#flightDuration').fill(String(o.duration));
  if (o.notes !== undefined) await page.locator('#flightNotes').fill(o.notes);
  for (const [label, value] of Object.entries(o.custom || {})) {
    await page.locator('#customFieldsFormContainer').getByLabel(label, { exact: true }).fill(String(value));
  }
}

// Flight Logbook row (by notes text, or any text unique to the row).
function flightRow(page, text) {
  return page.locator('#flightsTableBody tr').filter({ hasText: text });
}
const editBtn = (row) => row.locator('button:has(i.fa-pen-to-square)');
const deleteBtn = (row) => row.locator('button:has(i.fa-trash-can)');

// Fleet / battery cards are located by their <h3> name.
function card(page, grid, name) {
  return page.locator(`#${grid} > div`).filter({ has: page.locator('h3', { hasText: new RegExp(`^${name}$`) }) });
}
const fleetCard = (page, name) => card(page, 'fleetGrid', name);
const batteryCard = (page, name) => card(page, 'batteriesGrid', name);

// Expand a card (no-op if already expanded); returns the card.
async function expand(c) {
  const header = c.locator('[role="button"]').first();
  if ((await header.getAttribute('aria-expanded')) !== 'true') await c.locator('h3').first().click();
  await expect(header).toHaveAttribute('aria-expanded', 'true');
  return c;
}

async function confirmDialog(page, accept = true) {
  await expect(page.locator('#modalConfirm')).toBeVisible();
  await page.locator(accept ? '#btnConfirmOk' : '#btnConfirmCancel').click();
  await expect(page.locator('#modalConfirm')).toBeHidden();
}

// Names in card order.
async function cardNames(page, grid) {
  return page.locator(`#${grid} > div h3`).allTextContents();
}
// Option labels of a <select>.
async function optionLabels(locator) {
  return locator.locator('option').allTextContents();
}

// Data currently shown by a Chart.js chart.
async function chartData(page, canvasId) {
  return page.evaluate((id) => {
    const c = window.Chart.getChart(document.getElementById(id));
    return c ? { labels: [...c.data.labels], data: [...c.data.datasets[0].data] } : null;
  }, canvasId);
}

// Save a Playwright Download to text.
async function downloadText(download) {
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

// Minimal RFC 4180 CSV parser (quoted cells, "" escapes, newlines inside quotes).
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
      } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch === '\r') { /* ignore */ }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// ---- Independent re-implementation of the dashboard trend buckets (UTC) ----
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const round1 = (mins) => Math.round((mins / 60) * 10) / 10;

function expectedMonthly(flights, now) {
  const buckets = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    buckets.push({ key: fmtDate(d).slice(0, 7), label: MONTHS[d.getUTCMonth()], mins: 0 });
  }
  flights.forEach((f) => { const b = buckets.find((x) => x.key === f.startTime.slice(0, 7)); if (b) b.mins += f.duration; });
  return { labels: buckets.map((b) => b.label), data: buckets.map((b) => round1(b.mins)) };
}

function expectedWeekly(flights, now) {
  const dow = (now.getUTCDay() + 6) % 7;
  const buckets = [];
  for (let i = 7; i >= 0; i--) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dow - i * 7));
    const end = new Date(start.getTime() + 7 * 86400000);
    buckets.push({ start: fmt(start), end: fmt(end), label: `${MONTHS[start.getUTCMonth()]} ${start.getUTCDate()}`, mins: 0 });
  }
  flights.forEach((f) => { const b = buckets.find((x) => f.startTime >= x.start && f.startTime < x.end); if (b) b.mins += f.duration; });
  return { labels: buckets.map((b) => b.label), data: buckets.map((b) => round1(b.mins)) };
}

function expectedDaily(flights, now, days = 30) {
  const buckets = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    buckets.push({ key: fmtDate(d), label: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`, mins: 0 });
  }
  flights.forEach((f) => { const b = buckets.find((x) => x.key === f.startTime.slice(0, 10)); if (b) b.mins += f.duration; });
  return { labels: buckets.map((b) => b.label), data: buckets.map((b) => round1(b.mins)) };
}

module.exports = {
  test, expect, CONTEXT_OPTIONS, KEYS,
  fmt, fmtDate, dayAt, makeFixture,
  openApp, ready, store, goTo, logFlight, fillFlightForm,
  flightRow, editBtn, deleteBtn, fleetCard, batteryCard, expand,
  confirmDialog, cardNames, optionLabels, chartData, downloadText, parseCsv,
  expectedMonthly, expectedWeekly, expectedDaily,
};
