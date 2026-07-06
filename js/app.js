/**
 * Application Entry Point
 * 
 * Main application module that bootstraps the tier ranking app, wires up
 * event listeners, and coordinates between the config editor, candidate
 * management, and rendering modules.
 */

import { state, els, DEFAULT_CONFIG, markDirty } from "./state.js";
import { 
  parseConfig, 
  syncConfigFromState, 
  setConfigStatus, 
  formatConfigError,
  openConfigEditor,
  closeConfigEditor,
  hideConfigEditor,
  applyEditorConfig,
  wireConfigEditorControls,
  syncOpenConfigEditor,
  openTierEditor,
  closeTierEditor,
  hideTierEditor,
  applyTierEditor,
  addTier,
  wireTierEditorControls
} from "./config.js";
import { render, renderTierBoard, renderUnranked, initTitleEdit } from "./render.js";
import { openModal, closeModal } from "./detail-modal.js";
import { openCompareModal } from "./compare-modal.js";
import { wireAhpControls, undoAhpSlider } from "./ahp.js";
import { showToast, slugify } from "./utils.js";
import { initFileMenu, loadMostRecentRanking, closeBurgerMenu, saveRankingToServer } from "./file-menu.js";
import { wireShareModalControls } from "./share-modal.js";
import { initAuth, apiFetch } from "./auth.js";
import { undo, clearUndo } from "./undo.js";

let modalTitleFrame = 0;

boot();

// Listen for successful authentication to initialize the app
window.addEventListener('auth:authenticated', () => {
  initializeApp();
});

/**
 * Bootstraps the application by checking authentication and initializing if needed.
 * @returns {Promise<void>}
 */
async function boot() {
  // Check if we're accessing a shared ranking
  const sharedPath = window.location.pathname.match(/^\/shared\/(.+)$/);
  if (sharedPath) {
    const token = sharedPath[1];
    await loadSharedRanking(token);
    return;
  }

  // Initialize authentication first
  const isAuthenticated = await initAuth();
  
  // If not authenticated, stop here (auth UI will be shown)
  if (!isAuthenticated) {
    return;
  }
  
  // User is authenticated, initialize the app
  await initializeApp();
}

/**
 * Loads a shared ranking in read-only mode.
 * @param {string} token - The share token from the URL
 */
async function loadSharedRanking(token) {
  try {
    const res = await fetch(`/api/shared/${token}`);
    
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed to load shared ranking" }));
      showToast(err.error || "Failed to load shared ranking");
      return;
    }

    const { title, data } = await res.json();
    
    // Set read-only mode
    state.readOnly = true;
    document.body.classList.add("read-only-mode");
    
    // Apply the ranking data
    state.title = title || data.title || "Shared Ranking";
    state.tiers = data.tiers || state.tiers;
    state.criteria = data.criteria || [];
    
    // Fix image paths - convert relative paths to absolute for shared view
    state.candidates = (data.candidates || []).map(candidate => ({
      ...candidate,
      image: candidate.image?.startsWith('./') ? candidate.image.replace('./', '/') : candidate.image
    }));
    
    state.min = data.min ?? 0;
    state.max = data.max ?? 10;
    state.ahpComparisons = data.ahpComparisons || {};
    state.configText = data.configText || DEFAULT_CONFIG;
    state.configSource = "shared ranking";
    state.selectedId = null;
    
    // Wire up controls and render
    wireStaticControls();
    initTitleEdit();
    render();
    
    // Hide mutation UI elements
    hideMutationUI();
    
    // Show read-only indicator in filename pill
    showReadOnlyIndicator();
  } catch (err) {
    console.error("Failed to load shared ranking:", err);
    showToast("Failed to load shared ranking");
  }
}

/**
 * Hides UI elements that allow mutations in read-only mode.
 */
function hideMutationUI() {
  // Hide burger menu (contains File menu, config, tier editor, reset)
  if (els.burgerButton) els.burgerButton.hidden = true;
  
  // Hide add candidate button
  if (els.openAddCandidate) els.openAddCandidate.hidden = true;
  
  // Hide title edit button
  if (els.titleEditBtn) els.titleEditBtn.hidden = true;
}

/**
 * Shows a read-only indicator in the filename pill area.
 */
function showReadOnlyIndicator() {
  if (els.fileStatus) {
    els.fileStatus.textContent = "Read-only";
    els.fileStatus.className = "file-status-pill read-only";
  }
}

/**
 * Initializes the application by wiring up controls and loading the initial config.
 * Called after successful authentication.
 * @returns {Promise<void>}
 */
export async function initializeApp() {
  // Wire up all controls
  wireStaticControls();
  initFileMenu();
  initTitleEdit();
  
  // Try to load the most recent ranking first
  const loaded = await loadMostRecentRanking();
  
  // If no rankings exist, use the bundled default config
  if (!loaded) {
    const config = { text: DEFAULT_CONFIG, format: "json", source: "bundled config" };
    applyConfig(config);
  }
}

/**
 * Wires up all static event listeners for the application controls,
 * including config editor, add candidate modal, keyboard shortcuts, and window resize.
 */
function wireStaticControls() {
  els.openConfig.addEventListener("click", () => { closeBurgerMenu(); openConfigEditor(); });
  els.openTierEditor.addEventListener("click", () => { closeBurgerMenu(); openTierEditor(); });
  els.resetConfig.addEventListener("click", () => { closeBurgerMenu(); resetScoresAndRankings(); });
  els.closeConfig.addEventListener("click", hideConfigEditor); // X button - preserves draft
  els.cancelConfig.addEventListener("click", closeConfigEditor); // Cancel button - discards draft
  els.applyConfigEdit.addEventListener("click", applyEditorConfig);
  els.closeTierEditor.addEventListener("click", hideTierEditor); // X button - preserves draft
  els.cancelTier.addEventListener("click", closeTierEditor); // Cancel button - discards draft
  els.applyTierEditor.addEventListener("click", applyTierEditor);
  els.addTier.addEventListener("click", addTier);

  wireConfigEditorControls();
  wireTierEditorControls();
  wireAhpControls();
  wireShareModalControls();

  els.addNameInput.addEventListener("input", () => {
    const remaining = 23 - els.addNameInput.value.length;
    const counter = document.querySelector("[data-add-char-counter]");
    if (counter) {
      counter.textContent = `${remaining} character${remaining !== 1 ? "s" : ""} remaining`;
      counter.dataset.tone = remaining <= 5 ? "warning" : "";
    }
  });

  // Candidate modal handlers
  els.openAddCandidate.addEventListener("click", openAddCandidateModal);
  els.closeAddCandidate.addEventListener("click", closeAddCandidateModal);
  els.cancelAddCandidate.addEventListener("click", closeAddCandidateModal);
  els.addCandidateForm.addEventListener("submit", handleAddCandidateSubmit);

  // Disable Add button until name is entered
  els.addNameInput.addEventListener("input", () => {
    els.submitAddCandidate.disabled = !els.addNameInput.value.trim();
  });

  els.modal.addEventListener("click", (event) => {
    if (event.target === els.modal) {
      closeModal();
    }
  });

  els.addCandidateModal.addEventListener("click", (event) => {
    if (event.target === els.addCandidateModal) {
      closeAddCandidateModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (!els.configModal.hidden) {
        hideConfigEditor(); // Escape key - preserves draft
      } else if (!els.addCandidateModal.hidden) {
        closeAddCandidateModal();
      } else if (!els.modal.hidden) {
        closeModal();
      }
    }

    // Ctrl+Z / Cmd+Z — undo last tier move, score change, or AHP slider adjustment
    if ((event.ctrlKey || event.metaKey) && event.key === "z") {
      const tag = document.activeElement?.tagName;
      if (tag === "TEXTAREA" || (tag === "INPUT" && document.activeElement.type === "text")) {
        return; // Let the browser handle native text undo in text fields
      }
      event.preventDefault();
      // If AHP modal is open, undo the last slider adjustment
      if (!els.ahpModal.hidden) {
        undoAhpSlider();
      } else {
        undo();
      }
    }
  });

  window.addEventListener("resize", () => {
    if (!els.modal.hidden) {
      window.cancelAnimationFrame(modalTitleFrame);
      modalTitleFrame = window.requestAnimationFrame(fitModalTitle);
    }
  });
}

/**
 * Resets all candidate scores to minimum and moves them to unranked.
 * Shows confirmation dialog before proceeding.
 * @returns {Promise<void>}
 */
async function resetScoresAndRankings() {
  const confirmed = confirm(
    "This will reset all scores to their minimum values and move all candidates to the unranked pool. This action cannot be undone. Continue?"
  );
  
  if (!confirmed) return;
  
  els.resetConfig.disabled = true;
  
  try {
    // Reset all candidates
    state.candidates.forEach(candidate => {
      // Reset all criterion scores to minimum
      if (candidate.scores) {
        Object.keys(candidate.scores).forEach(criterionId => {
          candidate.scores[criterionId] = state.min;
        });
      }
      
      // Move to unranked
      candidate.tierId = null;
    });
    
    // Re-render the UI
    render();
    
    // Auto-save if we have a ranking name
    if (state.currentRankingName) {
      await saveRankingToServer(state.currentRankingName);
      showToast("All scores and rankings have been reset and saved.");
    } else {
      showToast("All scores and rankings have been reset.");
    }
  } catch (error) {
    console.error("Failed to reset scores and rankings:", error);
    showToast("Reset completed but failed to auto-save. Please save manually.");
  } finally {
    els.resetConfig.disabled = false;
  }
}

/**
 * Applies a parsed config object to the application state and re-renders the UI.
 * @param {Object} config - The config object containing text and source
 */
function applyConfig(config) {
  const parsed = parseConfig(config.text);
  state.title = parsed.title;
  state.tiers = parsed.tiers;
  state.criteria = parsed.criteria;
  state.candidates = parsed.candidates;
  state.min = parsed.min ?? 0;   // Add support for min/max from config
  state.max = parsed.max ?? 10;
  state.ahpComparisons = parsed.ahpComparisons || {};
  state.configText = config.text;
  state.configSource = config.source;
  state.selectedId = null;
  closeModal();
  clearUndo();
  render();
}

/**
 * Opens the add candidate modal and resets the form.
 */
function openAddCandidateModal() {
  closeModal();
  closeConfigEditor();
  els.addCandidateForm.reset();
  els.addCandidateModal.hidden = false;
  els.addNameInput.focus();
  // Disable Add button until name is entered
  els.submitAddCandidate.disabled = !els.addNameInput.value.trim();
}

/**
 * Closes the add candidate modal and resets the form.
 */
function closeAddCandidateModal() {
  els.addCandidateModal.hidden = true;
  els.addCandidateForm.reset();
}

/**
 * Handles the add candidate form submission, uploads the image if provided,
 * creates a new candidate with the entered data, and adds it to the unranked list.
 * @param {Event} event - The form submit event
 * @returns {Promise<void>}
 */
async function handleAddCandidateSubmit(event) {
  event.preventDefault();
  
  const name = els.addNameInput.value.trim();
  if (!name) return;

  const imageFile = els.addImageInput.files[0];
  let imagePath = "";

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
      imagePath = result.path;
    } catch (err) {
      console.error("Failed to upload image:", err);
      showToast(`Could not upload image: ${err.message}`);
      return;
    }
  }

  const baseId = slugify(name);
  let candidateId = `${baseId}-${Date.now()}`;
  
  while (state.candidates.some(c => c.id === candidateId)) {
    candidateId = `${baseId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }

  const scores = {};
  state.criteria.forEach((criterion) => {
    scores[criterion.id] = 0;
  });

  const newCandidate = {
    id: candidateId,
    name,
    image: imagePath || "",
    description: "",
    tier: "Unranked",
    scores
  };

  state.candidates.push(newCandidate);
  renderUnranked();
  syncConfigFromState();
  markDirty();
  closeAddCandidateModal();
  showToast(`Added "${name}" to Unranked.`);
}

/**
 * Adjusts the modal title font size to fit within the available width.
 * Uses a binary search approach to find the optimal font size.
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


