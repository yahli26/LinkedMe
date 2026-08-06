import {
  cleanText,
  findSectionScope,
  getConsolidatedDateRange,
  getLogoUrlCandidates,
  getTextRows,
  isOngoingDate,
  parseHtml,
  sortEntriesChronologically,
} from "./linkedinParsing.js";

const ENTITY_ITEM_SELECTOR = '[componentkey^="entity-collection-item"]';
const EXPERIENCE_ITEM_SELECTOR = `${ENTITY_ITEM_SELECTOR}, [role="listitem"]`;
const COMPANY_LINK_SELECTOR = [
  'a[href*="/company/"]',
  'a[href*="/school/"]',
  'a[href*="/showcase/"]',
  'a[href*="/organization/"]',
].join(', ');
const MAX_CONSECUTIVE_ROLE_GAP_MONTHS = 3;
const EXPERIENCE_SECTION_SELECTOR =
  '[componentkey*="ExperienceTopLevelSection"]';
const EXPERIENCE_HEADING_PATTERN = /^experience(?:\s*\(\d+\))?$/i;

function getPrimaryLineText(value) {
  return cleanText((value || "").split(/\s*[\u00b7\u2022]\s*/u, 1)[0]);
}

function getGroupedRoleItems(item) {
  const roleLists = [...item.querySelectorAll("ul")].filter(
    (list) =>
      list.closest(ENTITY_ITEM_SELECTOR) === item &&
      !list.parentElement?.closest("li")
  );

  for (const roleList of roleLists) {
    const listItems = [...roleList.children].filter((child) =>
      child.matches("li")
    );
    const datedRoleItems = listItems.filter(
      (roleItem) => getTextRows(roleItem).length >= 2
    );

    if (datedRoleItems.length > 0 && datedRoleItems.length === listItems.length) {
      return datedRoleItems;
    }
  }

  return [];
}

function getGroupedCompanyName(item, roleItems) {
  const companyLink = [...item.querySelectorAll(COMPANY_LINK_SELECTOR)].find(
    (link) =>
      !roleItems.some((roleItem) => roleItem.contains(link)) &&
      getTextRows(link).length > 0
  );
  const companyRows = companyLink ? getTextRows(companyLink) : [];
  const companyHeading = [...item.querySelectorAll("p")].find(
    (paragraph) => !roleItems.some((roleItem) => roleItem.contains(paragraph))
  );

  return getPrimaryLineText(
    companyRows[0] ||
      companyHeading?.textContent ||
      getTextRows(item)[0] ||
      ""
  );
}

export function isOngoingExperience(entry) {
  return isOngoingDate(entry?.endDate);
}

function getExperienceMonthIndex(value) {
  const match = /^(\d{4})[/-](\d{1,2})$/.exec((value || "").trim());

  if (!match) return null;

  const month = Number.parseInt(match[2], 10);

  if (month < 1 || month > 12) return null;

  return Number.parseInt(match[1], 10) * 12 + month - 1;
}

function getChronologicalRoles(left, right) {
  const leftStartMonth = getExperienceMonthIndex(left.startDate);
  const rightStartMonth = getExperienceMonthIndex(right.startDate);

  if (leftStartMonth === null || rightStartMonth === null) return null;

  return leftStartMonth >= rightStartMonth
    ? {
        newer: left,
        newerStartMonth: leftStartMonth,
        older: right,
      }
    : {
        newer: right,
        newerStartMonth: rightStartMonth,
        older: left,
      };
}

function getRoleGapInMonths(chronologicalRoles) {
  if (isOngoingExperience(chronologicalRoles.older)) return 0;

  const olderEndMonth = getExperienceMonthIndex(
    chronologicalRoles.older.endDate
  );

  if (olderEndMonth === null) return null;

  return Math.max(0, chronologicalRoles.newerStartMonth - olderEndMonth);
}

function getLatestEndDate(left, right) {
  if (isOngoingExperience(left)) return left.endDate;
  if (isOngoingExperience(right)) return right.endDate;

  const leftEndMonth = getExperienceMonthIndex(left.endDate);
  const rightEndMonth = getExperienceMonthIndex(right.endDate);

  if (leftEndMonth === null) return right.endDate || left.endDate;
  if (rightEndMonth === null) return left.endDate || right.endDate;

  return leftEndMonth >= rightEndMonth ? left.endDate : right.endDate;
}

function mergeRoleEntries(chronologicalRoles) {
  const { newer, older } = chronologicalRoles;
  const logoUrlCandidates = [
    ...(newer.logoUrlCandidates || []),
    ...(older.logoUrlCandidates || []),
  ];

  return {
    ...newer,
    startDate: older.startDate,
    endDate: getLatestEndDate(newer, older),
    logoUrl: newer.logoUrl || older.logoUrl || "",
    logoUrlCandidates: [...new Set(logoUrlCandidates)],
  };
}

export function mergeConsecutiveSameCompanyExperience(entries) {
  return entries.reduce((mergedEntries, entry) => {
    const previousEntry = mergedEntries.at(-1);

    if (
      !previousEntry?.companyName ||
      previousEntry.companyName !== entry.companyName
    ) {
      mergedEntries.push(entry);
      return mergedEntries;
    }

    const chronologicalRoles = getChronologicalRoles(previousEntry, entry);
    const gapInMonths = chronologicalRoles
      ? getRoleGapInMonths(chronologicalRoles)
      : null;

    if (
      gapInMonths === null ||
      gapInMonths > MAX_CONSECUTIVE_ROLE_GAP_MONTHS
    ) {
      mergedEntries.push(entry);
      return mergedEntries;
    }

    mergedEntries[mergedEntries.length - 1] = mergeRoleEntries(
      chronologicalRoles
    );
    return mergedEntries;
  }, []);
}

export function orderExperienceEntries(entries) {
  return sortEntriesChronologically(entries);
}

export function extractExperience(html, debugState = null) {
  const doc = parseHtml(html);
  const { root, matchSource } = findSectionScope(doc, {
    componentSelector: EXPERIENCE_SECTION_SELECTOR,
    headingPattern: EXPERIENCE_HEADING_PATTERN,
    itemSelector: EXPERIENCE_ITEM_SELECTOR,
  });
  const entityItems = [...root.querySelectorAll(ENTITY_ITEM_SELECTOR)];
  const candidateItems = [...root.querySelectorAll(EXPERIENCE_ITEM_SELECTOR)];
  const topLevelItems = candidateItems.filter(
    (item) => !item.parentElement?.closest(EXPERIENCE_ITEM_SELECTOR)
  );
  const editLinkItems = candidateItems.filter((item) =>
    item.querySelector('a[href*="/edit/forms/position/"]')
  );
  const items = topLevelItems.filter(
    (item) => getLogoUrlCandidates(item).length > 0
  );

  debugState?.extractorResults &&
    (debugState.extractorResults.experience = {
      htmlLength: html.length,
      sectionMatchSource: matchSource,
      entityCollectionItems: entityItems.length,
      topLevelEntityCollectionItems: topLevelItems.length,
      itemsWithPositionEditLink: editLinkItems.length,
      selectedItems: items.length,
      itemsWithImageAndDate: items.filter(
        (item) => getLogoUrlCandidates(item).length > 0
      ).length,
      note:
        items.length === 0
          ? "No experience items with a logo were found in the selected HTML."
          : null,
    });

  const entries = items.flatMap((item) => {
    const groupedRoleItems = getGroupedRoleItems(item);
    const logoUrlCandidates = getLogoUrlCandidates(item);

    if (groupedRoleItems.length > 0) {
      const companyName = getGroupedCompanyName(item, groupedRoleItems);

      return groupedRoleItems.map((roleItem) => {
        const rows = getTextRows(roleItem);
        const { startDate, endDate } = getConsolidatedDateRange(roleItem);

        return {
          title: rows[0] || "",
          companyName,
          startDate,
          endDate,
          logoUrl: logoUrlCandidates[0] || "",
          logoUrlCandidates,
        };
      });
    }

    const rows = getTextRows(item);
    const companyLine = rows[1] || "";
    const { startDate, endDate } = getConsolidatedDateRange(item);

    return {
      title: rows[0] || "",
      companyName: getPrimaryLineText(companyLine),
      startDate,
      endDate,
      logoUrl: logoUrlCandidates[0] || "",
      logoUrlCandidates,
    };
  });

  return orderExperienceEntries(
    mergeConsecutiveSameCompanyExperience(entries)
  );
}
