/**
 * Compare Modal Module
 * 
 * Handles the side-by-side comparison modal for two candidates.
 * Provides interactive score adjustment via progress bars and input fields
 * for both candidates simultaneously.
 */

import { state, els, markDirty } from "./state.js";
import { escapeHtml, escapeAttr, cssEscape, clamp, toNumber, slugify, formatNumber } from "./utils.js";
import { getCandidate, overallScore, overallRank, formatRank, attachImageFallback } from "./render.js";
import { syncConfigFromState } from "./config.js";
import { closeModal } from "./modal.js";
import { saveUndo } from "./undo.js";

/**
 * Opens the comparison modal for two candidates.
 * @param {string} candidateIdA - The ID of the first candidate (left side)
 * @param {string} candidateIdB - The ID of the second candidate (right side)
 */
export function openCompareModal(candidateIdA, candidateIdB) {
  const candidateA = getCandidate(candidateIdA);
  const candidateB = getCandidate(candidateIdB);
  if (!candidateA || !candidateB) return;
  
  // Close detail modal if open
  if (!els.modal.hidden) {
    closeModal();
  }
  
  state.compareIds = { left: candidateIdA, right: candidateIdB };
  els.app.classList.add("modal-open");
  document.querySelector("[data-compare-modal]").hidden = false;
  renderCompareModal();
}

/**
 * Closes the comparison modal.
 */
export function closeCompareModal() {
  state.compareIds = { left: null, right: null };
  els.app.classList.remove("modal-open");
  document.querySelector("[data-compare-modal]").hidden = true;
}

/**
 * Renders the comparison modal with both candidates side-by-side.
 */
export function renderCompareModal() {
  const candidateA = getCandidate(state.compareIds.left);
  const candidateB = getCandidate(state.compareIds.right);
  if (!candidateA || !candidateB) return;
  
  const compareCard = document.querySelector("[data-compare-card]");
  
  // Render both columns
  compareCard.innerHTML = `
    ${renderCompareColumn(candidateA, "left")}
    ${renderCompareColumn(candidateB, "right")}
    <button class="modal-close" type="button" aria-label="Close comparison">x</button>
  `;
  
  // Wire up close button
  compareCard.querySelector(".modal-close").addEventListener("click", closeCompareModal);
  
  // Attach image fallbacks
  attachImageFallback(compareCard.querySelector('[data-compare-side="left"] .compare-media img'), candidateA.name);
  attachImageFallback(compareCard.querySelector('[data-compare-side="right"] .compare-media img'), candidateB.name);
  
  // Wire up score listeners for both sides
  attachCompareScoreListeners(candidateA, "left");
  attachCompareScoreListeners(candidateB, "right");
}

/**
 * Renders a single column for the comparison modal.
 * @param {Object} candidate - The candidate object to display
 * @param {string} side - "left" or "right"
 * @returns {string} HTML string for the column
 */
function renderCompareColumn(candidate, side) {
  const min = state.min ?? 0;
  const max = state.max ?? 10;
  
  // Sort facets by weight descending so highest-priority criteria appear first
  const sortedFacets = [...state.facets].sort((a, b) => b.weight - a.weight);
  
  // Build score rows
  const reviewRows = sortedFacets.map((facet) => {
    const value = candidate.scores[facet.id] ?? min;
    const id = `compare-${side}-facet-${slugify(facet.id)}`;
    const percent = Math.round((clamp(value, min, max) - min) / (max - min) * 100);
    return `
      <tr>
        <th scope="row">
          <div class="review-feature-heading">
            <label for="${escapeAttr(id)}">${escapeHtml(facet.name)}</label>
            <span>Weight ${escapeHtml(formatNumber(facet.weight))}</span>
          </div>
          <div class="progress-track" data-compare-progress="${escapeAttr(side)}-${escapeAttr(facet.id)}" aria-hidden="true">
            <div class="progress-fill" style="width: ${percent}%"></div>
            <div class="progress-thumb" style="left: ${percent}%"></div>
          </div>
        </th>
        <td>
          <input id="${escapeAttr(id)}" type="number" min="${min}" max="${max}" step="1" inputmode="numeric"
            autocomplete="off" autocapitalize="off" spellcheck="false"
            data-bwignore="true" data-lpignore="true" data-1p-ignore
            value="${escapeAttr(String(value))}" aria-label="${escapeAttr(`${facet.name} score out of ${max}`)}"
            data-compare-input="${escapeAttr(side)}-${escapeAttr(facet.id)}">
        </td>
      </tr>
    `;
  }).join("");
  
  const scoreLabel = `Score <span>/ ${escapeHtml(formatNumber(max))}</span>`;
  const rank = overallRank(candidate);
  
  return `
    <div class="compare-column" data-compare-side="${side}">
      <div class="compare-media">
        <img src="${escapeAttr(candidate.image)}" alt="${escapeAttr(candidate.name)} image">
      </div>
      <div class="compare-meta">
        <div class="pill pill--overall" data-compare-score="${side}">OVERALL ${overallScore(candidate)}</div>
        <div class="pill pill--rank" data-compare-rank="${side}">${escapeHtml(formatRank(rank))}</div>
      </div>
      <h2>${escapeHtml(candidate.name)}</h2>
      <p class="compare-description">${escapeHtml(candidate.description)}</p>
      <div class="compare-table-wrap" aria-label="Review criteria scores">
        <table class="review-table">
          <thead>
            <tr>
              <th scope="col">Criteria</th>
              <th scope="col">${scoreLabel}</th>
            </tr>
          </thead>
          <tbody>
            ${reviewRows}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/**
 * Attaches score input and progress bar listeners for one side of the comparison modal.
 * @param {Object} candidate - The candidate object for this side
 * @param {string} side - "left" or "right"
 */
function attachCompareScoreListeners(candidate, side) {
  const compareCard = document.querySelector("[data-compare-card]");
  
  // In read-only mode, make inputs read-only and skip event listeners
  if (state.readOnly) {
    compareCard.querySelectorAll(`[data-compare-input^="${side}-"]`).forEach((input) => {
      input.readOnly = true;
      input.style.cursor = "default";
    });
    return;
  }
  
  // Wire up number inputs
  compareCard.querySelectorAll(`[data-compare-input^="${side}-"]`).forEach((input) => {
    input.addEventListener("input", () => {
      const facetId = input.dataset.compareInput.replace(`${side}-`, "");
      const facet = state.facets.find((item) => item.id === facetId);
      if (!input.value.trim()) return;
      
      const min = state.min ?? 0;
      const max = state.max ?? 10;
      saveUndo(candidate);
      candidate.scores[facetId] = clamp(toNumber(input.value, min), min, max);
      input.value = candidate.scores[facetId];
      
      // Update progress bar
      const track = compareCard.querySelector(`[data-compare-progress="${side}-${cssEscape(facetId)}"]`);
      if (track && facet) {
        const pct = Math.round((candidate.scores[facetId] - min) / (max - min) * 100);
        track.querySelector(".progress-fill").style.width = `${pct}%`;
        track.querySelector(".progress-thumb").style.left = `${pct}%`;
      }
      
      updateCompareScoresForCandidate(candidate, side);
      syncConfigFromState();
      markDirty();
    });
  });
  
  // Wire up progress bar drag
  compareCard.querySelectorAll(`[data-compare-progress^="${side}-"]`).forEach((track) => {
    track.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      track.setPointerCapture?.(event.pointerId);
      track.classList.add("dragging");
      
      // Save undo snapshot once at the start of the drag
      saveUndo(candidate);
      
      setCompareScoreFromPointer(track, event.clientX, candidate, side);
      
      const onMove = (moveEvent) => {
        setCompareScoreFromPointer(track, moveEvent.clientX, candidate, side);
      };
      const onUp = () => {
        track.classList.remove("dragging");
        track.releasePointerCapture?.(event.pointerId);
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });
  });
}

/**
 * Sets a facet score based on pointer position on the progress bar (for comparison modal).
 * @param {HTMLElement} track - The progress track element
 * @param {number} clientX - The X coordinate of the pointer
 * @param {Object} candidate - The candidate object
 * @param {string} side - "left" or "right"
 */
function setCompareScoreFromPointer(track, clientX, candidate, side) {
  const facetId = track.dataset.compareProgress.replace(`${side}-`, "");
  const facet = state.facets.find((item) => item.id === facetId);
  if (!facet) return;
  
  const rect = track.getBoundingClientRect();
  const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
  const min = state.min ?? 0;
  const max = state.max ?? 10;
  const value = clamp(Math.round(min + ratio * (max - min)), min, max);
  candidate.scores[facetId] = value;
  
  const pct = Math.round((value - min) / (max - min) * 100);
  track.querySelector(".progress-fill").style.width = `${pct}%`;
  track.querySelector(".progress-thumb").style.left = `${pct}%`;
  
  const compareCard = document.querySelector("[data-compare-card]");
  const input = compareCard.querySelector(`[data-compare-input="${side}-${cssEscape(facetId)}"]`);
  if (input) input.value = value;
  
  updateCompareScoresForCandidate(candidate, side);
  syncConfigFromState();
  markDirty();
}

/**
 * Updates the displayed score and rank for a candidate in the comparison modal.
 * @param {Object} candidate - The candidate object whose scores changed
 * @param {string} side - "left" or "right"
 */
function updateCompareScoresForCandidate(candidate, side) {
  const score = overallScore(candidate);
  const compareCard = document.querySelector("[data-compare-card]");
  
  // Update score pills on the board
  document.querySelectorAll(`[data-score-pill="${cssEscape(candidate.id)}"]`).forEach((pill) => {
    pill.textContent = score;
  });
  
  // Update comparison modal score
  const modalScore = compareCard.querySelector(`[data-compare-score="${side}"]`);
  if (modalScore) {
    modalScore.textContent = `OVERALL ${score}`;
  }
  
  // Update comparison modal rank
  const modalRank = compareCard.querySelector(`[data-compare-rank="${side}"]`);
  if (modalRank) {
    modalRank.textContent = formatRank(overallRank(candidate));
  }
}
