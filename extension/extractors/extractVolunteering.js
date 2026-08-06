import {
  findSectionScope,
  getDateText,
  getLogoUrlCandidates,
  getTextRows,
  parseDateRange,
  parseHtml,
  sortEntriesChronologically,
} from "./linkedinParsing.js";

const VOLUNTEERING_SECTION_SELECTOR =
  '[componentkey*="VolunteerExperienceTopLevel"]';
const VOLUNTEERING_HEADING_PATTERN = /^volunteering(?:\s*\(\d+\))?$/i;
const VOLUNTEERING_ITEM_SELECTOR = '[role="listitem"]';

export function extractVolunteering(html, debugState = null) {
  const doc = parseHtml(html);
  const { root, matchSource } = findSectionScope(doc, {
    componentSelector: VOLUNTEERING_SECTION_SELECTOR,
    headingPattern: VOLUNTEERING_HEADING_PATTERN,
    itemSelector: VOLUNTEERING_ITEM_SELECTOR,
  });
  const listItems = [...root.querySelectorAll(VOLUNTEERING_ITEM_SELECTOR)];
  const topLevelListItems = listItems.filter(
    (item) => !item.parentElement?.closest(VOLUNTEERING_ITEM_SELECTOR)
  );
  const editLinkItems = listItems.filter((item) =>
    item.querySelector('a[href*="/details/volunteer-experiences/edit/forms/"]')
  );
  const items = topLevelListItems.filter(
    (item) => getLogoUrlCandidates(item).length > 0
  );

  debugState?.extractorResults &&
    (debugState.extractorResults.volunteering = {
      htmlLength: html.length,
      sectionMatchSource: matchSource,
      listItems: listItems.length,
      itemsWithVolunteerEditLink: editLinkItems.length,
      selectedItems: items.length,
      itemsWithImageAndDate: items.filter(
        (item) => getLogoUrlCandidates(item).length > 0
      ).length,
      note:
        items.length === 0
          ? "No volunteering items with a logo were found in the selected HTML."
          : null,
    });

  const entries = items.map((item) => {
    const rows = getTextRows(item);
    const { startDate, endDate } = parseDateRange(getDateText(item));
    const logoUrlCandidates = getLogoUrlCandidates(item);

    return {
      role: rows[0] || "",
      organizationName: rows[1] || "",
      startDate,
      endDate,
      logoUrl: logoUrlCandidates[0] || "",
      logoUrlCandidates,
    };
  });

  return sortEntriesChronologically(entries);
}
