import {
  findSectionScope,
  getDateBasedItems,
  getDateText,
  getLogoUrlCandidates,
  getTextRows,
  parseDateRange,
  parseHtml,
  sortEntriesChronologically,
} from "./linkedinParsing.js";

const EDUCATION_SECTION_SELECTOR =
  '[componentkey*="EducationTopLevelSection"]';
const EDUCATION_HEADING_PATTERN = /^education(?:\s*\(\d+\))?$/i;
const PROFILE_ITEM_SELECTOR =
  '[componentkey^="entity-collection-item"], [role="listitem"]';
const EDUCATION_LINK_SELECTOR = [
  'a[href*="/details/education/edit/forms/"]',
  'a[href*="/school/"]',
].join(", ");
const EDUCATION_SCOPE_ITEM_SELECTOR = [
  PROFILE_ITEM_SELECTOR,
  EDUCATION_LINK_SELECTOR,
].join(", ");

function isEducationItemCandidate(item) {
  return (
    getTextRows(item).length >= 1 &&
    !item.querySelector("h1, h2, h3")
  );
}

function findEducationItemRoot(link, sectionRoot) {
  let current = link;
  let textFallback = null;

  while (current && current !== sectionRoot) {
    if (isEducationItemCandidate(current)) {
      textFallback ||= current;

      const componentKey = current.getAttribute("componentkey") || "";
      const isItemComponent =
        componentKey &&
        !/EducationTopLevelSection|ProfileNullStateCardAnchor_Education/i.test(
          componentKey
        );

      if (current.matches(PROFILE_ITEM_SELECTOR) || isItemComponent) {
        return current;
      }
    }

    current = current.parentElement;
  }

  return textFallback;
}

function appendDistinctItem(items, candidate) {
  if (
    !candidate ||
    items.some(
      (item) =>
        item === candidate ||
        item.contains(candidate) ||
        candidate.contains(item)
    )
  ) {
    return;
  }

  items.push(candidate);
}

function getEducationItems(root, dateBasedItems) {
  const items = [];
  const boundaryItems = [...root.querySelectorAll(PROFILE_ITEM_SELECTOR)]
    .filter(isEducationItemCandidate)
    .filter(
      (item, _index, candidates) =>
        !candidates.some(
          (possibleParent) =>
            possibleParent !== item && possibleParent.contains(item)
        )
    );
  const linkedItems = [...root.querySelectorAll(EDUCATION_LINK_SELECTOR)]
    .filter(isEducationItemCandidate)
    .map((link) => findEducationItemRoot(link, root));

  [...linkedItems, ...boundaryItems, ...dateBasedItems].forEach(
    (item) => appendDistinctItem(items, item)
  );

  return items;
}

export function extractEducation(html, debugState = null) {
  const doc = parseHtml(html);
  const { root, matchSource } = findSectionScope(doc, {
    componentSelector: EDUCATION_SECTION_SELECTOR,
    headingPattern: EDUCATION_HEADING_PATTERN,
    itemSelector: EDUCATION_SCOPE_ITEM_SELECTOR,
  });
  const editAnchors = [
    ...root.querySelectorAll('a[href*="/details/education/edit/forms/"]'),
  ];
  const dateBasedItems = getDateBasedItems(root);
  const items = getEducationItems(root, dateBasedItems).filter(
    (item) => getLogoUrlCandidates(item).length > 0
  );

  debugState?.extractorResults &&
    (debugState.extractorResults.education = {
      htmlLength: html.length,
      sectionMatchSource: matchSource,
      editAnchorCandidates: editAnchors.length,
      dateBasedItems: dateBasedItems.length,
      selectedItems: items.length,
      itemsWithImageAndDate: items.filter(
        (item) =>
          Boolean(getDateText(item)) && getLogoUrlCandidates(item).length > 0
      ).length,
      note:
        items.length === 0
          ? "No education items with a logo were found in the selected HTML."
          : null,
    });

  const entries = items.map((item) => {
    const rows = getTextRows(item);
    const { startDate, endDate } = parseDateRange(getDateText(item));
    const logoUrlCandidates = getLogoUrlCandidates(item);

    return {
      institutionName: rows[0] || "",
      degree: rows[1] || "",
      startDate,
      endDate,
      logoUrl: logoUrlCandidates[0] || "",
      logoUrlCandidates,
    };
  });

  return sortEntriesChronologically(entries);
}
