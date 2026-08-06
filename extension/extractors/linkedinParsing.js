const MONTHS = {
  jan: "01",
  january: "01",
  feb: "02",
  february: "02",
  mar: "03",
  march: "03",
  apr: "04",
  april: "04",
  may: "05",
  jun: "06",
  june: "06",
  jul: "07",
  july: "07",
  aug: "08",
  august: "08",
  sep: "09",
  sept: "09",
  september: "09",
  oct: "10",
  october: "10",
  nov: "11",
  november: "11",
  dec: "12",
  december: "12",
};

const LOGO_LINK_SELECTORS = [
  'a[href*="/company/"]',
  'a[href*="/school/"]',
  'a[href*="/showcase/"]',
  'a[href*="/organization/"]',
];
const LINKED_LOGO_IMAGE_SELECTOR = LOGO_LINK_SELECTORS
  .map((selector) => `${selector} figure img`)
  .join(", ");
const ONGOING_DATE_PATTERN = /^(?:present|until now|current|ongoing)$/i;
const PROFILE_ITEM_BOUNDARY_SELECTOR =
  '[componentkey^="entity-collection-item"], [role="listitem"]';

export function parseHtml(html) {
  return new DOMParser().parseFromString(html, "text/html");
}

export function cleanText(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

export function isOngoingDate(value) {
  return ONGOING_DATE_PATTERN.test(cleanText(value));
}

function getDateSortValue(value) {
  const match = /^(\d{4})(?:[/-](\d{1,2}))?$/.exec(cleanText(value));

  if (!match) return -1;

  const month = Number.parseInt(match[2] || "1", 10);
  if (month < 1 || month > 12) return -1;

  return Number.parseInt(match[1], 10) * 12 + month - 1;
}

export function sortEntriesChronologically(entries) {
  return entries
    .map((entry, sourceIndex) => ({ entry, sourceIndex }))
    .sort((left, right) => {
      const leftIsOngoing = isOngoingDate(left.entry?.endDate);
      const rightIsOngoing = isOngoingDate(right.entry?.endDate);

      if (leftIsOngoing && rightIsOngoing) {
        return left.sourceIndex - right.sourceIndex;
      }

      if (leftIsOngoing !== rightIsOngoing) {
        return leftIsOngoing ? -1 : 1;
      }

      return (
        getDateSortValue(right.entry?.endDate) -
          getDateSortValue(left.entry?.endDate) ||
        getDateSortValue(right.entry?.startDate) -
          getDateSortValue(left.entry?.startDate) ||
        left.sourceIndex - right.sourceIndex
      );
    })
    .map(({ entry }) => entry);
}

function getSectionHeadings(root) {
  return [...root.querySelectorAll("h1, h2, h3")];
}

export function findSectionScope(
  doc,
  { componentSelector, headingPattern, itemSelector }
) {
  const componentRoot = componentSelector
    ? [...doc.querySelectorAll(componentSelector)].find((candidate) =>
        [...candidate.querySelectorAll("h1, h2, h3")].some((heading) =>
          headingPattern.test(cleanText(heading.textContent))
        )
      ) || doc.querySelector(componentSelector)
    : null;

  if (componentRoot) {
    return { root: componentRoot, matchSource: "componentkey" };
  }

  const heading = [...doc.querySelectorAll("h1, h2, h3")].find((node) =>
    headingPattern.test(cleanText(node.textContent))
  );

  if (!heading) {
    return { root: doc, matchSource: "document" };
  }

  const semanticRoot = heading.closest("section, article");
  if (semanticRoot) {
    return { root: semanticRoot, matchSource: "heading" };
  }

  let current = heading.parentElement;
  while (current && current !== doc.body && current !== doc.documentElement) {
    const sectionHeadings = getSectionHeadings(current);
    if (
      current.querySelector(itemSelector) &&
      sectionHeadings.length === 1 &&
      sectionHeadings[0] === heading
    ) {
      return { root: current, matchSource: "heading-container" };
    }
    current = current.parentElement;
  }

  const headings = [...doc.querySelectorAll("h1, h2, h3")];
  const nextHeading = headings[headings.indexOf(heading) + 1] || null;
  const followingPosition = doc.defaultView?.Node.DOCUMENT_POSITION_FOLLOWING || 4;
  const rangedItems = [...doc.querySelectorAll(itemSelector)].filter(
    (item) =>
      Boolean(heading.compareDocumentPosition(item) & followingPosition) &&
      (!nextHeading ||
        Boolean(item.compareDocumentPosition(nextHeading) & followingPosition))
  );
  const topLevelRangedItems = rangedItems.filter(
    (item) =>
      !rangedItems.some(
        (possibleParent) => possibleParent !== item && possibleParent.contains(item)
      )
  );

  if (topLevelRangedItems.length > 0) {
    const rangeRoot = doc.createElement("div");
    topLevelRangedItems.forEach((item) => rangeRoot.append(item.cloneNode(true)));
    return { root: rangeRoot, matchSource: "heading-range" };
  }

  return { root: doc, matchSource: "document" };
}

function parseMonthYear(value) {
  const text = cleanText(value).toLowerCase();
  const match = text.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t)?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{4})\b/i
  );

  if (!match) return "";

  return `${match[2]}/${MONTHS[match[1].toLowerCase()]}`;
}

function parseYear(value) {
  return cleanText(value).match(/\b(\d{4})\b/)?.[1] || "";
}

function parseDateValue(value) {
  return parseMonthYear(value) || parseYear(value);
}

export function parseDateRange(rawDateText) {
  const dateRangeText = cleanText(rawDateText)
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .split("·")[0]
    .trim();

  const [rawStartDate = "", rawEndDate = ""] = dateRangeText
    .split(/\s*-\s*|\s+to\s+/i, 2)
    .map(cleanText);

  return {
    startDate: parseDateValue(rawStartDate),
    endDate: isOngoingDate(rawEndDate)
      ? "Present"
      : parseDateValue(rawEndDate),
  };
}

export function looksLikeDateRange(text) {
  const normalizedText = cleanText(text);
  const hasMonthAndYear =
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{4}\b/i.test(
      normalizedText
    );
  const hasYearRange =
    /\b\d{4}\s*[-\u2010-\u2015\u2212]\s*(?:\d{4}|present|until now|current|ongoing)\b/i.test(
      normalizedText
    ) ||
    /\b\d{4}\s+to\s+(?:\d{4}|present|until now|current|ongoing)\b/i.test(
      normalizedText
    );

  return hasMonthAndYear || hasYearRange || /^\d{4}$/.test(normalizedText);
}

export function getDateText(item) {
  const hiddenDateText = [...item.querySelectorAll("span.visually-hidden")]
    .map((node) => cleanText(node.textContent))
    .find(looksLikeDateRange);

  if (hiddenDateText) return hiddenDateText;

  return (
    [...item.querySelectorAll("p, span")]
      .map((node) => cleanText(node.textContent))
      .find(looksLikeDateRange) || ""
  );
}

export function getConsolidatedDateRange(item) {
  const dateRanges = [...item.querySelectorAll("p, span")]
    .map((node) => cleanText(node.textContent))
    .filter(looksLikeDateRange)
    .map(parseDateRange)
    .filter(({ startDate }) => startDate);

  if (dateRanges.length === 0) {
    return parseDateRange(getDateText(item));
  }

  const startDate = dateRanges
    .map((range) => range.startDate)
    .sort()[0];
  const endDates = dateRanges
    .map((range) => range.endDate)
    .filter(Boolean);
  const endDate = endDates.includes("Present")
    ? "Present"
    : endDates.sort().at(-1) || "";

  return { startDate, endDate };
}

function normalizeImageUrl(url) {
  if (!url) return "";

  try {
    return new URL(url, "https://www.linkedin.com").href;
  } catch (_error) {
    return url;
  }
}

function isUsableLogoUrl(url) {
  return Boolean(
    url &&
      !url.startsWith("data:") &&
      !url.startsWith("blob:") &&
      !/data:image\/gif/i.test(url)
  );
}

function parseImageCandidateAttribute(value) {
  const normalizedValue = normalizeImageUrl(value);

  if (!isUsableLogoUrl(normalizedValue)) {
    return [];
  }

  return [normalizedValue];
}

function parseSrcset(srcset) {
  return (srcset || "")
    .split(",")
    .map((candidate) => {
      const [url = "", descriptor = ""] = candidate.trim().split(/\s+/, 2);
      const width = Number.parseInt(descriptor.replace(/[^0-9]/g, ""), 10) || 0;

      return { url: normalizeImageUrl(url), width };
    })
    .filter(({ url }) => isUsableLogoUrl(url))
    .sort((left, right) => right.width - left.width)
    .map(({ url }) => url);
}

function createLinkedInHighResolutionCandidates(url) {
  if (!url || !/media\.licdn\.com/i.test(url)) {
    return [];
  }

  const variants = new Set();
  const sizeReplacements = ["800_800", "400_400", "300_300", "200_200"];

  sizeReplacements.forEach((size) => {
    variants.add(url.replace(/company-logo_\d+_\d+/g, `company-logo_${size}`));
    variants.add(url.replace(/school-logo_\d+_\d+/g, `school-logo_${size}`));
    variants.add(url.replace(/organization-logo_\d+_\d+/g, `organization-logo_${size}`));
    variants.add(url.replace(/img-crop_\d+/g, `img-crop_${size.split("_")[0]}`));
  });

  return [...variants].filter((variant) => variant !== url);
}

function dedupe(values) {
  return [...new Set(values.filter(Boolean))];
}

function findLogoImage(item) {
  const linkedLogoImage = item.querySelector(LINKED_LOGO_IMAGE_SELECTOR);

  if (linkedLogoImage) {
    return linkedLogoImage;
  }

  return [...item.querySelectorAll("figure img")].find((image) =>
    /logo/i.test(image.getAttribute("alt") || image.closest("figure")?.textContent || "")
  );
}

export function getLogoUrlCandidates(item) {
  const logoImage = findLogoImage(item);

  if (!logoImage) {
    return [];
  }

  const lazyCandidates = [
    ...parseSrcset(logoImage.getAttribute("srcset")),
    ...parseSrcset(logoImage.getAttribute("data-srcset")),
    ...parseImageCandidateAttribute(logoImage.currentSrc),
    ...parseImageCandidateAttribute(logoImage.getAttribute("data-delayed-url")),
    ...parseImageCandidateAttribute(logoImage.getAttribute("data-ghost-url")),
    ...parseImageCandidateAttribute(logoImage.getAttribute("data-src")),
  ];
  const rawCandidates = [
    ...lazyCandidates,
    ...parseImageCandidateAttribute(logoImage.getAttribute("src")),
  ];
  const highResolutionCandidates = rawCandidates.flatMap(createLinkedInHighResolutionCandidates);

  return dedupe([...rawCandidates, ...highResolutionCandidates]);
}

export function getTextRows(item) {
  const paragraphRows = [...item.querySelectorAll("p")]
    .map((node) => cleanText(node.textContent))
    .filter(Boolean);

  if (paragraphRows.length >= 2) {
    return paragraphRows;
  }

  return [...item.querySelectorAll("span[aria-hidden='true'], span")]
    .map((node) => cleanText(node.textContent))
    .filter((text, index, rows) => text && rows.indexOf(text) === index);
}

function findSmallestItemRoot(dateNode) {
  let current = dateNode.parentElement;
  let fallbackItem = null;

  while (current && current.ownerDocument?.body !== current) {
    if (
      getDateText(current) &&
      getTextRows(current).length >= 2 &&
      !current.querySelector("h1, h2")
    ) {
      fallbackItem ||= current;
      if (
        current.matches(PROFILE_ITEM_BOUNDARY_SELECTOR) ||
        current.querySelector("img")
      ) {
        return current;
      }
    }

    current = current.parentElement;
  }

  return fallbackItem;
}

function isDuplicateItem(items, candidate) {
  return items.some((item) => item === candidate || item.contains(candidate));
}

export function getDateBasedItems(doc) {
  const dateNodes = [...doc.querySelectorAll("p, span")].filter((node) =>
    looksLikeDateRange(node.textContent)
  );
  const items = [];

  dateNodes.forEach((dateNode) => {
    const item = findSmallestItemRoot(dateNode);

    if (!item || isDuplicateItem(items, item)) {
      return;
    }

    items.push(item);
  });

  return items;
}
