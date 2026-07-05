/**
 * Configuration Management
 * 
 * Handles loading, parsing, exporting, and persisting the tier ranking configuration.
 * Also manages the config editor draft state and UI interactions.
 */

import { state, els, DEFAULT_CONFIG, markDirty } from "./state.js";
import { toNumber, clamp, uniqueId, humanizeId, configId, slugify, showToast, escapeHtml } from "./utils.js";
import { renderTierBoard, renderUnranked } from "./render.js";
import { attachReorderable } from "./drag.js";
import { apiFetch } from "./auth.js";
import { openAhpCalculator, applyAhpWeights, getAhpComparisons, closeAhpCalculator } from "./ahp.js";

/**
 * Draft state for the config editor.
 * Holds a snapshot of facets, min, max, and candidate scores while the editor is open.
 * All editor operations modify the draft; changes are only applied to real state on "Apply".
 * The draft persists across X-close and is only cleared on Apply or Cancel.
 * @type {Object|null}
 */
let configDraft = null;

/**
 * Parses JSON configuration text into the application's data model.
 * @param {string} text - The JSON configuration text to parse
 * @returns {Object} Parsed configuration with title, tiers, facets, and candidates
 */
export function parseConfig(text) {
  return parseJsonConfig(text);
}

/**
 * Parses JSON configuration text into the application's data model.
 * @param {string} text - JSON configuration text
 * @returns {Object} Parsed configuration with title, tiers, facets, and candidates
 * @throws {Error} If JSON is invalid or candidates list is missing
 */
export function parseJsonConfig(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON: ${error.message}`);
  }

  const title = String(data.title || "S-Tier Ranking Board");
  const min = toNumber(data.min, 0);
  const max = Math.max(1, toNumber(data.max, 10));
  const rawCandidates = Array.isArray(data.candidates) ? data.candidates : [];
  let facets = normalizeRubric(data.rubric);

  // Parse tiers: support new format [{id, name}] and detect old format ["S", "A", ...]
  let tiers;
  if (Array.isArray(data.tiers) && data.tiers.length) {
    // Detect old format: array of strings
    if (typeof data.tiers[0] === "string") {
      throw new Error(
        "This ranking file uses an outdated tier format. " +
        "Tiers must now be objects with 'id' and 'name' properties. " +
        "Please update the file or create a new ranking."
      );
    }
    // New format: array of {id, name, position} objects
    tiers = data.tiers.map((tier) => ({
      id: String(tier.id || `tier-${Math.random().toString(36).slice(2, 8)}`),
      name: String(tier.name || "Unnamed"),
      position: toNumber(tier.position, 1)
    }));
  } else {
    tiers = [
      { id: "tier-1", name: "S", position: 1 },
      { id: "tier-2", name: "A", position: 2 },
      { id: "tier-3", name: "B", position: 3 },
      { id: "tier-4", name: "C", position: 4 },
      { id: "tier-5", name: "D", position: 5 },
      { id: "tier-6", name: "F", position: 6 }
    ];
  }

  if (!rawCandidates.length) {
    // Empty candidates list is valid (e.g. newly created ranking)
  }

  if (!facets.length) {
    facets = inferFacetsFromScores(rawCandidates);
  }

  // Build set of valid tier IDs for normalization
  const tierIdSet = new Set(tiers.map((t) => t.id));

  const candidates = rawCandidates.map((item, index) => {
    const candidate = item && typeof item === "object" ? item : {};
    const name = String(candidate.name || `Candidate ${index + 1}`);
    const rawScores = candidate.scores && typeof candidate.scores === "object" ? candidate.scores : {};
    const scores = {};
    facets.forEach((facet) => {
      scores[facet.id] = clamp(toNumber(rawScores[facet.id] ?? rawScores[facet.name], min), min, max);
    });
    // Normalize tierId: use candidate.tierId if valid, otherwise null (Unranked)
    let tierId = null;
    if (candidate.tierId && tierIdSet.has(candidate.tierId)) {
      tierId = candidate.tierId;
    } else if (candidate.tier) {
      // Legacy field: try to match by name
      const matched = tiers.find((t) => t.name.toLowerCase() === String(candidate.tier).toLowerCase());
      if (matched) tierId = matched.id;
    }
    return {
      id: candidate.id || `${slugify(name)}-${index + 1}`,
      name,
      image: String(candidate.image || "./assets/candidates/atlas.svg"),
      description: String(candidate.description || ""),
      tierId,
      scores
    };
  });

  // Parse AHP comparisons if present
  const ahpComparisons = data.ahpComparisons && typeof data.ahpComparisons === "object" ? data.ahpComparisons : {};

  return { title, tiers, min, max, facets, candidates, ahpComparisons };
}



/**
 * Exports the current configuration state as JSON.
 * @returns {string} JSON-formatted configuration text
 */
export function exportConfig() {
  return exportJson();
}

/**
 * Exports the current configuration state as JSON.
 * @returns {string} JSON-formatted configuration text
 */
export function exportJson() {
  const rubric = state.facets.map((facet) => ({
    id: facet.id,
    name: facet.name,
    weight: facet.weight
  }));

  const candidates = state.candidates.map((candidate) => ({
    name: candidate.name,
    image: candidate.image,
    description: candidate.description,
    tierId: candidate.tierId || null,
    scores: state.facets.reduce((scores, facet) => {
      scores[facet.id] = candidate.scores[facet.id] ?? 0;
      return scores;
    }, {})
  }));

  return JSON.stringify({
    title: state.title,
    tiers: state.tiers,
    min: state.min ?? 0,
    max: state.max ?? 10,
    rubric,
    candidates,
    ahpComparisons: state.ahpComparisons || {}
  }, null, 2);
}



let saveTimer = 0;

/**
 * Syncs the current state to the configuration text and schedules persistence.
 * Debounces the save operation to avoid excessive API calls.
 */
export function syncConfigFromState() {
  state.configText = exportConfig();
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(persistConfig, 1000);
}

/**
 * Cancels any pending autosave operation.
 * Should be called when logging out to prevent saving stale data under a different user.
 */
export function cancelPendingSave() {
  window.clearTimeout(saveTimer);
  saveTimer = 0;
}

/**
 * Persists the current configuration to the backend API.
 * If no ranking name is set, auto-saves to a default ranking named "untitled".
 * @returns {Promise<void>}
 */
export async function persistConfig() {
  try {
    // If no ranking name is set, auto-save to "untitled"
    if (!state.currentRankingName) {
      state.currentRankingName = "untitled";
      // Update the UI to show the ranking name
      const rankingNameEl = document.querySelector("[data-current-ranking-name]");
      if (rankingNameEl) {
        rankingNameEl.textContent = state.currentRankingName;
      }
    }
    
    const data = {
      title: state.title,
      tiers: state.tiers,
      facets: state.facets,
      candidates: state.candidates,
      min: state.min,
      max: state.max,
      ahpComparisons: state.ahpComparisons || {}
    };
    
    const response = await apiFetch(`/api/rankings/${encodeURIComponent(state.currentRankingName)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    
    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}`);
    }
  } catch (err) {
    console.error("Failed to persist config:", err);
    showToast("Could not save config.");
  }
}

/**
 * Gets the current editable JSON text from the config editor or generates it from state.
 * @returns {string} JSON configuration text
 */
export function getEditableJson() {
  return state.configText;
}

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
 * Formats a configuration error into a user-friendly message.
 * @param {Error} error - The error to format
 * @returns {string} Formatted error message
 */
export function formatConfigError(error) {
  if (error instanceof SyntaxError) {
    return `JSON parse error: ${error.message}`;
  }
  return error.message || "Config could not be applied.";
}

/**
 * Gets the current text from the config editor textarea or generates it from state.
 * @returns {string} Current configuration text
 */
export function currentEditorText() {
  if (!els.configModal.hidden) return els.configEditor.value;
  return getEditableJson();
}

/**
 * Normalizes a rubric configuration into a standardized facet array.
 * Handles both array and object formats for the rubric.
 * @param {Array|Object} rubric - The rubric configuration to normalize
 * @returns {Array} Array of normalized facet objects
 */
function normalizeRubric(rubric) {
  const seen = new Set();
  const entries = Array.isArray(rubric)
    ? rubric.map((item, index) => [item?.id || item?.key || `facet_${index + 1}`, item])
    : Object.entries(rubric || {});

  return entries.map(([rawId, rawValue]) => {
    const value = rawValue && typeof rawValue === "object" ? rawValue : { label: rawValue };
    const label = value.label || value.name || humanizeId(rawId);
    const id = uniqueId(configId(rawId || label), seen);
    return {
      id,
      name: String(label),
      weight: toNumber(value.weight, 1)
    };
  }).filter((facet) => facet.name);
}

/**
 * Infers facets from candidate score keys when no rubric is defined.
 * @param {Array} candidates - Array of candidate objects
 * @returns {Array} Array of inferred facet objects
 */
function inferFacetsFromScores(candidates) {
  const seen = new Set();
  candidates.forEach((candidate) => {
    if (!candidate?.scores || typeof candidate.scores !== "object") return;
    Object.keys(candidate.scores).forEach((key) => seen.add(key));
  });
  return [...seen].map((id) => ({
    id: configId(id),
    name: humanizeId(id),
    weight: 1
  }));
}

// ============================================================================
// Config Editor Draft Management
// ============================================================================

/**
 * Creates a draft snapshot from the current state for editing.
 * @returns {Object} Draft object with facets, min, max, and candidateScores
 */
export function createDraftFromState() {
  const candidateScores = {};
  state.candidates.forEach((candidate) => {
    candidateScores[candidate.id] = { ...candidate.scores };
  });
  return {
    facets: state.facets.map((f) => ({ ...f })),
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
    renderFacetEditor();
    updateApplyButtonState();
    els.configModal.hidden = false;
  });
}

/**
 * Renders the facet list inside the config editor modal from the draft.
 */
export function renderFacetEditor() {
  if (!els.facetsList || !configDraft) return;
  els.facetsList.innerHTML = configDraft.facets.map((facet) => `
    <div class="facet-row" data-facet-id="${facet.id}">
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
        <input type="text" value="${escapeHtml(facet.name)}" data-facet-name="${facet.id}" autocomplete="off" spellcheck="false">
      </div>
      <div class="form-field">
        <label>Weight</label>
        <input type="number" value="${facet.weight}" min="0.1" step="0.1" data-facet-weight="${facet.id}" autocomplete="off">
      </div>
      <button type="button" class="btn-delete-facet" data-facet-delete="${facet.id}" aria-label="Delete ${escapeHtml(facet.name)}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
          <path d="M10 11v6"></path>
          <path d="M14 11v6"></path>
        </svg>
      </button>
    </div>
  `).join("");

  // Wire up drag-to-reorder
  attachReorderable(els.facetsList, ".facet-row", (fromIndex, toIndex) => {
    const [moved] = configDraft.facets.splice(fromIndex, 1);
    configDraft.facets.splice(toIndex, 0, moved);
    renderFacetEditor();
    updateApplyButtonState();
  });
}

/**
 * Wires up event listeners for the config editor form fields.
 * Called once during boot, uses event delegation for dynamic facet rows.
 */
export function wireConfigEditorControls() {
  els.configMin.addEventListener("input", handleScoreRangeChange);
  els.configMax.addEventListener("input", handleScoreRangeChange);
  els.facetsList.addEventListener("input", handleFacetFieldChange);
  els.facetsList.addEventListener("click", handleFacetButtonClick);
  els.addFacet.addEventListener("click", addFacet);

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

  // Check facets count
  if (configDraft.facets.length !== state.facets.length) {
    return true;
  }

  // Check each facet
  for (let i = 0; i < configDraft.facets.length; i++) {
    const draftFacet = configDraft.facets[i];
    const stateFacet = state.facets[i];
    if (draftFacet.id !== stateFacet.id || 
        draftFacet.name !== stateFacet.name || 
        draftFacet.weight !== stateFacet.weight) {
      return true;
    }
  }

  // Check candidate scores
  for (const candidate of state.candidates) {
    const draftScores = configDraft.candidateScores[candidate.id] || {};
    const actualScores = candidate.scores;
    
    // Check if any draft facet scores differ
    for (const facet of configDraft.facets) {
      const draftScore = draftScores[facet.id];
      const actualScore = actualScores[facet.id];
      if (draftScore !== actualScore) {
        return true;
      }
    }
    
    // Check if there are scores for facets not in the draft
    for (const scoreKey of Object.keys(actualScores)) {
      if (!configDraft.facets.some((f) => f.id === scoreKey)) {
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
  configDraft.facets.forEach((facet) => {
    state.candidates.forEach((candidate) => {
      const scores = configDraft.candidateScores[candidate.id];
      if (scores && scores[facet.id] !== undefined) {
        scores[facet.id] = clamp(scores[facet.id], min, max);
      }
    });
  });

  updateApplyButtonState();
}

/**
 * Handles changes to facet name or weight inputs using event delegation.
 * Operates on the draft only; real state is unchanged until Apply.
 */
export function handleFacetFieldChange(event) {
  if (!configDraft) return;
  const target = event.target;
  const facetId = target.dataset.facetName || target.dataset.facetWeight;
  if (!facetId) return;

  const facet = configDraft.facets.find((f) => f.id === facetId);
  if (!facet) return;

  if (target.dataset.facetName !== undefined) {
    const newName = target.value.trim();
    if (!newName) return;

    // Check for duplicate names within the draft
    const isDuplicate = configDraft.facets.some((f) => f.id !== facetId && f.name.toLowerCase() === newName.toLowerCase());
    if (isDuplicate) {
      setConfigStatus(`"${newName}" already exists. Use a different name.`, "error");
      target.value = facet.name;
      return;
    }

    facet.name = newName;
    setConfigStatus("");
  } else if (target.dataset.facetWeight !== undefined) {
    const newWeight = parseFloat(target.value);
    if (!isNaN(newWeight) && newWeight > 0) {
      facet.weight = newWeight;
    }
  }

  updateApplyButtonState();
}

/**
 * Handles click events on facet row buttons (delete) using event delegation.
 * Operates on the draft only; real state is unchanged until Apply.
 */
export function handleFacetButtonClick(event) {
  if (!configDraft) return;
  const deleteBtn = event.target.closest("[data-facet-delete]");
  if (!deleteBtn) return;

  const facetId = deleteBtn.dataset.facetDelete;
  const facet = configDraft.facets.find((f) => f.id === facetId);
  if (!facet) return;

  // Count candidates with non-default scores for this facet in the draft
  const min = configDraft.min;
  const affectedCount = state.candidates.filter((c) => {
    const scores = configDraft.candidateScores[c.id];
    const score = scores ? scores[facetId] : undefined;
    return score !== undefined && score !== min;
  }).length;

  // Show confirmation if any candidate has a meaningful score
  if (affectedCount > 0) {
    const confirmed = window.confirm(
      `${affectedCount} candidate${affectedCount !== 1 ? "s have" : " has"} a score for "${facet.name}". Delete this criterion?`
    );
    if (!confirmed) return;
  }

  // Remove facet from draft
  configDraft.facets = configDraft.facets.filter((f) => f.id !== facetId);

  // Remove scores for this facet from all candidates in the draft
  state.candidates.forEach((candidate) => {
    const scores = configDraft.candidateScores[candidate.id];
    if (scores) {
      delete scores[facetId];
    }
  });

  renderFacetEditor();
  updateApplyButtonState();
}

/**
 * Opens the AHP calculator modal with the current draft facets.
 * Restores previously saved AHP comparisons if available.
 */
function handleOpenAhp() {
  if (!configDraft) return;
  openAhpCalculator(configDraft.facets, state.ahpComparisons || {});
}

/**
 * Handles the AHP apply event: copies calculated weights back to configDraft
 * and refreshes the facet editor.
 */
function handleAhpApply() {
  const updatedFacets = applyAhpWeights();
  if (updatedFacets.length === 0) return;

  // Map updated weights back to configDraft facets (preserve order and IDs)
  // Convert from decimal (0-1) to percentage (0-100) and round to 1 decimal
  updatedFacets.forEach((updated) => {
    const draftFacet = configDraft.facets.find((f) => f.id === updated.id);
    if (draftFacet) {
      draftFacet.weight = Math.round(updated.weight * 1000) / 10;
    }
  });

  // Persist the pairwise comparisons to state for future restoration
  state.ahpComparisons = getAhpComparisons();

  closeAhpCalculator();
  renderFacetEditor();
  updateApplyButtonState();
  setConfigStatus("AHP weights applied. You can fine-tune manually before applying.", "ok");
}

/**
 * Adds a new facet with default values to the draft.
 * All existing candidates get the minimum score for the new facet in the draft.
 */
export function addFacet() {
  if (!configDraft) return;

  // Generate a unique ID for the new facet
  const baseId = "new-criterion";
  let facetId = baseId;
  let counter = 1;
  while (configDraft.facets.some((f) => f.id === facetId)) {
    facetId = `${baseId}-${counter++}`;
  }

  // Create new facet
  const newFacet = {
    id: facetId,
    name: "New Criterion",
    weight: 1
  };

  configDraft.facets.push(newFacet);

  // Add minimum score for all existing candidates in the draft
  const min = configDraft.min;
  state.candidates.forEach((candidate) => {
    if (!configDraft.candidateScores[candidate.id]) {
      configDraft.candidateScores[candidate.id] = {};
    }
    configDraft.candidateScores[candidate.id][facetId] = min;
  });

  renderFacetEditor();
  updateApplyButtonState();

  // Focus the name input of the new facet row
  const newRow = els.facetsList.querySelector(`[data-facet-id="${facetId}"]`);
  if (newRow) {
    const nameInput = newRow.querySelector("[data-facet-name]");
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
  state.facets = saved.facets;
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
  renderFacetEditor();
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

  // Validate all facet names and weights in the draft
  const names = new Set();
  for (const facet of configDraft.facets) {
    if (!facet.name.trim()) {
      setConfigStatus("All criteria must have a name.", "error");
      return;
    }
    const normalizedName = facet.name.toLowerCase();
    if (names.has(normalizedName)) {
      setConfigStatus(`Duplicate criterion name: "${facet.name}".`, "error");
      return;
    }
    names.add(normalizedName);
    if (facet.weight <= 0 || isNaN(facet.weight)) {
      setConfigStatus(`Invalid weight for "${facet.name}". Must be greater than 0.`, "error");
      return;
    }
  }

  // Apply draft to state
  state.facets = configDraft.facets;
  state.min = min;
  state.max = max;

  // Apply draft scores to candidates
  state.candidates.forEach((candidate) => {
    const draftScores = configDraft.candidateScores[candidate.id] || {};
    // Set scores for all draft facets
    configDraft.facets.forEach((facet) => {
      candidate.scores[facet.id] = draftScores[facet.id] !== undefined
        ? clamp(draftScores[facet.id], min, max)
        : min;
    });
    // Remove scores for facets no longer in the draft
    Object.keys(candidate.scores).forEach((scoreKey) => {
      if (!configDraft.facets.some((f) => f.id === scoreKey)) {
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

// ============================================================================
// Tier Editor
// ============================================================================

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

  // Wire up drag-to-reorder (attached when rows exist, matching facet editor pattern)
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


