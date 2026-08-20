# Job Ledger

Chrome extension that captures job applications in under a few seconds — company, role, URL, salary expectation, resume version, notes, and pipeline status.

Data stays on your machine (`chrome.storage.local`). Nothing is sent to a server.

## Features

- **Capture** from the side panel, with **Fill from tab** for title/company/URL
- **Profile defaults** for salary, currency, and resume label
- **Pipeline** with search, status filter, and follow-up hints
- **Duplicate URL** warning
- **CSV export**

## Install (local / unpacked)

1. Clone this repo
2. Open Chrome → `chrome://extensions`
3. Enable **Developer mode**
4. **Load unpacked** → select this repository folder
5. Click the Job Ledger icon to open the side panel

## Develop

```bash
npm install
npm test              # storage + manifest checks
npm run test:browser  # loads extension in Chrome (needs Chrome installed)
npm run test:all
```

No build step — edit files, then click **Reload** on the extension card.

## Chrome Web Store

Optional. Package only extension files (not `node_modules` or `tests`):

```bash
zip -r job-ledger.zip manifest.json background content lib sidepanel icons LICENSE
```

Upload via the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).

## Privacy

- Applications and profile defaults are stored locally in the browser
- No accounts, analytics, or remote sync in this version
- Host access is used only to read job page metadata when you capture an application

## Contributing

Issues and pull requests are welcome. Keep the capture flow fast — if saving takes more than a few seconds of user effort, reconsider the change.

## License

[MIT](LICENSE)
