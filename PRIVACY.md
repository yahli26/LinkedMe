# LinkedMe Privacy Notice

Last updated: August 15, 2026

LinkedMe is an experimental Chrome extension and is not affiliated with,
endorsed by, or sponsored by LinkedIn.

## Data Collected and Processed

LinkedMe only extracts the LinkedIn profile-entry information needed for the
experience order editor and generated video. This may include job, education,
and volunteering titles, organization names, dates, and logo URLs. It does not
intentionally extract other profile information.

The extension also keeps basic operational details **locally**, including the
extraction time, item counts, request status, and error messages. It checks the
active page URL to confirm that it is a supported LinkedIn page, but it does not
save that URL.

LinkedMe does not intentionally collect passwords, cookies, authentication
tokens, private messages, contacts, email addresses, or phone numbers.

## Local Storage and Processing

All extracted profile information and generated video data are processed
**locally** on the user's computer. The latest extraction is stored in Chrome's
local extension storage under:

```text
linkedme.latestStatus.v1
```

Chrome manages the storage location; it is not a regular user-selected folder.
Profile information is not uploaded or sent to the LinkedMe developer or a
developer-operated server. LinkedMe has no telemetry, analytics, advertising,
or user tracking.

The generated MP4 video remains temporary until the user selects **Download**.
Downloaded videos are saved to the location selected by the user and are then
controlled by the user.

## Network Requests

To display organization logos and create the video, LinkedMe may request images
from LinkedIn's `media.licdn.com` and `static.licdn.com` services. These requests
are made without cookies or other credentials. No extracted profile information
is sent to a LinkedMe-operated service.

## Retention and Deletion

The latest extraction remains in Chrome's local extension storage until it is
replaced, cleared, or the extension is removed. To delete it, remove LinkedMe
from `chrome://extensions`, or open the extension service worker's DevTools
console and run:

```javascript
chrome.storage.local.remove("linkedme.latestStatus.v1")
```

Downloaded MP4 files must be deleted separately from the folder where they were
saved.

## User Responsibility

Only process profile information you are authorized to use. Before sharing a
generated video, confirm that it does not reveal another person's information
without permission.
