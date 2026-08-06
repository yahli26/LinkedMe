const EXTRACT_REQUEST = "LINKEDME_EXTRACT_PROFILE_REQUEST";
const EXTRACT_SUCCESS = "LINKEDME_EXTRACT_PROFILE_SUCCESS";
const INVALID_PROFILE_MESSAGE = "Go to a LinkedIn profile page";
const status = document.getElementById("extraction-status");

function setStatus(message, state) {
  status.textContent = message;
  status.dataset.state = state;
}

function isLinkedInProfileUrl(url = "") {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" &&
      parsed.hostname === "www.linkedin.com" &&
      /^\/in\/[^/]+\/?$/.test(parsed.pathname);
  } catch (_error) {
    return false;
  }
}

function createExtractionMessage() {
  return {
    type: EXTRACT_REQUEST,
    version: 1,
    requestId: `linkedme-${Date.now()}`,
    payload: {
      sections: ["education", "experience", "volunteering"],
      renderAnimation: false,
      source: "popup",
    },
  };
}

async function sendExtractionMessage(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (_error) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/content_script.js"],
    });
    return chrome.tabs.sendMessage(tabId, message);
  }
}

document.getElementById("extract-profile").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  setStatus("Extracting profile data...", "pending");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id == null || !isLinkedInProfileUrl(tab.url)) {
      setStatus(INVALID_PROFILE_MESSAGE, "error");
      if (tab?.id != null) {
        try {
          await sendExtractionMessage(tab.id, createExtractionMessage());
        } catch (_error) {
          // Restricted browser pages cannot host the floating error message.
        }
      }
      button.disabled = false;
      return;
    }

    const response = await sendExtractionMessage(tab.id, createExtractionMessage());
    if (response?.type === EXTRACT_SUCCESS) {
      window.close();
      return;
    }

    setStatus(response?.payload?.message || "Extraction failed.", "error");
    button.disabled = false;
  } catch (error) {
    setStatus(error instanceof Error && error.message ? error.message : "Extraction failed.", "error");
    button.disabled = false;
  }
});
