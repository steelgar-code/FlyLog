# FlyLog Pro

Offline-first flight log and fleet manager for drone/UAV pilots. Track flights, manage your fleet's status, and log custom data — all running locally in your browser, no backend required.

## Features

- **Flight logging** — record flights per airframe with duration, notes, and history.
- **Fleet management** — track each drone's status (Ready, Maintenance, In Inspection, Repairing, Retired).
- **Custom fields** — define your own flight log fields to capture whatever data matters to your operation.
- **Charts & stats** — visualize flight hours and custom field data over time.
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
