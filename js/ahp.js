/**
 * AHP (Analytic Hierarchy Process) Weight Calculator
 * 
 * Provides pairwise comparison of criteria and calculates priority weights
 * using the geometric mean method.
 */

import { state, els } from "./state.js";
import { escapeHtml } from "./utils.js";

/**
 * Draft state for the AHP calculator.
 * Holds pairwise comparison values keyed by pair ID (e.g., "price-quality").
 * @type {Object|null}
 */
let ahpDraft = null;

/**
 * Current facets being compared (snapshot from configDraft).
 * @type {Array|null}
 */
let ahpFacets = null;

/**
 * Stores the last AHP slider action for single-step undo.
 * Contains the pair ID and previous comparison value before the most recent change.
 * @type {Object|null}
 */
let lastAhpAction = null;

/**
 * Generates a consistent pair ID from two facet IDs.
 * Always returns the alphabetically sorted pair to ensure consistency.
 * Uses "::" as delimiter to avoid conflicts with hyphenated facet IDs.
 * @param {string} idA - First facet ID
 * @param {string} idB - Second facet ID
 * @returns {string} Pair ID in format "smallerId::largerId"
 */
function getPairId(idA, idB) {
  return idA < idB ? `${idA}::${idB}` : `${idB}::${idA}`;
}

/**
 * Converts slider position (1-17) to AHP comparison object.
 * Explicit mapping: position 9 = equal, positions 1-8 = left favored (9-2), positions 10-17 = right favored (2-9).
 * @param {number} position - Slider position (1-17)
 * @param {string} leftId - ID of the left criterion in the UI
 * @param {string} rightId - ID of the right criterion in the UI
 * @returns {Object} { favoredId: string|null, degree: 1-9 }
 */
function sliderPositionToAhp(position, leftId, rightId) {
  // Explicit mapping table for clarity
  const degreeMap = {
    1: 9, 2: 8, 3: 7, 4: 6, 5: 5, 6: 4, 7: 3, 8: 2,
    9: 1,
    10: 2, 11: 3, 12: 4, 13: 5, 14: 6, 15: 7, 16: 8, 17: 9
  };
  
  const degree = degreeMap[position] || 1;
  
  if (position === 9) {
    return { favoredId: null, degree: 1 }; // Equal
  } else if (position < 9) {
    return { favoredId: leftId, degree }; // Left favored
  } else {
    return { favoredId: rightId, degree }; // Right favored
  }
}

/**
 * Converts AHP comparison object to slider position (1-17).
 * @param {Object} ahp - { favoredId: string|null, degree: 1-9 }
 * @param {string} leftId - ID of the left criterion in the UI
 * @param {string} rightId - ID of the right criterion in the UI
 * @returns {number} Slider position (1-17)
 */
function ahpToSliderPosition(ahp, leftId, rightId) {
  if (ahp.favoredId === null) return 9; // Equal
  if (ahp.favoredId === leftId) return 10 - ahp.degree; // Left favored
  return ahp.degree + 8; // Right favored
}

/**
 * Gets the order of IDs in a pair (which is left, which is right).
 * @param {string} pairId - The pair ID (format: "idA::idB")
 * @param {string} idA - First facet ID
 * @param {string} idB - Second facet ID
 * @returns {Object} Object with leftId and rightId
 */
function getPairOrder(pairId, idA, idB) {
  const [first, second] = pairId.split("::");
  if (idA === first) {
    return { leftId: idA, rightId: idB };
  }
  return { leftId: idB, rightId: idA };
}

/**
 * Calculates AHP priority weights using the column normalization method.
 * 
 * Algorithm:
 * 1. Build n×n pairwise comparison matrix from slider values
 * 2. For slider value v comparing A vs B: matrix[A][B] = v, matrix[B][A] = 1/v
 * 3. Sum each column
 * 4. Normalize: divide each cell by its column sum
 * 5. Average each row to get priority weights
 * 
 * @param {Array} facets - Array of facet objects { id, name }
 * @param {Object} comparisons - Pairwise comparison values keyed by pair ID
 * @returns {Array} Array of { id, name, weight } objects (weight as decimal 0-1)
 */
export function calculateAhpWeights(facets, comparisons) {
  const n = facets.length;
  if (n < 2) return [];

  // Build pairwise comparison matrix
  const matrix = [];
  for (let i = 0; i < n; i++) {
    matrix[i] = [];
    for (let j = 0; j < n; j++) {
      if (i === j) {
        matrix[i][j] = 1;
      } else {
        const pairId = getPairId(facets[i].id, facets[j].id);
        const ahpComparison = comparisons[pairId] || { favoredId: null, degree: 1 };
        
        // Convert AHP comparison to matrix value
        // If equal, matrix value is 1
        // If a facet is favored, matrix[i][j] = degree if i is favored, 1/degree if j is favored
        let matrixValue;
        if (ahpComparison.favoredId === null) {
          matrixValue = 1;
        } else if (ahpComparison.favoredId === facets[i].id) {
          matrixValue = ahpComparison.degree;
        } else if (ahpComparison.favoredId === facets[j].id) {
          matrixValue = 1 / ahpComparison.degree;
        } else {
          matrixValue = 1; // Fallback (shouldn't happen)
        }
        matrix[i][j] = matrixValue;
      }
    }
  }

  // Sum each column
  const columnSums = [];
  for (let j = 0; j < n; j++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += matrix[i][j];
    }
    columnSums[j] = sum;
  }

  // Normalize each cell by its column sum, then average each row
  const weights = facets.map((facet, i) => {
    let rowSum = 0;
    for (let j = 0; j < n; j++) {
      rowSum += matrix[i][j] / columnSums[j];
    }
    return {
      id: facet.id,
      name: facet.name,
      weight: rowSum / n
    };
  });

  return weights;
}

/**
 * Renders the pairwise comparison sliders.
 */
function renderAhpComparisons() {
  if (!els.ahpComparisons || !ahpFacets) return;

  const pairs = [];
  for (let i = 0; i < ahpFacets.length; i++) {
    for (let j = i + 1; j < ahpFacets.length; j++) {
      pairs.push({
        idA: ahpFacets[i].id,
        nameA: ahpFacets[i].name,
        idB: ahpFacets[j].id,
        nameB: ahpFacets[j].name
      });
    }
  }

  els.ahpComparisons.innerHTML = pairs.map((pair) => {
    const pairId = getPairId(pair.idA, pair.idB);
    const ahpComparison = ahpDraft[pairId] || { favoredId: null, degree: 1 };
    const sliderPosition = ahpToSliderPosition(ahpComparison, pair.idA, pair.idB);
    const leftName = pair.nameA;
    const rightName = pair.nameB;

    // Generate scale markers aligned with 17 slider positions
    // Positions: 1=9, 3=7, 5=5, 7=3, 9=1, 11=3, 13=5, 15=7, 17=9
    const scaleValues = [9, 0, 7, 0, 5, 0, 3, 0, 1, 0, 3, 0, 5, 0, 7, 0, 9];
    const scaleMarkers = scaleValues.map((v, idx) => {
      const position = idx + 1;
      if (v === 0) return '<span></span>';
      return `<span class="${position === 9 ? 'center' : ''}">${v}</span>`;
    }).join("");

    // Generate description text
    let description = "";
    if (ahpComparison.favoredId === null) {
      description = `${escapeHtml(leftName)} and ${escapeHtml(rightName)} are equally important`;
    } else {
      const importanceLabels = { 2: "slightly to moderately", 3: "moderately", 4: "moderately to strongly", 5: "strongly", 6: "strongly to very strongly", 7: "very strongly", 8: "very strongly to extremely", 9: "extremely" };
      const label = importanceLabels[ahpComparison.degree] || "moderately";
      const favoredName = ahpComparison.favoredId === pair.idA ? leftName : rightName;
      const otherName = ahpComparison.favoredId === pair.idA ? rightName : leftName;
      description = `${escapeHtml(favoredName)} is <strong>${label}</strong> more important than ${escapeHtml(otherName)}`;
    }

    return `
      <div class="ahp-comparison-row">
        <div class="ahp-comparison-labels">
          <span class="ahp-comparison-label">${escapeHtml(leftName)}</span>
          <span class="ahp-comparison-label">${escapeHtml(rightName)}</span>
        </div>
        <div class="ahp-slider-container">
          <input 
            type="range" 
            class="ahp-slider" 
            min="1" 
            max="17" 
            step="1" 
            value="${sliderPosition}" 
            data-ahp-slider="${pairId}"
          >
          <div class="ahp-slider-scale">${scaleMarkers}</div>
        </div>
        <div class="ahp-comparison-value">${description}</div>
      </div>
    `;
  }).join("");

  // Wire up slider change events
  els.ahpComparisons.querySelectorAll("[data-ahp-slider]").forEach((slider) => {
    let snapshotSaved = false;
    
    slider.addEventListener("input", (e) => {
      const pairId = e.target.dataset.ahpSlider;
      const sliderPosition = parseInt(e.target.value, 10);
      const [idA, idB] = pairId.split("::");
      const ahpComparison = sliderPositionToAhp(sliderPosition, idA, idB);
      
      // Save undo snapshot only once at the start of the interaction
      if (!snapshotSaved) {
        lastAhpAction = { pairId, previous: { ...ahpDraft[pairId] } };
        snapshotSaved = true;
      }
      
      ahpDraft[pairId] = ahpComparison;
      updateSliderBackground(e.target, sliderPosition);
      updateComparisonDescription(e.target, ahpComparison, idA, idB);
      renderAhpWeights();
    });
    
    // Reset the flag when the user releases the slider
    slider.addEventListener("pointerup", () => {
      snapshotSaved = false;
    });
    
    slider.addEventListener("change", () => {
      snapshotSaved = false;
    });
  });

  // Set initial background fill for all sliders (important for restored values)
  els.ahpComparisons.querySelectorAll("[data-ahp-slider]").forEach((slider) => {
    const sliderPosition = parseInt(slider.value, 10);
    updateSliderBackground(slider, sliderPosition);
  });
}

/**
 * Updates the slider background gradient to show filled portion.
 * @param {HTMLInputElement} slider - The slider element
 * @param {number} position - Current slider position (1-17)
 */
function updateSliderBackground(slider, position) {
  const percentage = ((position - 1) / 16) * 100;
  slider.style.background = `linear-gradient(to right, #b8860b 0%, #b8860b ${percentage}%, rgba(255, 255, 255, 0.15) ${percentage}%, rgba(255, 255, 255, 0.15) 100%)`;
}

/**
 * Updates the comparison description text.
 * @param {HTMLInputElement} slider - The slider element
 * @param {Object} ahpComparison - Current AHP comparison { favoredId, degree }
 * @param {string} idA - ID of the left criterion
 * @param {string} idB - ID of the right criterion
 */
function updateComparisonDescription(slider, ahpComparison, idA, idB) {
  const facetA = ahpFacets.find((f) => f.id === idA);
  const facetB = ahpFacets.find((f) => f.id === idB);
  const leftName = facetA.name;
  const rightName = facetB.name;

  const descriptionEl = slider.closest(".ahp-comparison-row").querySelector(".ahp-comparison-value");
  
  if (ahpComparison.favoredId === null) {
    descriptionEl.innerHTML = `${escapeHtml(leftName)} and ${escapeHtml(rightName)} are equally important`;
  } else {
    const importanceLabels = { 2: "slightly to moderately", 3: "moderately", 4: "moderately to strongly", 5: "strongly", 6: "strongly to very strongly", 7: "very strongly", 8: "very strongly to extremely", 9: "extremely" };
    const label = importanceLabels[ahpComparison.degree] || "moderately";
    const favoredName = ahpComparison.favoredId === idA ? leftName : rightName;
    const otherName = ahpComparison.favoredId === idA ? rightName : leftName;
    descriptionEl.innerHTML = `${escapeHtml(favoredName)} is <strong>${label}</strong> more important than ${escapeHtml(otherName)}`;
  }
}

/**
 * Renders the calculated priority weights with progress bars.
 */
function renderAhpWeights() {
  if (!els.ahpWeights || !ahpFacets) return;

  const weights = calculateAhpWeights(ahpFacets, ahpDraft).sort((a, b) => b.weight - a.weight);
  
  if (weights.length === 0) {
    els.ahpWeights.innerHTML = "<p style='color: #9fa7b8; text-align: center;'>Add at least 2 criteria to calculate weights.</p>";
    return;
  }

  // Find the top weight
  const maxWeight = weights[0].weight;

  els.ahpWeights.innerHTML = weights.map((w) => {
    const percentage = (w.weight * 100).toFixed(1);
    const isTop = w.weight === maxWeight;
    const barWidth = (w.weight / maxWeight) * 100;

    return `
      <div class="ahp-weight-row">
        <div class="ahp-weight-header">
          <span class="ahp-weight-name">
            ${escapeHtml(w.name)}
            ${isTop ? '<span class="ahp-weight-badge">TOP</span>' : ''}
          </span>
          <span class="ahp-weight-value">${percentage}%</span>
        </div>
        <div class="ahp-weight-bar">
          <div class="ahp-weight-bar-fill ${isTop ? 'top' : ''}" style="width: ${barWidth}%"></div>
        </div>
      </div>
    `;
  }).join("");
}

/**
 * Sets the status message in the AHP modal.
 * @param {string} message - The status message
 * @param {string} tone - The tone ("ok", "error", or "")
 */
function setAhpStatus(message, tone = "") {
  if (els.ahpStatus) {
    els.ahpStatus.textContent = message;
    els.ahpStatus.dataset.tone = tone;
  }
}

/**
 * Opens the AHP calculator modal.
 * @param {Array} facets - Array of facet objects { id, name, weight } from configDraft
 * @param {Object} [existingComparisons] - Optional existing pairwise comparisons to restore
 */
export function openAhpCalculator(facets, existingComparisons = {}) {
  if (!els.ahpModal) return;

  // Need at least 2 criteria
  if (facets.length < 2) {
    setAhpStatus("Add at least 2 criteria to use the AHP calculator.", "error");
    return;
  }

  // Initialize draft
  ahpFacets = facets.map((f) => ({ id: f.id, name: f.name }));
  ahpDraft = { ...existingComparisons };

  // Initialize any missing pairs to equal importance
  for (let i = 0; i < ahpFacets.length; i++) {
    for (let j = i + 1; j < ahpFacets.length; j++) {
      const pairId = getPairId(ahpFacets[i].id, ahpFacets[j].id);
      if (!(pairId in ahpDraft)) {
        ahpDraft[pairId] = { favoredId: null, degree: 1 };
      }
    }
  }

  // Render all sections
  renderAhpComparisons();
  renderAhpWeights();
  setAhpStatus("Adjust sliders to calculate priority weights.");

  // Show modal
  els.ahpModal.hidden = false;
}

/**
 * Closes the AHP calculator modal and clears draft state.
 */
export function closeAhpCalculator() {
  if (els.ahpModal) {
    els.ahpModal.hidden = true;
  }
  ahpDraft = null;
  ahpFacets = null;
  lastAhpAction = null;
  setAhpStatus("");
}

/**
 * Undoes the last AHP slider adjustment.
 * Restores the previous comparison value and re-renders the UI.
 * Single-step undo — only the most recent slider change can be reverted.
 */
export function undoAhpSlider() {
  if (!lastAhpAction || !ahpDraft) return;

  const { pairId, previous } = lastAhpAction;
  ahpDraft[pairId] = previous;
  lastAhpAction = null;

  // Re-render the AHP modal
  renderAhpComparisons();
  renderAhpWeights();
}

/**
 * Applies the calculated AHP weights to the caller's facet array.
 * Returns the updated facets with new weights.
 * @returns {Array} Array of facet objects with updated weights
 */
export function applyAhpWeights() {
  if (!ahpFacets || !ahpDraft) return [];

  const weights = calculateAhpWeights(ahpFacets, ahpDraft);
  
  // Return facets with updated weights
  return ahpFacets.map((facet) => {
    const weightObj = weights.find((w) => w.id === facet.id);
    return {
      ...facet,
      weight: weightObj ? weightObj.weight : 1
    };
  });
}

/**
 * Gets the current pairwise comparisons (for persistence).
 * @returns {Object} Pairwise comparison values keyed by pair ID
 */
export function getAhpComparisons() {
  return ahpDraft ? { ...ahpDraft } : {};
}

/**
 * Wires up event listeners for the AHP modal buttons.
 */
export function wireAhpControls() {
  if (els.closeAhp) {
    els.closeAhp.addEventListener("click", closeAhpCalculator);
  }
  if (els.cancelAhp) {
    els.cancelAhp.addEventListener("click", closeAhpCalculator);
  }
  if (els.applyAhp) {
    els.applyAhp.addEventListener("click", () => {
      // The caller (config.js) will handle applying the weights to configDraft
      // This event is handled in config.js
      els.ahpModal.dispatchEvent(new CustomEvent("ahp:apply"));
    });
  }
}
