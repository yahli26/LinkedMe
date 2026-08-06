(function initializeLinkedMeContentScript() {
  if (window.__LINKEDME_CONTENT_SCRIPT_LOADED__) {
    return;
  }

  window.__LINKEDME_CONTENT_SCRIPT_LOADED__ = true;

  const MESSAGE_TYPES = {
    extractRequest: "LINKEDME_EXTRACT_PROFILE_REQUEST",
    extractSuccess: "LINKEDME_EXTRACT_PROFILE_SUCCESS",
    extractError: "LINKEDME_EXTRACT_PROFILE_ERROR",
    statusUpdate: "LINKEDME_STATUS_UPDATE",
    manualJobSelectSuccess: "LINKEDME_MANUAL_JOB_SELECT_SUCCESS",
  };
  const INVALID_PROFILE_MESSAGE = "Go to a LinkedIn profile page";
  const EXTRACTION_SOURCES = {
    popup: "popup",
    floatingPanel: "floating-panel",
  };
  const PROFILE_NOT_LOADED_MESSAGE =
    "Please scroll down to the bottom of the page to load all profile sections before extracting.";
  const COMPANY_HEADER_WAIT_MS = 5000;
  const COMPANY_HEADER_POLL_MS = 200;
  const MANUAL_JOB_INVALID_URL_MESSAGE =
    "Please navigate to a LinkedIn company page before adding a new job.";
  let hasObservedProfilePageBottom = false;
  function isLinkedInProfilePage() {
    try {
      const parsedUrl = new URL(window.location.href);
      return (
        parsedUrl.protocol === "https:" &&
        parsedUrl.hostname === "www.linkedin.com" &&
        /^\/in\/[^/]+\/?$/.test(parsedUrl.pathname)
      );
    } catch (_error) {
      return false;
    }
  }

  function isLinkedInCompanyPage() {
    return /^https:\/\/www\.linkedin\.com\/(company|school|showcase)\/[^/]+\/?/.test(
      window.location.href
    );
  }

  function sendRuntimeMessage(message) {
    chrome.runtime.sendMessage(message).catch(() => {
      // The popup/background may be unavailable while the content script continues.
    });
  }

  function wait(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  function countExtractedItems(profileResult) {
    const counts = profileResult?.counts || {};

    return (
      (counts.education || 0) +
      (counts.experience || 0) +
      (counts.volunteering || 0)
    );
  }

  function assertProfileContentWasExtracted(profileResult) {
    if (countExtractedItems(profileResult) > 0) {
      return;
    }

    throw new Error(
      "LinkedMe found profile-like content, but could not match it to supported Education, Experience, or Volunteering cards."
    );
  }

  function getScrollPosition() {
    return window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
  }

  function getScrollHeight() {
    return Math.max(
      document.body?.scrollHeight || 0,
      document.documentElement?.scrollHeight || 0
    );
  }

  function isAtPageBottom() {
    const viewportHeight =
      window.innerHeight || document.documentElement.clientHeight || 800;
    const scrollHeight = getScrollHeight();
    return (
      scrollHeight > viewportHeight &&
      getScrollPosition() + viewportHeight >= scrollHeight - 64
    );
  }

  function recordPageBottomIfReached() {
    if (isLinkedInProfilePage() && isAtPageBottom()) {
      hasObservedProfilePageBottom = true;
    }
  }

  function assertProfileSectionsLoaded(sectionLoadState) {
    recordPageBottomIfReached();
    if (
      sectionLoadState.missingSections.length > 0 &&
      !hasObservedProfilePageBottom
    ) {
      throw new Error(PROFILE_NOT_LOADED_MESSAGE);
    }
  }

  window.addEventListener("scroll", recordPageBottomIfReached, { passive: true });

  function createErrorPayload(error) {
    return {
      code: "EXTRACTION_FAILED",
      message: error instanceof Error ? error.message : "Unknown extraction error",
    };
  }

  function createRequestId() {
    return `linkedme-${Date.now()}`;
  }

  async function performProfileExtraction(message) {
    const requestId = message.requestId || createRequestId();

    try {
      if (!isLinkedInProfilePage()) {
        throw new Error(INVALID_PROFILE_MESSAGE);
      }

      sendRuntimeMessage({
        type: MESSAGE_TYPES.statusUpdate,
        version: 1,
        requestId,
        payload: {
          status: "running",
          counts: {
            education: 0,
            experience: 0,
            volunteering: 0,
          },
          error: null,
        },
      });

      const { extractLinkedInProfile, getProfileSectionLoadState } = await import(
        chrome.runtime.getURL("content/profileExtractor.js")
      );

      const sectionLoadState = getProfileSectionLoadState(
        message.payload?.sections
      );
      assertProfileSectionsLoaded(sectionLoadState);

      const profileResult = extractLinkedInProfile(message.payload?.sections);
      profileResult.sectionLoad = {
        ...sectionLoadState,
        reachedPageBottom: hasObservedProfilePageBottom,
      };
      assertProfileContentWasExtracted(profileResult);

      if (message.payload?.renderAnimation !== false) {
        const { renderExtractionAnimation } = await import(
          chrome.runtime.getURL("content/animation.js")
        );
        renderExtractionAnimation(profileResult);
      }

      const successMessage = {
        type: MESSAGE_TYPES.extractSuccess,
        version: 1,
        requestId,
        payload: profileResult,
      };

      sendRuntimeMessage(successMessage);
      const extractionSource =
        message.payload?.source || EXTRACTION_SOURCES.popup;
      const panelUpdate =
        extractionSource === EXTRACTION_SOURCES.floatingPanel
          ? panelControllerPromise
          : getPanelController();

      if (panelUpdate) {
        panelUpdate
          .then((controller) =>
            controller.showProfile(profileResult, "Extraction completed.")
          )
          .catch(() => {
            showManualJobToast("Extraction succeeded, but the LinkedMe panel could not be loaded.", {
              error: true,
            });
          });
      }
      return successMessage;
    } catch (error) {
      const errorMessage = {
        type: MESSAGE_TYPES.extractError,
        version: 1,
        requestId,
        payload: createErrorPayload(error),
      };

      sendRuntimeMessage(errorMessage);
      showManualJobToast(errorMessage.payload.message, {
        error: true,
        timeoutMs: 3500,
      });
      return errorMessage;
    }
  }

  function removeManualJobToast() {
    document.getElementById("linkedme-manual-job-toast")?.remove();
  }

  function showManualJobToast(message, options = {}) {
    removeManualJobToast();

    const toast = document.createElement("div");
    toast.id = "linkedme-manual-job-toast";
    toast.setAttribute("role", "status");
    toast.textContent = message;
    Object.assign(toast.style, {
      position: "fixed",
      zIndex: "2147483647",
      top: "20px",
      left: "50%",
      transform: "translateX(-50%)",
      maxWidth: "min(440px, calc(100vw - 32px))",
      padding: "12px 16px",
      borderRadius: "8px",
      color: "#ffffff",
      background: options.error ? "#b42318" : "#0a66c2",
      boxShadow: "0 12px 28px rgba(0, 0, 0, 0.24)",
      font: "700 14px/1.35 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      textAlign: "center",
    });

    document.documentElement.append(toast);

    if (options.timeoutMs !== 0) {
      window.setTimeout(removeManualJobToast, options.timeoutMs || 3500);
    }
  }

  function cleanCompanyName(value) {
    const cleaned = String(value || "")
      .replace(/\s*\|\s*LinkedIn\s*$/i, "")
      .replace(/(?:\s+|^)logo\s*$/i, "")
      .replace(/\s+/g, " ")
      .trim();

    return /^logo$/i.test(cleaned) ? "" : cleaned;
  }

  function getCompanySearchRoots(baseRoot = document) {
    const roots = [];
    const pendingRoots = [baseRoot];
    const seenRoots = new Set();

    while (pendingRoots.length > 0) {
      const root = pendingRoots.shift();
      if (!root || seenRoots.has(root) || typeof root.querySelectorAll !== "function") {
        continue;
      }

      seenRoots.add(root);
      roots.push(root);

      for (const element of root.querySelectorAll("*")) {
        if (element.shadowRoot && !seenRoots.has(element.shadowRoot)) {
          pendingRoots.push(element.shadowRoot);
        }

        if (element.tagName === "IFRAME") {
          try {
            if (element.contentDocument && !seenRoots.has(element.contentDocument)) {
              pendingRoots.push(element.contentDocument);
            }
          } catch (_error) {
            // Cross-origin frames are intentionally inaccessible.
          }
        }
      }
    }

    return roots;
  }

  function queryCompanyElements(selector, baseRoot = document) {
    const directMatches = [...baseRoot.querySelectorAll(selector)];
    if (directMatches.length > 0) return directMatches;

    return getCompanySearchRoots(baseRoot)
      .slice(1)
      .flatMap((root) => [...root.querySelectorAll(selector)]);
  }

  function getCompanyHeaderCard() {
    const cards = queryCompanyElements(".org-top-card__primary-content");
    return cards.find((card) =>
      queryCompanyElements("h1.org-top-card-summary__title", card)[0] &&
      queryCompanyElements("img.org-top-card-primary-content__logo", card)[0]
    ) || cards[0] || null;
  }

  function getCompanyNameFromPage(headerCard = getCompanyHeaderCard()) {
    const heading = headerCard
      ? queryCompanyElements("h1.org-top-card-summary__title", headerCard)[0]
      : null;
    return cleanCompanyName(
      heading?.getAttribute("title") || heading?.textContent
    );
  }

  function getCompanyLogoFromPage(headerCard = getCompanyHeaderCard()) {
    return headerCard
      ? queryCompanyElements("img.org-top-card-primary-content__logo", headerCard)[0] || null
      : null;
  }

  function extractManualJobFromPage(headerCard = getCompanyHeaderCard()) {
    const image = getCompanyLogoFromPage(headerCard);
    const logoUrl = image?.getAttribute("src")?.trim() || "";
    const logoUrlCandidates = logoUrl ? [logoUrl] : [];
    const companyName = getCompanyNameFromPage(headerCard);

    if (!logoUrl) {
      throw new Error("LinkedMe could not find the company's main logo on this page.");
    }
    if (!companyName) {
      throw new Error("LinkedMe could not find the company name in the page header.");
    }

    return {
      companyName,
      logoUrl,
      logoUrlCandidates,
    };
  }

  async function waitForCompanyHeaderCard() {
    const deadline = Date.now() + COMPANY_HEADER_WAIT_MS;

    do {
      const headerCard = getCompanyHeaderCard();
      const companyName = getCompanyNameFromPage(headerCard);
      const logoUrl = getCompanyLogoFromPage(headerCard)
        ?.getAttribute("src")
        ?.trim();

      if (companyName && logoUrl) {
        return headerCard;
      }
      await wait(COMPANY_HEADER_POLL_MS);
    } while (Date.now() < deadline);

    return getCompanyHeaderCard();
  }

  async function addManualJobFromPage(requestId) {
    if (!isLinkedInCompanyPage()) {
      showManualJobToast(MANUAL_JOB_INVALID_URL_MESSAGE, {
        error: true,
        timeoutMs: 3500,
      });
      throw new Error(MANUAL_JOB_INVALID_URL_MESSAGE);
    }

    if (window.scrollY > 0) {
      window.scrollTo(0, 0);
      await wait(250);
    }

    const headerCard = await waitForCompanyHeaderCard();
    const payload = extractManualJobFromPage(headerCard);
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.manualJobSelectSuccess,
      version: 1,
      requestId,
      payload,
    });

    if (!response?.ok) {
      throw new Error(response?.message || "LinkedMe could not save the new job.");
    }
    if (!response.profile) {
      throw new Error("LinkedMe saved the new job without returning the updated profile.");
    }

    window.dispatchEvent(new window.CustomEvent("linkedme:manual-job-added", { detail: payload }));
    return response.profile;
  }

  let panelControllerPromise = null;

  function getPanelController() {
    if (!panelControllerPromise) {
      panelControllerPromise = import(chrome.runtime.getURL("content/panel.js")).then(
          ({ createFloatingPanelController }) =>
            createFloatingPanelController({
            onExtractProfile() {
              return performProfileExtraction({
                type: MESSAGE_TYPES.extractRequest,
                version: 1,
                requestId: createRequestId(),
                payload: {
                  sections: ["education", "experience", "volunteering"],
                  renderAnimation: true,
                  source: EXTRACTION_SOURCES.floatingPanel,
                },
              });
            },
            onAddNewJob() {
              return addManualJobFromPage(createRequestId());
            },
          })
      );
    }
    return panelControllerPromise;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === MESSAGE_TYPES.statusUpdate) {
      getPanelController()
        .then((controller) => controller.applyStatus(message))
        .catch(() => {});
      return false;
    }

    if (message?.type !== MESSAGE_TYPES.extractRequest) {
      return false;
    }

    const requestId = message.requestId || `linkedme-${Date.now()}`;

    performProfileExtraction({
      ...message,
      requestId,
    }).then(sendResponse);

    return true;
  });
})();

