/**
 * Criteria Editor Modal
 * 
 * Manages the draft-based UI for editing scoring criteria, weights, score ranges,
 * and AHP integration. All editor operations modify the draft; changes are only
 * applied to real state on "Apply".
 */

import { state, els, markDirty } from "./state.js";
import { clamp, escapeHtml, showToast } from "./utils.js";
import { renderTierBoard, renderUnranked } from "./render.js";
import { attachReorderable } from "./drag.js";
import { parseConfig, syncConfigFromState } from "./config-parser.js";
import { openAhpCalculator, applyAhpWeights, getAhpComparisons, closeAhpCalculator } from "./ahp-calculator.js";

/**
 * Draft state for the config editor.
 * Holds a snapshot of criteria, min, max, and candidate scores while the editor is open.
 * All editor operations modify the draft; changes are only applied to real state on "Apply".
 * The draft persists across X-close and is only cleared on Apply or Cancel.
 * @type {Object|null}
 */
let configDraft = null;

/**
 * Sets the status message in the config editor UI.
 * @param {string} message - The status message to display
 * @param {string} tone - The tone/type of the message (e.g., "error", "success")
 */
export function setConfigStatus(message, tone = "") {
  els.configStatus.textContent = message;
  els.configStatus.dataset.tone = tone;
}

/**
 * Creates a draft snapshot from the current state for editing.
 * @returns {Object} Draft object with criteria, min, max, and candidateScores
 */
export function createDraftFromState() {
  const candidateScores = {};
  state.candidates.forEach((candidate) => {
    candidateScores[candidate.id] = { ...candidate.scores };
  });
  return {
    criteria: state.criteria.map((c) => ({ ...c })),
    min: state.min ?? 0,
    max: state.max ?? 10,
    candidateScores
  };
}

/**
 * Opens the config editor modal.
 * If a draft already exists (from a previous X-close), it is reused.
 * Otherwise, a fresh draft is created from the current state.
 */
export function openConfigEditor() {
  // Import closeModal from detail-modal.js to avoid circular dependency
  import("./detail-modal.js").then(({ closeModal }) => {
    closeModal();

    // Reuse existing draft or create a new one from current state
    if (!configDraft) {
      configDraft = createDraftFromState();
    }

    els.app.classList.add("config-open");
    els.configMin.value = configDraft.min;
    els.configMax.value = configDraft.max;
    els.configStatus.textContent = "";
    renderCriteriaEditor();
    updateApplyButtonState();
    els.configModal.hidden = false;
  });
}

/**
 * Renders the criteria list inside the config editor modal from the draft.
 */
export function renderCriteriaEditor() {
  if (!els.criteriaList || !configDraft) return;
  els.criteriaList.innerHTML = configDraft.criteria.map((criterion) => {
    const type = criterion.type || "numeric";
    const isConstraint = type === "boolean-constraint";
    return `
    <div class="criterion-row ${isConstraint ? 'criterion-constraint' : ''}" data-criterion-id="${criterion.id}">
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
        <label>Name ${isConstraint ? '<span class="constraint-badge" title="Filter only — not scored">⚠</span>' : ''}</label>
        <input type="text" value="${escapeHtml(criterion.name)}" data-criterion-name="${criterion.id}" autocomplete="off" spellcheck="false">
      </div>
      <div class="form-field">
        <label>Type</label>
        <select data-criterion-type="${criterion.id}" autocomplete="off">
          <option value="numeric" ${type === 'numeric' ? 'selected' : ''}>Numeric</option>
          <option value="boolean-scoring" ${type === 'boolean-scoring' ? 'selected' : ''}>Boolean (Scoring)</option>
          <option value="boolean-constraint" ${type === 'boolean-constraint' ? 'selected' : ''}>Boolean (Constraint)</option>
        </select>
      </div>
      <div class="form-field">
        <label>Weight</label>
        <input type="number" value="${criterion.weight}" min="0.1" step="0.1" data-criterion-weight="${criterion.id}" autocomplete="off" ${isConstraint ? 'disabled' : ''}>
      </div>
      <button type="button" class="btn-delete-criterion" data-criterion-delete="${criterion.id}" aria-label="Delete ${escapeHtml(criterion.name)}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
          <path d="M10 11v6"></path>
          <path d="M14 11v6"></path>
        </svg>
      </button>
    </div>
  `;
  }).join("");

  // Wire up drag-to-reorder
  attachReorderable(els.criteriaList, ".criterion-row", (fromIndex, toIndex) => {
    const [moved] = configDraft.criteria.splice(fromIndex, 1);
    configDraft.criteria.splice(toIndex, 0, moved);
    renderCriteriaEditor();
    updateApplyButtonState();
  });
}

/**
 * Wires up event listeners for the config editor form fields.
 * Called once during boot, uses event delegation for dynamic criterion rows.
 */
export function wireConfigEditorControls() {
  els.configMin.addEventListener("input", handleScoreRangeChange);
  els.configMax.addEventListener("input", handleScoreRangeChange);
  els.criteriaList.addEventListener("input", handleCriterionFieldChange);
  els.criteriaList.addEventListener("click", handleCriterionButtonClick);
  els.addCriterion.addEventListener("click", addCriterion);

  // AHP calculator button
  const ahpBtn = document.querySelector("[data-open-ahp]");
  if (ahpBtn) {
    ahpBtn.addEventListener("click", handleOpenAhp);
  }

  // Listen for AHP apply event
  if (els.ahpModal) {
    els.ahpModal.addEventListener("ahp:apply", handleAhpApply);
  }
}

/**
 * Checks if the draft has unsaved changes compared to the current state.
 * @returns {boolean} True if there are unsaved changes
 */
export function hasUnsavedChanges() {
  if (!configDraft) return false;

  // Check min/max
  if (configDraft.min !== (state.min ?? 0) || configDraft.max !== (state.max ?? 10)) {
    return true;
  }

  // Check criteria count
  if (configDraft.criteria.length !== state.criteria.length) {
    return true;
  }

  // Check each criterion
  for (let i = 0; i < configDraft.criteria.length; i++) {
    const draftCriterion = configDraft.criteria[i];
    const stateCriterion = state.criteria[i];
    if (draftCriterion.id !== stateCriterion.id || 
        draftCriterion.name !== stateCriterion.name || 
        draftCriterion.weight !== stateCriterion.weight ||
        (draftCriterion.type || "numeric") !== (stateCriterion.type || "numeric")) {
      return true;
    }
  }

  // Check candidate scores
  for (const candidate of state.candidates) {
    const draftScores = configDraft.candidateScores[candidate.id] || {};
    const actualScores = candidate.scores;
    
    // Check if any draft criterion scores differ
    for (const criterion of configDraft.criteria) {
      const draftScore = draftScores[criterion.id];
      const actualScore = actualScores[criterion.id];
      if (draftScore !== actualScore) {
        return true;
      }
    }
    
    // Check if there are scores for criteria not in the draft
    for (const scoreKey of Object.keys(actualScores)) {
      if (!configDraft.criteria.some((f) => f.id === scoreKey)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Updates the Apply button state based on whether there are unsaved changes.
 */
export function updateApplyButtonState() {
  if (els.applyConfigEdit) {
    els.applyConfigEdit.disabled = !hasUnsavedChanges();
  }
}

/**
 * Handles changes to the min/max score range inputs.
 * Updates the draft only; real state is unchanged until Apply.
 */
export function handleScoreRangeChange() {
  if (!configDraft) return;
  const min = parseInt(els.configMin.value, 10);
  const max = parseInt(els.configMax.value, 10);

  if (isNaN(min) || isNaN(max) || min < 0 || max < 1) return;

  configDraft.min = min;
  configDraft.max = max;

  // Clamp scores in the draft
  configDraft.criteria.forEach((criterion) => {
    state.candidates.forEach((candidate) => {
      const scores = configDraft.candidateScores[candidate.id];
      if (scores && scores[criterion.id] !== undefined) {
        scores[criterion.id] = clamp(scores[criterion.id], min, max);
      }
    });
  });

  updateApplyButtonState();
}

/**
 * Handles changes to criterion name, type, or weight inputs using event delegation.
 * Operates on the draft only; real state is unchanged until Apply.
 */
export function handleCriterionFieldChange(event) {
  if (!configDraft) return;
  const target = event.target;
  const criterionId = target.dataset.criterionName || target.dataset.criterionType || target.dataset.criterionWeight;
  if (!criterionId) return;

  const criterion = configDraft.criteria.find((f) => f.id === criterionId);
  if (!criterion) return;

  if (target.dataset.criterionName !== undefined) {
    const newName = target.value.trim();
    if (!newName) return;

    // Check for duplicate names within the draft
    const isDuplicate = configDraft.criteria.some((f) => f.id !== criterionId && f.name.toLowerCase() === newName.toLowerCase());
    if (isDuplicate) {
      setConfigStatus(`"${newName}" already exists. Use a different name.`, "error");
      target.value = criterion.name;
      return;
    }

    criterion.name = newName;
    setConfigStatus("");
  } else if (target.dataset.criterionType !== undefined) {
    const newType = target.value;
    criterion.type = newType;
    // Re-render to update visual indicators and disable weight for constraints
    renderCriteriaEditor();
  } else if (target.dataset.criterionWeight !== undefined) {
    const newWeight = parseFloat(target.value);
    if (!isNaN(newWeight) && newWeight > 0) {
      criterion.weight = newWeight;
    }
  }

  updateApplyButtonState();
}

/**
 * Handles click events on criterion row buttons (delete) using event delegation.
 * Operates on the draft only; real state is unchanged until Apply.
 */
export function handleCriterionButtonClick(event) {
  if (!configDraft) return;
  const deleteBtn = event.target.closest("[data-criterion-delete]");
  if (!deleteBtn) return;

  const criterionId = deleteBtn.dataset.criterionDelete;
  const criterion = configDraft.criteria.find((f) => f.id === criterionId);
  if (!criterion) return;

  // Count candidates with non-default scores for this criterion in the draft
  const min = configDraft.min;
  const affectedCount = state.candidates.filter((c) => {
    const scores = configDraft.candidateScores[c.id];
    const score = scores ? scores[criterionId] : undefined;
    return score !== undefined && score !== min;
  }).length;

  // Show confirmation if any candidate has a meaningful score
  if (affectedCount > 0) {
    const confirmed = window.confirm(
      `${affectedCount} candidate${affectedCount !== 1 ? "s have" : " has"} a score for "${criterion.name}". Delete this criterion?`
    );
    if (!confirmed) return;
  }

  // Remove criterion from draft
  configDraft.criteria = configDraft.criteria.filter((f) => f.id !== criterionId);

  // Remove scores for this criterion from all candidates in the draft
  state.candidates.forEach((candidate) => {
    const scores = configDraft.candidateScores[candidate.id];
    if (scores) {
      delete scores[criterionId];
    }
  });

  renderCriteriaEditor();
  updateApplyButtonState();
}

/**
 * Opens the AHP calculator modal with the current draft criteria.
 * Restores previously saved AHP comparisons if available.
 * Excludes boolean-constraint criteria from AHP calculation.
 */
function handleOpenAhp() {
  if (!configDraft) return;
  // Filter out constraint criteria - they don't participate in AHP
  const scoringCriteria = configDraft.criteria.filter(c => c.type !== 'boolean-constraint');
  openAhpCalculator(scoringCriteria, state.ahpComparisons || {});
}

/**
 * Handles the AHP apply event: copies calculated weights back to configDraft
 * and refreshes the criteria editor.
 */
function handleAhpApply() {
  const updatedCriteria = applyAhpWeights();
  if (updatedCriteria.length === 0) return;

  // Map updated weights back to configDraft criteria (preserve order and IDs)
  // Convert from decimal (0-1) to percentage (0-100) and round to 1 decimal
  updatedCriteria.forEach((updated) => {
    const draftCriterion = configDraft.criteria.find((f) => f.id === updated.id);
    if (draftCriterion) {
      draftCriterion.weight = Math.round(updated.weight * 1000) / 10;
    }
  });

  // Persist the pairwise comparisons to state for future restoration
  state.ahpComparisons = getAhpComparisons();

  closeAhpCalculator();
  renderCriteriaEditor();
  updateApplyButtonState();
  setConfigStatus("AHP weights applied. You can fine-tune manually before applying.", "ok");
}

/**
 * Adds a new criterion with default values to the draft.
 * All existing candidates get the minimum score for the new criterion in the draft.
 */
export function addCriterion() {
  if (!configDraft) return;

  // Generate a unique ID for the new criterion
  const baseId = "new-criterion";
  let criterionId = baseId;
  let counter = 1;
  while (configDraft.criteria.some((f) => f.id === criterionId)) {
    criterionId = `${baseId}-${counter++}`;
  }

  // Create new criterion
  const newCriterion = {
    id: criterionId,
    name: "New Criterion",
    weight: 1,
    type: "numeric"
  };

  configDraft.criteria.push(newCriterion);

  // Add minimum score for all existing candidates in the draft
  const min = configDraft.min;
  state.candidates.forEach((candidate) => {
    if (!configDraft.candidateScores[candidate.id]) {
      configDraft.candidateScores[candidate.id] = {};
    }
    configDraft.candidateScores[candidate.id][criterionId] = min;
  });

  renderCriteriaEditor();
  updateApplyButtonState();

  // Focus the name input of the new criterion row
  const newRow = els.criteriaList.querySelector(`[data-criterion-id="${criterionId}"]`);
  if (newRow) {
    const nameInput = newRow.querySelector("[data-criterion-name]");
    if (nameInput) {
      nameInput.focus();
      nameInput.select();
    }
  }
}

/**
 * Hides the config editor modal without discarding the draft.
 * Used by the X button and Escape key.
 */
export function hideConfigEditor() {
  els.app.classList.remove("config-open");
  els.configModal.hidden = true;
}

/**
 * Closes the config editor modal and discards the draft.
 * Restores state from the last saved config to undo any unsaved changes.
 * Used by the Cancel button.
 */
export function closeConfigEditor() {
  // Discard the draft
  configDraft = null;

  // Restore state from the last saved config
  const saved = parseConfig(state.configText);
  state.criteria = saved.criteria;
  state.min = saved.min ?? 0;
  state.max = saved.max ?? 10;

  // Re-render the board to reflect the restored state
  renderTierBoard();
  renderUnranked();

  els.app.classList.remove("config-open");
  els.configModal.hidden = true;
}

/**
 * Syncs the config editor form with the draft if the modal is open.
 */
export function syncOpenConfigEditor() {
  if (els.configModal.hidden) return;
  if (!configDraft) return;
  els.configMin.value = configDraft.min;
  els.configMax.value = configDraft.max;
  renderCriteriaEditor();
}

/**
 * Applies the draft config to the application state and persists it.
 */
export function applyEditorConfig() {
  if (!configDraft) return;

  const min = configDraft.min;
  const max = configDraft.max;

  // Validate score range
  if (isNaN(min) || isNaN(max) || min < 0 || max < 1 || min >= max) {
    setConfigStatus("Invalid score range. Min must be ≥ 0, Max must be ≥ 1, and Min < Max.", "error");
    return;
  }

  // Validate all criterion names and weights in the draft
  const names = new Set();
  for (const criterion of configDraft.criteria) {
    if (!criterion.name.trim()) {
      setConfigStatus("All criteria must have a name.", "error");
      return;
    }
    const normalizedName = criterion.name.toLowerCase();
    if (names.has(normalizedName)) {
      setConfigStatus(`Duplicate criterion name: "${criterion.name}".`, "error");
      return;
    }
    names.add(normalizedName);
    if (criterion.weight <= 0 || isNaN(criterion.weight)) {
      setConfigStatus(`Invalid weight for "${criterion.name}". Must be greater than 0.`, "error");
      return;
    }
  }

  // Apply draft to state
  state.criteria = configDraft.criteria;
  state.min = min;
  state.max = max;

  // Apply draft scores to candidates
  state.candidates.forEach((candidate) => {
    const draftScores = configDraft.candidateScores[candidate.id] || {};
    // Set scores for all draft criteria
    configDraft.criteria.forEach((criterion) => {
      candidate.scores[criterion.id] = draftScores[criterion.id] !== undefined
        ? clamp(draftScores[criterion.id], min, max)
        : min;
    });
    // Remove scores for criteria no longer in the draft
    Object.keys(candidate.scores).forEach((scoreKey) => {
      if (!configDraft.criteria.some((f) => f.id === scoreKey)) {
        delete candidate.scores[scoreKey];
      }
    });
  });

  // Clear the draft
  configDraft = null;

  // Persist and re-render
  syncConfigFromState();
  import("./render.js").then(({ render }) => {
    render();
  });
  markDirty();
  setConfigStatus("Applied configuration.", "ok");
  els.app.classList.remove("config-open");
  els.configModal.hidden = true;
  showToast("Applied config.");
}
