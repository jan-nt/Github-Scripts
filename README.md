# GitHub Scripts

Tampermonkey userscripts for PassPay, PayManager, DIBS, and Riverty workflows.

## Install

- [General Background Session Keeper](https://raw.githubusercontent.com/jan-nt/Github-Scripts/main/General%20Background%20Auto%20Refresh.user.js)
- [General Custom Icons](https://raw.githubusercontent.com/jan-nt/Github-Scripts/main/General%20Custom%20Icons.user.js)
- [PassPay Search Admin Panel](https://raw.githubusercontent.com/jan-nt/Github-Scripts/main/PassPay%20Search%20Admin%20Panel.user.js)
- [PassPay UserAdmin](https://raw.githubusercontent.com/jan-nt/Github-Scripts/main/PassPay%20UserAdmin.user.js)
- [PayManager Column Controller](https://raw.githubusercontent.com/jan-nt/Github-Scripts/main/PayManager%20Column%20Controller.user.js)
- [PayManager Image Row Highlighter](https://raw.githubusercontent.com/jan-nt/Github-Scripts/main/PayManager%20Image%20Row%20Highlighter.user.js)
- [PayManager Parking User Selector](https://raw.githubusercontent.com/jan-nt/Github-Scripts/main/PayManager%20Parking%20User%20Selector.user.js)

Open a link in a browser with Tampermonkey installed and confirm the installation. Each script includes `@updateURL` and `@downloadURL` metadata for automatic updates.

## Privacy and security

- No credentials, API keys, access tokens, or private keys are included.
- The session keeper clicks existing login buttons but does not read or store credentials.
- Extracted parking data is stored only in the site browser storage and expires after 30 minutes.
- Area Manager and license plate handoffs use the URL fragment, which is not sent to the PayManager server.
- Install both PassPay Search Admin Panel and PayManager Parking User Selector to enable automatic Area Manager selection.
- The last selected PayManager parking user is stored only in the site browser storage and expires after 30 days.
- The parking extractor loads html2canvas 1.4.1 from jsDelivr for local screenshot creation.

## Support

[jas@nortronic.com](mailto:jas@nortronic.com)
