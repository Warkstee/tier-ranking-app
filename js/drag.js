/**
 * Drag and Drop Module
 * 
 * Handles pointer-based drag and drop functionality for candidate cards.
 * Supports dragging candidates between tier lanes and the unranked list,
 * with visual feedback and automatic state synchronization.
 */

import { state, els } from "./state.js";
import { renderTierBoard, renderUnranked, getCandidate } from "./render.js";
import { syncConfigFromState } from "./config.js";

let drag = null;

/**
 * Attaches pointer event listeners to enable drag functionality on an element.
 * @param {HTMLElement} element - The DOM element to make draggable
 * @param {string} candidateId - The ID of the candidate being dragged
 */
export function attachPointer(element, candidateId) {
  element.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest("button,input,textarea")) return;
    event.preventDefault();
    drag = {
      candidateId,
      source: element,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      ghost: null,
      activeZone: null
    };
    element.setPointerCapture?.(event.pointerId);
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp, { once: true });
  });
}

/**
 * Handles pointer movement during drag operation.
 * Creates a ghost element and tracks the current drop zone.
 * @param {PointerEvent} event - The pointer move event
 */
function onPointerMove(event) {
  if (!drag) return;
  const dx = event.clientX - drag.startX;
  const dy = event.clientY - drag.startY;
  const distance = Math.hypot(dx, dy);

  if (!drag.moved && distance > 6) {
    drag.moved = true;
    drag.ghost = drag.source.cloneNode(true);
    drag.ghost.classList.add("drag-ghost");
    drag.source.classList.add("drag-hidden");
    document.body.append(drag.ghost);
  }

  if (!drag.moved) return;
  drag.ghost.style.left = `${event.clientX}px`;
  drag.ghost.style.top = `${event.clientY}px`;

  const zone = dropZoneFromPoint(event.clientX, event.clientY);
  setActiveDropZone(zone);
}

/**
 * Handles pointer release after drag operation.
 * Determines if the action was a drag (move to new tier) or a click (open modal).
 * @param {PointerEvent} event - The pointer up event
 */
function onPointerUp(event) {
  if (!drag) return;

  document.removeEventListener("pointermove", onPointerMove);
  setActiveDropZone(null);

  const wasDrag = drag.moved;
  const candidateId = drag.candidateId;
  const zone = wasDrag ? dropZoneFromPoint(event.clientX, event.clientY) : null;

  drag.ghost?.remove();
  drag.source.classList.remove("drag-hidden");
  drag = null;

  if (wasDrag && zone) {
    moveCandidate(candidateId, zone.dataset.dropZone);
  } else if (!wasDrag) {
    // Import dynamically to avoid circular dependency
    import("./modal.js").then(({ openModal }) => openModal(candidateId));
  }
}

/**
 * Finds the drop zone element at the given coordinates.
 * @param {number} x - The X coordinate
 * @param {number} y - The Y coordinate
 * @returns {HTMLElement|null} The drop zone element or null if none found
 */
function dropZoneFromPoint(x, y) {
  const element = document.elementFromPoint(x, y);
  return element?.closest("[data-drop-zone]") || null;
}

/**
 * Sets the active drop zone and updates visual feedback.
 * @param {HTMLElement|null} zone - The drop zone element to highlight, or null to clear
 */
function setActiveDropZone(zone) {
  if (drag?.activeZone === zone) return;
  document.querySelectorAll(".drop-active").forEach((element) => element.classList.remove("drop-active"));
  if (zone) zone.classList.add("drop-active");
  if (drag) drag.activeZone = zone;
}

/**
 * Moves a candidate to a new tier and updates the UI.
 * @param {string} candidateId - The ID of the candidate to move
 * @param {string} tier - The target tier name
 */
function moveCandidate(candidateId, tier) {
  const candidate = getCandidate(candidateId);
  if (!candidate) return;
  const normalized = String(tier || "Unranked").trim();
  const match = state.tiers.find((t) => t.toLowerCase() === normalized.toLowerCase());
  candidate.tier = match || "Unranked";
  renderTierBoard();
  renderUnranked();
  syncConfigFromState();
}

// ============================================================================
// Reorderable List Drag
// ============================================================================

let reorderDrag = null;

/**
 * Attaches drag-to-reorder functionality to items within a container.
 * Each item must contain a `.drag-handle` element that initiates the drag.
 * Items are physically moved in the DOM during the drag for live visual feedback.
 * @param {HTMLElement} container - The container holding the reorderable items
 * @param {string} itemSelector - CSS selector for each reorderable item (e.g., ".facet-row")
 * @param {Function} onReorder - Callback invoked with (fromIndex, toIndex) when an item is dropped
 */
export function attachReorderable(container, itemSelector, onReorder) {
  container.addEventListener("pointerdown", (event) => {
    const handle = event.target.closest(".drag-handle");
    if (!handle) return;
    if (event.button !== 0) return;
    event.preventDefault();

    const item = handle.closest(itemSelector);
    if (!item) return;

    const items = [...container.querySelectorAll(itemSelector)];
    const fromIndex = items.indexOf(item);
    if (fromIndex === -1) return;

    // Find the nearest scrollable ancestor of the container. Required for autoscrolling a list when dragging an item.
    let scrollParent = container.parentElement;
    while (scrollParent && scrollParent !== document.body) {
      const style = getComputedStyle(scrollParent);
      if (style.overflowY === "auto" || style.overflowY === "scroll" || style.overflow === "auto" || style.overflow === "scroll") {
        break;
      }
      scrollParent = scrollParent.parentElement;
    }
    if (!scrollParent || scrollParent === document.body) {
      scrollParent = container;
    }

    reorderDrag = {
      container,
      itemSelector,
      item,
      fromIndex,
      onReorder,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      pointerY: event.clientY,
      moved: false,
      ghost: null,
      scrollFrame: null,
      scrollParent
    };

    item.setPointerCapture?.(event.pointerId);
    document.addEventListener("pointermove", onReorderPointerMove);
    document.addEventListener("pointerup", onReorderPointerUp, { once: true });
  });
}

/**
 * Handles pointer movement during a reorder drag operation.
 * Moves the dragged item in the DOM for live reordering feedback.
 * @param {PointerEvent} event - The pointer move event
 */
function onReorderPointerMove(event) {
  if (!reorderDrag) return;
  const dx = event.clientX - reorderDrag.startX;
  const dy = event.clientY - reorderDrag.startY;
  const distance = Math.hypot(dx, dy);

  if (!reorderDrag.moved && distance > 6) {
    reorderDrag.moved = true;
    reorderDrag.ghost = reorderDrag.item.cloneNode(true);
    reorderDrag.ghost.classList.add("drag-ghost");
    reorderDrag.item.classList.add("dragging");
    document.body.append(reorderDrag.ghost);
  }

  if (!reorderDrag.moved) return;
  reorderDrag.ghost.style.left = `${event.clientX}px`;
  reorderDrag.ghost.style.top = `${event.clientY}px`;
  reorderDrag.pointerY = event.clientY;

  // Auto-scroll when pointer is near the scrollable parent's edges
  const scrollRect = reorderDrag.scrollParent.getBoundingClientRect();
  const scrollEdge = 40;
  const scrollSpeed = 10;
  const nearTop = event.clientY < scrollRect.top + scrollEdge;
  const nearBottom = event.clientY > scrollRect.bottom - scrollEdge;

  if (nearTop || nearBottom) {
    if (!reorderDrag.scrollFrame) {
      const scroll = () => {
        if (!reorderDrag) return;
        if (nearTop) {
          reorderDrag.scrollParent.scrollTop -= scrollSpeed;
        } else if (nearBottom) {
          reorderDrag.scrollParent.scrollTop += scrollSpeed;
        }
        reorderDrag.scrollFrame = requestAnimationFrame(scroll);
      };
      reorderDrag.scrollFrame = requestAnimationFrame(scroll);
    }
  } else {
    if (reorderDrag.scrollFrame) {
      cancelAnimationFrame(reorderDrag.scrollFrame);
      reorderDrag.scrollFrame = null;
    }
  }

  // Find the item whose midpoint is closest to the pointer Y
  const items = [...reorderDrag.container.querySelectorAll(reorderDrag.itemSelector)];
  let closestItem = null;
  let closestDistance = Infinity;

  for (const item of items) {
    if (item === reorderDrag.item) continue;
    const rect = item.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const dist = Math.abs(event.clientY - midY);
    if (dist < closestDistance) {
      closestDistance = dist;
      closestItem = item;
    }
  }

  // Move the dragged item in the DOM to show live reordering
  if (closestItem) {
    const closestRect = closestItem.getBoundingClientRect();
    const midY = closestRect.top + closestRect.height / 2;
    if (event.clientY < midY) {
      reorderDrag.container.insertBefore(reorderDrag.item, closestItem);
    } else {
      reorderDrag.container.insertBefore(reorderDrag.item, closestItem.nextSibling);
    }
  } else if (items.length > 1) {
    // Only the dragged item remains visible — append to end
    reorderDrag.container.appendChild(reorderDrag.item);
  }
}

/**
 * Handles pointer release after a reorder drag operation.
 * Reads the final DOM order to determine fromIndex and toIndex.
 * @param {PointerEvent} event - The pointer up event
 */
function onReorderPointerUp(event) {
  if (!reorderDrag) return;

  document.removeEventListener("pointermove", onReorderPointerMove);

  const wasDrag = reorderDrag.moved;
  const fromIndex = reorderDrag.fromIndex;
  const draggedItem = reorderDrag.item;
  const callback = reorderDrag.onReorder;

  reorderDrag.ghost?.remove();
  draggedItem.classList.remove("dragging");
  if (reorderDrag.scrollFrame) {
    cancelAnimationFrame(reorderDrag.scrollFrame);
  }
  reorderDrag = null;

  if (wasDrag) {
    // The item is already in its final DOM position — find its new index
    const items = [...draggedItem.parentElement.querySelectorAll(".facet-row")];
    const toIndex = items.indexOf(draggedItem);

    if (toIndex !== -1 && toIndex !== fromIndex) {
      callback(fromIndex, toIndex);
    }
  }
}
