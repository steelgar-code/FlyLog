# FlyLog

[Українська](README.uk.md) · [Português (BR)](README.pt-BR.md)

Offline-first flight log and fleet manager for drone/UAV pilots. Track flights, manage your fleet and battery inventory, and log custom data — all running locally in your browser, no backend required.

## Features

- **Flight logging** — record flights per airframe with start time, end time, and duration; fill in any two and the third is calculated automatically. Edit any saved flight log entry later to fix a mistake.
- **Fleet & battery management** — drones and battery packs live in collapsible cards (collapsed by default, expand for full stats and actions), each with fully custom statuses you can add, remove, and recolor to match your workflow.
- **Drone lifespan tracking** — expand a drone's card to see its Maiden Flight and Latest Flight dates/times, plus the Lifespan between them (e.g. "45m" or "1y 3mo 25d 3h 45m"). The dashboard's Fleet Lifespan panel rolls this up into fleet-wide Min, Average, and Max lifespan stats (drones with no flights yet are excluded).
- **Reorder your equipment** — drag and drop, or use the up/down buttons, to arrange drones and batteries in the order you use them. New items go to the top, and that same order drives the Airframe/Battery dropdowns on the Log Flight form.
- **Custom fields** — define your own flight log fields to capture whatever data matters to your operation, each with its own trend chart on the dashboard.
- **Charts & stats** — the Flight Hours Trend chart switches between Weekly (8 weeks), Monthly (6 months), and Last 30 Days views.
- **Backup & export** — download a full JSON backup any time, plus one-click CSV export of your flight log (opens correctly in Excel). When you import a backup, choose **Replace** (wipe the device and use the backup) or **Merge** (add only what is missing, skipping duplicates); damaged records are skipped and counted. Since everything lives in browser storage, exporting a backup periodically is the only way to keep your data safe.
- **Installable PWA, fully offline** — Tailwind, Chart.js and Font Awesome are bundled in `vendor/`, so the app makes no third-party requests. The service worker saves the whole app on your first visit and opens it from that copy without waiting on the network, so one online visit is enough. New versions download in the background and an "Update available" prompt offers a reload. The sidebar's "Offline Use" line shows the state: Ready, Preparing…, Local files or Not available.
- **Multi-language** — available in English, Ukrainian, and Portuguese (BR).
- **Local-only storage** — all data stays in your browser's `localStorage`; nothing is sent to a server.

## Usage

FlyLog is a static site with no build step. `index.html` needs the `vendor/` folder, `sw.js`, the manifest and the icons next to it. To run it:

1. Open `index.html` directly in a browser (works with no internet as long as `vendor/` stays next to it; there is no service worker in this case), or
2. Serve the folder with any static file server (e.g. `npx serve .`) and open it in your browser. One online visit saves the app for offline use.
3. Optionally install it as a PWA from your browser's install prompt.

## Data & privacy

All flight and fleet data is stored locally in your browser via `localStorage`. Nothing is transmitted to any server. Clearing your browser data will remove it, so export/back up regularly if you rely on this data.

## Development

Tests use Playwright (Chromium): run `npm install`, then `npm test`.

When you add a file the page loads, also list it in `sw.js` so it is saved for offline use (a test enforces this).

## License

MIT — see [LICENSE](LICENSE).
