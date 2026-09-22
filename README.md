# FlyLog

Offline-first flight log and fleet manager for drone/UAV pilots. Track flights, manage your fleet and battery inventory, and log custom data — all running locally in your browser, no backend required.

## Features

- **Flight logging** — record flights per airframe with start time, end time, and duration; fill in any two and the third is calculated automatically.
- **Fleet & battery management** — drones and battery packs live in collapsible cards (collapsed by default, expand for full stats and actions), each with fully custom statuses you can add, remove, and recolor to match your workflow.
- **Reorder your equipment** — drag and drop, or use the up/down buttons, to arrange drones and batteries in the order you use them. New items go to the top, and that same order drives the Airframe/Battery dropdowns on the Log Flight form.
- **Custom fields** — define your own flight log fields to capture whatever data matters to your operation, each with its own trend chart on the dashboard.
- **Charts & stats** — the Flight Hours Trend chart switches between Weekly (8 weeks), Monthly (6 months), and Last 30 Days views.
- **Backup & export** — download a full JSON backup (or restore/merge one back in) any time, plus one-click CSV export of your flight log. Since everything lives in browser storage, exporting a backup periodically is the only way to keep your data safe.
- **Installable PWA** — install to your home screen and use offline via a service worker.
- **Multi-language** — available in English, Ukrainian, and Portuguese (BR).
- **Local-only storage** — all data stays in your browser's `localStorage`; nothing is sent to a server.

## Usage

FlyLog is a single static HTML file with no build step or dependencies. To run it:

1. Open `index.html` directly in a browser, or
2. Serve the folder with any static file server (e.g. `npx serve .`) and open it in your browser.
3. Optionally install it as a PWA from your browser's install prompt for offline use.

## Data & privacy

All flight and fleet data is stored locally in your browser via `localStorage`. Nothing is transmitted to any server. Clearing your browser data will remove it, so export/back up regularly if you rely on this data.

## License

MIT — see [LICENSE](LICENSE).
