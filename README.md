# Expense Vault

Private, local-first personal income, expense and receipt tracker designed as an installable PWA.

## Production starting state

A new installation starts with **zero income, zero expenses, zero receipt images and zero budgets**. The dashboard therefore shows only real information entered by the user. Demo transactions are available only from Settings and are never loaded automatically.

## What works

- Add income manually, including salary, tips, private work, refunds and other income.
- Add expenses manually.
- Take a receipt photo with a phone camera or upload an existing image.
- Run OCR in the browser with Tesseract.js; no API key or paid OCR account is required.
- Review and correct OCR results before saving.
- Store transactions and compressed receipt images in IndexedDB on the device.
- Search and filter transactions and receipts.
- Dashboard and analytics show income, expenses and net balance; budgets remain expense-only.
- Budget and expense-category management.
- CSV export and Excel (.xlsx) export.
- Full JSON backup and restore, including receipt images.
- Safe full local-data reset with typed confirmation.
- Light/dark/system themes.
- PWA manifest, service worker and install support for compatible browsers.

## Storage model

GitHub will host the application code only. Financial records are **not stored in GitHub**. Income, expenses, settings and receipt images stay in the browser's local IndexedDB database.

Use **Export & Backup > Create Full Backup** regularly. Clearing site data, resetting the app, or losing the device can otherwise remove the local database.

## Receipt OCR

The app loads Tesseract.js and its OCR resources from the internet and performs recognition in the browser. No paid API or API key is used. A receipt is always shown for review before the transaction is saved.

Default OCR languages are English + Spanish + German and can be changed in Settings.

## GitHub Pages deployment

There is no build step. When the GitHub repository is ready, upload the contents of this folder to the repository and enable GitHub Pages. Relative paths are used so deployment under a repository sub-path works correctly.

HTTPS hosting is required for normal service-worker/PWA behaviour.

## Main files

- `index.html` — application shell.
- `css/styles.css` — responsive UI and themes.
- `js/data.js` — clean defaults for categories, payments, profile and OCR settings.
- `js/db.js` — IndexedDB persistence, backup/import primitives.
- `js/app.js` — UI, OCR parsing, receipt storage, exports and application logic.
- `manifest.webmanifest` — PWA metadata.
- `sw.js` — application-shell/runtime caching.
- `icons/icon.svg` — PWA application icon.

## No paid services

The application does not require OpenAI, Anthropic, Google Vision, Supabase, Firebase, banking APIs or any paid API key.