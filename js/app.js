/**
 * Application Entry Point
 * 
 * Main application module that bootstraps the tier ranking app, wires up
 * event listeners, and coordinates between the config editor, candidate
 * management, and rendering modules.
 */

import { state, els } from "./state.js";
import { 
  loadConfig, 
  parseConfig, 
  syncConfigFromState, 
  setConfigStatus, 
  formatConfigError,
  openConfigEditor,
  closeConfigEditor,
  hideConfigEditor,
  applyEditorConfig,
  wireConfigEditorControls,
  syncOpenConfigEditor
} from "./config.js";
import { render, renderTierBoard, renderUnranked, initTitleEdit } from "./render.js";
import { openModal, closeModal } from "./modal.js";
import { showToast, slugify } from "./utils.js";
import { initFileMenu, loadMostRecentRanking, closeBurgerMenu } from "./file-menu.js";

let modalTitleFrame = 0;

boot();

/**
 * Bootstraps the application by wiring up controls and loading the initial config.
 * @returns {Promise<void>}
 */
async function boot() {
  wireStaticControls();
  initFileMenu();
  initTitleEdit();
  
  // Try to load the most recent ranking first
  const loaded = await loadMostRecentRanking();
  
  // If no rankings exist, fall back to default config
  if (!loaded) {
    const config = await loadConfig({ fallbackToDefault: true });
    applyConfig(config);
  }
}

/**
 * Wires up all static event listeners for the application controls,
 * including config editor, add candidate modal, keyboard shortcuts, and window resize.
 */
function wireStaticControls() {
  els.openConfig.addEventListener("click", () => { closeBurgerMenu(); openConfigEditor(); });
  els.resetConfig.addEventListener("click", () => { closeBurgerMenu(); resetFromDisk(); });
  els.closeConfig.addEventListener("click", hideConfigEditor); // X button - preserves draft
  els.cancelConfig.addEventListener("click", closeConfigEditor); // Cancel button - discards draft
  els.applyConfigEdit.addEventListener("click", applyEditorConfig);

  wireConfigEditorControls();

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
  });

  window.addEventListener("resize", () => {
    if (!els.modal.hidden) {
      window.cancelAnimationFrame(modalTitleFrame);
      modalTitleFrame = window.requestAnimationFrame(fitModalTitle);
    }
  });
}

/**
 * Reloads the config from disk and applies it to the application state.
 * @returns {Promise<void>}
 */
async function resetFromDisk() {
  els.resetConfig.disabled = true;
  try {
    const config = await loadConfig();
    applyConfig(config);
    syncOpenConfigEditor();
    setConfigStatus(`Reloaded ${config.source}.`, "ok");
    showToast(`Reset from ${config.source}.`);
  } catch {
    if (!els.configModal.hidden) {
      setConfigStatus("Could not reload ranking JSON file.", "error");
    }
    showToast("Could not refresh ranking JSON file.");
  } finally {
    els.resetConfig.disabled = false;
  }
}

/**
 * Applies a parsed config object to the application state and re-renders the UI.
 * @param {Object} config - The config object containing text, format, and source
 */
function applyConfig(config) {
  const parsed = parseConfig(config.text, config.format);
  state.title = parsed.title;
  state.tiers = parsed.tiers;
  state.facets = parsed.facets;
  state.candidates = parsed.candidates;
  state.min = parsed.min ?? 0;   // Add support for min/max from config
  state.max = parsed.max ?? 10;
  state.configText = config.text;
  state.configFormat = config.format;
  state.configSource = config.source;
  state.selectedId = null;
  closeModal();
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
      
      const response = await fetch("/api/uploadimg", {
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
  state.facets.forEach((facet) => {
    scores[facet.id] = 0;
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


