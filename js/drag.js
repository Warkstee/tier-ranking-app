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
