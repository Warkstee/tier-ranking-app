/**
 * File Menu Component
 * 
 * Handles file operations for managing multiple rankings:
 * - Create new rankings
 * - Open existing rankings
 * - Save current ranking
 * - Save ranking with new name
 * - Delete rankings
 */

import { state, els } from "./state.js";
import { syncConfigFromState } from "./config.js";
import { render } from "./render.js";
import { showToast } from "./utils.js";

let nameInputCallback = null;

/**
 * Initialize file menu event listeners
 */
let submenuCloseTimer = null;
let flyoutCloseTimer = null;
let flyoutMode = "open";

export function initFileMenu() {
  // Burger menu dropdown toggle
  els.burgerButton.addEventListener("click", toggleBurgerMenu);

  // File submenu toggle — use timer to avoid closing when moving between parent and submenu
  const fileSubmenuItem = document.querySelector('[data-submenu="file"]');
  const fileSubmenuPanel = document.querySelector('[data-submenu-panel="file"]');

  if (fileSubmenuItem && fileSubmenuPanel) {
    fileSubmenuItem.addEventListener("mouseenter", () => {
      clearTimeout(submenuCloseTimer);
      openFileSubmenu();
    });
    fileSubmenuItem.addEventListener("mouseleave", (event) => {
      // Don't close if moving into the submenu panel
      if (event.relatedTarget && fileSubmenuPanel.contains(event.relatedTarget)) return;
      submenuCloseTimer = setTimeout(() => closeFileSubmenu(), 100);
    });
    fileSubmenuPanel.addEventListener("mouseenter", () => {
      clearTimeout(submenuCloseTimer);
    });
    fileSubmenuPanel.addEventListener("mouseleave", () => {
      submenuCloseTimer = setTimeout(() => closeFileSubmenu(), 100);
    });
  }

  // Ranking flyout hover — show on hover over "Open File..." or "Delete File..." wrappers
  const flyoutTriggers = document.querySelectorAll('[data-flyout-trigger]');
  if (flyoutTriggers.length && els.rankingFlyout) {
    flyoutTriggers.forEach(trigger => {
      trigger.addEventListener("mouseenter", () => {
        clearTimeout(flyoutCloseTimer);
        flyoutMode = trigger.dataset.flyoutTrigger || "open";
        showRankingFlyout();
      });
      trigger.addEventListener("mouseleave", () => {
        flyoutCloseTimer = setTimeout(() => closeRankingFlyout(), 150);
      });
    });
    els.rankingFlyout.addEventListener("mouseenter", () => {
      clearTimeout(flyoutCloseTimer);
    });
    els.rankingFlyout.addEventListener("mouseleave", () => {
      flyoutCloseTimer = setTimeout(() => closeRankingFlyout(), 150);
    });
  }
  
  // Close dropdown when clicking outside
  document.addEventListener("click", (event) => {
    if (!els.burgerButton.contains(event.target) && !els.burgerDropdown.contains(event.target)) {
      closeBurgerMenu();
    }
  });
  
  // File menu actions
  els.fileNew.addEventListener("click", handleNew);
  els.fileOpen.addEventListener("click", handleOpen);
  els.fileSave.addEventListener("click", handleSave);
  els.fileSaveAs.addEventListener("click", handleSaveAs);
  els.fileDelete.addEventListener("click", handleDelete);
  
  // Name input modal
  els.nameInputForm.addEventListener("submit", handleNameInputSubmit);
  els.closeNameInput.addEventListener("click", closeNameInputModal);
  els.cancelNameInput.addEventListener("click", closeNameInputModal);
  
  // Update display on init
  updateCurrentRankingDisplay();
}

/**
 * Toggle burger menu dropdown visibility
 */
function toggleBurgerMenu(event) {
  event.stopPropagation();
  els.burgerDropdown.hidden = !els.burgerDropdown.hidden;
}

/**
 * Close burger menu dropdown
 */
export function closeBurgerMenu() {
  els.burgerDropdown.hidden = true;
  closeFileSubmenu();
  closeRankingFlyout();
}

/**
 * Open file submenu
 */
function openFileSubmenu() {
  const panel = document.querySelector('[data-submenu-panel="file"]');
  if (panel) panel.hidden = false;
}

/**
 * Close file submenu
 */
function closeFileSubmenu() {
  const panel = document.querySelector('[data-submenu-panel="file"]');
  if (panel) panel.hidden = true;
}

/**
 * Handle "New" action - create a new empty ranking
 */
async function handleNew() {
  closeBurgerMenu();
  
  // Auto-save current ranking if it has a name
  if (state.currentRankingName) {
    await saveRankingToServer(state.currentRankingName);
  }
  
  showNameInputModal("New Ranking", async (name) => {
    // Check if ranking already exists
    const rankings = await fetchRankings();
    const sanitizedName = sanitizeRankingName(name);
    const exists = rankings.some(r => r.name === sanitizedName);
    
    if (exists) {
      const overwrite = confirm(`A ranking named "${name}" already exists. Overwrite?`);
      if (!overwrite) return;
    }
    
    // Reset to default config
    state.currentRankingName = sanitizedName;
    state.title = "S-Tier Ranking Board";
    state.tiers = ["S", "A", "B", "C", "D", "F"];
    state.facets = [];
    state.candidates = [];
    state.min = 0;
    state.max = 10;
    
    syncConfigFromState();
    render();
    updateCurrentRankingDisplay();
    
    // Save the new empty ranking
    await saveRankingToServer(sanitizedName);
    showToast(`Created new ranking: ${name}`);
  });
}

/**
 * Handle "Open" action - show ranking flyout
 */
async function handleOpen() {
  // Don't close the burger menu — keep it open so the flyout can appear
  await showRankingFlyout();
}

/**
 * Handle "Save" action - save current ranking
 */
async function handleSave() {
  closeBurgerMenu();
  
  if (!state.currentRankingName) {
    // No name yet, prompt for one
    handleSaveAs();
    return;
  }
  
  await saveRankingToServer(state.currentRankingName);
  showToast(`Saved ranking: ${state.currentRankingName}`);
}

/**
 * Handle "Save As" action - save with new name
 */
async function handleSaveAs() {
  closeBurgerMenu();
  
  showNameInputModal("Save Ranking As", async (name) => {
    const sanitizedName = sanitizeRankingName(name);
    
    // Check if ranking already exists
    const rankings = await fetchRankings();
    const exists = rankings.some(r => r.name === sanitizedName);
    
    if (exists && sanitizedName !== state.currentRankingName) {
      const overwrite = confirm(`A ranking named "${name}" already exists. Overwrite?`);
      if (!overwrite) return;
    }
    
    state.currentRankingName = sanitizedName;
    await saveRankingToServer(sanitizedName);
    updateCurrentRankingDisplay();
    showToast(`Saved ranking as: ${name}`);
  });
}

/**
 * Handle "Delete" action - show ranking flyout for deletion
 */
async function handleDelete() {
  // Don't close the burger menu — keep it open so the flyout can appear
  await showRankingFlyout();
}

/**
 * Show name input modal
 */
function showNameInputModal(title, callback) {
  // Close any open flyouts first
  closeRankingFlyout();
  
  els.nameInputTitle.textContent = title;
  els.nameInputField.value = "";
  els.nameInputModal.hidden = false;
  els.nameInputField.focus();
  nameInputCallback = callback;
}

/**
 * Close name input modal
 */
function closeNameInputModal() {
  els.nameInputModal.hidden = true;
  els.nameInputForm.reset();
  nameInputCallback = null;
}

/**
 * Handle name input form submission
 */
function handleNameInputSubmit(event) {
  event.preventDefault();
  const name = els.nameInputField.value.trim();
  if (!name) return;
  
  if (nameInputCallback) {
    nameInputCallback(name);
  }
  closeNameInputModal();
}

/**
 * Show ranking flyout with list of saved rankings
 */
async function showRankingFlyout() {
  if (!els.rankingFlyout || !els.rankingFlyoutList) return;

  // Ensure the parent submenu is open
  openFileSubmenu();

  // Position flyout next to the active trigger
  const activeTrigger = document.querySelector(`[data-flyout-trigger="${flyoutMode}"]`);
  if (activeTrigger) {
    const rect = activeTrigger.getBoundingClientRect();
    const submenuRect = document.querySelector('[data-submenu-panel="file"]').getBoundingClientRect();
    els.rankingFlyout.style.top = `${rect.top - submenuRect.top}px`;
    els.rankingFlyout.style.left = `${rect.right - submenuRect.left + 2}px`;
  }

  els.rankingFlyout.hidden = false;
  els.rankingFlyoutList.innerHTML = "<p style='text-align:center;color:var(--muted);padding:1rem;font-size:0.875rem;'>Loading...</p>";

  try {
    const rankings = await fetchRankings();

    if (rankings.length === 0) {
      els.rankingFlyoutList.innerHTML = "";
      return;
    }

    els.rankingFlyoutList.innerHTML = rankings.map(ranking => {
      const date = new Date(ranking.modifiedAt).toLocaleString();
      return `
        <div class="ranking-flyout-item" data-ranking-name="${escapeAttr(ranking.name)}">
          <div class="ranking-flyout-item-info">
            <div class="ranking-flyout-item-name">${escapeHtml(ranking.name)}</div>
            <div class="ranking-flyout-item-date">Modified: ${date}</div>
          </div>
        </div>
      `;
    }).join("");

    // Wire up click on item — behavior depends on flyout mode (open vs delete)
    els.rankingFlyoutList.querySelectorAll(".ranking-flyout-item").forEach(item => {
      const name = item.dataset.rankingName;
      item.addEventListener("click", async () => {
        if (flyoutMode === "delete") {
          const confirmed = confirm(`Are you sure you want to delete "${name}"? This cannot be undone.`);
          if (!confirmed) return;
          try {
            await deleteRankingFromServer(name);
            showToast(`Deleted ranking: ${name}`);
            if (state.currentRankingName === name) {
              state.currentRankingName = null;
              updateCurrentRankingDisplay();
            }
            await showRankingFlyout();
          } catch (error) {
            console.error("Failed to delete ranking:", error);
            showToast("Failed to delete ranking.");
          }
        } else {
          await openRanking(name);
          closeBurgerMenu();
        }
      });
    });
  } catch (error) {
    console.error("Failed to load rankings:", error);
    els.rankingFlyoutList.innerHTML = "<p style='text-align:center;color:var(--muted);padding:1rem;font-size:0.875rem;'>Failed to load rankings.</p>";
  }
}

/**
 * Close ranking flyout
 */
function closeRankingFlyout() {
  if (els.rankingFlyout) {
    els.rankingFlyout.hidden = true;
  }
}

/**
 * Open a specific ranking by name
 */
async function openRanking(name) {
  // Auto-save current ranking if it has a name
  if (state.currentRankingName) {
    await saveRankingToServer(state.currentRankingName);
  }
  
  try {
    const data = await loadRankingFromServer(name);
    
    // Apply the loaded data to state
    state.title = data.title || "S-Tier Ranking Board";
    state.tiers = data.tiers || ["S", "A", "B", "C", "D", "F"];
    state.facets = data.facets || [];
    state.candidates = data.candidates || [];
    state.min = data.min ?? 0;
    state.max = data.max ?? 10;
    state.currentRankingName = name;
    
    syncConfigFromState();
    render();
    updateCurrentRankingDisplay();
    
    showToast(`Opened ranking: ${name}`);
  } catch (error) {
    console.error("Failed to open ranking:", error);
    showToast("Failed to open ranking.");
  }
}

/**
 * Update the current ranking name display in the header
 */
function updateCurrentRankingDisplay() {
  if (state.currentRankingName) {
    els.currentRankingName.textContent = state.currentRankingName;
  } else {
    els.currentRankingName.textContent = "";
  }
}

/**
 * Save current state to server
 */
async function saveRankingToServer(name) {
  const data = {
    title: state.title,
    tiers: state.tiers,
    facets: state.facets,
    candidates: state.candidates,
    min: state.min,
    max: state.max
  };
  
  const response = await fetch(`/api/rankings/${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
  
  if (!response.ok) {
    throw new Error(`Failed to save ranking: ${response.statusText}`);
  }
  
  return response.json();
}

/**
 * Load ranking from server
 */
async function loadRankingFromServer(name) {
  const response = await fetch(`/api/rankings/${encodeURIComponent(name)}`);
  
  if (!response.ok) {
    throw new Error(`Failed to load ranking: ${response.statusText}`);
  }
  
  return response.json();
}

/**
 * Delete ranking from server
 */
async function deleteRankingFromServer(name) {
  const response = await fetch(`/api/rankings/${encodeURIComponent(name)}`, {
    method: "DELETE"
  });
  
  if (!response.ok) {
    throw new Error(`Failed to delete ranking: ${response.statusText}`);
  }
  
  return response.json();
}

/**
 * Fetch list of all rankings from server
 */
async function fetchRankings() {
  const response = await fetch("/api/rankings");
  
  if (!response.ok) {
    throw new Error(`Failed to fetch rankings: ${response.statusText}`);
  }
  
  return response.json();
}

/**
 * Sanitize ranking name for use as filename
 */
function sanitizeRankingName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 100);
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Escape attribute value
 */
function escapeAttr(text) {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Load the most recent ranking on startup
 */
export async function loadMostRecentRanking() {
  try {
    const rankings = await fetchRankings();
    
    if (rankings.length === 0) {
      return false;
    }
    
    // Load the most recent ranking (first in the sorted list)
    const mostRecent = rankings[0];
    await openRanking(mostRecent.name);
    return true;
  } catch (error) {
    console.error("Failed to load most recent ranking:", error);
    return false;
  }
}
