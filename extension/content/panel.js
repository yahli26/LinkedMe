import { sortEntriesChronologically } from "../extractors/linkedinParsing.js";

const PANEL_ID = "linkedme-floating-panel";
const STYLE_ID = "linkedme-floating-panel-style";
const SIGN_ORDER = ["center_sign", "right_sign", "left_sign"];
const SIGN_RENDER_SCALE = 0.75;
const LIMITS = { three: 3, one: 1 };
const OUTPUT_FPS = 12;
const OUTPUT_FRAME_COUNT = 120;
const OUTPUT_WIDTH = 1280;
const OUTPUT_HEIGHT = 720;
const MEDIA_TIMEOUT_MS = 15000;
const TRACKING_NUMBER_FIELDS = [
  "left", "top", "right", "bottom", "width", "height", "center_x", "center_y",
];
const TEMPLATE_CONFIG = Object.freeze({
  one: Object.freeze({
    mode: "one",
    name: "one-sign",
    logoCount: 1,
    videoPath: "assets/1_sign_video_12_frames_final.mp4",
    trackingPath: "assets/1_sign_track_raw_12_frames.json",
    sourceName: "1_sign_video_12_frames.mp4",
    signOrder: Object.freeze(["center_sign"]),
    trackRanges: Object.freeze({ center_sign: Object.freeze([55, 119]) }),
  }),
  three: Object.freeze({
    mode: "three",
    name: "three-signs",
    logoCount: 3,
    videoPath: "assets/3_signs_video_12_frames_final.mp4",
    trackingPath: "assets/3_sign_tracks_corrected_12_frames.json",
    sourceName: "3_signs_video_12_frames.mp4",
    signOrder: Object.freeze([...SIGN_ORDER]),
    trackRanges: Object.freeze({
      left_sign: Object.freeze([4, 39]),
      right_sign: Object.freeze([40, 73]),
      center_sign: Object.freeze([73, 119]),
    }),
  }),
});

export function selectTemplate(mode) {
  const template = TEMPLATE_CONFIG[mode];
  if (!template) throw new Error("Unknown GIF template mode.");
  return template;
}

export function gifFrameDelay(frameIndex) {
  return frameIndex % 3 === 2 ? 90 : 80;
}

export function validateTrackingData(data, template) {
  const metadata = data?.video;
  if (!metadata || metadata.width !== OUTPUT_WIDTH || metadata.height !== OUTPUT_HEIGHT ||
      metadata.total_frames !== OUTPUT_FRAME_COUNT || metadata.start_frame !== 0 ||
      metadata.end_frame !== OUTPUT_FRAME_COUNT - 1 || metadata.source !== template.sourceName ||
      !data.tracks || typeof data.tracks !== "object") {
    throw new Error("Sign tracking data does not match the selected 120-frame template.");
  }

  for (const [signName, range] of Object.entries(template.trackRanges)) {
    const samples = data.tracks[signName];
    const [firstFrame, lastFrame] = range;
    const expectedCount = lastFrame - firstFrame + 1;
    if (!Array.isArray(samples) || samples.length !== expectedCount) {
      throw new Error("Sign tracking data has an unexpected number of entries for " + signName + ".");
    }

    const frames = new Set();
    for (const sample of samples) {
      if (!Number.isInteger(sample?.frame) || sample.frame < firstFrame ||
          sample.frame > lastFrame || frames.has(sample.frame) ||
          !TRACKING_NUMBER_FIELDS.every((field) => Number.isFinite(sample[field])) ||
          sample.width <= 0 || sample.height <= 0 ||
          typeof sample.outside !== "boolean" || typeof sample.occluded !== "boolean") {
        throw new Error("Sign tracking data contains an invalid sample for " + signName + ".");
      }
      frames.add(sample.frame);
    }

  }

  return data;
}

export function containedImageRect(rect, imageWidth, imageHeight) {
  if (!(imageWidth > 0) || !(imageHeight > 0)) {
    throw new Error("Logo image dimensions are invalid.");
  }
  const scale = Math.min(rect.width / imageWidth, rect.height / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return {
    left: rect.left + (rect.width - width) / 2,
    top: rect.top + (rect.height - height) / 2,
    width,
    height,
  };
}

export function scaledSignRect(sample, xScale, yScale) {
  const sourceWidth = sample.width || sample.right - sample.left;
  const sourceHeight = sample.height || sample.bottom - sample.top;
  const width = sourceWidth * xScale * SIGN_RENDER_SCALE;
  const height = sourceHeight * yScale * SIGN_RENDER_SCALE;
  const centerX = sample.center_x * xScale;
  const centerY = sample.center_y * yScale;
  return {
    left: centerX - width / 2,
    top: centerY - height / 2,
    width,
    height,
  };
}

function normalizeEntries(profile) {
  const data = profile?.data || {};
  const labels = { experience: "Job", education: "Education", volunteering: "Volunteering" };
  const entries = ["experience", "education", "volunteering"].flatMap((type) =>
    (data[type] || [])
      .filter((item) =>
        Boolean(item.logoUrl || item.logoUrlCandidates?.length)
      )
      .map((item, index) => ({
        id: [type, item.startDate || "unknown", item.endDate || "unknown",
          item.companyName || item.organizationName || item.institutionName || index, index].join("-"),
        typeLabel: labels[type],
        title: item.title || item.role || item.degree || item.companyName ||
          item.organizationName || item.institutionName || "Untitled entry",
        organization: item.companyName || item.organizationName || item.institutionName || "",
        startDate: item.startDate || "",
        endDate: item.endDate || "",
        logoUrl: item.logoUrl || "",
        logoUrlCandidates: item.logoUrlCandidates || (item.logoUrl ? [item.logoUrl] : []),
      }))
  );

  return sortEntriesChronologically(entries);
}

function trackingSampleAtFrame(samples, frame) {
  return samples.find((sample) => sample.frame === frame) || null;
}

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = [
    "#" + PANEL_ID + "{position:fixed;right:24px;top:96px;z-index:2147483647;width:min(360px,calc(100vw - 32px));max-height:calc(100vh - 112px);overflow:auto;box-sizing:border-box;border:1px solid rgba(10,102,194,.2);border-radius:14px;color:#17212b;background:#fff;box-shadow:0 16px 42px rgba(0,0,0,.24);font:13px/1.4 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}",
    "#" + PANEL_ID + ",#" + PANEL_ID + " *{box-sizing:border-box}",
    "#" + PANEL_ID + " .linkedme-panel-header{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;color:#fff;background:#0a66c2;cursor:grab;user-select:none}",
    "#" + PANEL_ID + " .linkedme-panel-title{margin:0;font-size:15px;font-weight:800}",
    "#" + PANEL_ID + " .linkedme-panel-close{position:relative;display:flex;flex:0 0 28px;align-items:center;justify-content:center;width:28px;height:28px;margin:-5px -7px -5px 8px;padding:0;border-radius:50%;color:transparent;background:transparent;font-size:0;line-height:0;transform-origin:center center;transform-box:border-box;transition:background-color .16s ease,transform .16s ease,opacity .16s ease}",
    "#" + PANEL_ID + " .linkedme-panel-close::before,#" + PANEL_ID + " .linkedme-panel-close::after{content:'';position:absolute;top:50%;left:50%;width:15px;height:2px;border-radius:999px;background:#fff;transform-origin:center center}",
    "#" + PANEL_ID + " .linkedme-panel-close::before{transform:translate(-50%,-50%) rotate(45deg)}",
    "#" + PANEL_ID + " .linkedme-panel-close::after{transform:translate(-50%,-50%) rotate(-45deg)}",
    "#" + PANEL_ID + " .linkedme-panel-close:hover{background:rgba(255,255,255,.18);transform:rotate(90deg) scale(1.06)}",
    "#" + PANEL_ID + " .linkedme-panel-close:focus-visible{outline:2px solid #fff;outline-offset:2px}",
    "#" + PANEL_ID + " .linkedme-panel-close:active{transform:rotate(90deg) scale(.92);opacity:.8}",
    "#" + PANEL_ID + " .linkedme-panel-body{display:grid;gap:10px;padding:14px}",
    "#" + PANEL_ID + " .linkedme-panel-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px}",
    "#" + PANEL_ID + " button{border:0;border-radius:8px;padding:9px 10px;color:#fff;background:#0a66c2;font:inherit;font-weight:800;cursor:pointer}",
    "#" + PANEL_ID + " button.secondary{color:#0a66c2;background:#e8f3ff}",
    "#" + PANEL_ID + " button:disabled{cursor:not-allowed;opacity:.58}",
    "#" + PANEL_ID + " .linkedme-panel-status{margin:0;color:#4f5f6f}",
    "#" + PANEL_ID + " .recent-section-header{display:flex;align-items:center;justify-content:space-between;gap:8px}",
    "#" + PANEL_ID + " .extracted-profile-heading{position:relative;display:inline-flex;align-items:center;gap:6px;min-width:0}",
    "#" + PANEL_ID + " .extracted-profile-info{display:inline-flex;flex:0 0 auto}",
    "#" + PANEL_ID + " .extracted-profile-info-button{position:relative;display:flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border-radius:50%;background:#0a66c2}",
    "#" + PANEL_ID + " .extracted-profile-info-icon{position:absolute;top:50%;left:50%;display:block;width:14px;height:14px;margin:0;fill:currentColor;transform:translate(-50%,-50%)}",
    "#" + PANEL_ID + " .extracted-profile-info-button:hover{background:#084f96}",
    "#" + PANEL_ID + " .extracted-profile-info-button:focus-visible{outline:2px solid #0a66c2;outline-offset:2px}",
    "#" + PANEL_ID + " .extracted-profile-tooltip{position:absolute;top:calc(100% + 8px);left:0;z-index:10;width:min(300px,calc(100vw - 60px));padding:10px 12px;border:1px solid #c9def3;border-radius:8px;color:#17212b;background:#fff;box-shadow:0 8px 24px rgba(0,0,0,.18);font-size:12px;font-weight:400;line-height:1.4;opacity:0;visibility:hidden;transform:translateY(-4px);pointer-events:none;transition:opacity .16s ease,transform .16s ease,visibility 0s linear .16s}",
    "#" + PANEL_ID + " .extracted-profile-tooltip p{margin:0}",
    "#" + PANEL_ID + " .extracted-profile-tooltip p+p{margin-top:6px}",
    "#" + PANEL_ID + " .extracted-profile-info:hover .extracted-profile-tooltip,#" + PANEL_ID + " .extracted-profile-info:focus-within .extracted-profile-tooltip{opacity:1;visibility:visible;transform:translateY(0);transition-delay:0s}",
    "#" + PANEL_ID + " .video-mode-toggle{display:inline-flex;align-items:center;gap:7px;color:#33465a;font-size:12px;font-weight:700;cursor:pointer}",
    "#" + PANEL_ID + " .video-mode-toggle input{position:absolute;width:1px;height:1px;clip-path:inset(50%)}",
    "#" + PANEL_ID + " .video-mode-toggle-track{position:relative;width:38px;height:22px;border-radius:99px;background:#b8c5d3}",
    "#" + PANEL_ID + " .video-mode-toggle-thumb{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .16s}",
    "#" + PANEL_ID + " .video-mode-toggle input:checked+.video-mode-toggle-track{background:#0a66c2}",
    "#" + PANEL_ID + " .video-mode-toggle input:checked+.video-mode-toggle-track .video-mode-toggle-thumb{transform:translateX(16px)}",
    "#" + PANEL_ID + " .experience-list{display:grid;gap:8px;margin:0;padding:0;list-style:none}",
    "#" + PANEL_ID + " .experience-item{display:grid;grid-template-columns:34px 1fr;gap:10px;align-items:center;min-height:58px;padding:10px;border:1px solid #d6dee6;border-radius:8px;background:#f8fafc;cursor:grab}",
    "#" + PANEL_ID + " .experience-item.is-selected-for-video{border-color:#0a66c2;background:#f2f8ff;box-shadow:inset 3px 0 #0a66c2}",
    "#" + PANEL_ID + " .experience-item.is-outside-video{background:#fff}",
    "#" + PANEL_ID + " .experience-item.is-dragging{opacity:.55}",
    "#" + PANEL_ID + " .experience-item.is-drop-target{border-color:#0a66c2;background:#eef6ff}",
    "#" + PANEL_ID + " .experience-selection-divider{display:grid;grid-template-columns:1fr auto 1fr;gap:8px;align-items:center;color:#5f6f80;font-size:11px;font-weight:700;text-align:center}",
    "#" + PANEL_ID + " .experience-selection-divider:before,#" + PANEL_ID + " .experience-selection-divider:after{content:'';height:1px;background:#a9bad0}",
    "#" + PANEL_ID + " .experience-logo{width:34px;height:34px;border-radius:6px;object-fit:cover;background:#e8eef4}",
    "#" + PANEL_ID + " .experience-logo-fallback{display:grid;place-items:center;color:#4f5f6f;font-weight:700}",
    "#" + PANEL_ID + " .experience-content{display:grid;gap:2px;min-width:0}",
    "#" + PANEL_ID + " .experience-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:800}",
    "#" + PANEL_ID + " .experience-date{overflow:hidden;color:#4f5f6f;font-size:12px;text-overflow:ellipsis;white-space:nowrap}",
    "#" + PANEL_ID + " .experience-video-badge{width:max-content;margin-top:3px;padding:2px 6px;border-radius:99px;color:#064b8f;background:#dcecff;font-size:11px;font-weight:700}",
    "#" + PANEL_ID + " .generation-loading[hidden],#" + PANEL_ID + " .generation-result[hidden]{display:none}",
    "#" + PANEL_ID + " .generation-loading{display:grid;grid-template-columns:34px 1fr;gap:10px;align-items:center;padding:12px;border:1px solid #cfe1f5;border-radius:10px;background:#f4f9ff}",
    "#" + PANEL_ID + " .generation-spinner{width:30px;height:30px;border:3px solid #c9def3;border-top-color:#0a66c2;border-radius:50%;animation:linkedme-spin .8s linear infinite}",
    "#" + PANEL_ID + " .generation-loading-copy{display:grid;gap:4px;min-width:0}",
    "#" + PANEL_ID + " .generation-loading-title{font-weight:800;color:#17324d}",
    "#" + PANEL_ID + " .generation-progress-text{margin:0;color:#4f5f6f;font-size:12px}",
    "#" + PANEL_ID + " .generation-progress{width:100%;height:7px;accent-color:#0a66c2}",
    "#" + PANEL_ID + " .generation-result{display:grid;gap:9px;padding-top:2px}",
    "#" + PANEL_ID + " .generated-gif{display:block;width:100%;height:auto;border:1px solid #d6dee6;border-radius:9px;background:#101820}",
    "#" + PANEL_ID + " .download-gif{display:block;border-radius:8px;padding:9px 10px;color:#fff;background:#0a66c2;font:inherit;font-weight:800;text-align:center;text-decoration:none}",
    "#" + PANEL_ID + " .linkedme-panel-status.is-error{color:#b42318}",
    "@keyframes linkedme-spin{to{transform:rotate(360deg)}}"
  ].join("\n");
  document.documentElement.append(style);
}

function makeLogo(entry) {
  const url = entry.logoUrlCandidates[0] || entry.logoUrl;
  const fallback = () => {
    const node = document.createElement("div");
    node.className = "experience-logo experience-logo-fallback";
    node.textContent = entry.typeLabel.charAt(0);
    return node;
  };
  if (!url) return fallback();
  const image = document.createElement("img");
  image.className = "experience-logo";
  image.alt = "";
  image.src = url;
  image.addEventListener("error", () => image.replaceWith(fallback()), { once: true });
  return image;
}

function makeDraggable(panel, handle) {
  let drag = null;
  handle.addEventListener("mousedown", (event) => {
    if (event.button !== 0 || event.target.closest("button,input,label")) return;
    const rect = panel.getBoundingClientRect();
    drag = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    handle.style.cursor = "grabbing";
    event.preventDefault();
  });
  document.addEventListener("mousemove", (event) => {
    if (!drag) return;
    const width = panel.offsetWidth || 360;
    const height = panel.offsetHeight || 400;
    panel.style.left = Math.max(0, Math.min(window.innerWidth - width, event.clientX - drag.x)) + "px";
    panel.style.top = Math.max(0, Math.min(window.innerHeight - height, event.clientY - drag.y)) + "px";
    panel.style.right = "auto";
  });
  document.addEventListener("mouseup", () => {
    drag = null;
    handle.style.cursor = "grab";
  });
}

function createAbortError() {
  return new DOMException("GIF generation was cancelled.", "AbortError");
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw createAbortError();
}

async function getSafeLogoBlob(entry, signal) {
  const candidates = [...new Set([
    ...(entry.logoUrlCandidates || []),
    entry.logoUrl,
  ].filter(Boolean))];
  if (!candidates.length) {
    throw new Error("No LinkedIn logo was found for " + (entry.organization || entry.title) + ".");
  }

  for (const url of candidates) {
    throwIfAborted(signal);
    if (url.startsWith("data:") || url.startsWith("blob:")) {
      try {
        const response = await fetch(url, { signal });
        if (response.ok) return await response.blob();
      } catch (error) {
        if (error?.name === "AbortError") throw error;
      }
      continue;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: "LINKEDME_IMAGE_FETCH_REQUEST",
        version: 1,
        requestId: "linkedme-image-" + Date.now() + "-" + Math.random().toString(36).slice(2),
        payload: { url },
      });
      throwIfAborted(signal);
      if (response?.type === "LINKEDME_IMAGE_FETCH_SUCCESS" && response.payload?.dataUrl) {
        const dataResponse = await fetch(response.payload.dataUrl, { signal });
        if (dataResponse.ok) return await dataResponse.blob();
      }
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      // Try the next signed/high-resolution candidate.
    }
  }

  throw new Error("Could not load the LinkedIn logo for " +
    (entry.organization || entry.title) + ".");
}

async function loadLogoImages(selectedEntries, signal) {
  const logos = [];
  try {
    for (const entry of selectedEntries) {
      const blob = await getSafeLogoBlob(entry, signal);
      const contentType = (blob.type || "").toLowerCase().split(";")[0];
      if (!["image/png", "image/jpeg", "image/webp"].includes(contentType)) {
        throw new Error("The logo for " + (entry.organization || entry.title) +
          " is not a PNG, JPEG, or WebP image.");
      }
      throwIfAborted(signal);
      const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
      if (!bitmap.width || !bitmap.height) {
        bitmap.close();
        throw new Error("The logo for " + (entry.organization || entry.title) +
          " has invalid dimensions.");
      }
      logos.push(bitmap);
    }
    return logos;
  } catch (error) {
    logos.forEach((logo) => logo.close());
    throw error;
  }
}

async function loadTrackingData(template, signal) {
  let response;
  try {
    response = await fetch(chrome.runtime.getURL(template.trackingPath), { signal });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new Error("The selected sign tracking file could not be loaded.");
  }
  if (!response.ok) {
    throw new Error("The selected sign tracking file is missing (HTTP " + response.status + ").");
  }
  let data;
  try {
    data = await response.json();
  } catch (_error) {
    throw new Error("The selected sign tracking file is not valid JSON.");
  }
  return validateTrackingData(data, template);
}

function waitForVideoEvent(video, eventName, signal, timeoutMessage) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }
    let timeout;
    const cleanup = () => {
      clearTimeout(timeout);
      video.removeEventListener(eventName, onSuccess);
      video.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };
    const onSuccess = () => { cleanup(); resolve(); };
    const onError = () => {
      cleanup();
      reject(new Error("Chrome could not decode the selected video template."));
    };
    const onAbort = () => { cleanup(); reject(createAbortError()); };
    video.addEventListener(eventName, onSuccess, { once: true });
    video.addEventListener("error", onError, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
    timeout = setTimeout(() => {
      cleanup();
      reject(new Error(timeoutMessage));
    }, MEDIA_TIMEOUT_MS);
  });
}

async function loadVideo(template, signal) {
  let response;
  try {
    response = await fetch(chrome.runtime.getURL(template.videoPath), { signal });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new Error("The selected video template could not be loaded.");
  }
  if (!response.ok) {
    throw new Error("The selected video template is missing (HTTP " + response.status + ").");
  }

  const videoUrl = URL.createObjectURL(await response.blob());
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.src = videoUrl;

  try {
    const metadataReady = waitForVideoEvent(
      video, "loadedmetadata", signal, "Timed out while loading the video template."
    );
    video.load();
    await metadataReady;
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await waitForVideoEvent(
        video, "loadeddata", signal, "Timed out while decoding the first video frame."
      );
    }
    if (video.videoWidth !== OUTPUT_WIDTH || video.videoHeight !== OUTPUT_HEIGHT ||
        !Number.isFinite(video.duration) ||
        video.duration + 0.001 < (OUTPUT_FRAME_COUNT - 1) / OUTPUT_FPS) {
      throw new Error("The video template does not match its 1280×720 tracking data.");
    }
    video.pause();
    return { video, videoUrl };
  } catch (error) {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(videoUrl);
    throw error;
  }
}

async function seekVideoToFrame(video, frameIndex, signal) {
  throwIfAborted(signal);
  const timestamp = (frameIndex + 0.1) / OUTPUT_FPS;

  const seeked = waitForVideoEvent(
    video, "seeked", signal, "Timed out while reading video frame " + (frameIndex + 1) + "."
  );
  video.currentTime = timestamp;
  await seeked;
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      Math.abs(video.currentTime - timestamp) > 1 / (OUTPUT_FPS * 2)) {
    throw new Error("The video decoder returned the wrong source frame at frame " +
      (frameIndex + 1) + ".");
  }
}

function buildTrackingIndex(tracking) {
  return Object.fromEntries(Object.entries(tracking.tracks).map(([signName, samples]) => [
    signName,
    new Map(samples.map((sample) => [sample.frame, sample])),
  ]));
}

function drawTrackedLogos(context, logos, tracking, trackingIndex, signOrder, frameIndex) {
  const xScale = context.canvas.width / tracking.video.width;
  const yScale = context.canvas.height / tracking.video.height;
  signOrder.forEach((signName, logoIndex) => {
    const sample = trackingIndex[signName]?.get(frameIndex);
    if (!sample || sample.outside || sample.occluded) return;
    const trackedRect = scaledSignRect(sample, xScale, yScale);
    const logo = logos[logoIndex];
    const drawRect = containedImageRect(trackedRect, logo.width, logo.height);
    context.drawImage(logo, drawRect.left, drawRect.top, drawRect.width, drawRect.height);
  });
}

export async function createGifWorkerClient(signal) {
  const workerModuleUrl = chrome.runtime.getURL("content/gifEncoder.worker.js");
  const bootstrapUrl = URL.createObjectURL(new Blob(
    [`import ${JSON.stringify(workerModuleUrl)};`],
    { type: "text/javascript" }
  ));
  let bootstrapUrlActive = true;
  const releaseBootstrapUrl = () => {
    if (!bootstrapUrlActive) return;
    bootstrapUrlActive = false;
    URL.revokeObjectURL(bootstrapUrl);
  };
  let worker;
  try {
    // A content script has the host page's origin for Worker URL checks. Starting
    // with a same-origin blob avoids loading the chrome-extension:// URL as the
    // worker entry point; the module import is allowed by web_accessible_resources.
    worker = new Worker(bootstrapUrl, { type: "module" });
  } catch (error) {
    releaseBootstrapUrl();
    throw error;
  }
  const pending = new Map();
  let nextId = 1;
  let terminated = false;

  const rejectPending = (error) => {
    pending.forEach(({ reject }) => reject(error));
    pending.clear();
  };
  const terminate = (error = createAbortError()) => {
    if (terminated) return;
    terminated = true;
    releaseBootstrapUrl();
    signal?.removeEventListener("abort", onAbort);
    worker.terminate();
    rejectPending(error);
  };
  const onAbort = () => terminate(createAbortError());
  signal?.addEventListener("abort", onAbort, { once: true });

  worker.addEventListener("message", (event) => {
    const message = event.data || {};
    const deferred = pending.get(message.id);
    if (!deferred) return;
    pending.delete(message.id);
    if (message.type === "error") deferred.reject(new Error(message.message || "GIF encoding failed."));
    else deferred.resolve(message);
  });
  worker.addEventListener("error", (event) => {
    terminate(new Error(event.message || "The GIF encoder worker failed."));
  });

  const send = (type, payload = {}, transfer = []) => {
    throwIfAborted(signal);
    if (terminated) return Promise.reject(new Error("The GIF encoder is no longer available."));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, type, ...payload }, transfer);
    });
  };

  try {
    await send("init", {
      width: OUTPUT_WIDTH,
      height: OUTPUT_HEIGHT,
      frameCount: OUTPUT_FRAME_COUNT,
      maxColors: 256,
    });
    releaseBootstrapUrl();
  } catch (error) {
    terminate(error);
    throw error;
  }
  return {
    async encodeFrame(frameIndex, rgba, delay) {
      await send("frame", { frameIndex, rgba: rgba.buffer, delay }, [rgba.buffer]);
    },
    async finish() {
      const message = await send("finish");
      return message.bytes;
    },
    terminate,
  };
}

function assertGifBytes(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.byteLength < 7) throw new Error("The GIF encoder returned an empty file.");
  const signature = String.fromCharCode(...bytes.subarray(0, 6));
  if (signature !== "GIF87a" && signature !== "GIF89a") {
    throw new Error("The GIF encoder returned an invalid file.");
  }
}

function generatedFilename(template) {
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  return "linkedme-" + template.name + "-" + timestamp + ".gif";
}
function createFloatingPanelController(options) {
  let entries = [];
  let mode = "three";
  let draggedId = null;
  let panel = null;
  let status;
  let list;
  let modeToggle;
  let modeText;
  let generateButton;
  let loadingSection;
  let loadingProgress;
  let loadingProgressText;
  let resultSection;
  let resultImage;
  let downloadLink;
  let isGenerating = false;
  let activeGeneration = null;
  let generatedGifUrl = null;

  function limit() { return LIMITS[mode]; }
  function formatExtractedDate(value) {
    const match = /^(\d{4})[/-](\d{1,2})$/.exec(value || "");
    if (!match) return value;
    return match[2].padStart(2, "0") + "/" + match[1];
  }
  function setStatus(text, isError = false) {
    if (!status) return;
    status.textContent = text;
    status.classList.toggle("is-error", isError);
  }
  function formatDates(entry) {
    if (entry.dateLabel) return entry.dateLabel;
    entry = {
      ...entry,
      startDate: formatExtractedDate(entry.startDate),
      endDate: formatExtractedDate(entry.endDate),
    };
    if (!entry.startDate && !entry.endDate) return "Dates are unavailable";
    return (entry.startDate || "Unknown") + " – " + (entry.endDate || "Present");
  }

  function updateGenerateControls() {
    if (generateButton) generateButton.disabled = isGenerating || entries.length < limit();
    if (modeToggle) modeToggle.disabled = isGenerating;
  }

  function showLoadingState(text = "Loading assets…", progress = 0) {
    if (!loadingSection) return;
    loadingSection.hidden = false;
    loadingProgressText.textContent = text;
    loadingProgress.value = progress;
  }

  function updateProgress(text, progress) {
    if (!loadingSection) return;
    loadingProgressText.textContent = text;
    loadingProgress.value = Math.max(0, Math.min(100, progress));
  }

  function hideLoadingState() {
    if (loadingSection) loadingSection.hidden = true;
  }

  function cleanupGenerationResources(session) {
    if (!session || session.cleaned) return;
    session.cleaned = true;
    session.workerClient?.terminate();
    if (session.video) {
      session.video.pause();
      session.video.removeAttribute("src");
      session.video.load();
    }
    if (session.videoUrl) URL.revokeObjectURL(session.videoUrl);
    session.logos?.forEach((logo) => logo.close());
    if (session.canvas) {
      session.canvas.width = 0;
      session.canvas.height = 0;
    }
  }

  function abortActiveGeneration() {
    const session = activeGeneration;
    if (!session) return;
    activeGeneration = null;
    isGenerating = false;
    session.controller.abort();
    cleanupGenerationResources(session);
    hideLoadingState();
    updateGenerateControls();
  }

  function clearGeneratedResult() {
    if (generatedGifUrl) URL.revokeObjectURL(generatedGifUrl);
    generatedGifUrl = null;
    if (resultImage) resultImage.removeAttribute("src");
    if (downloadLink) downloadLink.removeAttribute("href");
    if (resultSection) resultSection.hidden = true;
  }

  function displayGeneratedGif(blob, filename) {
    const nextUrl = URL.createObjectURL(blob);
    const previousUrl = generatedGifUrl;
    generatedGifUrl = nextUrl;
    resultImage.src = nextUrl;
    downloadLink.href = nextUrl;
    downloadLink.download = filename;
    resultSection.hidden = false;
    if (previousUrl) URL.revokeObjectURL(previousUrl);
  }

  function render() {
    if (!list) return;
    list.replaceChildren();
    entries.forEach((entry, index) => {
      const item = document.createElement("li");
      item.className = "experience-item " +
        (index < limit() ? "is-selected-for-video" : "is-outside-video");
      item.draggable = !isGenerating;
      item.dataset.experienceId = entry.id;

      const content = document.createElement("div");
      content.className = "experience-content";
      const title = document.createElement("div");
      title.className = "experience-title";
      title.textContent = entry.organization || entry.title;
      const dates = document.createElement("div");
      dates.className = "experience-date";
      dates.textContent = formatDates(entry);
      content.append(title, dates);

      if (index < limit()) {
        const badge = document.createElement("span");
        badge.className = "experience-video-badge";
        badge.textContent = "Video #" + (index + 1);
        content.append(badge);
      }
      item.append(makeLogo(entry), content);
      list.append(item);

      if (index === limit() - 1 && entries.length > limit()) {
        const divider = document.createElement("li");
        divider.className = "experience-selection-divider";
        divider.setAttribute("role", "presentation");
        const label = document.createElement("span");
        label.textContent = "Only the " + limit() + " item" + (limit() === 1 ? "" : "s") +
          " above " + (limit() === 1 ? "is" : "are") + " included in the video";
        divider.append(label);
        list.append(divider);
      }
    });
    updateGenerateControls();
  }

  function ensurePanel() {
    if (panel) return;
    installStyles();
    panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.setAttribute("aria-label", "LinkedMe panel");

    const header = document.createElement("div");
    header.className = "linkedme-panel-header";
    const title = document.createElement("h2");
    title.className = "linkedme-panel-title";
    title.textContent = "LinkedMe";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "linkedme-panel-close";
    close.setAttribute("aria-label", "Close LinkedMe panel");
    close.textContent = "\u00d7";
    header.append(title, close);

    const body = document.createElement("div");
    body.className = "linkedme-panel-body";
    const actions = document.createElement("div");
    actions.className = "linkedme-panel-actions";
    const extract = document.createElement("button");
    extract.type = "button";
    extract.textContent = "Extract";
    extract.disabled = typeof options.onExtractProfile !== "function";
    extract.setAttribute("aria-pressed", "true");
    const add = document.createElement("button");
    add.type = "button";
    add.className = "secondary";
    add.textContent = "Add New Job";
    actions.append(extract, add);

    status = document.createElement("p");
    status.className = "linkedme-panel-status";
    status.setAttribute("aria-live", "polite");

    const sectionHeader = document.createElement("div");
    sectionHeader.className = "recent-section-header";
    const headingGroup = document.createElement("div");
    headingGroup.className = "extracted-profile-heading";
    const heading = document.createElement("strong");
    heading.textContent = "Extracted profile";
    const info = document.createElement("span");
    info.className = "extracted-profile-info";
    const infoButton = document.createElement("button");
    infoButton.type = "button";
    infoButton.className = "extracted-profile-info-button";
    const infoIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    infoIcon.classList.add("extracted-profile-info-icon");
    infoIcon.setAttribute("viewBox", "0 0 16 16");
    infoIcon.setAttribute("aria-hidden", "true");
    infoIcon.setAttribute("focusable", "false");
    const infoDot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    infoDot.setAttribute("cx", "8");
    infoDot.setAttribute("cy", "3.5");
    infoDot.setAttribute("r", "1.5");
    const infoStem = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    infoStem.setAttribute("x", "6.5");
    infoStem.setAttribute("y", "6");
    infoStem.setAttribute("width", "3");
    infoStem.setAttribute("height", "7");
    infoStem.setAttribute("rx", "1.5");
    infoIcon.append(infoDot, infoStem);
    infoButton.append(infoIcon);
    infoButton.setAttribute("aria-label", "Information about extracted profile items");
    infoButton.setAttribute("aria-describedby", "linkedme-extracted-profile-tooltip");
    const tooltip = document.createElement("span");
    tooltip.id = "linkedme-extracted-profile-tooltip";
    tooltip.className = "extracted-profile-tooltip";
    tooltip.setAttribute("role", "tooltip");
    [
      "Only profile elements containing logos appear in this list.",
      "Only items visible on the initial LinkedIn page view are included.",
      "Any missing items can be added manually using the 'Add New Job' button.",
    ].forEach((message) => {
      const paragraph = document.createElement("p");
      paragraph.textContent = message;
      tooltip.append(paragraph);
    });
    info.append(infoButton, tooltip);
    headingGroup.append(heading, info);
    const label = document.createElement("label");
    label.className = "video-mode-toggle";
    modeText = document.createElement("span");
    modeText.textContent = "3-signs mode";
    modeToggle = document.createElement("input");
    modeToggle.type = "checkbox";
    modeToggle.id = "linkedme-single-item-video-mode";
    const track = document.createElement("span");
    track.className = "video-mode-toggle-track";
    const thumb = document.createElement("span");
    thumb.className = "video-mode-toggle-thumb";
    track.append(thumb);
    label.append(modeText, modeToggle, track);
    sectionHeader.append(headingGroup, label);

    list = document.createElement("ol");
    list.className = "experience-list";
    list.setAttribute("aria-live", "polite");

    generateButton = document.createElement("button");
    generateButton.type = "button";
    generateButton.id = "linkedme-generate-video";
    generateButton.textContent = "Generate";

    loadingSection = document.createElement("section");
    loadingSection.className = "generation-loading";
    loadingSection.hidden = true;
    loadingSection.setAttribute("role", "status");
    loadingSection.setAttribute("aria-live", "polite");
    const spinner = document.createElement("div");
    spinner.className = "generation-spinner";
    spinner.setAttribute("aria-hidden", "true");
    const loadingCopy = document.createElement("div");
    loadingCopy.className = "generation-loading-copy";
    const loadingTitle = document.createElement("div");
    loadingTitle.className = "generation-loading-title";
    loadingTitle.textContent = "Creating your GIF…";
    loadingProgressText = document.createElement("p");
    loadingProgressText.className = "generation-progress-text";
    loadingProgressText.textContent = "Loading assets…";
    loadingProgress = document.createElement("progress");
    loadingProgress.className = "generation-progress";
    loadingProgress.max = 100;
    loadingProgress.value = 0;
    loadingCopy.append(loadingTitle, loadingProgressText, loadingProgress);
    loadingSection.append(spinner, loadingCopy);

    resultSection = document.createElement("section");
    resultSection.className = "generation-result";
    resultSection.hidden = true;
    resultImage = document.createElement("img");
    resultImage.className = "generated-gif";
    resultImage.alt = "Generated LinkedMe animation with company logos";
    downloadLink = document.createElement("a");
    downloadLink.className = "download-gif";
    downloadLink.textContent = "Download GIF";
    resultSection.append(resultImage, downloadLink);

    body.append(actions, status, sectionHeader, list, generateButton,
      loadingSection, resultSection);
    panel.append(header, body);
    document.body.append(panel);
    makeDraggable(panel, header);

    close.addEventListener("click", () => {
      abortActiveGeneration();
      clearGeneratedResult();
      panel.remove();
    });

    if (typeof options.onExtractProfile === "function") {
      extract.addEventListener("click", async () => {
        extract.disabled = true;
        setStatus("Extracting profile data...");

        try {
          const response = await options.onExtractProfile();
          if (response?.type === "LINKEDME_EXTRACT_PROFILE_SUCCESS") {
            showProfile(
              response.payload,
              "Extraction completed."
            );
          } else {
            setStatus(response?.payload?.message || "Extraction failed.");
          }
        } catch (error) {
          setStatus(error instanceof Error ? error.message : "Extraction failed.");
        } finally {
          extract.disabled = false;
        }
      });
    }

    add.addEventListener("click", async () => {
      add.disabled = true;
      setStatus("Adding company...");
      try {
        const profile = await options.onAddNewJob();
        if (!profile?.data) {
          throw new Error("LinkedMe did not return the updated profile.");
        }
        const companyName = profile.data.experience?.[0]?.companyName || "company";
        showProfile(profile, "Added " + companyName + ".");
      } catch (error) {
        setStatus(
          error instanceof Error ? error.message : "Could not add the company.",
          true
        );
      } finally {
        add.disabled = false;
      }
    });
    modeToggle.addEventListener("change", () => {
      if (isGenerating) return;
      mode = modeToggle.checked ? "one" : "three";
      modeText.textContent = mode === "one" ? "1-sign mode" : "3-signs mode";
      clearGeneratedResult();
      render();
    });
    generateButton.addEventListener("click", handleGenerate);
    list.addEventListener("dragstart", (event) => {
      if (isGenerating) {
        event.preventDefault();
        return;
      }
      const item = event.target.closest(".experience-item");
      if (!item) return;
      draggedId = item.dataset.experienceId;
      item.classList.add("is-dragging");
      event.dataTransfer?.setData("text/plain", draggedId);
    });
    list.addEventListener("dragover", (event) => {
      const item = event.target.closest(".experience-item");
      if (!item || item.dataset.experienceId === draggedId) return;
      event.preventDefault();
      item.classList.add("is-drop-target");
    });
    list.addEventListener("dragleave", (event) =>
      event.target.closest(".experience-item")?.classList.remove("is-drop-target"));
    list.addEventListener("drop", (event) => {
      if (isGenerating) return;
      const target = event.target.closest(".experience-item");
      if (!target) return;
      event.preventDefault();
      const sourceId = event.dataTransfer?.getData("text/plain") || draggedId;
      const a = entries.findIndex((entry) => entry.id === sourceId);
      const b = entries.findIndex((entry) => entry.id === target.dataset.experienceId);
      if (a >= 0 && b >= 0) [entries[a], entries[b]] = [entries[b], entries[a]];
      render();
    });
    list.addEventListener("dragend", () => {
      draggedId = null;
      list.querySelectorAll(".experience-item").forEach((item) =>
        item.classList.remove("is-dragging", "is-drop-target"));
    });
    window.addEventListener("pagehide", () => {
      abortActiveGeneration();
      clearGeneratedResult();
    }, { once: true });
  }

  async function handleGenerate() {
    if (isGenerating) return;
    const template = selectTemplate(mode);
    const selectedEntries = entries.slice(0, template.logoCount);
    if (selectedEntries.length !== template.logoCount) {
      setStatus("Select " + template.logoCount + " experience" +
        (template.logoCount === 1 ? "" : "s") + " before creating.", true);
      return;
    }

    const session = {
      controller: new AbortController(),
      cleaned: false,
      logos: [],
      video: null,
      videoUrl: null,
      canvas: null,
      workerClient: null,
    };
    activeGeneration = session;
    isGenerating = true;
    setStatus("Creating your GIF…");
    showLoadingState("Loading assets…", 0);
    updateGenerateControls();

    try {
      const tracking = await loadTrackingData(template, session.controller.signal);
      updateProgress("Loading LinkedIn logos…", 3);
      session.logos = await loadLogoImages(selectedEntries, session.controller.signal);
      updateProgress("Loading video template…", 6);
      const videoResource = await loadVideo(template, session.controller.signal);
      session.video = videoResource.video;
      session.videoUrl = videoResource.videoUrl;
      const trackingIndex = buildTrackingIndex(tracking);

      const canvas = document.createElement("canvas");
      canvas.width = tracking.video.width;
      canvas.height = tracking.video.height;
      session.canvas = canvas;
      const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
      if (!context) throw new Error("Chrome could not create the GIF rendering canvas.");

      updateProgress("Starting GIF encoder…", 9);
      session.workerClient = await createGifWorkerClient(session.controller.signal);

      for (let frameIndex = 0; frameIndex < OUTPUT_FRAME_COUNT; frameIndex += 1) {
        throwIfAborted(session.controller.signal);
        updateProgress("Rendering frame " + (frameIndex + 1) + " of " +
          OUTPUT_FRAME_COUNT + "…", 10 + (frameIndex / OUTPUT_FRAME_COUNT) * 85);
        await seekVideoToFrame(session.video, frameIndex, session.controller.signal);
        context.drawImage(session.video, 0, 0, canvas.width, canvas.height);
        drawTrackedLogos(context, session.logos, tracking, trackingIndex,
          template.signOrder, frameIndex);
        const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
        await session.workerClient.encodeFrame(frameIndex, rgba, gifFrameDelay(frameIndex));
      }

      updateProgress("Finalizing GIF…", 97);
      const gifBuffer = await session.workerClient.finish();
      assertGifBytes(gifBuffer);
      throwIfAborted(session.controller.signal);
      if (activeGeneration !== session) return;

      const gifBlob = new Blob([gifBuffer], { type: "image/gif" });
      displayGeneratedGif(gifBlob, generatedFilename(template));
      updateProgress("Your GIF is ready.", 100);
      setStatus("Your GIF is ready.");
    } catch (error) {
      if (error?.name !== "AbortError" && activeGeneration === session) {
        setStatus("Could not create GIF: " +
          (error instanceof Error ? error.message : "Unexpected generation failure."), true);
      }
    } finally {
      cleanupGenerationResources(session);
      if (activeGeneration === session) {
        activeGeneration = null;
        isGenerating = false;
        hideLoadingState();
        updateGenerateControls();
      }
    }
  }

  function showProfile(profile, message) {
    ensurePanel();
    if (!panel.isConnected) document.body.append(panel);
    abortActiveGeneration();
    clearGeneratedResult();
    entries = normalizeEntries(profile);
    render();
    setStatus(message || "Extraction completed.");
  }

  function applyStatus(message) {
    if (message?.type !== "LINKEDME_STATUS_UPDATE") return;
    const payload = message.payload || {};
    if ((payload.status === "completed" || payload.status === "manual-job-added") && payload.profile) {
      showProfile(payload.profile, payload.status === "manual-job-added" ?
        "New job added." : "Extraction completed.");
    }
  }

  return { showProfile, applyStatus };
}

export { createFloatingPanelController, normalizeEntries, trackingSampleAtFrame };

