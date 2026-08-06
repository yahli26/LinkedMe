# LinkedMe Privacy Notice

Last updated: August 6, 2026

LinkedMe is an experimental Chrome extension that processes information from a
supported LinkedIn page when the user requests an extraction. This notice
describes the current repository version. LinkedMe is not affiliated with,
endorsed by, or sponsored by LinkedIn.

## Summary

- Profile information is processed locally by the extension.
- The latest extraction is stored locally in `chrome.storage.local` under the
  key `linkedme.latestStatus.v1`.
- Extracted profile information is not sent to a server operated by the LinkedMe
  developer.
- Organization images may be fetched from the allowlisted LinkedIn CDN hosts
  `media.licdn.com` and `static.licdn.com` without cookies or other credentials.
- The current version does not include telemetry, analytics, advertising, or
  user tracking.

## Data Collected and Processed

When the user selects **Extract** on a supported LinkedIn profile, LinkedMe may
collect and process the following fields from the currently displayed page.

### Profile metadata

- The current profile page URL.
- The date and time of extraction.
- Counts of extracted education, experience, and volunteering entries.

### Education entries

- Institution name.
- Degree or program text.
- Start date and end date.
- Institution-logo URL and fallback logo URL candidates.

### Employment entries

- Job title.
- Company name.
- Start date and end date.
- Company-logo URL and fallback logo URL candidates.

### Volunteering entries

- Volunteer role.
- Organization name.
- Start date and end date.
- Organization-logo URL and fallback logo URL candidates.

### Manually added job entries

When the user uses **Add New Job**, LinkedMe may store:

- The selected company name.
- The selected company-logo URL and fallback candidates.
- A generated `New Job` title.
- The current year and month as the start date.

### Extension status information

LinkedMe also stores operational information needed to restore the latest panel
state, including:

- A request identifier.
- Whether extraction is idle, completed, failed, or includes a manually added
  job.
- Extracted item counts.
- The latest error object or message, when an operation fails.
- The latest extracted profile payload, when extraction succeeds.

## Data Not Intentionally Collected

LinkedMe does not intentionally collect LinkedIn passwords, authentication
tokens, session cookies, private messages, contacts, payment information, phone
numbers, or email addresses. Do not use the extension on data you are not
authorized to process.

## Where Data Is Stored

The latest status and extracted profile are stored locally in the Chrome
extension's `chrome.storage.local` area under:

```text
linkedme.latestStatus.v1
```

This storage is scoped to the installed extension and persists across browser
and extension-service-worker restarts. A new status update replaces the stored
value. The data remains until it is replaced, explicitly cleared, or the
extension and its local data are removed.

LinkedMe does not currently synchronize this data through
`chrome.storage.sync` and does not upload it to a developer-operated database.

## Temporary Processing

- LinkedIn CDN images may be held temporarily in the extension service worker's
  in-memory cache. The cache is limited to 50 responses and is discarded when
  the service worker is terminated or the entry is evicted.
- Video frames, logo images, and the generated GIF are processed locally in the
  browser. The generated result is represented by a temporary browser object
  URL until it is replaced or the page is closed.
- A GIF is written to the user's device only when the user selects
  **Download GIF**. Once downloaded, that file is controlled by the user and is
  no longer managed by the extension.

## Network Requests

LinkedMe may request organization images from:

- `https://media.licdn.com/`
- `https://static.licdn.com/`

The background service worker rejects non-HTTPS requests and hosts outside this
allowlist. These image requests use `credentials: "omit"`, so LinkedMe does not
intentionally attach LinkedIn cookies or HTTP authentication credentials.

The current version has no developer-operated API, analytics endpoint, or
advertising endpoint.

## How to Delete Stored Data

The current version does not yet provide a **Clear data** button. Use either of
the following methods.

### Method 1: Clear only LinkedMe's stored status and profile

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Find the LinkedMe extension.
4. Select the **service worker** inspection link on the LinkedMe card. Chrome
   DevTools opens for the extension service worker.
5. In the DevTools **Console**, run:

   ```javascript
   chrome.storage.local.remove("linkedme.latestStatus.v1")
   ```

6. Reload the extension or close DevTools. The saved extraction will no longer
   be available.

To clear every value stored locally by LinkedMe instead, run:

```javascript
chrome.storage.local.clear()
```

### Method 2: Remove the extension and its local data

1. Open `chrome://extensions`.
2. Find LinkedMe.
3. Select **Remove** and confirm.

Chrome removes the installed extension and its extension-scoped local storage.
Previously downloaded GIF files are separate files and must be deleted manually
from the folder where the user saved them.

## Data Sharing

LinkedMe does not sell extracted data and does not share it with a
developer-operated service. Requests to LinkedIn CDN hosts are subject to
LinkedIn's own privacy and logging practices.

Users control any GIF they download or subsequently publish. Before sharing a
GIF, verify that it does not reveal information belonging to another person
without permission.

## Security

No software can guarantee absolute security. LinkedMe limits logo requests to
two explicit HTTPS hosts, omits credentials from those requests, and keeps the
latest extraction in extension-local storage. Users should keep Chrome updated,
install the extension only from a source they trust, and avoid processing
sensitive or unauthorized information.

## Changes to This Notice

Update this document whenever the extension's permissions, collected fields,
storage behavior, network destinations, or retention behavior changes. Material
changes should be called out in release notes before publishing a new version.

## Contact

Report privacy or security concerns through this repository's private security
reporting channel once it is enabled. Do not include personal profile data,
credentials, cookies, or other secrets in a public issue.
