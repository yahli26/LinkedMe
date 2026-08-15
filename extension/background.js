const MESSAGE_TYPES = {
  extractSuccess: "LINKEDME_EXTRACT_PROFILE_SUCCESS",
  extractError: "LINKEDME_EXTRACT_PROFILE_ERROR",
  statusUpdate: "LINKEDME_STATUS_UPDATE",
  manualJobSelectSuccess: "LINKEDME_MANUAL_JOB_SELECT_SUCCESS",
  imageFetchRequest: "LINKEDME_IMAGE_FETCH_REQUEST",
  imageFetchSuccess: "LINKEDME_IMAGE_FETCH_SUCCESS",
  imageFetchError: "LINKEDME_IMAGE_FETCH_ERROR",
};

let latestStatus = {
  type: MESSAGE_TYPES.statusUpdate,
  version: 1,
  requestId: null,
  payload: {
    status: "idle",
    counts: {
      education: 0,
      experience: 0,
      volunteering: 0,
    },
    error: null,
    profile: null,
  },
};

const imageResponseCache = new Map();
const MAX_IMAGE_RESPONSE_CACHE_SIZE = 50;
const ALLOWED_IMAGE_HOSTS = new Set(["media.licdn.com", "static.licdn.com"]);
const STATUS_STORAGE_KEY = "linkedme.latestStatus.v1";

function removeStoredProfileUrl(profile) {
  if (!profile || typeof profile !== "object" || !("profileUrl" in profile)) {
    return profile;
  }

  const { profileUrl: _removedProfileUrl, ...profileWithoutUrl } = profile;
  return profileWithoutUrl;
}

function sanitizeStatusProfile(status) {
  const profile = status?.payload?.profile;
  const sanitizedProfile = removeStoredProfileUrl(profile);

  if (sanitizedProfile === profile) {
    return status;
  }

  return {
    ...status,
    payload: {
      ...status.payload,
      profile: sanitizedProfile,
    },
  };
}

const statusReady = (async () => {
  try {
    const stored = await chrome.storage?.local?.get(STATUS_STORAGE_KEY);
    const restoredStatus = stored?.[STATUS_STORAGE_KEY];
    if (restoredStatus?.type === MESSAGE_TYPES.statusUpdate && restoredStatus.payload) {
      latestStatus = sanitizeStatusProfile(restoredStatus);

      if (latestStatus !== restoredStatus) {
        await chrome.storage?.local?.set({ [STATUS_STORAGE_KEY]: latestStatus });
      }
    }
  } catch (_error) {
    // In-memory status remains available if storage cannot be read.
  }
})();

async function persistLatestStatus() {
  try {
    latestStatus = sanitizeStatusProfile(latestStatus);
    await chrome.storage?.local?.set({ [STATUS_STORAGE_KEY]: latestStatus });
  } catch (_error) {
    // Keep the active session working even if persistence is unavailable.
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary);
}

function assertAllowedImageUrl(url) {
  let parsedUrl;

  try {
    parsedUrl = new URL(url);
  } catch (_error) {
    throw new Error("Invalid image URL.");
  }

  if (parsedUrl.protocol !== "https:" || !ALLOWED_IMAGE_HOSTS.has(parsedUrl.hostname)) {
    throw new Error("Only LinkedIn CDN image URLs can be proxied.");
  }

  return parsedUrl.href;
}

function rememberImageResponse(url, payload) {
  if (imageResponseCache.size >= MAX_IMAGE_RESPONSE_CACHE_SIZE) {
    imageResponseCache.delete(imageResponseCache.keys().next().value);
  }

  imageResponseCache.set(url, payload);
}

async function fetchLinkedInImage(url) {
  const safeUrl = assertAllowedImageUrl(url);
  const cachedPayload = imageResponseCache.get(safeUrl);

  if (cachedPayload) {
    return cachedPayload;
  }

  const response = await fetch(safeUrl, {
    cache: "force-cache",
    credentials: "omit",
    headers: {
      Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`LinkedIn image request failed with HTTP ${response.status}.`);
  }

  const contentType = response.headers.get("content-type") || "application/octet-stream";

  if (!contentType.toLowerCase().startsWith("image/")) {
    throw new Error(`LinkedIn image response was ${contentType}, not an image.`);
  }

  const buffer = await response.arrayBuffer();

  if (!buffer.byteLength) {
    throw new Error("LinkedIn image response was empty.");
  }

  const payload = {
    url: safeUrl,
    dataUrl: `data:${contentType};base64,${arrayBufferToBase64(buffer)}`,
    contentType,
    byteLength: buffer.byteLength,
  };

  rememberImageResponse(safeUrl, payload);
  return payload;
}

function createEmptyProfile() {
  return {
    extractedAt: new Date().toISOString(),
    data: {
      education: [],
      experience: [],
      volunteering: [],
    },
    counts: {
      education: 0,
      experience: 0,
      volunteering: 0,
    },
  };
}

function countItems(profile) {
  return {
    education: profile.data.education.length,
    experience: profile.data.experience.length,
    volunteering: profile.data.volunteering.length,
  };
}

function createStatusMessage(requestId, status, counts, error = null, profile = null) {
  return {
    type: MESSAGE_TYPES.statusUpdate,
    version: 1,
    requestId,
    payload: {
      status,
      counts: counts || {
        education: 0,
        experience: 0,
        volunteering: 0,
      },
      error,
      profile: removeStoredProfileUrl(profile),
    },
  };
}

function getCurrentMonthExperienceDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");

  return {
    startDate: `${year}/${month}`,
    endDate: "until now",
  };
}

function createManualExperience(payload = {}) {
  const dates = getCurrentMonthExperienceDate();
  const companyName = payload.companyName || "Selected company";

  return {
    title: "New Job",
    companyName,
    startDate: dates.startDate,
    endDate: dates.endDate,
    logoUrl: payload.logoUrl || "",
    logoUrlCandidates: payload.logoUrlCandidates || (payload.logoUrl ? [payload.logoUrl] : []),
  };
}

function addManualJobToLatestProfile(payload) {
  const profile = latestStatus.payload.profile || createEmptyProfile();
  const existingData = profile.data || {};
  const nextProfile = {
    ...profile,
    extractedAt: new Date().toISOString(),
    data: {
      education: [...(existingData.education || [])],
      experience: [createManualExperience(payload), ...(existingData.experience || [])],
      volunteering: [...(existingData.volunteering || [])],
    },
  };

  nextProfile.counts = countItems(nextProfile);
  return nextProfile;
}

function broadcastStatus() {
  chrome.runtime.sendMessage(latestStatus).catch(() => {
    // No popup is open to receive this status update.
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message?.type) {
    return false;
  }

  if (message.type === MESSAGE_TYPES.statusUpdate) {
    statusReady.then(async () => {
      latestStatus = message;
      await persistLatestStatus();
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.type === MESSAGE_TYPES.extractSuccess) {
    statusReady.then(async () => {
      latestStatus = createStatusMessage(
        message.requestId,
        "completed",
        message.payload?.counts,
        null,
        message.payload || null
      );
      await persistLatestStatus();
      broadcastStatus();
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.type === MESSAGE_TYPES.extractError) {
    statusReady.then(async () => {
      latestStatus = createStatusMessage(
        message.requestId,
        "failed",
        null,
        message.payload || null,
        null
      );
      await persistLatestStatus();
      broadcastStatus();
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.type === MESSAGE_TYPES.imageFetchRequest) {
    (async () => {
      try {
        const payload = await fetchLinkedInImage(message.payload?.url || "");
        sendResponse({
          type: MESSAGE_TYPES.imageFetchSuccess,
          version: 1,
          requestId: message.requestId || null,
          payload,
        });
      } catch (error) {
        sendResponse({
          type: MESSAGE_TYPES.imageFetchError,
          version: 1,
          requestId: message.requestId || null,
          payload: {
            message: error instanceof Error ? error.message : "Image fetch failed.",
            url: message.payload?.url || "",
          },
        });
      }
    })();

    return true;
  }

  if (message.type === MESSAGE_TYPES.manualJobSelectSuccess) {
    statusReady.then(async () => {
      const profile = addManualJobToLatestProfile(message.payload);
      latestStatus = createStatusMessage(
        message.requestId,
        "manual-job-added",
        profile.counts,
        null,
        profile
      );
      await persistLatestStatus();
      broadcastStatus();
      sendResponse({ ok: true, profile });
    });
    return true;
  }


  return false;
});
