# GitHub Scripts

Tampermonkey userscripts for authorized PassPay, PayManager, DIBS, and Riverty workflows. These scripts customize existing pages; they do not provide access to any service.

## Requirements

- A current Chrome or Chromium-based browser with Tampermonkey installed.
- An authorized account for each service used by a script.
- Both PassPay Search Admin Panel and PayManager Parking User Selector for the Area Manager and license-plate handoff.

## Install

- [General Background Session Keeper](https://raw.githubusercontent.com/jan-nt/Github-Scripts/main/General%20Background%20Auto%20Refresh.user.js)
- [General Custom Icons](https://raw.githubusercontent.com/jan-nt/Github-Scripts/main/General%20Custom%20Icons.user.js)
- [PassPay Search Admin Panel](https://raw.githubusercontent.com/jan-nt/Github-Scripts/main/PassPay%20Search%20Admin%20Panel.user.js)
- [PassPay UserAdmin](https://raw.githubusercontent.com/jan-nt/Github-Scripts/main/PassPay%20UserAdmin.user.js)
- [PayManager Column Controller](https://raw.githubusercontent.com/jan-nt/Github-Scripts/main/PayManager%20Column%20Controller.user.js)
- [PayManager Image Row Highlighter](https://raw.githubusercontent.com/jan-nt/Github-Scripts/main/PayManager%20Image%20Row%20Highlighter.user.js)
- [PayManager Parking User Selector](https://raw.githubusercontent.com/jan-nt/Github-Scripts/main/PayManager%20Parking%20User%20Selector.user.js)
- [PayManager Search Input Normalizer](https://raw.githubusercontent.com/jan-nt/Github-Scripts/main/PayManager%20Search%20Input%20Normalizer.user.js)

Open a link in a browser with Tampermonkey installed and confirm the installation. Each script includes `@updateURL` and `@downloadURL` metadata for automatic updates. Tampermonkey only installs a repository change after that script's `@version` value is increased.

## Current production versions

| UserScript | Version | Target | Purpose |
| --- | ---: | --- | --- |
| General Background Session Keeper | 3.2.1 | DIBS and Riverty | Refreshes authenticated pages and safely retries an existing login control when a login page is detected. |
| General Custom Icons | 2.4.1 | PassPay and PayManager | Applies route-specific tab titles and favicons. |
| PassPay Search Admin Panel | 7.6.1 | PassPay parking search | Summarizes parking data and hands an Area Manager and license plate to PayManager. |
| PassPay UserAdmin | 1.9.1 | PassPay administration | Adds safe Chain ID and Payment ID links and a focused admin search action. |
| PayManager Column Controller | 1.2.1 | PayManager transactions | Automatically enforces the configured transaction-column visibility. |
| PayManager Image Row Highlighter | 1.7.1 | PayManager transactions | Highlights rows that contain event-camera images. |
| PayManager Parking User Selector | 2.9.1 | PayManager parking | Restores the selected PRS user and performs guarded Active/Pending plate searches. |
| PayManager Search Input Normalizer | 1.0.1 | PayManager transactions and parking | Removes spaces and dashes from typed filter text. |

## Privacy and security

- No credentials, API keys, access tokens, or private keys are read from project configuration or included in this repository.
- The session keeper checks whether required login fields are complete before clicking an existing login button. It does not copy, store, log, or transmit credential values.
- Extracted license plates and parking details are stored only in the current PassPay/ParkPay tab's session storage. They are removed after 30 minutes and are also discarded when that tab's browser session ends. The current script also removes the older persistent cache after migrating any still-valid entry.
- Area Manager and license-plate handoffs use a URL fragment. Fragments are not included in HTTP requests. The receiving script keeps a session-only recovery copy for at most five minutes and removes both the copy and fragment after use or expiry. Page scripts and browser extensions can still read a fragment while it is present.
- The editable PayManager parking license-plate field keeps its current value in that tab's session storage for up to 30 minutes so a PRS-user or table reload can resume the guarded search. It is not written to persistent local storage.
- Chain IDs and payment IDs opened in another portal are placed in that portal's query string and can appear in browser history and service logs.
- Only the identifier for the last selected PayManager parking user is stored in PayManager's local browser storage. The display label is derived from the page instead of being persisted. The script treats the identifier as expired after 30 days and removes it the next time it checks the stored value.
- PassPay Search Admin Panel loads the version-pinned html2canvas 1.4.1 file from jsDelivr for local screenshot creation and verifies it with a SHA-256 integrity hash.
- Copy and screenshot actions intentionally place displayed customer data on the clipboard or in the browser's download folder. Handle those outputs according to company policy.
- The scripts run inside authenticated pages and can read data displayed by those pages. Install only reviewed versions from this repository.

## Known limitations

- Several workflows depend on the sites' current URLs, labels, and DOM structure. Site updates can require corresponding userscript updates.
- Chrome may throttle timers in background tabs, so the five-minute session-keeper check can run later than scheduled.
- The login recovery feature clicks an existing login button; it cannot supply credentials, complete MFA, or recover from an expired identity-provider session.
- There are no automated browser integration tests because the target pages require authorized accounts.

## Development checks

The repository has no build step or third-party development dependencies. Run the same checks used by CI with Node.js:

```powershell
Get-ChildItem -Filter '*.user.js' | ForEach-Object { node --check -- $_.FullName }
node scripts/validate-userscripts.mjs
node scripts/test-general-background-session-keeper.mjs
node scripts/test-general-custom-icons.mjs
node scripts/test-passpay-useradmin.mjs
node scripts/test-search-input-normalizer.mjs
node scripts/test-paymanager-column-controller.mjs
node scripts/test-paymanager-image-row-highlighter.mjs
node scripts/test-paymanager-parking-handoff.mjs
node scripts/test-passpay-search-admin-panel.mjs
```

Add `--verify-remote` to download each external `@require` file and verify its declared SHA-256 hash. The validation script checks metadata, raw installation URLs, HTTPS-only page scopes, the support address, external-resource integrity, obvious secret patterns, debug statements, and README install links. GitHub Actions runs all checks, including remote integrity verification, for pushes to `main` and pull requests. Dependabot checks the pinned workflow action monthly.

## Release notes

### 2026-08-25 production audit

- Added duplicate-execution guards, bounded waits, cleanup, SPA recovery, stable selectors, response validation, and stale-result protection across the eight scripts.
- Replaced permanent polling with targeted observers or bounded retries where the sites allow it.
- Added lightweight behavior tests for every userscript and made CI run the complete suite.
- Standardized production metadata and patch-versioned all scripts listed above.

- Increase the changed script's `@version` before publishing it.
- Require the `Validate userscripts` workflow check in the `main` branch protection ruleset.
- Review and test changes on the matching site before updating `main`; installed copies can receive changes from `main` automatically.
- Do not add credentials, exported customer data, screenshots, logs, or real personal-data examples to the repository.

## License

No license file is currently included. The repository owner must choose and add an approved license before granting reuse or redistribution rights.

## Support

[jas@nortronic.com](mailto:jas@nortronic.com)

Sensitive reports should follow the [security policy](.github/SECURITY.md) and must not include live credentials or customer data.
