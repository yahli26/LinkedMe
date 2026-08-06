import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDirectory = resolve(projectRoot, "tests/fixtures");

test("public fixtures contain only synthetic profile identifiers", async () => {
  const fixtureNames = (await readdir(fixtureDirectory)).filter((name) =>
    name.endsWith(".txt")
  );

  for (const fixtureName of fixtureNames) {
    const contents = await readFile(resolve(fixtureDirectory, fixtureName), "utf8");
    const profileHandles = [
      ...contents.matchAll(/linkedin\.com\/in\/([^/"?#]+)/gi),
    ].map((match) => match[1]);

    assert.doesNotMatch(
      contents,
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
      `${fixtureName} must not contain an email address`
    );
    assert.doesNotMatch(
      contents,
      /\b(?:JSESSIONID|li_at|access[_-]?token|refresh[_-]?token)\b/i,
      `${fixtureName} must not contain authentication data`
    );
    profileHandles.forEach((handle) => {
      assert.equal(
        handle,
        "jordan-example",
        `${fixtureName} contains a non-synthetic profile handle`
      );
    });
  }
});
