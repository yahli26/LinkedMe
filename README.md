

# LinkedMe

## About

LinkedMe is a Chrome extension that turns the experience shown on your LinkedIn profile page into a downloadable MP4 video. It extracts your education, employment, and volunteering entries, lets you choose and reorder them, and generates the video locally in your browser.

## Demo

The demo resolution is compressed due to GitHub constraints.

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
5. Open a LinkedIn profile you are authorized to process, and scroll down to the Expirience section.
6. Open LinkedMe, select **Extract**, choose and reorder your entries, then select **Generate Video**. Preview the video and select **Download** to save it.

Run the JavaScript tests with:

```bash
npm test
```

After changing extension files, reload LinkedMe from `chrome://extensions` and refresh the LinkedIn tab.
