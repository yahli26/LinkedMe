const CONTAINER_ID = "linkedme-extraction-animation";
let removeDragBehavior = null;

function removeExistingAnimation() {
  removeDragBehavior?.();
  removeDragBehavior = null;
  document.getElementById(CONTAINER_ID)?.remove();
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function makeDraggable(element, handle = element) {
  let dragState = null;

  function stopDragging() {
    if (!dragState) {
      return;
    }

    dragState = null;
    handle.style.cursor = "grab";
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", stopDragging);
  }

  function handleMouseMove(event) {
    if (!dragState) {
      return;
    }

    const maxLeft = Math.max(0, window.innerWidth - element.offsetWidth);
    const maxTop = Math.max(0, window.innerHeight - element.offsetHeight);
    const nextLeft = clamp(
      dragState.startLeft + event.clientX - dragState.startMouseX,
      0,
      maxLeft
    );
    const nextTop = clamp(
      dragState.startTop + event.clientY - dragState.startMouseY,
      0,
      maxTop
    );

    element.style.left = `${nextLeft}px`;
    element.style.top = `${nextTop}px`;
  }

  function handleMouseDown(event) {
    if (event.button !== 0) {
      return;
    }

    const bounds = element.getBoundingClientRect();
    dragState = {
      startMouseX: event.clientX,
      startMouseY: event.clientY,
      startLeft: bounds.left,
      startTop: bounds.top,
    };

    // Replace right/bottom anchoring with explicit coordinates before moving.
    element.style.left = `${bounds.left}px`;
    element.style.top = `${bounds.top}px`;
    element.style.right = "auto";
    element.style.bottom = "auto";
    handle.style.cursor = "grabbing";
    event.preventDefault();

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", stopDragging);
  }

  handle.addEventListener("mousedown", handleMouseDown);

  return () => {
    stopDragging();
    handle.removeEventListener("mousedown", handleMouseDown);
  };
}

export function renderExtractionAnimation(profileResult) {
  removeExistingAnimation();

  const container = document.createElement("div");
  container.id = CONTAINER_ID;
  container.setAttribute("role", "status");
  container.textContent = `LinkedMe extracted ${profileResult.counts.education} education, ${profileResult.counts.experience} experience, and ${profileResult.counts.volunteering} volunteering items.`;
  container.style.cssText = [
    "position: fixed",
    "right: 24px",
    "bottom: 24px",
    "z-index: 2147483647",
    "cursor: grab",
    "user-select: none",
    "max-width: 320px",
    "padding: 14px 16px",
    "border-radius: 14px",
    "background: #0a66c2",
    "color: #ffffff",
    "font: 600 14px/1.4 system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
    "box-shadow: 0 12px 32px rgba(0, 0, 0, 0.24)",
  ].join(";");

  document.body.appendChild(container);
  removeDragBehavior = makeDraggable(container);

  window.setTimeout(() => {
    if (container.isConnected) {
      removeExistingAnimation();
    }
  }, 4500);
}
