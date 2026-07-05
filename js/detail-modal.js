/**
 * Modal Module
 * 
 * Handles the candidate detail modal, including viewing, editing, scoring,
 * and deletion of candidates. Provides interactive score adjustment via
 * progress bars and input fields.
 */

import { state, els, markDirty } from "./state.js";
import { escapeHtml, escapeAttr, cssEscape, clamp, toNumber, slugify, formatNumber, showToast } from "./utils.js";
import { renderTierBoard, renderUnranked, getCandidate, overallScore, overallRank, formatRank, attachImageFallback } from "./render.js";
import { syncConfigFromState } from "./config.js";
import { apiFetch } from "./auth.js";
import { saveUndo } from "./undo.js";

let editMode = false;

/**
 * Opens the detail modal for a specific candidate.
 * @param {string} candidateId - The ID of the candidate to display
 */
export function openModal(candidateId) {
  const candidate = getCandidate(candidateId);
  if (!candidate) return;
  state.selectedId = candidateId;
  els.app.classList.add("modal-open");
  els.modal.hidden = false;
  renderModal(candidate);
}

/**
 * Closes the detail modal and resets the edit mode.
 */
export function closeModal() {
  state.selectedId = null;
  els.app.classList.remove("modal-open");
  els.modal.hidden = true;
  editMode = false;
}

/**
 * Renders the candidate detail modal content, either in view or edit mode.
 * @param {Object} candidate - The candidate object to display
 */
export function renderModal(candidate) {
  // If in edit mode, delegate to the edit modal renderer
  if (editMode) {
    renderEditModal(candidate);
    return;
  }

  // Use global min/max for consistent score labeling
  const min = state.min ?? 0;
  const max = state.max ?? 10;

  // Build HTML for each facet's score row with progress bar and input field
  const reviewRows = state.facets.map((facet) => {
    const value = candidate.scores[facet.id] ?? min;
    const id = `facet-${slugify(facet.id)}`;
    const percent = Math.round((clamp(value, min, max) - min) / (max - min) * 100);
    return `
      <tr>
        <th scope="row">
          <div class="review-feature-heading">
            <label for="${escapeAttr(id)}">${escapeHtml(facet.name)}</label>
            <span>Weight ${escapeHtml(formatNumber(facet.weight))}</span>
          </div>
          <div class="progress-track" data-progress-track="${escapeAttr(facet.id)}" aria-hidden="true">
            <div class="progress-fill" style="width: ${percent}%"></div>
            <div class="progress-thumb" style="left: ${percent}%"></div>
          </div>
        </th>
        <td>
          <input id="${escapeAttr(id)}" type="number" min="${min}" max="${max}" step="1" inputmode="numeric"
            autocomplete="off" autocapitalize="off" spellcheck="false"
            data-bwignore="true" data-lpignore="true" data-1p-ignore
            value="${escapeAttr(String(value))}" aria-label="${escapeAttr(`${facet.name} score out of ${max}`)}"
            data-score-input="${escapeAttr(facet.id)}">
        </td>
      </tr>
    `;
  }).join("");

  // Format the score column header
  const scoreLabel = `Score <span>/ ${escapeHtml(formatNumber(max))}</span>`;
  const rank = overallRank(candidate);

  // Render the complete candidate details modal HTML structure with image, controls, title, description and score table
  // Hide edit/delete buttons in read-only mode
  const actionButtons = state.readOnly ? '' : `
      <button class="modal-edit" type="button" aria-label="Edit ${escapeAttr(candidate.name)}">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
        </svg>
      </button>
      <button class="modal-delete" type="button" aria-label="Delete ${escapeAttr(candidate.name)}">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      </button>
  `;
  
  els.detailCard.innerHTML = `
    <div class="detail-media">
      <img src="${escapeAttr(candidate.image)}" alt="${escapeAttr(candidate.name)} image">
    </div>
    <div class="detail-body">
      ${actionButtons}
      <button class="modal-close" type="button" aria-label="Close">x</button>
      <div class="detail-meta">
        <div class="pill pill--overall" data-modal-score>OVERALL ${overallScore(candidate)}</div>
        <div class="pill pill--rank" data-modal-rank>${escapeHtml(formatRank(rank))}</div>
      </div>
      <h2 data-modal-title>${escapeHtml(candidate.name)}</h2>
      <p class="detail-description">${escapeHtml(candidate.description)}</p>
      <div class="review-table-wrap" aria-label="Review criteria scores">
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

  // Adjust title font size to fit within available width
  fitModalTitle();

  // Attach image fallback
  attachImageFallback(els.detailCard.querySelector(".detail-media img"), candidate.name);

  // Wire up edit button to switch to edit mode
  const editBtn = els.detailCard.querySelector(".modal-edit");
  if (editBtn) {
    editBtn.addEventListener("click", () => {
      editMode = true;
      renderModal(candidate);
    });
  }

  // Wire up delete button to remove the candidate
  const deleteBtn = els.detailCard.querySelector(".modal-delete");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", () => {
      deleteCandidate(candidate.id);
      markDirty();
    });
  }

  // Wire up close button to close the modal
  els.detailCard.querySelector(".modal-close").addEventListener("click", closeModal);

  // Wire up score input fields to update candidate scores on change
  // In read-only mode, make inputs read-only and skip event listeners
  els.detailCard.querySelectorAll("[data-score-input]").forEach((input) => {
    if (state.readOnly) {
      input.readOnly = true;
      input.style.cursor = "default";
      return;
    }
    
    input.addEventListener("input", () => {
      const facetId = input.dataset.scoreInput;
      const facet = state.facets.find((item) => item.id === facetId);
      if (!input.value.trim()) return;
      const min = state.min ?? 0;
      const max = state.max ?? 10;
      saveUndo(candidate);
      candidate.scores[facetId] = clamp(toNumber(input.value, min), min, max);
      input.value = candidate.scores[facetId];
      const track = els.detailCard.querySelector(`[data-progress-track="${cssEscape(facetId)}"]`);
      if (track && facet) {
        const pct = Math.round((candidate.scores[facetId] - min) / (max - min) * 100);
        track.querySelector(".progress-fill").style.width = `${pct}%`;
        track.querySelector(".progress-thumb").style.left = `${pct}%`;
      }
      updateScoresForCandidate(candidate);
      syncConfigFromState();
      markDirty();
    });
  });

  // Wire up progress track click handlers for quick score adjustment
  // Skip in read-only mode
  if (!state.readOnly) {
    // Wire up progress track drag handlers for continuous score adjustment
    els.detailCard.querySelectorAll("[data-progress-track]").forEach((track) => {
      track.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        track.setPointerCapture?.(event.pointerId);
        track.classList.add("dragging");
        
        // Save undo snapshot once at the start of the drag
        const candidate = getCandidate(state.selectedId);
        if (candidate) saveUndo(candidate);
        
        setScoreFromPointer(track, event.clientX);

        const onMove = (moveEvent) => {
          setScoreFromPointer(track, moveEvent.clientX);
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
}

/**
 * Renders the edit mode UI for modifying candidate details.
 * @param {Object} candidate - The candidate object to edit
 */
function renderEditModal(candidate) {
  els.detailCard.innerHTML = `
    <div class="detail-media">
      <img src="${escapeAttr(candidate.image)}" alt="${escapeAttr(candidate.name)} image">
      <div class="edit-image-upload">
        <div class="form-field">
          <label for="edit-candidate-image">Change image (optional)</label>
          <input type="file" id="edit-candidate-image" accept="image/jpeg,image/png,image/gif,image/webp" data-edit-image-input>
        </div>
      </div>
    </div>
    <div class="detail-body">
      <div class="edit-fields">
        <div class="form-field">
          <label for="edit-candidate-name">Name</label>
          <input type="text" id="edit-candidate-name" value="${escapeAttr(candidate.name)}" required maxlength="23" autocomplete="off" spellcheck="false" data-edit-name-input>
          <span class="char-counter" data-edit-char-counter>${23 - candidate.name.length} characters remaining</span>
        </div>
        <div class="form-field">
          <label for="edit-candidate-description">Description</label>
          <textarea id="edit-candidate-description" rows="4" maxlength="325" data-edit-description-input>${escapeHtml(candidate.description)}</textarea>
          <span class="char-counter" data-edit-description-counter>${Math.max(0, 325 - candidate.description.length)} characters remaining</span>
        </div>
      </div>
      <div class="edit-actions">
        <button class="modal-cancel" type="button">Cancel</button>
        <button class="modal-save" type="button">Save</button>
      </div>
    </div>
  `;

  const nameInput = els.detailCard.querySelector("[data-edit-name-input]");
  const charCounter = els.detailCard.querySelector("[data-edit-char-counter]");
  const descriptionInput = els.detailCard.querySelector("[data-edit-description-input]");
  const descriptionCounter = els.detailCard.querySelector("[data-edit-description-counter]");

  nameInput.addEventListener("input", () => {
    const remaining = 23 - nameInput.value.length;
    charCounter.textContent = `${remaining} character${remaining !== 1 ? "s" : ""} remaining`;
    charCounter.dataset.tone = remaining <= 5 ? "warning" : "";
  });

  const updateDescriptionCounter = () => {
    const remaining = 325 - descriptionInput.value.length;
    descriptionCounter.textContent = `${remaining} character${remaining !== 1 ? "s" : ""} remaining`;
    descriptionCounter.dataset.tone = remaining <= 20 ? "warning" : "";
  };

  descriptionInput.addEventListener("input", () => {
    if (descriptionInput.value.length > 325) {
      descriptionInput.value = descriptionInput.value.slice(0, 325);
    }
    updateDescriptionCounter();
  });

  nameInput.focus();
  nameInput.select();

  updateDescriptionCounter();

  // Attach image fallback
  attachImageFallback(els.detailCard.querySelector(".detail-media img"), candidate.name);

  els.detailCard.querySelector(".modal-save").addEventListener("click", () => {
    handleEditSave(candidate);
  });
  els.detailCard.querySelector(".modal-cancel").addEventListener("click", () => {
    editMode = false;
    renderModal(candidate);
  });
}

/**
 * Handles saving edited candidate details, including image upload.
 * @param {Object} candidate - The candidate object being edited
 * @returns {Promise<void>}
 */
async function handleEditSave(candidate) {
  const nameInput = els.detailCard.querySelector("[data-edit-name-input]");
  const descriptionInput = els.detailCard.querySelector("[data-edit-description-input]");
  const imageInput = els.detailCard.querySelector("[data-edit-image-input]");

  const name = nameInput.value.trim();
  if (!name) {
    showToast("Name is required.");
    nameInput.focus();
    return;
  }

  const imageFile = imageInput.files[0];
  if (imageFile) {
    try {
      const formData = new FormData();
      formData.append("image", imageFile);
      
      const response = await apiFetch("/api/uploadimg", {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        let errorMessage = `Upload failed (${response.status})`;
        try {
          const error = await response.json();
          errorMessage = error.error || errorMessage;
        } catch {
          if (response.status === 413) {
            errorMessage = "File too large (max 5MB)";
          }
        }
        throw new Error(errorMessage);
      }

      const result = await response.json();
      candidate.image = result.path;
    } catch (err) {
      console.error("Failed to upload image:", err);
      showToast(`Could not upload image: ${err.message}`);
      return;
    }
  }

  candidate.name = name;
  candidate.description = descriptionInput.value.trim().slice(0, 325);

  editMode = false;
  renderTierBoard();
  renderUnranked();
  syncConfigFromState();
  renderModal(candidate);
  showToast(`Updated "${name}".`);
}

/**
 * Adjusts the modal title font size to fit within the available width.
 */
function fitModalTitle() {
  const title = els.detailCard.querySelector("[data-modal-title]");
  if (!title) return;

  title.style.fontSize = "";
  const baseSize = parseFloat(window.getComputedStyle(title).fontSize) || 64;
  const minSize = 24;
  title.style.fontSize = `${baseSize}px`;

  const availableWidth = title.clientWidth;
  if (!availableWidth || title.scrollWidth <= availableWidth) return;

  let fittedSize = Math.max(minSize, Math.floor(baseSize * (availableWidth / title.scrollWidth)));
  title.style.fontSize = `${fittedSize}px`;

  while (title.scrollWidth > availableWidth && fittedSize > minSize) {
    fittedSize -= 1;
    title.style.fontSize = `${fittedSize}px`;
  }
}

/**
 * Sets a facet score based on pointer position on the progress bar.
 * @param {HTMLElement} track - The progress track element
 * @param {number} clientX - The X coordinate of the pointer
 */
function setScoreFromPointer(track, clientX) {
  const facetId = track.dataset.progressTrack;
  const facet = state.facets.find((item) => item.id === facetId);
  if (!facet) return;
  const candidate = getCandidate(state.selectedId);
  if (!candidate) return;
  const rect = track.getBoundingClientRect();
  const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
  const min = state.min ?? 0;
  const max = state.max ?? 10;
  const value = clamp(Math.round(min + ratio * (max - min)), min, max);
  candidate.scores[facetId] = value;
  const pct = Math.round((value - min) / (max - min) * 100);
  track.querySelector(".progress-fill").style.width = `${pct}%`;
  track.querySelector(".progress-thumb").style.left = `${pct}%`;
  const input = els.detailCard.querySelector(`[data-score-input="${cssEscape(facetId)}"]`);
  if (input) input.value = value;
  updateScoresForCandidate(candidate);
  syncConfigFromState();
}

/**
 * Updates the displayed score and rank for a candidate in the modal.
 * @param {Object} candidate - The candidate object whose scores changed
 */
function updateScoresForCandidate(candidate) {
  const score = overallScore(candidate);
  document.querySelectorAll(`[data-score-pill="${cssEscape(candidate.id)}"]`).forEach((pill) => {
    pill.textContent = score;
  });
  const modalScore = els.detailCard.querySelector("[data-modal-score]");
  if (modalScore) {
    modalScore.textContent = `OVERALL ${score}`;
  }
  const modalRank = els.detailCard.querySelector("[data-modal-rank]");
  if (modalRank) {
    modalRank.textContent = formatRank(overallRank(candidate));
  }
}

/**
 * Deletes a candidate after confirmation.
 * @param {string} candidateId - The ID of the candidate to delete
 */
function deleteCandidate(candidateId) {
  const candidate = getCandidate(candidateId);
  if (!candidate) return;
  
  if (!window.confirm(`Delete "${candidate.name}"? This cannot be undone.`)) {
    return;
  }
  
  state.candidates = state.candidates.filter((c) => c.id !== candidateId);
  renderTierBoard();
  renderUnranked();
  syncConfigFromState();
  closeModal();
  showToast(`Deleted "${candidate.name}".`);
}
