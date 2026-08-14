import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { JSDOM } from "jsdom";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const linkedInProfileUrl = "https://www.linkedin.com/in/jordan-example/";

async function loadFixture(name) {
  return readFile(resolve(projectRoot, name), "utf8");
}

async function loadLinkedInFixtures() {
  const [educationHtml, experienceHtml, volunteeringHtml] = await Promise.all([
    loadFixture("tests/fixtures/linkedin_profile_education.txt"),
    loadFixture("tests/fixtures/linkedin_profile_experience.txt"),
    loadFixture("tests/fixtures/linkedin_profile_volunteering.txt"),
  ]);

  return { educationHtml, experienceHtml, volunteeringHtml };
}

function installDom(html = "", url = linkedInProfileUrl) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    url,
  });

  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.DOMParser = dom.window.DOMParser;

  return dom;
}

function createManualJobProfile(payload) {
  const now = new Date();
  return {
    counts: { education: 0, experience: 1, volunteering: 0 },
    data: {
      education: [],
      experience: [{
        title: "New Job",
        companyName: payload.companyName,
        startDate: now.getFullYear() + "/" + String(now.getMonth() + 1).padStart(2, "0"),
        endDate: "until now",
        logoUrl: payload.logoUrl,
        logoUrlCandidates: payload.logoUrlCandidates,
      }],
      volunteering: [],
    },
  };
}

async function waitForCondition(predicate, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = predicate();
    if (result) return result;
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  throw new Error("Timed out waiting for test condition.");
}

async function showPanelFromStatus(messageListener) {
  assert.equal(
    messageListener(
      {
        type: "LINKEDME_STATUS_UPDATE",
        payload: {
          status: "completed",
          counts: { education: 0, experience: 0, volunteering: 0 },
          profile: {
            counts: { education: 0, experience: 0, volunteering: 0 },
            data: { education: [], experience: [], volunteering: [] },
          },
        },
      },
      {},
      () => {}
    ),
    false
  );
  return waitForCondition(() => document.getElementById("linkedme-floating-panel"));
}

test("profileExtractor extracts accurate section data from LinkedIn fixtures", async () => {
  const { educationHtml, experienceHtml, volunteeringHtml } =
    await loadLinkedInFixtures();

  installDom([educationHtml, experienceHtml, volunteeringHtml].join(""));

  const { extractLinkedInProfile } = await import(
    "../extension/content/profileExtractor.js"
  );

  const result = extractLinkedInProfile();

  assert.equal(result.profileUrl, linkedInProfileUrl);
  assert.match(result.extractedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(result.counts, {
    education: 1,
    experience: 2,
    volunteering: 2,
  });

  assert.deepEqual(
    result.data.education.map(({ institutionName, startDate, endDate }) => ({
      institutionName,
      startDate,
      endDate,
    })),
    [
      {
        institutionName: "Example University",
        startDate: "2021/01",
        endDate: "2024/12",
      },
    ]
  );
  assert.match(result.data.education[0].logoUrl, /example_university_logo|media\.licdn\.com/);

  assert.deepEqual(
    result.data.experience.map(({ companyName, startDate, endDate }) => ({
      companyName,
      startDate,
      endDate,
    })),
    [
      {
        companyName: "Example Robotics",
        startDate: "2022/03",
        endDate: "2022/06",
      },
      {
        companyName: "Northstar Systems",
        startDate: "2018/07",
        endDate: "2020/12",
      },
    ]
  );
  assert.match(result.data.experience[0].logoUrl, /example_robotics_logo/);
  assert.match(result.data.experience[1].logoUrl, /northstar_systems_logo/);

  assert.deepEqual(
    result.data.volunteering.map(
      ({ organizationName, startDate, endDate }) => ({
        organizationName,
        startDate,
        endDate,
      })
    ),
    [
      {
        organizationName: "Example Community Guild",
        startDate: "2019/02",
        endDate: "2019/11",
      },
      {
        organizationName: "Example Community Guild",
        startDate: "2018/01",
        endDate: "2018/12",
      },
    ]
  );
  result.data.volunteering.forEach(({ logoUrl }) => {
    assert.match(logoUrl, /media\.licdn\.com/);
  });
});

test("extractEducation handles public entries without dates after a long Experience section", async () => {
  const html = await loadFixture(
    "tests/fixtures/linkedin_profile_mixed_sections.txt"
  );
  installDom();

  const { extractEducation } = await import(
    "../extension/extractors/extractEducation.js"
  );
  const directResult = extractEducation(html);

  assert.deepEqual(
    directResult.map(
      ({ institutionName, degree, startDate, endDate }) => ({
        institutionName,
        degree,
        startDate,
        endDate,
      })
    ),
    [
      {
        institutionName: "Example School of Business",
        degree: "Master of Business Administration - MBA, Product Strategy",
        startDate: "",
        endDate: "",
      },
      {
        institutionName: "Northbridge University",
        degree: "Bachelor of Business Administration - BBA",
        startDate: "",
        endDate: "",
      },
    ]
  );
  directResult.forEach(({ logoUrl }) => {
    assert.match(logoUrl, /media\.licdn\.com/);
  });

  installDom(html);
  const { extractLinkedInProfile } = await import(
    `../extension/content/profileExtractor.js?long-experience-education=${Date.now()}`
  );
  const profileResult = extractLinkedInProfile(["education"]);

  assert.deepEqual(profileResult.counts, {
    education: 2,
    experience: 0,
    volunteering: 0,
  });
  assert.deepEqual(profileResult.data.education, directResult);
});

test("extractExperience consolidates grouped roles with continuous company tenure", async () => {
  const html = await loadFixture(
    "tests/fixtures/linkedin_profile_grouped_roles.txt"
  );
  installDom();

  const { extractExperience } = await import(
    "../extension/extractors/extractExperience.js"
  );
  const result = extractExperience(html);

  assert.deepEqual(
    result.map(({ title, companyName, startDate, endDate }) => ({
      title,
      companyName,
      startDate,
      endDate,
    })),
    [
      {
        title: "Lead Product Engineer, Workflow Tools",
        companyName: "Northstar Cloud",
        startDate: "2015/11",
        endDate: "Present",
      },
    ]
  );
});

test("extractExperience skips a year-only entry whose logo has no image URL", async () => {
  const html = await loadFixture(
    "tests/fixtures/linkedin_profile_mixed_sections.txt"
  );
  installDom();

  const { extractExperience } = await import(
    "../extension/extractors/extractExperience.js"
  );
  const result = extractExperience(html);

  assert.deepEqual(
    result.map(({ title, companyName, startDate, endDate }) => ({
      title,
      companyName,
      startDate,
      endDate,
    })),
    [
      {
        title: "Professional Hiatus",
        companyName: "Career Pause Collective",
        startDate: "2018",
        endDate: "Present",
      },
      {
        title: "Lifecycle Marketing Lead",
        companyName: "Example Rewards Group",
        startDate: "2016",
        endDate: "2017",
      },
      {
        title: "Partner Marketing Manager",
        companyName: "Northstar Travel Cooperative",
        startDate: "2009",
        endDate: "2016",
      },
      {
        title: "Product Marketing Specialist",
        companyName: "Blue Harbor Financial",
        startDate: "2007",
        endDate: "2009",
      },
    ]
  );
});

test("extractExperience merges a three-month role gap but keeps a four-month gap", async () => {
  installDom();
  const { extractExperience } = await import(
    "../extension/extractors/extractExperience.js"
  );
  const html = `
    <div componentkey="entity-collection-item-three-month-newer">
      <figure><img alt="Three Month Co logo" src="https://media.licdn.com/three-month.png"></figure>
      <p>Staff Engineer</p><p>Three Month Co</p><p>Jan 2024 - Dec 2024</p>
    </div>
    <div componentkey="entity-collection-item-three-month-older">
      <figure><img alt="Three Month Co logo" src="https://media.licdn.com/three-month.png"></figure>
      <p>Senior Engineer</p><p>Three Month Co</p><p>Jan 2023 - Oct 2023</p>
    </div>
    <div componentkey="entity-collection-item-four-month-newer">
      <figure><img alt="Four Month Co logo" src="https://media.licdn.com/four-month.png"></figure>
      <p>Director</p><p>Four Month Co</p><p>Jan 2024 - Dec 2024</p>
    </div>
    <div componentkey="entity-collection-item-four-month-older">
      <figure><img alt="Four Month Co logo" src="https://media.licdn.com/four-month.png"></figure>
      <p>Manager</p><p>Four Month Co</p><p>Jan 2023 - Sep 2023</p>
    </div>
  `;

  const result = extractExperience(html);

  assert.deepEqual(
    result
      .filter(({ companyName }) => companyName === "Three Month Co")
      .map(({ title, startDate, endDate }) => ({ title, startDate, endDate })),
    [
      {
        title: "Staff Engineer",
        startDate: "2023/01",
        endDate: "2024/12",
      },
    ]
  );
  assert.deepEqual(
    result
      .filter(({ companyName }) => companyName === "Four Month Co")
      .map(({ title, startDate, endDate }) => ({ title, startDate, endDate })),
    [
      {
        title: "Director",
        startDate: "2024/01",
        endDate: "2024/12",
      },
      {
        title: "Manager",
        startDate: "2023/01",
        endDate: "2023/09",
      },
    ]
  );
});

test("chronological sorting keeps ongoing DOM order and sorts completed entries by end date", async () => {
  const { sortEntriesChronologically } = await import(
    "../extension/extractors/linkedinParsing.js"
  );
  const entries = [
    { title: "Pinned ongoing", startDate: "2020/01", endDate: "Present" },
    { title: "Newer start", startDate: "2024/01", endDate: "2024/12" },
    { title: "Later finish", startDate: "2022/01", endDate: "2025/06" },
    { title: "Second ongoing", startDate: "2025/01", endDate: "ongoing" },
    { title: "Same finish, newer start", startDate: "2023/01", endDate: "2024/12" },
  ];

  assert.deepEqual(
    sortEntriesChronologically(entries).map(({ title }) => title),
    [
      "Pinned ongoing",
      "Second ongoing",
      "Later finish",
      "Newer start",
      "Same finish, newer start",
    ]
  );
});

test("extractExperience preserves DOM order for current roles and sorts past roles chronologically", async () => {
  installDom();
  const { extractExperience } = await import(
    "../extension/extractors/extractExperience.js"
  );
  const html = `
    <div componentkey="entity-collection-item-current-pinned">
      <figure><img alt="Advisory Co logo" src="https://media.licdn.com/advisory.png"></figure>
      <p>Pinned Advisor</p><p>Advisory Co</p><p>Jan 2020 - Present</p>
    </div>
    <div componentkey="entity-collection-item-current-newer">
      <figure><img alt="Engineering Co logo" src="https://media.licdn.com/engineering.png"></figure>
      <p>Principal Engineer</p><p>Engineering Co</p><p>Jan 2025 - Until now</p>
    </div>
    <div componentkey="entity-collection-item-past-older">
      <figure><img alt="Legacy Co logo" src="https://media.licdn.com/legacy.png"></figure>
      <p>Junior Engineer</p><p>Legacy Co</p><p>Jan 2018 - Dec 2019</p>
    </div>
    <div componentkey="entity-collection-item-past-newer">
      <figure><img alt="Recent Co logo" src="https://media.licdn.com/recent.png"></figure>
      <p>Senior Engineer</p><p>Recent Co</p><p>Jan 2023 - Dec 2024</p>
    </div>
  `;

  const result = extractExperience(html);

  assert.deepEqual(
    result.map(({ title }) => title),
    ["Pinned Advisor", "Principal Engineer", "Senior Engineer", "Junior Engineer"]
  );
  assert.equal(result[1].endDate, "Present");
});

test("section extractors keep all logo-bearing items, skip logo-less items, and stop at adjacent sections", async () => {
  installDom();
  const { extractEducation } = await import(
    "../extension/extractors/extractEducation.js"
  );
  const { extractExperience } = await import(
    "../extension/extractors/extractExperience.js"
  );
  const { extractVolunteering } = await import(
    "../extension/extractors/extractVolunteering.js"
  );

  const experienceItems = Array.from({ length: 7 }, (_, index) => {
    const year = 2010 + index;
    const logo = index === 0 ? "" :
      `<a href="/company/${index}/"><figure><img alt="Company logo" src="https://media.licdn.com/company-${index}.png"></figure></a>`;
    return `<div componentkey="entity-collection-item-experience-${index}">
      ${logo}
      <p>Role ${index}</p><p>Company ${index}</p>
      <p>Jan ${year} - Dec ${year}</p>
    </div>`;
  }).join("");
  const educationItems = Array.from({ length: 7 }, (_, index) => {
    const year = 2000 + index;
    const logo = index === 0 ? "" :
      `<a href="/school/${index}/"><figure><img alt="School logo" src="https://media.licdn.com/school-${index}.png"></figure></a>`;
    return `<div role="listitem">
      ${logo}
      <p>School ${index}</p><p>Degree ${index}</p>
      <p>Jan ${year} - Dec ${year}</p>
    </div>`;
  }).join("");
  const volunteeringItems = Array.from({ length: 7 }, (_, index) => {
    const year = 1990 + index;
    const logo = index === 0 ? "" :
      `<a href="/organization/${index}/"><figure><img alt="Organization logo" src="https://media.licdn.com/org-${index}.png"></figure></a>`;
    return `<div role="listitem">
      ${logo}
      <p>Volunteer ${index}</p><p>Organization ${index}</p>
      <p>Jan ${year} - Dec ${year}</p>
    </div>`;
  }).join("");
  const html = `
    <main>
    <h2>Experience</h2>${experienceItems}
    <h2>Education</h2>${educationItems}
    <h2>Volunteering</h2>${volunteeringItems}
    <h2>Projects</h2><div role="listitem">
      <figure><img alt="Project logo" src="https://media.licdn.com/project.png"></figure>
      <p>Adjacent project</p><p>Must not bleed</p><p>Jan 2030 - Dec 2030</p>
    </div>
    </main>
  `;

  const experience = extractExperience(html);
  const education = extractEducation(html);
  const volunteering = extractVolunteering(html);

  assert.equal(experience.length, 6);
  assert.equal(education.length, 6);
  assert.equal(volunteering.length, 6);
  assert.deepEqual(experience.map(({ title }) => title), [
    "Role 6", "Role 5", "Role 4", "Role 3", "Role 2", "Role 1",
  ]);
  assert.deepEqual(education.map(({ institutionName }) => institutionName), [
    "School 6", "School 5", "School 4", "School 3", "School 2", "School 1",
  ]);
  assert.deepEqual(volunteering.map(({ role }) => role), [
    "Volunteer 6", "Volunteer 5", "Volunteer 4", "Volunteer 3",
    "Volunteer 2", "Volunteer 1",
  ]);
});

test("Experience and Volunteering include logo-bearing items without dates", async () => {
  installDom();
  const { extractExperience } = await import(
    "../extension/extractors/extractExperience.js"
  );
  const { extractVolunteering } = await import(
    "../extension/extractors/extractVolunteering.js"
  );
  const experience = extractExperience(`
    <section componentkey="ExperienceTopLevelSection">
      <div componentkey="entity-collection-item-no-date">
        <a href="/company/1/"><figure><img alt="Company logo" src="https://media.licdn.com/company.png"></figure></a>
        <p>Undated Engineer</p><p>Undated Company</p>
      </div>
    </section>
  `);
  const volunteering = extractVolunteering(`
    <section componentkey="VolunteerExperienceTopLevel">
      <div role="listitem">
        <a href="/organization/1/"><figure><img alt="Organization logo" src="https://media.licdn.com/organization.png"></figure></a>
        <p>Undated Volunteer</p><p>Undated Organization</p>
      </div>
    </section>
  `);

  assert.deepEqual(
    experience.map(({ title, startDate, endDate }) => ({ title, startDate, endDate })),
    [{ title: "Undated Engineer", startDate: "", endDate: "" }]
  );
  assert.deepEqual(
    volunteering.map(({ role, startDate, endDate }) => ({ role, startDate, endDate })),
    [{ role: "Undated Volunteer", startDate: "", endDate: "" }]
  );
});

test("profileExtractor finds a div-only Experience card and keeps every entry", async () => {
  const html = await loadFixture(
    "tests/fixtures/linkedin_profile_div_only.txt"
  );
  installDom(html);

  const fixtureItems = [
    ...document.querySelectorAll('[componentkey^="entity-collection-item"]'),
  ];
  const olderItem = fixtureItems.at(-1).cloneNode(true);
  const olderItemRows = olderItem.querySelectorAll("p");
  olderItem.setAttribute("componentkey", "entity-collection-item-older-sixth");
  olderItemRows[0].textContent = "Legacy Developer";
  olderItemRows[1].textContent = "Legacy Company · Full-time";
  olderItemRows[2].textContent = "Jan 2010 - Dec 2019 · 10 yrs";
  fixtureItems.at(-1).parentElement.append(olderItem);

  assert.equal(
    document.querySelectorAll('[componentkey^="entity-collection-item"]')
      .length,
    6
  );

  const { extractLinkedInProfile, getProfileSectionLoadState } = await import(
    `../extension/content/profileExtractor.js?div-experience=${Date.now()}`
  );

  assert.deepEqual(getProfileSectionLoadState(["experience"]), {
    requestedSections: ["experience"],
    loadedSections: ["experience"],
    missingSections: [],
  });

  const result = extractLinkedInProfile(["experience"]);

  assert.equal(result.counts.experience, 6);
  assert.deepEqual(
    result.data.experience.map(
      ({ title, companyName, startDate, endDate }) => ({
        title,
        companyName,
        startDate,
        endDate,
      })
    ),
    [
      {
        title: "Software Developer",
        companyName: "Example Security Labs",
        startDate: "2025/08",
        endDate: "Present",
      },
      {
        title: "Software Developer",
        companyName: "Atlas Public Systems",
        startDate: "2025/01",
        endDate: "2025/06",
      },
      {
        title: "Data Engineer",
        companyName: "Northwind Research Institute",
        startDate: "2024/11",
        endDate: "2025/06",
      },
      {
        title: "Software Developer",
        companyName: "Example Health Center",
        startDate: "2023/10",
        endDate: "2024/01",
      },
      {
        title: "Software Developer",
        companyName: "Aurora Weather Service",
        startDate: "2020/12",
        endDate: "2023/08",
      },
      {
        title: "Legacy Developer",
        companyName: "Legacy Company",
        startDate: "2010/01",
        endDate: "2019/12",
      },
    ]
  );
  result.data.experience.forEach(({ logoUrl }) => {
    assert.match(logoUrl, /media\.licdn\.com/);
  });
});

test("profileExtractor extracts public profile sections without edit links", async () => {
  const { educationHtml, experienceHtml, volunteeringHtml } =
    await loadLinkedInFixtures();
  const publicProfileHtml = [educationHtml, experienceHtml, volunteeringHtml]
    .join("")
    .replace(/\scomponentkey="[^"]*TopLevelSection"/g, "")
    .replace(/\/details\/education\/edit\/forms\/\d+\//g, "/details/education/")
    .replace(/\/edit\/forms\/position\/\d+\//g, "/details/experience/")
    .replace(
      /\/details\/volunteer-experiences\/edit\/forms\/\d+\//g,
      "/details/volunteer-experiences/"
    );

  installDom(publicProfileHtml);

  const { extractLinkedInProfile } = await import(
    `../extension/content/profileExtractor.js?public-profile=${Date.now()}`
  );

  const result = extractLinkedInProfile();

  assert.deepEqual(result.counts, {
    education: 1,
    experience: 2,
    volunteering: 2,
  });
  assert.equal(
    result.data.education[0].institutionName,
    "Example University"
  );
  assert.deepEqual(
    result.data.experience.map(({ companyName }) => companyName),
    ["Example Robotics", "Northstar Systems"]
  );
  assert.deepEqual(
    result.data.volunteering.map(({ organizationName }) => organizationName),
    ["Example Community Guild", "Example Community Guild"]
  );
});

test("profileExtractor preserves matching names across and within categories", async () => {
  installDom();
  const { deduplicateProfileData } = await import(
    `../extension/content/profileExtractor.js?deduplication=${Date.now()}`
  );

  const data = deduplicateProfileData({
    education: [
      {
        institutionName: "Recent Role",
        degree: "Example degree",
        startDate: "2022/01",
        endDate: "2023/01",
      },
    ],
    experience: [
      {
        title: " recent   role ",
        companyName: "Example Company",
        startDate: "2024/01",
        endDate: "Present",
      },
      {
        title: "Recent Role",
        companyName: "Older Company",
        startDate: "2023/01",
        endDate: "2023/12",
      },
      {
        title: "Unique Job",
        companyName: "Example Company",
        startDate: "2021/01",
        endDate: "2021/12",
      },
    ],
    volunteering: [
      {
        role: "RECENT ROLE",
        organizationName: "Example Organization",
        startDate: "2025/01",
        endDate: "2025/06",
      },
    ],
  });

  assert.deepEqual(
    data.education.map(({ institutionName }) => institutionName),
    ["Recent Role"]
  );
  assert.deepEqual(
    data.experience.map(({ title }) => title),
    [" recent   role ", "Recent Role", "Unique Job"]
  );
  assert.deepEqual(
    data.volunteering.map(({ role }) => role),
    ["RECENT ROLE"]
  );
});

test("profileExtractor never treats a top profile card as missing lower sections", async () => {
  installDom(`
    <main>
      <section aria-label="Profile summary">
        <a href="https://www.linkedin.com/company/123/">
          <figure><img alt="Example Company logo" src="https://media.licdn.com/logo.png"></figure>
        </a>
        <p>Software Engineer</p>
        <p>Example Company</p>
        <p>Jan 2025 - Present</p>
      </section>
    </main>
  `);
  const { extractLinkedInProfile, getProfileSectionLoadState } = await import(
    `../extension/content/profileExtractor.js?top-card=${Date.now()}`
  );

  assert.deepEqual(getProfileSectionLoadState().missingSections, [
    "education",
    "experience",
    "volunteering",
  ]);
  assert.deepEqual(extractLinkedInProfile().counts, {
    education: 0,
    experience: 0,
    volunteering: 0,
  });
});

test("logo extraction prefers signed lazy URLs before generated high-res variants", async () => {
  installDom(`
    <div>
      <a href="https://www.linkedin.com/company/123/">
        <figure>
          <img
            alt="Example logo"
            src="data:image/gif;base64,R0lGODlhAQABAAAAACw="
            data-delayed-url="https://media.licdn.com/dms/image/v2/abc/company-logo_100_100/original?e=1783555200&amp;v=beta&amp;t=signed-token"
          >
        </figure>
      </a>
      <p>Engineer</p>
      <p>Example Co</p>
      <p>Jan 2024 - Feb 2024</p>
    </div>
  `);

  const { getLogoUrlCandidates } = await import(
    `../extension/extractors/linkedinParsing.js?lazy-order=${Date.now()}`
  );
  const candidates = getLogoUrlCandidates(document.body);

  assert.equal(
    candidates[0],
    "https://media.licdn.com/dms/image/v2/abc/company-logo_100_100/original?e=1783555200&v=beta&t=signed-token"
  );
  assert.equal(candidates.some((url) => url.startsWith("data:")), false);
  assert.ok(candidates.some((url) => url.includes("company-logo_800_800")));
  assert.ok(
    candidates.indexOf(candidates.find((url) => url.includes("company-logo_800_800"))) > 0
  );
});

test("logo extraction reads data-ghost-url when src is only a placeholder", async () => {
  installDom(`
    <div>
      <a href="https://www.linkedin.com/school/123/">
        <figure>
          <img
            alt="School logo"
            src="data:image/gif;base64,R0lGODlhAQABAAAAACw="
            data-ghost-url="https://media.licdn.com/dms/image/v2/def/school-logo_100_100/original?e=1783555200&amp;v=beta&amp;t=ghost-token"
          >
        </figure>
      </a>
      <p>Student</p>
      <p>Example School</p>
      <p>Jan 2024 - Feb 2024</p>
    </div>
  `);

  const { getLogoUrlCandidates } = await import(
    `../extension/extractors/linkedinParsing.js?ghost-url=${Date.now()}`
  );

  assert.equal(
    getLogoUrlCandidates(document.body)[0],
    "https://media.licdn.com/dms/image/v2/def/school-logo_100_100/original?e=1783555200&v=beta&t=ghost-token"
  );
});
test("animation renders the extraction summary and removes it after timeout", async () => {
  installDom();
  let scheduledRemoval;
  window.setTimeout = (callback) => {
    scheduledRemoval = callback;
    return 1;
  };

  const { renderExtractionAnimation } = await import("../extension/content/animation.js");

  renderExtractionAnimation({
    counts: {
      education: 1,
      experience: 2,
      volunteering: 2,
    },
  });

  const container = document.getElementById("linkedme-extraction-animation");
  assert.ok(container);
  assert.equal(container.getAttribute("role"), "status");
  assert.equal(
    container.textContent,
    "LinkedMe extracted 1 education, 2 experience, and 2 volunteering items."
  );

  scheduledRemoval();
  assert.equal(document.getElementById("linkedme-extraction-animation"), null);
});


test("content script keeps the floating panel absent before extraction", async () => {
  installDom("<main><h1>Example Person</h1></main>");

  let messageListener;
  const runtimeMessages = [];
  globalThis.chrome = {
    runtime: {
      id: "linkedme-test-extension",
      getURL(resourcePath) {
        return pathToFileURL(resolve(projectRoot, "extension", resourcePath)).href;
      },
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        },
      },
      sendMessage(message) {
        runtimeMessages.push(message);
        return Promise.resolve({
          type: "LINKEDME_STATUS_UPDATE",
          payload: {
            status: "completed",
            profile: {
              counts: { education: 1, experience: 1, volunteering: 1 },
              data: { education: [], experience: [], volunteering: [] },
            },
          },
        });
      },
    },
  };

  await import(
    pathToFileURL(resolve(projectRoot, "extension/content/content_script.js")).href +
      "?hidden-panel=" + Date.now()
  );

  await new Promise((resolveWait) => setTimeout(resolveWait, 0));
  assert.equal(document.getElementById("linkedme-floating-panel"), null);
  assert.equal(document.getElementById("linkedme-floating-panel-style"), null);
  assert.deepEqual(runtimeMessages, []);
  assert.equal(typeof messageListener, "function");
});

test("panel normalization keeps current experience DOM order", async () => {
  installDom();
  const { normalizeEntries } = await import(
    pathToFileURL(resolve(projectRoot, "extension/content/panel.js")).href +
      "?current-experience-order=" + Date.now()
  );

  const entries = normalizeEntries({
    data: {
      experience: [
        {
          title: "Pinned Advisor",
          companyName: "Advisory Co",
          startDate: "2020/01",
          endDate: "Present",
          logoUrl: "https://media.licdn.com/advisory.png",
        },
        {
          title: "Principal Engineer",
          companyName: "Engineering Co",
          startDate: "2025/01",
          endDate: "until now",
          logoUrl: "https://media.licdn.com/engineering.png",
        },
        {
          title: "Junior Engineer",
          companyName: "Legacy Co",
          startDate: "2018/01",
          endDate: "2019/12",
          logoUrl: "https://media.licdn.com/legacy.png",
        },
        {
          title: "Senior Engineer",
          companyName: "Recent Co",
          startDate: "2023/01",
          endDate: "2024/12",
          logoUrl: "https://media.licdn.com/recent.png",
        },
      ],
      education: [],
      volunteering: [],
    },
  });

  assert.deepEqual(
    entries.map(({ title }) => title),
    ["Pinned Advisor", "Principal Engineer", "Senior Engineer", "Junior Engineer"]
  );
});

test("panel normalization keeps every item and stably orders all active ties", async () => {
  installDom();
  const { normalizeEntries } = await import(
    pathToFileURL(resolve(projectRoot, "extension/content/panel.js")).href +
      "?all-entry-order=" + Date.now()
  );
  const pastExperience = Array.from({ length: 5 }, (_, index) => ({
    title: `Past job ${index}`,
    companyName: `Past company ${index}`,
    startDate: `${2019 + index}/01`,
    endDate: `${2019 + index}/12`,
    logoUrl: index === 0 ? "" : `https://media.licdn.com/past-${index}.png`,
  }));

  const entries = normalizeEntries({
    data: {
      experience: [
        {
          title: "Pinned Advisor",
          companyName: "Advisory Co",
          startDate: "2020/01",
          endDate: "Present",
          logoUrl: "https://media.licdn.com/advisory.png",
        },
        {
          title: "Principal Engineer",
          companyName: "Engineering Co",
          startDate: "2025/01",
          endDate: "until now",
          logoUrl: "https://media.licdn.com/engineering.png",
        },
        ...pastExperience,
      ],
      education: [
        {
          degree: "Active degree",
          institutionName: "Current School",
          startDate: "2024/01",
          endDate: "Present",
          logoUrlCandidates: ["https://media.licdn.com/current-school.png"],
        },
        {
          degree: "Recent degree",
          institutionName: "Recent School",
          startDate: "2024/01",
          endDate: "2024/12",
          logoUrl: "https://media.licdn.com/recent-school.png",
        },
      ],
      volunteering: [
        {
          role: "Active mentor",
          organizationName: "Current Organization",
          startDate: "2026/01",
          endDate: "ongoing",
          logoUrl: "https://media.licdn.com/current-org.png",
        },
        {
          role: "Recent mentor",
          organizationName: "Recent Organization",
          startDate: "2026/01",
          endDate: "2026/07",
          logoUrl: "https://media.licdn.com/recent-org.png",
        },
      ],
    },
  });

  assert.equal(entries.length, 10);
  assert.equal(entries.some(({ title }) => title === "Past job 0"), false);
  assert.deepEqual(entries.slice(0, 4).map(({ title }) => title), [
    "Pinned Advisor",
    "Principal Engineer",
    "Active degree",
    "Active mentor",
  ]);
  assert.deepEqual(entries.slice(4).map(({ startDate }) => startDate), [
    "2026/01",
    "2024/01",
    "2023/01",
    "2022/01",
    "2021/01",
    "2020/01",
  ]);
});

test("floating panel renders the full ordered result and switches selection modes", async () => {
  installDom("<main><h1>Example Person</h1></main>");
  globalThis.chrome = {
    runtime: {
      getURL(resourcePath) {
        return pathToFileURL(resolve(projectRoot, "extension", resourcePath)).href;
      },
    },
  };

  const { createFloatingPanelController } = await import(
    pathToFileURL(resolve(projectRoot, "extension/content/panel.js")).href +
      "?controller=" + Date.now()
  );
  let addNewJobCalls = 0;
  const controller = createFloatingPanelController({
    async onAddNewJob() {
      addNewJobCalls += 1;
      const today = new Date();
      const startDate = today.getFullYear() + "/" +
        String(today.getMonth() + 1).padStart(2, "0");
      return {
        counts: { education: 0, experience: 1, volunteering: 0 },
        data: {
          education: [],
          experience: [{
            title: "New Job",
            companyName: "Example Company",
            startDate,
            endDate: "until now",
            logoUrl: "https://media.licdn.com/example-company.png",
          }],
          volunteering: [],
        },
      };
    },
  });
  controller.showProfile({
    counts: { education: 1, experience: 2, volunteering: 1 },
    data: {
      experience: [
        {
          title: "Newest job",
          companyName: "New Co",
          startDate: "2026/01",
          endDate: "",
          logoUrl: "https://media.licdn.com/new.png",
        },
        {
          title: "Older job",
          companyName: "Old Co",
          startDate: "2024/01",
          endDate: "2025/12",
          logoUrl: "https://media.licdn.com/old.png",
        },
      ],
      education: [
        {
          degree: "BSc",
          institutionName: "Example University",
          startDate: "2023/01",
          endDate: "2027/01",
          logoUrl: "https://media.licdn.com/university.png",
        },
      ],
      volunteering: [
        {
          role: "Mentor",
          organizationName: "Example Org",
          startDate: "2022/01",
          endDate: "2022/12",
          logoUrl: "https://media.licdn.com/organization.png",
        },
      ],
    },
  });

  const panel = document.getElementById("linkedme-floating-panel");
  assert.ok(panel);
  assert.equal(panel.querySelector(".linkedme-panel-status").textContent, "Extraction completed.");
  assert.equal(panel.getAttribute("aria-label"), "LinkedMe panel");
  assert.equal(panel.querySelectorAll("button").length, 6);
  const infoButton = panel.querySelector(".extracted-profile-info-button");
  const infoIcon = infoButton.querySelector(".extracted-profile-info-icon");
  assert.equal(infoIcon.getAttribute("viewBox"), "0 0 16 16");
  assert.equal(infoIcon.querySelector("circle").getAttribute("cx"), "8");
  assert.equal(infoIcon.querySelector("rect").getAttribute("x"), "6.5");
  assert.equal(infoIcon.querySelector("rect").getAttribute("width"), "3");
  assert.equal(
    infoButton.getAttribute("aria-label"),
    "Information about extracted profile items"
  );
  const infoTooltip = panel.querySelector("#linkedme-extracted-profile-tooltip");
  assert.equal(infoTooltip.getAttribute("role"), "tooltip");
  assert.equal(infoButton.getAttribute("aria-describedby"), infoTooltip.id);
  assert.deepEqual(
    [...infoTooltip.querySelectorAll("p")].map((node) => node.textContent),
    [
      "Only profile elements containing logos appear in this list.",
      "Only items visible on the initial LinkedIn page view are included.",
      "Any missing items can be added manually using the 'Add New Job' button.",
    ]
  );
  const extractButton = panel.querySelector(".linkedme-panel-actions button");
  assert.equal(extractButton.textContent, "Extract");
  assert.equal(extractButton.disabled, true);
  assert.equal(extractButton.getAttribute("aria-pressed"), "true");
  assert.equal(panel.querySelectorAll(".experience-item").length, 4);
  assert.deepEqual(
    [...panel.querySelectorAll(".experience-title")].map((node) => node.textContent),
    ["Example University", "Old Co", "Example Org", "New Co"]
  );
  assert.equal(panel.querySelector(".experience-meta"), null);
  assert.deepEqual(
    [...panel.querySelectorAll(".experience-date")].map((node) => node.textContent),
    [
      "01/2023 – 01/2027",
      "01/2024 – 12/2025",
      "01/2022 – 12/2022",
      "01/2026 – Present",
    ]
  );
  assert.equal(panel.querySelectorAll(".is-selected-for-video").length, 3);
  assert.equal(panel.querySelectorAll(".is-outside-video").length, 1);
  assert.equal(panel.querySelectorAll(".experience-selection-divider").length, 1);
  assert.equal(panel.querySelector(".generation-loading"), null);
  assert.equal(panel.querySelector(".generation-result"), null);
  assert.equal(panel.querySelector(".generate-video").textContent, "Generate Video");
  assert.equal(panel.querySelector(".video-generation-progress").hidden, true);
  assert.equal(panel.querySelector(".generated-video").hidden, true);
  assert.equal(panel.querySelector(".download-video").hidden, true);
  assert.equal(panel.querySelector(".video-export-grid"), null);
  assert.equal(panel.querySelector(".video-export-card"), null);
  assert.equal(panel.querySelector(".video-export-status"), null);
  assert.equal(panel.querySelector("#linkedme-generate-video"), null);

  const toggle = panel.querySelector("#linkedme-single-item-video-mode");
  toggle.checked = true;
  toggle.dispatchEvent(new window.Event("change", { bubbles: true }));

  assert.equal(panel.querySelector(".video-mode-toggle span").textContent, "1-sign mode");
  assert.equal(panel.querySelectorAll(".is-selected-for-video").length, 1);
  assert.equal(panel.querySelectorAll(".is-outside-video").length, 3);
  assert.equal(panel.querySelectorAll(".generate-video:disabled").length, 0);

  const addButton = panel.querySelectorAll(".linkedme-panel-actions button")[1];
  addButton.click();
  assert.equal(addButton.disabled, true);
  await new Promise((resolveWait) => setTimeout(resolveWait, 0));
  assert.equal(addNewJobCalls, 1);
  assert.equal(addButton.disabled, false);
  assert.equal(panel.querySelectorAll(".experience-item").length, 1);
  assert.equal(panel.querySelector(".experience-title").textContent, "Example Company");
  const today = new Date();
  const currentMonth = String(today.getMonth() + 1).padStart(2, "0");
  assert.equal(
    panel.querySelector(".experience-date").textContent,
    `${currentMonth}/${today.getFullYear()} – until now`
  );
  assert.equal(
    panel.querySelector(".experience-logo").src,
    "https://media.licdn.com/example-company.png"
  );

  assert.equal(panel.querySelectorAll(".is-selected-for-video").length, 1);
  assert.equal(
    panel.querySelector(".linkedme-panel-status").textContent,
    "Added Example Company."
  );

  const closeButton = panel.querySelector(".linkedme-panel-close");
  assert.equal(closeButton.textContent, "×");
  assert.equal(closeButton.getAttribute("aria-label"), "Close LinkedMe panel");
  const panelStyles = document.getElementById("linkedme-floating-panel-style").textContent;
  assert.match(panelStyles, /transform-origin:center center/);
  assert.match(panelStyles, /display:flex;flex:0 0 28px;align-items:center;justify-content:center/);
  assert.match(panelStyles, /\.linkedme-panel-close::before/);
  assert.match(panelStyles, /translate\(-50%,-50%\) rotate\(45deg\)/);
  assert.match(panelStyles, /\.extracted-profile-info:hover \.extracted-profile-tooltip/);
  assert.match(panelStyles, /\.extracted-profile-info:focus-within \.extracted-profile-tooltip/);
  assert.match(panelStyles, /position:relative;display:flex;align-items:center;justify-content:center;width:20px;height:20px/);
  assert.match(panelStyles, /\.extracted-profile-info-icon\{position:absolute;top:50%;left:50%;display:block;width:14px;height:14px/);
  assert.match(panelStyles, /transform:translate\(-50%,-50%\)/);
  assert.match(panelStyles, /width:min\(300px,calc\(100vw - 60px\)\)/);
  closeButton.click();
  assert.equal(document.getElementById("linkedme-floating-panel"), null);

  controller.showProfile({ counts: {}, data: {} });
  assert.equal(document.getElementById("linkedme-floating-panel"), panel);
});

test("video generation previews first and downloads only after explicit confirmation", async () => {
  installDom("<main><h1>Example Person</h1></main>");
  globalThis.chrome = {
    runtime: {
      getURL(resourcePath) {
        return pathToFileURL(resolve(projectRoot, "extension", resourcePath)).href;
      },
    },
  };

  let resolveVideo;
  const calls = [];
  const downloads = [];
  const videoResult = new Promise((resolveResult) => {
    resolveVideo = resolveResult;
  });
  const { createFloatingPanelController } = await import(
    pathToFileURL(resolve(projectRoot, "extension/content/panel.js")).href +
      "?single-video-pipeline=" + Date.now()
  );
  const controller = createFloatingPanelController({
    generateVideo(request) {
      calls.push(request);
      return videoResult;
    },
    triggerDownload(url, filename) {
      downloads.push({ url, filename });
    },
  });
  controller.showProfile({
    data: {
      experience: [
        {
          title: "First",
          companyName: "First Co",
          startDate: "2026/01",
          logoUrl: "https://media.licdn.com/first.png",
        },
        {
          title: "Second",
          companyName: "Second Co",
          startDate: "2025/01",
          logoUrl: "https://media.licdn.com/second.png",
        },
        {
          title: "Third",
          companyName: "Third Co",
          startDate: "2024/01",
          logoUrl: "https://media.licdn.com/third.png",
        },
      ],
      education: [],
      volunteering: [],
    },
  });

  const panel = document.getElementById("linkedme-floating-panel");
  const generateButton = panel.querySelector(".generate-video");
  const downloadButton = panel.querySelector(".download-video");
  const preview = panel.querySelector(".generated-video");
  let previewPlayCalls = 0;
  preview.play = () => {
    previewPlayCalls += 1;
    return Promise.resolve();
  };
  generateButton.click();
  assert.equal(generateButton.disabled, true);
  assert.equal(generateButton.textContent, "Creating video…");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].selectedEntries.length, 3);
  assert.equal(panel.querySelector("#linkedme-single-item-video-mode").disabled, true);
  const progress = panel.querySelector(".video-generation-progress");
  const progressBar = panel.querySelector(".video-generation-bar");
  const progressPercentage = panel.querySelector(".video-generation-percentage");
  assert.equal(panel.querySelector(".video-generation-stage"), null);
  assert.equal(progress.hidden, false);
  assert.equal(progressBar.value, 0);
  assert.equal(progressPercentage.textContent, "0%");

  calls[0].onProgress("Rendering video frames…", 54.6);
  assert.equal(progressBar.value, 55);
  assert.equal(progressPercentage.textContent, "55%");

  resolveVideo({
    blob: new Blob([new Uint8Array(32)], { type: "video/mp4" }),
    actualBitrate: 3_500_000,
  });
  await waitForCondition(() => preview.hidden === false);
  assert.equal(downloads.length, 0);
  assert.equal(progress.hidden, false);
  assert.equal(progressBar.value, 100);
  assert.equal(progressPercentage.textContent, "100%");
  assert.match(preview.src, /^blob:/);
  assert.equal(preview.autoplay, true);
  assert.equal(preview.muted, true);
  assert.equal(previewPlayCalls, 1);
  assert.equal(downloadButton.hidden, false);
  assert.equal(downloadButton.textContent, "Download");
  assert.equal(downloadButton.querySelector(".download-video-icon").getAttribute("viewBox"), "0 0 24 24");
  assert.equal(downloadButton.querySelector(".download-video-icon").getAttribute("aria-hidden"), "true");
  assert.equal(preview.nextElementSibling, downloadButton);
  assert.equal(generateButton.disabled, false);
  assert.equal(generateButton.textContent, "Generate Video");
  assert.equal(panel.querySelector("#linkedme-single-item-video-mode").disabled, false);
  assert.equal(panel.querySelector(".video-export-status"), null);

  downloadButton.click();
  assert.equal(downloads.length, 1);
  assert.match(downloads[0].filename, /-video-.*\.mp4$/);
});

test("Add New Job is re-enabled after an extraction error", async () => {
  installDom("<main></main>", "https://www.linkedin.com/feed/");
  const expectedMessage =
    "Please navigate to a LinkedIn company page before adding a new job.";
  const { createFloatingPanelController } = await import(
    `${pathToFileURL(resolve(projectRoot, "extension/content/panel.js")).href}?add-job-error=${Date.now()}`
  );
  const controller = createFloatingPanelController({
    async onAddNewJob() {
      throw new Error(expectedMessage);
    },
  });
  controller.showProfile({ counts: {}, data: {} });

  const panel = document.getElementById("linkedme-floating-panel");
  const addButton = panel.querySelectorAll(".linkedme-panel-actions button")[1];
  addButton.click();
  assert.equal(addButton.disabled, true);

  await new Promise((resolveWait) => setTimeout(resolveWait, 0));

  const status = panel.querySelector(".linkedme-panel-status");
  assert.equal(addButton.disabled, false);
  assert.equal(status.textContent, expectedMessage);
  assert.equal(status.classList.contains("is-error"), true);
});

test("MP4 export uses the 3.5 Mbps profile and requires an H.264 recorder", async () => {
  const {
    VIDEO_EXPORT_PROFILE,
    assertMp4Blob,
    selectMp4RecorderMimeType,
  } = await import(
    pathToFileURL(resolve(projectRoot, "extension/content/panel.js")).href +
      "?mp4-profile=" + Date.now()
  );

  assert.equal(VIDEO_EXPORT_PROFILE.bitrate, 3_500_000);
  assert.equal(VIDEO_EXPORT_PROFILE.buttonLabel, "Generate Video");
  assert.equal(VIDEO_EXPORT_PROFILE.filenameSuffix, "video");

  const checkedTypes = [];
  class MockRecorder {
    static isTypeSupported(mimeType) {
      checkedTypes.push(mimeType);
      return mimeType === 'video/mp4;codecs="avc1.42E01F"';
    }
  }
  assert.equal(
    selectMp4RecorderMimeType(MockRecorder),
    'video/mp4;codecs="avc1.42E01F"'
  );
  assert.deepEqual(checkedTypes, ['video/mp4;codecs="avc1.42E01F"']);
  assert.throws(
    () => selectMp4RecorderMimeType(class { static isTypeSupported() { return false; } }),
    /H\.264 MP4 encoder/
  );

  const validHeader = new Uint8Array([
    0, 0, 0, 24,
    0x66, 0x74, 0x79, 0x70,
    0x69, 0x73, 0x6f, 0x6d,
  ]);
  await assertMp4Blob(new Blob([validHeader], { type: "video/mp4" }));
  await assert.rejects(
    assertMp4Blob(new Blob([new Uint8Array(12)], { type: "video/mp4" })),
    /ftyp header/
  );
});

test("GIF palette mapping dithers gradients instead of collapsing them into color bands", async () => {
  const originalSelf = globalThis.self;
  globalThis.self = {
    addEventListener() {},
    postMessage() {},
  };

  try {
    const { applyPaletteWithDithering } = await import(
      pathToFileURL(resolve(projectRoot, "extension/content/gifEncoder.worker.js")).href +
        "?dithering=" + Date.now()
    );
    const width = 32;
    const height = 16;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      rgba[pixel * 4] = 96;
      rgba[pixel * 4 + 1] = 96;
      rgba[pixel * 4 + 2] = 96;
      rgba[pixel * 4 + 3] = 255;
    }

    const indexed = applyPaletteWithDithering(
      rgba,
      [[0, 0, 0], [255, 255, 255]],
      width,
      height
    );
    const lightPixelCount = indexed.reduce((count, value) => count + value, 0);
    const renderedAverage = lightPixelCount * 255 / indexed.length;

    assert.ok(lightPixelCount > 0 && lightPixelCount < indexed.length);
    assert.ok(Math.abs(renderedAverage - 96) < 10);
  } finally {
    if (originalSelf === undefined) delete globalThis.self;
    else globalThis.self = originalSelf;
  }
});

test("video overlays only use tracking data from the exact current frame", async () => {
  const {
    containedImageRect,
    gifFrameDelay,
    scaledSignRect,
    selectTemplate,
    trackingSampleAtFrame,
    validateTrackingData,
  } = await import(
    pathToFileURL(resolve(projectRoot, "extension/content/panel.js")).href +
      "?exact-tracking-frame=" + Date.now()
  );
  const samples = [
    { frame: 7, left: 100 },
    { frame: 8, left: 110 },
  ];

  assert.equal(trackingSampleAtFrame(samples, 0), null);
  assert.equal(trackingSampleAtFrame(samples, 6), null);
  assert.equal(trackingSampleAtFrame(samples, 7), samples[0]);
  assert.equal(trackingSampleAtFrame(samples, 9), null);

  assert.deepEqual(
    scaledSignRect({
      left: 10,
      top: 20,
      width: 80,
      height: 40,
      center_x: 52,
      center_y: 39,
    }, 2, 3),
    { left: 44, top: 72, width: 120, height: 90 }
  );
  assert.deepEqual(
    containedImageRect({ left: 10, top: 20, width: 100, height: 50 }, 100, 100),
    { left: 35, top: 20, width: 50, height: 50 }
  );

  const delays = Array.from({ length: 120 }, (_, frame) => gifFrameDelay(frame));
  assert.deepEqual(delays.slice(0, 6), [80, 80, 90, 80, 80, 90]);
  assert.equal(delays.reduce((total, delay) => total + delay, 0), 10000);

  const oneTemplate = selectTemplate("one");
  const threeTemplate = selectTemplate("three");
  assert.equal(oneTemplate.videoPath, "assets/1_sign_video_12_frames_final.mp4");
  assert.equal(oneTemplate.trackingPath, "assets/1_sign_track_raw_12_frames.json");
  assert.deepEqual([...threeTemplate.signOrder], ["center_sign", "right_sign", "left_sign"]);

  const oneTracking = JSON.parse(await readFile(
    resolve(projectRoot, "extension/assets/1_sign_track_raw_12_frames.json"), "utf8"
  ));
  const threeTracking = JSON.parse(await readFile(
    resolve(projectRoot, "extension/assets/3_sign_tracks_corrected_12_frames.json"), "utf8"
  ));
  const panelSource = await readFile(
    resolve(projectRoot, 'extension/content/panel.js'), 'utf8'
  );
  assert.match(panelSource, /const timestamp = \(frameIndex \+ 0\.1\) \/ OUTPUT_FPS;/);
  assert.equal(validateTrackingData(oneTracking, oneTemplate), oneTracking);
  assert.equal(validateTrackingData(threeTracking, threeTemplate), threeTracking);
  for (const tracking of [oneTracking, threeTracking]) {
    for (const samplesForSign of Object.values(tracking.tracks)) {
      for (const sample of samplesForSign) {
        const rect = scaledSignRect(sample, 1, 1);
        assert.ok(Math.abs(rect.left + rect.width / 2 - sample.center_x) < 1e-9);
        assert.ok(Math.abs(rect.top + rect.height / 2 - sample.center_y) < 1e-9);
      }
    }
  }
  assert.throws(
    () => validateTrackingData({ ...oneTracking, video: { ...oneTracking.video, total_frames: 119 } }, oneTemplate),
    /120-frame template/
  );
});

test("popup waits for extraction success and includes inline error status", async () => {
  const html = await readFile(resolve(projectRoot, "extension/popup/popup.html"), "utf8");
  const script = await readFile(resolve(projectRoot, "extension/popup/popup.js"), "utf8");

  const popupDom = new JSDOM(html);
  assert.equal(popupDom.window.document.querySelectorAll("button").length, 1);
  assert.equal(popupDom.window.document.querySelector("button").textContent, "Extract");
  assert.match(script, /chrome.tabs.sendMessage/);
  assert.match(script, /chrome.scripting.executeScript/);
  assert.match(script, /await sendExtractionMessage/);
  assert.match(script, /response\?\.type === EXTRACT_SUCCESS/);
  assert.match(script, /window.close()/);
  assert.match(script, /await sendExtractionMessage\(tab\.id, createExtractionMessage\(\)\)/);
  assert.doesNotMatch(script, /window\.alert/);
  assert.doesNotMatch(
    await readFile(resolve(projectRoot, "extension/content/panel.js"), "utf8"),
    /Your generated GIF/
  );
  const status = popupDom.window.document.querySelector("#extraction-status");
  assert.ok(status);
  assert.equal(status.getAttribute("role"), "status");
  assert.doesNotMatch(html, /Add New Job|Generate|Recent experiences/);
});
test("content script responds with extracted profile data for LinkedIn pages", async () => {
  const { educationHtml, experienceHtml, volunteeringHtml } =
    await loadLinkedInFixtures();

  installDom([educationHtml, experienceHtml, volunteeringHtml].join(""));

  let messageListener;
  const runtimeMessages = [];
  const requestedRuntimeResources = [];
  globalThis.chrome = {
    runtime: {
      getURL(resourcePath) {
        requestedRuntimeResources.push(resourcePath);
        return pathToFileURL(resolve(projectRoot, "extension", resourcePath)).href;
      },
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        },
      },
      sendMessage(message) {
        runtimeMessages.push(message);
        return Promise.resolve({ ok: true });
      },
    },
  };

  await import(
    `${pathToFileURL(resolve(projectRoot, "extension/content/content_script.js")).href}?test=${Date.now()}`
  );

  assert.equal(typeof messageListener, "function");

  const responsePromise = new Promise((resolveResponse) => {
    const keepsChannelOpen = messageListener(
      {
        type: "LINKEDME_EXTRACT_PROFILE_REQUEST",
        requestId: "test-request",
        payload: {
          sections: ["education", "experience", "volunteering"],
          renderAnimation: false,
        },
      },
      {},
      resolveResponse
    );

    assert.equal(keepsChannelOpen, true);
  });

  const response = await responsePromise;

  assert.equal(response.type, "LINKEDME_EXTRACT_PROFILE_SUCCESS");
  assert.equal(response.requestId, "test-request");
  assert.equal(requestedRuntimeResources.includes("content/animation.js"), false);
  assert.deepEqual(response.payload.counts, {
    education: 1,
    experience: 2,
    volunteering: 2,
  });
  assert.deepEqual(
    response.payload.data.experience.map(({ companyName }) => companyName),
    ["Example Robotics", "Northstar Systems"]
  );

  assert.equal(runtimeMessages[0].type, "LINKEDME_STATUS_UPDATE");
  assert.equal(runtimeMessages[0].payload.status, "running");
  assert.equal(
    runtimeMessages.at(-1).type,
    "LINKEDME_EXTRACT_PROFILE_SUCCESS"
  );
});

test("content script aborts with guidance when lower profile sections are not loaded", async () => {
  installDom("<main><h1>Jordan Example</h1><p>Software developer</p></main>");

  let currentScrollY = 0;
  let scrollCalls = 0;
  Object.defineProperty(window, "innerHeight", {
    value: 800,
    configurable: true,
  });
  Object.defineProperty(document.body, "scrollHeight", {
    value: 5000,
    configurable: true,
  });
  Object.defineProperty(document.documentElement, "scrollHeight", {
    value: 5000,
    configurable: true,
  });
  Object.defineProperty(window, "scrollY", {
    get() {
      return currentScrollY;
    },
    configurable: true,
  });
  window.scrollTo = (_x, y) => {
    scrollCalls += 1;
    currentScrollY = y;
  };

  let messageListener;
  const runtimeMessages = [];
  globalThis.chrome = {
    runtime: {
      getURL(resourcePath) {
        return pathToFileURL(resolve(projectRoot, "extension", resourcePath)).href;
      },
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        },
      },
      sendMessage(message) {
        runtimeMessages.push(message);
        return Promise.resolve({ ok: true });
      },
    },
  };

  await import(
    `${pathToFileURL(resolve(projectRoot, "extension/content/content_script.js")).href}?missing-sections=${Date.now()}`
  );

  const responsePromise = new Promise((resolveResponse) => {
    const keepsChannelOpen = messageListener(
      {
        type: "LINKEDME_EXTRACT_PROFILE_REQUEST",
        requestId: "missing-sections-request",
        payload: {
          sections: ["education", "experience", "volunteering"],
          renderAnimation: false,
        },
      },
      {},
      resolveResponse
    );

    assert.equal(keepsChannelOpen, true);
  });

  const response = await responsePromise;

  assert.equal(response.type, "LINKEDME_EXTRACT_PROFILE_ERROR");
  assert.equal(response.requestId, "missing-sections-request");
  assert.equal(
    response.payload.message,
    "Please scroll down to the bottom of the page to load all profile sections before extracting."
  );
  assert.equal(
    document.getElementById("linkedme-manual-job-toast").textContent,
    response.payload.message
  );
  assert.equal(scrollCalls, 0);
  assert.equal(runtimeMessages.at(-1).type, "LINKEDME_EXTRACT_PROFILE_ERROR");
});

test("content script allows extraction after the page bottom has been reached", async () => {
  const { experienceHtml } = await loadLinkedInFixtures();
  installDom(experienceHtml);

  Object.defineProperty(window, "innerHeight", {
    value: 800,
    configurable: true,
  });
  Object.defineProperty(document.body, "scrollHeight", {
    value: 5000,
    configurable: true,
  });
  Object.defineProperty(document.documentElement, "scrollHeight", {
    value: 5000,
    configurable: true,
  });
  Object.defineProperty(window, "scrollY", {
    value: 4200,
    configurable: true,
  });

  let messageListener;
  globalThis.chrome = {
    runtime: {
      getURL(resourcePath) {
        return pathToFileURL(resolve(projectRoot, "extension", resourcePath)).href;
      },
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        },
      },
      sendMessage() {
        return Promise.resolve({ ok: true });
      },
    },
  };

  await import(
    `${pathToFileURL(resolve(projectRoot, "extension/content/content_script.js")).href}?bottom-reached=${Date.now()}`
  );

  const response = await new Promise((resolveResponse) => {
    assert.equal(
      messageListener(
        {
          type: "LINKEDME_EXTRACT_PROFILE_REQUEST",
          requestId: "bottom-reached-request",
          payload: { renderAnimation: false },
        },
        {},
        resolveResponse
      ),
      true
    );
  });

  assert.equal(response.type, "LINKEDME_EXTRACT_PROFILE_SUCCESS");
  assert.deepEqual(response.payload.counts, {
    education: 0,
    experience: 2,
    volunteering: 0,
  });
  assert.equal(response.payload.sectionLoad.reachedPageBottom, true);
});

test("content script adds the current company and logo through the live panel flow", async () => {
  const suppliedCompanyHtml = await loadFixture(
    "tests/fixtures/div_logo_and_company_name.txt"
  );
  installDom(
    [
      `<main><h1 title="Wrong Company">Wrong Company</h1>`,
      `<img alt="Wrong Company logo" src="https://media.licdn.com/wrong-logo.png">`,
      `</main>`
    ].join(""),
    "https://www.linkedin.com/company/example-company/"
  );

  let messageListener;
  const runtimeMessages = [];
  globalThis.chrome = {
    runtime: {
      getURL(resourcePath) {
        return pathToFileURL(resolve(projectRoot, "extension", resourcePath)).href;
      },
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        },
      },
      sendMessage(message) {
        runtimeMessages.push(message);
        if (message.type === "LINKEDME_MANUAL_JOB_SELECT_SUCCESS") {
          return Promise.resolve({ ok: true, profile: createManualJobProfile(message.payload) });
        }
        return Promise.resolve({ ok: true });
      },
    },
  };

  await import(
    `${pathToFileURL(resolve(projectRoot, "extension/content/content_script.js")).href}?manual-job=${Date.now()}`
  );
  const panel = await showPanelFromStatus(messageListener);

  window.setTimeout(() => {
    const companyPageHost = document.createElement("div");
    companyPageHost.id = "linkedin-company-page-host";
    document.body.append(companyPageHost);
    companyPageHost.attachShadow({ mode: "open" }).innerHTML = suppliedCompanyHtml;
  }, 50);

  panel.querySelectorAll(".linkedme-panel-actions button")[1].click();
  const successMessage = await waitForCondition(
    () => runtimeMessages.find((message) =>
      message.type === "LINKEDME_MANUAL_JOB_SELECT_SUCCESS")
  );
  await waitForCondition(() =>
    panel.querySelector(".experience-title")?.textContent === "Example Corp"
  );

  assert.equal(successMessage.payload.companyName, "Example Corp");
  assert.match(successMessage.payload.logoUrl, /\/example_corp_logo\.png/);
  assert.deepEqual(successMessage.payload.logoUrlCandidates, [successMessage.payload.logoUrl]);
  assert.equal(panel.querySelectorAll(".experience-item").length, 1);
});

test("one-click company detection uses stable top-card anchors on organization pages", async () => {
  for (const organizationType of ["school", "showcase"]) {
    const organizationName =
      organizationType === "school" ? "Example University" : "Example Product";
    installDom(
      `<main><section class="org-top-card__primary-content"><h1 class="org-top-card-summary__title">${organizationName}</h1><img class="org-top-card-primary-content__logo" alt="${organizationName} logo" src="https://media.licdn.com/${organizationType}.png"></section></main>`,
      `https://www.linkedin.com/${organizationType}/example/`
    );

    let messageListener;
    const runtimeMessages = [];
    globalThis.chrome = {
      runtime: {
        getURL(resourcePath) {
          return pathToFileURL(resolve(projectRoot, "extension", resourcePath)).href;
        },
        onMessage: {
          addListener(listener) {
            messageListener = listener;
          },
        },
        sendMessage(message) {
          runtimeMessages.push(message);
          if (message.type === "LINKEDME_MANUAL_JOB_SELECT_SUCCESS") {
            return Promise.resolve({ ok: true, profile: createManualJobProfile(message.payload) });
          }
          return Promise.resolve({ ok: true });
        },
      },
    };
    await import(
      `${pathToFileURL(resolve(projectRoot, "extension/content/content_script.js")).href}?${organizationType}=${Date.now()}`
    );

    const panel = await showPanelFromStatus(messageListener);
    panel.querySelectorAll(".linkedme-panel-actions button")[1].click();
    const successMessage = await waitForCondition(
      () => runtimeMessages.find((message) =>
        message.type === "LINKEDME_MANUAL_JOB_SELECT_SUCCESS")
    );
    assert.equal(successMessage.payload.companyName, organizationName);
    assert.equal(
      successMessage.payload.logoUrl,
      `https://media.licdn.com/${organizationType}.png`
    );
  }

  installDom(
    "<main><section class=\"org-top-card__primary-content\"><h1 class=\"org-top-card-summary__title\">No Logo Company</h1></section></main>",
    "https://www.linkedin.com/company/no-logo/"
  );
  let missingLogoListener;
  globalThis.chrome = {
    runtime: {
      getURL(resourcePath) {
        return pathToFileURL(resolve(projectRoot, "extension", resourcePath)).href;
      },
      onMessage: {
        addListener(listener) {
          missingLogoListener = listener;
        },
      },
      sendMessage() {
        return Promise.resolve({ ok: true });
      },
    },
  };
  await import(
    `${pathToFileURL(resolve(projectRoot, "extension/content/content_script.js")).href}?missing-logo=${Date.now()}`
  );
  const missingLogoPanel = await showPanelFromStatus(missingLogoListener);
  missingLogoPanel.querySelectorAll(".linkedme-panel-actions button")[1].click();
  const errorStatus = await waitForCondition(
    () => missingLogoPanel.querySelector(".linkedme-panel-status.is-error"),
    6000
  );
  assert.match(errorStatus.textContent, /could not find the company's main logo/i);
});

test("manual job extraction rejects unsupported URLs before DOM polling", async () => {
  installDom("<main><h1>LinkedIn feed</h1></main>", "https://www.linkedin.com/feed/");

  const scheduledDelays = [];
  const originalSetTimeout = window.setTimeout.bind(window);
  window.setTimeout = (callback, delay, ...args) => {
    scheduledDelays.push(delay);
    return originalSetTimeout(callback, delay, ...args);
  };

  let messageListener;
  globalThis.chrome = {
    runtime: {
      getURL(resourcePath) {
        return pathToFileURL(resolve(projectRoot, "extension", resourcePath)).href;
      },
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        },
      },
      sendMessage() {
        return Promise.resolve({ ok: true });
      },
    },
  };

  await import(
    `${pathToFileURL(resolve(projectRoot, "extension/content/content_script.js")).href}?invalid-company-url=${Date.now()}`
  );
  const panel = await showPanelFromStatus(messageListener);
  panel.querySelectorAll(".linkedme-panel-actions button")[1].click();

  const expectedMessage =
    "Please navigate to a LinkedIn company page before adding a new job.";
  const errorStatus = await waitForCondition(
    () => panel.querySelector(".linkedme-panel-status.is-error")
  );
  assert.equal(errorStatus.textContent, expectedMessage);
  assert.equal(document.getElementById("linkedme-manual-job-toast").textContent, expectedMessage);
  assert.equal(scheduledDelays.includes(200), false);
  assert.equal(scheduledDelays.includes(250), false);
});
test("background persists a manually added job with the current YYYY/MM date", async () => {
  let messageListener;
  const storageState = {};
  globalThis.chrome = {
    storage: {
      local: {
        async get(key) {
          return { [key]: storageState[key] };
        },
        async set(values) {
          Object.assign(storageState, values);
        },
      },
    },
    runtime: {
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        },
      },
      sendMessage() {
        return Promise.resolve({ ok: true });
      },
    },
  };

  await import(
    `${pathToFileURL(resolve(projectRoot, "extension/background.js")).href}?persistence=${Date.now()}`
  );

  const response = await new Promise((resolveResponse) => {
    const keepsChannelOpen = messageListener(
      {
        type: "LINKEDME_MANUAL_JOB_SELECT_SUCCESS",
        requestId: "persisted-job",
        payload: {
          companyName: "Persistent Company",
          logoUrl: "https://media.licdn.com/persistent.png",
          logoUrlCandidates: ["https://media.licdn.com/persistent.png"],
        },
      },
      {},
      resolveResponse
    );
    assert.equal(keepsChannelOpen, true);
  });

  const now = new Date();
  const expectedStartDate =
    now.getFullYear() + "/" + String(now.getMonth() + 1).padStart(2, "0");
  const job = response.profile.data.experience[0];
  assert.equal(job.title, "New Job");
  assert.equal(job.companyName, "Persistent Company");
  assert.equal(job.startDate, expectedStartDate);
  assert.equal(job.endDate, "until now");
  assert.equal(job.logoUrl, "https://media.licdn.com/persistent.png");
  assert.equal(
    storageState["linkedme.latestStatus.v1"].payload.profile.data.experience[0].companyName,
    "Persistent Company"
  );

  let reloadedListener;
  chrome.runtime.onMessage.addListener = (listener) => {
    reloadedListener = listener;
  };
  await import(
    `${pathToFileURL(resolve(projectRoot, "extension/background.js")).href}?reload=${Date.now()}`
  );
  const reloadedResponse = await new Promise((resolveResponse) => {
    assert.equal(
      reloadedListener(
        {
          type: "LINKEDME_MANUAL_JOB_SELECT_SUCCESS",
          requestId: "second-job",
          payload: { companyName: "Second Company" },
        },
        {},
        resolveResponse
      ),
      true
    );
  });
  assert.deepEqual(
    reloadedResponse.profile.data.experience.map((entry) => entry.companyName),
    ["Second Company", "Persistent Company"]
  );
});

test("logo preprocessing heuristics distinguish removable white padding from rectangular logos", () => {
  const width = 20;
  const height = 20;
  const data = new Uint8ClampedArray(width * height * 4);
  const white = [255, 255, 255, 255];
  const blue = [20, 80, 180, 255];

  function paint(x, y, color) {
    const offset = (y * width + x) * 4;
    data.set(color, offset);
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      paint(x, y, white);
    }
  }

  for (let y = 5; y < 15; y += 1) {
    for (let x = 5; x < 15; x += 1) {
      paint(x, y, blue);
    }
  }

  function isWhite(offset) {
    return data[offset] >= 242 && data[offset + 1] >= 242 && data[offset + 2] >= 242;
  }

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      if (!isWhite(offset)) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  assert.deepEqual({ minX, minY, maxX, maxY }, { minX: 5, minY: 5, maxX: 14, maxY: 14 });
  assert.ok(minX / width >= 0.06);
  assert.ok(minY / height >= 0.06);
  assert.ok((maxX - minX + 1) / width <= 0.9);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      paint(x, y, blue);
    }
  }

  minX = width;
  minY = height;
  maxX = -1;
  maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      if (!isWhite(offset)) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  assert.deepEqual({ minX, minY, maxX, maxY }, { minX: 0, minY: 0, maxX: 19, maxY: 19 });
  assert.equal(minX / width >= 0.06 || minY / height >= 0.06, false);
});
