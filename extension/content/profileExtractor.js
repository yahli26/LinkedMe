import { extractEducation } from "../extractors/extractEducation.js";
import { extractExperience } from "../extractors/extractExperience.js";
import { extractVolunteering } from "../extractors/extractVolunteering.js";

const SECTION_SELECTORS = {
  education: '[componentkey*="EducationTopLevelSection"]',
  experience: '[componentkey*="ExperienceTopLevelSection"]',
  volunteering: '[componentkey*="VolunteerExperienceTopLevel"]',
};

const SECTION_HEADINGS = {
  education: /^education(?:\s*\(\d+\))?$/i,
  experience: /^experience(?:\s*\(\d+\))?$/i,
  volunteering: /^volunteering(?:\s*\(\d+\))?$/i,
};

const SECTION_ANCHOR_SELECTORS = {
  education: '[componentkey*="profile_education_top_anchor"]',
  experience:
    '[componentkey*="profile_experience_top_anchor"], [componentkey*="CardAnchor_Experience"]',
  volunteering: '[componentkey*="VolunteerExperienceTopLevel"], [componentkey*="profile_volunteer"]',
};

const SECTION_ITEM_SELECTOR =
  '[componentkey^="entity-collection-item"], [role="listitem"]';

const PROFILE_SECTIONS = ["education", "experience", "volunteering"];

function getDirectText(node) {
  return [...node.childNodes]
    .filter((child) => child.nodeType === 3)
    .map((child) => child.textContent || "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function findNearestSection(node, sectionName) {
  let current = node;

  while (current && current !== document.body) {
    if (current.matches?.("section, article")) {
      return current;
    }

    if (current.querySelector?.(SECTION_ITEM_SELECTOR)) {
      const sectionHeadings = [...current.querySelectorAll("h1, h2, h3")]
        .map((heading) => getDirectText(heading) || heading.textContent?.trim() || "")
        .filter(Boolean);

      if (
        sectionHeadings.length === 1 &&
        SECTION_HEADINGS[sectionName].test(sectionHeadings[0])
      ) {
        return current;
      }
    }

    current = current.parentElement;
  }

  return null;
}

function findSectionByHeading(sectionName) {
  const headingPattern = SECTION_HEADINGS[sectionName];
  const candidates = [
    ...document.querySelectorAll(
      "h1, h2, h3, span[aria-hidden='true'], span, div"
    ),
  ];
  const heading = candidates.find((node) =>
    headingPattern.test(getDirectText(node) || (node.textContent || "").trim())
  );

  return {
    section: heading ? findNearestSection(heading, sectionName) : null,
    matchSource: heading ? "heading" : null,
    headingText: heading?.textContent?.trim() || null,
  };
}

function findSectionByAnchor(sectionName) {
  const anchor = document.querySelector(SECTION_ANCHOR_SELECTORS[sectionName]);

  return {
    section: anchor ? findNearestSection(anchor, sectionName) : null,
    matchSource: anchor ? "anchor" : null,
    headingText:
      anchor
        ?.closest("section, article")
        ?.querySelector("h1, h2, h3, span")
        ?.textContent?.trim() || null,
  };
}

function findSection(sectionName) {
  const componentSection = document.querySelector(SECTION_SELECTORS[sectionName]);

  if (componentSection) {
    return {
      section: componentSection,
      matchSource: "componentkey",
      headingText:
        componentSection.querySelector("h1, h2, h3, span")?.textContent?.trim() ||
        null,
    };
  }

  const anchorMatch = findSectionByAnchor(sectionName);

  if (anchorMatch.section) {
    return anchorMatch;
  }

  return findSectionByHeading(sectionName);
}

function getSectionHtml(sectionName) {
  return findSection(sectionName).section?.outerHTML || "";
}

function getRequestedSections(sections = []) {
  return sections.length
    ? sections.filter((sectionName) => PROFILE_SECTIONS.includes(sectionName))
    : [...PROFILE_SECTIONS];
}

export function getProfileSectionLoadState(sections = []) {
  const requestedSections = getRequestedSections(sections);
  const loadedSections = requestedSections.filter(
    (sectionName) => Boolean(findSection(sectionName).section)
  );

  return {
    requestedSections,
    loadedSections,
    missingSections: requestedSections.filter(
      (sectionName) => !loadedSections.includes(sectionName)
    ),
  };
}

export function deduplicateProfileData(data) {
  return Object.fromEntries(
    PROFILE_SECTIONS.map((category) => [
      category,
      [...(data[category] || [])],
    ])
  );
}

function countItems(data) {
  return {
    education: data.education.length,
    experience: data.experience.length,
    volunteering: data.volunteering.length,
  };
}

export function extractLinkedInProfile(sections = []) {
  const selectedSections = new Set(getRequestedSections(sections));
  const extractedData = {
    education: selectedSections.has("education")
      ? extractEducation(getSectionHtml("education"))
      : [],
    experience: selectedSections.has("experience")
      ? extractExperience(getSectionHtml("experience"))
      : [],
    volunteering: selectedSections.has("volunteering")
      ? extractVolunteering(getSectionHtml("volunteering"))
      : [],
  };
  const data = deduplicateProfileData(extractedData);
  const counts = countItems(data);

  return {
    extractedAt: new Date().toISOString(),
    data,
    counts,
  };
}
