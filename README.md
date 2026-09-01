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
| General Custom Icons | 2.5.0 | PassPay and PayManager | Applies route-specific tab titles and favicons. |
| PassPay Search Admin Panel | 7.6.1 | PassPay parking search | Summarizes parking data and hands an Area Manager and license plate to PayManager. |
| PassPay UserAdmin | 2.0.3 | PassPay administration and DIBS | Adds safe Chain ID and Payment ID links, admin search helpers, and an explicitly armed batch-refund workflow. |
| PayManager Column Controller | 1.2.2 | PayManager transactions | Automatically enforces the configured transaction-column visibility without reopening an existing hidden Columns popup. |
| PayManager Image Row Highlighter | 1.7.1 | PayManager transactions | Highlights rows that contain event-camera images. |
| PayManager Parking User Selector | 2.10.3 | PayManager parking | Restores the selected PRS user, provides separator- and organization-suffix-aware PRS search, and performs opt-in, guarded Active/Pending plate searches. |
| PayManager Search Input Normalizer | 1.0.1 | PayManager transactions and parking | Removes spaces and dashes from typed filter text. |

## Privacy and security

- No credentials, API keys, access tokens, or private keys are read from project configuration or included in this repository.
- The session keeper checks whether required login fields are complete before clicking an existing login button. It does not copy, store, log, or transmit credential values.
- Extracted license plates and parking details are stored only in the current PassPay/ParkPay tab's session storage. They are removed after 30 minutes and are also discarded when that tab's browser session ends. The current script also removes the older persistent cache after migrating any still-valid entry.
- Area Manager and license-plate handoffs use a URL fragment. Fragments are not included in HTTP requests. The receiving script keeps a session-only recovery copy for at most five minutes and removes both the copy and fragment after use or expiry. Page scripts and browser extensions can still read a fragment while it is present.
- The editable PayManager parking license-plate field is blank during normal browsing and is not persisted. An explicit PassPay handoff can retain its recovery copy in session storage for at most five minutes, as described above.
- Chain IDs and payment IDs opened in another portal are placed in that portal's query string and can appear in browser history and service logs.
- PassPay UserAdmin keeps a refund batch in memory while collecting Payment IDs, then transfers it only to the specifically opened DIBS tab. That tab stores the guarded queue in session storage for at most 30 minutes so login redirects and page reloads can resume safely. The queue is removed on completion, cancellation, expiry, or any uncertain result.
- The refund workflow never stores, logs, or fills a password. During an armed batch it can prefill `jas@nortronic.com` on the DIBS login page and focuses the password field for manual entry.
- Only the identifier for the last selected PayManager parking user is stored in PayManager's local browser storage. The display label is derived from the page instead of being persisted. The script treats the identifier as expired after 30 days and removes it the next time it checks the stored value.
- PassPay Search Admin Panel loads the version-pinned html2canvas 1.4.1 file from jsDelivr for local screenshot creation and verifies it with a SHA-256 integrity hash.
- Copy and screenshot actions intentionally place displayed customer data on the clipboard or in the browser's download folder. Handle those outputs according to company policy.
- The scripts run inside authenticated pages and can read data displayed by those pages. Install only reviewed versions from this repository.

## Known limitations

- Several workflows depend on the sites' current URLs, labels, and DOM structure. Site updates can require corresponding userscript updates.
- Batch refunds require the PassPay payment-history detail dialog and the DIBS refund/status controls to retain recognizable labels. A submitted refund is never resubmitted automatically; if its final `Refundert` status or refund-user email remains unverified after one final page refresh, the remaining batch stops for manual review.
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

### 2026-09-01 silent PayManager column recovery

- PayManager Column Controller 1.2.2 reuses PayManager's existing hidden column controls during initial setup and delayed DOM-replacement recovery. It only opens and closes the Columns popup when PayManager has not created those controls yet, preventing a late popup flash after scrolling or lazy rendering.

### 2026-08-31 organization-suffix-aware PRS matching

- PayManager Parking User Selector 2.10.3 recognizes controlled organization suffix differences such as `SA`, `AS`, `HF`, `Kommune`, and `User`. This allows `VegenGulsvikDamtjern`, `HelseFonnaHF`, and `Foglefonna` handoffs to select `Vegen Gulsvik-Damtjern SA`, `Helse Fonna AS`, and `FoglefonnaUser` respectively.
- Exact normalized matches remain the highest priority. The suffix-aware fallback only selects a user when exactly one PRS option has the same organization stem; ambiguous matches stop for manual selection.

### 2026-08-31 reliable PassPay-to-PayManager handoff

- PayManager Parking User Selector 2.10.2 uses the same separator-insensitive PRS matching rules for direct searches and PassPay URL handoffs, so compact names such as `MoskenesKommune` and `NesbyenHedalen` select `Moskenes Kommune` and `Nesbyen-Hedalen` respectively.
- Automatic handoffs now require one unique normalized PRS match and a valid license plate, wait for delayed PRS options, and stop with a clear message instead of selecting when the match is missing or ambiguous.

### 2026-08-28 PayManager parking search timing

- PayManager Parking User Selector 2.10.1 reduces the bounded table-readiness and filter-result waits from five seconds to three seconds and reapplies a handed-off license plate after 500 milliseconds when the page has not yet accepted it.
- Once a matching filtered result is visible, the script now waits for the required stable observation without sending a redundant third search-input event.

### 2026-08-28 separator-insensitive PRS user search

- PayManager Parking User Selector 2.10.0 finds PRS users when spaces and common name separators differ between the typed query and displayed label, such as `HelseFonnaAS` matching `Helse Fonna AS` and `Nesbyen Hedalen` matching `Nesbyen-Hedalen`.
- Literal exact matches remain highest-ranked, and the search does not introduce typo-tolerant matching that could suggest an unrelated PRS user.

### 2026-08-27 DIBS final verification refresh

- PassPay UserAdmin 2.0.3 performs one persisted page refresh when a submitted refund remains visually unchanged for 45 seconds, then verifies the same payment again without resubmitting it.
- The one-refresh limit is stored with the queue item so a static DIBS page cannot cause a reload loop; an unverified result after that final check still stops the remaining batch for manual review.

### 2026-08-27 DIBS multi-refund continuation

- PassPay UserAdmin 2.0.2 detects when DIBS returns to the payments list after submitting a refund, reopens that submitted payment for final verification, and then advances to the next queued payment.
- Submitted-payment verification now uses the same bounded 45-second window as the initial post-submit check so a delayed `Refundert` event does not prematurely stop a valid batch.

### 2026-08-27 DIBS dynamic refund confirmation

- PassPay UserAdmin 2.0.1 starts an armed batch directly from the explicit `Refund selected` action without an additional typed browser prompt.
- DIBS confirmation controls now accept dynamic amount labels such as `Refunder 95,00 NOK` and semantic dialog containers, with a bounded fallback for portal-rendered dialogs outside `main`.

### 2026-08-27 guarded PassPay batch refunds

- PassPay UserAdmin 2.0.0 adds an off-by-default refund-selection mode only on dynamic `/administration/{userId}?tab=3&nestedTab=1` payment-history pages.
- Added current-page multi-selection for paid entries, bounded Payment ID collection through each existing detail dialog, duplicate-ID rejection, a maximum batch size, and an exact typed confirmation before opening DIBS.
- Added one-at-a-time DIBS processing with already-refunded detection, session-only 30-minute recovery, manual-login pause, visible progress/cancellation, and strict final verification of both `Refundert` and `jas@nortronic.com` before continuing.
- A submitted-but-unverified refund is never retried automatically; the remaining batch stops for manual review.

### 2026-08-25 favicon and UserAdmin fixes

- General Custom Icons 2.5.0 now invalidates the previous route's favicon during SPA navigation, maintains one canonical favicon, and temporarily neutralizes competing site icon declarations.
- PassPay UserAdmin 1.9.2 keeps the search field and No Spaces button in an idempotent responsive flex row, with controlled wrapping when the available width is narrow.

### 2026-08-25 PayManager parking search 2.9.4

- Kept the license-plate placeholder in normal sentence case while preserving automatic uppercase normalization for entered plates.

### 2026-08-25 PayManager parking search 2.9.3

- Added accessible inline clear buttons to the PRS-user and license-plate search fields.
- Clearing the PRS field closes its suggestions without changing the selected PRS user; clearing the plate field also cancels Active/Pending automation and resets the DataTables filter.

### 2026-08-25 PayManager parking search 2.9.2

- Made license-plate searching opt-in and blank by default during normal parking review.
- Rejected password-manager and browser-autofill values containing non-plate characters, including email addresses.
- Made deleting the editable plate cancel the Active/Pending workflow and clear the DataTables filter.
- Removed the previous 30-minute manual-plate persistence and reduced redundant filter/select events that could cause duplicate Ajax reloads.

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
