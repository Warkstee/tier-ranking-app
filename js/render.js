/**
 * Rendering Module
 * 
 * Handles all UI rendering for the tier ranking board, including tier lanes,
 * candidate cards, and score calculations.
 */

import { state, els } from "./state.js";
import { escapeHtml, escapeAttr, formatNumber, clamp, toNumber } from "./utils.js";
import { attachPointer } from "./drag.js";

/**
 * Main render function that updates the title and re-renders the entire board.
 */
export function render() {
  // Ensure the h1 title element exists (it may have been replaced by an input during editing)
  let titleEl = document.querySelector("[data-title]");
  if (!titleEl) {
    titleEl = document.createElement("h1");
    titleEl.setAttribute("data-title", "");
    const brandCopy = document.querySelector(".brand-copy");
    if (brandCopy) {
      brandCopy.insertBefore(titleEl, brandCopy.querySelector(".title-edit-btn"));
    }
    els.title = titleEl;
  }
  titleEl.textContent = state.title;
  renderTierBoard();
  renderUnranked();
}

/**
 * Enable inline title editing mode.
 * Replaces the h1 with an input field for editing.
 */
export function enableTitleEdit() {
  const h1 = els.title;
  const parent = h1.parentElement;
  
  // Create input field
  const input = document.createElement("input");
  input.type = "text";
  input.className = "title-edit-input";
  input.value = state.title;
  input.setAttribute("aria-label", "Edit board title");
  
  // Replace h1 with input
  h1.replaceWith(input);
  input.focus();
  input.select();
  
  // Save on Enter
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveTitleEdit(input.value.trim());
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelTitleEdit();
    }
  });
  
  // Save on blur
  input.addEventListener("blur", () => {
    saveTitleEdit(input.value.trim());
  });
}

/**
 * Save the edited title and restore the h1 element.
 */
function saveTitleEdit(newTitle) {
  // Remove the input field before rendering
  const input = document.querySelector(".title-edit-input");
  if (input) {
    input.remove();
  }
  
  if (!newTitle) {
    cancelTitleEdit();
    return;
  }
  
  state.title = newTitle;
  render();
}

/**
 * Cancel title editing and restore the original title.
 */
function cancelTitleEdit() {
  const input = document.querySelector(".title-edit-input");
  if (input) {
    input.remove();
  }
  render();
}

/**
 * Initialize title edit button event listener.
 */
export function initTitleEdit() {
  if (els.titleEditBtn) {
    els.titleEditBtn.addEventListener("click", enableTitleEdit);
  }
}

/**
 * Renders the tier board with all tier lanes and their candidate cards.
 */
export function renderTierBoard() {
  els.tierBoard.replaceChildren();
  state.tiers.forEach((tier) => {
    const lane = document.createElement("section");
    lane.className = "tier-lane";
    lane.dataset.tierLane = tier;

    const label = document.createElement("div");
    label.className = "tier-label";
    label.dataset.tier = tier;
    label.textContent = tier;

    const cards = document.createElement("div");
    cards.className = "tier-cards";
    cards.dataset.dropZone = tier;
    cards.dataset.tierCards = tier;

    const candidates = state.candidates.filter((candidate) => candidate.tier === tier);
    if (candidates.length) {
      candidates.forEach((candidate) => cards.append(createCandidateCard(candidate)));
    } else {
      const empty = document.createElement("div");
      empty.className = "tier-empty";
      empty.textContent = "drop";
      cards.append(empty);
    }

    lane.append(label, cards);
    els.tierBoard.append(lane);
  });
}

/**
 * Renders the unranked candidates list in the right rail.
 */
export function renderUnranked() {
  const unranked = state.candidates.filter((candidate) => candidate.tier === "Unranked");
  els.unrankedList.replaceChildren();
  unranked.forEach((candidate) => els.unrankedList.append(createCandidateRow(candidate)));
  els.unrankedCount.textContent = `${unranked.length} of ${state.candidates.length}`;
}

/**
 * Creates a candidate card element for display in a tier lane.
 * @param {Object} candidate - The candidate object to render
 * @returns {HTMLElement} The candidate card element
 */
export function createCandidateCard(candidate) {
  const card = document.createElement("article");
  card.className = "candidate-card";
  card.dataset.candidateId = candidate.id;
  card.dataset.draggableCandidate = candidate.id;
  card.innerHTML = `
    <img src="${escapeAttr(candidate.image)}" alt="${escapeAttr(candidate.name)} image">
    <span class="score-pill" data-score-pill="${escapeAttr(candidate.id)}">${overallScore(candidate)}</span>
    <h3>${escapeHtml(candidate.name)}</h3>
  `;
  attachPointer(card, candidate.id);
  return card;
}

/**
 * Creates a candidate row element for display in the unranked list.
 * @param {Object} candidate - The candidate object to render
 * @returns {HTMLElement} The candidate row element
 */
export function createCandidateRow(candidate) {
  const row = document.createElement("article");
  row.className = "candidate-row";
  row.dataset.candidateId = candidate.id;
  row.dataset.draggableCandidate = candidate.id;
  row.innerHTML = `
    <img src="${escapeAttr(candidate.image)}" alt="${escapeAttr(candidate.name)} image">
    <div>
      <h3>${escapeHtml(candidate.name)}</h3>
      <p>${escapeHtml(candidate.description)}</p>
    </div>
    <span class="score-pill" data-score-pill="${escapeAttr(candidate.id)}">${overallScore(candidate)}</span>
  `;
  attachPointer(row, candidate.id);
  return row;
}

/**
 * Calculates the overall weighted score for a candidate.
 * @param {Object} candidate - The candidate object
 * @returns {number} The overall score (0-100)
 */
export function overallScore(candidate) {
  const min = state.min ?? 0;
  const max = state.max ?? 10;
  const range = max - min || 1;
  const weighted = state.facets.reduce((total, facet) => {
    const value = clamp(toNumber(candidate.scores[facet.id], min), min, max);
    return total + ((value - min) / range) * 100 * facet.weight;
  }, 0);
  const weight = state.facets.reduce((total, facet) => total + facet.weight, 0) || 1;
  return Math.round(weighted / weight);
}

/**
 * Calculates the rank of a candidate among all candidates.
 * @param {Object} candidate - The candidate object
 * @returns {Object} Rank information with rank, total, and tied properties
 */
export function overallRank(candidate) {
  const score = overallScore(candidate);
  const scores = state.candidates.map((item) => overallScore(item));
  const higher = scores.filter((itemScore) => itemScore > score).length;
  const tied = scores.filter((itemScore) => itemScore === score).length;
  return {
    rank: higher + 1,
    total: state.candidates.length,
    tied: tied > 1
  };
}

/**
 * Formats a rank object into a display string.
 * @param {Object} rank - The rank object from overallRank
 * @returns {string} Formatted rank string (e.g., "RANK #1 / 10" or "TIED #2 / 10")
 */
export function formatRank(rank) {
  const label = rank.tied ? "TIED" : "RANK";
  return `${label} #${rank.rank} / ${rank.total}`;
}

/**
 * Finds a candidate by ID.
 * @param {string} candidateId - The candidate ID to find
 * @returns {Object|undefined} The candidate object or undefined if not found
 */
export function getCandidate(candidateId) {
  return state.candidates.find((candidate) => candidate.id === candidateId);
}
