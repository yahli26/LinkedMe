import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import {
  makeDraggable,
  renderExtractionAnimation,
} from "../extension/content/animation.js";

function installDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });
  return dom;
}

test("makeDraggable moves an element and clamps it to the viewport", () => {
  installDom();
  const element = document.createElement("div");
  document.body.append(element);
  Object.defineProperty(element, "offsetWidth", { value: 200 });
  Object.defineProperty(element, "offsetHeight", { value: 100 });
  element.getBoundingClientRect = () => ({
    left: Number.parseFloat(element.style.left) || 100,
    top: Number.parseFloat(element.style.top) || 80,
  });

  const cleanup = makeDraggable(element);

  element.dispatchEvent(
    new window.MouseEvent("mousedown", {
      button: 0,
      clientX: 120,
      clientY: 100,
      bubbles: true,
      cancelable: true,
    })
  );
  document.dispatchEvent(
    new window.MouseEvent("mousemove", { clientX: 900, clientY: 700 })
  );

  assert.equal(element.style.left, "600px");
  assert.equal(element.style.top, "500px");
  assert.equal(element.style.right, "auto");
  assert.equal(element.style.bottom, "auto");
  assert.equal(element.style.cursor, "grabbing");

  document.dispatchEvent(new window.MouseEvent("mouseup"));
  assert.equal(element.style.cursor, "grab");

  element.dispatchEvent(
    new window.MouseEvent("mousedown", {
      button: 0,
      clientX: 650,
      clientY: 550,
      bubbles: true,
      cancelable: true,
    })
  );
  document.dispatchEvent(
    new window.MouseEvent("mousemove", { clientX: -100, clientY: -100 })
  );

  assert.equal(element.style.left, "0px");
  assert.equal(element.style.top, "0px");

  document.dispatchEvent(new window.MouseEvent("mouseup"));
  document.dispatchEvent(
    new window.MouseEvent("mousemove", { clientX: 400, clientY: 400 })
  );
  assert.equal(element.style.left, "0px");
  assert.equal(element.style.top, "0px");

  cleanup();
});

test("renderExtractionAnimation applies fixed draggable panel styling", () => {
  installDom();
  window.setTimeout = () => 1;

  renderExtractionAnimation({
    counts: { education: 1, experience: 2, volunteering: 3 },
  });

  const element = document.getElementById("linkedme-extraction-animation");
  assert.ok(element);
  assert.equal(element.style.position, "fixed");
  assert.equal(element.style.zIndex, "2147483647");
  assert.equal(element.style.cursor, "grab");
  assert.equal(element.style.userSelect, "none");
});
