

# LinkedMe

## About

LinkedMe is a Chrome extension that extracts education, employment, and volunteering entries from the open LinkedIn profile and turns selected entries into a downloadable animated GIF. Processing happens locally in the browser.

<img width="1280" height="720" alt="linkedme_demo-1" src="https://github.com/user-attachments/assets/30548b53-f29f-410b-8891-b289c1b4186d" />

## Prerequisites

- Google Chrome or another Chromium browser with Manifest V3 support
- Git
- Node.js 22.14.0 and npm 10.9.2 for tests
- No API keys required
- Optional: Python 3.14.3 with NumPy and OpenCV for the offline video tools

## Usage & Installation

1. Clone the repository and install the test dependencies:

   ```bash
   git clone https://github.com/yahli26/LinkedMe.git
   cd LinkedMe
   npm ci
   ```

2. Open `chrome://extensions`.
3. Enable **Developer mode** and select **Load unpacked**.
4. Select the `extension` directory.
5. Open a LinkedIn profile you are authorized to process.
6. Open LinkedMe, select **Extract**, choose and reorder the entries, then select **Generate** and **Download GIF**.

Run the JavaScript tests with:

```bash
npm test
```

After changing extension files, reload LinkedMe from `chrome://extensions` and refresh the LinkedIn tab.
