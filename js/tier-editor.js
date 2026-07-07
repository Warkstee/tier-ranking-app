/**
 * Tier Editor Modal
 * 
 * Manages the draft-based UI for editing ranking tiers.
 * All editor operations modify the draft; changes are only
 * applied to real state on "Apply".
 */

import { state, els, markDirty } from "./state.js";
import { escapeHtml, showToast } from "./utils.js";
import { attachReorderable } from "./drag.js";
import { syncConfigFromState } from "./config-parser.js";

/**
 * Draft state for the tier editor.
 * Holds a snapshot of tiers while the editor is open.
 * All editor operations modify the draft; changes are only applied to real state on "Apply".
 * The draft persists across X-close and is only cleared on Apply or Cancel.
 * @type {Array<{id: string, name: string}>|null}
 */
let tierDraft = null;

/**
 * Opens the tier editor modal and displays the current tiers.
 * If a draft already exists (from a previous X-close), it is reused.
 * Otherwise, a fresh draft is created from the current state.
 */
export function openTierEditor() {
  // Import closeModal from detail-modal.js to avoid circular dependency
  import("./detail-modal.js").then(({ closeModal }) => {
    closeModal();

    // Reuse existing draft or create a new one from current state
    if (!tierDraft) {
      tierDraft = state.tiers.map((t) => ({ ...t }));
    }

    // Clear status message
    if (els.tierStatus) {
      els.tierStatus.textContent = "";
    }

    // Render the tier list
    renderTierList();

    // Update Apply button state
    updateApplyTierButtonState();

    // Show the modal
    els.tierEditorModal.hidden = false;
  });
}

/**
 * Renders the list of tiers in the tier editor modal from the draft.
 * Each tier is displayed as a row with an editable text input and delete button.
 */
function renderTierList() {
  if (!els.tiersList || !tierDraft) return;
  
  els.tiersList.innerHTML = tierDraft.map((tier, index) => `
    <div class="tier-row" data-tier-index="${index}">
      <div class="drag-handle" aria-label="Drag to reorder">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="5" cy="3" r="1.5"/>
          <circle cx="11" cy="3" r="1.5"/>
          <circle cx="5" cy="8" r="1.5"/>
          <circle cx="11" cy="8" r="1.5"/>
          <circle cx="5" cy="13" r="1.5"/>
          <circle cx="11" cy="13" r="1.5"/>
        </svg>
      </div>
      <div class="form-field">
        <label>Name</label>
        <input type="text" value="${escapeHtml(tier.name)}" data-tier-name="${index}" autocomplete="off" spellcheck="false">
      </div>
      <button type="button" class="btn-delete-tier" data-tier-delete="${index}" aria-label="Delete ${escapeHtml(tier.name)}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
          <path d="M10 11v6"></path>
          <path d="M14 11v6"></path>
        </svg>
      </button>
    </div>
  `).join("");

  // Wire up drag-to-reorder (attached when rows exist, matching criteria editor pattern)
  attachReorderable(els.tiersList, ".tier-row", (fromIndex, toIndex) => {
    const [moved] = tierDraft.splice(fromIndex, 1);
    tierDraft.splice(toIndex, 0, moved);
    tierDraft.forEach((tier, index) => {
      tier.position = index + 1;
    });
    renderTierList();
    updateApplyTierButtonState();
  });
}

/**
 * Wires up event listeners for the tier editor form fields.
 * Called once during boot, uses event delegation for dynamic tier rows.
 */
export function wireTierEditorControls() {
  els.tiersList.addEventListener("input", handleTierFieldChange);
  els.tiersList.addEventListener("click", handleTierButtonClick);
}

/**
 * Handles changes to tier name inputs using event delegation.
 * Operates on the draft only; real state is unchanged until Apply.
 */
function handleTierFieldChange(event) {
  if (!tierDraft) return;
  const target = event.target;
  const index = target.dataset.tierName;
  if (index === undefined) return;

  const newName = target.value.trim();
  if (!newName) return;

  // Check for duplicate names within the draft
  const isDuplicate = tierDraft.some((t, i) => i !== parseInt(index) && t.name.toLowerCase() === newName.toLowerCase());
  if (isDuplicate) {
    setTierStatus(`"${newName}" already exists. Use a different name.`, "error");
    target.value = tierDraft[index].name;
    return;
  }

  tierDraft[index].name = newName;
  setTierStatus("");
  updateApplyTierButtonState();
}

/**
 * Handles click events on tier row buttons (delete) using event delegation.
 * Operates on the draft only; real state is unchanged until Apply.
 */
function handleTierButtonClick(event) {
  if (!tierDraft) return;
  const deleteBtn = event.target.closest("[data-tier-delete]");
  if (!deleteBtn) return;

  const index = parseInt(deleteBtn.dataset.tierDelete);
  const tier = tierDraft[index];
  if (!tier) return;

  // Count candidates in this tier
  const affectedCount = state.candidates.filter((c) => c.tierId === tier.id).length;

  // Show confirmation if any candidates are in this tier
  if (affectedCount > 0) {
    const confirmed = window.confirm(
      `${affectedCount} candidate${affectedCount !== 1 ? "s are" : " is"} in "${tier.name}". Delete this tier?`
    );
    if (!confirmed) return;
  }

  // Remove tier from draft
  tierDraft.splice(index, 1);

  // Re-render and update button state
  renderTierList();
  updateApplyTierButtonState();
}

/**
 * Adds a new tier with default name to the draft.
 */
export function addTier() {
  if (!tierDraft) return;

  // Generate a unique ID for the new tier
  let counter = tierDraft.length + 1;
  let newId = `tier-${counter}`;
  while (tierDraft.some((t) => t.id === newId)) {
    counter++;
    newId = `tier-${counter}`;
  }

  // Generate a unique default name
  let newName = "New Tier";
  let nameCounter = 1;
  while (tierDraft.some((t) => t.name.toLowerCase() === newName.toLowerCase())) {
    newName = `New Tier ${nameCounter++}`;
  }

  // Assign position as the next available number
  const maxPosition = tierDraft.reduce((max, t) => Math.max(max, t.position || 0), 0);

  tierDraft.push({ id: newId, name: newName, position: maxPosition + 1 });

  // Re-render and update button state
  renderTierList();
  updateApplyTierButtonState();

  // Focus the name input of the new tier row
  const newIndex = tierDraft.length - 1;
  const newRow = els.tiersList.querySelector(`[data-tier-index="${newIndex}"]`);
  if (newRow) {
    const nameInput = newRow.querySelector("[data-tier-name]");
    if (nameInput) {
      nameInput.focus();
      nameInput.select();
    }
  }
}

/**
 * Sets the status message in the tier editor UI.
 * @param {string} message - The status message to display
 * @param {string} tone - The tone/type of the message (e.g., "error", "success")
 */
function setTierStatus(message, tone = "") {
  if (els.tierStatus) {
    els.tierStatus.textContent = message;
    els.tierStatus.dataset.tone = tone;
  }
}

/**
 * Checks if the draft has unsaved changes compared to the current state.
 * @returns {boolean} True if there are unsaved changes
 */
function hasUnsavedTierChanges() {
  if (!tierDraft) return false;

  // Check if arrays have different lengths
  if (tierDraft.length !== state.tiers.length) {
    return true;
  }

  // Build a map of state tiers by ID for comparison
  const stateTierMap = new Map(state.tiers.map((t) => [t.id, t]));

  // Check each tier in the draft
  for (const draftTier of tierDraft) {
    const stateTier = stateTierMap.get(draftTier.id);
    if (!stateTier) {
      // Tier ID not found in state (new tier added)
      return true;
    }
    if (draftTier.name !== stateTier.name || draftTier.position !== stateTier.position) {
      return true;
    }
  }

  return false;
}

/**
 * Updates the Apply button state based on whether there are unsaved changes.
 */
function updateApplyTierButtonState() {
  const applyBtn = document.querySelector("[data-apply-tier]");
  if (applyBtn) {
    applyBtn.disabled = !hasUnsavedTierChanges();
  }
}

/**
 * Hides the tier editor modal without discarding the draft.
 * Used by the X button and Escape key.
 */
export function hideTierEditor() {
  els.tierEditorModal.hidden = true;
}

/**
 * Closes the tier editor modal and discards the draft.
 * Used by the Cancel and Close buttons.
 */
export function closeTierEditor() {
  // Discard the draft
  tierDraft = null;

  // Hide the modal
  els.tierEditorModal.hidden = true;
}

/**
 * Applies the draft tiers to the application state and persists it.
 * Since tiers now have stable IDs, renames and reorders don't affect candidates.
 * Only deletions require moving candidates to Unranked (tierId = null).
 */
export function applyTierEditor() {
  if (!tierDraft) return;

  // Validate all tier names in the draft
  const names = new Set();
  for (const tier of tierDraft) {
    if (!tier.name.trim()) {
      setTierStatus("All tiers must have a name.", "error");
      return;
    }
    const normalizedName = tier.name.toLowerCase();
    if (names.has(normalizedName)) {
      setTierStatus(`Duplicate tier name: "${tier.name}".`, "error");
      return;
    }
    names.add(normalizedName);
    if (normalizedName === "unranked") {
      setTierStatus("\"Unranked\" is a reserved name and cannot be used as a tier.", "error");
      return;
    }
  }

  // Build set of valid tier IDs from the draft
  const tierIdSet = new Set(tierDraft.map((t) => t.id));

  // Update candidate tier assignments: move to Unranked if their tier was deleted
  state.candidates.forEach((candidate) => {
    if (candidate.tierId && !tierIdSet.has(candidate.tierId)) {
      candidate.tierId = null;
    }
  });

  // Apply draft to state
  state.tiers = tierDraft.map((t) => ({ ...t }));

  // Clear the draft
  tierDraft = null;

  // Persist and re-render
  syncConfigFromState();
  import("./render.js").then(({ render }) => {
    render();
  });
  markDirty();
  setTierStatus("Applied tier configuration.", "ok");
  els.tierEditorModal.hidden = true;
  showToast("Applied tier config.");
}
